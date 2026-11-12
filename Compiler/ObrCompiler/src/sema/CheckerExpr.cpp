#include "Checker.hpp"

#include "../Diagnostic.hpp"
#include "../Utf8.hpp"
#include "../intrinsic/Intrinsic.hpp"
#include "../type/Type.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <map>
#include <set>
#include <string>
#include <vector>

namespace obr {
namespace sema {

  bool Checker::fallibleExpr(const Expr& expr) const {
    if (expr.kind == Expr::Kind::Call || expr.kind == Expr::Kind::VirtualCall) {
      /* M-B：span 的 sub 子切片（-11）越界走 Plan 2 失败值；下标（Binary [）同。 */
      if (expr.integer < 0) return expr.integer == -21 || expr.integer == -26 || expr.integer == -11;
      return (*functions_)[static_cast<std::size_t>(expr.integer)].fails;
    }
    if (expr.kind == Expr::Kind::New && expr.integer >= 0) {
      return (*functions_)[static_cast<std::size_t>(expr.integer)].fails;
    }
    if (expr.kind == Expr::Kind::Binary && expr.op == Tok::LBracket) {
      return collection(expr.kids[0].type) || expr.kids[0].type == TypeKind::Span;
    }
    return false;
  }

  void Checker::checkExpr(Expr& expr) {
    checkExprInner(expr);
    if (expr.propagates) {
      if (!fallibleExpr(expr)) fail("? 前面必须是可失败的调用");
      if (tryDepth_ == 0 && !(*functions_)[static_cast<std::size_t>(self_)].fails) {
        fail("失败没有归宿：把函数标成 @Fails 或用 try 接住");
      }
    }
  }

  void Checker::checkExprInner(Expr& expr) {
    /* M-A：布局内建在普通表达式里同样折成 LitInt（与常量上下文同一结果、零运行时）。 */
    if (layoutBuiltinCall(expr)) {
      expr = foldLayoutBuiltin(expr);
      return;
    }
    if (expr.kind == Expr::Kind::StructLiteral) fail("结构体/类字面量只能用于 const");
    if (expr.kind == Expr::Kind::StructConst || expr.kind == Expr::Kind::ClassConst) return;
    if (expr.kind == Expr::Kind::LitInt || expr.kind == Expr::Kind::LitFloat || expr.kind == Expr::Kind::LitBool || expr.kind == Expr::Kind::LitChar || expr.kind == Expr::Kind::LitString || expr.kind == Expr::Kind::LitNull || expr.kind == Expr::Kind::LitUndefined) return;
    if (expr.kind == Expr::Kind::Name) {
      checkExprName(expr);
      return;
    }
    if (expr.kind == Expr::Kind::Await) {
      const Function& self = (*functions_)[static_cast<std::size_t>(self_)];
      if (!self.asyncFun) fail("await 只能写在 async 函数里");
      if (expr.kids.size() != 1 || expr.kids[0].kind != Expr::Kind::Call) fail("await 后面必须是调用");
      checkExpr(expr.kids[0]);
      expr.type = expr.kids[0].type;
      expr.typeName = expr.kids[0].typeName;
      return;
    }
    if (expr.kind == Expr::Kind::New) {
      checkExprNew(expr);
      return;
    }
    if (expr.kind == Expr::Kind::Member) {
      checkExprMember(expr);
      return;
    }
    if (expr.kind == Expr::Kind::Call) {
      checkExprCall(expr);
      return;
    }
    if (expr.kind == Expr::Kind::Cast) {
      checkExprCast(expr);
      return;
    }
    if (expr.kind == Expr::Kind::Unary) {
      checkExprUnary(expr);
      return;
    }
    if (expr.kind == Expr::Kind::Update) {
      checkExpr(expr.kids[0]);
      if (expr.kids[0].kind != Expr::Kind::Name) fail("++ 和 -- 只能用于变量");
      if (!numeric(expr.kids[0].type)) fail("++ 和 -- 只能用于数值");
      expr.type = expr.kids[0].type;
      return;
    }
    if (expr.kind == Expr::Kind::Assign) {
      checkExprAssign(expr);
      return;
    }
    if (expr.kind == Expr::Kind::Ternary) {
      checkExpr(expr.kids[0]);
      checkExpr(expr.kids[1]);
      checkExpr(expr.kids[2]);
      if (expr.kids[0].type == TypeKind::Void || expr.kids[1].type == TypeKind::Void || expr.kids[2].type == TypeKind::Void) fail("三元表达式不能是 void");
      if (expr.kids[1].type == TypeKind::Struct || expr.kids[2].type == TypeKind::Struct) fail("三元表达式不能选结构体值");
      /* M-B：span 是两字值，三元同结构体不选。 */
      if (expr.kids[1].type == TypeKind::Span || expr.kids[2].type == TypeKind::Span) fail("三元表达式不能选 span 值");
      if (expr.kids[1].type != expr.kids[2].type) fail("三元表达式的两个分支类型必须相同");
      expr.type = expr.kids[1].type;
      return;
    }
    checkExprBinary(expr);
}

void Checker::checkExprFailOf(Expr& expr) {
        if (version_ < 2) fail("fail.of 需要 #VERSION 2");
        if (expr.kids.size() < 2 || expr.kids.size() > 3) fail("fail.of 要 1 或 2 个参数");
        Expr status = std::move(expr.kids[1]);
        checkExpr(status);
        if (!integral(status.type) && status.type != TypeKind::Char && status.type != TypeKind::Boolean) {
          fail("fail.of 的状态必须是整数");
        }
        Expr note;
        const bool hasNote = expr.kids.size() == 3;
        if (hasNote) {
          note = std::move(expr.kids[2]);
          checkExpr(note);
          if (note.type != TypeKind::String) fail("fail.of 的备注必须是 string");
        }
        expr.kids.clear();
        expr.kids.push_back(std::move(status));
        if (hasNote) expr.kids.push_back(std::move(note));
        expr.integer = -7;
        expr.type = TypeKind::Ptr;
        expr.pointee = TypeKind::None;
        expr.typeName = "fail";
        expr.alt = TypeKind::None;
        expr.altName.clear();
        return;
      }

void Checker::checkExprCollectionCall(Expr& expr) {
        const Expr& object = expr.kids[0];
        const std::string& method = expr.text;
        auto element = [&](Expr& target) { fillDesc(target, object.type == TypeKind::Map ? object.altName : object.typeName); };
        if (object.type == TypeKind::List && method == "push" && expr.kids.size() == 2) {
          Expr want;
          element(want);
          if (!fits(expr.kids[1], want.type, want.typeName, want.alt, want.altName)) fail("push 的元素类型不一致");
          expr.integer = -20;
          expr.type = TypeKind::Void;
          return;
        }
        if (object.type == TypeKind::List && method == "pop" && expr.kids.size() == 1) {
          expr.integer = -21;
          element(expr);
          return;
        }
        const bool keyed = object.type == TypeKind::Set || object.type == TypeKind::Map;
        /* 集合的键按装箱引用散列（身份比较），结构体做键会失去值语义——拒绝。 */
        if (keyed && object.pointee == TypeKind::Struct) fail("集合的键不能是结构体");
        if (keyed && method == "has" && expr.kids.size() == 2) {
          Expr want;
          fillDesc(want, object.typeName);
          if (!fits(expr.kids[1], want.type, want.typeName, want.alt, want.altName)) fail("has 的键类型不一致");
          expr.integer = -22;
          expr.type = TypeKind::Boolean;
          return;
        }
        if (object.type == TypeKind::Set && method == "add" && expr.kids.size() == 2) {
          Expr want;
          fillDesc(want, object.typeName);
          if (!fits(expr.kids[1], want.type, want.typeName, want.alt, want.altName)) fail("add 的元素类型不一致");
          expr.integer = -23;
          expr.type = TypeKind::Void;
          return;
        }
        if (object.type == TypeKind::Map && method == "put" && expr.kids.size() == 3) {
          Expr key;
          Expr value;
          fillDesc(key, object.typeName);
          fillDesc(value, object.altName);
          if (!fits(expr.kids[1], key.type, key.typeName, key.alt, key.altName) || !fits(expr.kids[2], value.type, value.typeName, value.alt, value.altName)) {
            fail("put 的键或值类型不一致");
          }
          expr.integer = -24;
          expr.type = TypeKind::Void;
          return;
        }
        if (keyed && method == "remove" && expr.kids.size() == 2) {
          Expr want;
          fillDesc(want, object.typeName);
          if (!fits(expr.kids[1], want.type, want.typeName, want.alt, want.altName)) fail("remove 的键类型不一致");
          expr.integer = -25;
          expr.type = TypeKind::Void;
          return;
        }
        if (object.type == TypeKind::Map && method == "get" && expr.kids.size() == 2) {
          Expr key;
          fillDesc(key, object.typeName);
          if (!fits(expr.kids[1], key.type, key.typeName, key.alt, key.altName)) fail("get 的键类型不一致");
          expr.integer = -26;
          element(expr);
          return;
        }
        fail("没有这种集合操作 " + method);
      }

  /* M-B：span[T](地址, 个数) 构造。地址来源须是指针或整数位址（沿 (long*)4096 强转口径），
     个数是整数。两字值（元素位地址 + 元素个数）零分配；元素类型在 validateSpan 定死。 */
  void Checker::checkExprSpanCtor(Expr& expr) {
    for (Expr& argument : expr.kids) checkExpr(argument);
    validateSpan(expr.pointee, expr.typeName);
    if (expr.kids.size() != 2) fail("span 构造要写成 span[T](地址, 个数)");
    const Expr& at = expr.kids[0];
    const Expr& count = expr.kids[1];
    if (at.type != TypeKind::Ptr && !integral(at.type) && at.type != TypeKind::Char) {
      fail("span 构造的地址必须是整数位址或指针");
    }
    if (!integral(count.type) && count.type != TypeKind::Char) fail("span 构造的个数必须是整数");
    expr.type = TypeKind::Span;
  }

  /* M-B：span 成员调用只有 s.sub(起, 个数) 子切片（-11）。起/个数非负且起+个数 ≤ .count，
     否则越界 = Plan 2 失败值（code 1），不 halt、不另设停机。 */
  void Checker::checkExprSpanCall(Expr& expr) {
    const Expr& object = expr.kids[0];
    if (expr.text != "sub" || expr.kids.size() != 3) fail("span 只有 .data、.count 和 sub");
    for (std::size_t index = 1; index < expr.kids.size(); index += 1) {
      const Expr& argument = expr.kids[index];
      if (!integral(argument.type) && argument.type != TypeKind::Char) fail("span sub 的参数必须是整数");
    }
    expr.integer = -11;
    expr.type = TypeKind::Span;
    expr.pointee = object.pointee;
    expr.typeName = object.typeName;
    expr.alt = TypeKind::None;
    expr.altName.clear();
    expr.text = "sub";
  }

void Checker::checkExprInterfaceCall(Expr& expr) {
        const InterfaceDecl* iface = findInterface(expr.kids[0].typeName);
        if (iface == nullptr) fail("没有接口 " + expr.kids[0].typeName);
        int methodIndex = -1;
        int widenedIndex = -1;
        int widenedCount = 0;
        for (std::size_t index = 0; index < iface->methods.size(); index += 1) {
          const Function& method = iface->methods[index];
          if (shortFunctionName(method.name) != expr.text) continue;
          if (method.params.size() + 1 != expr.kids.size()) continue;
          bool same = true;
          bool fit = true;
          for (std::size_t param = 0; param < method.params.size(); param += 1) {
            const Param& want = method.params[param];
            if (!identicalArg(expr.kids[param + 1], want)) same = false;
            if (!fits(expr.kids[param + 1], want.type, want.typeName, want.alt, want.altName, want.mode, want.pointee, want.volatilePointee)) fit = false;
          }
          if (same) {
            if (methodIndex >= 0) fail("接口方法有多个匹配 " + expr.text);
            methodIndex = static_cast<int>(index);
          } else if (fit) {
            widenedIndex = static_cast<int>(index);
            widenedCount += 1;
          }
        }
        if (methodIndex < 0 && widenedCount == 1) methodIndex = widenedIndex;
        if (methodIndex < 0) {
          /* M-C：先给 out/ref 实参形状的专门诊断（接口方法按自身形参扫）。 */
          for (const Function& candidate : iface->methods) {
            if (shortFunctionName(candidate.name) != expr.text || candidate.params.size() + 1 != expr.kids.size()) continue;
            for (std::size_t param = 0; param < candidate.params.size(); param += 1) {
              if (candidate.params[param].mode != ParamMode::None && !assignableLValue(expr.kids[param + 1])) {
                fail("out/ref 形参的实参必须是可赋值左值");
              }
            }
          }
          fail(widenedCount > 1 ? "接口方法有多个匹配 " + expr.text : "接口 " + iface->name + " 没有匹配的方法 " + expr.text);
        }
        const Function& method = iface->methods[static_cast<std::size_t>(methodIndex)];
        expr.kind = Expr::Kind::Dispatch;
        expr.text = iface->name;
        expr.integer = methodIndex;
        expr.type = method.ret;
        expr.typeName = method.retName;
        expr.pointee = method.retPointee;
        expr.volatilePointee = method.retVolatilePointee;
        expr.alt = method.retAlt;
        expr.altName = method.retAltName;
        return;
      }

void Checker::checkExprCall(Expr& expr) {
      /* fail.of(status) / fail.of(status, note)：内置失败值构造（M3）。
         同名局部变量可以遮蔽它（存量程序里有叫 fail 的变量）。 */
      if (expr.integer == -4 && expr.text == "of" && !expr.kids.empty()
        && expr.kids[0].kind == Expr::Kind::Name && expr.kids[0].text == "fail" && find("fail") == nullptr) {
        checkExprFailOf(expr);
        return;
      }
      /* M-B：span[T](地址, 个数) 切片构造（Call + 负标记 -10）。 */
      if (expr.integer == -10) {
        checkExprSpanCtor(expr);
        return;
      }
      for (Expr& argument : expr.kids) checkExpr(argument);
      if (expr.integer == -4 && !expr.kids.empty() && collection(expr.kids[0].type)) {
        checkExprCollectionCall(expr);
        return;
      }
      /* M-B：span 的成员调用只有 s.sub(起, 个数)（-11，越界走失败值）。 */
      if (expr.integer == -4 && !expr.kids.empty() && expr.kids[0].type == TypeKind::Span) {
        checkExprSpanCall(expr);
        return;
      }
      if (expr.integer == -4 && !expr.kids.empty() && expr.kids[0].type == TypeKind::Interface) {
        checkExprInterfaceCall(expr);
        return;
      }
      if (expr.integer == -4) {
        if (expr.kids.empty() || expr.kids[0].typeName.empty()) fail("成员调用的对象没有类");
        expr.text = expr.kids[0].typeName + "::" + expr.text;
      }
      const Function& self = (*functions_)[static_cast<std::size_t>(self_)];
      int widenedCount = 0;
      int chosen = pickOverload(self, expr.text, expr.kids, widenedCount);
      if (chosen < 0 && !self.owner.empty() && expr.text.find("::") == std::string::npos && expr.integer != -4) {
        Expr object;
        object.kind = Expr::Kind::Name;
        object.text = "this";
        checkExpr(object);
        expr.kids.insert(expr.kids.begin(), std::move(object));
        expr.text = self.owner + "::" + expr.text;
        chosen = pickOverload(self, expr.text, expr.kids, widenedCount);
      }
      if (chosen < 0) {
        const std::size_t scope = expr.text.rfind("::");
        if (scope != std::string::npos) {
          std::string cursor = expr.text.substr(0, scope);
          const std::string shortName = expr.text.substr(scope + 2);
          const ClassDecl* start = findClass(cursor);
          cursor = start == nullptr ? std::string() : start->base;
          while (chosen < 0 && !cursor.empty()) {
            expr.text = cursor + "::" + shortName;
            chosen = pickOverload(self, expr.text, expr.kids, widenedCount);
            if (chosen < 0 && shortName != cursor) {
              /* 构造链：基类构造按 Class::Class 命名（泛型实例的构造是 Base<int>::Base<int>）。 */
              expr.text = cursor + "::" + cursor;
              chosen = pickOverload(self, expr.text, expr.kids, widenedCount);
            }
            const ClassDecl* next = findClass(cursor);
            cursor = next == nullptr ? std::string() : next->base;
          }
        }
      }
      if (chosen < 0 && expr.text == "length" && expr.kids.size() == 1 && (expr.kids[0].type == TypeKind::String || collection(expr.kids[0].type))) {
        expr.integer = -2;
        expr.type = TypeKind::Int;
        return;
      }
      if (chosen < 0) {
        /* M-C：先给 out/ref 实参形状的专门诊断（bad-out-literal 口径）。
           M-D：再给 volatile 指针隐式互转的专门诊断。 */
        rejectOutArgShapes(expr.text, expr.kids);
        rejectVolatileArgShapes(expr.text, expr.kids);
        fail(widenedCount > 1 ? "调用 " + expr.text + " 有多个可加宽的函数" : "没有函数 " + expr.text);
      }
      const Function& target = (*functions_)[static_cast<std::size_t>(chosen)];
      /* M-E：obr::atomic::* / memory::fence 的编译期校验（64 位对齐、内存序标注参数）。 */
      if (target.name.rfind("obr::atomic::", 0) == 0 || target.name == "memory::fence") checkAtomicCall(target, expr);
      if (target.callfunNone) fail("调用被 @Callfun 禁止 " + expr.text);
      if (!target.callfun.empty()) {
        std::string file = self.origin;
        const std::size_t slash = file.find_last_of("/\\");
        if (slash != std::string::npos) file = file.substr(slash + 1);
        bool allowed = false;
        for (const std::string& item : target.callfun) {
          if (item == file) allowed = true;
        }
        if (!allowed) fail("调用链不允许 " + file + " 调用 " + expr.text);
      }
      checkMethodAccess(target);
      expr.integer = chosen;
      expr.type = (*functions_)[static_cast<std::size_t>(chosen)].ret;
      expr.typeName = (*functions_)[static_cast<std::size_t>(chosen)].retName;
      expr.pointee = (*functions_)[static_cast<std::size_t>(chosen)].retPointee;
      expr.volatilePointee = (*functions_)[static_cast<std::size_t>(chosen)].retVolatilePointee;
      expr.alt = (*functions_)[static_cast<std::size_t>(chosen)].retAlt;
      expr.altName = (*functions_)[static_cast<std::size_t>(chosen)].retAltName;
      /* 覆盖链上的方法走方法表派发（@Overwrite 建立的槽）；其余保持静态直呼。
         覆盖链上的具体类型调用也派发：`Sub s = new SubSub(); s.v();` 必须进
         SubSub::v，否则 @Overwrite 的契约是假的。 */
      if (virtualSlot(target)) {
        expr.kind = Expr::Kind::VirtualCall;
        expr.text = target.name;
        expr.integer = chosen;
      }
      return;
    }

void Checker::checkExprName(Expr& expr) {
      Slot* slot = find(expr.text);
      if (slot != nullptr && slot->isConst) {
        expr = slot->constant;
        return;
      }
      if (slot == nullptr) {
        const auto found = moduleConsts_.find(expr.text);
        if (found != moduleConsts_.end()) {
          expr = found->second;
          return;
        }
      }
      if (slot == nullptr && takeEnum(expr)) return;
      if (slot == nullptr) {
        const Function& self = (*functions_)[static_cast<std::size_t>(self_)];
        if (!self.owner.empty()) {
          const ClassDecl* decl = findClass(self.owner);
          if (decl != nullptr) {
            for (const Field& field : decl->fields) {
              if (field.name != expr.text) continue;
              checkFieldAccess(field);
              Expr object;
              object.kind = Expr::Kind::Name;
              object.text = "this";
              checkExpr(object);
              expr.kind = Expr::Kind::Member;
              expr.kids.clear();
              expr.kids.push_back(std::move(object));
              expr.integer = field.offset;
              expr.type = field.type;
              expr.pointee = field.pointee;
              expr.alt = field.alt;
              expr.typeName = field.typeName;
              expr.altName = field.altName;
              return;
            }
          }
        }
        fail("没有变量 " + expr.text);
      }
      expr.type = slot->type;
      expr.pointee = slot->pointee;
      expr.volatilePointee = slot->volatilePointee;
      expr.alt = slot->alt;
      expr.typeName = slot->typeName;
      expr.altName = slot->altName;
      expr.integer = slot->index;
      return;
    }

void Checker::checkExprNew(Expr& expr) {
      if (expr.integer == -6) {
        for (Expr& argument : expr.kids) checkExpr(argument);
        repair(expr.type, expr.pointee, expr.alt, expr.typeName, expr.altName);
        if (expr.type == TypeKind::Array) {
          if (expr.kids.size() != 1 || !integral(expr.kids[0].type)) fail("array 的 new 要一个整数长度");
        } else if (!expr.kids.empty()) {
          fail("这个集合的 new 不接受参数");
        }
        return;
      }
      const ClassDecl* decl = findClass(expr.text);
      if (decl == nullptr) fail("没有类 " + expr.text);
      expr.type = TypeKind::Ptr;
      expr.typeName = expr.text;
      for (Expr& argument : expr.kids) checkExpr(argument);
      const std::string ctorName = expr.text + "::" + expr.text;
      int exact = -1;
      int widened = -1;
      int widenedCount = 0;
      bool any = false;
      for (std::size_t index = 0; index < functions_->size(); index += 1) {
        const Function& function = (*functions_)[static_cast<std::size_t>(index)];
        if (function.name != ctorName) continue;
        any = true;
        if (function.params.size() != expr.kids.size() + 1) continue;
        bool same = true;
        bool fit = true;
        for (std::size_t param = 0; param < expr.kids.size(); param += 1) {
          const Param& want = function.params[param + 1];
          if (!identicalArg(expr.kids[param], want)) same = false;
          if (!fits(expr.kids[param], want.type, want.typeName, want.alt, want.altName, want.mode, want.pointee, want.volatilePointee)) fit = false;
        }
        if (same) {
          if (exact >= 0) fail("调用 " + ctorName + " 有多个完全匹配");
          exact = static_cast<int>(index);
        } else if (fit) {
          widened = static_cast<int>(index);
          widenedCount += 1;
        }
      }
      const int chosen = exact >= 0 ? exact : widenedCount == 1 ? widened : -1;
      if (chosen < 0) {
        if (expr.kids.empty() && !any) {
          expr.integer = -1;
          return;
        }
        /* M-C：先给 out/ref 实参形状的专门诊断。 */
        rejectOutArgShapes(expr.text + "::" + expr.text, expr.kids);
        fail("没有匹配的构造 " + expr.text);
      }
      const Function& target = (*functions_)[static_cast<std::size_t>(chosen)];
      const Function& self = (*functions_)[static_cast<std::size_t>(self_)];
      if (target.callfunNone) fail("调用被 @Callfun 禁止 " + ctorName);
      if (!target.callfun.empty()) {
        std::string file = self.origin;
        const std::size_t slash = file.find_last_of("/\\");
        if (slash != std::string::npos) file = file.substr(slash + 1);
        bool allowed = false;
        for (const std::string& item : target.callfun) {
          if (item == file) allowed = true;
        }
        if (!allowed) fail("调用链不允许 " + file + " 调用 " + ctorName);
      }
      checkMethodAccess(target);
      expr.integer = chosen;
      return;
    }

void Checker::checkExprMember(Expr& expr) {
      checkExpr(expr.kids[0]);
      /* M-B：span 的 .data/.count 读两字（元素位地址 / 元素个数），只读不写。 */
      if (expr.kids[0].type == TypeKind::Span) {
        if (expr.text != "data" && expr.text != "count") fail("span 只有 .data、.count 和 sub");
        expr.prefix = true;
        expr.integer = expr.text == "data" ? 0 : 64;
        expr.type = TypeKind::Long;
        expr.pointee = TypeKind::None;
        expr.typeName.clear();
        expr.alt = TypeKind::None;
        expr.altName.clear();
        return;
      }
      const bool aggregate = expr.kids[0].type == TypeKind::Struct;
      const bool structPointer = expr.kids[0].type == TypeKind::Ptr && expr.kids[0].pointee == TypeKind::Struct;
      if (aggregate || structPointer) {
        const StructDecl* decl = findStruct(expr.kids[0].typeName);
        if (decl == nullptr) fail("没有结构体 " + expr.kids[0].typeName);
        expr.prefix = aggregate;
        for (const Field& field : decl->fields) {
          if (field.name != expr.text) continue;
          checkFieldAccess(field);
          expr.integer = field.offset;
          expr.type = field.type;
          expr.pointee = field.pointee;
          expr.alt = field.alt;
          expr.typeName = field.typeName;
          expr.altName = field.altName;
          return;
        }
        fail("没有字段 " + expr.text);
      }
      expr.prefix = false;
      const ClassDecl* decl = findClass(expr.kids[0].typeName);
      if (decl == nullptr) fail("成员访问的对象没有类");
      for (const Field& field : decl->fields) {
        if (field.name != expr.text) continue;
        checkFieldAccess(field);
        expr.integer = field.offset;
        expr.type = field.type;
        expr.pointee = field.pointee;
        expr.alt = field.alt;
        expr.typeName = field.typeName;
        expr.altName = field.altName;
        return;
      }
      fail("没有字段 " + expr.text);
    }

void Checker::checkExprCast(Expr& expr) {
      checkExpr(expr.kids[0]);
      /* (类名*)引用 是类引用强转：与 (Pair*)addr 的结构体指针转换同族写法（(名字*) 才是转换，
         见 Parser 的注释），但来源必须是类引用。派生→基类是加宽（fits 已允许隐式方向）；
         基类→派生必须显式写出，并按对象头 class ID 做运行时检查。 */
      if (expr.type == TypeKind::Ptr && expr.pointee == TypeKind::Void && findClass(expr.typeName) != nullptr) {
        const ClassDecl* dst = findClass(expr.typeName);
        if (expr.kids[0].kind == Expr::Kind::LitNull) {
          expr.type = TypeKind::Ptr;
          expr.pointee = TypeKind::None;
          return;
        }
        const std::string srcName = expr.kids[0].typeName;
        const ClassDecl* src = expr.kids[0].type == TypeKind::Ptr ? findClass(srcName) : nullptr;
        if (src == nullptr) fail("类引用强转的来源必须是类引用");
        if (srcName != expr.typeName) {
          if (classDerivesFrom(srcName, expr.typeName)) {
            /* 派生→基类：加宽，不需要检查。 */
          } else if (classDerivesFrom(expr.typeName, srcName)) {
            if (src->headerWords == 0 || dst->headerWords == 0) fail("版本 1 的类没有对象头，不能检查强转");
            expr.integer = -5;
          } else {
            fail("类之间不能这样转换 " + srcName + " -> " + expr.typeName);
          }
        }
        expr.type = TypeKind::Ptr;
        expr.pointee = TypeKind::None;
        return;
      }
      resolveType(expr.type, expr.pointee, expr.typeName);
      const TypeKind source = expr.kids[0].type;
      const TypeKind target = expr.type;
      if (target == TypeKind::Ptr) {
        if (source != TypeKind::Ptr && !integral(source)) fail("指针转换的来源必须是整数或指针");
        /* M-D：涉及 volatile 指针的显式转换只在同点类型之间放行（无关指针互转拒绝）；
           `volatile T*` ↔ `T*` 显式转换才放行，隐式互转见 fits。 */
        if (source == TypeKind::Ptr && (expr.volatilePointee || expr.kids[0].volatilePointee)
          && (expr.kids[0].pointee != expr.pointee || expr.kids[0].typeName != expr.typeName)) {
          fail("无关指针不能互转（volatile 指针转换只在同点类型之间放行）");
        }
        return;
      }
      const bool sourceInteger = integral(source) || source == TypeKind::Char || source == TypeKind::Boolean;
      const bool sourceFloat = source == TypeKind::Float || source == TypeKind::Double;
      const bool sourcePtr = source == TypeKind::Ptr;
      if (target == TypeKind::Float || target == TypeKind::Double) {
        if (!sourceInteger && !sourceFloat) fail("转成浮点的来源必须是数值、char 或 boolean");
      } else if (target == TypeKind::Boolean) {
        if (!sourceInteger && !sourceFloat && !sourcePtr) fail("转成 boolean 的来源必须是数值、char、boolean 或指针");
      } else if (target == TypeKind::Byte || target == TypeKind::Short || target == TypeKind::Int
        || target == TypeKind::Long || target == TypeKind::Char) {
        if (!sourceInteger && !sourceFloat && !sourcePtr) fail("转成整数或 char 的来源必须是数值、char、boolean 或指针");
      } else {
        fail(std::string("不支持转到 ") + nameOf(target));
      }
      expr.type = target;
      expr.pointee = TypeKind::None;
      expr.volatilePointee = false;
      expr.alt = TypeKind::None;
      expr.typeName.clear();
      expr.altName.clear();
      return;
    }

void Checker::checkExprUnary(Expr& expr) {
      checkExpr(expr.kids[0]);
      if (expr.op == Tok::BitAnd) {
        if (expr.kids[0].kind != Expr::Kind::Name) fail("& 只能取变量的地址");
        /* M-B：span 是两字值，不开放取址（要地址写 .data）。 */
        if (expr.kids[0].type == TypeKind::Span) fail("span 变量不能取址，用 .data/.count");
        expr.type = TypeKind::Ptr;
        expr.pointee = expr.kids[0].type;
        expr.typeName = expr.kids[0].typeName;
        expr.integer = expr.kids[0].integer;
        return;
      }
      if (expr.op == Tok::Star) {
        if (expr.kids[0].type != TypeKind::Ptr) fail("* 只能用于指针");
        expr.type = expr.kids[0].pointee;
        expr.typeName = expr.kids[0].typeName;
        expr.pointee = expr.kids[0].pointee == TypeKind::Struct ? TypeKind::None : expr.kids[0].pointee;
        return;
      }
      if (expr.op == Tok::Not) {
        if (expr.kids[0].type == TypeKind::Void) fail("! 不能用于 void");
        expr.type = TypeKind::Boolean;
        return;
      }
      if (!numeric(expr.kids[0].type)) fail("一元正负号只能用于数值");
      if (expr.op == Tok::BitNot) {
        if (!integral(expr.kids[0].type)) fail("~ 目前只接受整数");
        expr.type = TypeKind::Int;
        return;
      }
      else expr.type = expr.kids[0].type;
      return;
    }

void Checker::checkExprAssign(Expr& expr) {
      checkExpr(expr.kids[0]);
      checkExpr(expr.kids[1]);
      const bool index = expr.kids[0].kind == Expr::Kind::Binary && expr.kids[0].op == Tok::LBracket;
      if (expr.kids[0].kind != Expr::Kind::Name && expr.kids[0].kind != Expr::Kind::Member && !index && !(expr.kids[0].kind == Expr::Kind::Unary && expr.kids[0].op == Tok::Star)) fail("赋值的左边必须是变量、字段、下标或 *指针");
      /* M-B：span 的 .data/.count 读两字，只读。 */
      if (expr.kids[0].kind == Expr::Kind::Member && !expr.kids[0].kids.empty() && expr.kids[0].kids[0].type == TypeKind::Span) {
        fail("span 的 .data 和 .count 只读");
      }
      if (index && expr.kids[0].kids[0].type != TypeKind::Array && expr.kids[0].kids[0].type != TypeKind::List && expr.kids[0].kids[0].type != TypeKind::Span) {
        fail("只有 array、list 和 span 能按下标赋值");
      }
      /* M-B：span 下标写元素只支持 `=`（s[i] = v）；复合赋值不落到元素地址。 */
      if (index && expr.kids[0].kids[0].type == TypeKind::Span && expr.op != Tok::Assign) fail("span 下标赋值只支持 =");
      if (expr.op == Tok::Assign) {
        const TypeKind dest = expr.kids[0].type;
        /* M-B：span 整值赋值 = 两字拷贝，同结构体的值语义（同元素类型才拷）。 */
        if (dest == TypeKind::Span || expr.kids[1].type == TypeKind::Span) {
          if (dest != TypeKind::Span || expr.kids[1].type != TypeKind::Span || expr.kids[0].typeName != expr.kids[1].typeName) {
            fail("span 赋值必须是同一类型");
          }
          const Expr& rhs = expr.kids[1];
          const bool rhsOk = rhs.kind == Expr::Kind::Name || rhs.kind == Expr::Kind::Member
            || (rhs.kind == Expr::Kind::Binary && rhs.op == Tok::LBracket)
            || rhs.kind == Expr::Kind::Call || rhs.kind == Expr::Kind::VirtualCall
            || (rhs.kind == Expr::Kind::Unary && rhs.op == Tok::Star);
          if (!rhsOk) fail("span 整值赋值的右边必须是变量、字段、下标或调用结果");
        } else if (dest == TypeKind::Struct || expr.kids[1].type == TypeKind::Struct) {
          if (dest != TypeKind::Struct || expr.kids[1].type != TypeKind::Struct || expr.kids[0].typeName != expr.kids[1].typeName) fail("结构体赋值必须是同一类型");
          /* 值拷贝：右边必须是能给出地址的结构体值（变量、字段、下标、调用结果）。 */
          const Expr& rhs = expr.kids[1];
          const bool rhsOk = rhs.kind == Expr::Kind::Name || rhs.kind == Expr::Kind::Member
            || (rhs.kind == Expr::Kind::Binary && rhs.op == Tok::LBracket)
            || rhs.kind == Expr::Kind::Call || rhs.kind == Expr::Kind::VirtualCall
            || (rhs.kind == Expr::Kind::Unary && rhs.op == Tok::Star);
          if (!rhsOk) fail("结构体整值赋值的右边必须是变量、字段、下标或调用结果");
        } else if (volatileOnlyMismatch(expr.kids[1], dest, expr.kids[0].typeName, expr.kids[0].pointee, expr.kids[0].volatilePointee)) {
          /* M-D：volatile↔普通指针隐式互转拒绝，显式转换才放行。 */
          fail("volatile 指针和普通指针不能隐式互转，要显式转换");
        } else if (!fits(expr.kids[1], dest, expr.kids[0].typeName, expr.kids[0].alt, expr.kids[0].altName, ParamMode::None, expr.kids[0].pointee, expr.kids[0].volatilePointee) && !(dest == TypeKind::Ptr && integral(expr.kids[1].type))) {
          fail("赋值类型不一致");
        }
        rejectForeignEnum(expr.kids[0].typeName, dest, expr.kids[1].typeName, expr.kids[1].type);
        if (dest == TypeKind::Ptr && expr.kids[1].type == TypeKind::Ptr) expr.pointee = expr.kids[1].pointee;
        expr.typeName = expr.kids[0].typeName;
      } else if (!numeric(expr.kids[0].type) || (expr.kids[0].type == TypeKind::Byte && expr.kids[1].type != TypeKind::Byte)) {
        fail("复合赋值的类型不合法");
      }
      expr.type = expr.kids[0].type;
      return;
    }

void Checker::checkExprBinary(Expr& expr) {    checkExpr(expr.kids[0]);
    checkExpr(expr.kids[1]);
    const TypeKind left = expr.kids[0].type;
    const TypeKind right = expr.kids[1].type;
    if (expr.op == Tok::LBracket) {
      if (left == TypeKind::String && integral(right)) {
        expr.type = TypeKind::Char;
        return;
      }
      if ((left == TypeKind::Array || left == TypeKind::List) && integral(right)) {
        fillDesc(expr, expr.kids[0].typeName);
        return;
      }
      /* M-B：span 下标取元素（步长 = 元素值宽度 = M-A alignof），越界走失败值。 */
      if (left == TypeKind::Span && (integral(right) || right == TypeKind::Char)) {
        fillDesc(expr, expr.kids[0].typeName);
        return;
      }
      fail("下标只能用于字符串、array、list，下标必须是整数");
    }
    if (expr.op == Tok::And || expr.op == Tok::Or) {
      if (left == TypeKind::Void || right == TypeKind::Void) fail("逻辑运算不能是 void");
      expr.type = TypeKind::Boolean;
      return;
    }
    if (expr.op == Tok::Eq || expr.op == Tok::Ne) {
      const bool leftNull = expr.kids[0].kind == Expr::Kind::LitNull;
      const bool rightNull = expr.kids[1].kind == Expr::Kind::LitNull;
      if (expr.kids[0].type == TypeKind::Struct || expr.kids[1].type == TypeKind::Struct) fail("结构体不能比较（按字段比较）");
      /* M-B：span 是两字值，同结构体不比较（按 .data/.count 比较）。 */
      if (expr.kids[0].type == TypeKind::Span || expr.kids[1].type == TypeKind::Span) fail("span 不能比较（按 .data/.count 比较）");
      if ((collection(left) && (rightNull || sameCollection(expr.kids[1], left, expr.kids[0].typeName, expr.kids[0].altName))) || (collection(right) && leftNull)) {
        expr.type = TypeKind::Boolean;
        return;
      }
      /* 类引用/接口引用的 == 是引用相等，可与 null 比较。 */
      const bool leftRef = left == TypeKind::Ptr || left == TypeKind::Interface;
      const bool rightRef = right == TypeKind::Ptr || right == TypeKind::Interface;
      if (leftRef && (rightNull || (rightRef && left == right && expr.kids[0].typeName == expr.kids[1].typeName))) {
        expr.type = TypeKind::Boolean;
        return;
      }
      if (rightRef && leftNull) {
        expr.type = TypeKind::Boolean;
        return;
      }
      if (left != right || (!integral(left) && left != TypeKind::Float && left != TypeKind::Double && left != TypeKind::Char && left != TypeKind::String)) {
        fail("== 的两侧类型必须相同，并且是数值、char、string 或同一个集合");
      }
      expr.type = TypeKind::Boolean;
      return;
    }
    if (expr.op == Tok::Lt || expr.op == Tok::Le || expr.op == Tok::Gt || expr.op == Tok::Ge) {
      if (left != right || !integral(left)) fail("关系运算只能比较相同的整数类型");
      expr.type = TypeKind::Boolean;
      return;
    }
    if (expr.op == Tok::Pow) {
      expr.type = promote(left, right) == TypeKind::Byte ? TypeKind::Byte : TypeKind::Double;
      return;
    }
    if (expr.op == Tok::BitAnd || expr.op == Tok::BitOr || expr.op == Tok::BitXor || expr.op == Tok::Shl || expr.op == Tok::Shr || expr.op == Tok::UShr) {
      if (!numeric(left) || !numeric(right)) fail("位运算只能用于数值");
      promote(left, right);
      expr.type = TypeKind::Int;
      return;
    }
    if (expr.op == Tok::Plus && (left == TypeKind::String || right == TypeKind::String || left == TypeKind::Char || right == TypeKind::Char)) {
      if (left == TypeKind::Boolean || right == TypeKind::Boolean || left == TypeKind::Undefined || right == TypeKind::Undefined || left == TypeKind::Void || right == TypeKind::Void) {
        fail("不能这样拼接字符串");
      }
      expr.type = TypeKind::String;
      return;
    }
    if (!numeric(left) || !numeric(right)) fail("算术运算只能用于数值");
    expr.type = promote(left, right);
  }

}  // namespace sema
}  // namespace obr
