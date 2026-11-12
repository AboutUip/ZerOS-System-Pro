#pragma once

#include "../image/Debug.hpp"

#include <string>
#include <vector>

namespace obr {

/**
 * 在已经生成的指令上做窥孔。
 * 同一地址的重复装入会去掉。两边都能收成小于 1048576 的立即数、结果也小于它时，整数运算收成一条 place。
 * 不小于 1048576 的立即数和这种乘积不会收成一条 place，否则位置无关装入会把窗口位移加错。
 *
 * M-D（volatile 面全关）：volatile 访问以 `vld.` / `vst.` 未登记助记符面发射（编码与
 * ldi./sti. 相同）。四个危险优化——重复 load 合并（takeLoad/holds）、常量匹配删读（holds
 * 常量条件）、store→load 转发（rememberStore）、常量指针折叠（Fold::knownAddr_）——对
 * volatile 访问全部屏蔽：vld./vst. 在这里按未知助记符待遇（liveOf=Keep+Clobber、
 * forward=clearAll），任何一条 volatile 访问都逐条保留。重排今天本就不存在：forward 只删
 * 或原位替换，从不交换顺序——「不可重排」已成立；将来若加重排器，volatile 面是硬约束。
 * 内联展开不跨 volatile 合并（展开后 volatile 访问仍逐条保留）。
 */
void peel(std::string& text, std::vector<DebugSite>& sites);

}  // namespace obr
