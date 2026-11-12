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

  void Checker::checkStmt(Stmt& stmt) {
    if (stmt.kind == Stmt::Kind::Block) {
      push();
      for (Stmt& inner : stmt.body) checkStmt(inner);
      pop();
      return;
    }
    if (stmt.kind == Stmt::Kind::Const) {
      resolveType(stmt.type, stmt.pointee, stmt.typeName);
      repair(stmt.type, stmt.pointee, stmt.alt, stmt.typeName, stmt.altName);
      if (!constScalar(stmt.type)) fail("Plan 1 首批 const 只支持标量 " + stmt.name);
      Expr value = constantValue(stmt.expr);
      if (!fits(value, stmt.type, stmt.typeName, stmt.alt, stmt.altName)) {
        fail("常量 " + stmt.name + " 的初值类型不匹配");
      }
      rejectForeignEnum(stmt.typeName, stmt.type, value.typeName, value.type);
      value = adaptConstant(std::move(value), stmt.type, stmt.typeName);
      stmt.expr = value;
      stmt.words = 0;
      allocConst(stmt.name, stmt.type, stmt.pointee, stmt.alt, stmt.typeName, stmt.altName, std::move(value));
      return;
    }
    if (stmt.kind == Stmt::Kind::ForIn) {
      checkStmtForIn(stmt);
      return;
    }
    if (stmt.kind == Stmt::Kind::Switch) {
      checkStmtSwitch(stmt);
      return;
    }
    if (stmt.kind == Stmt::Kind::Fallthrough) {
      if (switchDepth_ == 0) fail("fallthrough 只能写在 switch 的 case 里");
      return;
    }
    if (stmt.kind == Stmt::Kind::Decl) {
      checkStmtDecl(stmt);
      return;
    }
    if (stmt.kind == Stmt::Kind::For) {
      push();
      for (Stmt& inner : stmt.other) checkStmt(inner);
      if (stmt.expr.type == TypeKind::None && stmt.expr.kind == Expr::Kind::LitInt) {
        stmt.expr.kind = Expr::Kind::LitBool;
        stmt.expr.integer = 1;
        stmt.expr.type = TypeKind::Boolean;
      }
      checkExpr(stmt.expr);
      if (stmt.expr.type == TypeKind::Void) fail("条件不能是 void");
      loops_ += 1;
      for (Stmt& inner : stmt.body) checkStmt(inner);
      loops_ -= 1;
      pop();
      return;
    }
    if (stmt.kind == Stmt::Kind::If || stmt.kind == Stmt::Kind::While) {
      checkExpr(stmt.expr);
      if (stmt.expr.type == TypeKind::Void) fail("条件不能是 void");
      if (stmt.kind == Stmt::Kind::While) loops_ += 1;
      push();
      for (Stmt& inner : stmt.body) checkStmt(inner);
      pop();
      if (stmt.kind == Stmt::Kind::While) loops_ -= 1;
      push();
      for (Stmt& inner : stmt.other) checkStmt(inner);
      pop();
      return;
    }
    if (stmt.kind == Stmt::Kind::Try) {
      if (version_ < 2) fail("try 需要 #VERSION 2");
      tryDepth_ += 1;
      push();
      for (Stmt& inner : stmt.body) checkStmt(inner);
      pop();
      tryDepth_ -= 1;
      push();
      resolveType(stmt.type, stmt.pointee, stmt.typeName);
      if (!(stmt.type == TypeKind::Ptr && stmt.typeName == "fail")) fail("catch 的变量必须是 fail 类型");
      stmt.slot = alloc(stmt.name, stmt.type, stmt.pointee, 1);
      if (Slot* saved = find(stmt.name)) {
        saved->typeName = stmt.typeName;
        saved->alt = stmt.alt;
        saved->altName = stmt.altName;
      }
      for (Stmt& inner : stmt.other) checkStmt(inner);
      pop();
      return;
    }
    if (stmt.kind == Stmt::Kind::Throw) {
      if (version_ < 2) fail("throw 需要 #VERSION 2");
      checkExpr(stmt.expr);
      if (!(stmt.expr.type == TypeKind::Ptr && stmt.expr.typeName == "fail")) fail("throw 的值必须是 fail 类型");
      return;
    }
    if (stmt.kind == Stmt::Kind::Break) {
      if (loops_ < 1 && switchDepth_ < 1) fail("break 只能写在循环或 switch 里");
      return;
    }
    if (stmt.kind == Stmt::Kind::Continue) {
      if (loops_ < 1) fail("continue 只能写在循环里");
      return;
    }
    if (stmt.kind == Stmt::Kind::Goto) {
      if (labels_.find(stmt.name) == labels_.end()) fail("没有标号 " + stmt.name);
      sawGoto_ = true;
      return;
    }
    if (stmt.kind == Stmt::Kind::Label) return;
    if (stmt.kind == Stmt::Kind::Return) {
      const bool hasValue = !(stmt.expr.kind == Expr::Kind::LitInt && stmt.expr.type == TypeKind::None && stmt.expr.kids.empty());
      if (ret_ == TypeKind::Void) {
        if (hasValue) fail("void 函数不能返回值");
        return;
      }
      if (!hasValue) fail("函数必须返回值");
      checkExpr(stmt.expr);
      /* M-D：volatile↔普通指针的返回流转同样隐式拒绝。 */
      if (volatileOnlyMismatch(stmt.expr, ret_, retName_, retPointee_, retVolatilePointee_)) {
        fail("volatile 指针和普通指针不能隐式互转，要显式转换");
      }
      if (!fits(stmt.expr, ret_, retName_, retAlt_, retAltName_, ParamMode::None, retPointee_, retVolatilePointee_)) {
        fail(std::string("返回类型是 ") + typeText(stmt.expr.type, stmt.expr.typeName, stmt.expr.alt, stmt.expr.altName) + "，函数要求 " + typeText(ret_, retName_, retAlt_, retAltName_));
      }
      rejectForeignEnum(retName_, ret_, stmt.expr.typeName, stmt.expr.type);
      return;
    }
    if (stmt.kind == Stmt::Kind::Expr) checkExpr(stmt.expr);
  }

void Checker::checkStmtForIn(Stmt& stmt) {
      checkExpr(stmt.expr);
      Expr element;
      if (stmt.expr.type == TypeKind::Array || stmt.expr.type == TypeKind::List) {
        if (stmt.expr.typeName.empty()) fail("for-in 的集合缺少元素类型");
        fillDesc(element, stmt.expr.typeName);
      } else {
        const InterfaceDecl* iterable = findInterface("Iterable");
        if (iterable == nullptr) fail("for-in 目前只支持 array/list 或实现了 Iterable 的类");
        if (stmt.expr.type == TypeKind::Ptr) {
          if (!classImplements(stmt.expr.typeName, "Iterable")) fail("for-in 的类没有实现 Iterable");
        } else if (stmt.expr.type != TypeKind::Interface || stmt.expr.typeName != "Iterable") {
          fail("for-in 目前只支持 array/list 或实现了 Iterable 的类");
        }
        const Function* hasNext = nullptr;
        const Function* next = nullptr;
        for (const Function& method : iterable->methods) {
          const std::string name = shortFunctionName(method.name);
          if (name == "hasNext") hasNext = &method;
          if (name == "next") next = &method;
        }
        if (hasNext == nullptr || next == nullptr) fail("Iterable 接口需要 hasNext() 和 next()");
        if (!hasNext->params.empty() || hasNext->ret != TypeKind::Boolean) fail("Iterable.hasNext 必须返回 boolean 且没有参数");
        if (!next->params.empty()) fail("Iterable.next 不能有参数");
        element.type = next->ret;
        element.typeName = next->retName;
        element.pointee = next->retPointee;
        element.volatilePointee = next->retVolatilePointee;
        element.alt = next->retAlt;
        element.altName = next->retAltName;
      }
      if (stmt.declares) {
        resolveType(stmt.type, stmt.pointee, stmt.typeName);
        repair(stmt.type, stmt.pointee, stmt.alt, stmt.typeName, stmt.altName);
        if (stmt.type == TypeKind::Void || stmt.type == TypeKind::None) fail("for-in 变量类型不对");
      } else {
        Slot* slot = find(stmt.name);
        if (slot == nullptr) fail("没有变量 " + stmt.name);
        stmt.slot = slot->index;
        stmt.type = slot->type;
        stmt.pointee = slot->pointee;
        stmt.volatilePointee = slot->volatilePointee;
        stmt.alt = slot->alt;
        stmt.typeName = slot->typeName;
        stmt.altName = slot->altName;
      }
      const bool same = element.type == stmt.type
        && element.volatilePointee == stmt.volatilePointee
        && ((stmt.type != TypeKind::Ptr && stmt.type != TypeKind::Interface) || element.typeName == stmt.typeName);
      if (!same) fail("for-in 变量类型和集合元素类型不一致");
      push();
      if (stmt.declares) {
        const int forInWords = valueWords(stmt.type, stmt.typeName);
        stmt.slot = alloc(stmt.name, stmt.type, stmt.pointee, forInWords);
        if (Slot* saved = find(stmt.name)) {
          saved->typeName = stmt.typeName;
          saved->alt = stmt.alt;
          saved->altName = stmt.altName;
        }
      }
      loops_ += 1;
      for (Stmt& inner : stmt.body) checkStmt(inner);
      loops_ -= 1;
      pop();
      return;
    }

void Checker::checkStmtDecl(Stmt& stmt) {
      if (stmt.expr.kind != Expr::Kind::LitInt || stmt.expr.type != TypeKind::None) {
        if (stmt.expr.kind != Expr::Kind::LitInt || !stmt.expr.text.empty() || stmt.expr.kids.size() > 0 || stmt.name.empty()) {
          // 有初始化式时检查；没有初始化式时 expr 是默认 LitInt 且 type 为 None。
        }
      }
      const bool hasInit = !(stmt.expr.kind == Expr::Kind::LitInt && stmt.expr.type == TypeKind::None && stmt.expr.kids.empty() && stmt.expr.integer == 0 && stmt.expr.text.empty());
      resolveType(stmt.type, stmt.pointee, stmt.typeName);
      repair(stmt.type, stmt.pointee, stmt.alt, stmt.typeName, stmt.altName);
      if (stmt.type == TypeKind::Void) fail("变量不能是 void");
      if (stmt.type == TypeKind::None) fail("没有类型 " + stmt.typeName);
      if (stmt.type == TypeKind::Struct && stmt.isStatic) fail("结构体不能是 static");
      if (stmt.type == TypeKind::Span && stmt.isStatic) fail("span 不能是 static");
      const int count = valueWords(stmt.type, stmt.typeName);
      stmt.words = count;
      if (hasInit) {
        checkExpr(stmt.expr);
        /* M-B：span 初值同结构体——只能用同类型、可给出地址的两字值（值拷贝初值）。 */
        if (stmt.type == TypeKind::Struct || stmt.type == TypeKind::Span) {
          const Expr& init = stmt.expr;
          const bool fromStruct = init.type == stmt.type && init.typeName == stmt.typeName;
          const bool addressable = init.kind == Expr::Kind::Name || init.kind == Expr::Kind::Member
            || (init.kind == Expr::Kind::Binary && init.op == Tok::LBracket)
            || init.kind == Expr::Kind::Call || init.kind == Expr::Kind::VirtualCall
            || (init.kind == Expr::Kind::Unary && init.op == Tok::Star);
          if (!fromStruct || !addressable) fail("结构体初值必须是同类型的变量、字段、下标或调用结果");
        }
        if (volatileOnlyMismatch(stmt.expr, stmt.type, stmt.typeName, stmt.pointee, stmt.volatilePointee)) {
          /* M-D：volatile↔普通指针的初值流转同样隐式拒绝。 */
          fail("volatile 指针和普通指针不能隐式互转，要显式转换");
        }
        if (!fits(stmt.expr, stmt.type, stmt.typeName, stmt.alt, stmt.altName, ParamMode::None, stmt.pointee, stmt.volatilePointee)) {
          fail(std::string("不能把 ") + typeText(stmt.expr.type, stmt.expr.typeName, stmt.expr.alt, stmt.expr.altName) + " 赋给 " + typeText(stmt.type, stmt.typeName, stmt.alt, stmt.altName));
        }
        rejectForeignEnum(stmt.typeName, stmt.type, stmt.expr.typeName, stmt.expr.type);
      }
      stmt.slot = stmt.isStatic ? allocStatic(stmt.name, stmt.type, stmt.pointee) : alloc(stmt.name, stmt.type, stmt.pointee, count);
      if (Slot* saved = find(stmt.name)) {
        saved->typeName = stmt.typeName;
        saved->volatilePointee = stmt.volatilePointee;
        saved->alt = stmt.alt;
        saved->altName = stmt.altName;
      }
      /* 带析构的所有权变量：只有 new 直接初始化的才析构（引用语义下别名析构会重复跑）。
         M2 触发点 (d)（2026-11-06）：所有权变量在帧里多占 3 个字放影子析构记录
         {对象引用, 析构函数标签, 前一条}，构造成功后压进任务栈的记录链。 */
      if (!stmt.isStatic && stmt.expr.kind == Expr::Kind::New && findClass(stmt.expr.text) != nullptr
        && findDtor(stmt.expr.text) != nullptr) {
        stmt.recordSlot = words_;
        words_ += 3;
        (*functions_)[static_cast<std::size_t>(self_)].dtorFrame = true;
      }
      return;
    }

void Checker::checkStmtSwitch(Stmt& stmt) {
      checkExpr(stmt.expr);
      const TypeKind selector = stmt.expr.type;
      if (!integral(selector)) fail("switch 的选择子必须是整数或枚举");
      push();
      std::set<long long> seen;
      bool hasDefault = false;
      for (Stmt& arm : stmt.body) {
        if (arm.kind == Stmt::Kind::Default) {
          if (hasDefault) fail("switch 只能有一个 default");
          hasDefault = true;
          switchDepth_ += 1;
          for (Stmt& inner : arm.body) checkStmt(inner);
          switchDepth_ -= 1;
          continue;
        }
        if (arm.kind != Stmt::Kind::Case) fail("switch 里只能写 case 或 default");
        Expr value = constantValue(arm.expr);
        if (value.kind != Expr::Kind::LitInt && value.kind != Expr::Kind::LitChar) {
          fail("case 值必须是整数常量");
        }
        const long long number = value.integer;
        if (selector == TypeKind::Byte && (number < 0 || number > 255)) fail("case 值超出 byte 范围");
        if (selector == TypeKind::Short && (number < std::numeric_limits<short>::min() || number > std::numeric_limits<short>::max())) fail("case 值超出 short 范围");
        if (selector == TypeKind::Int && (number < std::numeric_limits<int>::min() || number > std::numeric_limits<int>::max())) fail("case 值超出 int 范围");
        if (!seen.insert(number).second) fail("case 值重复");
        arm.expr = makeIntConstant(number, selector);
        arm.type = selector;
        switchDepth_ += 1;
        for (Stmt& inner : arm.body) checkStmt(inner);
        switchDepth_ -= 1;
      }
      pop();
      return;
    }

  /* ===== M-C：out 形参只写检查 =====
     ctx：0 = 取值位（读）、1 = 赋值目标链（写）、2 = out/ref 实参位（位置转发）。
     out 形参名只许出现在写位/位置位的链根（`x = v`、`x.字段 = v`、`&x`、转发）；
     取值位（读出、按值传参、运算）拒绝。ref 形参不进 outSlots_，读写都不拦。 */

  void Checker::checkOutUse(const Function& function) {
    outSlots_.clear();
    for (const Param& param : function.params) {
      if (param.mode == ParamMode::Out) outSlots_.insert(param.slot);
    }
    if (outSlots_.empty()) return;
    for (const Stmt& stmt : function.body) outUseStmt(stmt);
  }

  void Checker::outUseStmt(const Stmt& stmt) {
    if (stmt.kind == Stmt::Kind::ForIn && outSlots_.count(stmt.slot) != 0) {
      fail("for-in 的循环变量不能是 out 形参");
    }
    outUseExpr(stmt.expr, 0);
    for (const Stmt& inner : stmt.body) outUseStmt(inner);
    for (const Stmt& inner : stmt.other) outUseStmt(inner);
  }

  void Checker::outUseExpr(const Expr& expr, int ctx) {
    if (expr.kind == Expr::Kind::Name) {
      if (ctx == 0 && outSlots_.count(static_cast<int>(expr.integer)) != 0) fail("out 形参只能写，不能读");
      return;
    }
    if (expr.kind == Expr::Kind::Assign) {
      /* `x = v` 的目标是写位；复合赋值（+= 等）读旧值，对 out 按读拒绝。 */
      outUseExpr(expr.kids[0], expr.op == Tok::Assign ? 1 : 0);
      outUseExpr(expr.kids[1], 0);
      return;
    }
    if (expr.kind == Expr::Kind::Update) {
      outUseExpr(expr.kids[0], 0);
      return;
    }
    if (expr.kind == Expr::Kind::Unary && expr.op == Tok::BitAnd) {
      /* `&x` 给出出参指向的位置（传给 T* 形参的互调通道），不是取值。 */
      outUseExpr(expr.kids[0], 2);
      return;
    }
    if (expr.kind == Expr::Kind::Member) {
      /* 字段链（prefix = 值基址）经地址走：写位/位置位向链根传递；
         指针基址（prefix = 假）是取指针内容，按读。 */
      outUseExpr(expr.kids[0], ctx != 0 && expr.prefix ? ctx : 0);
      return;
    }
    if (expr.kind == Expr::Kind::Binary && expr.op == Tok::LBracket) {
      /* 下标链取的是元素内容（span 两字/集合引用都先读形参内容），按读。 */
      outUseExpr(expr.kids[0], 0);
      outUseExpr(expr.kids[1], 0);
      return;
    }
    if ((expr.kind == Expr::Kind::Call || expr.kind == Expr::Kind::VirtualCall) && expr.integer >= 0) {
      /* 实参位按目标形参分流：out/ref 形参收位置（转发），其余收值。 */
      const Function& target = (*functions_)[static_cast<std::size_t>(expr.integer)];
      for (std::size_t index = 0; index < expr.kids.size(); index += 1) {
        const ParamMode mode = index < target.params.size() ? target.params[index].mode : ParamMode::None;
        outUseExpr(expr.kids[index], mode == ParamMode::None ? 0 : 2);
      }
      return;
    }
    if (expr.kind == Expr::Kind::Dispatch && expr.integer >= 0) {
      outUseExpr(expr.kids[0], 0);
      const InterfaceDecl* iface = findInterface(expr.text);
      for (std::size_t index = 1; index < expr.kids.size(); index += 1) {
        ParamMode mode = ParamMode::None;
        if (iface != nullptr && expr.integer < static_cast<int>(iface->methods.size())) {
          const Function& method = iface->methods[static_cast<std::size_t>(expr.integer)];
          if (index - 1 < method.params.size()) mode = method.params[index - 1].mode;
        }
        outUseExpr(expr.kids[index], mode == ParamMode::None ? 0 : 2);
      }
      return;
    }
    if (expr.kind == Expr::Kind::New && expr.integer >= 0) {
      /* 构造实参对 params[1..]（params[0] 是 this）。 */
      const Function& target = (*functions_)[static_cast<std::size_t>(expr.integer)];
      for (std::size_t index = 0; index < expr.kids.size(); index += 1) {
        const ParamMode mode = index + 1 < target.params.size() ? target.params[index + 1].mode : ParamMode::None;
        outUseExpr(expr.kids[index], mode == ParamMode::None ? 0 : 2);
      }
      return;
    }
    for (const Expr& kid : expr.kids) outUseExpr(kid, 0);
  }

}  // namespace sema
}  // namespace obr
