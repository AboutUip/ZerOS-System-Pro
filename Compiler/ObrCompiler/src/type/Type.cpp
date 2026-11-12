#include "Type.hpp"

#include "../Diagnostic.hpp"

#include <cctype>

namespace obr {

bool numeric(TypeKind type) {
  return type == TypeKind::Byte || type == TypeKind::Short || type == TypeKind::Int || type == TypeKind::Long || type == TypeKind::Float || type == TypeKind::Double;
}

bool integral(TypeKind type) {
  return type == TypeKind::Byte || type == TypeKind::Short || type == TypeKind::Int || type == TypeKind::Long;
}

int rank(TypeKind type) {
  if (type == TypeKind::Short) return 1;
  if (type == TypeKind::Int) return 2;
  if (type == TypeKind::Long) return 3;
  if (type == TypeKind::Float) return 4;
  if (type == TypeKind::Double) return 5;
  return 0;
}

TypeKind promote(TypeKind left, TypeKind right) {
  if (left == TypeKind::Byte || right == TypeKind::Byte) {
    if (left != TypeKind::Byte || right != TypeKind::Byte) fail("byte 不能和别的数值混用");
    return TypeKind::Byte;
  }
  if (left == right) return left;
  if (left == TypeKind::Double || right == TypeKind::Double) return TypeKind::Double;
  if (left == TypeKind::Float || right == TypeKind::Float) return TypeKind::Float;
  if (left == TypeKind::Long || right == TypeKind::Long) return TypeKind::Long;
  if (left == TypeKind::Int || right == TypeKind::Int) return TypeKind::Int;
  return TypeKind::Int;
}

bool labelText(const std::string& text) {
  if (text.empty() || !std::isalpha(static_cast<unsigned char>(text[0]))) return false;
  for (const char unit : text) {
    if (!std::isalnum(static_cast<unsigned char>(unit))) return false;
  }
  return true;
}

bool canWiden(TypeKind from, TypeKind to) {
  if (from == TypeKind::Undefined && to != TypeKind::Void) return true;
  if (from == to) return true;
  if (from == TypeKind::Char && (to == TypeKind::Int || to == TypeKind::Long)) return true;
  if (from == TypeKind::Byte || to == TypeKind::Byte) return false;
  return numeric(from) && numeric(to) && rank(from) > 0 && rank(to) >= rank(from);
}

const char* nameOf(TypeKind type) {
  if (type == TypeKind::Byte) return "byte";
  if (type == TypeKind::Short) return "short";
  if (type == TypeKind::Int) return "int";
  if (type == TypeKind::Long) return "long";
  if (type == TypeKind::Float) return "float";
  if (type == TypeKind::Double) return "double";
  if (type == TypeKind::Boolean) return "boolean";
  if (type == TypeKind::Char) return "char";
  if (type == TypeKind::String) return "string";
  if (type == TypeKind::Ptr) return "指针";
  if (type == TypeKind::Interface) return "接口";
  if (type == TypeKind::Struct) return "结构体";
  if (type == TypeKind::Array) return "array";
  if (type == TypeKind::List) return "list";
  if (type == TypeKind::Set) return "set";
  if (type == TypeKind::Map) return "map";
  if (type == TypeKind::Span) return "span";
  if (type == TypeKind::Undefined) return "undefined";
  if (type == TypeKind::Void) return "void";
  return "未知";
}

bool collection(TypeKind type) {
  return type == TypeKind::Array || type == TypeKind::List || type == TypeKind::Set || type == TypeKind::Map;
}

std::string typeText(TypeKind kind, const std::string& typeName, TypeKind alt, const std::string& altName,
                     TypeKind pointee, bool volatilePointee, ParamMode mode) {
  (void)alt;
  std::string text;
  if (kind == TypeKind::Array) text = "array[" + typeName + "]";
  else if (kind == TypeKind::List) text = "list[" + typeName + "]";
  else if (kind == TypeKind::Set) text = "set[" + typeName + "]";
  else if (kind == TypeKind::Map) text = "map[" + typeName + "," + altName + "]";
  /* M-B：span[T] 的 typeName 是元素描述（与集合同一形状）。 */
  else if (kind == TypeKind::Span) text = "span[" + typeName + "]";
  else if (kind == TypeKind::Ptr) {
    /* M-C：pointee 进指针文本——`long*` 和 `string*` 不再是同一个「指针」符号；
       类引用（pointee 空）仍写类名（类名本身是指针），结构体指针/枚举指针补 `*`。
       M-D：volatile 进签名——`volatile long*` 与 `long*` 是两个符号。 */
    if (pointee == TypeKind::None || pointee == TypeKind::Void) {
      text = typeName.empty() ? nameOf(kind) : typeName;
    } else if (pointee == TypeKind::Struct) {
      text = typeName + "*";
    } else {
      text = (typeName.empty() ? std::string(nameOf(pointee)) : typeName) + "*";
    }
    if (volatilePointee) text = "volatile " + text;
  }
  else if (kind == TypeKind::Struct || kind == TypeKind::Interface) text = typeName.empty() ? nameOf(kind) : typeName;
  else text = nameOf(kind);
  /* M-C：out/ref 修饰词进签名（含 mangling）。 */
  if (mode == ParamMode::Out) return "out " + text;
  if (mode == ParamMode::Ref) return "ref " + text;
  return text;
}

}  // namespace obr
