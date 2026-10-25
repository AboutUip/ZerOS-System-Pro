#include "NativeImage.hpp"

#include "../Diagnostic.hpp"
#include "../codegen/Layout.hpp"
#include "Native.hpp"

#include <cstdint>
#include <fstream>
#include <string>
#include <vector>

namespace obr {
namespace {

constexpr int kScratch = 11;

struct EscapeForm {
  const char* name;
  int opcode;
  int registers;
};

struct WideForm {
  const char* name;
  int opcode;
  int registers;
};

const EscapeForm kEscape[] = {
    {"gate", 0x02, 0},
    {"yield", 0x0A, 0},
    {"gpu.present", 0x11, 0},
    {"core", 0x01, 1},
    {"schedule", 0x06, 1},
    {"release", 0x07, 1},
    {"slice", 0x09, 1},
    {"dwell", 0x1B, 1},
    {"pass", 0x03, 2},
    {"take", 0x04, 2},
    {"svc", 0x05, 2},
    {"capture", 0x0D, 2},
    {"restore", 0x0E, 2},
    {"hertz", 0x0F, 2},
    {"inbox", 0x1C, 2},
    {"port.state", 0x16, 2},
    {"munmap", 0x1A, 2},
    {"bound", 0x08, 3},
    {"install", 0x0C, 3},
    {"xchg", 0x14, 3},
    {"port.char", 0x17, 3},
    {"query", 0x0B, 4},
    {"attach", 0x10, 4},
    {"mmap", 0x19, 4},
    {"fill", 0x1D, 4},
    {"port.byte", 0x18, 4},
    {"gpu.character", 0x12, 5},
    {"gpu.accel", 0x13, 6},
    {"carry", 0x15, 6},
};

const WideForm kWide[] = {
    {"add", 0x01, 3},  {"sub", 0x02, 3},  {"and", 0x03, 3},  {"or", 0x04, 3},
    {"xor", 0x05, 3},  {"mul", 0x06, 3},  {"div", 0x07, 3},  {"mod", 0x08, 3},
    {"udiv", 0x09, 3}, {"umod", 0x0A, 3}, {"shl", 0x0B, 3},  {"shr", 0x0C, 3},
    {"eq", 0x0D, 3},   {"lt", 0x0E, 3},   {"le", 0x0F, 3},   {"gt", 0x10, 3},
    {"ge", 0x11, 3},   {"not", 0x12, 2},  {"itof", 0x13, 2}, {"fadd", 0x14, 3},
    {"fsub", 0x15, 3}, {"fmul", 0x16, 3}, {"fdiv", 0x17, 3}, {"fpow", 0x18, 3},
    {"fmod", 0x19, 3}, {"feq", 0x1A, 3},
};

const WideForm kIndirect[] = {
    {"ldi.64", 0x20, 0},    {"sti.64", 0x21, 1},    {"ldi.octet", 0x22, 0},
    {"sti.octet", 0x23, 1}, {"ldi.16", 0x24, 0},    {"sti.16", 0x25, 1},
    {"ldi.32", 0x26, 0},    {"sti.32", 0x27, 1},    {"ldi.f64", 0x28, 0},
    {"sti.f64", 0x29, 1},   {"ldi.f32", 0x2A, 0},   {"sti.f32", 0x2B, 1},
};

void appendByte(std::vector<uint8_t>& out, uint8_t value) { out.push_back(value); }

void append32(std::vector<uint8_t>& out, uint32_t value) {
  for (int shift = 0; shift < 32; shift += 8) {
    appendByte(out, static_cast<uint8_t>((value >> shift) & 0xff));
  }
}

void append16(std::vector<uint8_t>& out, uint16_t value) {
  appendByte(out, static_cast<uint8_t>(value & 0xff));
  appendByte(out, static_cast<uint8_t>((value >> 8) & 0xff));
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

uint64_t bitsOf(const std::string& token) {
  bool negative = false;
  std::string body = token;
  if (!body.empty() && body[0] == '-') {
    negative = true;
    body = body.substr(1);
  }
  uint64_t magnitude = 0;
  if (!parseUnsigned(body, magnitude)) fail("立即数无法识别 " + token);
  if (!negative) return magnitude;
  if (magnitude > 0x8000000000000000ull) fail("立即数小于有符号 64 位 " + token);
  if (magnitude == 0) return 0;
  return ~magnitude + 1;
}

int zapReg(const std::string& token) {
  if (token.size() != 2 || token[0] != 'r' || token[1] < '0' || token[1] > '7') {
    fail("寄存器无法识别 " + token);
  }
  static const int map[8] = {0, 1, 2, 6, 7, 8, 9, 10};
  return map[token[1] - '0'];
}

uint32_t jumpIndex(const std::string& token) {
  uint64_t value = 0;
  if (!parseUnsigned(token, value) || value > 0xffffffffull) fail("跳转目标放不进 32 位 " + token);
  return static_cast<uint32_t>(value);
}

const EscapeForm* findEscape(const std::string& name) {
  for (const EscapeForm& item : kEscape) {
    if (name == item.name) return &item;
  }
  return nullptr;
}

const WideForm* findWide(const std::string& name) {
  for (const WideForm& item : kWide) {
    if (name == item.name) return &item;
  }
  return nullptr;
}

const WideForm* findIndirect(const std::string& name) {
  for (const WideForm& item : kIndirect) {
    if (name == item.name) return &item;
  }
  return nullptr;
}

bool absoluteMemory(const std::string& name) {
  return name.rfind("load.", 0) == 0 || name.rfind("store.", 0) == 0;
}

const WideForm* absoluteAsIndirect(const std::string& name) {
  if (name.rfind("load.", 0) == 0) return findIndirect("ldi." + name.substr(5));
  if (name.rfind("store.", 0) == 0) return findIndirect("sti." + name.substr(6));
  return nullptr;
}

enum class Kind { Bias, Restore, Halt, Return, Place, Jump, Call, Absolute, Indirect, Wide, Escape };

struct Plan {
  Kind kind = Kind::Halt;
  int opcode = 0;
  int registers = 0;
  int size = 0;
};

bool supported(const std::vector<std::string>& parts) {
  if (parts.empty()) return false;
  const std::string& head = parts[0];
  if (head == "rsp.bias" || head == "rsp.restore" || head == "halt" || head == "place") return parts.size() == (head == "place" ? 3 : 1);
  if (head == "jmp") return parts.size() == 2;
  if (head == "jz" || head == "jnz" || head == "link" || head == "call") return parts.size() == 3;
  if (absoluteMemory(head)) return parts.size() == 3 && absoluteAsIndirect(head) != nullptr;
  const WideForm* indirect = findIndirect(head);
  if (indirect != nullptr) return parts.size() == 3;
  const WideForm* wide = findWide(head);
  if (wide != nullptr) return static_cast<int>(parts.size()) == wide->registers + 1;
  const EscapeForm* escape = findEscape(head);
  return escape != nullptr && static_cast<int>(parts.size()) == escape->registers + 1;
}

Plan planOf(const std::vector<std::string>& parts) {
  const std::string& head = parts[0];
  Plan plan;
  if (head == "rsp.bias" || head == "rsp.restore") {
    if (parts.size() != 1) fail("无法编码 " + head);
    plan.kind = head == "rsp.bias" ? Kind::Bias : Kind::Restore;
    plan.size = 4;
    return plan;
  }
  if (head == "halt") {
    if (parts.size() != 1) fail("无法编码 halt");
    plan.kind = Kind::Halt;
    plan.size = 1;
    return plan;
  }
  if (head == "jmp") {
    if (parts.size() != 2) fail("无法编码 jmp");
    plan.kind = Kind::Return;
    plan.size = 1;
    return plan;
  }
  if (head == "place") {
    if (parts.size() != 3) fail("无法编码 place");
    plan.kind = Kind::Place;
    plan.size = 10;
    return plan;
  }
  if (head == "jz" || head == "jnz") {
    if (parts.size() != 3) fail("无法编码 " + head);
    plan.kind = Kind::Jump;
    plan.opcode = head == "jz" ? 0x84 : 0x85;
    plan.size = 12;
    return plan;
  }
  if (head == "link" || head == "call") {
    if (parts.size() != 3) fail("无法编码 " + head);
    plan.kind = Kind::Call;
    plan.size = 5;
    return plan;
  }
  if (absoluteMemory(head)) {
    if (parts.size() != 3 || absoluteAsIndirect(head) == nullptr) fail("无法编码 " + head);
    plan.kind = Kind::Absolute;
    plan.size = 16;
    return plan;
  }
  const WideForm* indirect = findIndirect(head);
  if (indirect != nullptr) {
    if (parts.size() != 3) fail("无法编码 " + head);
    plan.kind = Kind::Indirect;
    plan.opcode = indirect->opcode;
    plan.size = 6;
    return plan;
  }
  const WideForm* wide = findWide(head);
  if (wide != nullptr) {
    if (static_cast<int>(parts.size()) != wide->registers + 1) fail("无法编码 " + head);
    plan.kind = Kind::Wide;
    plan.opcode = wide->opcode;
    plan.registers = wide->registers;
    plan.size = 6;
    return plan;
  }
  const EscapeForm* escape = findEscape(head);
  if (escape == nullptr || static_cast<int>(parts.size()) != escape->registers + 1) fail("无法编码 " + head);
  plan.kind = Kind::Escape;
  plan.opcode = escape->opcode;
  plan.registers = escape->registers;
  plan.size = 3 + escape->registers;
  return plan;
}

void appendRel(std::vector<uint8_t>& out, int64_t next, int64_t target) {
  const int64_t rel = target - next;
  if (rel < -2147483648ll || rel > 2147483647ll) fail("相对位移放不进 32 位");
  append32(out, static_cast<uint32_t>(static_cast<int32_t>(rel)));
}

void appendWide(std::vector<uint8_t>& out, int opcode, int dest, int left, int right) {
  appendByte(out, 0x0F);
  appendByte(out, 0x3E);
  appendByte(out, static_cast<uint8_t>(opcode));
  appendByte(out, static_cast<uint8_t>(dest));
  appendByte(out, static_cast<uint8_t>(left));
  appendByte(out, static_cast<uint8_t>(right));
}

void emitOne(std::vector<uint8_t>& out, const std::vector<std::string>& parts, const Plan& plan, int64_t at, const std::vector<int>& starts) {
  if (plan.kind == Kind::Bias) {
    const uint8_t bytes[] = {0x48, 0x83, 0xEC, 0x08};
    out.insert(out.end(), bytes, bytes + 4);
    return;
  }
  if (plan.kind == Kind::Restore) {
    const uint8_t bytes[] = {0x48, 0x83, 0xC4, 0x08};
    out.insert(out.end(), bytes, bytes + 4);
    return;
  }
  if (plan.kind == Kind::Halt) {
    appendByte(out, 0xF4);
    return;
  }
  if (plan.kind == Kind::Return) {
    const int reg = zapReg(parts[1]);
    if (reg != 9 && reg != 10) fail("返回只能从链接寄存器");
    appendByte(out, 0xC3);
    return;
  }
  if (plan.kind == Kind::Place) {
    const std::vector<uint8_t> bytes = nativeMovImm(zapReg(parts[1]), bitsOf(parts[2]));
    out.insert(out.end(), bytes.begin(), bytes.end());
    return;
  }
  if (plan.kind == Kind::Jump) {
    const uint32_t index = jumpIndex(parts[2]);
    if (index >= starts.size()) fail("跳转目标越出映像");
    appendByte(out, 0x4D);
    appendByte(out, 0x31);
    appendByte(out, 0xDB);
    const int reg = zapReg(parts[1]);
    appendByte(out, reg >= 8 ? 0x4D : 0x4C);
    appendByte(out, 0x39);
    appendByte(out, static_cast<uint8_t>(0xD8 | (reg & 7)));
    appendByte(out, 0x0F);
    appendByte(out, static_cast<uint8_t>(plan.opcode));
    appendRel(out, at + plan.size, starts[index]);
    return;
  }
  if (plan.kind == Kind::Call) {
    const uint32_t index = jumpIndex(parts[2]);
    if (index >= starts.size()) fail("跳转目标越出映像");
    appendByte(out, 0xE8);
    appendRel(out, at + plan.size, starts[index]);
    return;
  }
  if (plan.kind == Kind::Absolute) {
    const WideForm* form = absoluteAsIndirect(parts[0]);
    if (form == nullptr) fail("无法编码 " + parts[0]);
    const uint64_t address = bitsOf(parts[2]);
    if (address % 8 != 0) fail("绝对地址没有按 8 位对齐 " + parts[2]);
    const std::vector<uint8_t> mov = nativeMovImm(kScratch, address);
    out.insert(out.end(), mov.begin(), mov.end());
    const bool store = form->registers == 1;
    const int value = zapReg(parts[1]);
    appendWide(out, form->opcode, store ? value : value, kScratch, 0);
    return;
  }
  if (plan.kind == Kind::Indirect) {
    const WideForm* form = findIndirect(parts[0]);
    if (form == nullptr) fail("无法编码 " + parts[0]);
    const bool store = form->registers == 1;
    appendWide(out, form->opcode, zapReg(parts[1]), zapReg(parts[2]), 0);
    (void)store;
    return;
  }
  if (plan.kind == Kind::Wide) {
    const int dest = zapReg(parts[1]);
    const int left = plan.registers >= 2 ? zapReg(parts[2]) : 0;
    const int right = plan.registers >= 3 ? zapReg(parts[3]) : 0;
    appendWide(out, plan.opcode, dest, left, right);
    return;
  }
  appendByte(out, 0x0F);
  appendByte(out, 0x3F);
  appendByte(out, static_cast<uint8_t>(plan.opcode));
  for (int index = 0; index < plan.registers; index += 1) {
    appendByte(out, static_cast<uint8_t>(zapReg(parts[static_cast<std::size_t>(index + 1)])));
  }
}

void writeName(std::vector<uint8_t>& out, const std::string& name) {
  if (name.empty() || name.size() > 64) fail("符号名超出范围");
  for (unsigned char item : name) {
    if (item < 0x21 || item > 0x7e) fail("符号名超出范围");
  }
  appendByte(out, static_cast<uint8_t>(name.size()));
  for (unsigned char item : name) appendByte(out, item);
}

}  // namespace

bool nativeReady(const std::vector<std::string>& lines) {
  for (const std::string& line : lines) {
    const std::vector<std::string> parts = tokensOf(line);
    if (!supported(parts)) return false;
  }
  return true;
}

void writeNativeProgram(const std::string& path, const std::vector<std::string>& lines, const std::vector<NativeSymbol>& symbols) {
  if (kUi % 8 != 0 || (kUi / 8) % 16 != 0) fail("硬件栈没有按 16 个八位组对齐");
  std::vector<std::vector<std::string>> tokens;
  std::vector<Plan> plans;
  tokens.reserve(lines.size());
  plans.reserve(lines.size());
  for (const std::string& line : lines) {
    const std::vector<std::string> parts = tokensOf(line);
    if (parts.empty()) fail("空指令");
    tokens.push_back(parts);
    plans.push_back(planOf(parts));
  }
  const int prologue = 10;
  std::vector<int> starts(lines.size(), 0);
  int cursor = prologue;
  for (std::size_t index = 0; index < plans.size(); index += 1) {
    starts[index] = cursor;
    cursor += plans[index].size;
  }
  std::vector<uint8_t> code = nativeMovImm(4, static_cast<uint64_t>(kUi / 8));
  if (static_cast<int>(code.size()) != prologue) fail("栈指针入口长度不对");
  for (std::size_t index = 0; index < plans.size(); index += 1) {
    const std::size_t before = code.size();
    emitOne(code, tokens[index], plans[index], starts[index], starts);
    if (static_cast<int>(code.size() - before) != plans[index].size) {
      fail("指令长度和计划不一致 " + lines[index] + " 实际 " + std::to_string(code.size() - before) + " 计划 " + std::to_string(plans[index].size));
    }
  }
  if (code.size() > 0xffffffffu) fail("原生代码放不进 32 位长度");
  std::vector<uint8_t> bytes;
  appendByte(bytes, 0x5A);
  appendByte(bytes, 0x4E);
  appendByte(bytes, 0x42);
  appendByte(bytes, 0x31);
  append16(bytes, 1);
  append16(bytes, 0);
  append32(bytes, static_cast<uint32_t>(code.size()));
  bytes.insert(bytes.end(), code.begin(), code.end());
  if (!symbols.empty()) {
    if (symbols.size() > 256) fail("符号太多");
    append32(bytes, static_cast<uint32_t>(symbols.size()));
    for (const NativeSymbol& item : symbols) {
      if (item.index >= starts.size()) fail("没有导出 " + item.name);
      writeName(bytes, item.name);
      append32(bytes, static_cast<uint32_t>(starts[item.index]));
    }
    append32(bytes, 0);
    append32(bytes, 0);
  }
  std::ofstream output(path, std::ios::binary);
  if (!output) fail("写不出 " + path);
  output.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
  if (!output) fail("写不出 " + path);
}

}  // namespace obr
