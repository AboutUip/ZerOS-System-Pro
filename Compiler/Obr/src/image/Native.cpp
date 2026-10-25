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

std::vector<std::uint8_t> nativeMovImm(int reg, std::uint64_t imm) {
  std::vector<std::uint8_t> out;
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

std::vector<std::uint8_t> nativeLea(int dest, int base, int index, int scale, int disp) {
  int scaleCode = 0;
  if (scale == 2) scaleCode = 1;
  if (scale == 4) scaleCode = 2;
  if (scale == 8) scaleCode = 3;
  std::vector<std::uint8_t> out;
  appendRex(out, true, dest >= 8, index >= 8, base >= 8);
  out.push_back(0x8D);
  out.push_back(static_cast<std::uint8_t>(0x40 | ((dest & 7) << 3) | 0x04));
  out.push_back(static_cast<std::uint8_t>((scaleCode << 6) | ((index & 7) << 3) | (base & 7)));
  out.push_back(static_cast<std::uint8_t>(disp & 0xFF));
  return out;
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
  if (!same(nativeMovImm(8, 1), {0x49, 0xB8, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00})) return false;
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
