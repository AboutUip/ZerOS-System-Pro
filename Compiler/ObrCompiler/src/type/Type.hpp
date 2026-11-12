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
/** 把类型写成 `list[long]`、`map[string,long]` 这种表面。标量只用 kind。
    M-C：pointee 进指针文本（修 `long*` / `string*` 同符号碰撞），out/ref 修饰词进签名文本。
    M-D：volatilePointee 让 `volatile long*` 与 `long*` 在签名/mangling 里分开。 */
std::string typeText(TypeKind kind, const std::string& typeName, TypeKind alt, const std::string& altName,
                     TypeKind pointee = TypeKind::None, bool volatilePointee = false, ParamMode mode = ParamMode::None);

}  // namespace obr
