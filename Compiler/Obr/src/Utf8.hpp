#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace obr {

/** 从 UTF-8 字节里取出一个标量。失败时 ok 为假，next 仍是调用前的下标。 */
struct Utf8Step {
  bool ok = false;
  std::uint32_t scalar = 0;
  std::size_t next = 0;
};

inline Utf8Step takeUtf8(const std::string& text, std::size_t index) {
  Utf8Step step;
  step.next = index;
  if (index >= text.size()) return step;
  const auto byte = static_cast<unsigned char>(text[index]);
  int need = 0;
  std::uint32_t value = 0;
  std::uint32_t minimum = 0;
  if (byte < 0x80) {
    step.ok = true;
    step.scalar = byte;
    step.next = index + 1;
    return step;
  }
  if ((byte & 0xE0) == 0xC0) {
    need = 1;
    value = byte & 0x1F;
    minimum = 0x80;
  } else if ((byte & 0xF0) == 0xE0) {
    need = 2;
    value = byte & 0x0F;
    minimum = 0x800;
  } else if ((byte & 0xF8) == 0xF0) {
    need = 3;
    value = byte & 0x07;
    minimum = 0x10000;
  } else {
    return step;
  }
  if (index + static_cast<std::size_t>(need) >= text.size()) return step;
  for (int extra = 0; extra < need; extra += 1) {
    const auto next = static_cast<unsigned char>(text[index + 1 + static_cast<std::size_t>(extra)]);
    if ((next & 0xC0) != 0x80) return step;
    value = (value << 6) | (next & 0x3F);
  }
  if (value < minimum || value > 0x10FFFF || (value >= 0xD800 && value <= 0xDFFF)) return step;
  step.ok = true;
  step.scalar = value;
  step.next = index + 1 + static_cast<std::size_t>(need);
  return step;
}

/** 整段解开。有一处不合法就失败，out 清空。 */
inline bool utf8Scalars(const std::string& text, std::vector<std::uint32_t>& out) {
  out.clear();
  std::size_t index = 0;
  while (index < text.size()) {
    const Utf8Step step = takeUtf8(text, index);
    if (!step.ok) {
      out.clear();
      return false;
    }
    out.push_back(step.scalar);
    index = step.next;
  }
  return true;
}

/** 每次启动编译器都跑。中文标量、ASCII、截断和过短编码都要在这里被挡住或解开。 */
inline bool utf8LiteralSelfCheck() {
  std::vector<std::uint32_t> scalars;
  const std::string han = "\xE4\xB8\xAD";
  if (!utf8Scalars(han, scalars) || scalars.size() != 1 || scalars[0] != 0x4E2D) return false;
  if (!utf8Scalars("A", scalars) || scalars.size() != 1 || scalars[0] != 0x41) return false;
  if (!utf8Scalars("", scalars) || !scalars.empty()) return false;
  if (utf8Scalars("\xE4\xB8", scalars)) return false;
  if (utf8Scalars("\xC0\x80", scalars)) return false;
  if (utf8Scalars("\xED\xA0\x80", scalars)) return false;
  return true;
}

}  // namespace obr
