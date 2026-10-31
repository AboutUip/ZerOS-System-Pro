#pragma once

#include <string>
#include <vector>

namespace obr {

/**
 * 一条最终指令在源码里的位置。
 * 行号从 1 起。0 表示这条指令是编译器补的，没有对应的源行。
 * 源文件和函数名可以是空串。这不是程序二进制的一部分。
 */
struct DebugSite {
  std::string file;
  int line = 0;
  std::string function;
  /** 原样汇编不参与值传播或删行；只供宿主优化器使用，不写入 .debug。 */
  bool opaque = false;
};

/** 助记符文本，以及与每一行对齐的源位置。位置不写进文本。 */
struct Generated {
  std::string text;
  std::vector<DebugSite> sites;
};

}  // namespace obr
