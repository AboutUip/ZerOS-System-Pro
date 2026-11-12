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

  void Checker::run(Unit& unit) {
    functions_ = &unit.functions;
    self_ = -1;
    classes_ = &unit.classes;
    classTemplates_ = &unit.classTemplates;
    functionTemplates_ = &unit.functionTemplates;
    interfaceTemplates_ = &unit.interfaceTemplates;
    structs_ = &unit.structs;
    enums_ = &unit.enums;
    interfaces_ = &unit.interfaces;
    unitStrings_ = &unit.strings;
    unitStructs_ = &unit.structConstants;
    unitClasses_ = &unit.classConstants;
    shared_ = unit.shared;
    version_ = unit.version;
    if (!unit.interfaces.empty() && version_ < 2) fail("interface 需要 #VERSION 2");
    /* M3 失败值：内置 fail 类（code/cause/note），追加在类表末尾（已有 class ID 不动）。
       名字保留给内置类型；客程序可以写同形类，但不能叫 fail。 */
    for (const ClassDecl& decl : unit.classes) if (decl.name == "fail") fail("fail 是内置类型名");
    for (const StructDecl& decl : unit.structs) if (decl.name == "fail") fail("fail 是内置类型名");
    for (const EnumDecl& decl : unit.enums) if (decl.name == "fail") fail("fail 是内置类型名");
    for (const InterfaceDecl& decl : unit.interfaces) if (decl.name == "fail") fail("fail 是内置类型名");
    /* M-B：span 保留给切片类型（span[T]）。只挡类型名；函数名不受限
       （obr::ui::span / obr::text::span 等调用形态保持现状）。 */
    for (const ClassDecl& decl : unit.classes) if (decl.name == "span") fail("span 保留给切片类型");
    for (const ClassDecl& decl : unit.classTemplates) if (decl.name == "span") fail("span 保留给切片类型");
    for (const StructDecl& decl : unit.structs) if (decl.name == "span") fail("span 保留给切片类型");
    for (const EnumDecl& decl : unit.enums) if (decl.name == "span") fail("span 保留给切片类型");
    for (const InterfaceDecl& decl : unit.interfaces) if (decl.name == "span") fail("span 保留给切片类型");
    {
      ClassDecl failure;
      failure.name = "fail";
      Field code;
      code.type = TypeKind::Long;
      code.name = "code";
      Field cause;
      cause.type = TypeKind::Ptr;
      cause.typeName = "fail";
      cause.name = "cause";
      Field note;
      note.type = TypeKind::String;
      note.name = "note";
      failure.fields = {code, cause, note};
      unit.classes.push_back(failure);
    }
    /* M5：泛型单态化——先把所有 Name<...> 请求实例化成普通类/函数，再走常规管线。 */
    instantiateAll();
    /* M-A 管道调序：布局先于常量折叠。sizeof/offsetof/alignof 与枚举值常量表达式都要
       用布局结果；布局本身只依赖类型名（字段类型解析），不读常量，无循环依赖。
       常量引用常量仍按 loadConstants 的声明序前后可见（头文件常量先于源文件常量）。 */
    layoutStructs(unit.structs);
    layoutInterfaces(unit.interfaces);
    resolveClassFields(unit.classes);
    layoutClasses(unit.classes);
    layoutEnums(unit.enums);
    loadConstants(unit.consts);
    validateInterfaces(unit.classes);
    for (std::size_t index = 0; index < unit.classes.size(); index += 1) {
      unit.classes[index].id = unit.classes[index].headerWords > 0 ? static_cast<int>(index) + 1 : 0;
    }
    resolveSignatures();
    validateOverrides();
    validateDestructors();
    validateFailure();
    validateFriends();
    for (const Function& fn : *functions_) {
      if (fn.exported && fn.name.rfind("__dtor_", 0) == 0) fail("__dtor_ 前缀保留给运行时 " + fn.name);
      /* M-A：sizeof/offsetof/alignof 保留给编译期内建（同 __dtor_ 先例）。 */
      rejectReservedName(shortFunctionName(fn.name));
    }
    for (std::size_t index = 0; index < unit.functions.size(); index += 1) {
      if (!unit.functions[index].opcode.empty()) continue;
      self_ = static_cast<int>(index);
      checkFunction(unit.functions[index]);
    }
  }

  Slot* Checker::find(const std::string& name) {
    for (int index = static_cast<int>(scopes_.size()) - 1; index >= 0; index -= 1) {
      auto found = scopes_[static_cast<std::size_t>(index)].find(name);
      if (found != scopes_[static_cast<std::size_t>(index)].end()) return &found->second;
    }
    return nullptr;
  }

  int Checker::alloc(const std::string& name, TypeKind type, TypeKind pointee, int count) {
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

  int Checker::allocStatic(const std::string& name, TypeKind type, TypeKind pointee) {
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

  void Checker::allocConst(const std::string& name, TypeKind type, TypeKind pointee, TypeKind alt, const std::string& typeName, const std::string& altName, Expr value) {
    if (scopes_.back().contains(name)) fail("名字重复 " + name);
    rejectReservedName(name);
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

  void Checker::rejectReservedName(const std::string& name) {
    /* M-A：sizeof/offsetof/alignof 保留给编译期内建（同 __dtor_ 先例）：
       参数是类型不是表达式，普通调用形态本就无法解析，不做可遮蔽设计。 */
    if (name == "sizeof" || name == "offsetof" || name == "alignof") {
      fail(name + " 保留给编译期内建");
    }
  }

  void Checker::loadConstants(const std::vector<ConstDecl>& decls) {
    for (const ConstDecl& original : decls) {
      ConstDecl decl = original;
      rejectReservedName(decl.name);
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

  void Checker::resolveSignatures() {
    for (Function& function : *functions_) {
      resolveType(function.ret, function.retPointee, function.retName);
      if (function.ret == TypeKind::None) fail("没有类型 " + function.retName);
      for (Param& param : function.params) {
        resolveType(param.type, param.pointee, param.typeName);
        if (param.type == TypeKind::Void) fail("参数不能是 void");
        if (param.type == TypeKind::None) fail("没有类型 " + param.typeName);
        /* M-C：out/ref 只面向普通与导入函数。指令头/编译器内建库的出参继续 `long*` + `&x`
           （同一 ABI 槽），它们的调用点是逐函数手写的种植管道。 */
        if (param.mode != ParamMode::None && !function.opcode.empty()) {
          fail("指令和库函数的出参继续写 long* + &x，不用 out/ref " + function.name);
        }
      }
    }
  }

  void Checker::checkFunction(Function& function) {
    scopes_.clear();
    push();
    words_ = 1;
    loops_ = 0;
    sawGoto_ = false;
    tryDepth_ = 0;
    resolveType(function.ret, function.retPointee, function.retName);
    if (function.ret == TypeKind::None) fail("没有类型 " + function.retName);
    repair(function.ret, function.retPointee, function.retAlt, function.retName, function.retAltName);
    ret_ = function.ret;
    retName_ = function.retName;
    retAlt_ = function.retAlt;
    retAltName_ = function.retAltName;
    retPointee_ = function.retPointee;
    retVolatilePointee_ = function.retVolatilePointee;
    labels_.clear();
    collectLabels(function.body);
    /* 结构体返回值：隐藏目的槽（调用方把目的地址作为第一字参数传进来）。
       M-B：span 是两字值类型，按同一结构体返回通道（retSlot 隐藏目的槽）。 */
    if (function.ret == TypeKind::Struct || function.ret == TypeKind::Span) {
      function.retSlot = words_;
      words_ += 1;
    }
    for (Param& param : function.params) {
      resolveType(param.type, param.pointee, param.typeName);
      if (param.type == TypeKind::Void) fail("参数不能是 void");
      if (param.type == TypeKind::None) fail("没有类型 " + param.typeName);
      repair(param.type, param.pointee, param.alt, param.typeName, param.altName);
      /* M-C：out/ref 形参在被调方序言就是一个地址字槽（ABI 与 T* 同）。 */
      const int paramCount = param.mode == ParamMode::None ? valueWords(param.type, param.typeName) : 1;
      param.slot = alloc(param.name, param.type, param.pointee, paramCount);
      if (Slot* saved = find(param.name)) {
        saved->typeName = param.typeName;
        saved->volatilePointee = param.volatilePointee;
        saved->alt = param.alt;
        saved->altName = param.altName;
      }
    }
    /* 构造链（Plan 2 M1 定案）：派生构造漏写链式调用时，按明确规则自动调用基类无参构造；
       基类只有带参构造时编译失败。显式链式调用必须是构造体第一条语句、必须调用直接基类。 */
    std::size_t startIndex = 0;
    bool explicitChain = false;
    if (!function.imported && function.opcode.empty() && isConstructor(function)) {
      if (!function.body.empty()) {
        checkStmt(function.body[0]);
        startIndex = 1;
        explicitChain = isCtorChainCall(function, function.body[0]);
      }
      const ClassDecl* self = findClass(function.owner);
      const std::string base = self == nullptr ? std::string() : self->base;
      if (explicitChain) {
        const Function& target = (*functions_)[static_cast<std::size_t>(function.body[0].expr.integer)];
        if (target.owner != base) fail("构造链只能调用直接基类的构造 " + function.name);
        function.body[0].expr.ctorChain = true;
        if (target.fails && !function.fails) fail("基类构造可失败时派生构造也要标 @Fails " + function.name);
      } else if (!base.empty()) {
        const Function* noArg = nullptr;
        bool anyCtor = false;
        for (const Function& fn : *functions_) {
          if (!isConstructor(fn) || fn.owner != base) continue;
          anyCtor = true;
          if (fn.params.size() == 1) noArg = &fn;
        }
        if (noArg != nullptr) {
          Stmt chain;
          chain.kind = Stmt::Kind::Expr;
          chain.line = function.line;
          Expr call;
          call.kind = Expr::Kind::Call;
          call.text = noArg->name;
          call.ctorChain = true;
          Expr selfRef;
          selfRef.kind = Expr::Kind::Name;
          selfRef.text = "this";
          call.kids.push_back(std::move(selfRef));
          chain.expr = std::move(call);
          checkStmt(chain);
          function.body.insert(function.body.begin(), std::move(chain));
          const Function& target = (*functions_)[static_cast<std::size_t>(function.body[0].expr.integer)];
          if (target.fails && !function.fails) fail("基类构造可失败时派生构造也要标 @Fails " + function.name);
        } else if (anyCtor) {
          fail("派生构造没有调用基类构造，基类也没有无参构造 " + function.name);
        }
      }
    }
    for (std::size_t index = startIndex; index < function.body.size(); index += 1) checkStmt(function.body[index]);
    for (std::size_t index = 1; index < function.body.size(); index += 1) {
      if (isCtorChainCall(function, function.body[index])) fail("基类构造必须是派生构造的第一条语句 " + function.name);
    }
    /* 析构自动链（Plan 2 M2）：每个 return 前和函数末尾插基类析构调用；析构体里自己调基类析构会调两次，拒绝。 */
    if (!function.imported && function.opcode.empty() && function.destruct) {
      rejectBaseDtorCalls(function.body, function);
      const ClassDecl* self = findClass(function.owner);
      std::string cursor = self == nullptr ? std::string() : self->base;
      const Function* baseDtor = nullptr;
      while (!cursor.empty() && baseDtor == nullptr) {
        for (const Function& fn : *functions_) {
          if (fn.destruct && fn.owner == cursor) {
            baseDtor = &fn;
            break;
          }
        }
        const ClassDecl* next = findClass(cursor);
        cursor = next == nullptr ? std::string() : next->base;
      }
      if (baseDtor != nullptr) insertBaseDtorCalls(function.body, *baseDtor, function);
    }
    if (sawGoto_ && function.dtorFrame) fail("有析构变量的函数里不能写 goto " + function.name);
    /* M-C：out 形参只写检查（收尾跑一遍：形参名不能当值用）。 */
    checkOutUse(function);
    function.words = words_;
    pop();
  }

  void Checker::collectLabels(const std::vector<Stmt>& body) {
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

}  // namespace sema
}  // namespace obr
