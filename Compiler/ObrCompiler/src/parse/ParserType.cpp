#include "ParserImpl.hpp"

#include "../Diagnostic.hpp"
#include "../type/Type.hpp"

#include <initializer_list>
#include <string>
#include <utility>
#include <vector>

namespace obr {
namespace parse {

  Parser::ParsedType Parser::parseCollection() {
    const std::string which = take().text;
    expect(Tok::LBracket, "集合缺少 [");
    const ParsedType elem = parseType();
    ParsedType value;
    if (which == "map") {
      expect(Tok::Comma, "map 要写成 map[键, 值]");
      value = parseType();
    }
    expect(Tok::RBracket, "集合缺少 ]");
    if (check(Tok::Star)) fail("集合已经是引用");
    ParsedType parsed;
    if (which == "array") parsed.kind = TypeKind::Array;
    else if (which == "list") parsed.kind = TypeKind::List;
    else if (which == "set") parsed.kind = TypeKind::Set;
    else parsed.kind = TypeKind::Map;
    parsed.pointee = elem.kind;
    parsed.typeName = describe(elem);
    parsed.alt = value.kind;
    parsed.altName = which == "map" ? describe(value) : "";
    if (parsed.typeName.empty() || (which == "map" && parsed.altName.empty())) fail("集合缺少元素类型");
    return parsed;
  }

  /* M-B：span[元素] 是两字切片值类型（元素位地址 + 元素个数）。类型位置识别 span[T]；
     裸 span(...) 调用保持现状（obr::ui::span / obr::text::span 不受影响）。
     进来时 span 字已吃掉，当前位置是 [。 */
  Parser::ParsedType Parser::parseSpan() {
    expect(Tok::LBracket, "span 缺少 [");
    const ParsedType elem = parseType();
    expect(Tok::RBracket, "span 缺少 ]");
    if (check(Tok::Star)) fail("span 已经是引用");
    ParsedType parsed;
    parsed.kind = TypeKind::Span;
    parsed.pointee = elem.kind;
    parsed.typeName = describe(elem);
    if (parsed.typeName.empty()) fail("span 缺少元素类型");
    return parsed;
  }

  Parser::ParsedType Parser::parseType() {
    /* M-D：`volatile T*` 是指向 volatile 的指针（MMIO/共享字访问面）。
       限定词只在「标量类型」「名字*」「名字::」「集合/span[」形态后认，见 volatileQualifier。 */
    if (volatileQualifier()) {
      ParsedType parsed = parseType();
      if (parsed.kind != TypeKind::Ptr) fail("volatile 只能修饰指针类型，要写 volatile T*");
      if (!volatileWord(parsed.pointee)) fail("volatile 指针的点类型只能是单字标量（byte/short/int/long/float/double/boolean/char）");
      parsed.volatilePointee = true;
      return parsed;
    }
    if (check(Tok::Ident) && collectionWord(peek().text)) {
      const int next = at_ + 1;
      if (next < static_cast<int>(tokens_.size()) && tokens_[static_cast<std::size_t>(next)].kind == Tok::LBracket) return parseCollection();
    }
    if (check(Tok::Ident) && spanWord(peek().text)) {
      const int next = at_ + 1;
      if (next < static_cast<int>(tokens_.size()) && tokens_[static_cast<std::size_t>(next)].kind == Tok::LBracket) {
        take();
        return parseSpan();
      }
    }
    if (!check(Tok::Ident)) fail("缺少类型");
    ParsedType parsed;
    const int next = at_ + 1;
    const bool qualified = next < static_cast<int>(tokens_.size()) && tokens_[static_cast<std::size_t>(next)].kind == Tok::Scope;
    if (!typeName(peek().text) || qualified) {
      parsed.typeName = typeIdent();
      /* M5：泛型实例化 Name[T, ...]（文本承载，单态化在 Sema 前置遍）。 */
      if (check(Tok::LBracket)) {
        take();
        parsed.typeName += typeArgsText();
      }
      if (check(Tok::Pow)) fail("这一版只接受一层指针");
      if (eat(Tok::Star)) {
        parsed.kind = TypeKind::Ptr;
        parsed.pointee = TypeKind::Void;
        if (check(Tok::Star) || check(Tok::Pow)) fail("这一版只接受一层指针");
      }
      return parsed;
    }
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

  TypeKind Parser::typeOf(const std::string& name) {
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

  std::string Parser::qualified() {
    if (!check(Tok::Ident)) fail("缺少名字");
    std::string name = take().text;
    while (eat(Tok::Scope)) {
      if (!check(Tok::Ident)) fail("限定名不完整");
      name += "::";
      name += take().text;
    }
    return name;
  }

}  // namespace parse
}  // namespace obr
