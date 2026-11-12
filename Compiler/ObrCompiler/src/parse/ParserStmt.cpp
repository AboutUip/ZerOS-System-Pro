#include "ParserImpl.hpp"

#include "../Diagnostic.hpp"
#include "../type/Type.hpp"

#include <initializer_list>
#include <string>
#include <utility>
#include <vector>

namespace obr {
namespace parse {

  Stmt Parser::parseStmt() {
    const int opened = peek().line;
    if (eat(Tok::Semi)) return finishStmt(Stmt{}, opened);
    if (eat(Tok::LBrace)) {
      Stmt stmt;
      stmt.kind = Stmt::Kind::Block;
      while (!check(Tok::RBrace) && !check(Tok::End)) stmt.body.push_back(parseStmt());
      expect(Tok::RBrace, "语句块缺少 }");
      return finishStmt(stmt, opened);
    }
    if (eat(Tok::If)) {
      Stmt stmt;
      stmt.kind = Stmt::Kind::If;
      expect(Tok::LParen, "if 缺少 (");
      stmt.expr = parseExpr();
      expect(Tok::RParen, "if 缺少 )");
      stmt.body.push_back(parseStmt());
      if (eat(Tok::Else)) stmt.other.push_back(parseStmt());
      return finishStmt(stmt, opened);
    }
    if (eat(Tok::Try)) {
      return parseStmtTry(opened);
    }
    if (eat(Tok::Throw)) {
      Stmt stmt;
      stmt.kind = Stmt::Kind::Throw;
      stmt.expr = parseExpr();
      expect(Tok::Semi, "throw 缺少 ;");
      return finishStmt(std::move(stmt), opened);
    }
    if (eat(Tok::Switch)) {
      return parseStmtSwitch(opened);
    }
    if (eat(Tok::While)) {
      Stmt stmt;
      stmt.kind = Stmt::Kind::While;
      expect(Tok::LParen, "while 缺少 (");
      stmt.expr = parseExpr();
      expect(Tok::RParen, "while 缺少 )");
      stmt.body.push_back(parseStmt());
      return finishStmt(stmt, opened);
    }
    if (eat(Tok::For)) {
      return parseStmtFor(opened);
    }
    if (eat(Tok::Break)) {
      expect(Tok::Semi, "break 缺少 ;");
      Stmt stmt;
      stmt.kind = Stmt::Kind::Break;
      return finishStmt(stmt, opened);
    }
    if (eat(Tok::Continue)) {
      expect(Tok::Semi, "continue 缺少 ;");
      Stmt stmt;
      stmt.kind = Stmt::Kind::Continue;
      return finishStmt(stmt, opened);
    }
    if (eat(Tok::Fallthrough)) {
      expect(Tok::Semi, "fallthrough 缺少 ;");
      Stmt stmt;
      stmt.kind = Stmt::Kind::Fallthrough;
      return finishStmt(stmt, opened);
    }
    if (check(Tok::Zap)) {
      const Token token = take();
      Stmt stmt;
      stmt.kind = Stmt::Kind::Zap;
      stmt.name = token.text;
      stmt.line = token.line;
      return finishStmt(stmt, opened);
    }
    if (eat(Tok::Goto)) {
      if (!check(Tok::Ident)) fail("goto 缺少标号");
      Stmt stmt;
      stmt.kind = Stmt::Kind::Goto;
      stmt.name = take().text;
      expect(Tok::Semi, "goto 缺少 ;");
      return finishStmt(stmt, opened);
    }
    if (check(Tok::Ident) && at_ + 1 < static_cast<int>(tokens_.size()) && tokens_[static_cast<std::size_t>(at_ + 1)].kind == Tok::Colon) {
      Stmt stmt;
      stmt.kind = Stmt::Kind::Label;
      stmt.name = take().text;
      expect(Tok::Colon, "标号缺少 :");
      return finishStmt(stmt, opened);
    }
    if (eat(Tok::Return)) {
      Stmt stmt;
      stmt.kind = Stmt::Kind::Return;
      if (!check(Tok::Semi)) stmt.expr = parseExpr();
      expect(Tok::Semi, "return 缺少 ;");
      return finishStmt(stmt, opened);
    }
    bool isStatic = false;
    if (eat(Tok::Public) || eat(Tok::Private)) {
      expect(Tok::Static, "public 或 private 后面必须是 static");
      isStatic = true;
    } else if (eat(Tok::Static)) {
      isStatic = true;
    }
    if (eat(Tok::Const)) {
      return parseStmtConst(opened, isStatic);
    }
    if (eat(Tok::Var)) {
      return parseStmtVar(opened, isStatic);
    }
    if (looksLikeDecl()) {
      return parseStmtDecl(opened, isStatic);
    }
    if (isStatic) fail("static 后面必须是变量声明");
    Stmt stmt;
    stmt.kind = Stmt::Kind::Expr;
    stmt.expr = parseExpr();
    expect(Tok::Semi, "语句缺少 ;");
    return finishStmt(stmt, opened);
  }

  Stmt Parser::finishStmt(Stmt stmt, int opened) {
    if (stmt.line == 0) stmt.line = opened;
    return stmt;
  }

  Stmt Parser::parseStmtTry(int opened) {
      Stmt stmt;
      stmt.kind = Stmt::Kind::Try;
      expect(Tok::LBrace, "try 缺少 {");
      while (!check(Tok::RBrace) && !check(Tok::End)) stmt.body.push_back(parseStmt());
      expect(Tok::RBrace, "try 缺少 }");
      expect(Tok::Catch, "try 缺少 catch");
      expect(Tok::LParen, "catch 缺少 (");
      const ParsedType parsed = parseType();
      stmt.type = parsed.kind;
      stmt.pointee = parsed.pointee;
      stmt.volatilePointee = parsed.volatilePointee;
      stmt.alt = parsed.alt;
      stmt.typeName = parsed.typeName;
      stmt.altName = parsed.altName;
      if (!check(Tok::Ident)) fail("catch 缺少变量名");
      stmt.name = take().text;
      expect(Tok::RParen, "catch 缺少 )");
      expect(Tok::LBrace, "catch 缺少 {");
      while (!check(Tok::RBrace) && !check(Tok::End)) stmt.other.push_back(parseStmt());
      expect(Tok::RBrace, "catch 缺少 }");
      return finishStmt(std::move(stmt), opened);
    }

  Stmt Parser::parseStmtSwitch(int opened) {
      Stmt stmt;
      stmt.kind = Stmt::Kind::Switch;
      expect(Tok::LParen, "switch 缺少 (");
      stmt.expr = parseExpr();
      expect(Tok::RParen, "switch 缺少 )");
      expect(Tok::LBrace, "switch 缺少 {");
      while (!check(Tok::RBrace) && !check(Tok::End)) {
        const int armLine = peek().line;
        if (eat(Tok::Case)) {
          Stmt arm;
          arm.kind = Stmt::Kind::Case;
          arm.line = armLine;
          arm.expr = parseExpr();
          expect(Tok::Colon, "case 缺少 :");
          while (!check(Tok::Case) && !check(Tok::Default) && !check(Tok::RBrace) && !check(Tok::End)) {
            arm.body.push_back(parseStmt());
          }
          stmt.body.push_back(std::move(arm));
          continue;
        }
        if (eat(Tok::Default)) {
          Stmt arm;
          arm.kind = Stmt::Kind::Default;
          arm.line = armLine;
          expect(Tok::Colon, "default 缺少 :");
          while (!check(Tok::Case) && !check(Tok::Default) && !check(Tok::RBrace) && !check(Tok::End)) {
            arm.body.push_back(parseStmt());
          }
          stmt.body.push_back(std::move(arm));
          continue;
        }
        fail("switch 里只能写 case 或 default");
      }
      expect(Tok::RBrace, "switch 缺少 }");
      return finishStmt(stmt, opened);
    }

  Stmt Parser::parseStmtFor(int opened) {
      Stmt stmt;
      expect(Tok::LParen, "for 缺少 (");
      if (looksLikeForIn()) {
        stmt.kind = Stmt::Kind::ForIn;
        if (eat(Tok::Var)) {
          stmt.declares = true;
          expect(Tok::LBracket, "for-in 的 var 声明要写成 var[类型]");
          const ParsedType parsed = parseType();
          stmt.type = parsed.kind;
          stmt.pointee = parsed.pointee;
          stmt.volatilePointee = parsed.volatilePointee;
          stmt.alt = parsed.alt;
          stmt.typeName = parsed.typeName;
          stmt.altName = parsed.altName;
          expect(Tok::RBracket, "for-in 的 var 声明缺少 ]");
        }
        if (!check(Tok::Ident)) fail("for-in 缺少循环变量");
        stmt.name = take().text;
        if (!inWordAt(at_)) fail("for-in 缺少 in");
        take();
        stmt.expr = parseExpr();
        expect(Tok::RParen, "for-in 缺少 )");
        stmt.body.push_back(parseStmt());
        return finishStmt(stmt, opened);
      }
      stmt.kind = Stmt::Kind::For;
      stmt.other.push_back(parseStmt());
      if (!check(Tok::Semi)) stmt.expr = parseExpr();
      expect(Tok::Semi, "for 缺少条件后的 ;");
      if (!check(Tok::RParen)) {
        Stmt step;
        step.kind = Stmt::Kind::Expr;
        step.line = peek().line;
        step.expr = parseExpr();
        stmt.other.push_back(step);
      } else {
        stmt.other.push_back(Stmt{});
      }
      expect(Tok::RParen, "for 缺少 )");
      stmt.body.push_back(parseStmt());
      return finishStmt(stmt, opened);
    }

  Stmt Parser::parseStmtConst(int opened, bool isStatic) {
      if (isStatic) fail("const 不能和 static 连用");
      Stmt stmt;
      stmt.kind = Stmt::Kind::Const;
      const ParsedType parsed = parseType();
      stmt.type = parsed.kind;
      stmt.pointee = parsed.pointee;
      stmt.volatilePointee = parsed.volatilePointee;
      stmt.alt = parsed.alt;
      stmt.typeName = parsed.typeName;
      stmt.altName = parsed.altName;
      if (stmt.type == TypeKind::Void) fail("常量不能是 void");
      stmt.name = take().text;
      expect(Tok::Assign, "常量缺少 =");
      stmt.expr = parseExpr();
      expect(Tok::Semi, "常量缺少 ;");
      return finishStmt(stmt, opened);
    }

  Stmt Parser::parseStmtVar(int opened, bool isStatic) {
      expect(Tok::LBracket, "var 声明要写成 var[类型]");
      Stmt stmt;
      stmt.kind = Stmt::Kind::Decl;
      stmt.isStatic = isStatic;
      const ParsedType parsed = parseType();
      stmt.type = parsed.kind;
      stmt.pointee = parsed.pointee;
      stmt.volatilePointee = parsed.volatilePointee;
      stmt.alt = parsed.alt;
      stmt.typeName = parsed.typeName;
      stmt.altName = parsed.altName;
      if (stmt.type == TypeKind::Void) fail("变量不能是 void");
      expect(Tok::RBracket, "var 声明缺少 ]");
      stmt.name = take().text;
      if (eat(Tok::Assign)) stmt.expr = parseExpr();
      expect(Tok::Semi, "声明缺少 ;");
      return finishStmt(stmt, opened);
    }

  Stmt Parser::parseStmtDecl(int opened, bool isStatic) {
      Stmt stmt;
      stmt.kind = Stmt::Kind::Decl;
      stmt.isStatic = isStatic;
      const ParsedType parsed = parseType();
      stmt.type = parsed.kind;
      stmt.pointee = parsed.pointee;
      stmt.volatilePointee = parsed.volatilePointee;
      stmt.alt = parsed.alt;
      stmt.typeName = parsed.typeName;
      stmt.altName = parsed.altName;
      if (stmt.type == TypeKind::Void) fail("变量不能是 void");
      stmt.name = take().text;
      if (eat(Tok::Assign)) stmt.expr = parseExpr();
      expect(Tok::Semi, "声明缺少 ;");
      return finishStmt(stmt, opened);
    }

}  // namespace parse
}  // namespace obr
