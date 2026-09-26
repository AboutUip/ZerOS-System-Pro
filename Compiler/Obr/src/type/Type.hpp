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

}  // namespace obr
