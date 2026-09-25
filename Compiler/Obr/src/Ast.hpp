#pragma once

#include <string>
#include <vector>

namespace obr {

enum class TypeKind { Byte, Short, Int, Long, Float, Double, Boolean, Char, String, Ptr, Void, Undefined, None };

enum class Tok {
  End, Ident, Int, Float, StringLit, CharLit, True, False, Null, Undefined,
  LParen, RParen, LBrace, RBrace, LBracket, RBracket, Comma, Colon, Semi, Question,
  Plus, Minus, Star, Slash, Percent, Pow, Not, BitNot,
  Eq, Ne, Lt, Le, Gt, Ge, And, Or, BitAnd, BitOr, BitXor,
  Shl, Shr, UShr, Assign, PlusEq, MinusEq, StarEq, SlashEq, PercentEq,
  PlusPlus, MinusMinus,
  If, Else, While, Break, Continue, Return, Goto, DeRfun, Import, Namespace, Static, Public, Private, Var, Export, Zap, Version, Link, Scope
};

struct Expr {
  enum class Kind { LitInt, LitFloat, LitBool, LitChar, LitString, LitNull, LitUndefined, Name, Unary, Binary, Assign, Update, Ternary, Call, Cast };
  Kind kind = Kind::LitInt;
  Tok op = Tok::End;
  bool prefix = true;
  TypeKind type = TypeKind::None;
  TypeKind pointee = TypeKind::None;
  std::string text;
  long long integer = 0;
  double number = 0;
  std::vector<Expr> kids;
};

struct Stmt {
  enum class Kind { Block, Decl, If, While, Break, Continue, Return, Goto, Label, Expr, Zap, Nop };
  Kind kind = Kind::Nop;
  TypeKind type = TypeKind::None;
  TypeKind pointee = TypeKind::None;
  std::string name;
  int slot = -1;
  bool isStatic = false;
  Expr expr;
  std::vector<Stmt> body;
  std::vector<Stmt> other;
};

struct Param {
  TypeKind type = TypeKind::None;
  TypeKind pointee = TypeKind::None;
  std::string name;
  int slot = -1;
};

struct Function {
  TypeKind ret = TypeKind::Void;
  std::string name;
  std::string label;
  std::string origin;
  bool exported = false;
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

struct SourceFile {
  std::string path;
  std::vector<std::string> imports;
  std::vector<std::string> links;
  std::vector<Function> functions;
};

struct HeaderFile {
  std::string name;
  std::vector<Function> decls;
};

struct Unit {
  std::vector<Function> functions;
};

}  // namespace obr
