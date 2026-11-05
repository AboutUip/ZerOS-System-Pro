#pragma once

#include "token/Token.hpp"
#include "type/TypeKind.hpp"

#include <string>
#include <vector>

namespace obr {

struct Expr {
  enum class Kind { LitInt, LitFloat, LitBool, LitChar, LitString, LitStringStatic, LitNull, LitUndefined, Name, Unary, Binary, Assign, Update, Ternary, Call, Cast, New, Member, Dispatch, StructLiteral, StructConst, ClassConst, Await };
  Kind kind = Kind::LitInt;
  Tok op = Tok::End;
  bool prefix = true;
  TypeKind type = TypeKind::None;
  TypeKind pointee = TypeKind::None;
  /** map 的值类型。其它类型不用。 */
  TypeKind alt = TypeKind::None;
  std::string text;
  std::string typeName;
  /** map 的值描述，或空。集合的 typeName 是元素或键的描述。 */
  std::string altName;
  /** 结构体聚合字面量的字段名，与 kids 一一对应。 */
  std::vector<std::string> labels;
  long long integer = 0;
  double number = 0;
  std::vector<Expr> kids;
};

struct Stmt {
  enum class Kind { Block, Decl, Const, If, Switch, Case, Default, Fallthrough, While, For, ForIn, Break, Continue, Return, Goto, Label, Expr, Zap, Nop };
  Kind kind = Kind::Nop;
  TypeKind type = TypeKind::None;
  TypeKind pointee = TypeKind::None;
  TypeKind alt = TypeKind::None;
  std::string name;
  std::string typeName;
  std::string altName;
  int slot = -1;
  int words = 1;
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
  TypeKind alt = TypeKind::None;
  std::string name;
  std::string typeName;
  std::string altName;
  int slot = -1;
};

struct Field {
  TypeKind type = TypeKind::None;
  TypeKind pointee = TypeKind::None;
  TypeKind alt = TypeKind::None;
  std::string name;
  std::string typeName;
  std::string altName;
  int offset = 0;
  int words = 1;
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
};

struct StructDecl {
  std::string name;
  std::vector<Field> fields;
  int words = 0;
};

struct EnumValue {
  std::string name;
  long long value = 0;
};

struct EnumDecl {
  std::string name;
  TypeKind underlying = TypeKind::Int;
  std::vector<EnumValue> values;
};

struct Function {
  TypeKind ret = TypeKind::Void;
  TypeKind retPointee = TypeKind::None;
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
};

}  // namespace obr
