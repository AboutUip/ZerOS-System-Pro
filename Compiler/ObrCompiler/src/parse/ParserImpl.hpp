#pragma once

#include "../Ast.hpp"
#include "../Lexer.hpp"

#include <initializer_list>
#include <string>
#include <utility>
#include <vector>

namespace obr {
namespace parse {

class Parser {
 public:
  Parser(std::vector<Token> tokens, bool header) : tokens_(std::move(tokens)), header_(header) {}

  SourceFile parseFile();

 private:
  std::vector<Token> tokens_;
  int at_ = 0;
  bool header_ = false;

  const Token& peek() const { return tokens_[static_cast<std::size_t>(at_)]; }
  bool check(Tok kind) const { return peek().kind == kind; }
  Token take() { return tokens_[static_cast<std::size_t>(at_++)]; }

  bool eat(Tok kind);

  void expect(Tok kind, const std::string& message);

  struct ParsedType {
    TypeKind kind = TypeKind::None;
    TypeKind pointee = TypeKind::None;
    /** M-D：`volatile T*` 标记位（点类型是 volatile）。 */
    bool volatilePointee = false;
    TypeKind alt = TypeKind::None;
    std::string typeName;
    std::string altName;
  };

  bool collectionWord(const std::string& name) const;

  /* M-B：span[元素] 是切片类型；只认「span[」形态，裸 span 标识符/调用不动。 */
  bool spanWord(const std::string& name) const;

  /* M-C：参数位开头的 `out` / `ref` 修饰词。只有后跟「类型 + 参数名」形态才认
     （类型关键字、集合/span、限定名、`名字*`、`名字 名字`）；否则当普通类型名，
     保住叫 out/ref 的类型和变量。 */
  ParamMode takeParamModifier();

  /* M-D：类型位开头的 `volatile` 限定词（`volatile T*`）。只有后跟「单字标量类型」
     或「名字*」形态才认；否则当普通标识符，保住叫 volatile 的类型和变量。 */
  bool volatileQualifier();

  /* M-D：volatile 指针的点类型只接受单字标量（byte/short/int/long/float/double/boolean/char）。 */
  static bool volatileWord(TypeKind kind);

  /* M5：`[` 已在当前位置，整组闭合后紧跟 `(` 才是泛型调用（否则是下标）。 */
  bool genericCallAhead() const;

  /* M5：`Name[类型实参] 名字` 是声明；`xs[i] * y` 保持表达式（泛型名后不认 `*`）。 */
  bool genericDeclAhead() const;

  /* M5：泛型实参列表（`[` 已吃），返回 "<a,b>" 文本。 */
  std::string typeArgsText();

  /* 缺口 5：泛型类型参数列表（`[` 已吃），支持约束 `T : 基类`。 */
  void parseTypeParams(std::vector<std::string>& params, std::vector<std::string>& bounds);

  std::string describe(const ParsedType& type) const;

  bool scanTypeAt(int& index) const;

  bool typeName(const std::string& name) const;

  /* M-A：sizeof/offsetof/alignof 是编译期内建调用。当前位置是内建名且紧跟 `(` 时
     走特判解析：类型实参复用 parseType()，offsetof 第二参是字段名标识符。
     结果仍是 Call 形态（integer 标记 -8/-9），Sema 期折成 LitInt。 */
  bool layoutBuiltinAhead() const;

  Expr parseLayoutBuiltin();

  /* (名字*) 才是指针转换。(名字) 仍是括号表达式，避免把乘法看成转换。 */
  bool looksLikePointerCast() const;

  bool scalarCastName(const std::string& name) const;

  /* (标量类型) 后面必须真的跟着一个表达式，才把它当转换。
     这样写法奇怪的 (int) 单独出现时仍会报表达式错误，而不是静默吃掉。 */
  bool looksLikeScalarCast() const;

  std::string typeIdent();

  bool looksLikeDecl() const;

  bool inWordAt(int index) const;

  bool looksLikeForIn() const;

  ParsedType parseCollection();

  /* M-B：span[元素]（两字切片值类型）。 */
  ParsedType parseSpan();

  ParsedType parseType();

  TypeKind typeOf(const std::string& name);

  std::string qualified();

  void parseTop(SourceFile& file, const std::string& space);

  std::string declaredName(const std::string& space);

  StructDecl parseStruct(const std::string& space);

  ConstDecl parseConst(const std::string& space);

  EnumDecl parseEnum(const std::string& space);

  InterfaceDecl parseInterface(const std::string& space);

  ClassDecl parseClass(SourceFile& file, const std::string& space);

  Function parseFunction(const std::string& space, bool signatureOnly = false);

  Stmt parseStmt();
  /* 语句语法的任务域拆分（ParserStmt.cpp）：每种语句一个解析方法，finishStmt 给没记行号的语句补行号。 */
  static Stmt finishStmt(Stmt stmt, int opened);
  Stmt parseStmtTry(int opened);
  Stmt parseStmtSwitch(int opened);
  Stmt parseStmtFor(int opened);
  Stmt parseStmtConst(int opened, bool isStatic);
  Stmt parseStmtVar(int opened, bool isStatic);
  Stmt parseStmtDecl(int opened, bool isStatic);

  Expr parseExpr() { return parseAssign(); }

  Expr parseAssign();

  Expr parseTernary();

  Expr parseOr() { return parseBinary(&Parser::parseAnd, {Tok::Or}); }
  Expr parseAnd() { return parseBinary(&Parser::parseBitOr, {Tok::And}); }
  Expr parseBitOr() { return parseBinary(&Parser::parseBitXor, {Tok::BitOr}); }
  Expr parseBitXor() { return parseBinary(&Parser::parseBitAnd, {Tok::BitXor}); }
  Expr parseBitAnd() { return parseBinary(&Parser::parseEq, {Tok::BitAnd}); }
  Expr parseEq() { return parseBinary(&Parser::parseRel, {Tok::Eq, Tok::Ne}); }
  Expr parseRel() { return parseBinary(&Parser::parseShift, {Tok::Lt, Tok::Le, Tok::Gt, Tok::Ge}); }
  Expr parseShift() { return parseBinary(&Parser::parseAdd, {Tok::Shl, Tok::Shr, Tok::UShr}); }
  Expr parseAdd() { return parseBinary(&Parser::parseMul, {Tok::Plus, Tok::Minus}); }
  Expr parseMul() { return parseBinary(&Parser::parsePow, {Tok::Star, Tok::Slash, Tok::Percent}); }

  Expr parsePow();

  using Level = Expr (Parser::*)();

  Expr parseBinary(Level next, std::initializer_list<Tok> ops);

  Expr parseUnary();

  Expr parsePost();

  Expr parsePrimary();
};

}  // namespace parse
}  // namespace obr
