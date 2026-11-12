#include "ParserImpl.hpp"

#include "../Diagnostic.hpp"
#include "../type/Type.hpp"

#include <initializer_list>
#include <string>
#include <utility>
#include <vector>

namespace obr {
namespace parse {

  SourceFile Parser::parseFile() {
    SourceFile file;
    while (tokens_[static_cast<std::size_t>(at_)].kind == Tok::Version) {
      const std::string line = tokens_[static_cast<std::size_t>(at_)].text;
      at_ += 1;
      const std::string rest = line.size() > 8 ? line.substr(8) : "";
      std::size_t index = 0;
      while (index < rest.size() && (rest[index] == ' ' || rest[index] == '\t')) index += 1;
      const std::string version = rest.substr(index);
      if (version != "1" && version != "2") fail("#VERSION 只接受语言版本 1 或 2");
      file.version = version == "2" ? 2 : 1;
      file.versionSet = true;
    }
    while (tokens_[static_cast<std::size_t>(at_)].kind == Tok::Link || tokens_[static_cast<std::size_t>(at_)].kind == Tok::Dyn) {
      const std::string line = tokens_[static_cast<std::size_t>(at_)].text;
      at_ += 1;
      if (line.rfind("#DYN", 0) == 0) {
        std::string rest = line.size() > 4 ? line.substr(4) : "";
        std::size_t begin = 0;
        while (begin < rest.size() && (rest[begin] == ' ' || rest[begin] == '\t')) begin += 1;
        if (begin != rest.size()) fail("#DYN 不接受参数");
        file.dyn = true;
        continue;
      }
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

  bool Parser::eat(Tok kind) {
    if (!check(kind)) return false;
    at_ += 1;
    return true;
  }

  void Parser::expect(Tok kind, const std::string& message) {
    if (!eat(kind)) fail(message);
  }

  bool Parser::collectionWord(const std::string& name) const {
    return name == "array" || name == "list" || name == "set" || name == "map";
  }

  /* M-B：span 只在「span[」形态下是切片类型；裸 span 标识符（含 span(...) 调用）保持现状。 */
  bool Parser::spanWord(const std::string& name) const {
    return name == "span";
  }

  /* M-C：参数位开头的 `out` / `ref` 修饰词。只有后跟「类型 + 参数名」形态才认：
     类型关键字、集合/span（名字[）、限定名（名字::）、指针（名字*）、命名类型（名字 名字）。
     其余形态（`out x)` 的类型名用法、变量名）不动，叫 out/ref 的类型仍能当参数类型写。 */
  ParamMode Parser::takeParamModifier() {
    if (!check(Tok::Ident)) return ParamMode::None;
    const std::string word = peek().text;
    if (word != "out" && word != "ref") return ParamMode::None;
    const int next = at_ + 1;
    const int size = static_cast<int>(tokens_.size());
    if (next >= size || tokens_[static_cast<std::size_t>(next)].kind != Tok::Ident) return ParamMode::None;
    const std::string after = tokens_[static_cast<std::size_t>(next)].text;
    bool modifier = typeName(after);
    if (!modifier && next + 1 < size) {
      const Tok third = tokens_[static_cast<std::size_t>(next + 1)].kind;
      modifier = third == Tok::LBracket || third == Tok::Scope || third == Tok::Star || third == Tok::Ident;
    }
    if (!modifier) return ParamMode::None;
    take();
    return word == "out" ? ParamMode::Out : ParamMode::Ref;
  }

  /* M-D：类型位开头的 `volatile` 限定词（写成 `volatile T*`，T 是单字标量）。
     只有后跟「标量类型」「名字*」「名字::」「集合/span[」形态才认；
     `volatile*`（叫 volatile 的类型取指针）、`volatile x`（叫 volatile 的变量）不动。 */
  bool Parser::volatileQualifier() {
    if (!check(Tok::Ident)) return false;
    if (peek().text != "volatile") return false;
    const int next = at_ + 1;
    const int size = static_cast<int>(tokens_.size());
    if (next >= size || tokens_[static_cast<std::size_t>(next)].kind != Tok::Ident) return false;
    const std::string after = tokens_[static_cast<std::size_t>(next)].text;
    bool qualifier = typeName(after);
    if (!qualifier && next + 1 < size) {
      const Tok third = tokens_[static_cast<std::size_t>(next + 1)].kind;
      qualifier = third == Tok::Star || third == Tok::Scope
        || (third == Tok::LBracket && (collectionWord(after) || spanWord(after)));
    }
    if (!qualifier) return false;
    take();
    return true;
  }

  bool Parser::volatileWord(TypeKind kind) {
    return kind == TypeKind::Byte || kind == TypeKind::Short || kind == TypeKind::Int || kind == TypeKind::Long
      || kind == TypeKind::Float || kind == TypeKind::Double || kind == TypeKind::Boolean || kind == TypeKind::Char;
  }

  bool Parser::genericCallAhead() const {
    int index = at_;
    int depth = 0;
    const int size = static_cast<int>(tokens_.size());
    while (index < size) {
      if (tokens_[static_cast<std::size_t>(index)].kind == Tok::LBracket) depth += 1;
      else if (tokens_[static_cast<std::size_t>(index)].kind == Tok::RBracket) {
        depth -= 1;
        if (depth == 0) {
          return index + 1 < size && tokens_[static_cast<std::size_t>(index + 1)].kind == Tok::LParen;
        }
      }
      index += 1;
    }
    return false;
  }

  bool Parser::genericDeclAhead() const {
    const int size = static_cast<int>(tokens_.size());
    int index = at_ + 1;
    if (index >= size || tokens_[static_cast<std::size_t>(index)].kind != Tok::LBracket) return false;
    int depth = 0;
    while (index < size) {
      if (tokens_[static_cast<std::size_t>(index)].kind == Tok::LBracket) depth += 1;
      else if (tokens_[static_cast<std::size_t>(index)].kind == Tok::RBracket) {
        depth -= 1;
        if (depth == 0) {
          index += 1;
          return index < size && tokens_[static_cast<std::size_t>(index)].kind == Tok::Ident;
        }
      }
      index += 1;
    }
    return false;
  }

  std::string Parser::typeArgsText() {
    std::string text = "<";
    for (;;) {
      const ParsedType arg = parseType();
      text += describe(arg);
      if (!eat(Tok::Comma)) break;
      text += ",";
    }
    expect(Tok::RBracket, "泛型实参缺少 ]");
    text += ">";
    return text;
  }

  void Parser::parseTypeParams(std::vector<std::string>& params, std::vector<std::string>& bounds) {
    do {
      if (!check(Tok::Ident)) fail("泛型缺少类型参数名");
      params.push_back(take().text);
      if (eat(Tok::Colon)) {
        if (!check(Tok::Ident)) fail("泛型约束缺少类名");
        bounds.push_back(typeIdent());
      } else {
        bounds.push_back(std::string());
      }
    } while (eat(Tok::Comma));
    expect(Tok::RBracket, "泛型实参缺少 ]");
  }

  std::string Parser::describe(const ParsedType& type) const {
    if (type.kind == TypeKind::Array) return "array[" + type.typeName + "]";
    if (type.kind == TypeKind::List) return "list[" + type.typeName + "]";
    if (type.kind == TypeKind::Set) return "set[" + type.typeName + "]";
    if (type.kind == TypeKind::Map) return "map[" + type.typeName + "," + type.altName + "]";
    /* M-B：span[元素] 的描述与集合同一形状（typeName 是元素描述）。 */
    if (type.kind == TypeKind::Span) return "span[" + type.typeName + "]";
    if (type.kind == TypeKind::Ptr) {
      std::string text;
      if (!type.typeName.empty() && type.pointee == TypeKind::Void) text = type.typeName + "*";
      else text = std::string(nameOf(type.pointee)) + "*";
      /* M-D：`volatile T*` 的描述带 volatile 前缀（集合元素/泛型实参文本往返一致）。 */
      return type.volatilePointee ? "volatile " + text : text;
    }
    if (type.kind == TypeKind::None) return type.typeName;
    return nameOf(type.kind);
  }

  bool Parser::scanTypeAt(int& index) const {
    const int size = static_cast<int>(tokens_.size());
    if (index >= size || tokens_[static_cast<std::size_t>(index)].kind != Tok::Ident) return false;
    const std::string name = tokens_[static_cast<std::size_t>(index)].text;
    /* M-B：span[元素] 与单元素集合同一扫描形状（span[ 后面是类型位置）。 */
    if (collectionWord(name) || spanWord(name)) {
      if (index + 1 >= size || tokens_[static_cast<std::size_t>(index + 1)].kind != Tok::LBracket) return false;
      index += 2;
      if (!scanTypeAt(index)) return false;
      if (name == "map") {
        if (index >= size || tokens_[static_cast<std::size_t>(index)].kind != Tok::Comma) return false;
        index += 1;
        if (!scanTypeAt(index)) return false;
      }
      if (index >= size || tokens_[static_cast<std::size_t>(index)].kind != Tok::RBracket) return false;
      index += 1;
      return true;
    }
    if (typeName(name)) {
      index += 1;
      if (index < size && tokens_[static_cast<std::size_t>(index)].kind == Tok::Star) index += 1;
      return true;
    }
    index += 1;
    while (index < size && tokens_[static_cast<std::size_t>(index)].kind == Tok::Scope) {
      index += 1;
      if (index >= size || tokens_[static_cast<std::size_t>(index)].kind != Tok::Ident) return false;
      index += 1;
    }
    if (index < size && tokens_[static_cast<std::size_t>(index)].kind == Tok::Star) index += 1;
    return true;
  }

  bool Parser::typeName(const std::string& name) const {
    return name == "byte" || name == "short" || name == "int" || name == "long" || name == "float" || name == "double" || name == "boolean" || name == "char" || name == "string" || name == "void";
  }

  bool Parser::looksLikePointerCast() const {
    int index = at_;
    const int size = static_cast<int>(tokens_.size());
    if (index >= size || tokens_[static_cast<std::size_t>(index)].kind != Tok::Ident) return false;
    /* M-D：`(volatile T*)` 同样是指针转换。 */
    if (tokens_[static_cast<std::size_t>(index)].text == "volatile") {
      index += 1;
      if (index >= size || tokens_[static_cast<std::size_t>(index)].kind != Tok::Ident) return false;
    }
    index += 1;
    while (index + 1 < size && tokens_[static_cast<std::size_t>(index)].kind == Tok::Scope && tokens_[static_cast<std::size_t>(index + 1)].kind == Tok::Ident) {
      index += 2;
    }
    return index + 1 < size && tokens_[static_cast<std::size_t>(index)].kind == Tok::Star && tokens_[static_cast<std::size_t>(index + 1)].kind == Tok::RParen;
  }

  bool Parser::scalarCastName(const std::string& name) const {
    return name == "byte" || name == "short" || name == "int" || name == "long" || name == "float"
      || name == "double" || name == "boolean" || name == "char";
  }

  bool Parser::looksLikeScalarCast() const {
    int index = at_;
    const int size = static_cast<int>(tokens_.size());
    if (index + 2 >= size) return false;
    if (tokens_[static_cast<std::size_t>(index)].kind != Tok::Ident) return false;
    if (!scalarCastName(tokens_[static_cast<std::size_t>(index)].text)) return false;
    if (tokens_[static_cast<std::size_t>(index + 1)].kind != Tok::RParen) return false;
    const Tok next = tokens_[static_cast<std::size_t>(index + 2)].kind;
    return next == Tok::Ident || next == Tok::Int || next == Tok::Float || next == Tok::StringLit
      || next == Tok::CharLit || next == Tok::True || next == Tok::False || next == Tok::Null
      || next == Tok::Undefined || next == Tok::LParen || next == Tok::Plus || next == Tok::Minus
      || next == Tok::Not || next == Tok::BitNot || next == Tok::Star || next == Tok::BitAnd
      || next == Tok::PlusPlus || next == Tok::MinusMinus || next == Tok::New || next == Tok::Await;
  }

  std::string Parser::typeIdent() {
    if (!check(Tok::Ident)) fail("缺少类型");
    std::string name = take().text;
    while (eat(Tok::Scope)) {
      if (!check(Tok::Ident)) fail("类型名不完整");
      name += "::";
      name += take().text;
    }
    return name;
  }

  bool Parser::looksLikeDecl() const {
    if (!check(Tok::Ident)) return false;
    if (genericDeclAhead()) return true;
    int index = at_;
    if (!scanTypeAt(index)) return false;
    const int size = static_cast<int>(tokens_.size());
    if (index < size && tokens_[static_cast<std::size_t>(index)].kind == Tok::Ident) return true;
    /* array[long]* 名字 仍是声明，解析类型时再拒绝。array[i] * 2 后面不是名字，保持表达式。 */
    if (index + 1 < size && tokens_[static_cast<std::size_t>(index)].kind == Tok::Star && tokens_[static_cast<std::size_t>(index + 1)].kind == Tok::Ident) return true;
    return typeName(peek().text);
  }

  bool Parser::inWordAt(int index) const {
    return index >= 0 && index < static_cast<int>(tokens_.size())
      && tokens_[static_cast<std::size_t>(index)].kind == Tok::Ident
      && tokens_[static_cast<std::size_t>(index)].text == "in";
  }

  bool Parser::looksLikeForIn() const {
    const int size = static_cast<int>(tokens_.size());
    int index = at_;
    if (index >= size) return false;
    if (tokens_[static_cast<std::size_t>(index)].kind == Tok::Ident) {
      return inWordAt(index + 1);
    }
    if (tokens_[static_cast<std::size_t>(index)].kind != Tok::Var) return false;
    index += 1;
    if (index >= size || tokens_[static_cast<std::size_t>(index)].kind != Tok::LBracket) return false;
    index += 1;
    if (!scanTypeAt(index)) return false;
    if (index >= size || tokens_[static_cast<std::size_t>(index)].kind != Tok::RBracket) return false;
    index += 1;
    if (index >= size || tokens_[static_cast<std::size_t>(index)].kind != Tok::Ident) return false;
    index += 1;
    return inWordAt(index);
  }

}  // namespace parse
}  // namespace obr
