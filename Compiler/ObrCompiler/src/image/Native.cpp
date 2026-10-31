#include "Native.hpp"

namespace obr {
namespace {

void appendRex(std::vector<std::uint8_t>& out, bool w, bool r, bool x, bool b) {
  std::uint8_t byte = 0x40;
  if (w) byte = static_cast<std::uint8_t>(byte | 0x08);
  if (r) byte = static_cast<std::uint8_t>(byte | 0x04);
  if (x) byte = static_cast<std::uint8_t>(byte | 0x02);
  if (b) byte = static_cast<std::uint8_t>(byte | 0x01);
  out.push_back(byte);
}

bool same(const std::vector<std::uint8_t>& got, const std::vector<std::uint8_t>& want) {
  return got == want;
}

}

int nativeImmediateSize(int reg, std::uint64_t imm, bool compact) {
  if (reg < 0 || reg > 15) return 0;
  if (compact && imm <= 0xffffffffULL) return reg >= 8 ? 6 : 5;
  if (compact && imm >= 0xffffffff80000000ULL) return 7;
  return 10;
}

std::vector<std::uint8_t> nativeMovImm(int reg, std::uint64_t imm, bool compact) {
  if (reg < 0 || reg > 15) return {};
  std::vector<std::uint8_t> out;
  out.reserve(static_cast<std::size_t>(nativeImmediateSize(reg, imm, compact)));
  // B8 imm32 零扩展；C7 /0 imm32 符号扩展。两者都保留 flags，不能用 xor 清零代替。
  if (compact && imm <= 0xffffffffULL) {
    if (reg >= 8) appendRex(out, false, false, false, true);
    out.push_back(static_cast<std::uint8_t>(0xB8 + (reg & 7)));
    for (int index = 0; index < 4; ++index) out.push_back(static_cast<std::uint8_t>(imm >> (index * 8)));
    return out;
  }
  if (compact && imm >= 0xffffffff80000000ULL) {
    appendRex(out, true, false, false, reg >= 8);
    out.push_back(0xC7);
    out.push_back(static_cast<std::uint8_t>(0xC0 | (reg & 7)));
    for (int index = 0; index < 4; ++index) out.push_back(static_cast<std::uint8_t>(imm >> (index * 8)));
    return out;
  }
  appendRex(out, true, false, false, reg >= 8);
  out.push_back(static_cast<std::uint8_t>(0xB8 + (reg & 7)));
  for (int index = 0; index < 8; ++index) {
    out.push_back(static_cast<std::uint8_t>((imm >> (index * 8)) & 0xFFu));
  }
  return out;
}

std::vector<std::uint8_t> nativeAddReg(int dest, int src) {
  std::vector<std::uint8_t> out;
  appendRex(out, true, src >= 8, false, dest >= 8);
  out.push_back(0x01);
  out.push_back(static_cast<std::uint8_t>(0xC0 | ((src & 7) << 3) | (dest & 7)));
  return out;
}

std::vector<std::uint8_t> nativeMovStore(int base, int src) {
  std::vector<std::uint8_t> out;
  appendRex(out, true, src >= 8, false, base >= 8);
  out.push_back(0x89);
  out.push_back(static_cast<std::uint8_t>(((src & 7) << 3) | (base & 7)));
  return out;
}

std::vector<std::uint8_t> nativeMovLoad(int dest, int base) {
  std::vector<std::uint8_t> out;
  appendRex(out, true, dest >= 8, false, base >= 8);
  out.push_back(0x8B);
  out.push_back(static_cast<std::uint8_t>(((dest & 7) << 3) | (base & 7)));
  return out;
}

std::vector<std::uint8_t> nativeScaled(int opcode, int reg, int base, int index, int scale, int disp, bool compact) {
  int scaleCode = -1;
  if (scale == 1) scaleCode = 0;
  if (scale == 2) scaleCode = 1;
  if (scale == 4) scaleCode = 2;
  if (scale == 8) scaleCode = 3;
  if (scaleCode < 0 || index == 4 || reg < 0 || base < 0 || index < 0 || reg > 15 || base > 15 || index > 15) {
    return {};
  }
  if (opcode != 0x8D && opcode != 0x8B && opcode != 0x89) return {};
  std::vector<std::uint8_t> out;
  out.reserve(8);
  appendRex(out, true, reg >= 8, index >= 8, base >= 8);
  out.push_back(static_cast<std::uint8_t>(opcode));
  const bool noDisp = compact && disp == 0 && (base & 7) != 5;
  const bool shortDisp = disp >= -128 && disp <= 127;
  const int mod = noDisp ? 0 : shortDisp ? 0x40 : 0x80;
  out.push_back(static_cast<std::uint8_t>(mod | ((reg & 7) << 3) | 0x04));
  out.push_back(static_cast<std::uint8_t>((scaleCode << 6) | ((index & 7) << 3) | (base & 7)));
  if (!noDisp) {
    const int octets = shortDisp ? 1 : 4;
    const auto bits = static_cast<std::uint32_t>(disp);
    for (int at = 0; at < octets; ++at) out.push_back(static_cast<std::uint8_t>(bits >> (at * 8)));
  }
  return out;
}

std::vector<std::uint8_t> nativeLea(int dest, int base, int index, int scale, int disp) {
  return nativeScaled(0x8D, dest, base, index, scale, disp);
}

std::vector<std::uint8_t> nativeCore(int reg) {
  return nativeEscape(0x01, {reg});
}

std::vector<std::uint8_t> nativeEscape(int opcode, std::initializer_list<int> regs) {
  std::vector<std::uint8_t> out;
  out.push_back(0x0F);
  out.push_back(0x3F);
  out.push_back(static_cast<std::uint8_t>(opcode & 0xFF));
  for (int reg : regs) {
    out.push_back(static_cast<std::uint8_t>(reg & 0xFF));
  }
  return out;
}

bool nativeEncodeSelfCheck() {
  if (!same(nativeAddReg(0, 1), {0x48, 0x01, 0xC8})) return false;
  if (!same(nativeMovStore(1, 0), {0x48, 0x89, 0x01})) return false;
  if (!same(nativeMovLoad(0, 1), {0x48, 0x8B, 0x01})) return false;
  if (!same(nativeLea(0, 1, 2, 4, 16), {0x48, 0x8D, 0x44, 0x91, 0x10})) return false;
  if (!same(nativeScaled(0x89, 0, 1, 2, 8, 0), {0x48, 0x89, 0x44, 0xD1, 0x00})) return false;
  if (!nativeScaled(0x89, 0, 1, 4, 8, 0).empty()) return false;
  if (!same(nativeMovImm(8, 1), {0x49, 0xB8, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00})) return false;
  if (!same(nativeMovImm(0, 0, true), {0xB8, 0, 0, 0, 0})) return false;
  if (!same(nativeMovImm(8, 0xffffffffULL, true), {0x41, 0xB8, 0xff, 0xff, 0xff, 0xff})) return false;
  if (!same(nativeMovImm(15, 0xffffffffffffffffULL, true), {0x49, 0xC7, 0xC7, 0xff, 0xff, 0xff, 0xff})) return false;
  if (!same(nativeMovImm(0, 0xffffffff80000000ULL, true), {0x48, 0xC7, 0xC0, 0, 0, 0, 0x80})) return false;
  if (nativeMovImm(0, 0xffffffff7fffffffULL, true).size() != 10) return false;
  if (nativeMovImm(0, 0x100000000ULL, true).size() != 10) return false;
  if (!nativeMovImm(16, 1, true).empty()) return false;
  if (!same(nativeScaled(0x8B, 0, 1, 2, 8, 128), {0x48, 0x8B, 0x84, 0xD1, 0x80, 0, 0, 0})) return false;
  if (!same(nativeScaled(0x8B, 0, 1, 2, 8, -129), {0x48, 0x8B, 0x84, 0xD1, 0x7f, 0xff, 0xff, 0xff})) return false;
  if (!same(nativeScaled(0x8B, 0, 1, 2, 8, 0, true), {0x48, 0x8B, 0x04, 0xD1})) return false;
  if (nativeScaled(0x8B, 0, 5, 2, 8, 0, true).size() != 5) return false;
  if (!same(nativeCore(0), {0x0F, 0x3F, 0x01, 0x00})) return false;
  if (!same(nativeEscape(2, {}), {0x0F, 0x3F, 0x02})) return false;
  if (!same(nativeEscape(3, {0, 1}), {0x0F, 0x3F, 0x03, 0x00, 0x01})) return false;
  if (!same(nativeEscape(4, {1, 0}), {0x0F, 0x3F, 0x04, 0x01, 0x00})) return false;
  if (!same(nativeEscape(5, {1, 0}), {0x0F, 0x3F, 0x05, 0x01, 0x00})) return false;
  if (!same(nativeEscape(6, {0}), {0x0F, 0x3F, 0x06, 0x00})) return false;
  if (!same(nativeEscape(10, {}), {0x0F, 0x3F, 0x0A})) return false;
  if (!same(nativeEscape(12, {0, 1, 2}), {0x0F, 0x3F, 0x0C, 0x00, 0x01, 0x02})) return false;
  if (!same(nativeEscape(13, {0, 1}), {0x0F, 0x3F, 0x0D, 0x00, 0x01})) return false;
  if (!same(nativeEscape(15, {0, 1}), {0x0F, 0x3F, 0x0F, 0x00, 0x01})) return false;
  if (!same(nativeEscape(16, {3, 0, 1, 2}), {0x0F, 0x3F, 0x10, 0x03, 0x00, 0x01, 0x02})) return false;
  if (!same(nativeEscape(17, {}), {0x0F, 0x3F, 0x11})) return false;
  if (!same(nativeEscape(18, {0, 1, 2, 3, 4}), {0x0F, 0x3F, 0x12, 0x00, 0x01, 0x02, 0x03, 0x04})) return false;
  if (!same(nativeEscape(19, {8, 0, 1, 2, 3, 6}), {0x0F, 0x3F, 0x13, 0x08, 0x00, 0x01, 0x02, 0x03, 0x06})) return false;
  return true;
}

}
