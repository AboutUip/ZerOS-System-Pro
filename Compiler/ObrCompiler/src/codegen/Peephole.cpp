#include "Peephole.hpp"

#include "../Diagnostic.hpp"
#include "Layout.hpp"

#include <cstdint>
#include <map>
#include <string>
#include <utility>
#include <vector>

namespace obr {
namespace {

constexpr int64_t kFoldLimit = 1048576;

bool canEmit(int64_t value) { return value > -kFoldLimit && value < kFoldLimit; }

bool parseImm(const std::string& token, int64_t& value) {
  if (token.empty()) return false;
  std::size_t index = 0;
  bool neg = false;
  if (token[0] == '-') {
    neg = true;
    index = 1;
  }
  if (index >= token.size()) return false;
  std::uint64_t mag = 0;
  for (; index < token.size(); index += 1) {
    const char item = token[index];
    if (item < '0' || item > '9') return false;
    const std::uint64_t digit = static_cast<std::uint64_t>(item - '0');
    if (mag > (static_cast<std::uint64_t>(INT64_MAX) - digit) / 10) return false;
    mag = mag * 10 + digit;
  }
  if (!neg) {
    value = static_cast<int64_t>(mag);
    return true;
  }
  if (mag > static_cast<std::uint64_t>(INT64_MAX) + 1) return false;
  if (mag == static_cast<std::uint64_t>(INT64_MAX) + 1) {
    value = INT64_MIN;
    return true;
  }
  value = -static_cast<int64_t>(mag);
  return true;
}

bool add64(int64_t left, int64_t right, int64_t& out) {
  if ((right > 0 && left > INT64_MAX - right) || (right < 0 && left < INT64_MIN - right)) return false;
  out = left + right;
  return true;
}

bool mul64(int64_t left, int64_t right, int64_t& out) {
  if (left > 0) {
    if ((right > 0 && left > INT64_MAX / right) || (right < 0 && right < INT64_MIN / left)) return false;
  } else if (left < 0) {
    if ((right > 0 && left < INT64_MIN / right) || (right < 0 && left < INT64_MAX / right)) return false;
  }
  out = left * right;
  return true;
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
  const auto mark = [](char item, bool first) {
    const bool digit = item >= '0' && item <= '9';
    const bool alpha = (item >= 'A' && item <= 'Z') || (item >= 'a' && item <= 'z') || item == '_';
    return first ? alpha : digit || alpha;
  };
  if (!mark(line[0], true)) return false;
  for (std::size_t index = 1; index + 1 < line.size(); index += 1) {
    if (!mark(line[index], false)) return false;
  }
  return true;
}

int regOf(const std::string& token) {
  if (token.size() == 2 && token[0] == 'r' && token[1] >= '0' && token[1] <= '7') return token[1] - '0';
  return -1;
}

int widthOf(const std::string& head) {
  if (head.size() >= 3 && head.compare(head.size() - 3, 3, ".64") == 0) return 64;
  if (head.size() >= 4 && head.compare(head.size() - 4, 4, ".f64") == 0) return 64;
  if (head.size() >= 3 && head.compare(head.size() - 3, 3, ".32") == 0) return 32;
  if (head.size() >= 4 && head.compare(head.size() - 4, 4, ".f32") == 0) return 32;
  if (head.size() >= 3 && head.compare(head.size() - 3, 3, ".16") == 0) return 16;
  if (head.size() >= 6 && head.compare(head.size() - 6, 6, ".octet") == 0) return 8;
  if (head.size() >= 4 && head.compare(head.size() - 4, 4, ".bit") == 0) return 1;
  return -1;
}

bool preserves(int64_t imm, int width) {
  if (width >= 64) return true;
  if (width == 32) return imm >= -2147483648LL && imm <= 2147483647LL;
  if (width == 16) return imm >= -32768 && imm <= 32767;
  if (width == 8) return imm >= -128 && imm <= 127;
  return false;
}

/** 不小于数据下限的正立即数在 -pie 里会加窗口位移。负数和算出来的小结果不会。 */
std::string immAddr(int64_t imm) {
  if (canEmit(imm)) return "c:" + std::to_string(imm);
  if (imm >= kFoldLimit) return "r:" + std::to_string(imm);
  return "n:" + std::to_string(imm);
}

bool compilerCell(int64_t addr) {
  const int64_t cells[] = {kSp, kFrame, kHeapPtr};
  for (const int64_t cell : cells) if (addr == cell) return true;
  return false;
}

std::string addOff(const std::string& addr, int64_t delta) {
  if (addr.empty()) return "";
  if (addr[0] == 'v') {
    const std::size_t hash = addr.rfind('#');
    if (hash == std::string::npos) return "";
    int64_t off = 0;
    if (!parseImm(addr.substr(hash + 1), off)) return "";
    int64_t sum = 0;
    if (!add64(off, delta, sum)) return "";
    return addr.substr(0, hash + 1) + std::to_string(sum);
  }
  if (addr.size() < 3 || addr[1] != ':') return "";
  const char kind = addr[0];
  int64_t number = 0;
  if (!parseImm(addr.substr(2), number)) return "";
  int64_t sum = 0;
  if (!add64(number, delta, sum)) return "";
  if (kind == 'r') return "r:" + std::to_string(sum);
  if (canEmit(sum)) return "c:" + std::to_string(sum);
  return "n:" + std::to_string(sum);
}

struct Reg {
  bool emitOk = false;
  int64_t imm = 0;
  bool hasAddr = false;
  std::string addr;
  bool hasMem = false;
  std::string memAddr;
  int memWidth = 0;
  bool privateAddress = false;
};

struct Fact {
  bool emitOk = false;
  int64_t imm = 0;
  int width = 0;
};

bool numericId(const std::string& id, int64_t& number) {
  if (id.size() < 3 || id[1] != ':') return false;
  const char kind = id[0];
  if (kind != 'c' && kind != 'r' && kind != 'n') return false;
  return parseImm(id.substr(2), number);
}

/** 私有性约束整个访问区间；没有数值范围证明的符号指针不能仅凭来源获得转发资格。 */
bool privateSpan(const Reg& pointer, int width) {
  if (!pointer.privateAddress || width <= 0) return false;
  int64_t address = 0;
  if (!numericId(pointer.addr, address)) return false;
  return address >= kStack && address <= static_cast<int64_t>(kUi) - width;
}

/** 从一次装入长出来的指针：v:序号:来源#位偏移。序号不同表示不是同一次装入。 */
bool slotId(const std::string& id, int& serial, int64_t& offset) {
  if (id.size() < 5 || id[0] != 'v' || id[1] != ':') return false;
  const std::size_t colon = id.find(':', 2);
  const std::size_t hash = id.rfind('#');
  if (colon == std::string::npos || hash == std::string::npos || hash < colon) return false;
  int64_t raw = 0;
  if (!parseImm(id.substr(2, colon - 2), raw) || raw < 0 || raw > 2147483647) return false;
  if (!parseImm(id.substr(hash + 1), offset)) return false;
  serial = static_cast<int>(raw);
  return true;
}

bool spanOverlap(int64_t left, int leftWidth, int64_t right, int rightWidth) {
  if (leftWidth <= 0 || rightWidth <= 0) return true;
  int64_t leftEnd = 0;
  int64_t rightEnd = 0;
  if (!add64(left, leftWidth, leftEnd) || !add64(right, rightWidth, rightEnd)) return true;
  return left < rightEnd && right < leftEnd;
}

/**
 * 地址按位。同一条装入推出来的两个槽，区间相交才冲突。
 * 另一次装入、或槽和绝对地址，都可能指到同一处，按冲突处理。
 * 重定位分类描述的是地址来源，不是互斥地址空间：算术可将高地址移到小地址区，
 * PIE 的窗口位移也可能改变两种来源的相对关系。分类不同且无法证明位移时，保守按冲突处理。
 */
bool overlap(const std::string& left, int leftWidth, const std::string& right, int rightWidth) {
  if (left.empty() || right.empty()) return true;
  if (left == right) return true;
  int leftSerial = 0;
  int rightSerial = 0;
  int64_t leftOff = 0;
  int64_t rightOff = 0;
  const bool leftSlot = slotId(left, leftSerial, leftOff);
  const bool rightSlot = slotId(right, rightSerial, rightOff);
  if (leftSlot || rightSlot) {
    if (!leftSlot || !rightSlot || leftSerial != rightSerial) return true;
    return spanOverlap(leftOff, leftWidth, rightOff, rightWidth);
  }
  int64_t leftNumber = 0;
  int64_t rightNumber = 0;
  if (!numericId(left, leftNumber) || !numericId(right, rightNumber)) return true;
  if (left[0] != right[0]) return true;
  return spanOverlap(leftNumber, leftWidth, rightNumber, rightWidth);
}

bool dangerous(const std::string& addr) {
  if (addr.size() < 3 || addr[0] != 'r' || addr[1] != ':') return false;
  int64_t number = 0;
  if (!parseImm(addr.substr(2), number)) return true;
  return !compilerCell(number);
}

struct Machine {
  Reg regs[8];
  std::map<std::string, Fact> facts;
  int serial = 1;

  void clearRegs() {
    for (Reg& reg : regs) reg = {};
  }

  void clearMem() {
    facts.clear();
    for (Reg& reg : regs) reg.hasMem = false;
  }

  void clearAll() {
    clearRegs();
    facts.clear();
  }

  void invalidate(const std::string& addr, int width) {
    if (addr.empty()) {
      clearMem();
      return;
    }
    std::vector<std::string> drop;
    for (const auto& item : facts) {
      if (overlap(item.first, item.second.width, addr, width)) drop.push_back(item.first);
    }
    for (const std::string& key : drop) facts.erase(key);
    for (Reg& reg : regs) {
      if (reg.hasMem && overlap(reg.memAddr, reg.memWidth, addr, width)) reg.hasMem = false;
    }
    if (dangerous(addr)) clearMem();
  }

  void rememberStore(const std::string& addr, int width, int source, bool privateAccess) {
    if (addr.empty()) {
      clearMem();
      return;
    }
    invalidate(addr, width);
    // 设备/共享区和任意用户指针不能被当成编译器自己的栈槽。
    if (!privateAccess) return;
    Fact fact;
    fact.width = width;
    const Reg& value = regs[source];
    if (value.emitOk && preserves(value.imm, width)) {
      fact.emitOk = true;
      fact.imm = value.imm;
    }
    facts[addr] = fact;
    const bool bits = width >= 64 || fact.emitOk;
    if (bits) {
      regs[source].hasMem = true;
      regs[source].memAddr = addr;
      regs[source].memWidth = width;
    }
  }

  const Fact* factAt(const std::string& addr) const {
    const auto found = facts.find(addr);
    if (found == facts.end()) return nullptr;
    return &found->second;
  }
};

bool holds(const Reg& reg, const std::string& addr, int width, const Fact* fact) {
  if (reg.hasMem && reg.memAddr == addr && reg.memWidth == width) return true;
  return fact != nullptr && fact->emitOk && fact->width == width && reg.emitOk && reg.imm == fact->imm;
}

void setSmall(Reg& reg, int64_t imm) {
  reg = {};
  reg.emitOk = true;
  reg.imm = imm;
  reg.hasAddr = true;
  reg.addr = "c:" + std::to_string(imm);
}

std::string placeOf(int dest, int64_t imm) { return "place r" + std::to_string(dest) + ", " + std::to_string(imm); }

std::string copyOf(int dest, int src) {
  return "or r" + std::to_string(dest) + ", r" + std::to_string(src) + ", r" + std::to_string(src);
}

bool arithmetic(const std::string& op, int64_t left, int64_t right, int64_t& out) {
  if (op == "add") return add64(left, right, out);
  if (op == "sub") {
    if (right == INT64_MIN) return false;
    return add64(left, -right, out);
  }
  if (op == "mul") return mul64(left, right, out);
  if (op == "and") {
    out = left & right;
    return true;
  }
  if (op == "or") {
    out = left | right;
    return true;
  }
  if (op == "xor") {
    out = left ^ right;
    return true;
  }
  if (op == "eq") {
    out = left == right ? 1 : 0;
    return true;
  }
  if (op == "lt") {
    out = left < right ? 1 : 0;
    return true;
  }
  if (op == "le") {
    out = left <= right ? 1 : 0;
    return true;
  }
  if (op == "gt") {
    out = left > right ? 1 : 0;
    return true;
  }
  if (op == "ge") {
    out = left >= right ? 1 : 0;
    return true;
  }
  if (op == "div" || op == "mod") {
    if (right == 0 || (left == INT64_MIN && right == -1)) return false;
    const int64_t quot = left / right;
    out = op == "div" ? quot : left - quot * right;
    return true;
  }
  if (op == "udiv" || op == "umod") {
    if (left < 0 || right <= 0) return false;
    out = op == "udiv" ? left / right : left % right;
    return true;
  }
  if (op == "shl") {
    if (right < 0 || right > 63) return false;
    int64_t cur = left;
    for (int64_t step = 0; step < right; step += 1) {
      if (cur >= kFoldLimit / 2 || cur < -(kFoldLimit / 2)) return false;
      cur *= 2;
    }
    out = cur;
    return canEmit(cur);
  }
  if (op == "shr") {
    if (right < 0 || right > 63) return false;
    int64_t cur = left;
    for (int64_t step = 0; step < right; step += 1) {
      if (cur >= 0) cur = cur / 2;
      else cur = (cur - 1) / 2;
    }
    out = cur;
    return true;
  }
  return false;
}

bool isFloat(const std::string& op) {
  return op == "fadd" || op == "fsub" || op == "fmul" || op == "fdiv" || op == "fpow" || op == "fmod" || op == "feq" || op == "itof";
}

struct View {
  std::string head;
  int regs[4]{};
  int nregs = 0;
  bool immOk = false;
  int64_t imm = 0;
  bool ok = false;
};

View viewOf(const std::vector<std::string>& parts, bool label) {
  View view;
  if (label) return view;
  if (parts.empty()) return view;
  view.head = parts[0];
  view.ok = true;
  for (std::size_t index = 1; index < parts.size() && view.nregs < 4; index += 1) {
    const int reg = regOf(parts[index]);
    if (reg < 0) break;
    view.regs[view.nregs] = reg;
    view.nregs += 1;
  }
  if (parts.size() >= 3) view.immOk = parseImm(parts.back(), view.imm);
  return view;
}

/** 窥孔机器 IR：寄存器、立即数和源位置仅解析一次，CFG/前向传播共用。 */
struct Line {
  std::string text;
  DebugSite site;
  std::vector<std::string> parts;
  bool label;
  View view;

  Line(std::string source, DebugSite location)
      : text(std::move(source)), site(std::move(location)), parts(tokensOf(text)),
        label(isLabel(text)), view(viewOf(parts, label)) {}
};

enum class LiveKind { None, Pure, Keep, Clobber };

struct Live {
  LiveKind kind = LiveKind::Clobber;
  bool hasDef = false;
  int def = 0;
  int uses[8]{};
  int nuses = 0;
};

void addUse(Live& live, int reg) {
  if (reg < 0) return;
  live.uses[live.nuses] = reg;
  live.nuses += 1;
}

Live liveOf(const Line& instruction) {
  const std::string& line = instruction.text;
  Live live;
  if (line.empty() || instruction.label) {
    live.kind = LiveKind::None;
    return live;
  }
  if (line == "halt") {
    live.kind = LiveKind::Keep;
    addUse(live, 0);
    return live;
  }
  if (line == "rsp.bias" || line == "rsp.restore" || line == "yield" || line == "dwell") {
    live.kind = LiveKind::Keep;
    return live;
  }
  // 返回边界保守保留全寄存器状态。文本中包含多值返回的手写运行时和内联路径，
  // DebugSite 只描述源码，不能被当成调用约定摘要。没有跨函数 clobber 证明前不能只留 r0/r7。
  if (line == "ret") return live;
  const View& view = instruction.view;
  if (!view.ok) return live;
  const std::string& head = view.head;
  if (head == "call") return live;
  if (head == "jz" || head == "jnz" || head == "jmp") {
    live.kind = LiveKind::Keep;
    if (view.nregs >= 1) addUse(live, view.regs[0]);
    return live;
  }
  if (head == "place") {
    live.kind = LiveKind::Pure;
    if (view.nregs >= 1) {
      live.hasDef = true;
      live.def = view.regs[0];
    }
    return live;
  }
  if (head == "not") {
    live.kind = LiveKind::Pure;
    if (view.nregs >= 1) {
      live.hasDef = true;
      live.def = view.regs[0];
    }
    if (view.nregs >= 2) addUse(live, view.regs[1]);
    return live;
  }
  const int width = widthOf(head);
  if (width > 0 && head.rfind("load.", 0) == 0 && head != "load.scale") {
    live.kind = LiveKind::Keep;
    if (view.nregs >= 1) {
      live.hasDef = true;
      live.def = view.regs[0];
    }
    return live;
  }
  if (width > 0 && head.rfind("store.", 0) == 0 && head != "store.scale") {
    live.kind = LiveKind::Keep;
    if (view.nregs >= 1) addUse(live, view.regs[0]);
    return live;
  }
  if (width > 0 && head.rfind("ldi.", 0) == 0) {
    live.kind = LiveKind::Keep;
    if (view.nregs >= 1) {
      live.hasDef = true;
      live.def = view.regs[0];
    }
    if (view.nregs >= 2) addUse(live, view.regs[1]);
    return live;
  }
  if (width > 0 && head.rfind("sti.", 0) == 0) {
    live.kind = LiveKind::Keep;
    if (view.nregs >= 1) addUse(live, view.regs[0]);
    if (view.nregs >= 2) addUse(live, view.regs[1]);
    return live;
  }
  if (head == "load.scale") {
    live.kind = LiveKind::Keep;
    if (view.nregs >= 1) {
      live.hasDef = true;
      live.def = view.regs[0];
    }
    if (view.nregs >= 2) addUse(live, view.regs[1]);
    if (view.nregs >= 3) addUse(live, view.regs[2]);
    return live;
  }
  if (head == "store.scale") {
    live.kind = LiveKind::Keep;
    for (int index = 0; index < view.nregs && index < 3; index += 1) addUse(live, view.regs[index]);
    return live;
  }
  if (isFloat(head) || head == "query") {
    live.kind = LiveKind::Keep;
    if (view.nregs >= 1) {
      live.hasDef = true;
      live.def = view.regs[0];
    }
    for (int index = 1; index < view.nregs; index += 1) addUse(live, view.regs[index]);
    return live;
  }
  const bool alu = head == "add" || head == "sub" || head == "mul" || head == "and" || head == "or" || head == "xor" || head == "eq" || head == "lt" || head == "le" || head == "gt" || head == "ge";
  const bool trap = head == "div" || head == "mod" || head == "udiv" || head == "umod" || head == "shl" || head == "shr";
  if ((alu || trap) && view.nregs >= 1) {
    live.kind = trap ? LiveKind::Keep : LiveKind::Pure;
    live.hasDef = true;
    live.def = view.regs[0];
    if (view.nregs >= 2) addUse(live, view.regs[1]);
    if (view.nregs >= 3) addUse(live, view.regs[2]);
    return live;
  }
  return live;
}

bool transfer(const Live& effect, bool live[8]) {
  if (effect.kind == LiveKind::Clobber) {
    for (int index = 0; index < 8; index += 1) live[index] = true;
    return false;
  }
  if (effect.kind == LiveKind::None) return false;
  if (effect.kind == LiveKind::Pure && effect.hasDef && !live[effect.def]) return true;
  if (effect.hasDef) {
    bool read = false;
    for (int index = 0; index < effect.nuses; index += 1) {
      if (effect.uses[index] == effect.def) read = true;
    }
    if (!read) live[effect.def] = false;
  }
  for (int index = 0; index < effect.nuses; index += 1) live[effect.uses[index]] = true;
  return false;
}

void writeSmall(std::vector<Line>& out, const Line& line, int dest, int64_t imm, Machine& machine) {
  out.emplace_back(placeOf(dest, imm), line.site);
  setSmall(machine.regs[dest], imm);
}

void writeCopy(std::vector<Line>& out, const Line& line, int dest, int src, const Reg& saved, Machine& machine) {
  if (dest == src) return;
  out.emplace_back(copyOf(dest, src), line.site);
  machine.regs[dest] = saved;
}

bool takeLoad(Machine& machine, const std::string& addr, int width, int dest, Line& line, std::vector<Line>& out, bool privateAccess) {
  if (!privateAccess) {
    Reg next;
    next.hasAddr = true;
    next.addr = "v:" + std::to_string(machine.serial++) + ":" + addr + ":" + std::to_string(width) + "#0";
    machine.regs[dest] = next;
    out.push_back(std::move(line));
    return true;
  }
  const Fact* fact = machine.factAt(addr);
  if (holds(machine.regs[dest], addr, width, fact)) {
    machine.regs[dest].hasMem = true;
    machine.regs[dest].memAddr = addr;
    machine.regs[dest].memWidth = width;
    return true;
  }
  int holder = -1;
  for (int index = 0; index < 8; index += 1) {
    if (machine.regs[index].hasMem && machine.regs[index].memAddr == addr && machine.regs[index].memWidth == width) holder = index;
  }
  if (holder >= 0) {
    const Reg saved = machine.regs[holder];
    writeCopy(out, line, dest, holder, saved, machine);
    machine.regs[dest].hasMem = true;
    machine.regs[dest].memAddr = addr;
    machine.regs[dest].memWidth = width;
    return true;
  }
  if (fact != nullptr && fact->emitOk && fact->width == width) {
    writeSmall(out, line, dest, fact->imm, machine);
    machine.regs[dest].hasMem = true;
    machine.regs[dest].memAddr = addr;
    machine.regs[dest].memWidth = width;
    return true;
  }
  Reg next;
  next.hasMem = true;
  next.memAddr = addr;
  next.memWidth = width;
  next.hasAddr = true;
  next.addr = "v:" + std::to_string(machine.serial) + ":" + addr + ":" + std::to_string(width) + "#0";
  // 从帧/栈指针字加载只证明值的来源，不证明加载宽度、实际指针或完整访问范围。
  // 尤其窄加载可能只剩低位并落入共享区。无数值范围证明时只保留符号别名关系。
  machine.serial += 1;
  if (fact != nullptr && fact->emitOk && fact->width == width) {
    next.emitOk = true;
    next.imm = fact->imm;
    next.addr = "c:" + std::to_string(fact->imm);
  }
  machine.regs[dest] = next;
  out.push_back(std::move(line));
  return true;
}

// 每轮接收上一轮的唯一所有权；未改写的行直接搬入输出，避免深拷贝token和DebugSite。
// 发射后不再读取被搬走的行；改写指令仍先按原DebugSite构造新行。
void forward(std::vector<Line>& input, std::vector<Line>& output, const OptimizationOptions& options) {
  Machine machine;
  for (Line& line : input) {
    if (line.site.opaque) {
      machine.clearAll();
      output.push_back(std::move(line));
      continue;
    }
    if (line.label) {
      machine.clearAll();
      output.push_back(std::move(line));
      continue;
    }
    const View& view = line.view;
    if (!view.ok) {
      output.push_back(std::move(line));
      continue;
    }
    const std::string& head = view.head;
    if (head == "call" || head == "ret" || head == "halt") {
      output.push_back(std::move(line));
      machine.clearAll();
      continue;
    }
    if (head == "yield" || head == "dwell") {
      output.push_back(std::move(line));
      machine.clearMem();
      continue;
    }
    if (head == "jz" || head == "jnz" || head == "jmp" || head == "rsp.bias" || head == "rsp.restore") {
      output.push_back(std::move(line));
      continue;
    }
    if (head == "place" && view.nregs >= 1) {
      Reg next;
      if (view.immOk) {
        if (canEmit(view.imm)) {
          next.emitOk = true;
          next.imm = view.imm;
        }
        next.hasAddr = true;
        next.addr = immAddr(view.imm);
        next.privateAddress = view.imm >= kStack && view.imm < kUi;
      }
      machine.regs[view.regs[0]] = next;
      output.push_back(std::move(line));
      continue;
    }
    const int width = widthOf(head);
    if (width > 0 && head.rfind("load.", 0) == 0 && head != "load.scale" && view.nregs >= 1 && view.immOk) {
      takeLoad(machine, immAddr(view.imm), width, view.regs[0], line, output, options.loadForward && compilerCell(view.imm));
      continue;
    }
    if (width > 0 && head.rfind("store.", 0) == 0 && head != "store.scale" && view.nregs >= 1 && view.immOk) {
      machine.rememberStore(immAddr(view.imm), width, view.regs[0], options.loadForward && compilerCell(view.imm));
      output.push_back(std::move(line));
      continue;
    }
    if (width > 0 && head.rfind("ldi.", 0) == 0 && view.nregs >= 2) {
      const int dest = view.regs[0];
      const int pointer = view.regs[1];
      if (!machine.regs[pointer].hasAddr) {
        machine.regs[dest] = {};
        output.push_back(std::move(line));
      } else {
        const std::string addr = machine.regs[pointer].addr;
        takeLoad(machine, addr, width, dest, line, output, options.loadForward && privateSpan(machine.regs[pointer], width));
      }
      continue;
    }
    if (width > 0 && head.rfind("sti.", 0) == 0 && view.nregs >= 2) {
      const int pointer = view.regs[1];
      if (!machine.regs[pointer].hasAddr) machine.clearMem();
      else {
        const std::string addr = machine.regs[pointer].addr;
        machine.rememberStore(addr, width, view.regs[0], options.loadForward && privateSpan(machine.regs[pointer], width));
      }
      output.push_back(std::move(line));
      continue;
    }
    if (head == "load.scale" && view.nregs >= 1) {
      machine.regs[view.regs[0]] = {};
      output.push_back(std::move(line));
      continue;
    }
    if (head == "store.scale") {
      output.push_back(std::move(line));
      machine.clearMem();
      continue;
    }
    if ((isFloat(head) || head == "query") && view.nregs >= 1) {
      machine.regs[view.regs[0]] = {};
      output.push_back(std::move(line));
      continue;
    }
    if (head == "not" && view.nregs >= 2) {
      const Reg source = machine.regs[view.regs[1]];
      if (options.fold && source.emitOk) {
        const int64_t result = -source.imm - 1;
        if (canEmit(result)) {
          writeSmall(output, line, view.regs[0], result, machine);
          continue;
        }
      }
      machine.regs[view.regs[0]] = {};
      output.push_back(std::move(line));
      continue;
    }
    const bool alu = head == "add" || head == "sub" || head == "mul" || head == "div" || head == "mod" || head == "udiv" || head == "umod" || head == "and" || head == "or" || head == "xor" || head == "shl" || head == "shr" || head == "eq" || head == "lt" || head == "le" || head == "gt" || head == "ge";
    if (alu && view.nregs >= 3) {
      const int dest = view.regs[0];
      const int leftReg = view.regs[1];
      const int rightReg = view.regs[2];
      const Reg left = machine.regs[leftReg];
      const Reg right = machine.regs[rightReg];
      if (options.fold && head == "or" && leftReg == rightReg) {
        writeCopy(output, line, dest, leftReg, left, machine);
        continue;
      }
      if (options.fold && left.emitOk && right.emitOk) {
        int64_t result = 0;
        if (arithmetic(head, left.imm, right.imm, result) && canEmit(result)) {
          writeSmall(output, line, dest, result, machine);
          continue;
        }
      }
      const auto zero = [](const Reg& reg) { return reg.emitOk && reg.imm == 0; };
      const auto one = [](const Reg& reg) { return reg.emitOk && reg.imm == 1; };
      const auto ones = [](const Reg& reg) { return reg.emitOk && reg.imm == -1; };
      if (options.fold && (head == "add" || head == "or" || head == "xor") && zero(right)) {
        writeCopy(output, line, dest, leftReg, left, machine);
        continue;
      }
      if (options.fold && head == "sub" && zero(right)) {
        writeCopy(output, line, dest, leftReg, left, machine);
        continue;
      }
      if (options.fold && head == "add" && zero(left)) {
        writeCopy(output, line, dest, rightReg, right, machine);
        continue;
      }
      if (options.fold && (head == "or" || head == "xor") && zero(left)) {
        writeCopy(output, line, dest, rightReg, right, machine);
        continue;
      }
      if (options.fold && (head == "mul" || head == "div") && one(right)) {
        writeCopy(output, line, dest, leftReg, left, machine);
        continue;
      }
      if (options.fold && head == "mul" && one(left)) {
        writeCopy(output, line, dest, rightReg, right, machine);
        continue;
      }
      if (options.fold && head == "mul" && (zero(left) || zero(right))) {
        writeSmall(output, line, dest, 0, machine);
        continue;
      }
      if (options.fold && head == "and" && (zero(left) || zero(right))) {
        writeSmall(output, line, dest, 0, machine);
        continue;
      }
      if (options.fold && head == "or" && (ones(left) || ones(right))) {
        writeSmall(output, line, dest, -1, machine);
        continue;
      }
      if (options.fold && head == "and" && ones(right)) {
        writeCopy(output, line, dest, leftReg, left, machine);
        continue;
      }
      if (options.fold && head == "and" && ones(left)) {
        writeCopy(output, line, dest, rightReg, right, machine);
        continue;
      }
      if (options.fold && (head == "shl" || head == "shr") && zero(right)) {
        writeCopy(output, line, dest, leftReg, left, machine);
        continue;
      }
      std::string moved;
      if (head == "add" && left.hasAddr && right.emitOk) moved = addOff(left.addr, right.imm);
      else if (head == "add" && right.hasAddr && left.emitOk) moved = addOff(right.addr, left.imm);
      else if (head == "sub" && left.hasAddr && right.emitOk && right.imm != INT64_MIN) {
        moved = addOff(left.addr, -right.imm);
      }
      Reg next;
      if (!moved.empty()) {
        next.hasAddr = true;
        next.addr = std::move(moved);
        next.privateAddress = (left.hasAddr && left.privateAddress && right.emitOk)
            || (head == "add" && right.hasAddr && right.privateAddress && left.emitOk);
        // 来源是私有指针不代表算术结果仍然私有。绝对位置一旦离开栈区，
        // 之后的读取必须保留，写入也不能再建立可复用的私有槽事实。
        int64_t address = 0;
        if (numericId(next.addr, address)) {
          if (address < kStack || address >= kUi) next.privateAddress = false;
        } else if (next.addr != left.addr && next.addr != right.addr) {
          // 帧/栈指针的运行时值没有可用的上下界。偏移改变后无法证明访问仍在私有区，
          // 先撤销转发资格；不能把符号来源当作任意偏移都安全的证明。
          next.privateAddress = false;
        }
      }
      machine.regs[dest] = next;
      output.push_back(std::move(line));
      continue;
    }
    output.push_back(std::move(line));
    machine.clearAll();
  }
}

struct Block {
  int begin = 0;
  int end = 0;
  int succ[2]{-1, -1};
  int nsucc = 0;
  bool sticky = false;
  bool liveIn[8]{};
  bool liveOut[8]{};
};

bool isTerminator(const Line& line) {
  const View& view = line.view;
  if (!view.ok) return false;
  return view.head == "jz" || view.head == "jnz" || view.head == "jmp" || view.head == "ret" || view.head == "halt";
}

void fill(bool live[8], bool value) {
  for (int index = 0; index < 8; index += 1) live[index] = value;
}

bool sameLive(const bool left[8], const bool right[8]) {
  for (int index = 0; index < 8; index += 1) {
    if (left[index] != right[index]) return false;
  }
  return true;
}

void dropDead(std::vector<Line>& lines) {
  const int count = static_cast<int>(lines.size());
  if (count == 0) return;
  // 每条指令的 def/use 只解析一次；活跃性不动点循环不重复分词。
  std::vector<Live> effects;
  effects.reserve(lines.size());
  for (const Line& line : lines) effects.push_back(line.site.opaque ? Live{} : liveOf(line));
  std::vector<char> leader(static_cast<std::size_t>(count), 0);
  leader[0] = 1;
  for (int index = 0; index < count; index += 1) {
    if (lines[static_cast<std::size_t>(index)].label) leader[static_cast<std::size_t>(index)] = 1;
    if (isTerminator(lines[static_cast<std::size_t>(index)]) && index + 1 < count) leader[static_cast<std::size_t>(index + 1)] = 1;
  }
  std::vector<Block> blocks;
  std::vector<int> at(static_cast<std::size_t>(count), -1);
  for (int index = 0; index < count; index += 1) {
    if (leader[static_cast<std::size_t>(index)] == 0) continue;
    Block block;
    block.begin = index;
    int end = index + 1;
    while (end < count && leader[static_cast<std::size_t>(end)] == 0) end += 1;
    block.end = end;
    const int id = static_cast<int>(blocks.size());
    blocks.push_back(block);
    for (int cursor = index; cursor < end; cursor += 1) at[static_cast<std::size_t>(cursor)] = id;
  }
  std::map<std::string, int> labels;
  for (int index = 0; index < count; index += 1) {
    const std::string& text = lines[static_cast<std::size_t>(index)].text;
    if (!lines[static_cast<std::size_t>(index)].label) continue;
    labels.emplace(text.substr(0, text.size() - 1), at[static_cast<std::size_t>(index)]);
  }
  for (Block& block : blocks) {
    const Line& last = lines[static_cast<std::size_t>(block.end - 1)];
    const View& view = last.view;
    const bool stop = view.ok && (view.head == "ret" || view.head == "halt");
    if (!stop && block.end < count) {
      const int next = at[static_cast<std::size_t>(block.end)];
      if (next >= 0) {
        block.succ[block.nsucc] = next;
        block.nsucc += 1;
      }
    }
    if (view.ok && (view.head == "jz" || view.head == "jnz" || view.head == "jmp")) {
      const auto& parts = last.parts;
      int64_t ignore = 0;
      if (parts.size() >= 2 && regOf(parts.back()) < 0 && !parseImm(parts.back(), ignore)) {
        const auto found = labels.find(parts.back());
        if (found == labels.end()) block.sticky = true;
        else if (block.nsucc < 2) {
          block.succ[block.nsucc] = found->second;
          block.nsucc += 1;
        }
      } else if (view.head == "jmp") {
        block.sticky = true;
      }
    }
  }
  for (Block& block : blocks) fill(block.liveIn, false);
  bool converged = false;
  for (int pass = 0; pass < count + 2; pass += 1) {
    bool changed = false;
    for (auto blockAt = blocks.rbegin(); blockAt != blocks.rend(); ++blockAt) {
      Block& block = *blockAt;
      bool cur[8];
      if (block.sticky) fill(cur, true);
      else {
        fill(cur, false);
        for (int index = 0; index < block.nsucc; index += 1) {
          const bool* in = blocks[static_cast<std::size_t>(block.succ[index])].liveIn;
          for (int reg = 0; reg < 8; reg += 1) cur[reg] = cur[reg] || in[reg];
        }
      }
      for (int index = 0; index < 8; index += 1) block.liveOut[index] = cur[index];
      for (int index = block.end - 1; index >= block.begin; index -= 1) {
        transfer(effects[static_cast<std::size_t>(index)], cur);
      }
      if (!sameLive(cur, block.liveIn)) {
        for (int index = 0; index < 8; index += 1) block.liveIn[index] = cur[index];
        changed = true;
      }
    }
    if (!changed) {
      converged = true;
      break;
    }
  }
  if (!converged) return;
  std::vector<char> drop(static_cast<std::size_t>(count), 0);
  for (const Block& block : blocks) {
    bool cur[8];
    for (int index = 0; index < 8; index += 1) cur[index] = block.liveOut[index];
    for (int index = block.end - 1; index >= block.begin; index -= 1) {
      if (transfer(effects[static_cast<std::size_t>(index)], cur)) drop[static_cast<std::size_t>(index)] = 1;
    }
  }
  std::vector<Line> kept;
  kept.reserve(lines.size());
  for (int index = 0; index < count; index += 1) {
    if (drop[static_cast<std::size_t>(index)] == 0) kept.push_back(std::move(lines[static_cast<std::size_t>(index)]));
  }
  lines = std::move(kept);
}

std::vector<Line> split(const std::string& text, const std::vector<DebugSite>& sites) {
  std::vector<Line> lines;
  lines.reserve(sites.size());
  std::string current;
  std::size_t row = 0;
  auto push = [&]() {
    if (row >= sites.size()) fail("对照表和程序行数不一致");
    lines.push_back(Line{current, sites[row]});
    current.clear();
    row += 1;
  };
  for (char item : text) {
    if (item == '\n') push();
    else current.push_back(item);
  }
  if (!current.empty()) push();
  if (row != sites.size()) fail("对照表和程序行数不一致");
  return lines;
}

std::string join(std::vector<Line>& lines, std::vector<DebugSite>& sites) {
  std::string text;
  std::size_t size = 0;
  for (const Line& line : lines) size += line.text.size() + 1;
  text.reserve(size);
  sites.clear();
  sites.reserve(lines.size());
  for (Line& line : lines) {
    text += line.text;
    text += '\n';
    sites.push_back(std::move(line.site));
  }
  return text;
}

}  // namespace

void peel(std::string& text, std::vector<DebugSite>& sites, const OptimizationOptions& options) {
  if (text.empty() && sites.empty()) return;
  if (options.level == 0 || !options.peephole) return;
  std::vector<Line> lines = split(text, sites);
  // 数值/间接目标依赖原来的全局下标。在没有目标重定位信息时必须固定该段，不能删行。
  for (const Line& line : lines) {
    const auto& parts = line.parts;
    if (parts.empty()) continue;
    const auto& op = parts.front();
    int64_t numeric = 0;
    if ((op == "jz" || op == "jnz" || op == "call" || op == "link" || op == "icall")
        && parts.size() > 1 && (parseImm(parts.back(), numeric)
            || (!parts.back().empty() && parts.back()[0] >= '0' && parts.back()[0] <= '9'))) return;
    if (op == "jmp" && parts.size() > 1 && regOf(parts.back()) >= 0) return;
  }
  std::vector<OptimizationPass> passes = options.passes;
  if (passes.empty()) {
    passes = {OptimizationPass::Forward, OptimizationPass::DeadCode};
  }
  std::vector<Line> folded = std::move(lines);
  for (const OptimizationPass pass : passes) {
    // forward 是保持旧默认耗时的合并遍历；两项也能单独运行、排序和重复。
    OptimizationOptions active = options;
    active.fold = options.fold && pass != OptimizationPass::LoadForward;
    active.loadForward = options.loadForward && pass != OptimizationPass::Fold;
    if (pass != OptimizationPass::DeadCode && (active.fold || active.loadForward)) {
      std::vector<Line> next;
      next.reserve(folded.size());
      forward(folded, next, active);
      folded = std::move(next);
    } else if (pass == OptimizationPass::DeadCode && options.deadCode) dropDead(folded);
  }
  text = join(folded, sites);
}

}  // namespace obr
