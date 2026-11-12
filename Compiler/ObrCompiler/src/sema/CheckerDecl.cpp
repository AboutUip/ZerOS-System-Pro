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

  Stmt Checker::makeDtorCallStmt(const Function& dtor, int line) {
    Stmt call;
    call.kind = Stmt::Kind::Expr;
    call.line = line;
    Expr expr;
    expr.kind = Expr::Kind::Call;
    expr.text = dtor.name;
    Expr selfRef;
    selfRef.kind = Expr::Kind::Name;
    selfRef.text = "this";
    expr.kids.push_back(std::move(selfRef));
    call.expr = std::move(expr);
    return call;
  }

  void Checker::insertBaseDtorCalls(std::vector<Stmt>& body, const Function& baseDtor, const Function& self) {
    for (std::size_t index = 0; index < body.size(); index += 1) {
      Stmt& stmt = body[index];
      if (stmt.kind == Stmt::Kind::Return) {
        Stmt call = makeDtorCallStmt(baseDtor, self.line);
        checkStmt(call);
        body.insert(body.begin() + static_cast<std::ptrdiff_t>(index), std::move(call));
        index += 1;
        continue;
      }
      if (stmt.kind == Stmt::Kind::Block) insertBaseDtorCalls(stmt.body, baseDtor, self);
      else if (stmt.kind == Stmt::Kind::If) {
        insertBaseDtorCalls(stmt.body, baseDtor, self);
        insertBaseDtorCalls(stmt.other, baseDtor, self);
      } else if (stmt.kind == Stmt::Kind::While || stmt.kind == Stmt::Kind::ForIn) {
        insertBaseDtorCalls(stmt.body, baseDtor, self);
      } else if (stmt.kind == Stmt::Kind::For) {
        insertBaseDtorCalls(stmt.body, baseDtor, self);
        insertBaseDtorCalls(stmt.other, baseDtor, self);
      } else if (stmt.kind == Stmt::Kind::Switch) {
        for (Stmt& arm : stmt.body) insertBaseDtorCalls(arm.body, baseDtor, self);
      }
    }
    if (body.empty() || body.back().kind != Stmt::Kind::Return) {
      Stmt call = makeDtorCallStmt(baseDtor, self.line);
      checkStmt(call);
      body.push_back(std::move(call));
    }
  }

  void Checker::rejectBaseDtorCallsInExpr(const Expr& expr, const Function& self) {
    if (expr.kind == Expr::Kind::Call && expr.integer >= 0) {
      const Function& target = (*functions_)[static_cast<std::size_t>(expr.integer)];
      if (target.destruct && classDerivesFrom(self.owner, target.owner)) fail("析构不能自己调用基类析构 " + self.name);
    }
    for (const Expr& kid : expr.kids) rejectBaseDtorCallsInExpr(kid, self);
  }

  void Checker::rejectBaseDtorCalls(const std::vector<Stmt>& body, const Function& self) {
    for (const Stmt& stmt : body) {
      rejectBaseDtorCallsInExpr(stmt.expr, self);
      rejectBaseDtorCalls(stmt.body, self);
      rejectBaseDtorCalls(stmt.other, self);
    }
  }

  void Checker::layoutClasses(std::vector<ClassDecl>& classes) {
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
        field.owner = decl.name;
        field.offset = (decl.headerWords + static_cast<int>(merged.size())) * 64;
        merged.push_back(field);
      }
      decl.fields = std::move(merged);
      state[decl.name] = 2;
    };
    for (ClassDecl& decl : classes) layoutOne(layoutOne, decl);
  }

  const ClassDecl* Checker::findClass(const std::string& name) const {
    if (classes_ == nullptr) return nullptr;
    for (const ClassDecl& decl : *classes_) {
      if (decl.name == name) return &decl;
    }
    return nullptr;
  }

  const InterfaceDecl* Checker::findInterface(const std::string& name) const {
    if (interfaces_ == nullptr) return nullptr;
    for (const InterfaceDecl& decl : *interfaces_) {
      if (decl.name == name) return &decl;
    }
    return nullptr;
  }

  bool Checker::classImplements(const std::string& className, const std::string& interfaceName) const {
    const ClassDecl* decl = findClass(className);
    while (decl != nullptr) {
      for (const std::string& item : decl->interfaces) {
        if (item == interfaceName) return true;
      }
      decl = decl->base.empty() ? nullptr : findClass(decl->base);
    }
    return false;
  }

  bool Checker::classDerivesFrom(const std::string& child, const std::string& parent) const {
    if (child.empty() || parent.empty() || child == parent) return false;
    const ClassDecl* decl = findClass(child);
    while (decl != nullptr) {
      if (decl->base == parent) return true;
      decl = decl->base.empty() ? nullptr : findClass(decl->base);
    }
    return false;
  }

  bool Checker::sameOverrideSignature(const Function& left, const Function& right) const {
    if (left.ret != right.ret || left.retName != right.retName || left.retPointee != right.retPointee
      || left.retVolatilePointee != right.retVolatilePointee) return false;
    if (left.fails != right.fails) return false;
    if (left.params.size() != right.params.size()) return false;
    for (std::size_t index = 1; index < left.params.size(); index += 1) {
      const Param& a = left.params[index];
      const Param& b = right.params[index];
      /* M-C：out/ref 修饰词参与覆盖签名比对。M-D：volatile 位同参。 */
      if (a.type != b.type || a.typeName != b.typeName || a.pointee != b.pointee
        || a.volatilePointee != b.volatilePointee || a.mode != b.mode) return false;
    }
    return true;
  }

  bool Checker::isConstructor(const Function& fn) const {
    return !fn.owner.empty() && shortFunctionName(fn.name) == fn.owner;
  }

  bool Checker::isCtorChainCall(const Function& ctor, const Stmt& stmt) const {
    if (stmt.kind != Stmt::Kind::Expr) return false;
    const Expr& expr = stmt.expr;
    if (expr.kind != Expr::Kind::Call || expr.integer < 0) return false;
    const Function& target = (*functions_)[static_cast<std::size_t>(expr.integer)];
    if (!isConstructor(target)) return false;
    const ClassDecl* self = findClass(ctor.owner);
    std::string cursor = self == nullptr ? std::string() : self->base;
    while (!cursor.empty()) {
      if (target.owner == cursor) return true;
      const ClassDecl* next = findClass(cursor);
      cursor = next == nullptr ? std::string() : next->base;
    }
    return false;
  }

  void Checker::validateOverrides() {
    for (const Function& fn : *functions_) {
      if (!fn.overwrite) continue;
      if (fn.owner.empty()) fail("@Overwrite 只能写在类方法前 " + fn.name);
      if (version_ < 2) fail("@Overwrite 需要 #VERSION 2");
      if (isConstructor(fn)) fail("@Overwrite 不能写在构造上 " + fn.name);
      if (fn.destruct) fail("@Overwrite 和 @Destruct 不能写在同一个方法上 " + fn.name);
      bool matched = false;
      bool sawName = false;
      const ClassDecl* decl = findClass(fn.owner);
      std::string cursor = decl == nullptr ? std::string() : decl->base;
      while (!cursor.empty() && !matched) {
        for (const Function& base : *functions_) {
          if (base.owner != cursor) continue;
          if (shortFunctionName(base.name) != shortFunctionName(fn.name)) continue;
          sawName = true;
          if (sameOverrideSignature(base, fn)) {
            if (isConstructor(base)) fail("构造不能被覆盖 " + fn.name);
            if (base.destruct) fail("析构不能被覆盖 " + fn.name);
            matched = true;
          }
        }
        const ClassDecl* next = findClass(cursor);
        cursor = next == nullptr ? std::string() : next->base;
      }
      if (!matched) fail(sawName ? "覆盖签名不一致 " + fn.name : "没有可覆盖的方法 " + fn.name);
    }
  }

  bool Checker::virtualSlot(const Function& target) const {
    if (target.owner.empty()) return false;
    for (const Function& fn : *functions_) {
      if (!fn.overwrite) continue;
      if (shortFunctionName(fn.name) != shortFunctionName(target.name)) continue;
      if (!sameOverrideSignature(fn, target)) continue;
      if (classDerivesFrom(fn.owner, target.owner)) return true;
    }
    return false;
  }

  std::string Checker::accessorName() const {
    if (self_ < 0 || self_ >= static_cast<int>(functions_->size())) return std::string();
    return (*functions_)[static_cast<std::size_t>(self_)].owner;
  }

  void Checker::checkFieldAccess(const Field& field) {
    if (!field.isPrivate) return;
    const std::string accessor = accessorName();
    if (!accessor.empty() && accessor == field.owner) return;
    const ClassDecl* decl = field.owner.empty() ? nullptr : findClass(field.owner);
    if (decl != nullptr) {
      for (const std::string& name : decl->friends) {
        if (name == accessor) return;
      }
    }
    for (const std::string& name : field.friends) {
      if (name == accessor) return;
    }
    fail("访问私有成员 " + (field.owner.empty() ? std::string("?") : field.owner) + "::" + field.name);
  }

  void Checker::checkMethodAccess(const Function& target) {
    if (!target.isPrivate || target.owner.empty()) return;
    const std::string accessor = accessorName();
    if (!accessor.empty() && accessor == target.owner) return;
    const ClassDecl* decl = findClass(target.owner);
    if (decl != nullptr) {
      for (const std::string& name : decl->friends) {
        if (name == accessor) return;
      }
    }
    for (const std::string& name : target.friends) {
      if (name == accessor) return;
    }
    fail("访问私有成员 " + target.owner + "::" + shortFunctionName(target.name));
  }

  const Function* Checker::findDtor(const std::string& className) const {
    std::string cursor = className;
    while (!cursor.empty()) {
      for (const Function& fn : *functions_) {
        if (fn.destruct && fn.owner == cursor) return &fn;
      }
      const ClassDecl* next = findClass(cursor);
      cursor = next == nullptr ? std::string() : next->base;
    }
    return nullptr;
  }

  bool Checker::anyDtorInSubtree(const std::string& className) const {
    if (findDtor(className) != nullptr) return true;
    for (const ClassDecl& decl : *classes_) {
      if (classDerivesFrom(decl.name, className) && findDtor(decl.name) != nullptr) return true;
    }
    return false;
  }

  bool Checker::anyDtorInImplementors(const std::string& interfaceName) const {
    for (const ClassDecl& decl : *classes_) {
      if (classImplements(decl.name, interfaceName) && findDtor(decl.name) != nullptr) return true;
    }
    return false;
  }

  bool Checker::destructible(TypeKind type, const std::string& typeName) const {
    if (typeName.empty()) return false;
    if (type == TypeKind::Ptr) return anyDtorInSubtree(typeName);
    if (type == TypeKind::Interface) return anyDtorInImplementors(typeName);
    return false;
  }

  void Checker::validateDestructors() {
    std::set<std::string> seen;
    for (const Function& fn : *functions_) {
      if (!fn.destruct) continue;
      if (fn.owner.empty()) fail("@Destruct 只能写在类方法前 " + fn.name);
      if (version_ < 2) fail("@Destruct 需要 #VERSION 2");
      if (isConstructor(fn)) fail("@Destruct 不能写在构造上 " + fn.name);
      if (fn.overwrite) fail("@Overwrite 和 @Destruct 不能写在同一个方法上 " + fn.name);
      if (fn.asyncFun) fail("@Destruct 不能是 async " + fn.name);
      if (fn.params.size() != 1) fail("@Destruct 必须没有参数 " + fn.name);
      if (fn.ret != TypeKind::Void) fail("@Destruct 只能返回 void " + fn.name);
      if (!seen.insert(fn.owner).second) fail("类里只能有一个 @Destruct " + fn.owner);
    }
  }

  void Checker::validateFailure() {
    for (const Function& fn : *functions_) {
      if (!fn.fails) continue;
      if (version_ < 2) fail("@Fails 需要 #VERSION 2 " + fn.name);
      if (fn.destruct) fail("析构不能是可失败的 " + fn.name);
    }
  }

  void Checker::validateFriends() {
    for (const ClassDecl& decl : *classes_) {
      for (const std::string& name : decl.friends) {
        if (findClass(name) == nullptr) fail("@Friend 列出的不是类 " + name);
      }
      for (const Field& field : decl.fields) {
        for (const std::string& name : field.friends) {
          if (findClass(name) == nullptr) fail("@Friend 列出的不是类 " + name);
        }
      }
    }
    for (const StructDecl& decl : *structs_) {
      for (const Field& field : decl.fields) {
        for (const std::string& name : field.friends) {
          if (findClass(name) == nullptr) fail("@Friend 列出的不是类 " + name);
        }
      }
    }
    for (const Function& fn : *functions_) {
      for (const std::string& name : fn.friends) {
        if (findClass(name) == nullptr) fail("@Friend 列出的不是类 " + name);
      }
    }
  }

  bool Checker::sameMethodSignature(const Function& impl, const Function& iface) const {
    if (impl.params.size() != iface.params.size() + 1) return false;
    if (impl.ret != iface.ret || impl.retName != iface.retName || impl.retPointee != iface.retPointee
      || impl.retVolatilePointee != iface.retVolatilePointee) return false;
    if (impl.fails != iface.fails) return false;
    for (std::size_t index = 0; index < iface.params.size(); index += 1) {
      const Param& left = impl.params[index + 1];
      const Param& right = iface.params[index];
      /* M-C：out/ref 修饰词参与签名比对。M-D：volatile 位同参。 */
      if (left.type != right.type || left.typeName != right.typeName || left.pointee != right.pointee
        || left.volatilePointee != right.volatilePointee || left.mode != right.mode) return false;
    }
    return true;
  }

  bool Checker::findImplementation(const std::string& className, const Function& method) const {
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

  void Checker::layoutInterfaces(std::vector<InterfaceDecl>& interfaces) {
    for (InterfaceDecl& decl : interfaces) {
      std::set<std::string> names;
      for (Function& method : decl.methods) {
        const std::string name = shortFunctionName(method.name);
        resolveType(method.ret, method.retPointee, method.retName);
        repair(method.ret, method.retPointee, method.retAlt, method.retName, method.retAltName);
        if (method.ret == TypeKind::Struct) fail("接口方法不能返回结构体 " + decl.name + "::" + name);
        /* M-B：接口派发按字传参，span 两字值暂不进接口方法（同结构体；M-C 后随 out 再评估）。 */
        if (method.ret == TypeKind::Span) fail("接口方法不能返回 span " + decl.name + "::" + name);
        std::string key = name + "(";
        for (Param& param : method.params) {
          resolveType(param.type, param.pointee, param.typeName);
          repair(param.type, param.pointee, param.alt, param.typeName, param.altName);
          /* M-B：span/结构体两字值暂不按值进接口方法（同展平密度约束）。
             M-C：out/ref 形参是一个地址字，收 span/结构体出参没有密度问题，放行。 */
          if (param.type == TypeKind::Void
            || (param.mode == ParamMode::None && (param.type == TypeKind::Struct || param.type == TypeKind::Span))) {
            fail("接口方法参数类型不对 " + decl.name + "::" + name);
          }
          if (key.back() != '(') key += ",";
          /* M-C：out/ref 修饰词与 pointee 都进接口方法签名键。 */
          key += typeText(param.type, param.typeName, param.alt, param.altName, param.pointee, param.volatilePointee, param.mode);
        }
        key += ")";
        /* 返回类型不参与区分。参数相同就是同一个方法，不能靠返回类型再写一份。 */
        if (!names.insert(key).second) fail("接口方法重复 " + decl.name + "::" + name);
      }
    }
  }

  void Checker::validateInterfaces(const std::vector<ClassDecl>& classes) {
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
          /* 同签名但失败性不一致时给出专门诊断。 */
          for (const Function& impl : *functions_) {
            if (impl.owner != decl.name) continue;
            if (shortFunctionName(impl.name) != shortFunctionName(method.name)) continue;
            Function left = impl;
            Function right = method;
            left.fails = false;
            right.fails = false;
            if (sameMethodSignature(left, right)) {
              fail("接口方法的失败性要一致 " + name + "::" + shortFunctionName(method.name));
            }
          }
          fail("类 " + decl.name + " 没有实现接口方法 " + name + "::" + shortFunctionName(method.name));
        }
      }
    }
  }

  const StructDecl* Checker::findStruct(const std::string& name) const {
    if (structs_ == nullptr) return nullptr;
    for (const StructDecl& decl : *structs_) {
      if (decl.name == name) return &decl;
    }
    return nullptr;
  }

  StructDecl* Checker::findStructMut(std::vector<StructDecl>& structs, const std::string& name) {
    for (StructDecl& decl : structs) {
      if (decl.name == name) return &decl;
    }
    return nullptr;
  }

  EnumDecl* Checker::findEnumMut(std::vector<EnumDecl>& enums, const std::string& name) {
    for (EnumDecl& decl : enums) {
      if (decl.name == name) return &decl;
    }
    return nullptr;
  }

  const EnumDecl* Checker::findEnum(const std::string& name) const {
    if (enums_ == nullptr) return nullptr;
    for (const EnumDecl& decl : *enums_) {
      if (decl.name == name) return &decl;
    }
    return nullptr;
  }

}  // namespace sema
}  // namespace obr
