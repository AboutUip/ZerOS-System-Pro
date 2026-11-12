#pragma once

#include "../Diagnostic.hpp"

namespace obr {

// 这些地址会随 -slot 改写，所以不是编译期常量。0 号核心保持原值。
// 窗口起点是调用参数字。alloc 把位数写在这里，监督核从同一处读。
// 栈指针若也放在起点，内联进调用方之后这次写入会把栈指针盖成参数，下一次调用越界。
// 栈数据从 kStack 往上长。指针字放在栈数据前一个字，落在数据下限和栈之间的空隙里。
inline int kSp = 68173760;
inline int kStack = 68173824;
inline int kFrame = 70729728;
inline int kStatic = 71319552;
inline int kHeapPtr = 70795264;
inline int kHeap = 71843840;
// 界面库的原点栈、按键边沿和运行时参数。每个槽 64 位。
inline int kUi = 70680576;
/* M2 触发点 (d)：影子析构记录链的运行时单元（索引同 kUi 单元块，155-157 空位）。
   链根每任务一个字（窗口私有，任务入口清零），不占任务结构 19 字。 */
constexpr int kDtorRootCell = 155;
constexpr int kDtorLinkCell = 156;
constexpr int kDtorFrameCell = 157;
constexpr int kDtorSweepCell = 158;
/* 一次调用会把每个参数都停在临时槽里。九个参数时第八个槽正好压住栈顶，
   随后第一次压栈会盖掉最后一个参数，被调用方读到 0。槽要比最长的参数表多。 */
constexpr int kTemps = 32;
constexpr int kWordStride = 64;
inline int kStackStride = 524288;
inline int kHeapStride = 67108864;
inline int kStaticStride = 65536;
/* 任务窗口布局的地址下限。窗口基址由内核分配，CPU install 把数据地址加上
   windowOrigin - kTaskDataFloor。 */
constexpr int kTaskDataFloor = 1048576;

/**
 * 用户任务的 flat 布局：栈、静态区、堆都放进 512KiB 任务窗口。
 * 所有地址仍从 kTaskDataFloor 起，因此 CPU 会把它们按任务窗口基址重定位。
 * 内核/固件仍用 applySlot 的旧布局。
 */
inline void applyFlat() {
  kSp = kTaskDataFloor + 0x1000;
  kStack = kTaskDataFloor + 0x2000;
  kStatic = kTaskDataFloor + 0x90000;
  kHeapPtr = kTaskDataFloor + 0xA0000;
  kFrame = kTaskDataFloor + 0xA1000;
  kUi = kTaskDataFloor + 0xA2000;
  kHeap = kTaskDataFloor + 0xB0000;
  kStackStride = 0x80000;
  kStaticStride = 0x10000;
  kHeapStride = 0x200000;
}

// 把编译器自己的窗口挪到核心 slot 上。用户写出的小立即数不动。
// 槽距 268435456 与沙盒、内核契约相同，是官方标定，不是协议。
// 0 号核心上，数据下限到编译器栈之间是 8 份用户堆，每份 8388608 位。
inline void applySlot(int slot) {
  if (slot == 0) return;
  if (slot < 0 || slot > 7) fail("核心槽不在 0 到 7");
  const int delta = slot * 268435456;
  kSp += delta;
  kStack += delta;
  kFrame += delta;
  kStatic += delta;
  kHeapPtr += delta;
  kHeap += delta;
  kUi += delta;
}

}  // namespace obr
