#include "Sema.hpp"

#include "Diagnostic.hpp"
#include "intrinsic/Intrinsic.hpp"
#include "type/Type.hpp"

#include <map>
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
};

class Checker {
 public:
  void run(Unit& unit) {
    functions_ = &unit.functions;
    classes_ = &unit.classes;
    structs_ = &unit.structs;
    enums_ = &unit.enums;
    layoutEnums(unit.enums);
    layoutStructs(unit.structs);
    resolveClassFields(unit.classes);
    layoutClasses(unit.classes);
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
  const std::vector<StructDecl>* structs_ = nullptr;
  const std::vector<EnumDecl>* enums_ = nullptr;
  std::string retName_;
  TypeKind retAlt_ = TypeKind::None;
  std::string retAltName_;
  std::vector<std::map<std::string, Slot>> scopes_;
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
      if (stmt.kind == Stmt::Kind::Block || stmt.kind == Stmt::Kind::While || stmt.kind == Stmt::Kind::For) collectLabels(stmt.body);
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
      std::vector<Field> parentFields;
      if (!decl.base.empty()) {
        ClassDecl* parent = nullptr;
        for (ClassDecl& item : classes) {
          if (item.name == decl.base) parent = &item;
        }
        if (parent == nullptr) fail("没有基类 " + decl.base);
        self(self, *parent);
        parentFields = parent->fields;
      }
      std::vector<Field> merged = parentFields;
      for (Field& field : decl.fields) {
        for (const Field& earlier : merged) {
          if (earlier.name == field.name) fail("字段重复 " + field.name);
        }
        field.offset = static_cast<int>(merged.size()) * 64;
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
    if (collection(kind)) {
      if (expr.kind == Expr::Kind::LitNull) return true;
      return sameCollection(expr, kind, typeName, altName);
    }
    return expr.type == kind || canWiden(expr.type, kind);
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
    if (stmt.kind == Stmt::Kind::Break || stmt.kind == Stmt::Kind::Continue) {
      if (loops_ < 1) fail("break 和 continue 只能写在循环里");
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
    if (expr.kind == Expr::Kind::LitInt || expr.kind == Expr::Kind::LitFloat || expr.kind == Expr::Kind::LitBool || expr.kind == Expr::Kind::LitChar || expr.kind == Expr::Kind::LitString || expr.kind == Expr::Kind::LitNull || expr.kind == Expr::Kind::LitUndefined) return;
    if (expr.kind == Expr::Kind::Name) {
      Slot* slot = find(expr.text);
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
          const TypeKind want = function.params[param + 1].type;
          const TypeKind have = expr.kids[param].type;
          if (have != want) same = false;
          if (have != want && !canWiden(have, want)) fit = false;
        }
        if (same) exact = static_cast<int>(index);
        else if (fit) {
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
      if (expr.integer == -4) {
        if (expr.kids.empty() || expr.kids[0].typeName.empty()) fail("成员调用的对象没有类");
        expr.text = expr.kids[0].typeName + "::" + expr.text;
      }
      const Function& self = (*functions_)[static_cast<std::size_t>(self_)];
      int exact = -1;
      int widened = -1;
      int widenedCount = 0;
      for (const int index : self.visible) {
        const Function& function = (*functions_)[static_cast<std::size_t>(index)];
        if (function.name != expr.text || function.params.size() != expr.kids.size()) continue;
        bool same = true;
        bool fit = true;
        for (std::size_t param = 0; param < function.params.size(); param += 1) {
          const TypeKind want = function.params[param].type;
          const TypeKind have = expr.kids[param].type;
          if (have != want) same = false;
          if (have != want && !canWiden(have, want)) fit = false;
        }
        if (same) {
          if (exact >= 0) fail("调用 " + expr.text + " 有多个完全匹配");
          exact = index;
        } else if (fit) {
          widened = index;
          widenedCount += 1;
        }
      }
      int chosen = exact >= 0 ? exact : widenedCount == 1 ? widened : -1;
      if (chosen < 0 && !self.owner.empty() && expr.text.find("::") == std::string::npos && expr.integer != -4) {
        Expr object;
        object.kind = Expr::Kind::Name;
        object.text = "this";
        checkExpr(object);
        expr.kids.insert(expr.kids.begin(), std::move(object));
        expr.text = self.owner + "::" + expr.text;
        exact = -1;
        widened = -1;
        widenedCount = 0;
        for (const int index : self.visible) {
          const Function& function = (*functions_)[static_cast<std::size_t>(index)];
          if (function.name != expr.text || function.params.size() != expr.kids.size()) continue;
          bool same = true;
          bool fit = true;
          for (std::size_t param = 0; param < function.params.size(); param += 1) {
            const TypeKind want = function.params[param].type;
            const TypeKind have = expr.kids[param].type;
            if (have != want) same = false;
            if (have != want && !canWiden(have, want)) fit = false;
          }
          if (same) exact = index;
          else if (fit) {
            widened = index;
            widenedCount += 1;
          }
        }
        chosen = exact >= 0 ? exact : widenedCount == 1 ? widened : -1;
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
            exact = -1;
            widened = -1;
            widenedCount = 0;
            for (const int index : self.visible) {
              const Function& function = (*functions_)[static_cast<std::size_t>(index)];
              if (function.name != expr.text || function.params.size() != expr.kids.size()) continue;
              bool same = true;
              bool fit = true;
              for (std::size_t param = 0; param < function.params.size(); param += 1) {
                const TypeKind want = function.params[param].type;
                const TypeKind have = expr.kids[param].type;
                if (have != want) same = false;
                if (have != want && !canWiden(have, want)) fit = false;
              }
              if (same) exact = index;
              else if (fit) {
                widened = index;
                widenedCount += 1;
              }
            }
            chosen = exact >= 0 ? exact : widenedCount == 1 ? widened : -1;
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
      if (expr.type != TypeKind::Ptr) fail("这一版只把整数转成指针");
      if (!integral(expr.kids[0].type) && expr.kids[0].type != TypeKind::Long) fail("指针转换的来源必须是整数");
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

std::string signatureOf(const Function& function) {
  std::string text = function.name + "(";
  for (std::size_t index = 0; index < function.params.size(); index += 1) {
    if (index > 0) text += ",";
    const Param& param = function.params[index];
    text += typeText(param.type, param.typeName, param.alt, param.altName);
  }
  text += "):";
  text += typeText(function.ret, function.retName, function.retAlt, function.retAltName);
  return text;
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

bool typeTaken(const Unit& unit, const std::string& name) {
  return findClassName(unit, name) || findStructName(unit, name) || findEnumName(unit, name);
}

Unit combine(std::vector<SourceFile> sources, const std::vector<HeaderFile>& headers) {
  Unit unit;
  for (const SourceFile& source : sources) {
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
      if (function.exported) {
        for (const char unit : function.name) {
          if (unit == ':') fail("导出的函数名不能带 ::");
        }
      }
      function.links = source.links;
      bindOpcode(function);
      const std::string key = signatureOf(function);
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
