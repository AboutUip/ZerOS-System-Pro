#pragma once

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
bool nativeReady(const std::vector<std::string>& lines);

void writeNativeProgram(const std::string& path, const std::vector<std::string>& lines, const std::vector<NativeSymbol>& symbols);

}  // namespace obr
