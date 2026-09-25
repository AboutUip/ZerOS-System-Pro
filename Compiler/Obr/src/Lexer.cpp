#include "Lexer.hpp"

#include "Diagnostic.hpp"

#include <cctype>

namespace obr {
namespace {

bool identStart(char unit) { return std::isalpha(static_cast<unsigned char>(unit)) || unit == '_'; }

bool identPart(char unit) {
  return std::isalnum(static_cast<unsigned char>(unit)) || unit == '_';
}

Tok keyword(const std::string& text) {
  if (text == "if") return Tok::If;
  if (text == "else") return Tok::Else;
  if (text == "while") return Tok::While;
  if (text == "break") return Tok::Break;
  if (text == "continue") return Tok::Continue;
  if (text == "return") return Tok::Return;
  if (text == "goto") return Tok::Goto;
  if (text == "deRfun") return Tok::DeRfun;
  if (text == "import") return Tok::Import;
  if (text == "export") return Tok::Export;
  if (text == "namespace") return Tok::Namespace;
  if (text == "static") return Tok::Static;
  if (text == "public") return Tok::Public;
  if (text == "private") return Tok::Private;
  if (text == "var") return Tok::Var;
  if (text == "null") return Tok::Null;
  if (text == "undefined") return Tok::Undefined;
  if (text == "true") return Tok::True;
  if (text == "false") return Tok::False;
  return Tok::Ident;
}

char escape(char unit) {
  if (unit == 'n') return '\n';
  if (unit == 't') return '\t';
  if (unit == 'r') return '\r';
  if (unit == '0') return '\0';
  if (unit == '\\' || unit == '\'' || unit == '"') return unit;
  fail(std::string("未知转义 \\") + unit);
}

}  // namespace

std::vector<Token> lex(const std::string& source) {
  std::vector<Token> tokens;
  std::size_t index = 0;
  while (index < source.size()) {
    const char unit = source[index];
    if (unit == ' ' || unit == '\t' || unit == '\r' || unit == '\n') {
      index += 1;
      continue;
    }
    if (unit == '#') {
      std::size_t end = index;
      while (end < source.size() && source[end] != '\n') end += 1;
      const std::string line = source.substr(index, end - index);
      if (line.rfind("#VERSION", 0) == 0) {
        Token token;
        token.kind = Tok::Version;
        token.text = line;
        tokens.push_back(token);
      } else if (line.rfind("#LINK", 0) == 0) {
        Token token;
        token.kind = Tok::Link;
        token.text = line;
        tokens.push_back(token);
      } else {
        fail("这一版编译器还不接受 " + line);
      }
      index = end;
      continue;
    }
    if (unit == '/' && index + 1 < source.size() && source[index + 1] == '/') {
      while (index < source.size() && source[index] != '\n') index += 1;
      continue;
    }
    if (unit == '/' && index + 1 < source.size() && source[index + 1] == '*') {
      index += 2;
      bool closed = false;
      while (index + 1 < source.size()) {
        if (source[index] == '*' && source[index + 1] == '/') {
          index += 2;
          closed = true;
          break;
        }
        index += 1;
      }
      if (!closed) fail("注释没有结束");
      continue;
    }
    if (unit == '"') {
      index += 1;
      std::string value;
      while (index < source.size() && source[index] != '"') {
        if (source[index] == '\\') {
          index += 1;
          if (index >= source.size()) fail("字符串没有结束");
          value.push_back(escape(source[index]));
        } else {
          value.push_back(source[index]);
        }
        index += 1;
      }
      if (index >= source.size() || source[index] != '"') fail("字符串没有结束");
      index += 1;
      Token token;
      token.kind = Tok::StringLit;
      token.text = value;
      tokens.push_back(token);
      continue;
    }
    if (unit == '\'') {
      index += 1;
      if (index >= source.size()) fail("字符字面量没有结束");
      char value = 0;
      if (source[index] == '\'') {
        value = 0;
      } else {
        if (source[index] == '\\') {
          index += 1;
          if (index >= source.size()) fail("字符字面量没有结束");
          value = escape(source[index]);
        } else {
          value = source[index];
        }
        index += 1;
        if (index >= source.size() || source[index] != '\'') fail("字符字面量必须恰好一个字符");
      }
      index += 1;
      Token token;
      token.kind = Tok::CharLit;
      token.integer = static_cast<unsigned char>(value);
      tokens.push_back(token);
      continue;
    }
    if (unit == '0' && index + 1 < source.size() && (source[index + 1] == 'x' || source[index + 1] == 'X')) {
      index += 2;
      const std::size_t begin = index;
      while (index < source.size() && std::isxdigit(static_cast<unsigned char>(source[index]))) index += 1;
      if (index == begin) fail("0x 后面没有十六进制数字");
      const std::string digits = source.substr(begin, index - begin);
      bool asLong = false;
      if (index < source.size() && (source[index] == 'L' || source[index] == 'l')) {
        asLong = true;
        index += 1;
      }
      Token token;
      token.kind = Tok::Int;
      token.integer = std::stoll(digits, nullptr, 16);
      if (!asLong && token.integer >= -2147483648LL && token.integer <= 2147483647LL) token.text = "";
      else token.text = "L";
      tokens.push_back(token);
      continue;
    }
    if (std::isdigit(static_cast<unsigned char>(unit))) {
      std::size_t end = index;
      while (end < source.size() && std::isdigit(static_cast<unsigned char>(source[end]))) end += 1;
      bool fractional = false;
      if (end < source.size() && source[end] == '.') {
        fractional = true;
        end += 1;
        if (end >= source.size() || !std::isdigit(static_cast<unsigned char>(source[end]))) fail("小数点后面没有数字");
        while (end < source.size() && std::isdigit(static_cast<unsigned char>(source[end]))) end += 1;
      }
      char suffix = 0;
      if (end < source.size() && (source[end] == 'F' || source[end] == 'D' || source[end] == 'L' || source[end] == 'l')) {
        suffix = source[end];
        end += 1;
      }
      const std::string text = source.substr(index, end - index);
      Token token;
      token.text = text;
      if (fractional || suffix == 'F' || suffix == 'D') {
        token.kind = Tok::Float;
        token.number = std::stod(text);
        if (suffix == 'D') token.text = "D";
        else token.text = "F";
      } else {
        token.kind = Tok::Int;
        token.integer = std::stoll(text);
        token.text = "";
        if (suffix == 'L' || suffix == 'l' || token.integer < -2147483648LL || token.integer > 2147483647LL) token.text = "L";
      }
      tokens.push_back(token);
      index = end;
      continue;
    }
    if (source.compare(index, 7, "__zap__") == 0 && (index + 7 >= source.size() || !identPart(source[index + 7]))) {
      index += 7;
      while (index < source.size() && (source[index] == ' ' || source[index] == '\t' || source[index] == '\n' || source[index] == '\r')) index += 1;
      if (index >= source.size() || source[index] != '{') fail("__zap__ 后面必须是 {");
      index += 1;
      if (index < source.size() && source[index] == '\r') index += 1;
      if (index < source.size() && source[index] == '\n') index += 1;
      std::string body;
      while (index < source.size()) {
        std::size_t end = index;
        while (end < source.size() && source[end] != '\n') end += 1;
        std::string line = source.substr(index, end - index);
        if (!line.empty() && line.back() == '\r') line.pop_back();
        std::size_t trim = 0;
        while (trim < line.size() && (line[trim] == ' ' || line[trim] == '\t')) trim += 1;
        if (line.substr(trim) == "}") {
          index = end < source.size() ? end + 1 : end;
          break;
        }
        body += line;
        body.push_back('\n');
        index = end < source.size() ? end + 1 : end;
      }
      Token token;
      token.kind = Tok::Zap;
      token.text = body;
      tokens.push_back(token);
      continue;
    }
    if (identStart(unit)) {
      std::size_t end = index + 1;
      while (end < source.size() && identPart(source[end])) end += 1;
      Token token;
      token.text = source.substr(index, end - index);
      token.kind = keyword(token.text);
      tokens.push_back(token);
      index = end;
      continue;
    }
    Token token;
    const char next = index + 1 < source.size() ? source[index + 1] : 0;
    const char third = index + 2 < source.size() ? source[index + 2] : 0;
    auto take = [&](Tok kind, int width) {
      token.kind = kind;
      index += static_cast<std::size_t>(width);
    };
    if (unit == '*' && next == '*') take(Tok::Pow, 2);
    else if (unit == '+' && next == '+') take(Tok::PlusPlus, 2);
    else if (unit == '-' && next == '-') take(Tok::MinusMinus, 2);
    else if (unit == '+' && next == '=') take(Tok::PlusEq, 2);
    else if (unit == '-' && next == '=') take(Tok::MinusEq, 2);
    else if (unit == '*' && next == '=') take(Tok::StarEq, 2);
    else if (unit == '/' && next == '=') take(Tok::SlashEq, 2);
    else if (unit == '%' && next == '=') take(Tok::PercentEq, 2);
    else if (unit == '=' && next == '=') take(Tok::Eq, 2);
    else if (unit == '!' && next == '=') take(Tok::Ne, 2);
    else if (unit == '<' && next == '<' ) take(Tok::Shl, 2);
    else if (unit == '>' && next == '>' && third == '>') take(Tok::UShr, 3);
    else if (unit == '>' && next == '>') take(Tok::Shr, 2);
    else if (unit == '<' && next == '=') take(Tok::Le, 2);
    else if (unit == '>' && next == '=') take(Tok::Ge, 2);
    else if (unit == '&' && next == '&') take(Tok::And, 2);
    else if (unit == '|' && next == '|') take(Tok::Or, 2);
    else if (unit == '+') take(Tok::Plus, 1);
    else if (unit == '-') take(Tok::Minus, 1);
    else if (unit == '*') take(Tok::Star, 1);
    else if (unit == '/') take(Tok::Slash, 1);
    else if (unit == '%') take(Tok::Percent, 1);
    else if (unit == '!') take(Tok::Not, 1);
    else if (unit == '~') take(Tok::BitNot, 1);
    else if (unit == '<') take(Tok::Lt, 1);
    else if (unit == '>') take(Tok::Gt, 1);
    else if (unit == '&') take(Tok::BitAnd, 1);
    else if (unit == '|') take(Tok::BitOr, 1);
    else if (unit == '^') take(Tok::BitXor, 1);
    else if (unit == '=') take(Tok::Assign, 1);
    else if (unit == '?') take(Tok::Question, 1);
    else if (unit == '[') take(Tok::LBracket, 1);
    else if (unit == ']') take(Tok::RBracket, 1);
    else if (unit == '(') take(Tok::LParen, 1);
    else if (unit == ')') take(Tok::RParen, 1);
    else if (unit == '{') take(Tok::LBrace, 1);
    else if (unit == '}') take(Tok::RBrace, 1);
    else if (unit == ',') take(Tok::Comma, 1);
    else if (unit == ':' && next == ':') take(Tok::Scope, 2);
    else if (unit == ':') take(Tok::Colon, 1);
    else if (unit == ';') take(Tok::Semi, 1);
    else fail(std::string("无法识别的字符 ") + unit);
    tokens.push_back(token);
  }
  tokens.push_back(Token{});
  return tokens;
}

}  // namespace obr
