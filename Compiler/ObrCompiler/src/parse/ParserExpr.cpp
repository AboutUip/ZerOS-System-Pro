#include "ParserImpl.hpp"

#include "../Diagnostic.hpp"
#include "../type/Type.hpp"

#include <initializer_list>
#include <string>
#include <utility>
#include <vector>

namespace obr {
namespace parse {

  Expr Parser::parseAssign() {
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

  Expr Parser::parseTernary() {
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

  Expr Parser::parsePow() {
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

  Expr Parser::parseBinary(Level next, std::initializer_list<Tok> ops) {
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

  Expr Parser::parseUnary() {
    const Tok op = peek().kind;
    if (op == Tok::Await) {
      take();
      Expr expr;
      expr.kind = Expr::Kind::Await;
      expr.kids.push_back(parseUnary());
      return expr;
    }
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

  Expr Parser::parsePost() {
    Expr expr = parsePrimary();
    /* . 和 [] 同级交错：`a[0].b`、`a.b[0].c` 都是合法后缀链。 */
    for (;;) {
      if (eat(Tok::Dot)) {
        if (!check(Tok::Ident)) fail("成员缺少名字");
        std::string member = take().text;
        /* 缺口 5：泛型方法调用 obj.f[int](...)（`[` 后紧跟 `(` 才是类型实参）。 */
        if (check(Tok::LBracket) && genericCallAhead()) {
          take();
          member += typeArgsText();
        }
        if (eat(Tok::LParen)) {
          Expr call;
          call.kind = Expr::Kind::Call;
          call.integer = -4;
          call.text = member;
          call.kids.push_back(std::move(expr));
          if (!check(Tok::RParen)) {
            do {
              call.kids.push_back(parseExpr());
            } while (eat(Tok::Comma));
          }
          expect(Tok::RParen, "成员调用缺少 )");
          expr = std::move(call);
          continue;
        }
        Expr field;
        field.kind = Expr::Kind::Member;
        field.text = member;
        field.kids.push_back(std::move(expr));
        expr = std::move(field);
        continue;
      }
      if (eat(Tok::LBracket)) {
        Expr index;
        index.kind = Expr::Kind::Binary;
        index.op = Tok::LBracket;
        index.kids.push_back(std::move(expr));
        index.kids.push_back(parseExpr());
        expect(Tok::RBracket, "下标缺少 ]");
        expr = std::move(index);
        continue;
      }
      break;
    }
    /* `?` 是失败传播后缀（M3）。三元的 `?` 后面一定是表达式；只有后面紧跟
       `;` `)` `]` `,` `}` `:` 或文件尾时才当传播，避免和 `a ? b : c` 混淆。 */
    if (check(Tok::Question)) {
      const Tok next = tokens_.size() > static_cast<std::size_t>(at_ + 1) ? tokens_[static_cast<std::size_t>(at_ + 1)].kind : Tok::End;
      if (next == Tok::Semi || next == Tok::RParen || next == Tok::RBracket || next == Tok::Comma
        || next == Tok::RBrace || next == Tok::Colon || next == Tok::End) {
        take();
        expr.propagates = true;
      }
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

  Expr Parser::parsePrimary() {
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
    if (eat(Tok::New)) {
      if (check(Tok::Ident) && collectionWord(peek().text)) {
        const int next = at_ + 1;
        if (next < static_cast<int>(tokens_.size()) && tokens_[static_cast<std::size_t>(next)].kind == Tok::LBracket) {
          const ParsedType parsed = parseType();
          Expr expr;
          expr.kind = Expr::Kind::New;
          expr.integer = -6;
          expr.type = parsed.kind;
          expr.pointee = parsed.pointee;
          expr.volatilePointee = parsed.volatilePointee;
          expr.alt = parsed.alt;
          expr.typeName = parsed.typeName;
          expr.altName = parsed.altName;
          expect(Tok::LParen, "new 缺少 (");
          if (!check(Tok::RParen)) {
            do {
              expr.kids.push_back(parseExpr());
            } while (eat(Tok::Comma));
          }
          expect(Tok::RParen, "new 缺少 )");
          return expr;
        }
      }
      if (!check(Tok::Ident)) fail("new 缺少类名");
      Expr expr;
      expr.kind = Expr::Kind::New;
      expr.text = take().text;
      /* M5：泛型实例化 new Name[T, ...](...)。 */
      if (check(Tok::LBracket)) {
        take();
        expr.text += typeArgsText();
      }
      expect(Tok::LParen, "new 缺少 (");
      if (!check(Tok::RParen)) {
        do {
          expr.kids.push_back(parseExpr());
        } while (eat(Tok::Comma));
      }
      expect(Tok::RParen, "new 缺少 )");
      return expr;
    }
    /* M-A：sizeof(T) / alignof(T) / offsetof(T, 字段名) 编译期内建（解析期特判）。
       形态是 Call + 负标记（-8 = sizeof/alignof，-9 = offsetof），类型实参存在
       type/pointee/alt/typeName/altName 五元组里，offsetof 的字段名存在 labels[0]；
       Sema 期直接折成 LitInt，不新增 AST 节点。 */
    if (layoutBuiltinAhead()) return parseLayoutBuiltin();
    if (check(Tok::Ident)) {
      const std::string name = qualified();
      if (eat(Tok::LBrace)) {
        Expr expr;
        expr.kind = Expr::Kind::StructLiteral;
        expr.text = name;
        if (!check(Tok::RBrace)) {
          do {
            if (!check(Tok::Ident)) fail("结构体字面量缺少字段名");
            expr.labels.push_back(take().text);
            expect(Tok::Assign, "结构体字面量字段缺少 =");
            expr.kids.push_back(parseExpr());
          } while (eat(Tok::Comma));
        }
        expect(Tok::RBrace, "结构体字面量缺少 }");
        return expr;
      }
      /* M-B：span[T](地址, 个数) 是切片构造（Call + 负标记 -10，两字值类型零分配）。
         只认裸「span[」形态；`obr::text::span(...)`、`obr::ui::span(...)` 等调用保持现状。 */
      if (name == "span" && check(Tok::LBracket) && genericCallAhead()) {
        const ParsedType parsed = parseSpan();
        Expr expr;
        expr.kind = Expr::Kind::Call;
        expr.op = Tok::End;
        expr.integer = -10;
        expr.type = parsed.kind;
        expr.pointee = parsed.pointee;
        expr.volatilePointee = parsed.volatilePointee;
        expr.alt = parsed.alt;
        expr.typeName = parsed.typeName;
        expr.altName = parsed.altName;
        expect(Tok::LParen, "span 构造缺少 (");
        if (!check(Tok::RParen)) {
          do {
            expr.kids.push_back(parseExpr());
          } while (eat(Tok::Comma));
        }
        expect(Tok::RParen, "span 构造缺少 )");
        return expr;
      }
      if (check(Tok::LBracket) && genericCallAhead()) {
        /* M5：泛型调用 f[T, ...](...)。 */
        take();
        const std::string args = typeArgsText();
        expect(Tok::LParen, "泛型调用缺少 (");
        Expr expr;
        expr.kind = Expr::Kind::Call;
        expr.text = name + args;
        if (!check(Tok::RParen)) {
          do {
            expr.kids.push_back(parseExpr());
          } while (eat(Tok::Comma));
        }
        expect(Tok::RParen, "调用缺少 )");
        return expr;
      }
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
      if (looksLikePointerCast() || looksLikeScalarCast()) {
        const ParsedType parsed = parseType();
        expect(Tok::RParen, "转换缺少 )");
        Expr expr;
        expr.kind = Expr::Kind::Cast;
        expr.type = parsed.kind;
        expr.pointee = parsed.pointee;
        expr.volatilePointee = parsed.volatilePointee;
        expr.typeName = parsed.typeName;
        expr.kids.push_back(parseUnary());
        return expr;
      }
      Expr expr = parseExpr();
      expect(Tok::RParen, "表达式缺少 )");
      return expr;
    }
    fail("表达式不完整");
  }

  bool Parser::layoutBuiltinAhead() const {
    if (!check(Tok::Ident)) return false;
    const std::string& word = peek().text;
    if (word != "sizeof" && word != "alignof" && word != "offsetof") return false;
    const int next = at_ + 1;
    return next < static_cast<int>(tokens_.size()) && tokens_[static_cast<std::size_t>(next)].kind == Tok::LParen;
  }

  Expr Parser::parseLayoutBuiltin() {
    const std::string name = take().text;
    expect(Tok::LParen, name + " 缺少 (");
    const ParsedType parsed = parseType();
    Expr expr;
    expr.kind = Expr::Kind::Call;
    expr.op = Tok::End;
    expr.integer = name == "offsetof" ? -9 : -8;
    expr.text = name;
    expr.type = parsed.kind;
    expr.pointee = parsed.pointee;
    expr.volatilePointee = parsed.volatilePointee;
    expr.alt = parsed.alt;
    expr.typeName = parsed.typeName;
    expr.altName = parsed.altName;
    if (name == "offsetof") {
      expect(Tok::Comma, "offsetof 要写成 offsetof(类型, 字段名)");
      if (!check(Tok::Ident)) fail("offsetof 缺少字段名");
      expr.labels.push_back(take().text);
    }
    expect(Tok::RParen, name + " 缺少 )");
    return expr;
  }

}  // namespace parse
}  // namespace obr
