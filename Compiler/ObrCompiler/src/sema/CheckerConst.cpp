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

  bool Checker::constScalar(TypeKind type) const {
    return type == TypeKind::Byte || type == TypeKind::Short || type == TypeKind::Int || type == TypeKind::Long
      || type == TypeKind::Float || type == TypeKind::Double || type == TypeKind::Boolean || type == TypeKind::Char
      || type == TypeKind::String || type == TypeKind::Struct || type == TypeKind::Ptr;
  }

  Expr Checker::makeIntConstant(long long value, TypeKind type) {
    Expr expr;
    expr.kind = Expr::Kind::LitInt;
    expr.integer = value;
    expr.type = type;
    return expr;
  }

  Expr Checker::makeFloatConstant(double value, TypeKind type) {
    Expr expr;
    expr.kind = Expr::Kind::LitFloat;
    expr.number = value;
    expr.type = type;
    return expr;
  }

  Expr Checker::makeBoolConstant(bool value) {
    Expr expr;
    expr.kind = Expr::Kind::LitBool;
    expr.integer = value ? 1 : 0;
    expr.type = TypeKind::Boolean;
    return expr;
  }

  bool Checker::constantTrue(const Expr& expr) {
    if (expr.kind == Expr::Kind::LitBool) return expr.integer != 0;
    if (expr.kind == Expr::Kind::LitInt || expr.kind == Expr::Kind::LitChar) return expr.integer != 0;
    if (expr.kind == Expr::Kind::LitFloat) return expr.number != 0.0;
    fail("常量条件必须是标量");
  }

  long long Checker::constantInteger(const Expr& expr) {
    if (expr.kind == Expr::Kind::LitInt || expr.kind == Expr::Kind::LitChar) return expr.integer;
    fail("常量这里需要整数");
  }

  double Checker::constantDouble(const Expr& expr) {
    if (expr.kind == Expr::Kind::LitFloat) return expr.number;
    if (expr.kind == Expr::Kind::LitInt || expr.kind == Expr::Kind::LitChar) return static_cast<double>(expr.integer);
    fail("常量这里需要数值");
  }

  long long Checker::wrapBits(long long value, int bits, bool signedType) {
    const unsigned long long mask = (1ULL << bits) - 1;
    const unsigned long long raw = static_cast<unsigned long long>(value) & mask;
    if (signedType && (raw & (1ULL << (bits - 1))) != 0) {
      return static_cast<long long>(raw | ~mask);
    }
    return static_cast<long long>(raw);
  }

  long long Checker::constantAsInteger(const Expr& expr) {
    if (expr.kind == Expr::Kind::LitFloat) {
      if (!std::isfinite(expr.number)) fail("浮点常量不是有限数");
      const double truncated = std::trunc(expr.number);
      if (truncated < -9223372036854775808.0 || truncated >= 9223372036854775808.0) {
        fail("浮点常量超出 64 位整数范围");
      }
      return static_cast<long long>(truncated);
    }
    return constantInteger(expr);
  }

  Expr Checker::castConstant(Expr value, TypeKind target) {
    if (target == TypeKind::Boolean) return makeBoolConstant(constantTrue(value));
    if (target == TypeKind::Float || target == TypeKind::Double) {
      return makeFloatConstant(constantDouble(value), target);
    }
    if (target == TypeKind::Long) return makeIntConstant(constantAsInteger(value), target);
    if (target == TypeKind::Int) return makeIntConstant(wrapBits(constantAsInteger(value), 32, true), target);
    if (target == TypeKind::Short) return makeIntConstant(wrapBits(constantAsInteger(value), 16, true), target);
    if (target == TypeKind::Byte) return makeIntConstant(wrapBits(constantAsInteger(value), 8, false), target);
    if (target == TypeKind::Char) {
      const long long number = wrapBits(constantAsInteger(value), 21, false);
      if (number > 0x10FFFF) fail("char 常量超出 Unicode 范围");
      return makeIntConstant(number, target);
    }
    fail("常量不支持这个转换目标");
  }

  Expr Checker::foldBinary(Tok op, const Expr& left, const Expr& right) {
    if (op == Tok::And || op == Tok::Or) {
      const bool l = constantTrue(left);
      const bool r = constantTrue(right);
      return makeBoolConstant(op == Tok::And ? (l && r) : (l || r));
    }
    if (op == Tok::Eq || op == Tok::Ne || op == Tok::Lt || op == Tok::Le || op == Tok::Gt || op == Tok::Ge) {
      if (left.type != right.type) fail("常量比较两侧类型必须相同");
      bool result = false;
      if (left.type == TypeKind::Float || left.type == TypeKind::Double) {
        const double l = constantDouble(left);
        const double r = constantDouble(right);
        if (op == Tok::Eq) result = l == r;
        else if (op == Tok::Ne) result = l != r;
        else if (op == Tok::Lt) result = l < r;
        else if (op == Tok::Le) result = l <= r;
        else if (op == Tok::Gt) result = l > r;
        else result = l >= r;
      } else if (integral(left.type) || left.type == TypeKind::Char || left.type == TypeKind::Boolean) {
        const long long l = constantInteger(left);
        const long long r = constantInteger(right);
        if (op == Tok::Eq) result = l == r;
        else if (op == Tok::Ne) result = l != r;
        else if (op == Tok::Lt) result = l < r;
        else if (op == Tok::Le) result = l <= r;
        else if (op == Tok::Gt) result = l > r;
        else result = l >= r;
      } else {
        fail("常量比较只支持数值、char 和 boolean");
      }
      return makeBoolConstant(result);
    }
    if (op == Tok::Plus && (left.type == TypeKind::String || right.type == TypeKind::String
      || left.type == TypeKind::Char || right.type == TypeKind::Char)) {
      auto textOf = [&](const Expr& value) -> std::string {
        if (value.kind == Expr::Kind::LitString) return value.text;
        if (value.kind == Expr::Kind::LitStringStatic) {
          if (value.integer < 0 || value.integer >= static_cast<long long>(unitStrings_->size())) fail("字符串常量编号越界");
          return (*unitStrings_)[static_cast<std::size_t>(value.integer)];
        }
        if (value.kind == Expr::Kind::LitChar) {
          std::string text;
          appendUtf8(text, static_cast<std::uint32_t>(value.integer));
          return text;
        }
        fail("常量字符串拼接只支持 string 和 char");
      };
      Expr out;
      out.kind = Expr::Kind::LitString;
      out.type = TypeKind::String;
      out.text = textOf(left) + textOf(right);
      return out;
    }
    if (op == Tok::BitAnd || op == Tok::BitOr || op == Tok::BitXor
      || op == Tok::Shl || op == Tok::Shr || op == Tok::UShr) {
      if (!integral(left.type) || !integral(right.type)) fail("常量位运算只能用于整数");
      const long long l = constantInteger(left);
      long long r = constantInteger(right);
      __int128 out = 0;
      if (op == Tok::Shl || op == Tok::Shr || op == Tok::UShr) {
        if (r < 0) fail("常量移位计数不能是负数");
        r %= 32;
        if (op == Tok::Shl) out = static_cast<__int128>(l) << r;
        else if (op == Tok::Shr) out = static_cast<__int128>(l) >> r;
        else out = static_cast<__int128>(static_cast<unsigned long long>(l) & 4294967295ULL) >> r;
      } else if (op == Tok::BitAnd) {
        out = l & r;
      } else if (op == Tok::BitOr) {
        out = l | r;
      } else {
        out = l ^ r;
      }
      if (out < std::numeric_limits<long long>::min() || out > std::numeric_limits<long long>::max()) {
        fail("常量位运算超出 64 位");
      }
      return makeIntConstant(static_cast<long long>(out), TypeKind::Int);
    }
    if (!numeric(left.type) || !numeric(right.type)) fail("常量算术只能用于数值");
    const TypeKind result = promote(left.type, right.type);
    if (op == Tok::Pow || result == TypeKind::Float || result == TypeKind::Double) {
      const double l = constantDouble(left);
      const double r = constantDouble(right);
      double out = 0;
      if (op == Tok::Plus) out = l + r;
      else if (op == Tok::Minus) out = l - r;
      else if (op == Tok::Star) out = l * r;
      else if (op == Tok::Slash) {
        if (r == 0.0) fail("常量除以 0");
        out = l / r;
      } else if (op == Tok::Percent) {
        if (r == 0.0) fail("常量除以 0");
        out = std::fmod(l, r);
      } else if (op == Tok::Pow) {
        out = std::pow(l, r);
      } else {
        fail("常量还不支持这个运算符");
      }
      if (!std::isfinite(out)) fail("常量浮点结果不是有限数");
      const TypeKind type = result == TypeKind::Float ? TypeKind::Float : TypeKind::Double;
      return makeFloatConstant(out, type);
    }
    const __int128 l = constantInteger(left);
    const __int128 r = constantInteger(right);
    __int128 out = 0;
    if (op == Tok::Plus) out = l + r;
    else if (op == Tok::Minus) out = l - r;
    else if (op == Tok::Star) out = l * r;
    else if (op == Tok::Slash) {
      if (r == 0) fail("常量除以 0");
      out = l / r;
    } else if (op == Tok::Percent) {
      if (r == 0) fail("常量除以 0");
      out = l % r;
    } else {
      fail("常量还不支持这个运算符");
    }
    if (out < std::numeric_limits<long long>::min() || out > std::numeric_limits<long long>::max()) {
      fail("常量整数运算超出 64 位");
    }
    long long value = static_cast<long long>(out);
    if (result == TypeKind::Byte) value = wrapBits(value, 8, false);
    return makeIntConstant(value, result);
  }

  Expr Checker::foldLayoutBuiltin(const Expr& expr) {
    /* M-A：sizeof/offsetof/alignof 的唯一求值点：普通表达式与常量上下文都从这里走，
       同一结果（Sema 期折成 LitInt(long)，零运行时、零新指令）。单位是位。 */
    if (expr.text == "offsetof") {
      if (expr.labels.size() != 1) fail("offsetof 要写成 offsetof(类型, 字段名)");
      return makeIntConstant(layoutFieldOffset(expr.type, expr.pointee, expr.typeName, expr.labels[0]), TypeKind::Long);
    }
    const long long value = expr.text == "alignof"
      ? layoutAlign(expr.type, expr.pointee, expr.typeName)
      : layoutSpan(expr.type, expr.pointee, expr.typeName);
    return makeIntConstant(value, TypeKind::Long);
  }

  long long Checker::layoutSpan(TypeKind kind, TypeKind pointee, const std::string& typeName) {
    /* 存储跨度（槽粒度）：标量/指针/引用一槽 64；struct = 字段数×64（嵌套就地展开）；
       class =（对象头 + 字段数）×64，即 new 的分配跨度（v2 含 1 字头、v1 无头）。 */
    if (kind == TypeKind::Void) fail("void 没有大小");
    if (kind == TypeKind::Struct) return static_cast<long long>(structWords(typeName)) * 64;
    /* M-B：span 是两字值（元素位地址 + 元素个数），槽跨度 2×64。 */
    if (kind == TypeKind::Span) return 128;
    if (kind == TypeKind::Ptr && !typeName.empty() && pointee != TypeKind::Void) {
      const ClassDecl* decl = findClass(typeName);
      if (decl != nullptr) return static_cast<long long>(decl->headerWords + decl->fields.size()) * 64;
      return 64;
    }
    if (kind == TypeKind::Ptr && pointee == TypeKind::Void && !typeName.empty()) {
      /* `类型*` 是指针一槽；类名/接口名本身是引用，再写 * 是非法形态。 */
      if (findClass(typeName) != nullptr) fail("类名本身就是指针 " + typeName);
      if (findInterface(typeName) != nullptr) fail("接口本身就是引用，不能再写 *");
      if (findStruct(typeName) == nullptr && findEnum(typeName) == nullptr) fail("没有类型 " + typeName);
      return 64;
    }
    if (kind == TypeKind::None && !typeName.empty()) {
      if (findStruct(typeName) != nullptr) return static_cast<long long>(structWords(typeName)) * 64;
      const ClassDecl* decl = findClass(typeName);
      if (decl != nullptr) return static_cast<long long>(decl->headerWords + decl->fields.size()) * 64;
      if (findEnum(typeName) != nullptr || findInterface(typeName) != nullptr) return 64;
      fail("没有类型 " + typeName);
    }
    if (kind == TypeKind::None) fail("sizeof 缺少类型");
    return 64;
  }

  long long Checker::alignOfDesc(TypeKind kind, TypeKind pointee, const std::string& typeName, bool object) {
    if (kind == TypeKind::Void) fail("void 没有大小");
    /* 解析期具名类型 kind=None（typeName 持名）；泛型替换后是 Struct/Ptr(类名) 等具象形态。 */
    const bool named = kind == TypeKind::None && !typeName.empty();
    const bool classRef = kind == TypeKind::Ptr && pointee != TypeKind::Void && !typeName.empty();
    if (object && (named || classRef)) {
      const ClassDecl* classDecl = findClass(typeName);
      if (classDecl != nullptr) {
        long long align = 0;
        for (const Field& field : classDecl->fields) {
          const long long width = alignOfDesc(field.type, field.pointee, field.typeName, false);
          if (width > align) align = width;
        }
        return align < 1 ? 64 : align;
      }
    }
    if (kind == TypeKind::Struct || named) {
      const StructDecl* decl = findStruct(typeName);
      if (decl != nullptr) {
        long long align = 0;
        for (const Field& field : decl->fields) {
          const long long width = alignOfDesc(field.type, field.pointee, field.typeName, false);
          if (width > align) align = width;
        }
        return align < 1 ? 64 : align;
      }
    }
    if (named) {
      const EnumDecl* enumDecl = findEnum(typeName);
      if (enumDecl != nullptr) return enumDecl->underlying == TypeKind::Long ? 64 : 32;
      if (findInterface(typeName) != nullptr) return 64;
      fail("没有类型 " + typeName);
    }
    if (kind == TypeKind::Byte || kind == TypeKind::Boolean) return 8;
    if (kind == TypeKind::Short) return 16;
    if (kind == TypeKind::Int || kind == TypeKind::Char) return 32;
    if (kind == TypeKind::Long || kind == TypeKind::Float || kind == TypeKind::Double) return 64;
    /* M-B：span 两字各 64 位，值宽度 64。 */
    if (kind == TypeKind::Span) return 64;
    if (kind == TypeKind::None) fail("alignof 缺少类型");
    return 64;
  }

  long long Checker::layoutAlign(TypeKind kind, TypeKind pointee, const std::string& typeName) {
    return alignOfDesc(kind, pointee, typeName, true);
  }

  long long Checker::layoutFieldOffset(TypeKind kind, TypeKind pointee, const std::string& typeName, const std::string& field) {
    (void)kind;
    (void)pointee;
    /* 字段位偏移；class 含对象头（与 layoutStructs/layoutClasses 的 field.offset 同一尺）。
       仅直接字段名：嵌套用两级相加 offsetof(外层, 内嵌) + offsetof(内嵌, 字段)。 */
    const StructDecl* structDecl = findStruct(typeName);
    const ClassDecl* classDecl = structDecl == nullptr ? findClass(typeName) : nullptr;
    if (structDecl == nullptr && classDecl == nullptr) fail("offsetof 只接受结构体或类");
    const std::vector<Field>& fields = structDecl != nullptr ? structDecl->fields : classDecl->fields;
    for (const Field& item : fields) {
      if (item.name == field) return item.offset;
    }
    fail("没有字段 " + field);
  }

  void Checker::prescanEnumRefs(const Expr& expr, std::vector<EnumDecl>& enums, std::map<std::string, int>& state) {
    /* 值表达式里的 `名字::值` 先让目标枚举折值（DFS）：跨枚举引用不看声明序。 */
    if (expr.kind == Expr::Kind::Name) {
      const std::size_t scope = expr.text.rfind("::");
      if (scope != std::string::npos) {
        EnumDecl* target = findEnumMut(enums, expr.text.substr(0, scope));
        if (target != nullptr) foldEnumDecl(*target, enums, state);
      }
      return;
    }
    for (const Expr& kid : expr.kids) prescanEnumRefs(kid, enums, state);
  }

  void Checker::foldEnumDecl(EnumDecl& decl, std::vector<EnumDecl>& enums, std::map<std::string, int>& state) {
    int& mark = state[decl.name];
    if (mark == 2) return;
    /* 正在折（自引用/互相成环）：交给值的 folded 标记判合法，这里不重复进入。 */
    if (mark == 1) return;
    mark = 1;
    for (EnumValue& item : decl.values) {
      if (item.hasInit) prescanEnumRefs(item.init, enums, state);
    }
    /* 同一枚举里更早的值可以用裸名引用（常量槽一进一出，不外泄作用域）。 */
    push();
    long long next = 0;
    for (EnumValue& item : decl.values) {
      if (item.hasInit) {
        const Expr value = constantValue(item.init);
        if (value.kind != Expr::Kind::LitInt && value.kind != Expr::Kind::LitChar) fail("枚举值必须是整数常量 " + item.name);
        item.value = value.integer;
        if (decl.underlying == TypeKind::Int && (item.value < -2147483648LL || item.value > 2147483647LL)) fail("枚举值超出 int");
      } else {
        if (next == 9223372036854775807LL) fail("枚举值溢出");
        item.value = next;
      }
      if (item.value == 9223372036854775807LL) fail("枚举值溢出");
      next = item.value + 1;
      item.folded = true;
      allocConst(item.name, decl.underlying, TypeKind::None, TypeKind::None, decl.name, std::string(), makeIntConstant(item.value, decl.underlying));
    }
    pop();
    mark = 2;
  }

  Expr Checker::constantValue(const Expr& source) {
    Expr expr = source;
    /* M-A：布局内建在常量上下文与普通表达式折出同一结果。 */
    if (layoutBuiltinCall(expr)) return foldLayoutBuiltin(expr);
    if (expr.kind == Expr::Kind::LitInt || expr.kind == Expr::Kind::LitFloat
      || expr.kind == Expr::Kind::LitBool || expr.kind == Expr::Kind::LitChar
      || expr.kind == Expr::Kind::LitString || expr.kind == Expr::Kind::LitStringStatic
      || expr.kind == Expr::Kind::LitNull || expr.kind == Expr::Kind::StructConst
      || expr.kind == Expr::Kind::ClassConst) {
      return expr;
    }
    if (expr.kind == Expr::Kind::Name) {
      Slot* slot = find(expr.text);
      if (slot != nullptr && slot->isConst) {
        return slot->constant;
      }
      const auto found = moduleConsts_.find(expr.text);
      if (found != moduleConsts_.end()) {
        return found->second;
      }
      if (takeEnum(expr)) return expr;
      fail("常量只能使用字面量、枚举或已定义常量 " + expr.text);
    }
    if (expr.kind == Expr::Kind::StructLiteral) {
      const StructDecl* structDecl = findStruct(expr.text);
      const ClassDecl* classDecl = structDecl == nullptr ? findClass(expr.text) : nullptr;
      if (structDecl == nullptr && classDecl == nullptr) fail("没有结构体或类 " + expr.text);
      const std::vector<Field>& fields = structDecl != nullptr ? structDecl->fields : classDecl->fields;
      const std::string kindName = structDecl != nullptr ? "结构体" : "类";
      if (expr.labels.size() != fields.size()) fail(kindName + "字面量字段不完整 " + expr.text);
      std::vector<Expr> values(fields.size());
      std::vector<bool> seen(fields.size(), false);
      for (std::size_t item = 0; item < expr.labels.size(); item += 1) {
        std::size_t target = fields.size();
        for (std::size_t field = 0; field < fields.size(); field += 1) {
          if (fields[field].name == expr.labels[item]) {
            target = field;
            break;
          }
        }
        if (target == fields.size()) fail(kindName + "字面量没有字段 " + expr.labels[item]);
        if (seen[target]) fail(kindName + "字面量字段重复 " + expr.labels[item]);
        seen[target] = true;
        const Field& field = fields[target];
        if (structDecl != nullptr && field.type == TypeKind::Struct) fail("常量结构体暂不支持嵌套结构体字段 " + field.name);
        if (classDecl != nullptr && field.type == TypeKind::Struct) fail("类字段不能内嵌结构体");
        Expr value = constantValue(expr.kids[item]);
        if (!fits(value, field.type, field.typeName, field.alt, field.altName)) {
          fail(kindName + "字面量字段类型不匹配 " + field.name);
        }
        values[target] = adaptConstant(std::move(value), field.type, field.typeName);
      }
      for (std::size_t field = 0; field < seen.size(); field += 1) {
        if (!seen[field]) fail(kindName + "字面量缺少字段 " + fields[field].name);
      }
      if (structDecl != nullptr) {
        if (unitStructs_ == nullptr) fail("结构体常量表还没有准备");
        ConstStruct item;
        item.typeName = structDecl->name;
        item.values = std::move(values);
        unitStructs_->push_back(std::move(item));
        Expr out;
        out.kind = Expr::Kind::StructConst;
        out.type = TypeKind::Struct;
        out.typeName = structDecl->name;
        out.integer = static_cast<long long>(unitStructs_->size()) - 1;
        return out;
      }
      if (unitClasses_ == nullptr) fail("类常量表还没有准备");
      ConstClass item;
      item.typeName = classDecl->name;
      item.values = std::move(values);
      unitClasses_->push_back(std::move(item));
      Expr out;
      out.kind = Expr::Kind::ClassConst;
      out.type = TypeKind::Ptr;
      out.typeName = classDecl->name;
      out.integer = static_cast<long long>(unitClasses_->size()) - 1;
      return out;
    }
    if (expr.kind == Expr::Kind::Unary && expr.kids.size() == 1) {
      Expr child = constantValue(expr.kids[0]);
      if (expr.op == Tok::Plus) {
        if (!numeric(child.type)) fail("常量一元 + 只能用于数值");
        return child;
      }
      if (expr.op == Tok::Minus) {
        if (!numeric(child.type)) fail("常量一元 - 只能用于数值");
        if (child.kind == Expr::Kind::LitFloat) child.number = -child.number;
        else {
          if (child.integer == std::numeric_limits<long long>::min()) fail("常量取负超出 64 位");
          child.integer = -child.integer;
        }
        return child;
      }
      if (expr.op == Tok::BitNot) {
        if (!integral(child.type)) fail("常量 ~ 只能用于整数");
        return makeIntConstant(~constantInteger(child), TypeKind::Int);
      }
      if (expr.op == Tok::Not) {
        return makeBoolConstant(!constantTrue(child));
      }
      fail("常量一元运算还不支持");
    }
    if (expr.kind == Expr::Kind::Binary && expr.kids.size() == 2) {
      return foldBinary(expr.op, constantValue(expr.kids[0]), constantValue(expr.kids[1]));
    }
    if (expr.kind == Expr::Kind::Ternary && expr.kids.size() == 3) {
      const Expr condition = constantValue(expr.kids[0]);
      return constantTrue(condition) ? constantValue(expr.kids[1]) : constantValue(expr.kids[2]);
    }
    if (expr.kind == Expr::Kind::Cast && expr.kids.size() == 1) {
      return castConstant(constantValue(expr.kids[0]), expr.type);
    }
    fail("常量初始化式只接受字面量、枚举、已定义常量、转换和常量运算");
  }

  Expr Checker::adaptConstant(Expr value, TypeKind type, const std::string& typeName) {
    if (type == TypeKind::Ptr) {
      if (shared_) fail("const 类在动态库里还没接");
      if (value.kind == Expr::Kind::LitNull) {
        value.type = TypeKind::Ptr;
        value.typeName = typeName;
        return value;
      }
      if (value.kind != Expr::Kind::ClassConst || value.typeName != typeName) {
        fail("类常量只能用聚合字面量、已定义类常量或 null");
      }
      value.type = TypeKind::Ptr;
      value.typeName = typeName;
      return value;
    }
    if (type == TypeKind::Struct) {
      if (shared_) fail("const 结构体在动态库里还没接");
      if (value.kind != Expr::Kind::StructConst || value.typeName != typeName) {
        fail("结构体常量只能用聚合字面量或已定义结构体常量");
      }
      value.type = TypeKind::Struct;
      value.typeName = typeName;
      return value;
    }
    if (type == TypeKind::String) {
      if (shared_) fail("const string 在动态库里还没接");
      if (value.kind == Expr::Kind::LitStringStatic) {
        value.type = TypeKind::String;
        value.typeName.clear();
        return value;
      }
      if (value.kind != Expr::Kind::LitString) fail("字符串常量初值必须是字符串字面量或已定义字符串常量");
      if (unitStrings_ == nullptr) fail("字符串常量表还没有准备");
      unitStrings_->push_back(value.text);
      value.kind = Expr::Kind::LitStringStatic;
      value.integer = static_cast<long long>(unitStrings_->size()) - 1;
      value.type = TypeKind::String;
      value.typeName.clear();
      return value;
    }
    if (type == TypeKind::Float || type == TypeKind::Double) {
      if (!numeric(value.type) && value.type != TypeKind::Char && value.type != TypeKind::Boolean) {
        fail("常量不能转成浮点");
      }
      const double number = constantDouble(value);
      if (!std::isfinite(number)) fail("浮点常量不是有限数");
      value = makeFloatConstant(number, type);
    } else if (type == TypeKind::Long) {
      value = makeIntConstant(constantInteger(value), type);
    } else if (type == TypeKind::Int) {
      const long long number = constantInteger(value);
      if (number < std::numeric_limits<int>::min() || number > std::numeric_limits<int>::max()) {
        fail("常量超出 int 范围；需要截断请显式转换");
      }
      value = makeIntConstant(number, type);
    } else if (type == TypeKind::Short) {
      const long long number = constantInteger(value);
      if (number < std::numeric_limits<short>::min() || number > std::numeric_limits<short>::max()) {
        fail("常量超出 short 范围；需要截断请显式转换");
      }
      value = makeIntConstant(number, type);
    } else if (type == TypeKind::Byte) {
      const long long number = constantInteger(value);
      if (number < 0 || number > 255) fail("常量超出 byte 范围；需要截断请显式转换");
      value = makeIntConstant(number, type);
    } else if (type == TypeKind::Char) {
      const long long number = constantInteger(value);
      if (number < 0 || number > 0x10FFFF) fail("常量超出 Unicode 范围；需要截断请显式转换");
      value = makeIntConstant(number, type);
    } else if (type == TypeKind::Boolean) {
      value = makeBoolConstant(constantTrue(value));
    } else {
      fail("常量类型不支持");
    }
    if (!typeName.empty()) value.typeName = typeName;
    return value;
  }

}  // namespace sema
}  // namespace obr
