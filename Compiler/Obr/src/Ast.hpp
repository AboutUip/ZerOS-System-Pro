#pragma once

#include "token/Token.hpp"
#include "type/TypeKind.hpp"

#include <string>
#include <vector>

namespace obr {

struct Expr {
  enum class Kind { LitInt, LitFloat, LitBool, LitChar, LitString, LitNull, LitUndefined, Name, Unary, Binary, Assign, Update, Ternary, Call, Cast, New, Member, Await };
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
  long long integer = 0;
  double number = 0;
  std::vector<Expr> kids;
};

struct Stmt {
  enum class Kind { Block, Decl, If, While, For, Break, Continue, Return, Goto, Label, Expr, Zap, Nop };
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
  Expr expr;
  std::vector<Stmt> body;
  std::vector<Stmt> other;
};

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
  std::vector<Field> fields;
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
};

struct LinkName {
  std::string name;
  std::string label;
};

struct SourceFile {
  std::string path;
  bool dyn = false;
  std::vector<std::string> imports;
  std::vector<std::string> links;
  std::vector<Function> functions;
  std::vector<ClassDecl> classes;
  std::vector<StructDecl> structs;
  std::vector<EnumDecl> enums;
};

struct HeaderFile {
  std::string name;
  std::vector<Function> decls;
  std::vector<StructDecl> structs;
  std::vector<EnumDecl> enums;
};

struct Unit {
  bool shared = false;
  bool pie = false;
  std::vector<LinkName> exports;
  std::vector<LinkName> imports;
  std::vector<Function> functions;
  std::vector<ClassDecl> classes;
  std::vector<StructDecl> structs;
  std::vector<EnumDecl> enums;
};

}  // namespace obr
