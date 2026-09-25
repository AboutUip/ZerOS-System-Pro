#include "Codegen.hpp"

#include "Diagnostic.hpp"

#include <cstdint>
#include <cstring>
#include <map>
#include <sstream>
#include <vector>

namespace obr {
namespace {

constexpr int kSp = 1048576;
constexpr int kStack = 2097152;
constexpr int kFrame = 4653056;
constexpr int kStatic = 5242880;
constexpr int kHeapPtr = 4718592;
constexpr int kHeap = 5767168;
constexpr int kTemps = 8;

class Generator {
 public:
  std::string run(Unit& unit) {
    int mainIndex = -1;
    for (std::size_t index = 0; index < unit.functions.size(); index += 1) {
      if (unit.functions[index].exported) unit.functions[index].label = unit.functions[index].name;
      else unit.functions[index].label = "f" + std::to_string(index);
      if (unit.functions[index].name == "main") mainIndex = static_cast<int>(index);
    }
    if (mainIndex < 0) fail("没有 main");
    functions_ = &unit.functions;
    const Function& entry = unit.functions[static_cast<std::size_t>(mainIndex)];
    if (entry.body.size() == 1 && entry.body[0].kind == Stmt::Kind::Zap) {
      emitZap(entry.body[0].name);
      for (Function& function : unit.functions) {
        if (&function == &entry || !function.opcode.empty()) continue;
        emitFunction(function);
      }
      if (needString_) {
        emitCopyRoutine();
        emitConcatRoutine();
      }
      return out_.str();
    }
    emit("place r0, " + std::to_string(kStack));
    emit("store.64 r0, " + std::to_string(kSp));
    emit("call " + unit.functions[static_cast<std::size_t>(mainIndex)].label);
    emit("halt");
    for (Function& function : unit.functions) {
      if (!function.opcode.empty()) continue;
      emitFunction(function);
    }
    if (needString_) {
      emitCopyRoutine();
      emitConcatRoutine();
    }
    return out_.str();
  }

 private:
  std::ostringstream out_;
  int labels_ = 0;
  int words_ = 0;
  int temp_ = 0;
  std::vector<std::pair<std::string, std::string>> loops_;
  bool needString_ = false;
  bool frameHeld_ = false;
  int userWords_ = 0;
  int bias_ = 0;
  std::string inlineReturn_;
  std::string jumpPrefix_;
  std::map<int, long long> knownAddr_;
  std::vector<int> inlineOk_;
  std::vector<int> extraMemo_;
  const std::vector<Function>* functions_ = nullptr;

  void emit(const std::string& line) {
    out_ << line << "\n";
    const bool call = line.rfind("call ", 0) == 0 || line == "ret" || (!line.empty() && line.back() == ':');
    const std::size_t dest = line.find(" r");
    const bool writesFrame = dest != std::string::npos && line.compare(dest, 3, " r4") == 0 && line.rfind("store", 0) != 0;
    if (call || writesFrame) frameHeld_ = false;
  }

  void copy(int dest, int src) {
    if (dest == src) return;
    emit("or r" + std::to_string(dest) + ", r" + std::to_string(src) + ", r" + std::to_string(src));
  }

  bool calm(const Expr& expr) const {
    if (expr.kind == Expr::Kind::LitInt || expr.kind == Expr::Kind::LitBool || expr.kind == Expr::Kind::LitChar || expr.kind == Expr::Kind::LitNull || expr.kind == Expr::Kind::LitUndefined || expr.kind == Expr::Kind::Name) return true;
    if (expr.kind == Expr::Kind::Cast) return calm(expr.kids[0]);
    if (expr.kind == Expr::Kind::Unary && expr.op == Tok::Plus) return calm(expr.kids[0]);
    if (expr.kind == Expr::Kind::Unary && expr.op == Tok::Star) return calm(expr.kids[0]);
    if (expr.kind == Expr::Kind::Unary && expr.op == Tok::BitAnd) return expr.kids[0].kind == Expr::Kind::Name;
    return false;
  }
  std::string fresh(const std::string& prefix) { return prefix + std::to_string(labels_++); }
  int frameBits() const { return (words_ + kTemps) * 64; }

  void frameBase() {
    emit("load.64 r4, " + std::to_string(kFrame));
  }

  int locate(int slot) const {
    if (slot < 0 || slot >= userWords_) return slot;
    return slot + bias_;
  }

  bool constantPtr(const Expr& expr, long long& addr) const {
    if (expr.kind == Expr::Kind::Cast && expr.type == TypeKind::Ptr && expr.kids[0].kind == Expr::Kind::LitInt) {
      addr = expr.kids[0].integer;
      return true;
    }
    if (expr.kind == Expr::Kind::Name && expr.type == TypeKind::Ptr) {
      const auto found = knownAddr_.find(locate(static_cast<int>(expr.integer)));
      if (found == knownAddr_.end()) return false;
      addr = found->second;
      return true;
    }
    return false;
  }

  void remember(int slot, const Expr& value) {
    long long addr = 0;
    const int located = locate(slot);
    if (constantPtr(value, addr)) knownAddr_[located] = addr;
    else knownAddr_.erase(located);
  }

  const char* loadAbs(TypeKind type) const {
    if (type == TypeKind::Float || type == TypeKind::Double) return "load.f64";
    if (type == TypeKind::Short) return "load.16";
    if (type == TypeKind::Int || type == TypeKind::Char) return "load.32";
    if (type == TypeKind::Byte) return "load.octet";
    return "load.64";
  }

  const char* storeAbs(TypeKind type) const {
    if (type == TypeKind::Float || type == TypeKind::Double) return "store.f64";
    if (type == TypeKind::Short) return "store.16";
    if (type == TypeKind::Int || type == TypeKind::Char) return "store.32";
    if (type == TypeKind::Byte) return "store.octet";
    return "store.64";
  }

  void address(int slot) {
    slot = locate(slot);
    if (slot < 0) {
      const bool held = frameHeld_;
      emit("place r5, " + std::to_string(kStatic + (-slot - 1) * 128 + 64));
      frameHeld_ = held;
      return;
    }
    if (!frameHeld_) frameBase();
    emit("place r5, " + std::to_string(slot * 64));
    emit("add r5, r4, r5");
    frameHeld_ = true;
  }

  void emitStore(TypeKind type) {
    if (type == TypeKind::Float || type == TypeKind::Double) emit("sti.f64 r0, r5");
    else if (type == TypeKind::Short) emit("sti.16 r0, r5");
    else if (type == TypeKind::Int || type == TypeKind::Char) emit("sti.32 r0, r5");
    else if (type == TypeKind::Long || type == TypeKind::Ptr || type == TypeKind::String) emit("sti.64 r0, r5");
    else emit("sti.64 r0, r5");
  }

  void emitLoad(TypeKind type) {
    if (type == TypeKind::Float || type == TypeKind::Double) emit("ldi.f64 r0, r5");
    else if (type == TypeKind::Short) emit("ldi.16 r0, r5");
    else if (type == TypeKind::Int || type == TypeKind::Char) emit("ldi.32 r0, r5");
    else if (type == TypeKind::Long || type == TypeKind::Ptr || type == TypeKind::String) emit("ldi.64 r0, r5");
    else emit("ldi.64 r0, r5");
  }

  void emitZap(const std::string& body) {
    std::size_t index = 0;
    while (index < body.size()) {
      std::size_t end = body.find('\n', index);
      if (end == std::string::npos) end = body.size();
      std::string line = body.substr(index, end - index);
      const std::size_t trim = line.find_first_not_of(" \t");
      if (trim == std::string::npos) line.clear();
      else if (trim > 0) line = line.substr(trim);
      if (!line.empty()) emit(line);
      index = end < body.size() ? end + 1 : end;
    }
    frameHeld_ = false;
  }
  void storeSlot(int slot, TypeKind type) {
    address(slot);
    emitStore(type);
  }

  void loadSlot(int slot, TypeKind type) {
    address(slot);
    emitLoad(type);
  }

  int spill() {
    const int slot = words_ + temp_;
    temp_ += 1;
    if (temp_ > kTemps) fail("表达式临时槽不够");
    storeSlot(slot, TypeKind::Long);
    temp_ -= 1;
    return slot;
  }

  void hold() { temp_ += 1; }
  void release() { temp_ -= 1; }

  static std::string floatBits(double value) {
    std::int64_t bits = 0;
    std::memcpy(&bits, &value, sizeof(bits));
    return std::to_string(bits);
  }

  int keep(int reg) {
    copy(0, reg);
    const int slot = words_ + temp_;
    hold();
    storeSlot(slot, TypeKind::Long);
    return slot;
  }

  void bump() {
    const int size = words_ + temp_ - 1;
    const std::string ready = fresh("e");
    emit("load.64 r4, " + std::to_string(kHeapPtr));
    emit("place r5, 0");
    emit("eq r1, r4, r5");
    emit("jz r1, " + ready);
    emit("place r4, " + std::to_string(kHeap));
    emit(ready + ":");
    copy(0, 4);
    const int dest = words_ + temp_;
    hold();
    storeSlot(dest, TypeKind::Long);
    loadSlot(size, TypeKind::Long);
    copy(5, 0);
    emit("add r4, r4, r5");
    emit("store.64 r4, " + std::to_string(kHeapPtr));
    loadSlot(dest, TypeKind::Long);
    release();
  }

  void emitString(const std::string& text) {
    const std::string ready = fresh("e");
    emit("load.64 r4, " + std::to_string(kHeapPtr));
    emit("place r5, 0");
    emit("eq r0, r4, r5");
    emit("jz r0, " + ready);
    emit("place r4, " + std::to_string(kHeap));
    emit(ready + ":");
    copy(0, 4);
    emit("place r1, " + std::to_string(text.size()));
    emit("sti.64 r1, r0");
    emit("place r1, " + std::to_string(64 + static_cast<int>(text.size()) * 8));
    emit("add r4, r4, r1");
    emit("store.64 r4, " + std::to_string(kHeapPtr));
    for (std::size_t index = 0; index < text.size(); index += 1) {
      emit("place r1, " + std::to_string(static_cast<unsigned char>(text[index])));
      emit("place r5, " + std::to_string(64 + static_cast<int>(index) * 8));
      emit("add r5, r0, r5");
      emit("sti.octet r1, r5");
    }
  }

  void boxChar() {
    const int code = words_ + temp_;
    hold();
    storeSlot(code, TypeKind::Long);
    emit("place r0, 72");
    const int size = words_ + temp_;
    hold();
    storeSlot(size, TypeKind::Long);
    bump();
    release();
    const int dest = words_ + temp_;
    hold();
    storeSlot(dest, TypeKind::Long);
    loadSlot(code, TypeKind::Long);
    copy(1, 0);
    loadSlot(dest, TypeKind::Long);
    emit("place r2, 1");
    emit("sti.64 r2, r0");
    emit("place r5, 64");
    emit("add r5, r0, r5");
    emit("sti.octet r1, r5");
    loadSlot(dest, TypeKind::Long);
    release();
    release();
  }

  void concat() {
    needString_ = true;
    emit("call sconcat");
    emit("load.64 r4, " + std::to_string(kSp));
    emit("place r5, " + std::to_string(frameBits()));
    emit("sub r4, r4, r5");
    emit("store.64 r4, " + std::to_string(kFrame));
    frameHeld_ = true;
  }

  void emitConcatRoutine() {
    emit("sconcat:");
    emit("store.64 r7, 4521984");
    emit("store.64 r1, 4522048");
    emit("store.64 r2, 4522112");
    emit("ldi.64 r4, r1");
    emit("ldi.64 r5, r2");
    emit("store.64 r4, 4522176");
    emit("store.64 r5, 4522240");
    emit("add r0, r4, r5");
    emit("place r1, 8");
    emit("mul r0, r0, r1");
    emit("place r1, 64");
    emit("add r0, r0, r1");
    emit("load.64 r4, " + std::to_string(kHeapPtr));
    emit("place r5, 0");
    emit("eq r1, r4, r5");
    emit("jz r1, shave");
    emit("place r4, " + std::to_string(kHeap));
    emit("shave:");
    copy(1, 4);
    emit("add r4, r4, r0");
    emit("store.64 r4, " + std::to_string(kHeapPtr));
    emit("store.64 r1, 4522304");
    emit("load.64 r4, 4522176");
    emit("load.64 r5, 4522240");
    emit("add r4, r4, r5");
    emit("sti.64 r4, r1");
    emit("load.64 r4, 4522048");
    emit("place r5, 64");
    emit("add r1, r4, r5");
    emit("load.64 r2, 4522176");
    emit("load.64 r4, 4522304");
    emit("add r3, r4, r5");
    emit("call scopy");
    emit("load.64 r4, 4522112");
    emit("place r5, 64");
    emit("add r1, r4, r5");
    emit("load.64 r2, 4522240");
    emit("load.64 r4, 4522304");
    emit("add r3, r4, r5");
    emit("load.64 r4, 4522176");
    emit("place r5, 8");
    emit("mul r4, r4, r5");
    emit("add r3, r3, r4");
    emit("call scopy");
    emit("load.64 r0, 4522304");
    emit("load.64 r7, 4521984");
    emit("ret");
  }

  void emitCopyRoutine() {
    emit("scopy:");
    emit("store.64 r7, 4587520");
    emit("place r0, 0");
    emit("schead:");
    emit("lt r4, r0, r2");
    emit("jz r4, sdone");
    emit("place r5, 8");
    emit("mul r4, r0, r5");
    emit("add r4, r1, r4");
    emit("ldi.octet r5, r4");
    emit("place r4, 8");
    emit("mul r4, r0, r4");
    emit("add r4, r3, r4");
    emit("sti.octet r5, r4");
    emit("place r4, 1");
    emit("add r0, r0, r4");
    emit("place r4, 1");
    emit("jnz r4, schead");
    emit("sdone:");
    emit("load.64 r7, 4587520");
    emit("ret");
  }

  void asFloat() {
    if (true) {
      emit("itof r0, r0");
    }
  }

  void truth(TypeKind type) {
    if (type == TypeKind::Boolean || type == TypeKind::Byte) return;
    if (type == TypeKind::String) {
      const std::string empty = fresh("e");
      const std::string done = fresh("e");
      emit("place r1, 0");
      emit("eq r2, r0, r1");
      emit("jnz r2, " + empty);
      emit("ldi.64 r0, r0");
      emit("eq r0, r0, r1");
      emit("place r1, 1");
      emit("sub r0, r1, r0");
      emit("place r1, 1");
      emit("jnz r1, " + done);
      emit(empty + ":");
      emit("place r0, 0");
      emit(done + ":");
      return;
    }
    if (type == TypeKind::Undefined) {
      emit("place r0, 0");
      return;
    }
    if (type == TypeKind::Float || type == TypeKind::Double) {
      emit("place r1, " + floatBits(0));
      emit("feq r0, r0, r1");
    } else {
      emit("place r1, 0");
      emit("eq r0, r0, r1");
    }
    emit("place r1, 1");
    emit("sub r0, r1, r0");
  }

  void narrow(TypeKind type) {
    if (type == TypeKind::Byte) {
      emit("place r1, 1");
      emit("and r0, r0, r1");
      return;
    }
    if (type == TypeKind::Boolean) {
      emit("place r1, 0");
      emit("eq r2, r0, r1");
      emit("place r1, 1");
      emit("sub r0, r1, r2");
    }
  }

  void gen(const Expr& expr) {
    if (expr.kind == Expr::Kind::LitInt) {
      emit("place r0, " + std::to_string(expr.integer));
      return;
    }
    if (expr.kind == Expr::Kind::LitFloat) {
      emit("place r0, " + floatBits(expr.number));
      return;
    }
    if (expr.kind == Expr::Kind::LitBool || expr.kind == Expr::Kind::LitChar) {
      emit("place r0, " + std::to_string(expr.integer));
      return;
    }
    if (expr.kind == Expr::Kind::LitString) {
      emitString(expr.text);
      return;
    }
    if (expr.kind == Expr::Kind::LitNull || expr.kind == Expr::Kind::LitUndefined) {
      emit("place r0, 0");
      return;
    }
    if (expr.kind == Expr::Kind::Cast) {
      gen(expr.kids[0]);
      return;
    }
    if (expr.kind == Expr::Kind::Name) {
      const auto known = knownAddr_.find(locate(static_cast<int>(expr.integer)));
      if (known != knownAddr_.end()) {
        emit("place r0, " + std::to_string(known->second));
        return;
      }
      loadSlot(static_cast<int>(expr.integer), expr.type);
      return;
    }
    if (expr.kind == Expr::Kind::Unary) {
      if (expr.op == Tok::BitAnd) {
        const int slot = locate(static_cast<int>(expr.integer));
        if (slot < 0) {
          emit("place r0, " + std::to_string(kStatic + (-slot - 1) * 128 + 64));
        } else {
          if (!frameHeld_) frameBase();
          emit("place r5, " + std::to_string(slot * 64));
          emit("add r0, r4, r5");
          frameHeld_ = true;
        }
        return;
      }
      if (expr.op == Tok::Star) {
        long long addr = 0;
        if (constantPtr(expr.kids[0], addr)) {
          emit(std::string(loadAbs(expr.type)) + " r0, " + std::to_string(addr));
          return;
        }
        gen(expr.kids[0]);
        copy(5, 0);
        emitLoad(expr.type);
        return;
      }
      gen(expr.kids[0]);
      if (expr.op == Tok::Not) {
        truth(expr.kids[0].type);
        emit("place r1, 0");
        emit("eq r0, r0, r1");
        return;
      }
      if (expr.op == Tok::Plus) return;
      if (expr.op == Tok::Minus) {
        if (expr.type == TypeKind::Float || expr.type == TypeKind::Double) {
          emit("place r1, " + floatBits(0));
          emit("fsub r0, r1, r0");
        } else {
          emit("place r1, 0");
          emit("sub r0, r1, r0");
        }
        return;
      }
      emit("place r1, 4294967295");
      emit("and r0, r0, r1");
      emit("place r1, 2147483648");
      emit("lt r2, r0, r1");
      const std::string done = fresh("e");
      emit("jnz r2, " + done);
      emit("place r1, 4294967296");
      emit("sub r0, r0, r1");
      emit(done + ":");
      emit("not r0, r0");
      return;
    }
    if (expr.kind == Expr::Kind::Update) {
      const Expr& target = expr.kids[0];
      loadSlot(static_cast<int>(target.integer), target.type);
      if (!expr.prefix) {
        const int saved = words_ + temp_;
        hold();
        storeSlot(saved, target.type);
      }
      if (target.type == TypeKind::Float || target.type == TypeKind::Double) {
        emit("place r1, " + floatBits(1));
        emit(expr.op == Tok::PlusPlus ? "fadd r0, r0, r1" : "fsub r0, r0, r1");
      } else {
        emit("place r1, 1");
        emit(expr.op == Tok::PlusPlus ? "add r0, r0, r1" : "sub r0, r0, r1");
        narrow(target.type);
      }
      storeSlot(static_cast<int>(target.integer), target.type);
      knownAddr_.erase(locate(static_cast<int>(target.integer)));
      if (!expr.prefix) {
        loadSlot(words_ + temp_ - 1, target.type);
        release();
      }
      return;
    }
    if (expr.kind == Expr::Kind::Assign) {
      if (expr.kids[0].kind == Expr::Kind::Unary && expr.kids[0].op == Tok::Star) {
        long long addr = 0;
        if (constantPtr(expr.kids[0].kids[0], addr)) {
          gen(expr.kids[1]);
          if ((expr.type == TypeKind::Float || expr.type == TypeKind::Double) && expr.kids[1].type != TypeKind::Float && expr.kids[1].type != TypeKind::Double) {
            emit("itof r0, r0");
          }
          emit(std::string(storeAbs(expr.type)) + " r0, " + std::to_string(addr));
          return;
        }
        gen(expr.kids[1]);
        const int saved = words_ + temp_;
        hold();
        storeSlot(saved, TypeKind::Long);
        gen(expr.kids[0].kids[0]);
        copy(1, 0);
        loadSlot(saved, TypeKind::Long);
        release();
        copy(5, 1);
        emitStore(expr.type);
        return;
      }
      if (expr.op == Tok::Assign) {
        gen(expr.kids[1]);
        if ((expr.type == TypeKind::Float || expr.type == TypeKind::Double) && expr.kids[1].type != TypeKind::Float && expr.kids[1].type != TypeKind::Double) {
          emit("itof r0, r0");
        }
        if (expr.kids[0].kind == Expr::Kind::Name) {
          long long addr = 0;
          if (constantPtr(expr.kids[1], addr)) {
            remember(static_cast<int>(expr.kids[0].integer), expr.kids[1]);
            return;
          }
          remember(static_cast<int>(expr.kids[0].integer), expr.kids[1]);
        }
        storeSlot(static_cast<int>(expr.kids[0].integer), expr.type);
        return;
      }
      loadSlot(static_cast<int>(expr.kids[0].integer), expr.kids[0].type);
      const int saved = words_ + temp_;
      hold();
      storeSlot(saved, TypeKind::Long);
      gen(expr.kids[1]);
      copy(2, 0);
      loadSlot(saved, TypeKind::Long);
      release();
      Tok op = Tok::Plus;
      if (expr.op == Tok::MinusEq) op = Tok::Minus;
      if (expr.op == Tok::StarEq) op = Tok::Star;
      if (expr.op == Tok::SlashEq) op = Tok::Slash;
      if (expr.op == Tok::PercentEq) op = Tok::Percent;
      arith(op, expr.kids[0].type, expr.kids[1].type, expr.type);
      storeSlot(static_cast<int>(expr.kids[0].integer), expr.type);
      return;
    }
    if (expr.kind == Expr::Kind::Ternary) {
      gen(expr.kids[0]);
      truth(expr.kids[0].type);
      const std::string other = fresh("e");
      const std::string end = fresh("e");
      emit("jz r0, " + other);
      gen(expr.kids[1]);
      emit("place r1, 1");
      emit("jnz r1, " + end);
      emit(other + ":");
      gen(expr.kids[2]);
      emit(end + ":");
      return;
    }
    if (expr.kind == Expr::Kind::Call) {
      if (expr.integer == -2) {
        gen(expr.kids[0]);
        emit("ldi.64 r0, r0");
        return;
      }
      const Function& target = (*functions_)[static_cast<std::size_t>(expr.integer)];
      if (target.opcode.empty() && inlineable(static_cast<int>(expr.integer))) {
        emitInline(expr, target);
        return;
      }
      if (target.opcode == "inbox") {
        gen(expr.kids[0]);
        copy(2, 0);
        emit("inbox r0, r1");
        emit("sti.64 r1, r2");
        frameHeld_ = false;
        return;
      }
      std::vector<int> slots(expr.kids.size(), -1);
      std::vector<TypeKind> kinds(expr.kids.size(), TypeKind::Long);
      std::vector<int> direct(expr.kids.size(), 0);
      for (std::size_t index = 0; index < expr.kids.size(); index += 1) {
        const Expr& argument = expr.kids[index];
        const TypeKind want = target.params[index].type;
        kinds[index] = want == TypeKind::Float || want == TypeKind::Double ? want : TypeKind::Long;
        if (!target.opcode.empty() && argument.kind == Expr::Kind::LitInt) {
          direct[index] = 1;
          continue;
        }
        if (!target.opcode.empty() && calm(argument)) continue;
        gen(argument);
        if ((want == TypeKind::Float || want == TypeKind::Double) && argument.type != TypeKind::Float && argument.type != TypeKind::Double) {
          emit("itof r0, r0");
        }
        const int saved = words_ + temp_;
        hold();
        storeSlot(saved, kinds[index]);
        slots[index] = saved;
      }
      auto materialize = [&](int index, int dest) {
        if (direct[static_cast<std::size_t>(index)] == 1) return;
        if (slots[static_cast<std::size_t>(index)] < 0) gen(expr.kids[static_cast<std::size_t>(index)]);
        else loadSlot(slots[static_cast<std::size_t>(index)], kinds[static_cast<std::size_t>(index)]);
        copy(dest, 0);
      };
      auto plant = [&](int count) {
        for (int index = 0; index < count; index += 1) {
          if (direct[static_cast<std::size_t>(index)] != 1) continue;
          const int reg = target.opcode.empty() ? index + 1 : target.opcodeArg0 + index;
          emit("place r" + std::to_string(reg) + ", " + std::to_string(expr.kids[static_cast<std::size_t>(index)].integer));
        }
      };
      if (!target.opcode.empty()) {
        std::vector<int> early;
        std::vector<int> late;
        for (int index = 0; index < static_cast<int>(slots.size()); index += 1) {
          const int reg = target.opcodeArg0 + index;
          if (reg == 1 || reg == 2 || reg == 3) early.push_back(index);
          else late.push_back(index);
        }
        for (const int index : early) materialize(index, target.opcodeArg0 + index);
        std::vector<int> parked;
        int spare = 6;
        for (int index = 0; index + 1 < static_cast<int>(late.size()); index += 1) {
          const int arg = late[static_cast<std::size_t>(index)];
          if (direct[static_cast<std::size_t>(arg)] == 1) {
            parked.push_back(-1);
            continue;
          }
          materialize(arg, spare);
          parked.push_back(spare);
          spare += 1;
        }
        if (!late.empty() && direct[static_cast<std::size_t>(late.back())] != 1) {
          const int arg = late.back();
          materialize(arg, target.opcodeArg0 + arg);
        }
        for (int index = 0; index < static_cast<int>(parked.size()); index += 1) {
          const int from = parked[static_cast<std::size_t>(index)];
          if (from < 0) continue;
          const int arg = late[static_cast<std::size_t>(index)];
          copy(target.opcodeArg0 + arg, from);
        }
        plant(static_cast<int>(slots.size()));
        std::string line = target.opcode;
        bool first = true;
        auto add = [&](const std::string& reg) {
          line += first ? " " + reg : ", " + reg;
          first = false;
        };
        if (target.opcodeResultR6) add("r6");
        else if (target.opcodeArg0 == 1 && !target.opcodeCopyLast) add("r0");
        for (int index = 0; index < static_cast<int>(slots.size()); index += 1) {
          add("r" + std::to_string(target.opcodeArg0 + index));
        }
        emit(line);
        if (target.opcodeResultR6) copy(0, 6);
        else if (target.opcodeCopyLast && !slots.empty()) copy(0, target.opcodeArg0 + static_cast<int>(slots.size()) - 1);
        int spilled = 0;
        for (const int slot : slots) {
          if (slot >= 0) spilled += 1;
        }
        temp_ -= spilled;
        frameHeld_ = false;
        return;
      }
      if (slots.size() > 0) materialize(0, 1);
      if (slots.size() > 1) materialize(1, 2);
      if (slots.size() > 2) materialize(2, 3);
      int extra = 0;
      for (std::size_t index = 3; index < slots.size(); index += 1) {
        loadSlot(slots[index], kinds[index]);
        emit("load.64 r4, " + std::to_string(kSp));
        emit("sti.64 r0, r4");
        emit("place r5, 64");
        emit("add r4, r4, r5");
        emit("store.64 r4, " + std::to_string(kSp));
        extra += 1;
      }
      emit("call " + (*functions_)[static_cast<std::size_t>(expr.integer)].label);
      if (extra > 0) {
        emit("load.64 r4, " + std::to_string(kSp));
        emit("place r5, " + std::to_string(extra * 64));
        emit("sub r4, r4, r5");
        emit("store.64 r4, " + std::to_string(kSp));
      }
      emit("load.64 r4, " + std::to_string(kSp));
      emit("place r5, " + std::to_string(frameBits()));
      emit("sub r4, r4, r5");
      emit("store.64 r4, " + std::to_string(kFrame));
      frameHeld_ = true;
      temp_ -= static_cast<int>(slots.size());
      return;
    }
    if (expr.op == Tok::And || expr.op == Tok::Or) {
      const std::string end = fresh("e");
      gen(expr.kids[0]);
      truth(expr.kids[0].type);
      emit(expr.op == Tok::And ? "jz r0, " + end : "jnz r0, " + end);
      gen(expr.kids[1]);
      truth(expr.kids[1].type);
      emit(end + ":");
      return;
    }
    if (expr.op != Tok::LBracket && calm(expr.kids[0]) && calm(expr.kids[1])) {
      gen(expr.kids[0]);
      copy(1, 0);
      gen(expr.kids[1]);
      copy(2, 0);
      arith(expr.op, expr.kids[0].type, expr.kids[1].type, expr.type);
      return;
    }
    gen(expr.kids[0]);
    if (expr.op == Tok::LBracket) {
      const int base = words_ + temp_;
      hold();
      storeSlot(base, TypeKind::Long);
      gen(expr.kids[1]);
      emit("place r1, 8");
      emit("mul r0, r0, r1");
      emit("place r1, 64");
      emit("add r0, r0, r1");
      copy(1, 0);
      loadSlot(base, TypeKind::Long);
      release();
      emit("add r5, r0, r1");
      emit("ldi.octet r0, r5");
      return;
    }
    const int saved = words_ + temp_;
    hold();
    storeSlot(saved, expr.kids[0].type == TypeKind::Float || expr.kids[0].type == TypeKind::Double ? expr.kids[0].type : TypeKind::Long);
    gen(expr.kids[1]);
    copy(2, 0);
    loadSlot(saved, expr.kids[0].type == TypeKind::Float || expr.kids[0].type == TypeKind::Double ? expr.kids[0].type : TypeKind::Long);
    copy(1, 0);
    release();
    arith(expr.op, expr.kids[0].type, expr.kids[1].type, expr.type);
  }

  void arith(Tok op, TypeKind left, TypeKind right, TypeKind result) {
    if (result == TypeKind::String && op == Tok::Plus) {
      if (left == TypeKind::Char) {
        copy(0, 1);
        boxChar();
        copy(1, 0);
      }
      if (right == TypeKind::Char) {
        copy(0, 2);
        boxChar();
        copy(2, 0);
      }
      concat();
      return;
    }
    const bool floating = result == TypeKind::Float || result == TypeKind::Double || left == TypeKind::Float || left == TypeKind::Double || right == TypeKind::Float || right == TypeKind::Double;
    if (op == Tok::Eq || op == Tok::Ne) {
      if (left == TypeKind::Float || left == TypeKind::Double) emit("feq r0, r1, r2");
      else emit("eq r0, r1, r2");
      if (op == Tok::Ne) {
        emit("place r1, 0");
        emit("eq r0, r0, r1");
      }
      return;
    }
    if (op == Tok::Lt) emit("lt r0, r1, r2");
    else if (op == Tok::Le) emit("le r0, r1, r2");
    else if (op == Tok::Gt) emit("gt r0, r1, r2");
    else if (op == Tok::Ge) emit("ge r0, r1, r2");
    else if (op == Tok::Pow) {
      if (left != TypeKind::Float && left != TypeKind::Double) {
        emit("itof r1, r1");
      }
      if (right != TypeKind::Float && right != TypeKind::Double) {
        emit("itof r2, r2");
      }
      emit("fpow r0, r1, r2");
    } else if (op == Tok::Percent) {
      if (floating || result == TypeKind::Float || result == TypeKind::Double) emit("fmod r0, r1, r2");
      else emit("mod r0, r1, r2");
      narrow(result);
    } else if (floating || result == TypeKind::Float || result == TypeKind::Double) {
      if (left != TypeKind::Float && left != TypeKind::Double) emit("itof r1, r1");
      if (right != TypeKind::Float && right != TypeKind::Double) emit("itof r2, r2");
      if (op == Tok::Plus) emit("fadd r0, r1, r2");
      else if (op == Tok::Minus) emit("fsub r0, r1, r2");
      else if (op == Tok::Star) emit("fmul r0, r1, r2");
      else if (op == Tok::Slash) emit("fdiv r0, r1, r2");
      else emit("fdiv r0, r1, r2");
    } else if (op == Tok::Plus) {
      emit("add r0, r1, r2");
      narrow(result);
    } else if (op == Tok::Minus) {
      emit("sub r0, r1, r2");
      narrow(result);
    } else if (op == Tok::Star) {
      emit("mul r0, r1, r2");
      narrow(result);
    } else if (op == Tok::Slash) {
      emit("div r0, r1, r2");
      narrow(result);
    } else if (op == Tok::BitAnd) {
      emit("and r0, r1, r2");
    } else if (op == Tok::BitOr) {
      emit("or r0, r1, r2");
    } else if (op == Tok::BitXor) {
      emit("xor r0, r1, r2");
    } else if (op == Tok::Shl || op == Tok::Shr || op == Tok::UShr) {
      emit("place r0, 32");
      emit("umod r2, r2, r0");
      if (op == Tok::UShr) {
        emit("place r0, 4294967295");
        emit("and r1, r1, r0");
        emit("shr r0, r1, r2");
      } else if (op == Tok::Shr) {
        emit("shr r0, r1, r2");
      } else {
        emit("shl r0, r1, r2");
      }
    } else {
      fail("还不能生成这个运算符");
    }
  }

  void collectExpr(const Expr& expr, std::vector<int>& calls, bool& zap) const {
    if (expr.kind == Expr::Kind::Call && expr.integer >= 0) calls.push_back(static_cast<int>(expr.integer));
    for (const Expr& kid : expr.kids) collectExpr(kid, calls, zap);
  }

  void collectStmt(const Stmt& stmt, std::vector<int>& calls, bool& zap) const {
    if (stmt.kind == Stmt::Kind::Zap) zap = true;
    collectExpr(stmt.expr, calls, zap);
    for (const Stmt& inner : stmt.body) collectStmt(inner, calls, zap);
    for (const Stmt& inner : stmt.other) collectStmt(inner, calls, zap);
  }

  int functionIndex(const Function& function) const {
    for (int index = 0; index < static_cast<int>(functions_->size()); index += 1) {
      if (&(*functions_)[static_cast<std::size_t>(index)] == &function) return index;
    }
    return -1;
  }

  void markCycle(int index, std::vector<int>& color, std::vector<int>& stack, const std::vector<std::vector<int>>& calls, std::vector<int>& cyclic) {
    color[static_cast<std::size_t>(index)] = 1;
    stack.push_back(index);
    for (const int callee : calls[static_cast<std::size_t>(index)]) {
      if (color[static_cast<std::size_t>(callee)] == 1) {
        for (int cursor = static_cast<int>(stack.size()) - 1; cursor >= 0; cursor -= 1) {
          cyclic[static_cast<std::size_t>(stack[static_cast<std::size_t>(cursor)])] = 1;
          if (stack[static_cast<std::size_t>(cursor)] == callee) break;
        }
      } else if (color[static_cast<std::size_t>(callee)] == 0) {
        markCycle(callee, color, stack, calls, cyclic);
      }
    }
    stack.pop_back();
    color[static_cast<std::size_t>(index)] = 2;
  }

  void prepareInline() {
    if (!inlineOk_.empty()) return;
    const int count = static_cast<int>(functions_->size());
    inlineOk_.assign(static_cast<std::size_t>(count), 0);
    extraMemo_.assign(static_cast<std::size_t>(count), -2);
    std::vector<std::vector<int>> calls(static_cast<std::size_t>(count));
    std::vector<int> zap(static_cast<std::size_t>(count), 0);
    for (int index = 0; index < count; index += 1) {
      bool seenZap = false;
      collectStmtList((*functions_)[static_cast<std::size_t>(index)].body, calls[static_cast<std::size_t>(index)], seenZap);
      if (seenZap || !(*functions_)[static_cast<std::size_t>(index)].opcode.empty()) zap[static_cast<std::size_t>(index)] = 1;
    }
    std::vector<int> color(static_cast<std::size_t>(count), 0);
    std::vector<int> stack;
    std::vector<int> cyclic(static_cast<std::size_t>(count), 0);
    for (int index = 0; index < count; index += 1) {
      if (color[static_cast<std::size_t>(index)] == 0) markCycle(index, color, stack, calls, cyclic);
    }
    for (int index = 0; index < count; index += 1) {
      if (zap[static_cast<std::size_t>(index)] == 0 && cyclic[static_cast<std::size_t>(index)] == 0) inlineOk_[static_cast<std::size_t>(index)] = 1;
    }
  }

  void collectStmtList(const std::vector<Stmt>& body, std::vector<int>& calls, bool& zap) const {
    for (const Stmt& stmt : body) collectStmt(stmt, calls, zap);
  }

  bool inlineable(int index) {
    prepareInline();
    return inlineOk_[static_cast<std::size_t>(index)] == 1;
  }

  int extraWords(int index) {
    prepareInline();
    if (extraMemo_[static_cast<std::size_t>(index)] != -2) return extraMemo_[static_cast<std::size_t>(index)] < 0 ? 0 : extraMemo_[static_cast<std::size_t>(index)];
    extraMemo_[static_cast<std::size_t>(index)] = -1;
    int best = 0;
    std::vector<int> calls;
    bool zap = false;
    collectStmtList((*functions_)[static_cast<std::size_t>(index)].body, calls, zap);
    for (const int callee : calls) {
      if (inlineOk_[static_cast<std::size_t>(callee)] != 1) continue;
      const int need = (*functions_)[static_cast<std::size_t>(callee)].words + extraWords(callee);
      if (need > best) best = need;
    }
    extraMemo_[static_cast<std::size_t>(index)] = best;
    return best;
  }

  void emitInline(const Expr& expr, const Function& target) {
    std::vector<int> held;
    std::vector<TypeKind> kinds;
    std::vector<int> knownFlag(expr.kids.size(), 0);
    std::vector<long long> knownVal(expr.kids.size(), 0);
    for (std::size_t index = 0; index < expr.kids.size(); index += 1) {
      const Expr& argument = expr.kids[index];
      gen(argument);
      const TypeKind want = target.params[index].type;
      if ((want == TypeKind::Float || want == TypeKind::Double) && argument.type != TypeKind::Float && argument.type != TypeKind::Double) {
        emit("itof r0, r0");
      }
      const int saved = words_ + temp_;
      const TypeKind kept = want == TypeKind::Float || want == TypeKind::Double ? want : TypeKind::Long;
      hold();
      storeSlot(saved, kept);
      held.push_back(saved);
      kinds.push_back(kept);
      long long addr = 0;
      if (constantPtr(argument, addr)) {
        knownFlag[index] = 1;
        knownVal[index] = addr;
      }
    }
    const int savedBias = bias_;
    const int savedUser = userWords_;
    const std::string savedReturn = inlineReturn_;
    bias_ = savedBias + savedUser;
    userWords_ = target.words;
    for (int slot = 0; slot < target.words; slot += 1) knownAddr_.erase(locate(slot));
    for (std::size_t index = 0; index < held.size(); index += 1) {
      loadSlot(held[index], kinds[index]);
      release();
      storeSlot(target.params[index].slot, target.params[index].type);
      const int located = locate(target.params[index].slot);
      if (knownFlag[index] == 1) knownAddr_[located] = knownVal[index];
      else knownAddr_.erase(located);
    }
    const std::string end = fresh("e");
    inlineReturn_ = end;
    for (const Stmt& stmt : target.body) emitStmt(stmt, target.ret);
    emit(end + ":");
    inlineReturn_ = savedReturn;
    bias_ = savedBias;
    userWords_ = savedUser;
  }

  void emitFunction(Function& function) {
    prepareInline();
    userWords_ = function.words;
    bias_ = 0;
    inlineReturn_.clear();
    knownAddr_.clear();
    words_ = function.words + extraWords(functionIndex(function));
    temp_ = 0;
    frameHeld_ = false;
    jumpPrefix_ = function.label + "z";
    emit(function.label + ":");
    emit("load.64 r4, " + std::to_string(kSp));
    emit("place r5, " + std::to_string(frameBits()));
    emit("add r4, r4, r5");
    emit("store.64 r4, " + std::to_string(kSp));
    emit("place r5, " + std::to_string(frameBits()));
    emit("sub r4, r4, r5");
    emit("store.64 r4, " + std::to_string(kFrame));
    emit("sti.64 r7, r4");
    frameHeld_ = true;
    for (std::size_t index = 0; index < function.params.size() && index < 3; index += 1) {
      copy(0, static_cast<int>(index) + 1);
      storeSlot(function.params[index].slot, function.params[index].type);
    }
    const int count = static_cast<int>(function.params.size());
    for (int index = 3; index < count; index += 1) {
      frameBase();
      emit("place r5, " + std::to_string((count - index) * 64));
      emit("sub r5, r4, r5");
      emit("ldi.64 r0, r5");
      storeSlot(function.params[static_cast<std::size_t>(index)].slot, function.params[static_cast<std::size_t>(index)].type);
    }
    for (const Stmt& stmt : function.body) emitStmt(stmt, function.ret);
    if (!endsWithReturn(function.body)) {
      if (function.ret != TypeKind::Void) emit("place r0, 0");
      emitReturn();
    }
  }

  bool endsWithReturn(const std::vector<Stmt>& body) {
    if (body.empty()) return false;
    const Stmt& stmt = body.back();
    if (stmt.kind == Stmt::Kind::Return) return true;
    if (stmt.kind == Stmt::Kind::Block) return endsWithReturn(stmt.body);
    if (stmt.kind == Stmt::Kind::If && !stmt.other.empty()) return endsWithReturn(stmt.body) && endsWithReturn(stmt.other);
    return false;
  }

  void emitReturn() {
    if (!inlineReturn_.empty()) {
      emit("place r1, 1");
      emit("jnz r1, " + inlineReturn_);
      return;
    }
    frameBase();
    emit("ldi.64 r7, r4");
    emit("store.64 r4, " + std::to_string(kSp));
    emit("ret");
  }

  void emitStmt(const Stmt& stmt, TypeKind ret) {
    if (stmt.kind == Stmt::Kind::Zap) {
      emitZap(stmt.name);
      emit("load.64 r4, " + std::to_string(kSp));
      emit("place r5, " + std::to_string(frameBits()));
      emit("sub r4, r4, r5");
      emit("store.64 r4, " + std::to_string(kFrame));
      frameHeld_ = false;
      return;
    }
    if (stmt.kind == Stmt::Kind::Nop) return;
    if (stmt.kind == Stmt::Kind::Block) {
      for (const Stmt& inner : stmt.body) emitStmt(inner, ret);
      return;
    }
    if (stmt.kind == Stmt::Kind::Decl) {
      const bool hasInit = !(stmt.expr.kind == Expr::Kind::LitInt && stmt.expr.type == TypeKind::None && stmt.expr.kids.empty());
      if (stmt.isStatic) {
        const std::string skip = fresh("e");
        const int flag = kStatic + (-stmt.slot - 1) * 128;
        emit("place r5, " + std::to_string(flag));
        emit("ldi.64 r1, r5");
        emit("place r2, 0");
        emit("eq r1, r1, r2");
        emit("jz r1, " + skip);
        if (hasInit) {
          gen(stmt.expr);
          if ((stmt.type == TypeKind::Float || stmt.type == TypeKind::Double) && stmt.expr.type != TypeKind::Float && stmt.expr.type != TypeKind::Double) {
            emit("itof r0, r0");
          }
        } else {
          emit("place r0, 0");
        }
        storeSlot(stmt.slot, stmt.type);
        if (hasInit) remember(stmt.slot, stmt.expr);
        emit("place r1, 1");
        emit("place r5, " + std::to_string(flag));
        emit("sti.64 r1, r5");
        emit(skip + ":");
        return;
      }
      if (hasInit) {
        long long addr = 0;
        if (constantPtr(stmt.expr, addr)) {
          remember(stmt.slot, stmt.expr);
          return;
        }
        gen(stmt.expr);
        if ((stmt.type == TypeKind::Float || stmt.type == TypeKind::Double) && stmt.expr.type != TypeKind::Float && stmt.expr.type != TypeKind::Double) {
          emit("itof r0, r0");
        }
      } else {
        emit("place r0, 0");
      }
      storeSlot(stmt.slot, stmt.type);
      if (hasInit) remember(stmt.slot, stmt.expr);
      return;
    }
    if (stmt.kind == Stmt::Kind::If) {
      gen(stmt.expr);
      truth(stmt.expr.type);
      const std::string other = fresh("e");
      const std::string end = fresh("e");
      emit("jz r0, " + other);
      for (const Stmt& inner : stmt.body) emitStmt(inner, ret);
      emit("place r1, 1");
      emit("jnz r1, " + end);
      emit(other + ":");
      for (const Stmt& inner : stmt.other) emitStmt(inner, ret);
      emit(end + ":");
      return;
    }
    if (stmt.kind == Stmt::Kind::While) {
      const std::string head = fresh("w");
      const std::string end = fresh("d");
      loops_.push_back({end, head});
      emit(head + ":");
      gen(stmt.expr);
      truth(stmt.expr.type);
      emit("jz r0, " + end);
      for (const Stmt& inner : stmt.body) emitStmt(inner, ret);
      emit("place r1, 1");
      emit("jnz r1, " + head);
      emit(end + ":");
      loops_.pop_back();
      return;
    }
    if (stmt.kind == Stmt::Kind::Break) {
      emit("place r1, 1");
      emit("jnz r1, " + loops_.back().first);
      return;
    }
    if (stmt.kind == Stmt::Kind::Continue) {
      emit("place r1, 1");
      emit("jnz r1, " + loops_.back().second);
      return;
    }
    if (stmt.kind == Stmt::Kind::Label) {
      frameHeld_ = false;
      emit(jumpPrefix_ + stmt.name + ":");
      return;
    }
    if (stmt.kind == Stmt::Kind::Goto) {
      frameHeld_ = false;
      emit("place r1, 1");
      emit("jnz r1, " + jumpPrefix_ + stmt.name);
      return;
    }
    if (stmt.kind == Stmt::Kind::Return) {
      const bool hasValue = !(stmt.expr.kind == Expr::Kind::LitInt && stmt.expr.type == TypeKind::None && stmt.expr.kids.empty());
      if (hasValue) {
        gen(stmt.expr);
        if ((ret == TypeKind::Float || ret == TypeKind::Double) && stmt.expr.type != TypeKind::Float && stmt.expr.type != TypeKind::Double) {
          emit("itof r0, r0");
        }
      }
      emitReturn();
      return;
    }
    gen(stmt.expr);
  }
};

}  // namespace

std::string generate(Unit& unit) {
  Generator generator;
  return generator.run(unit);
}

}  // namespace obr
