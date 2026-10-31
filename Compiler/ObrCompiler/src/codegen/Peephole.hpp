#pragma once

#include "../image/Debug.hpp"
#include "../Optimization.hpp"

#include <string>
#include <vector>

namespace obr {

/**
 * 在已经生成的指令上做窥孔。
 * 同一地址的重复装入会去掉。两边都能收成小于 1048576 的立即数、结果也小于它时，整数运算收成一条 place。
 * 不小于 1048576 的立即数和这种乘积不会收成一条 place，否则位置无关装入会把窗口位移加错。
 */
void peel(std::string& text, std::vector<DebugSite>& sites, const OptimizationOptions& options = {});

}  // namespace obr
