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
  if (type == TypeKind::Struct) return "结构体";
  if (type == TypeKind::Undefined) return "undefined";
  if (type == TypeKind::Void) return "void";
  return "未知";
}

}  // namespace obr
