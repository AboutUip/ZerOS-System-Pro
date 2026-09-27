#pragma once

#include "../Diagnostic.hpp"

namespace obr {

// 这些地址会随 -slot 改写，所以不是编译期常量。0 号核心保持原值。
inline int kSp = 1048576;
inline int kStack = 2097152;
inline int kFrame = 4653056;
inline int kStatic = 5242880;
inline int kHeapPtr = 4718592;
inline int kHeap = 5767168;
// 界面库的原点栈、按键边沿和运行时参数。每个槽 64 位。
inline int kUi = 4603904;
constexpr int kTemps = 8;
constexpr int kWordStride = 64;
constexpr int kStackStride = 524288;
constexpr int kHeapStride = 1048576;
constexpr int kStaticStride = 65536;

// 把编译器自己的窗口挪到核心 slot 上。用户写出的小立即数不动。
// 槽距 8388608 与沙盒、内核契约相同，是官方标定，不是协议。
inline void applySlot(int slot) {
  if (slot == 0) return;
  if (slot < 0 || slot > 255) fail("核心槽不在 0 到 255");
  const int delta = slot * 8388608;
  kSp += delta;
  kStack += delta;
  kFrame += delta;
  kStatic += delta;
  kHeapPtr += delta;
  kHeap += delta;
  kUi += delta;
}

}  // namespace obr
