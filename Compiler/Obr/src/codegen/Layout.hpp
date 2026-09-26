#pragma once

namespace obr {

constexpr int kSp = 1048576;
constexpr int kStack = 2097152;
constexpr int kFrame = 4653056;
constexpr int kStatic = 5242880;
constexpr int kHeapPtr = 4718592;
constexpr int kHeap = 5767168;
// 界面库的原点栈、按键边沿和运行时参数。每个槽 64 位。客核心会把这段地址错开。
constexpr int kUi = 4603904;
constexpr int kTemps = 8;
// 0 号核心仍用上面的地址。其余核心按编号错开，避免和固件共用栈、帧和堆。
constexpr int kWordStride = 64;
constexpr int kStackStride = 524288;
constexpr int kHeapStride = 1048576;
constexpr int kStaticStride = 65536;

}  // namespace obr
