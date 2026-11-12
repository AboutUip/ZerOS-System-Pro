#pragma once

#include "token/Token.hpp"
#include "type/TypeKind.hpp"

#include <string>
#include <vector>

namespace obr {

struct Expr {
  enum class Kind { LitInt, LitFloat, LitBool, LitChar, LitString, LitStringStatic, LitNull, LitUndefined, Name, Unary, Binary, Assign, Update, Ternary, Call, Cast, New, Member, Dispatch, StructLiteral, StructConst, ClassConst, Await, VirtualCall };
  Kind kind = Kind::LitInt;
  Tok op = Tok::End;
  bool prefix = true;
  TypeKind type = TypeKind::None;
  TypeKind pointee = TypeKind::None;
  /** M-D：`volatile T*`（指向 volatile 的指针）标记位。只对 Ptr 类型有意义；
      经 `*p` 读写即 volatile 访问（发射 vld./vst. 面，Peephole 全屏蔽）。 */
  bool volatilePointee = false;
  /** map 的值类型。其它类型不用。 */
  TypeKind alt = TypeKind::None;
  std::string text;
  std::string typeName;
  /** map 的值描述，或空。集合的 typeName 是元素或键的描述。 */
  std::string altName;
  /** 结构体聚合字面量的字段名，与 kids 一一对应。 */
  std::vector<std::string> labels;
  /** `f()?` 的失败传播标记：Sema 校验归宿后照常按可失败调用发射检查。 */
  bool propagates = false;
  /** 构造链调用（派生构造里的基类构造调用）：失败传播不重复销毁基类链。 */
  bool ctorChain = false;
  long long integer = 0;
  double number = 0;
  std::vector<Expr> kids;
};

struct Stmt {
  enum class Kind { Block, Decl, Const, If, Switch, Case, Default, Fallthrough, While, For, ForIn, Break, Continue, Return, Goto, Label, Expr, Zap, Nop, Try, Throw };
  Kind kind = Kind::Nop;
  TypeKind type = TypeKind::None;
  TypeKind pointee = TypeKind::None;
  /** M-D：`volatile T*` 标记位（声明的类型是指向 volatile 的指针）。 */
  bool volatilePointee = false;
  TypeKind alt = TypeKind::None;
  std::string name;
  std::string typeName;
  std::string altName;
  int slot = -1;
  int words = 1;
  /** M2 触发点 (d)：所有权变量的影子析构记录槽（3 个字：对象/析构标签/前一条）。-1 = 没有。 */
  int recordSlot = -1;
  bool isStatic = false;
  /** `for (var[T] x in ...)` 的 x 是否由这条语句声明。 */
  bool declares = false;
  Expr expr;
  std::vector<Stmt> body;
  std::vector<Stmt> other;
  /** 语句开头的行。`__zap__` 记第一行正文。0 表示没有。 */
  int line = 0;
};

inline std::string shortFunctionName(const std::string& name) {
  const std::size_t scope = name.rfind("::");
  return scope == std::string::npos ? name : name.substr(scope + 2);
}

struct Param {
  TypeKind type = TypeKind::None;
  TypeKind pointee = TypeKind::None;
  /** M-D：`volatile T*` 标记位（参数类型是指向 volatile 的指针）。 */
  bool volatilePointee = false;
  TypeKind alt = TypeKind::None;
  /* M-C：out/ref 形参修饰词（无修饰 = 按值）。out/ref 的 ABI 是一个地址字槽。 */
  ParamMode mode = ParamMode::None;
  std::string name;
  std::string typeName;
  std::string altName;
  int slot = -1;
};

struct Field {
  TypeKind type = TypeKind::None;
  TypeKind pointee = TypeKind::None;
  /** M-D：`volatile T*` 标记位（字段类型是指向 volatile 的指针）。 */
  bool volatilePointee = false;
  TypeKind alt = TypeKind::None;
  std::string name;
  std::string typeName;
  std::string altName;
  int offset = 0;
  int words = 1;
  /** M4：private 成员（缺省 public，存量行为不变）。owner 是声明它的类/结构体。 */
  bool isPrivate = false;
  std::vector<std::string> friends;
  std::string owner;
};

struct ClassDecl {
  std::string name;
  std::string base;
  std::vector<std::string> interfaces;
  std::vector<Field> fields;
  /** `#VERSION 2` 类在偏移 0 放一个对象头，字段从 64 位开始。 */
  int headerWords = 0;
  /** 对象头里的 class ID；0 表示没有对象头。 */
  int id = 0;
  /** M4：类级 @Friend(类名...)，授权访问本类全部私有成员。 */
  std::vector<std::string> friends;
  /** M5：泛型类型参数（非空 = 模板，模板不进常规管线，实例化后进）。 */
  std::vector<std::string> typeParams;
  /** 与 typeParams 平行的约束（`T : Base`，空串 = 无约束）。 */
  std::vector<std::string> typeParamBounds;
};

struct StructDecl {
  std::string name;
  std::vector<Field> fields;
  int words = 0;
};

struct EnumValue {
  std::string name;
  long long value = 0;
  /* M-A：枚举值放开到常量表达式（`= sizeof(long)` 等），解析期存初始化式，
     Sema 的 layoutEnums 按声明序折值。没写 `=` 时 hasInit 为假，值是前一个加 1。 */
  Expr init;
  bool hasInit = false;
  /* 折值完成标记：折值期间的 `名字::值` 自引用只认已折完的值（防成环读到未定值）。 */
  bool folded = false;
};

struct EnumDecl {
  std::string name;
  TypeKind underlying = TypeKind::Int;
  std::vector<EnumValue> values;
};

struct Function {
  TypeKind ret = TypeKind::Void;
  TypeKind retPointee = TypeKind::None;
  /** M-D：`volatile T*` 标记位（返回类型是指向 volatile 的指针）。 */
  bool retVolatilePointee = false;
  TypeKind retAlt = TypeKind::None;
  std::string retName;
  std::string retAltName;
  std::string name;
  std::string label;
  std::string origin;
  bool exported = false;
  /** 头文件里有声明、这份程序里没有函数体。调用先跳到 halt，等 attach 改成库里的编号。 */
  bool imported = false;
  bool asyncFun = false;
  bool callfunNone = false;
  /** `@Overwrite`：声明覆盖基类同签名方法。签名校验后该方法槽走方法表派发。 */
  bool overwrite = false;
  /** `@Destruct`：析构方法（零参、: void、每类至多一个）。作用域尽头按所有权调用。 */
  bool destruct = false;
  /** `@Fails`：可失败函数。返回值通道在 r1：0 = 成功，非 0 = fail 对象。 */
  bool fails = false;
  /** 结构体返回值的隐藏目的槽（>= 0 时调用方传目的地址作第一字参数）。 */
  int retSlot = -1;
  /** M4：private 方法（缺省 public）+ 成员级 @Friend(类名...)。 */
  bool isPrivate = false;
  std::vector<std::string> friends;
  /** M5：泛型类型参数（非空 = 模板函数；顶层函数与类方法都可带）。 */
  std::vector<std::string> typeParams;
  /** 与 typeParams 平行的约束（`T : Base`，空串 = 无约束）。 */
  std::vector<std::string> typeParamBounds;
  /** 函数里有带析构的所有权变量（new 直接初始化）：不能内联，不能写 goto。 */
  bool dtorFrame = false;
  std::string owner;
  std::vector<std::string> callfun;
  std::string opcode;
  int opcodeArg0 = 0;
  bool opcodeResultR6 = false;
  bool opcodeCopyLast = false;
  std::vector<std::string> links;
  std::vector<int> visible;
  std::vector<Param> params;
  std::vector<Stmt> body;
  int words = 0;
  /** `deRfun` 所在的行。0 表示没有。 */
  int line = 0;
};

struct InterfaceDecl {
  std::string name;
  std::vector<Function> methods;
  /** M5/缺口 5：泛型类型参数（非空 = 泛型接口模板，单态化后生成实例）。 */
  std::vector<std::string> typeParams;
  /** 与 typeParams 平行的约束（`T : Base`，空串 = 无约束）。 */
  std::vector<std::string> typeParamBounds;
};

struct LinkName {
  std::string name;
  std::string label;
  /* 导入所属的模块名，就是 import 的名字。导出不用。 */
  std::string module;
};

struct ConstDecl {
  TypeKind type = TypeKind::None;
  TypeKind pointee = TypeKind::None;
  /** M-D：`volatile T*` 标记位（常量类型是指向 volatile 的指针）。 */
  bool volatilePointee = false;
  TypeKind alt = TypeKind::None;
  std::string name;
  std::string typeName;
  std::string altName;
  Expr expr;
  int line = 0;
};

struct ConstStruct {
  std::string typeName;
  /** 按结构体字段顺序排好的常量值。 */
  std::vector<Expr> values;
  int address = 0;
};

struct ConstClass {
  std::string typeName;
  /** 按类字段顺序排好的常量值。 */
  std::vector<Expr> values;
  int address = 0;
};

struct SourceFile {
  std::string path;
  /** 0 表示源文件没有写 #VERSION，由 obrc 按 -version 填上。 */
  int version = 0;
  bool versionSet = false;
  bool dyn = false;
  std::vector<std::string> imports;
  std::vector<std::string> links;
  std::vector<Function> functions;
  std::vector<ClassDecl> classes;
  std::vector<InterfaceDecl> interfaces;
  std::vector<StructDecl> structs;
  std::vector<EnumDecl> enums;
  std::vector<ConstDecl> consts;
  /** M5：泛型模板（带类型参数），单态化后生成实例进上面的表。 */
  std::vector<ClassDecl> classTemplates;
  std::vector<Function> functionTemplates;
  std::vector<InterfaceDecl> interfaceTemplates;
};

struct HeaderFile {
  std::string name;
  std::vector<Function> decls;
  std::vector<StructDecl> structs;
  std::vector<EnumDecl> enums;
  std::vector<ConstDecl> consts;
};

struct Unit {
  int version = 1;
  bool shared = false;
  bool pie = false;
  std::vector<LinkName> exports;
  std::vector<LinkName> imports;
  std::vector<Function> functions;
  std::vector<ClassDecl> classes;
  std::vector<InterfaceDecl> interfaces;
  std::vector<StructDecl> structs;
  std::vector<EnumDecl> enums;
  std::vector<ConstDecl> consts;
  /** `const string` 的只读字符串表；索引写进 LitStringStatic。 */
  std::vector<std::string> strings;
  /** `const 结构体` 的静态值表；索引写进 StructConst。 */
  std::vector<ConstStruct> structConstants;
  /** `const 类` 的静态对象表；索引写进 ClassConst。 */
  std::vector<ConstClass> classConstants;
  /** M5：泛型模板（带类型参数），单态化后生成实例进上面的表。 */
  std::vector<ClassDecl> classTemplates;
  std::vector<Function> functionTemplates;
  std::vector<InterfaceDecl> interfaceTemplates;
};

}  // namespace obr
