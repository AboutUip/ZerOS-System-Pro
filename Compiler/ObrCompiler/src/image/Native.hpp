#pragma once

#include <cstdint>
#include <initializer_list>
#include <vector>

namespace obr {

/** 立即数传送不改 flags。compact 时按零扩展 imm32、符号扩展 imm32、imm64 选最短形式。 */
int nativeImmediateSize(int reg, std::uint64_t imm, bool compact = false);
std::vector<std::uint8_t> nativeMovImm(int reg, std::uint64_t imm, bool compact = false);

/** add 目的, 源。两个都是寄存器。编码是 REX.W 后接 0x01。 */
std::vector<std::uint8_t> nativeAddReg(int dest, int src);

/** mov [基址], 源。基址不是 rsp / r12，也没有位移。 */
std::vector<std::uint8_t> nativeMovStore(int base, int src);

/** mov 目的, [基址]。基址不是 rsp / r12，也没有位移。 */
std::vector<std::uint8_t> nativeMovLoad(int dest, int base);

/**
 * 带比例的寻址。操作码是 0x8D、0x8B 或 0x89。
 * 比例是 1、2、4、8。位移是有符号 disp8 或 disp32；compact 可省去合法的零位移。
 * rsp 不能作变址；r12 在 REX.X 下仍是合法的变址。
 * 编不出时返回空。
 */
std::vector<std::uint8_t> nativeScaled(int opcode, int reg, int base, int index, int scale, int disp, bool compact = false);

/**
 * lea 目的, [基址 + 变址 × 比例 + 位移]。
 * 比例是 1、2、4、8。位移是有符号 disp8 或 disp32。
 */
std::vector<std::uint8_t> nativeLea(int dest, int base, int index, int scale, int disp);

/** 核对上面几个编码器是否写出登记表里的样例字节。失败返回 false。 */
bool nativeEncodeSelfCheck();

/** 0F 3F 01，再加一个寄存器字节。把核心编号写入该寄存器。 */
std::vector<std::uint8_t> nativeCore(int reg);

/** 0F 3F，再接操作编号和固定个数的寄存器编号。个数由登记表决定。 */
std::vector<std::uint8_t> nativeEscape(int opcode, std::initializer_list<int> regs);

}
