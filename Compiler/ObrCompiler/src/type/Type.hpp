#pragma once

#include "TypeKind.hpp"

#include <string>

namespace obr {

bool numeric(TypeKind type);
bool integral(TypeKind type);
TypeKind promote(TypeKind left, TypeKind right);
bool labelText(const std::string& text);
bool canWiden(TypeKind from, TypeKind to);
const char* nameOf(TypeKind type);
bool collection(TypeKind type);
/** 把类型写成 `list[long]`、`map[string,long]` 这种表面。标量只用 kind。 */
std::string typeText(TypeKind kind, const std::string& typeName, TypeKind alt, const std::string& altName);

}  // namespace obr
