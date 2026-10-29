#pragma once

#include "../Ast.hpp"
#include "Debug.hpp"

#include <string>
#include <vector>

namespace obr {

/**
 * 把 ZAP 文本收成程序二进制。标号和 call 先展开。
 * 没有导出也没有导入时仍是版本 1，字节正好到最后一条指令。
 * 动态库，或带导入、导出的程序，在指令后面写版本 2 的链接目录。
 * sites 与 ZAP 的每一行对齐。非空时在路径旁再写一份 `.debug`，不改二进制的任何一个字节。
 */
void writeProgramBinary(const std::string& path, const std::string& zapText, const Unit& unit, const std::vector<DebugSite>* sites);

}  // namespace obr
