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

  int Checker::structWords(const std::string& name) const {
    const StructDecl* decl = findStruct(name);
    if (decl == nullptr || decl->words < 1) fail("没有结构体 " + name);
    return decl->words;
  }

  void Checker::resolveType(TypeKind& kind, TypeKind& pointee, const std::string& typeName) {
    if (typeName.empty()) {
      if (kind == TypeKind::None) fail("缺少类型");
      return;
    }
    if (kind != TypeKind::None && kind != TypeKind::Ptr) return;
    if (kind == TypeKind::Ptr && pointee != TypeKind::Void && pointee != TypeKind::None) return;
    const bool wroteStar = kind == TypeKind::Ptr && pointee == TypeKind::Void;
    if (findInterface(typeName) != nullptr) {
      if (wroteStar) fail("接口本身就是引用，不能再写 *");
      kind = TypeKind::Interface;
      pointee = TypeKind::None;
      return;
    }
    if (const EnumDecl* decl = findEnum(typeName)) {
      if (wroteStar) {
        pointee = decl->underlying;
        return;
      }
      if (kind == TypeKind::Ptr) return;
      kind = decl->underlying;
      return;
    }
    if (findStruct(typeName) != nullptr) {
      if (wroteStar) {
        pointee = TypeKind::Struct;
        return;
      }
      if (kind == TypeKind::Ptr) return;
      kind = TypeKind::Struct;
      return;
    }
    if (findClass(typeName) != nullptr) {
      if (wroteStar) fail("类名本身就是指针 " + typeName);
      if (kind == TypeKind::Ptr) return;
      kind = TypeKind::Ptr;
      pointee = TypeKind::None;
      return;
    }
    fail("没有类型 " + typeName);
  }

  TypeKind Checker::kindOfName(const std::string& name) {
    if (name == "byte") return TypeKind::Byte;
    if (name == "short") return TypeKind::Short;
    if (name == "int") return TypeKind::Int;
    if (name == "long") return TypeKind::Long;
    if (name == "float") return TypeKind::Float;
    if (name == "double") return TypeKind::Double;
    if (name == "boolean") return TypeKind::Boolean;
    if (name == "char") return TypeKind::Char;
    if (name == "string") return TypeKind::String;
    if (name.rfind("array[", 0) == 0) return TypeKind::Array;
    if (name.rfind("list[", 0) == 0) return TypeKind::List;
    if (name.rfind("set[", 0) == 0) return TypeKind::Set;
    if (name.rfind("map[", 0) == 0) return TypeKind::Map;
    if (name.rfind("span[", 0) == 0) return TypeKind::Span;
    if (!name.empty() && name.back() == '*') return TypeKind::Ptr;
    if (const EnumDecl* decl = findEnum(name)) return decl->underlying;
    if (findStruct(name) != nullptr) return TypeKind::Struct;
    if (findClass(name) != nullptr) return TypeKind::Ptr;
    if (findInterface(name) != nullptr) return TypeKind::Interface;
    if (name.find('<') != std::string::npos) return TypeKind::Ptr;
    fail("集合里没有类型 " + name);
  }

  std::string Checker::unwrap(const std::string& desc) const {
    const std::size_t open = desc.find('[');
    if (open == std::string::npos || desc.back() != ']') fail("集合类型不完整");
    return desc.substr(open + 1, desc.size() - open - 2);
  }

  void Checker::splitMap(const std::string& inner, std::string& key, std::string& value) const {
    int depth = 0;
    for (std::size_t index = 0; index < inner.size(); index += 1) {
      const char unit = inner[index];
      if (unit == '[') depth += 1;
      else if (unit == ']') depth -= 1;
      else if (unit == ',' && depth == 0) {
        key = inner.substr(0, index);
        value = inner.substr(index + 1);
        return;
      }
    }
    fail("map 要写成 map[键, 值]");
  }

  void Checker::validateDesc(const std::string& desc) {
    /* M-B：槽密度区不用 span——集合元素不能是 span（元素槽是一字，span 是两字值）。 */
    if (desc.rfind("span[", 0) == 0) fail("集合元素不能是 span");
    if (desc.rfind("array[", 0) == 0 || desc.rfind("list[", 0) == 0 || desc.rfind("set[", 0) == 0) {
      validateDesc(unwrap(desc));
      return;
    }
    if (desc.rfind("map[", 0) == 0) {
      std::string key;
      std::string value;
      splitMap(unwrap(desc), key, value);
      validateDesc(key);
      validateDesc(value);
      return;
    }
    (void)kindOfName(desc);
  }

  /* M-B：span[T] 元素类型 = 八位组区值宽度（M-A alignof）定得死的形态：标量、指针（含类
     引用与 `T*`）、枚举（底层 int/long）。string/集合/结构体/接口/void/嵌套 span 拒绝——
     那些是槽密度或引用语义，raw 区读出没有单一值宽度。 */
  void Checker::validateSpan(TypeKind& pointee, const std::string& desc) {
    if (desc.empty()) fail("span 缺少元素类型");
    if (desc == "void" || desc.rfind("array[", 0) == 0 || desc.rfind("list[", 0) == 0
      || desc.rfind("set[", 0) == 0 || desc.rfind("map[", 0) == 0 || desc.rfind("span[", 0) == 0) {
      fail("span 的元素类型只接受标量和指针");
    }
    pointee = kindOfName(desc);
    if (pointee == TypeKind::String || pointee == TypeKind::Struct || pointee == TypeKind::Interface
      || pointee == TypeKind::Void || collection(pointee) || pointee == TypeKind::Span) {
      fail("span 的元素类型只接受标量和指针");
    }
  }

  void Checker::repair(TypeKind kind, TypeKind& pointee, TypeKind& alt, std::string& typeName, std::string& altName) {
    if (kind == TypeKind::Span) {
      validateSpan(pointee, typeName);
      return;
    }
    if (!collection(kind)) return;
    validateDesc(typeName);
    pointee = kindOfName(typeName);
    if (kind == TypeKind::Map) {
      validateDesc(altName);
      alt = kindOfName(altName);
    }
  }

  void Checker::fillDesc(Expr& expr, const std::string& desc) {
    /* M-D：`volatile T*` 的描述带前缀（describe 往返）；位记在 volatilePointee 上，
       标量点类型与 parseType 同形（pointee 记值、typeName 留空）。 */
    if (desc.rfind("volatile ", 0) == 0) {
      fillDesc(expr, desc.substr(9));
      expr.volatilePointee = true;
      if (expr.type == TypeKind::Ptr && expr.pointee == TypeKind::None && !expr.typeName.empty()) {
        const std::string pointeeName = expr.typeName;
        if (pointeeName == "byte" || pointeeName == "short" || pointeeName == "int" || pointeeName == "long"
          || pointeeName == "float" || pointeeName == "double" || pointeeName == "boolean" || pointeeName == "char") {
          expr.pointee = kindOfName(pointeeName);
          expr.typeName.clear();
        }
      }
      return;
    }
    /* M-B：span[元素]（typeName 是元素描述，与集合同一形状）。 */
    if (desc.rfind("span[", 0) == 0 && desc.back() == ']') {
      expr.type = TypeKind::Span;
      expr.typeName = unwrap(desc);
      expr.pointee = kindOfName(expr.typeName);
      expr.alt = TypeKind::None;
      expr.altName.clear();
      return;
    }
    if (desc.rfind("array[", 0) == 0 || desc.rfind("list[", 0) == 0 || desc.rfind("set[", 0) == 0 || desc.rfind("map[", 0) == 0) {
      if (desc.rfind("array[", 0) == 0) expr.type = TypeKind::Array;
      else if (desc.rfind("list[", 0) == 0) expr.type = TypeKind::List;
      else if (desc.rfind("set[", 0) == 0) expr.type = TypeKind::Set;
      else expr.type = TypeKind::Map;
      if (expr.type == TypeKind::Map) {
        splitMap(unwrap(desc), expr.typeName, expr.altName);
        expr.pointee = kindOfName(expr.typeName);
        expr.alt = kindOfName(expr.altName);
      } else {
        expr.typeName = unwrap(desc);
        expr.pointee = kindOfName(expr.typeName);
        expr.alt = TypeKind::None;
        expr.altName.clear();
      }
      return;
    }
    expr.alt = TypeKind::None;
    expr.altName.clear();
    expr.pointee = TypeKind::None;
    if (findInterface(desc) != nullptr) {
      expr.type = TypeKind::Interface;
      expr.typeName = desc;
      return;
    }
    expr.type = kindOfName(desc);
    expr.typeName.clear();
    if (findEnum(desc) != nullptr || findClass(desc) != nullptr || findStruct(desc) != nullptr) expr.typeName = desc;
    if (expr.type == TypeKind::Ptr && desc.size() > 1 && desc.back() == '*') expr.typeName = desc.substr(0, desc.size() - 1);
  }

  bool Checker::sameCollection(const Expr& expr, TypeKind kind, const std::string& typeName, const std::string& altName) const {
    return expr.type == kind && expr.typeName == typeName && expr.altName == altName;
  }

  bool Checker::fits(const Expr& expr, TypeKind kind, const std::string& typeName, TypeKind alt, const std::string& altName, ParamMode mode, TypeKind pointee, bool volatilePointee) const {
    (void)alt;
    /* M-C：out/ref 形参收可赋值左值，且类型逐位一致（写回通道不放宽、不加宽）。
       非指针类型不看 expr.pointee（`*p` 的 pointee 字段是历史口径噪声）；
       指针类型看 pointee（裸 `long*` / `string*` 靠它区分）。
       M-D：volatile 位逐位一致——volatile↔普通指针隐式互转拒绝，显式转换才放行。 */
    if (mode != ParamMode::None) {
      const bool pointeeOk = kind != TypeKind::Ptr
        || (expr.pointee == pointee && expr.volatilePointee == volatilePointee);
      return assignableLValue(expr) && expr.type == kind && expr.typeName == typeName
        && pointeeOk && expr.alt == alt && expr.altName == altName;
    }
    if (kind == TypeKind::Struct) return expr.type == TypeKind::Struct && expr.typeName == typeName;
    /* M-B：span 值只按同元素描述收（两字值语义同结构体）。 */
    if (kind == TypeKind::Span) return expr.type == TypeKind::Span && expr.typeName == typeName;
    if (kind == TypeKind::Ptr) {
      if (expr.kind == Expr::Kind::LitNull) return true;
      if (expr.type != TypeKind::Ptr) return false;
      /* M-D：volatile↔普通指针隐式互转拒绝；都是 volatile 时点类型逐位一致（不放宽）。 */
      if (expr.volatilePointee != volatilePointee) return false;
      if (volatilePointee && (expr.pointee != pointee || expr.typeName != typeName)) return false;
      if (typeName.empty() || expr.typeName == typeName) return true;
      /* 类引用（Ptr + 类名）可以传给基类参数；裸指针没有类名，不放宽。 */
      return classDerivesFrom(expr.typeName, typeName);
    }
    if (collection(kind)) {
      if (expr.kind == Expr::Kind::LitNull) return true;
      return sameCollection(expr, kind, typeName, altName);
    }
    if (kind == TypeKind::Interface) {
      if (expr.kind == Expr::Kind::LitNull) return true;
      if (expr.type == TypeKind::Interface) return expr.typeName == typeName;
      if (expr.type == TypeKind::Ptr) return classImplements(expr.typeName, typeName);
      return false;
    }
    return expr.type == kind || canWiden(expr.type, kind);
  }

  bool Checker::identicalArg(const Expr& expr, const Param& param) const {
    /* M-C：out/ref 形参的实参必须是可赋值左值；`f(out long)` 与 `f(long)` 是两个函数
       （同一左值两个都精确匹配时按多义拒绝，见 bad-out-overload）。
       M-D：volatile 位参与逐位比对。 */
    if (param.mode != ParamMode::None) {
      if (!assignableLValue(expr) || volatileDeref(expr)) return false;
      const bool pointeeOk = param.type != TypeKind::Ptr
        || (expr.pointee == param.pointee && expr.volatilePointee == param.volatilePointee);
      return expr.type == param.type && expr.typeName == param.typeName && pointeeOk
        && expr.alt == param.alt && expr.altName == param.altName;
    }
    return expr.type == param.type && expr.typeName == param.typeName && expr.pointee == param.pointee
      && expr.volatilePointee == param.volatilePointee && expr.alt == param.alt && expr.altName == param.altName;
  }

  /* M-D：只差 volatile 位的指针流转（隐式互转）——调用点给专门诊断后拒绝。
     显式转换（`volatile T*` ↔ `T*` 同点类型）才放行，见 checkExprCast。 */
  bool Checker::volatileOnlyMismatch(const Expr& expr, TypeKind kind, const std::string& typeName, TypeKind pointee, bool volatilePointee) const {
    return kind == TypeKind::Ptr && expr.type == TypeKind::Ptr && expr.kind != Expr::Kind::LitNull
      && expr.volatilePointee != volatilePointee && expr.pointee == pointee && expr.typeName == typeName;
  }

  /* M-D：volatile 指针的解引用不走出参通道（out/ref 的写回是普通 store，会丢 volatile 语义）。 */
  bool Checker::volatileDeref(const Expr& expr) const {
    return expr.kind == Expr::Kind::Unary && expr.op == Tok::Star && !expr.kids.empty() && expr.kids[0].volatilePointee;
  }

  /* M-C：候选里有 out/ref 形参、对应实参却不是可赋值左值时，给专门诊断
     （不然只报「没有函数」，字面量当出参看不出错在哪）。 */
  void Checker::rejectOutArgShapes(const std::string& name, const std::vector<Expr>& args) const {
    for (const Function& function : *functions_) {
      if (function.name != name || function.params.size() != args.size()) continue;
      for (std::size_t index = 0; index < args.size(); index += 1) {
        if (function.params[index].mode != ParamMode::None && !assignableLValue(args[index])) {
          fail("out/ref 形参的实参必须是可赋值左值");
        }
        /* M-D：volatile 解引用不走出参通道（写回是普通 store，会丢 volatile 语义）。 */
        if (function.params[index].mode != ParamMode::None && volatileDeref(args[index])) {
          fail("volatile 解引用不能当 out/ref 实参");
        }
      }
    }
  }

  int Checker::pickOverload(const Function& self, const std::string& name, const std::vector<Expr>& args, int& widenedCount) const {
    int exact = -1;
    int widened = -1;
    widenedCount = 0;
    for (const int index : self.visible) {
      const Function& function = (*functions_)[static_cast<std::size_t>(index)];
      if (function.name != name || function.params.size() != args.size()) continue;
      bool same = true;
      bool fit = true;
      for (std::size_t param = 0; param < function.params.size(); param += 1) {
        const Param& want = function.params[param];
        if (!identicalArg(args[param], want)) same = false;
        if (!fits(args[param], want.type, want.typeName, want.alt, want.altName, want.mode, want.pointee, want.volatilePointee)) fit = false;
      }
      if (same) {
        if (exact >= 0) fail("调用 " + name + " 有多个完全匹配");
        exact = index;
      } else if (fit) {
        widened = index;
        widenedCount += 1;
      }
    }
    if (exact >= 0) return exact;
    if (widenedCount == 1) return widened;
    return -1;
  }

  void Checker::layoutEnums(std::vector<EnumDecl>& enums) {
    for (const EnumDecl& decl : enums) {
      if (decl.underlying != TypeKind::Int && decl.underlying != TypeKind::Long) fail("枚举底层类型只能是 int 或 long");
      if (decl.values.empty()) fail("枚举至少要有一个值");
    }
    /* M-A：枚举值放开到常量表达式（`enum { A = sizeof(long) }`）——解析期只存初始化式，
       这里按声明序经 constantValue 折值；值表达式引用的其它枚举先折（DFS，成环拒绝）。 */
    std::map<std::string, int> state;
    for (EnumDecl& decl : enums) foldEnumDecl(decl, enums, state);
  }

  void Checker::layoutStructs(std::vector<StructDecl>& structs) {
    std::map<std::string, int> state;
    const auto layoutOne = [&](auto&& self, StructDecl& decl) -> void {
      const int mark = state[decl.name];
      if (mark == 2) return;
      if (mark == 1) fail("结构体成环 " + decl.name);
      state[decl.name] = 1;
      int words = 0;
      for (Field& field : decl.fields) {
        resolveType(field.type, field.pointee, field.typeName);
        repair(field.type, field.pointee, field.alt, field.typeName, field.altName);
        if (field.type == TypeKind::Void || field.type == TypeKind::None) fail("字段类型不对 " + field.name);
        if (field.type == TypeKind::Struct) {
          StructDecl* nested = findStructMut(structs, field.typeName);
          if (nested == nullptr) fail("没有结构体 " + field.typeName);
          self(self, *nested);
          field.words = nested->words;
        } else if (field.type == TypeKind::Span) {
          /* M-B：span 字段是两字（元素位地址 + 元素个数）。 */
          field.words = 2;
        } else {
          field.words = 1;
        }
        field.owner = decl.name;
        field.offset = words * 64;
        words += field.words;
      }
      if (words < 1) fail("结构体至少要有一个字段 " + decl.name);
      decl.words = words;
      state[decl.name] = 2;
    };
    for (StructDecl& decl : structs) layoutOne(layoutOne, decl);
  }

  void Checker::resolveClassFields(std::vector<ClassDecl>& classes) {
    for (ClassDecl& decl : classes) {
      for (Field& field : decl.fields) {
        resolveType(field.type, field.pointee, field.typeName);
        repair(field.type, field.pointee, field.alt, field.typeName, field.altName);
        if (field.type == TypeKind::Struct) fail("类字段不能内嵌结构体 " + field.name);
        /* M-B：span 是两字值，类字段是一字槽（同结构体不内嵌）。 */
        if (field.type == TypeKind::Span) fail("类字段不能内嵌 span " + field.name);
        if (field.type == TypeKind::Void || field.type == TypeKind::None) fail("字段类型不对 " + field.name);
      }
    }
  }

  void Checker::rejectForeignEnum(const std::string& destName, TypeKind dest, const std::string& srcName, TypeKind src) const {
    if (destName.empty() || srcName.empty() || destName == srcName) return;
    if (!integral(dest) || !integral(src)) return;
    if (findEnum(destName) != nullptr && findEnum(srcName) != nullptr) fail("枚举类型不同");
  }

  bool Checker::takeEnum(Expr& expr) {
    const std::size_t scope = expr.text.rfind("::");
    if (scope == std::string::npos) return false;
    const std::string typeName = expr.text.substr(0, scope);
    const std::string valueName = expr.text.substr(scope + 2);
    const EnumDecl* decl = findEnum(typeName);
    if (decl == nullptr) return false;
    for (const EnumValue& item : decl->values) {
      if (item.name != valueName) continue;
      /* M-A：折值期间只认已折完的值（`名字::值` 成环时这里是假，明确报错而不是读未定值）。 */
      if (!item.folded) fail("枚举值循环引用 " + typeName + "::" + valueName);
      expr.kind = Expr::Kind::LitInt;
      expr.integer = item.value;
      expr.type = decl->underlying;
      expr.typeName = decl->name;
      expr.text.clear();
      expr.kids.clear();
      return true;
    }
    fail("没有枚举值 " + valueName);
  }

}  // namespace sema
}  // namespace obr
