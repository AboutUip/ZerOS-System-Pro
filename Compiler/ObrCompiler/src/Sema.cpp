#include "Sema.hpp"

#include "Diagnostic.hpp"
#include "Utf8.hpp"
#include "intrinsic/Intrinsic.hpp"
#include "type/Type.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <map>
#include <set>
#include <string>
#include <vector>

namespace obr {
namespace {

struct Slot {
  TypeKind type = TypeKind::None;
  TypeKind pointee = TypeKind::None;
  TypeKind alt = TypeKind::None;
  int index = -1;
  int words = 1;
  std::string typeName;
  std::string altName;
  bool isConst = false;
  Expr constant;
};

class Checker {
 public:
  void run(Unit& unit) {
    functions_ = &unit.functions;
    classes_ = &unit.classes;
    structs_ = &unit.structs;
    enums_ = &unit.enums;
    interfaces_ = &unit.interfaces;
    unitStrings_ = &unit.strings;
    unitStructs_ = &unit.structConstants;
    unitClasses_ = &unit.classConstants;
    shared_ = unit.shared;
    version_ = unit.version;
    if (!unit.interfaces.empty() && version_ < 2) fail("interface 需要 #VERSION 2");
    layoutEnums(unit.enums);
    loadConstants(unit.consts);
    layoutStructs(unit.structs);
    layoutInterfaces(unit.interfaces);
    resolveClassFields(unit.classes);
    layoutClasses(unit.classes);
    validateInterfaces(unit.classes);
    for (std::size_t index = 0; index < unit.classes.size(); index += 1) {
      unit.classes[index].id = unit.classes[index].headerWords > 0 ? static_cast<int>(index) + 1 : 0;
    }
    resolveSignatures();
    for (std::size_t index = 0; index < unit.functions.size(); index += 1) {
      if (!unit.functions[index].opcode.empty()) continue;
      self_ = static_cast<int>(index);
      checkFunction(unit.functions[index]);
    }
  }

 private:
  std::vector<Function>* functions_ = nullptr;
  const std::vector<ClassDecl>* classes_ = nullptr;
  const std::vector<InterfaceDecl>* interfaces_ = nullptr;
  std::vector<std::string>* unitStrings_ = nullptr;
  std::vector<ConstStruct>* unitStructs_ = nullptr;
  std::vector<ConstClass>* unitClasses_ = nullptr;
  bool shared_ = false;
  const std::vector<StructDecl>* structs_ = nullptr;
  const std::vector<EnumDecl>* enums_ = nullptr;
  std::string retName_;
  TypeKind retAlt_ = TypeKind::None;
  std::string retAltName_;
  std::vector<std::map<std::string, Slot>> scopes_;
  std::map<std::string, Expr> moduleConsts_;
  int switchDepth_ = 0;
  int version_ = 1;
  int words_ = 0;
  int staticNext_ = 0;
  int loops_ = 0;
  int self_ = 0;
  std::map<std::string, int> labels_;
  TypeKind ret_ = TypeKind::Void;

  void push() { scopes_.emplace_back(); }
  void pop() { scopes_.pop_back(); }

  Slot* find(const std::string& name) {
    for (int index = static_cast<int>(scopes_.size()) - 1; index >= 0; index -= 1) {
      auto found = scopes_[static_cast<std::size_t>(index)].find(name);
      if (found != scopes_[static_cast<std::size_t>(index)].end()) return &found->second;
    }
    return nullptr;
  }

  int alloc(const std::string& name, TypeKind type, TypeKind pointee, int count) {
    if (count < 1) fail("类型没有大小 " + name);
    if (scopes_.back().contains(name)) fail("变量重复 " + name);
    const int slot = words_;
    words_ += count;
    Slot saved;
    saved.type = type;
    saved.pointee = pointee;
    saved.index = slot;
    saved.words = count;
    scopes_.back()[name] = saved;
    return slot;
  }

  int allocStatic(const std::string& name, TypeKind type, TypeKind pointee) {
    if (scopes_.back().contains(name)) fail("变量重复 " + name);
    const int slot = -1 - staticNext_;
    staticNext_ += 1;
    Slot saved;
    saved.type = type;
    saved.pointee = pointee;
    saved.index = slot;
    scopes_.back()[name] = saved;
    return slot;
  }

  void allocConst(const std::string& name, TypeKind type, TypeKind pointee, TypeKind alt, const std::string& typeName, const std::string& altName, Expr value) {
    if (scopes_.back().contains(name)) fail("名字重复 " + name);
    Slot saved;
    saved.type = type;
    saved.pointee = pointee;
    saved.alt = alt;
    saved.typeName = typeName;
    saved.altName = altName;
    saved.index = -1;
    saved.words = 0;
    saved.isConst = true;
    saved.constant = std::move(value);
    scopes_.back()[name] = std::move(saved);
  }

  bool constScalar(TypeKind type) const {
    return type == TypeKind::Byte || type == TypeKind::Short || type == TypeKind::Int || type == TypeKind::Long
      || type == TypeKind::Float || type == TypeKind::Double || type == TypeKind::Boolean || type == TypeKind::Char
      || type == TypeKind::String || type == TypeKind::Struct || type == TypeKind::Ptr;
  }

  Expr makeIntConstant(long long value, TypeKind type) {
    Expr expr;
    expr.kind = Expr::Kind::LitInt;
    expr.integer = value;
    expr.type = type;
    return expr;
  }

  Expr makeFloatConstant(double value, TypeKind type) {
    Expr expr;
    expr.kind = Expr::Kind::LitFloat;
    expr.number = value;
    expr.type = type;
    return expr;
  }

  Expr makeBoolConstant(bool value) {
    Expr expr;
    expr.kind = Expr::Kind::LitBool;
    expr.integer = value ? 1 : 0;
    expr.type = TypeKind::Boolean;
    return expr;
  }

  bool constantTrue(const Expr& expr) {
    if (expr.kind == Expr::Kind::LitBool) return expr.integer != 0;
    if (expr.kind == Expr::Kind::LitInt || expr.kind == Expr::Kind::LitChar) return expr.integer != 0;
    if (expr.kind == Expr::Kind::LitFloat) return expr.number != 0.0;
    fail("常量条件必须是标量");
  }

  long long constantInteger(const Expr& expr) {
    if (expr.kind == Expr::Kind::LitInt || expr.kind == Expr::Kind::LitChar) return expr.integer;
    fail("常量这里需要整数");
  }

  double constantDouble(const Expr& expr) {
    if (expr.kind == Expr::Kind::LitFloat) return expr.number;
    if (expr.kind == Expr::Kind::LitInt || expr.kind == Expr::Kind::LitChar) return static_cast<double>(expr.integer);
    fail("常量这里需要数值");
  }

  long long wrapBits(long long value, int bits, bool signedType) {
    const unsigned long long mask = (1ULL << bits) - 1;
    const unsigned long long raw = static_cast<unsigned long long>(value) & mask;
    if (signedType && (raw & (1ULL << (bits - 1))) != 0) {
      return static_cast<long long>(raw | ~mask);
    }
    return static_cast<long long>(raw);
  }

  long long constantAsInteger(const Expr& expr) {
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

  Expr castConstant(Expr value, TypeKind target) {
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

  Expr foldBinary(Tok op, const Expr& left, const Expr& right) {
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

  Expr constantValue(const Expr& source) {
    Expr expr = source;
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

  Expr adaptConstant(Expr value, TypeKind type, const std::string& typeName) {
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

  void loadConstants(const std::vector<ConstDecl>& decls) {
    for (const ConstDecl& original : decls) {
      ConstDecl decl = original;
      resolveType(decl.type, decl.pointee, decl.typeName);
      repair(decl.type, decl.pointee, decl.alt, decl.typeName, decl.altName);
      if (!constScalar(decl.type)) fail("const 只支持标量或 string " + decl.name);
      Expr value = constantValue(decl.expr);
      if (!fits(value, decl.type, decl.typeName, decl.alt, decl.altName)) {
        fail("常量 " + decl.name + " 的初值类型不匹配");
      }
      rejectForeignEnum(decl.typeName, decl.type, value.typeName, value.type);
      value = adaptConstant(std::move(value), decl.type, decl.typeName);
      moduleConsts_[decl.name] = std::move(value);
    }
  }

  void resolveSignatures() {
    for (Function& function : *functions_) {
      resolveType(function.ret, function.retPointee, function.retName);
      if (function.ret == TypeKind::Struct) fail("结构体不能作为返回值");
      if (function.ret == TypeKind::None) fail("没有类型 " + function.retName);
      for (Param& param : function.params) {
        resolveType(param.type, param.pointee, param.typeName);
        if (param.type == TypeKind::Void) fail("参数不能是 void");
        if (param.type == TypeKind::Struct) fail("结构体不能作为参数 " + param.name);
        if (param.type == TypeKind::None) fail("没有类型 " + param.typeName);
      }
    }
  }

  void checkFunction(Function& function) {
    scopes_.clear();
    push();
    words_ = 1;
    loops_ = 0;
    resolveType(function.ret, function.retPointee, function.retName);
    if (function.ret == TypeKind::Struct) fail("结构体不能作为返回值");
    if (function.ret == TypeKind::None) fail("没有类型 " + function.retName);
    repair(function.ret, function.retPointee, function.retAlt, function.retName, function.retAltName);
    ret_ = function.ret;
    retName_ = function.retName;
    retAlt_ = function.retAlt;
    retAltName_ = function.retAltName;
    labels_.clear();
    collectLabels(function.body);
    for (Param& param : function.params) {
      resolveType(param.type, param.pointee, param.typeName);
      if (param.type == TypeKind::Void) fail("参数不能是 void");
      if (param.type == TypeKind::Struct) fail("结构体不能作为参数 " + param.name);
      if (param.type == TypeKind::None) fail("没有类型 " + param.typeName);
      repair(param.type, param.pointee, param.alt, param.typeName, param.altName);
      param.slot = alloc(param.name, param.type, param.pointee, 1);
      if (Slot* saved = find(param.name)) {
        saved->typeName = param.typeName;
        saved->alt = param.alt;
        saved->altName = param.altName;
      }
    }
    for (Stmt& stmt : function.body) checkStmt(stmt);
    function.words = words_;
    pop();
  }

  void collectLabels(const std::vector<Stmt>& body) {
    for (const Stmt& stmt : body) {
      if (stmt.kind == Stmt::Kind::Label) {
        if (stmt.name.empty() || !labelText(stmt.name)) fail("标号只能由字母和数字组成 " + stmt.name);
        if (!labels_.insert({stmt.name, 1}).second) fail("标号重复 " + stmt.name);
      }
      if (stmt.kind == Stmt::Kind::Block || stmt.kind == Stmt::Kind::While || stmt.kind == Stmt::Kind::For || stmt.kind == Stmt::Kind::ForIn) collectLabels(stmt.body);
      if (stmt.kind == Stmt::Kind::For) collectLabels(stmt.other);
      if (stmt.kind == Stmt::Kind::If) {
        collectLabels(stmt.body);
        collectLabels(stmt.other);
      }
    }
  }

  void layoutClasses(std::vector<ClassDecl>& classes) {
    std::map<std::string, int> state;
    const auto layoutOne = [&](auto&& self, ClassDecl& decl) -> void {
      const int mark = state[decl.name];
      if (mark == 2) return;
      if (mark == 1) fail("继承成环 " + decl.name);
      state[decl.name] = 1;
      decl.headerWords = version_ >= 2 ? 1 : 0;
      std::vector<Field> parentFields;
      if (!decl.base.empty()) {
        ClassDecl* parent = nullptr;
        for (ClassDecl& item : classes) {
          if (item.name == decl.base) parent = &item;
        }
        if (parent == nullptr) fail("没有基类 " + decl.base);
        self(self, *parent);
        parentFields = parent->fields;
        for (const std::string& name : parent->interfaces) {
          if (std::find(decl.interfaces.begin(), decl.interfaces.end(), name) == decl.interfaces.end()) {
            decl.interfaces.push_back(name);
          }
        }
      }
      std::vector<Field> merged = parentFields;
      for (Field& field : decl.fields) {
        for (const Field& earlier : merged) {
          if (earlier.name == field.name) fail("字段重复 " + field.name);
        }
        field.offset = (decl.headerWords + static_cast<int>(merged.size())) * 64;
        merged.push_back(field);
      }
      decl.fields = std::move(merged);
      state[decl.name] = 2;
    };
    for (ClassDecl& decl : classes) layoutOne(layoutOne, decl);
  }

  const ClassDecl* findClass(const std::string& name) const {
    if (classes_ == nullptr) return nullptr;
    for (const ClassDecl& decl : *classes_) {
      if (decl.name == name) return &decl;
    }
    return nullptr;
  }

  const InterfaceDecl* findInterface(const std::string& name) const {
    if (interfaces_ == nullptr) return nullptr;
    for (const InterfaceDecl& decl : *interfaces_) {
      if (decl.name == name) return &decl;
    }
    return nullptr;
  }

  bool classImplements(const std::string& className, const std::string& interfaceName) const {
    const ClassDecl* decl = findClass(className);
    while (decl != nullptr) {
      for (const std::string& item : decl->interfaces) {
        if (item == interfaceName) return true;
      }
      decl = decl->base.empty() ? nullptr : findClass(decl->base);
    }
    return false;
  }

  /* 类引用可以当基类引用用：沿基类链向上找。派生类的 this 传给基类方法的
     隐式 this 参数就是这条转换；没有它，派生类里调用继承方法会解析失败。 */
  bool classDerivesFrom(const std::string& child, const std::string& parent) const {
    if (child.empty() || parent.empty() || child == parent) return false;
    const ClassDecl* decl = findClass(child);
    while (decl != nullptr) {
      if (decl->base == parent) return true;
      decl = decl->base.empty() ? nullptr : findClass(decl->base);
    }
    return false;
  }

  bool sameMethodSignature(const Function& impl, const Function& iface) const {
    if (impl.params.size() != iface.params.size() + 1) return false;
    if (impl.ret != iface.ret || impl.retName != iface.retName) return false;
    for (std::size_t index = 0; index < iface.params.size(); index += 1) {
      const Param& left = impl.params[index + 1];
      const Param& right = iface.params[index];
      if (left.type != right.type || left.typeName != right.typeName) return false;
    }
    return true;
  }

  bool findImplementation(const std::string& className, const Function& method) const {
    const ClassDecl* decl = findClass(className);
    while (decl != nullptr) {
      for (const Function& function : *functions_) {
        if (function.owner != decl->name) continue;
        if (shortFunctionName(function.name) != shortFunctionName(method.name)) continue;
        if (sameMethodSignature(function, method)) return true;
      }
      decl = decl->base.empty() ? nullptr : findClass(decl->base);
    }
    return false;
  }

  void layoutInterfaces(std::vector<InterfaceDecl>& interfaces) {
    for (InterfaceDecl& decl : interfaces) {
      std::set<std::string> names;
      for (Function& method : decl.methods) {
        const std::string name = shortFunctionName(method.name);
        resolveType(method.ret, method.retPointee, method.retName);
        repair(method.ret, method.retPointee, method.retAlt, method.retName, method.retAltName);
        if (method.ret == TypeKind::Struct) fail("接口方法不能返回结构体 " + decl.name + "::" + name);
        std::string key = name + "(";
        for (Param& param : method.params) {
          resolveType(param.type, param.pointee, param.typeName);
          repair(param.type, param.pointee, param.alt, param.typeName, param.altName);
          if (param.type == TypeKind::Void || param.type == TypeKind::Struct) fail("接口方法参数类型不对 " + decl.name + "::" + name);
          if (key.back() != '(') key += ",";
          key += typeText(param.type, param.typeName, param.alt, param.altName);
        }
        key += ")";
        /* 返回类型不参与区分。参数相同就是同一个方法，不能靠返回类型再写一份。 */
        if (!names.insert(key).second) fail("接口方法重复 " + decl.name + "::" + name);
      }
    }
  }

  void validateInterfaces(const std::vector<ClassDecl>& classes) {
    for (const ClassDecl& decl : classes) {
      if (decl.interfaces.empty()) continue;
      if (decl.headerWords == 0) fail("实现接口的类需要 #VERSION 2");
      std::set<std::string> seen;
      for (const std::string& name : decl.interfaces) {
        if (!seen.insert(name).second) fail("接口重复 " + decl.name + " implements " + name);
        const InterfaceDecl* iface = findInterface(name);
        if (iface == nullptr) fail("没有接口 " + name);
        for (const Function& method : iface->methods) {
          if (findImplementation(decl.name, method)) continue;
          fail("类 " + decl.name + " 没有实现接口方法 " + name + "::" + shortFunctionName(method.name));
        }
      }
    }
  }

  const StructDecl* findStruct(const std::string& name) const {
    if (structs_ == nullptr) return nullptr;
    for (const StructDecl& decl : *structs_) {
      if (decl.name == name) return &decl;
    }
    return nullptr;
  }

  StructDecl* findStructMut(std::vector<StructDecl>& structs, const std::string& name) {
    for (StructDecl& decl : structs) {
      if (decl.name == name) return &decl;
    }
    return nullptr;
  }

  const EnumDecl* findEnum(const std::string& name) const {
    if (enums_ == nullptr) return nullptr;
    for (const EnumDecl& decl : *enums_) {
      if (decl.name == name) return &decl;
    }
    return nullptr;
  }

  int structWords(const std::string& name) const {
    const StructDecl* decl = findStruct(name);
    if (decl == nullptr || decl->words < 1) fail("没有结构体 " + name);
    return decl->words;
  }

  // 类名、结构体名、枚举名都先写成名字。类名解析成指针，结构体解析成值，枚举解析成底层整数并保留枚举名。
  // 名字后面的 * 在解析阶段把 pointee 标成 Void，用来和已经解析过的类指针区分。
  void resolveType(TypeKind& kind, TypeKind& pointee, const std::string& typeName) {
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

  TypeKind kindOfName(const std::string& name) {
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
    if (!name.empty() && name.back() == '*') return TypeKind::Ptr;
    if (const EnumDecl* decl = findEnum(name)) return decl->underlying;
    if (findStruct(name) != nullptr) fail("结构体不能放进集合");
    if (findClass(name) != nullptr) return TypeKind::Ptr;
    if (findInterface(name) != nullptr) return TypeKind::Interface;
    fail("集合里没有类型 " + name);
  }

  std::string unwrap(const std::string& desc) const {
    const std::size_t open = desc.find('[');
    if (open == std::string::npos || desc.back() != ']') fail("集合类型不完整");
    return desc.substr(open + 1, desc.size() - open - 2);
  }

  void splitMap(const std::string& inner, std::string& key, std::string& value) const {
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

  void validateDesc(const std::string& desc) {
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

  void repair(TypeKind kind, TypeKind& pointee, TypeKind& alt, std::string& typeName, std::string& altName) {
    if (!collection(kind)) return;
    validateDesc(typeName);
    pointee = kindOfName(typeName);
    if (kind == TypeKind::Map) {
      validateDesc(altName);
      alt = kindOfName(altName);
    }
  }

  void fillDesc(Expr& expr, const std::string& desc) {
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
    if (findEnum(desc) != nullptr || findClass(desc) != nullptr) expr.typeName = desc;
    if (expr.type == TypeKind::Ptr && desc.size() > 1 && desc.back() == '*') expr.typeName = desc.substr(0, desc.size() - 1);
  }

  bool sameCollection(const Expr& expr, TypeKind kind, const std::string& typeName, const std::string& altName) const {
    return expr.type == kind && expr.typeName == typeName && expr.altName == altName;
  }

  bool fits(const Expr& expr, TypeKind kind, const std::string& typeName, TypeKind alt, const std::string& altName) const {
    (void)alt;
    if (kind == TypeKind::Struct) return expr.type == TypeKind::Struct && expr.typeName == typeName;
    if (kind == TypeKind::Ptr) {
      if (expr.kind == Expr::Kind::LitNull) return true;
      if (expr.type != TypeKind::Ptr) return false;
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

  /* 完全匹配看类型名，不看返回类型。Foo* 和 Bar* 都是指针，不能算成同一个候选。 */
  bool identicalArg(const Expr& expr, const Param& param) const {
    return expr.type == param.type && expr.typeName == param.typeName && expr.pointee == param.pointee && expr.alt == param.alt && expr.altName == param.altName;
  }

  /* 完全匹配优先。没有完全匹配时，只有一个可加宽的候选才选用。多个可加宽由调用方报歧义。 */
  int pickOverload(const Function& self, const std::string& name, const std::vector<Expr>& args, int& widenedCount) const {
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
        if (!fits(args[param], want.type, want.typeName, want.alt, want.altName)) fit = false;
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

  void layoutEnums(const std::vector<EnumDecl>& enums) {
    for (const EnumDecl& decl : enums) {
      if (decl.underlying != TypeKind::Int && decl.underlying != TypeKind::Long) fail("枚举底层类型只能是 int 或 long");
      if (decl.values.empty()) fail("枚举至少要有一个值");
    }
  }

  void layoutStructs(std::vector<StructDecl>& structs) {
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
        } else {
          field.words = 1;
        }
        field.offset = words * 64;
        words += field.words;
      }
      if (words < 1) fail("结构体至少要有一个字段 " + decl.name);
      decl.words = words;
      state[decl.name] = 2;
    };
    for (StructDecl& decl : structs) layoutOne(layoutOne, decl);
  }

  void resolveClassFields(std::vector<ClassDecl>& classes) {
    for (ClassDecl& decl : classes) {
      for (Field& field : decl.fields) {
        resolveType(field.type, field.pointee, field.typeName);
        repair(field.type, field.pointee, field.alt, field.typeName, field.altName);
        if (field.type == TypeKind::Struct) fail("类字段不能内嵌结构体 " + field.name);
        if (field.type == TypeKind::Void || field.type == TypeKind::None) fail("字段类型不对 " + field.name);
      }
    }
  }

  void rejectForeignEnum(const std::string& destName, TypeKind dest, const std::string& srcName, TypeKind src) const {
    if (destName.empty() || srcName.empty() || destName == srcName) return;
    if (!integral(dest) || !integral(src)) return;
    if (findEnum(destName) != nullptr && findEnum(srcName) != nullptr) fail("枚举类型不同");
  }

  bool takeEnum(Expr& expr) {
    const std::size_t scope = expr.text.rfind("::");
    if (scope == std::string::npos) return false;
    const std::string typeName = expr.text.substr(0, scope);
    const std::string valueName = expr.text.substr(scope + 2);
    const EnumDecl* decl = findEnum(typeName);
    if (decl == nullptr) return false;
    for (const EnumValue& item : decl->values) {
      if (item.name != valueName) continue;
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

  void checkStmt(Stmt& stmt) {
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
        stmt.alt = slot->alt;
        stmt.typeName = slot->typeName;
        stmt.altName = slot->altName;
      }
      const bool same = element.type == stmt.type
        && ((stmt.type != TypeKind::Ptr && stmt.type != TypeKind::Interface) || element.typeName == stmt.typeName);
      if (!same) fail("for-in 变量类型和集合元素类型不一致");
      push();
      if (stmt.declares) {
        stmt.slot = alloc(stmt.name, stmt.type, stmt.pointee, 1);
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
    if (stmt.kind == Stmt::Kind::Switch) {
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
    if (stmt.kind == Stmt::Kind::Fallthrough) {
      if (switchDepth_ == 0) fail("fallthrough 只能写在 switch 的 case 里");
      return;
    }
    if (stmt.kind == Stmt::Kind::Decl) {
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
      if (stmt.type == TypeKind::Struct && hasInit) fail("结构体不能写初值，请给字段赋值");
      const int count = stmt.type == TypeKind::Struct ? structWords(stmt.typeName) : 1;
      stmt.words = count;
      if (hasInit) {
        checkExpr(stmt.expr);
        if (!fits(stmt.expr, stmt.type, stmt.typeName, stmt.alt, stmt.altName)) {
          fail(std::string("不能把 ") + typeText(stmt.expr.type, stmt.expr.typeName, stmt.expr.alt, stmt.expr.altName) + " 赋给 " + typeText(stmt.type, stmt.typeName, stmt.alt, stmt.altName));
        }
        rejectForeignEnum(stmt.typeName, stmt.type, stmt.expr.typeName, stmt.expr.type);
      }
      stmt.slot = stmt.isStatic ? allocStatic(stmt.name, stmt.type, stmt.pointee) : alloc(stmt.name, stmt.type, stmt.pointee, count);
      if (Slot* saved = find(stmt.name)) {
        saved->typeName = stmt.typeName;
        saved->alt = stmt.alt;
        saved->altName = stmt.altName;
      }
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
      if (!fits(stmt.expr, ret_, retName_, retAlt_, retAltName_)) {
        fail(std::string("返回类型是 ") + typeText(stmt.expr.type, stmt.expr.typeName, stmt.expr.alt, stmt.expr.altName) + "，函数要求 " + typeText(ret_, retName_, retAlt_, retAltName_));
      }
      rejectForeignEnum(retName_, ret_, stmt.expr.typeName, stmt.expr.type);
      return;
    }
    if (stmt.kind == Stmt::Kind::Expr) checkExpr(stmt.expr);
  }

  void checkExpr(Expr& expr) {
    if (expr.kind == Expr::Kind::StructLiteral) fail("结构体/类字面量只能用于 const");
    if (expr.kind == Expr::Kind::StructConst || expr.kind == Expr::Kind::ClassConst) return;
    if (expr.kind == Expr::Kind::LitInt || expr.kind == Expr::Kind::LitFloat || expr.kind == Expr::Kind::LitBool || expr.kind == Expr::Kind::LitChar || expr.kind == Expr::Kind::LitString || expr.kind == Expr::Kind::LitNull || expr.kind == Expr::Kind::LitUndefined) return;
    if (expr.kind == Expr::Kind::Name) {
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
      expr.alt = slot->alt;
      expr.typeName = slot->typeName;
      expr.altName = slot->altName;
      expr.integer = slot->index;
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
          if (!fits(expr.kids[param], want.type, want.typeName, want.alt, want.altName)) fit = false;
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
      expr.integer = chosen;
      return;
    }
    if (expr.kind == Expr::Kind::Member) {
      checkExpr(expr.kids[0]);
      const bool aggregate = expr.kids[0].type == TypeKind::Struct;
      const bool structPointer = expr.kids[0].type == TypeKind::Ptr && expr.kids[0].pointee == TypeKind::Struct;
      if (aggregate || structPointer) {
        const StructDecl* decl = findStruct(expr.kids[0].typeName);
        if (decl == nullptr) fail("没有结构体 " + expr.kids[0].typeName);
        expr.prefix = aggregate;
        for (const Field& field : decl->fields) {
          if (field.name != expr.text) continue;
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
    if (expr.kind == Expr::Kind::Call) {
      for (Expr& argument : expr.kids) checkExpr(argument);
      if (expr.integer == -4 && !expr.kids.empty() && collection(expr.kids[0].type)) {
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
      if (expr.integer == -4 && !expr.kids.empty() && expr.kids[0].type == TypeKind::Interface) {
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
            if (!fits(expr.kids[param + 1], want.type, want.typeName, want.alt, want.altName)) fit = false;
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
        if (methodIndex < 0) fail(widenedCount > 1 ? "接口方法有多个匹配 " + expr.text : "接口 " + iface->name + " 没有匹配的方法 " + expr.text);
        const Function& method = iface->methods[static_cast<std::size_t>(methodIndex)];
        expr.kind = Expr::Kind::Dispatch;
        expr.text = iface->name;
        expr.integer = methodIndex;
        expr.type = method.ret;
        expr.typeName = method.retName;
        expr.pointee = method.retPointee;
        expr.alt = method.retAlt;
        expr.altName = method.retAltName;
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
      if (chosen < 0) fail(widenedCount > 1 ? "调用 " + expr.text + " 有多个可加宽的函数" : "没有函数 " + expr.text);
      const Function& target = (*functions_)[static_cast<std::size_t>(chosen)];
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
      expr.integer = chosen;
      expr.type = (*functions_)[static_cast<std::size_t>(chosen)].ret;
      expr.typeName = (*functions_)[static_cast<std::size_t>(chosen)].retName;
      expr.pointee = (*functions_)[static_cast<std::size_t>(chosen)].retPointee;
      expr.alt = (*functions_)[static_cast<std::size_t>(chosen)].retAlt;
      expr.altName = (*functions_)[static_cast<std::size_t>(chosen)].retAltName;
      return;
    }
    if (expr.kind == Expr::Kind::Cast) {
      checkExpr(expr.kids[0]);
      resolveType(expr.type, expr.pointee, expr.typeName);
      const TypeKind source = expr.kids[0].type;
      const TypeKind target = expr.type;
      if (target == TypeKind::Ptr) {
        if (source != TypeKind::Ptr && !integral(source)) fail("指针转换的来源必须是整数或指针");
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
      expr.alt = TypeKind::None;
      expr.typeName.clear();
      expr.altName.clear();
      return;
    }
    if (expr.kind == Expr::Kind::Unary) {
      checkExpr(expr.kids[0]);
      if (expr.op == Tok::BitAnd) {
        if (expr.kids[0].kind != Expr::Kind::Name) fail("& 只能取变量的地址");
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
    if (expr.kind == Expr::Kind::Update) {
      checkExpr(expr.kids[0]);
      if (expr.kids[0].kind != Expr::Kind::Name) fail("++ 和 -- 只能用于变量");
      if (!numeric(expr.kids[0].type)) fail("++ 和 -- 只能用于数值");
      expr.type = expr.kids[0].type;
      return;
    }
    if (expr.kind == Expr::Kind::Assign) {
      checkExpr(expr.kids[0]);
      checkExpr(expr.kids[1]);
      const bool index = expr.kids[0].kind == Expr::Kind::Binary && expr.kids[0].op == Tok::LBracket;
      if (expr.kids[0].kind != Expr::Kind::Name && expr.kids[0].kind != Expr::Kind::Member && !index && !(expr.kids[0].kind == Expr::Kind::Unary && expr.kids[0].op == Tok::Star)) fail("赋值的左边必须是变量、字段、下标或 *指针");
      if (index && expr.kids[0].kids[0].type != TypeKind::Array && expr.kids[0].kids[0].type != TypeKind::List) fail("只有 array 和 list 能按下标赋值");
      if (expr.op == Tok::Assign) {
        const TypeKind dest = expr.kids[0].type;
        if (dest == TypeKind::Struct || expr.kids[1].type == TypeKind::Struct) {
          if (dest != TypeKind::Struct || expr.kids[1].type != TypeKind::Struct || expr.kids[0].typeName != expr.kids[1].typeName) fail("结构体赋值必须是同一类型");
          if (expr.kids[0].kind != Expr::Kind::Name || expr.kids[1].kind != Expr::Kind::Name) fail("结构体整值赋值只接受变量");
        } else if (!fits(expr.kids[1], dest, expr.kids[0].typeName, expr.kids[0].alt, expr.kids[0].altName) && !(dest == TypeKind::Ptr && integral(expr.kids[1].type))) {
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
    if (expr.kind == Expr::Kind::Ternary) {
      checkExpr(expr.kids[0]);
      checkExpr(expr.kids[1]);
      checkExpr(expr.kids[2]);
      if (expr.kids[0].type == TypeKind::Void || expr.kids[1].type == TypeKind::Void || expr.kids[2].type == TypeKind::Void) fail("三元表达式不能是 void");
      if (expr.kids[1].type != expr.kids[2].type) fail("三元表达式的两个分支类型必须相同");
      expr.type = expr.kids[1].type;
      return;
    }
    checkExpr(expr.kids[0]);
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
      if ((collection(left) && (rightNull || sameCollection(expr.kids[1], left, expr.kids[0].typeName, expr.kids[0].altName))) || (collection(right) && leftNull)) {
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
};

}  // namespace

void check(Unit& unit) { Checker{}.run(unit); }

std::string paramSignature(const Function& function) {
  std::string text = function.name + "(";
  for (std::size_t index = 0; index < function.params.size(); index += 1) {
    if (index > 0) text += ",";
    const Param& param = function.params[index];
    text += typeText(param.type, param.typeName, param.alt, param.altName);
  }
  text += ")";
  return text;
}

std::string signatureOf(const Function& function) {
  return paramSignature(function) + ":" + typeText(function.ret, function.retName, function.retAlt, function.retAltName);
}

bool sameSignature(const Function& left, const Function& right) { return signatureOf(left) == signatureOf(right); }

bool alreadyVisible(const Function& function, int index) {
  for (const int item : function.visible) {
    if (item == index) return true;
  }
  return false;
}

bool linkAllows(const std::vector<std::string>& links, const std::string& caller) {
  if (links.empty()) return true;
  std::string name = caller;
  const std::size_t slash = name.find_last_of("/\\");
  if (slash != std::string::npos) name = name.substr(slash + 1);
  const std::string logical = "/" + name;
  for (const std::string& item : links) {
    if (item == "/") return true;
    if (item == logical) return true;
  }
  return false;
}

bool findClassName(const Unit& unit, const std::string& name) {
  for (const ClassDecl& decl : unit.classes) {
    if (decl.name == name) return true;
  }
  return false;
}

bool findStructName(const Unit& unit, const std::string& name) {
  for (const StructDecl& decl : unit.structs) {
    if (decl.name == name) return true;
  }
  return false;
}

bool findEnumName(const Unit& unit, const std::string& name) {
  for (const EnumDecl& decl : unit.enums) {
    if (decl.name == name) return true;
  }
  return false;
}

bool findInterfaceName(const Unit& unit, const std::string& name) {
  for (const InterfaceDecl& decl : unit.interfaces) {
    if (decl.name == name) return true;
  }
  return false;
}

bool typeTaken(const Unit& unit, const std::string& name) {
  return findClassName(unit, name) || findStructName(unit, name) || findEnumName(unit, name) || findInterfaceName(unit, name);
}

Unit combine(std::vector<SourceFile> sources, const std::vector<HeaderFile>& headers) {
  Unit unit;
  bool sawVersion1 = false;
  bool sawVersion2 = false;
  for (const SourceFile& source : sources) {
    if (source.version == 1) sawVersion1 = true;
    else if (source.version == 2) sawVersion2 = true;
    else fail("#VERSION 只接受语言版本 1 或 2");
  }
  if (sawVersion1 && sawVersion2) fail("同一个编译单元不能混用 #VERSION 1 和 #VERSION 2");
  unit.version = sawVersion2 ? 2 : 1;
  auto addConstant = [&](const ConstDecl& decl) {
    for (const ConstDecl& earlier : unit.consts) {
      if (earlier.name == decl.name) fail("常量重复 " + decl.name);
    }
    unit.consts.push_back(decl);
  };
  for (const HeaderFile& header : headers) {
    for (const ConstDecl& decl : header.consts) addConstant(decl);
  }
  for (const SourceFile& source : sources) {
    for (const InterfaceDecl& decl : source.interfaces) {
      if (typeTaken(unit, decl.name)) fail("类型重复 " + decl.name);
      unit.interfaces.push_back(decl);
    }
    for (const ClassDecl& decl : source.classes) {
      if (typeTaken(unit, decl.name)) fail("类型重复 " + decl.name);
      unit.classes.push_back(decl);
    }
    for (const StructDecl& decl : source.structs) {
      if (typeTaken(unit, decl.name)) fail("类型重复 " + decl.name);
      unit.structs.push_back(decl);
    }
    for (const EnumDecl& decl : source.enums) {
      if (typeTaken(unit, decl.name)) fail("类型重复 " + decl.name);
      unit.enums.push_back(decl);
    }
    for (const ConstDecl& decl : source.consts) addConstant(decl);
  }
  for (const HeaderFile& header : headers) {
    for (const StructDecl& decl : header.structs) {
      if (typeTaken(unit, decl.name)) fail("类型重复 " + decl.name);
      unit.structs.push_back(decl);
    }
    for (const EnumDecl& decl : header.enums) {
      if (typeTaken(unit, decl.name)) fail("类型重复 " + decl.name);
      unit.enums.push_back(decl);
    }
  }
  for (SourceFile& source : sources) {
    std::map<std::string, int> seen;
    for (Function& function : source.functions) {
      function.origin = source.path;
      function.links = source.links;
      bindOpcode(function);
      /* 返回类型不参与重载。参数类型或个数不同才是另一份函数。 */
      const std::string key = paramSignature(function);
      if (!seen.insert({key, 1}).second) fail("函数重复 " + function.name);
      if (!source.imports.empty()) {
        int matches = 0;
        for (const std::string& imported : source.imports) {
          const HeaderFile* header = nullptr;
          for (const HeaderFile& item : headers) {
            if (item.name == imported) header = &item;
          }
          if (header == nullptr) fail("没有头文件 " + imported);
          for (const Function& decl : header->decls) {
            if (sameSignature(decl, function)) matches += 1;
          }
        }
        if (matches > 1) fail("函数头重复 " + function.name);
      }
      unit.functions.push_back(std::move(function));
    }
  }
  for (const HeaderFile& header : headers) {
    for (const Function& decl : header.decls) {
      const bool opcode = opcodeSpec(decl.name) != nullptr;
      const bool library = libraryFunction(decl);
      bool wanted = false;
      if (!opcode && !library) {
        for (const SourceFile& source : sources) {
          if (!source.dyn) continue;
          for (const std::string& imported : source.imports) {
            if (imported == header.name) wanted = true;
          }
        }
        if (!wanted) continue;
      }
      bool defined = false;
      for (const Function& function : unit.functions) {
        if (sameSignature(function, decl)) defined = true;
      }
      if (defined) {
        if (opcode || library) fail(library ? "库函数不能再写函数体 " + decl.name : "指令不能再写函数体 " + decl.name);
        continue;
      }
      Function function = decl;
      function.origin = header.name;
      if (library) function.opcode = "library";
      else if (opcode) bindOpcode(function);
      else function.imported = true;
      unit.functions.push_back(std::move(function));
    }
  }
  for (std::size_t index = 0; index < unit.functions.size(); index += 1) {
    Function& function = unit.functions[index];
    for (std::size_t other = 0; other < unit.functions.size(); other += 1) {
      const Function& candidate = unit.functions[other];
      if (candidate.origin == function.origin) {
        function.visible.push_back(static_cast<int>(other));
        continue;
      }
      const SourceFile* source = nullptr;
      for (const SourceFile& item : sources) {
        if (item.path == function.origin) source = &item;
      }
      if (source == nullptr) continue;
      for (const std::string& imported : source->imports) {
        for (const HeaderFile& header : headers) {
          if (header.name != imported) continue;
          for (const Function& decl : header.decls) {
            if (sameSignature(decl, candidate) && !alreadyVisible(function, static_cast<int>(other)) && linkAllows(candidate.links, function.origin)) {
              function.visible.push_back(static_cast<int>(other));
            }
          }
        }
      }
    }
  }
  return unit;
}

}  // namespace obr
