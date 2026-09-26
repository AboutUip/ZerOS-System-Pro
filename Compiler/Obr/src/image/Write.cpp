#include "Write.hpp"

#include "../Diagnostic.hpp"

#include <cstdint>
#include <fstream>
#include <map>
#include <string>
#include <utility>
#include <vector>

namespace obr {
namespace {

constexpr uint8_t kMagic0 = 0x5a;
constexpr uint8_t kMagic1 = 0x50;
constexpr uint8_t kMagic2 = 0x42;
constexpr uint8_t kMagic3 = 0x31;

struct NamedCode {
  const char* name;
  uint16_t code;
  int registers;
};

const NamedCode kNamed[] = {
    {"halt", 1, 0},
    {"gpu.present", 2, 0},
    {"gpu.compose", 3, 0},
    {"gpu.drop", 4, 1},
    {"gpu.hertz", 5, 1},
    {"gpu.clear", 6, 1},
    {"mem.hertz", 7, 1},
    {"jmp", 8, 1},
    {"ret", 9, 1},
    {"gpu.glyph", 10, 2},
    {"gpu.metric", 11, 2},
    {"gpu.load", 12, 2},
    {"gpu.store", 13, 2},
    {"mem.metric", 14, 2},
    {"hertz", 15, 2},
    {"not", 16, 2},
    {"itof", 17, 2},
    {"inbox", 18, 2},
    {"port.state", 19, 2},
    {"port.char", 20, 3},
    {"xchg", 21, 3},
    {"gpu.plot", 22, 3},
    {"gpu.align", 23, 3},
    {"gpu.paint", 24, 3},
    {"add", 25, 3},
    {"eq", 26, 3},
    {"sub", 27, 3},
    {"udiv", 28, 3},
    {"umod", 29, 3},
    {"mul", 30, 3},
    {"div", 31, 3},
    {"mod", 32, 3},
    {"and", 33, 3},
    {"or", 34, 3},
    {"xor", 35, 3},
    {"shl", 36, 3},
    {"shr", 37, 3},
    {"fadd", 38, 3},
    {"fsub", 39, 3},
    {"fmul", 40, 3},
    {"fdiv", 41, 3},
    {"fpow", 42, 3},
    {"fmod", 43, 3},
    {"lt", 44, 3},
    {"le", 45, 3},
    {"gt", 46, 3},
    {"ge", 47, 3},
    {"feq", 48, 3},
    {"metric", 49, 4},
    {"query", 50, 4},
    {"port.byte", 51, 4},
    {"gpu.character", 52, 5},
    {"gpu.text", 53, 6},
    {"gpu.accel", 54, 6},
    {"gpu.box", 55, 7},
};

struct MemoryName {
  const char* name;
  uint8_t opcode;
};

const MemoryName kLoad[] = {
    {"load.bit", 1}, {"load.octet", 3}, {"load.16", 5}, {"load.32", 7},
    {"load.64", 9},  {"load.f32", 11},   {"load.f64", 13},
};
const MemoryName kStore[] = {
    {"store.bit", 2}, {"store.octet", 4}, {"store.16", 6}, {"store.32", 8},
    {"store.64", 10}, {"store.f32", 12},  {"store.f64", 14},
};
const MemoryName kLdi[] = {
    {"ldi.octet", 3}, {"ldi.16", 5}, {"ldi.32", 7}, {"ldi.64", 9}, {"ldi.f32", 11}, {"ldi.f64", 13},
};
const MemoryName kSti[] = {
    {"sti.octet", 4}, {"sti.16", 6}, {"sti.32", 8}, {"sti.64", 10}, {"sti.f32", 12}, {"sti.f64", 14},
};

void appendByte(std::vector<uint8_t>& out, uint8_t value) { out.push_back(value); }

void append16(std::vector<uint8_t>& out, uint16_t value) {
  out.push_back(static_cast<uint8_t>(value & 0xff));
  out.push_back(static_cast<uint8_t>((value >> 8) & 0xff));
}

void append32(std::vector<uint8_t>& out, uint32_t value) {
  for (int shift = 0; shift < 32; shift += 8) {
    out.push_back(static_cast<uint8_t>((value >> shift) & 0xff));
  }
}

void appendImmediate(std::vector<uint8_t>& out, bool wide, uint64_t bits) {
  out.push_back(wide ? 1 : 0);
  for (int shift = 0; shift < 64; shift += 8) {
    out.push_back(static_cast<uint8_t>((bits >> shift) & 0xff));
  }
}

std::vector<std::string> splitLines(const std::string& text) {
  std::vector<std::string> lines;
  std::string current;
  for (char item : text) {
    if (item == '\n') {
      if (!current.empty() && current.back() == '\r') current.pop_back();
      lines.push_back(current);
      current.clear();
    } else {
      current.push_back(item);
    }
  }
  if (!current.empty() && current.back() == '\r') current.pop_back();
  if (!current.empty()) lines.push_back(current);
  return lines;
}

std::string trim(const std::string& text) {
  std::size_t begin = 0;
  while (begin < text.size() && (text[begin] == ' ' || text[begin] == '\t')) begin += 1;
  std::size_t end = text.size();
  while (end > begin && (text[end - 1] == ' ' || text[end - 1] == '\t')) end -= 1;
  return text.substr(begin, end - begin);
}

std::vector<std::string> tokensOf(const std::string& line) {
  std::vector<std::string> parts;
  std::string current;
  for (char item : line) {
    if (item == ' ' || item == '\t' || item == ',') {
      if (!current.empty()) {
        parts.push_back(current);
        current.clear();
      }
    } else {
      current.push_back(item);
    }
  }
  if (!current.empty()) parts.push_back(current);
  return parts;
}

bool isLabel(const std::string& line) {
  if (line.size() < 2 || line.back() != ':') return false;
  if (line[0] < 'A' || (line[0] > 'Z' && line[0] < 'a') || line[0] > 'z') return false;
  for (std::size_t index = 1; index + 1 < line.size(); index += 1) {
    const char item = line[index];
    const bool digit = item >= '0' && item <= '9';
    const bool alpha = (item >= 'A' && item <= 'Z') || (item >= 'a' && item <= 'z');
    if (!digit && !alpha) return false;
  }
  return true;
}

bool isRegisterToken(const std::string& token) {
  return token.size() == 2 && token[0] == 'r' && token[1] >= '0' && token[1] <= '7';
}

bool isNumberToken(const std::string& token) {
  if (token.size() >= 3 && token[0] == '0' && (token[1] == 'x' || token[1] == 'X')) {
    for (std::size_t index = 2; index < token.size(); index += 1) {
      const char item = token[index];
      const bool digit = item >= '0' && item <= '9';
      const bool lower = item >= 'a' && item <= 'f';
      const bool upper = item >= 'A' && item <= 'F';
      if (!digit && !lower && !upper) return false;
    }
    return token.size() > 2;
  }
  if (token.empty()) return false;
  for (char item : token) {
    if (item < '0' || item > '9') return false;
  }
  return true;
}

bool parseUnsigned(const std::string& token, uint64_t& value) {
  if (token.empty()) return false;
  int base = 10;
  std::size_t index = 0;
  if (token.size() > 2 && token[0] == '0' && (token[1] == 'x' || token[1] == 'X')) {
    base = 16;
    index = 2;
  }
  if (index >= token.size()) return false;
  value = 0;
  for (; index < token.size(); index += 1) {
    const char item = token[index];
    int digit = -1;
    if (item >= '0' && item <= '9') digit = item - '0';
    else if (item >= 'a' && item <= 'f') digit = item - 'a' + 10;
    else if (item >= 'A' && item <= 'F') digit = item - 'A' + 10;
    if (digit < 0 || digit >= base) return false;
    if (value > (UINT64_MAX - static_cast<uint64_t>(digit)) / static_cast<uint64_t>(base)) return false;
    value = value * static_cast<uint64_t>(base) + static_cast<uint64_t>(digit);
  }
  return true;
}

void writeParsedImmediate(std::vector<uint8_t>& out, const std::string& token) {
  bool negative = false;
  std::string body = token;
  if (!body.empty() && body[0] == '-') {
    negative = true;
    body = body.substr(1);
  }
  uint64_t magnitude = 0;
  if (!parseUnsigned(body, magnitude)) fail("立即数无法识别 " + token);
  if (negative) {
    if (magnitude > 0x8000000000000000ull) fail("立即数小于有符号 64 位 " + token);
    const uint64_t bits = magnitude == 0 ? 0 : ~magnitude + 1;
    appendImmediate(out, false, bits);
    return;
  }
  if (magnitude >= 0x8000000000000000ull) {
    appendImmediate(out, true, magnitude);
    return;
  }
  appendImmediate(out, false, magnitude);
}

int registerOf(const std::string& token) {
  if (!isRegisterToken(token)) fail("寄存器无法识别 " + token);
  return token[1] - '0';
}

uint32_t targetOf(const std::string& token) {
  uint64_t value = 0;
  if (!parseUnsigned(token, value) || value > 0xffffffffull) fail("跳转目标放不进 32 位 " + token);
  return static_cast<uint32_t>(value);
}

const NamedCode* findNamed(const std::string& name) {
  for (const NamedCode& item : kNamed) {
    if (name == item.name) return &item;
  }
  return nullptr;
}

const MemoryName* findMemory(const MemoryName* table, std::size_t count, const std::string& name) {
  for (std::size_t index = 0; index < count; index += 1) {
    if (name == table[index].name) return &table[index];
  }
  return nullptr;
}

void encodeLine(std::vector<uint8_t>& out, const std::string& line) {
  const std::vector<std::string> parts = tokensOf(line);
  if (parts.empty()) fail("空指令");
  const std::string& head = parts[0];
  if (head == "place") {
    if (parts.size() != 3) fail("无法编码 " + line);
    append16(out, 60);
    appendByte(out, static_cast<uint8_t>(registerOf(parts[1])));
    writeParsedImmediate(out, parts[2]);
    return;
  }
  const MemoryName* load = findMemory(kLoad, sizeof(kLoad) / sizeof(kLoad[0]), head);
  const MemoryName* store = findMemory(kStore, sizeof(kStore) / sizeof(kStore[0]), head);
  if (load != nullptr || store != nullptr) {
    if (parts.size() != 3) fail("无法编码 " + line);
    const MemoryName* memory = load != nullptr ? load : store;
    if (memory == nullptr) fail("无法编码 " + line);
    append16(out, load != nullptr ? 61 : 62);
    appendByte(out, memory->opcode);
    writeParsedImmediate(out, parts[2]);
    appendByte(out, static_cast<uint8_t>(registerOf(parts[1])));
    return;
  }
  const MemoryName* ldi = findMemory(kLdi, sizeof(kLdi) / sizeof(kLdi[0]), head);
  const MemoryName* sti = findMemory(kSti, sizeof(kSti) / sizeof(kSti[0]), head);
  if (ldi != nullptr || sti != nullptr) {
    if (parts.size() != 3) fail("无法编码 " + line);
    append16(out, ldi != nullptr ? 63 : 64);
    appendByte(out, ldi != nullptr ? ldi->opcode : sti->opcode);
    appendByte(out, static_cast<uint8_t>(registerOf(parts[1])));
    appendByte(out, static_cast<uint8_t>(registerOf(parts[2])));
    return;
  }
  if (head == "call" || head == "link" || head == "jz" || head == "jnz") {
    if (parts.size() != 3) fail("无法编码 " + line);
    uint16_t code = 56;
    if (head == "link") code = 57;
    if (head == "jz") code = 58;
    if (head == "jnz") code = 59;
    append16(out, code);
    appendByte(out, static_cast<uint8_t>(registerOf(parts[1])));
    append32(out, targetOf(parts[2]));
    return;
  }
  const NamedCode* named = findNamed(head);
  if (named == nullptr || static_cast<int>(parts.size()) != named->registers + 1) fail("无法编码 " + line);
  append16(out, named->code);
  for (int index = 0; index < named->registers; index += 1) {
    appendByte(out, static_cast<uint8_t>(registerOf(parts[static_cast<std::size_t>(index + 1)])));
  }
}

bool isMachineCall(const std::string& line) {
  return line.size() > 7 && line.rfind("call r", 0) == 0 && line[6] >= '0' && line[6] <= '7' && line[7] == ',';
}

bool isPseudoCall(const std::string& line) {
  return line.rfind("call ", 0) == 0 && !isMachineCall(line);
}

std::vector<std::string> expand(const std::string& zapText) {
  std::vector<std::string> expanded;
  for (const std::string& raw : splitLines(zapText)) {
    const std::string line = trim(raw);
    if (line.empty()) continue;
    if (line.rfind("chars ", 0) == 0) {
      const std::string text = trim(line.substr(6));
      if (text.size() < 2 || text.front() != '"' || text.back() != '"') fail("字符串不完整 " + line);
      const std::string body = text.substr(1, text.size() - 2);
      for (unsigned char item : body) {
        expanded.push_back("place r0, " + std::to_string(static_cast<unsigned>(item)));
        expanded.push_back("gpu.glyph r1, r0");
      }
      continue;
    }
    if (isPseudoCall(line)) {
      expanded.push_back("link r7, " + trim(line.substr(5)));
      continue;
    }
    if (line.rfind("icall ", 0) == 0) {
      expanded.push_back("link r6, " + trim(line.substr(6)));
      continue;
    }
    if (line == "ret") {
      expanded.push_back("jmp r7");
      continue;
    }
    if (line == "iret") {
      expanded.push_back("jmp r6");
      continue;
    }
    expanded.push_back(line);
  }

  std::map<std::string, uint32_t> labels;
  std::vector<std::string> body;
  for (const std::string& line : expanded) {
    if (isLabel(line)) {
      labels.emplace(line.substr(0, line.size() - 1), static_cast<uint32_t>(body.size()));
      continue;
    }
    body.push_back(line);
  }

  std::vector<std::string> resolved;
  for (const std::string& line : body) {
    const std::vector<std::string> parts = tokensOf(line);
    if (parts.empty()) fail("空指令");
    const std::string& head = parts[0];
    const std::string& target = parts.back();
    const bool jump = head == "jz" || head == "jnz" || head == "link" || head == "call";
    if (!jump || parts.size() < 2 || isRegisterToken(target) || isNumberToken(target)) {
      resolved.push_back(line);
      continue;
    }
    const auto found = labels.find(target);
    if (found == labels.end()) fail("没有标号 " + target);
    resolved.push_back(head + " " + parts[1] + ", " + std::to_string(found->second));
  }
  return resolved;
}

}  // namespace

void writeProgramBinary(const std::string& path, const std::string& zapText) {
  const std::vector<std::string> lines = expand(zapText);
  std::vector<uint8_t> payload;
  for (const std::string& line : lines) encodeLine(payload, line);
  std::vector<uint8_t> bytes;
  bytes.push_back(kMagic0);
  bytes.push_back(kMagic1);
  bytes.push_back(kMagic2);
  bytes.push_back(kMagic3);
  append16(bytes, 1);
  append16(bytes, 1);
  append32(bytes, static_cast<uint32_t>(lines.size()));
  bytes.insert(bytes.end(), payload.begin(), payload.end());
  std::ofstream output(path, std::ios::binary);
  if (!output) fail("写不出 " + path);
  output.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
  if (!output) fail("写不出 " + path);
}

}  // namespace obr
