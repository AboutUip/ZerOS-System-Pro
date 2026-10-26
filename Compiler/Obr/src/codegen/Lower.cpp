#include "Generator.hpp"
#include "../type/Type.hpp"

#include <cstdint>
#include <cstring>

namespace obr {

bool scaleOf(long long bits, int& scale) {
  if (bits == 8) scale = 1;
  else if (bits == 16) scale = 2;
  else if (bits == 32) scale = 4;
  else if (bits == 64) scale = 8;
  else return false;
  return true;
}

bool matchScaled(const Expr& address, const Expr*& base, const Expr*& index, int& scale, int& disp) {
  if (address.kind == Expr::Kind::Cast) {
    if (address.kids.empty()) return false;
    return matchScaled(address.kids[0], base, index, scale, disp);
  }
  const Expr* node = &address;
  disp = 0;
  if (node->kind == Expr::Kind::Binary && node->op == Tok::Plus && node->kids.size() == 2) {
    const Expr* lit = nullptr;
    const Expr* rest = nullptr;
    if (node->kids[1].kind == Expr::Kind::LitInt && node->kids[0].kind == Expr::Kind::Binary) {
      lit = &node->kids[1];
      rest = &node->kids[0];
    } else if (node->kids[0].kind == Expr::Kind::LitInt && node->kids[1].kind == Expr::Kind::Binary) {
      lit = &node->kids[0];
      rest = &node->kids[1];
    }
    if (lit != nullptr) {
      const long long bits = lit->integer;
      if (bits % 8 != 0) return false;
      const long long octets = bits / 8;
      if (octets < -128 || octets > 127) return false;
      disp = static_cast<int>(octets);
      node = rest;
    }
  }
  if (node->kind != Expr::Kind::Binary || node->op != Tok::Plus || node->kids.size() != 2) return false;
  const Expr* mul = nullptr;
  const Expr* baseExpr = nullptr;
  if (node->kids[1].kind == Expr::Kind::Binary && node->kids[1].op == Tok::Star && node->kids[1].kids.size() == 2) {
    baseExpr = &node->kids[0];
    mul = &node->kids[1];
  } else if (node->kids[0].kind == Expr::Kind::Binary && node->kids[0].op == Tok::Star && node->kids[0].kids.size() == 2) {
    baseExpr = &node->kids[1];
    mul = &node->kids[0];
  } else {
    return false;
  }
  const Expr* indexExpr = nullptr;
  long long stride = 0;
  if (mul->kids[1].kind == Expr::Kind::LitInt) {
    indexExpr = &mul->kids[0];
    stride = mul->kids[1].integer;
  } else if (mul->kids[0].kind == Expr::Kind::LitInt) {
    indexExpr = &mul->kids[1];
    stride = mul->kids[0].integer;
  } else {
    return false;
  }
  int found = 0;
  if (!scaleOf(stride, found)) return false;
  base = baseExpr;
  index = indexExpr;
  scale = found;
  return true;
}

bool Generator::tryScaled(const Expr& address, const Expr* value, TypeKind type) {
  if (type != TypeKind::Long && type != TypeKind::Ptr) return false;
  const Expr* base = nullptr;
  const Expr* index = nullptr;
  int scale = 0;
  int disp = 0;
  if (!matchScaled(address, base, index, scale, disp)) return false;
  int valueSlot = -1;
  if (value != nullptr) {
    gen(*value);
    if ((type == TypeKind::Float || type == TypeKind::Double) && value->type != TypeKind::Float && value->type != TypeKind::Double) {
      emit("itof r0, r0");
    }
    valueSlot = words_ + temp_;
    hold();
    storeSlot(valueSlot, TypeKind::Long);
  }
  gen(*base);
  emit("place r1, 7");
  emit("and r1, r0, r1");
  const std::string aligned = fresh("a");
  emit("jz r1, " + aligned);
  emit("halt");
  emit(aligned + ":");
  emit("place r1, 3");
  emit("shr r0, r0, r1");
  const int baseSlot = words_ + temp_;
  hold();
  storeSlot(baseSlot, TypeKind::Long);
  gen(*index);
  copy(2, 0);
  loadSlot(baseSlot, TypeKind::Long);
  copy(1, 0);
  const std::string line = std::string(value == nullptr ? "load.scale" : "store.scale") + " r0, r1, r2, " + std::to_string(scale) + ", " + std::to_string(disp);
  if (value != nullptr) loadSlot(valueSlot, TypeKind::Long);
  emit(line);
  release();
  if (value != nullptr) release();
  frameHeld_ = false;
  return true;
}

void Generator::emitAddress(const Expr& expr) {
  if (expr.kind == Expr::Kind::Member) {
    if (expr.prefix) emitAddress(expr.kids[0]);
    else gen(expr.kids[0]);
    emit("place r5, " + std::to_string(expr.integer));
    emit("add r0, r0, r5");
    return;
  }
  if (expr.kind == Expr::Kind::Name && expr.type == TypeKind::Struct) {
    address(static_cast<int>(expr.integer));
    copy(0, 5);
    return;
  }
  if (expr.kind == Expr::Kind::Unary && expr.op == Tok::Star) {
    gen(expr.kids[0]);
    return;
  }
  gen(expr);
}

int Generator::structWords(const std::string& name) const {
  if (structs_ != nullptr) {
    for (const StructDecl& decl : *structs_) {
      if (decl.name == name) return decl.words;
    }
  }
  fail("没有结构体 " + name);
}

void Generator::gen(const Expr& expr) {
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
    if (expr.kind == Expr::Kind::Await) {
      gen(expr.kids[0]);
      /* 调用已经把结果留在 r0。yield 停住这颗核心，寄存器和栈都保留。 */
      emit("yield");
      return;
    }
    if (expr.kind == Expr::Kind::New) {
      if (expr.integer == -6) {
        emitCollectNew(expr);
        return;
      }
      const ClassDecl* decl = nullptr;
      if (classes_ != nullptr) {
        for (const ClassDecl& item : *classes_) {
          if (item.name == expr.text) decl = &item;
        }
      }
      if (decl == nullptr) fail("没有类 " + expr.text);
      const int bits = decl->fields.empty() ? 64 : static_cast<int>(decl->fields.size()) * 64;
      const std::string ready = fresh("e");
      emit("load.64 r4, " + std::to_string(kHeapPtr));
      emit("place r5, 0");
      emit("eq r0, r4, r5");
      emit("jz r0, " + ready);
      emit("place r4, " + std::to_string(kHeap));
      emit(ready + ":");
      copy(0, 4);
      emit("place r1, " + std::to_string(bits));
      emit("add r4, r4, r1");
      emit("store.64 r4, " + std::to_string(kHeapPtr));
      const int base = words_ + temp_;
      hold();
      storeSlot(base, TypeKind::Long);
      const int words = bits / 64;
      for (int index = 0; index < words; index += 1) {
        loadSlot(base, TypeKind::Long);
        emit("place r1, 0");
        emit("place r5, " + std::to_string(index * 64));
        emit("add r5, r0, r5");
        emit("sti.64 r1, r5");
      }
      if (expr.integer >= 0) {
        const Function& target = (*functions_)[static_cast<std::size_t>(expr.integer)];
        std::vector<int> argSlots;
        for (const Expr& argument : expr.kids) {
          gen(argument);
          const int saved = words_ + temp_;
          hold();
          storeSlot(saved, TypeKind::Long);
          argSlots.push_back(saved);
        }
        std::vector<int> params;
        std::vector<TypeKind> paramKinds;
        params.push_back(base);
        paramKinds.push_back(TypeKind::Long);
        for (const int slot : argSlots) {
          params.push_back(slot);
          paramKinds.push_back(TypeKind::Long);
        }
        emitIntegerCall(target.label, params, paramKinds);
        temp_ -= static_cast<int>(argSlots.size());
      }
      loadSlot(base, TypeKind::Long);
      release();
      frameHeld_ = false;
      return;
    }
    if (expr.kind == Expr::Kind::Member) {
      if (expr.type == TypeKind::Struct) fail("结构体要按字段读写");
      emitAddress(expr);
      copy(5, 0);
      emit("ldi.64 r0, r5");
      frameHeld_ = false;
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
        if (expr.type == TypeKind::Struct) fail("结构体要按字段读写");
        if (tryScaled(expr.kids[0], nullptr, expr.type)) return;
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
      if (expr.type == TypeKind::Struct) {
        const int words = structWords(expr.kids[0].typeName);
        const int dest = static_cast<int>(expr.kids[0].integer);
        const int src = static_cast<int>(expr.kids[1].integer);
        for (int index = 0; index < words; index += 1) {
          loadSlot(src + index, TypeKind::Long);
          storeSlot(dest + index, TypeKind::Long);
        }
        return;
      }
      if (expr.kids[0].kind == Expr::Kind::Binary && expr.kids[0].op == Tok::LBracket) {
        gen(expr.kids[1]);
        const int saved = words_ + temp_;
        hold();
        storeSlot(saved, TypeKind::Long);
        emitElementAddress(expr.kids[0].kids[0], expr.kids[0].kids[1]);
        const int address = words_ + temp_;
        hold();
        storeSlot(address, TypeKind::Long);
        loadSlot(saved, TypeKind::Long);
        copy(1, 0);
        loadSlot(address, TypeKind::Long);
        copy(5, 0);
        copy(0, 1);
        release();
        release();
        emit("sti.64 r0, r5");
        frameHeld_ = false;
        return;
      }
      if (expr.kids[0].kind == Expr::Kind::Member) {
        gen(expr.kids[1]);
        const int saved = words_ + temp_;
        hold();
        storeSlot(saved, TypeKind::Long);
        emitAddress(expr.kids[0]);
        copy(1, 0);
        loadSlot(saved, TypeKind::Long);
        release();
        copy(5, 1);
        emit("sti.64 r0, r5");
        frameHeld_ = false;
        return;
      }
      if (expr.kids[0].kind == Expr::Kind::Unary && expr.kids[0].op == Tok::Star) {
        if (tryScaled(expr.kids[0].kids[0], &expr.kids[1], expr.kids[0].type)) return;
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
        if (collection(expr.kids[0].type)) {
          markCollect();
          emit("place r1, 0");
          emit("eq r1, r0, r1");
          emit("jnz r1, obrhalt");
        }
        emit("ldi.64 r0, r0");
        return;
      }
      if (expr.integer <= -20 && expr.integer >= -26) {
        emitCollectMethod(expr);
        return;
      }
      const Function& target = (*functions_)[static_cast<std::size_t>(expr.integer)];
      if (target.opcode == "library") {
        emitLibrary(expr, target);
        return;
      }
      if (target.opcode.empty() && inlineable(static_cast<int>(expr.integer))) {
        emitInline(expr, target);
        return;
      }
      if (target.opcode == "inbox" || target.opcode == "take") {
        gen(expr.kids[0]);
        copy(2, 0);
        emit(target.opcode + " r0, r1");
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
        if (!target.opcode.empty() && argument.kind == Expr::Kind::LitInt && want != TypeKind::Float && want != TypeKind::Double) {
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
        const std::size_t at = static_cast<std::size_t>(index);
        if (slots[at] < 0) {
          const Expr& argument = expr.kids[at];
          gen(argument);
          if ((kinds[at] == TypeKind::Float || kinds[at] == TypeKind::Double) && argument.type != TypeKind::Float && argument.type != TypeKind::Double) {
            emit("itof r0, r0");
          }
        } else {
          loadSlot(slots[at], kinds[at]);
        }
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
      emitIntegerCall((*functions_)[static_cast<std::size_t>(expr.integer)].label, slots, kinds);
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
    if (expr.op == Tok::LBracket && collection(expr.kids[0].type)) {
      emitElementAddress(expr.kids[0], expr.kids[1]);
      emit("ldi.64 r0, r0");
      return;
    }
    gen(expr.kids[0]);
    if (expr.op == Tok::LBracket) {
      const int base = words_ + temp_;
      hold();
      storeSlot(base, TypeKind::Long);
      gen(expr.kids[1]);
      emit("place r1, 32");
      emit("mul r0, r0, r1");
      emit("place r1, 64");
      emit("add r0, r0, r1");
      copy(1, 0);
      loadSlot(base, TypeKind::Long);
      release();
      emit("add r5, r0, r1");
      emit("ldi.32 r0, r5");
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

void Generator::arith(Tok op, TypeKind left, TypeKind right, TypeKind result) {
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

void Generator::emitIntegerCall(const std::string& label, const std::vector<int>& slots, const std::vector<TypeKind>& kinds) {
  if (slots.size() != kinds.size()) fail("调用参数和类型对不上");
  const int count = static_cast<int>(slots.size());
  auto into = [&](int index, int dest) {
    const std::size_t at = static_cast<std::size_t>(index);
    loadSlot(slots[at], kinds[at]);
    copy(dest, 0);
  };
  /* r1 到 r3 是前三个参数，r6 是第六个。压栈会改 r4、r5，所以第六个要先放好。 */
  if (count > 0) into(0, 1);
  if (count > 1) into(1, 2);
  if (count > 2) into(2, 3);
  if (count > 5) into(5, 6);
  int extra = 0;
  for (int index = 6; index < count; index += 1) {
    const std::size_t at = static_cast<std::size_t>(index);
    loadSlot(slots[at], kinds[at]);
    emit("load.64 r4, " + std::to_string(kSp));
    emit("sti.64 r0, r4");
    emit("place r5, 64");
    emit("add r4, r4, r5");
    emit("store.64 r4, " + std::to_string(kSp));
    extra += 1;
  }
  /* 第四个参数先停在栈上，腾出 r4、r5 去装第五个。 */
  if (count > 3) {
    const std::size_t at = 3;
    loadSlot(slots[at], kinds[at]);
    emit("load.64 r4, " + std::to_string(kSp));
    emit("sti.64 r0, r4");
    emit("place r5, 64");
    emit("add r4, r4, r5");
    emit("store.64 r4, " + std::to_string(kSp));
  }
  if (count > 4) into(4, 5);
  if (count > 3) {
    emit("load.64 r4, " + std::to_string(kSp));
    emit("place r0, 64");
    emit("sub r4, r4, r0");
    emit("store.64 r4, " + std::to_string(kSp));
    emit("ldi.64 r0, r4");
    copy(4, 0);
  }
  emit("call " + label);
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
}

void Generator::emitFunction(Function& function) {
    DebugSite next;
    next.file = function.origin;
    next.function = function.name;
    next.line = function.line;
    const SiteGuard guard(*this, next);
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
    /* 第 4、第 5 个参数在 r4、r5。建帧会改这两个寄存器，先各放 64 位。没有这两个参数也照放，返回时统一退回。 */
    emit("load.64 r0, " + std::to_string(kSp));
    emit("sti.64 r4, r0");
    emit("place r4, 64");
    emit("add r0, r0, r4");
    emit("sti.64 r5, r0");
    emit("add r0, r0, r4");
    emit("store.64 r0, " + std::to_string(kSp));
    /* 硬件 call 之后 rsp 低 4 位是 8。先减 8，返回前加回来。这行不是 Obr 语法。 */
    emit("rsp.bias");
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
    if (count > 3) {
      frameBase();
      emit("place r5, 128");
      emit("sub r5, r4, r5");
      emit("ldi.64 r0, r5");
      storeSlot(function.params[3].slot, function.params[3].type);
    }
    if (count > 4) {
      frameBase();
      emit("place r5, 64");
      emit("sub r5, r4, r5");
      emit("ldi.64 r0, r5");
      storeSlot(function.params[4].slot, function.params[4].type);
    }
    if (count > 5) {
      copy(0, 6);
      storeSlot(function.params[5].slot, function.params[5].type);
    }
    for (int index = 6; index < count; index += 1) {
      frameBase();
      emit("place r5, " + std::to_string(128 + (count - index) * 64));
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

bool Generator::endsWithReturn(const std::vector<Stmt>& body) {
    if (body.empty()) return false;
    const Stmt& stmt = body.back();
    if (stmt.kind == Stmt::Kind::Return) return true;
    if (stmt.kind == Stmt::Kind::Block) return endsWithReturn(stmt.body);
    if (stmt.kind == Stmt::Kind::If && !stmt.other.empty()) return endsWithReturn(stmt.body) && endsWithReturn(stmt.other);
    return false;
  }

void Generator::emitReturn() {
    if (!inlineReturn_.empty()) {
      emit("place r1, 1");
      emit("jnz r1, " + inlineReturn_);
      return;
    }
    frameBase();
    emit("ldi.64 r7, r4");
    emit("place r5, 128");
    emit("sub r4, r4, r5");
    emit("store.64 r4, " + std::to_string(kSp));
    emit("rsp.restore");
    emit("ret");
  }

void Generator::emitStmt(const Stmt& stmt, TypeKind ret) {
    const LineGuard at(*this, stmt.line);
    if (stmt.kind == Stmt::Kind::Zap) {
      emitZap(stmt.name, stmt.line);
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
      if (stmt.type == TypeKind::Struct) {
        for (int index = 0; index < stmt.words; index += 1) {
          emit("place r0, 0");
          storeSlot(stmt.slot + index, TypeKind::Long);
        }
        return;
      }
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
      /* 没有 else，或者 then 已经 return，后面就是出口，不必再跳一次。 */
      if (!stmt.other.empty() && !endsWithReturn(stmt.body)) {
        emit("place r1, 1");
        emit("jnz r1, " + end);
      }
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
    if (stmt.kind == Stmt::Kind::For) {
      if (!stmt.other.empty()) emitStmt(stmt.other[0], ret);
      const std::string head = fresh("w");
      const std::string step = fresh("w");
      const std::string end = fresh("d");
      loops_.push_back({end, step});
      emit(head + ":");
      gen(stmt.expr);
      truth(stmt.expr.type);
      emit("jz r0, " + end);
      for (const Stmt& inner : stmt.body) emitStmt(inner, ret);
      emit(step + ":");
      if (stmt.other.size() > 1) emitStmt(stmt.other[1], ret);
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

}  // namespace obr
