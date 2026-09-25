#include "Parser.hpp"

#include "Diagnostic.hpp"
#include "Lexer.hpp"

#include <utility>

namespace obr {
namespace {

class Parser {
 public:
  Parser(std::vector<Token> tokens, bool header) : tokens_(std::move(tokens)), header_(header) {}

  SourceFile parseFile() {
    SourceFile file;
    while (tokens_[static_cast<std::size_t>(at_)].kind == Tok::Version) {
      const std::string line = tokens_[static_cast<std::size_t>(at_)].text;
      at_ += 1;
      const std::string rest = line.size() > 8 ? line.substr(8) : "";
      std::size_t index = 0;
      while (index < rest.size() && (rest[index] == ' ' || rest[index] == '\t')) index += 1;
      if (rest.substr(index) != "1") fail("#VERSION 只接受语言版本 1");
    }
    while (tokens_[static_cast<std::size_t>(at_)].kind == Tok::Link) {
      const std::string line = tokens_[static_cast<std::size_t>(at_)].text;
      at_ += 1;
      std::string rest = line.size() > 5 ? line.substr(5) : "";
      while (!rest.empty()) {
        const std::size_t comma = rest.find(',');
        std::string item = comma == std::string::npos ? rest : rest.substr(0, comma);
        rest = comma == std::string::npos ? "" : rest.substr(comma + 1);
        std::size_t begin = 0;
        while (begin < item.size() && (item[begin] == ' ' || item[begin] == '\t')) begin += 1;
        std::size_t end = item.size();
        while (end > begin && (item[end - 1] == ' ' || item[end - 1] == '\t')) end -= 1;
        item = item.substr(begin, end - begin);
        if (item.empty()) continue;
        if (item[0] != '/') fail("#LINK 项必须以 / 开头");
        file.links.push_back(item);
      }
    }
    while (!check(Tok::End)) parseTop(file, "");
    return file;
  }

 private:
  std::vector<Token> tokens_;
  int at_ = 0;
  bool header_ = false;

  const Token& peek() const { return tokens_[static_cast<std::size_t>(at_)]; }
  bool check(Tok kind) const { return peek().kind == kind; }
  Token take() { return tokens_[static_cast<std::size_t>(at_++)]; }

  bool eat(Tok kind) {
    if (!check(kind)) return false;
    at_ += 1;
    return true;
  }

  void expect(Tok kind, const std::string& message) {
    if (!eat(kind)) fail(message);
  }

  struct ParsedType {
    TypeKind kind = TypeKind::None;
    TypeKind pointee = TypeKind::None;
  };

  bool typeName(const std::string& name) const {
    return name == "byte" || name == "short" || name == "int" || name == "long" || name == "float" || name == "double" || name == "boolean" || name == "char" || name == "string" || name == "void";
  }

  ParsedType parseType() {
    if (!check(Tok::Ident) || !typeName(peek().text)) fail("缺少类型");
    ParsedType parsed;
    parsed.kind = typeOf(take().text);
    if (check(Tok::Pow)) fail("这一版只接受一层指针");
    if (eat(Tok::Star)) {
      if (parsed.kind == TypeKind::Void) fail("不能指向 void");
      parsed.pointee = parsed.kind;
      parsed.kind = TypeKind::Ptr;
      if (check(Tok::Star) || check(Tok::Pow)) fail("这一版只接受一层指针");
    }
    return parsed;
  }

  TypeKind typeOf(const std::string& name) {
    if (name == "byte") return TypeKind::Byte;
    if (name == "short") return TypeKind::Short;
    if (name == "int") return TypeKind::Int;
    if (name == "long") return TypeKind::Long;
    if (name == "float") return TypeKind::Float;
    if (name == "double") return TypeKind::Double;
    if (name == "boolean") return TypeKind::Boolean;
    if (name == "char") return TypeKind::Char;
    if (name == "string") return TypeKind::String;
    if (name == "void") return TypeKind::Void;
    fail("未知类型 " + name);
  }

  std::string qualified() {
    if (!check(Tok::Ident)) fail("缺少名字");
    std::string name = take().text;
    while (eat(Tok::Scope)) {
      if (!check(Tok::Ident)) fail("限定名不完整");
      name += "::";
      name += take().text;
    }
    return name;
  }

  void parseTop(SourceFile& file, const std::string& space) {
    if (eat(Tok::Import)) {
      if (header_) fail(".mr 不能 import");
      if (!space.empty()) fail("import 只能写在文件顶层");
      if (!check(Tok::Ident)) fail("import 缺少模块名");
      file.imports.push_back(take().text);
      expect(Tok::Semi, "import 缺少 ;");
      return;
    }
    if (check(Tok::Namespace)) {
      if (!header_) fail(".obr 不能声明 namespace");
      take();
      if (!check(Tok::Ident)) fail("namespace 缺少名字");
      const std::string name = take().text;
      expect(Tok::LBrace, "namespace 缺少 {");
      const std::string next = space.empty() ? name : space + "::" + name;
      while (!check(Tok::RBrace) && !check(Tok::End)) parseTop(file, next);
      expect(Tok::RBrace, "namespace 缺少 }");
      if (check(Tok::Semi)) fail("namespace 的 } 后面不能写 ;");
      return;
    }
    file.functions.push_back(parseFunction(space));
  }

  Function parseFunction(const std::string& space) {
    const bool exported = eat(Tok::Export);
    expect(Tok::DeRfun, header_ ? ".mr 里只能声明函数头或 namespace" : "顶层只能是 import、export 或 deRfun");
    Function function;
    const std::string written = qualified();
    function.name = space.empty() ? written : space + "::" + written;
    function.exported = exported;
    expect(Tok::LParen, "函数参数缺少 (");
    if (!check(Tok::RParen)) {
      do {
        Param param;
        const ParsedType parsed = parseType();
        param.type = parsed.kind;
        param.pointee = parsed.pointee;
        if (param.type == TypeKind::Void) fail("参数不能是 void");
        if (!check(Tok::Ident)) fail("参数缺少名字");
        param.name = take().text;
        function.params.push_back(param);
      } while (eat(Tok::Comma));
    }
    expect(Tok::RParen, "参数列表缺少 )");
    expect(Tok::Colon, "函数缺少返回类型");
    const ParsedType ret = parseType();
    function.ret = ret.kind;
    if (header_) {
      expect(Tok::Semi, "函数头必须以 ; 结束");
      return function;
    }
    if (check(Tok::Semi)) fail(".obr 里的 deRfun 必须有函数体，函数头写在 .mr");
    expect(Tok::LBrace, "函数体缺少 {");
    while (!check(Tok::RBrace) && !check(Tok::End)) function.body.push_back(parseStmt());
    expect(Tok::RBrace, "函数体缺少 }");
    return function;
  }

  Stmt parseStmt() {
    if (eat(Tok::Semi)) return Stmt{};
    if (eat(Tok::LBrace)) {
      Stmt stmt;
      stmt.kind = Stmt::Kind::Block;
      while (!check(Tok::RBrace) && !check(Tok::End)) stmt.body.push_back(parseStmt());
      expect(Tok::RBrace, "语句块缺少 }");
      return stmt;
    }
    if (eat(Tok::If)) {
      Stmt stmt;
      stmt.kind = Stmt::Kind::If;
      expect(Tok::LParen, "if 缺少 (");
      stmt.expr = parseExpr();
      expect(Tok::RParen, "if 缺少 )");
      stmt.body.push_back(parseStmt());
      if (eat(Tok::Else)) stmt.other.push_back(parseStmt());
      return stmt;
    }
    if (eat(Tok::While)) {
      Stmt stmt;
      stmt.kind = Stmt::Kind::While;
      expect(Tok::LParen, "while 缺少 (");
      stmt.expr = parseExpr();
      expect(Tok::RParen, "while 缺少 )");
      stmt.body.push_back(parseStmt());
      return stmt;
    }
    if (eat(Tok::Break)) {
      expect(Tok::Semi, "break 缺少 ;");
      Stmt stmt;
      stmt.kind = Stmt::Kind::Break;
      return stmt;
    }
    if (eat(Tok::Continue)) {
      expect(Tok::Semi, "continue 缺少 ;");
      Stmt stmt;
      stmt.kind = Stmt::Kind::Continue;
      return stmt;
    }
    if (check(Tok::Zap)) {
      Stmt stmt;
      stmt.kind = Stmt::Kind::Zap;
      stmt.name = take().text;
      return stmt;
    }
    if (eat(Tok::Goto)) {
      if (!check(Tok::Ident)) fail("goto 缺少标号");
      Stmt stmt;
      stmt.kind = Stmt::Kind::Goto;
      stmt.name = take().text;
      expect(Tok::Semi, "goto 缺少 ;");
      return stmt;
    }
    if (check(Tok::Ident) && at_ + 1 < static_cast<int>(tokens_.size()) && tokens_[static_cast<std::size_t>(at_ + 1)].kind == Tok::Colon) {
      Stmt stmt;
      stmt.kind = Stmt::Kind::Label;
      stmt.name = take().text;
      expect(Tok::Colon, "标号缺少 :");
      return stmt;
    }
    if (eat(Tok::Return)) {
      Stmt stmt;
      stmt.kind = Stmt::Kind::Return;
      if (!check(Tok::Semi)) stmt.expr = parseExpr();
      expect(Tok::Semi, "return 缺少 ;");
      return stmt;
    }
    bool isStatic = false;
    if (eat(Tok::Public) || eat(Tok::Private)) {
      expect(Tok::Static, "public 或 private 后面必须是 static");
      isStatic = true;
    } else if (eat(Tok::Static)) {
      isStatic = true;
    }
    if (eat(Tok::Var)) {
      expect(Tok::LBracket, "var 声明要写成 var[类型]");
      Stmt stmt;
      stmt.kind = Stmt::Kind::Decl;
      stmt.isStatic = isStatic;
      const ParsedType parsed = parseType();
      stmt.type = parsed.kind;
      stmt.pointee = parsed.pointee;
      if (stmt.type == TypeKind::Void) fail("变量不能是 void");
      expect(Tok::RBracket, "var 声明缺少 ]");
      stmt.name = take().text;
      if (eat(Tok::Assign)) stmt.expr = parseExpr();
      expect(Tok::Semi, "声明缺少 ;");
      return stmt;
    }
    if (check(Tok::Ident) && typeName(peek().text)) {
      Stmt stmt;
      stmt.kind = Stmt::Kind::Decl;
      stmt.isStatic = isStatic;
      const ParsedType parsed = parseType();
      stmt.type = parsed.kind;
      stmt.pointee = parsed.pointee;
      if (stmt.type == TypeKind::Void) fail("变量不能是 void");
      stmt.name = take().text;
      if (eat(Tok::Assign)) stmt.expr = parseExpr();
      expect(Tok::Semi, "声明缺少 ;");
      return stmt;
    }
    if (isStatic) fail("static 后面必须是变量声明");
    Stmt stmt;
    stmt.kind = Stmt::Kind::Expr;
    stmt.expr = parseExpr();
    expect(Tok::Semi, "语句缺少 ;");
    return stmt;
  }

  Expr parseExpr() { return parseAssign(); }

  Expr parseAssign() {
    Expr left = parseTernary();
    const Tok op = peek().kind;
    if (op == Tok::Assign || op == Tok::PlusEq || op == Tok::MinusEq || op == Tok::StarEq || op == Tok::SlashEq || op == Tok::PercentEq) {
      take();
      Expr expr;
      expr.kind = Expr::Kind::Assign;
      expr.op = op;
      expr.kids.push_back(std::move(left));
      expr.kids.push_back(parseAssign());
      return expr;
    }
    return left;
  }

  Expr parseTernary() {
    Expr cond = parseOr();
    if (!eat(Tok::Question)) return cond;
    Expr expr;
    expr.kind = Expr::Kind::Ternary;
    expr.kids.push_back(std::move(cond));
    expr.kids.push_back(parseExpr());
    expect(Tok::Colon, "三元表达式缺少 :");
    expr.kids.push_back(parseTernary());
    return expr;
  }

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

  Expr parsePow() {
    Expr left = parseUnary();
    if (peek().kind != Tok::Pow) return left;
    take();
    Expr expr;
    expr.kind = Expr::Kind::Binary;
    expr.op = Tok::Pow;
    expr.kids.push_back(std::move(left));
    expr.kids.push_back(parsePow());
    return expr;
  }

  using Level = Expr (Parser::*)();

  Expr parseBinary(Level next, std::initializer_list<Tok> ops) {
    Expr left = (this->*next)();
    while (true) {
      bool matched = false;
      for (const Tok op : ops) {
        if (peek().kind == op) matched = true;
      }
      if (!matched) break;
      const Tok op = take().kind;
      Expr expr;
      expr.kind = Expr::Kind::Binary;
      expr.op = op;
      expr.kids.push_back(std::move(left));
      expr.kids.push_back((this->*next)());
      left = std::move(expr);
    }
    return left;
  }

  Expr parseUnary() {
    const Tok op = peek().kind;
    if (op == Tok::Not || op == Tok::BitNot || op == Tok::BitAnd || op == Tok::Star || op == Tok::Plus || op == Tok::Minus || op == Tok::PlusPlus || op == Tok::MinusMinus) {
      take();
      Expr expr;
      expr.kind = op == Tok::PlusPlus || op == Tok::MinusMinus ? Expr::Kind::Update : Expr::Kind::Unary;
      expr.op = op;
      expr.prefix = true;
      expr.kids.push_back(parseUnary());
      return expr;
    }
    return parsePost();
  }

  Expr parsePost() {
    Expr expr = parsePrimary();
    while (eat(Tok::LBracket)) {
      Expr index;
      index.kind = Expr::Kind::Binary;
      index.op = Tok::LBracket;
      index.kids.push_back(std::move(expr));
      index.kids.push_back(parseExpr());
      expect(Tok::RBracket, "下标缺少 ]");
      expr = std::move(index);
    }
    if (peek().kind == Tok::PlusPlus || peek().kind == Tok::MinusMinus) {
      Expr update;
      update.kind = Expr::Kind::Update;
      update.op = take().kind;
      update.prefix = false;
      update.kids.push_back(std::move(expr));
      return update;
    }
    return expr;
  }

  Expr parsePrimary() {
    if (check(Tok::Int)) {
      Expr expr;
      expr.kind = Expr::Kind::LitInt;
      const Token token = take();
      expr.integer = token.integer;
      expr.type = token.text == "L" ? TypeKind::Long : TypeKind::Int;
      return expr;
    }
    if (check(Tok::Float)) {
      const Token token = take();
      Expr expr;
      expr.kind = Expr::Kind::LitFloat;
      expr.number = token.number;
      expr.type = token.text == "D" ? TypeKind::Double : TypeKind::Float;
      return expr;
    }
    if (check(Tok::True) || check(Tok::False)) {
      Expr expr;
      expr.kind = Expr::Kind::LitBool;
      expr.integer = take().kind == Tok::True ? 1 : 0;
      expr.type = TypeKind::Boolean;
      return expr;
    }
    if (check(Tok::CharLit)) {
      Expr expr;
      expr.kind = Expr::Kind::LitChar;
      expr.integer = take().integer;
      expr.type = TypeKind::Char;
      return expr;
    }
    if (check(Tok::StringLit)) {
      Expr expr;
      expr.kind = Expr::Kind::LitString;
      expr.text = take().text;
      expr.type = TypeKind::String;
      return expr;
    }
    if (eat(Tok::Null)) {
      Expr expr;
      expr.kind = Expr::Kind::LitNull;
      expr.type = TypeKind::None;
      return expr;
    }
    if (eat(Tok::Undefined)) {
      Expr expr;
      expr.kind = Expr::Kind::LitUndefined;
      expr.type = TypeKind::Undefined;
      return expr;
    }
    if (check(Tok::Ident)) {
      const std::string name = qualified();
      if (eat(Tok::LParen)) {
        Expr expr;
        expr.kind = Expr::Kind::Call;
        expr.text = name;
        if (!check(Tok::RParen)) {
          do {
            expr.kids.push_back(parseExpr());
          } while (eat(Tok::Comma));
        }
        expect(Tok::RParen, "调用缺少 )");
        return expr;
      }
      Expr expr;
      expr.kind = Expr::Kind::Name;
      expr.text = name;
      return expr;
    }
    if (eat(Tok::LParen)) {
      if (check(Tok::Ident) && typeName(peek().text)) {
        const ParsedType parsed = parseType();
        expect(Tok::RParen, "转换缺少 )");
        Expr expr;
        expr.kind = Expr::Kind::Cast;
        expr.type = parsed.kind;
        expr.pointee = parsed.pointee;
        expr.kids.push_back(parseUnary());
        return expr;
      }
      Expr expr = parseExpr();
      expect(Tok::RParen, "表达式缺少 )");
      return expr;
    }
    fail("表达式不完整");
  }
};

}  // namespace

SourceFile parseSource(const std::string& source, bool header) { return Parser(lex(source), header).parseFile(); }

}  // namespace obr
