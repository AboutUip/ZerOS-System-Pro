#pragma once

#include "Debug.hpp"
#include "../Optimization.hpp"

#include <cstdint>
#include <string>
#include <vector>

namespace obr {

/** 一条导出在展开后的指令下标。写文件时换成代码里的八位组偏移。 */
struct NativeSymbol {
  std::string name;
  std::uint32_t index = 0;
};

/**
 * 把已经展开的 ZAP 行收成 ZNB1。
 * 没有位置无关，也没有动态库。跳转在这一步变成相对位移。
 * 入口先把 rsp 设到界面区的八位组地址，再执行第 0 条。
 */
/** 每一行都能收成已登记的原生编码时才是真。做不到的程序仍走原来的 ZPB1。 */
bool nativeLoweringReady(const std::string& text);
bool nativeReady(const std::vector<std::string>& lines);
/** 仅宿主诊断；不写入映像。第一列是展开后的 ZAP 下标。 */
void writeNativeCoverage(const std::string& path, const std::vector<std::string>& lines, const std::string& eligibility);

/**
 * 写出 ZNB1。sites 与 lines 等长时，旁边写 obr-debug 2。
 * 第一列是这条原生指令的起始位地址，按映像放在位地址 0 计算，含 12 个八位组的文件头。
 */
void writeNativeProgram(const std::string& path, const std::vector<std::string>& lines, const std::vector<NativeSymbol>& symbols, const std::vector<DebugSite>* sites, const OptimizationOptions& options = {});

}  // namespace obr
