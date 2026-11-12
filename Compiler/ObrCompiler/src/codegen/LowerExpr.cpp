#include "Generator.hpp"
#include "../type/Type.hpp"

#include <cstdint>
#include <cstring>

namespace obr {

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
    if (expr.kind == Expr::Kind::LitStringStatic) {
      if (expr.integer < 0 || expr.integer >= static_cast<long long>(stringAddresses_.size())) fail("字符串常量编号越界");
      emit("place r0, " + std::to_string(stringAddresses_[static_cast<std::size_t>(expr.integer)]));
      return;
    }
    if (expr.kind == Expr::Kind::LitNull || expr.kind == Expr::Kind::LitUndefined) {
      emit("place r0, 0");
      return;
    }
    if (expr.kind == Expr::Kind::StructConst) {
      if (expr.integer < 0 || expr.integer >= static_cast<long long>(structAddresses_.size())) fail("结构体常量编号越界");
      emit("place r0, " + std::to_string(structAddresses_[static_cast<std::size_t>(expr.integer)]));
      return;
    }
    if (expr.kind == Expr::Kind::ClassConst) {
      if (expr.integer < 0 || expr.integer >= static_cast<long long>(classAddresses_.size())) fail("类常量编号越界");
      emit("place r0, " + std::to_string(classAddresses_[static_cast<std::size_t>(expr.integer)]));
      return;
    }
    if (expr.kind == Expr::Kind::Await) {
      gen(expr.kids[0]);
      /* 调用已经把结果留在 r0。yield 停住这颗核心，寄存器和栈都保留。 */
      emit("yield");
      return;
    }
    if (expr.kind == Expr::Kind::Dispatch || expr.kind == Expr::Kind::VirtualCall) {
      emitDispatch(expr);
      return;
    }
    if (expr.kind == Expr::Kind::New) {
      genNew(expr);
      return;
    }
    if (expr.kind == Expr::Kind::Member) {
      if (expr.type == TypeKind::Struct || expr.type == TypeKind::Span) {
        /* 结构体/span 成员值：给出字段地址（值语义由拷贝点完成）。 */
        emitAddress(expr);
        return;
      }
      emitAddress(expr);
      copy(5, 0);
      emit("ldi.64 r0, r5");
      frameHeld_ = false;
      return;
    }
    if (expr.kind == Expr::Kind::Cast) {
      genCast(expr);
      return;
    }
    if (expr.kind == Expr::Kind::Name) {
      /* M-C：out/ref 形参取值经槽里的地址字（out 的取值已被 Sema 拒绝，防御同形；
         结构体/span 的「值」是块地址）。 */
      if (outModeOf(static_cast<int>(expr.integer)) != ParamMode::None) {
        emitIndirectLoad(static_cast<int>(expr.integer), expr.type);
        return;
      }
      const auto known = knownAddr_.find(locate(static_cast<int>(expr.integer)));
      if (known != knownAddr_.end()) {
        emit("place r0, " + std::to_string(known->second));
        return;
      }
      loadSlot(static_cast<int>(expr.integer), expr.type);
      return;
    }
    if (expr.kind == Expr::Kind::Unary) {
      genUnary(expr);
      return;
    }
    if (expr.kind == Expr::Kind::Update) {
      genUpdate(expr);
      return;
    }
    if (expr.kind == Expr::Kind::Assign) {
      genAssign(expr);
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
      genCall(expr);
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
    /* M-B：span 下标取元素（八位组密度，步长 = 值宽度），越界失败值。 */
    if (expr.op == Tok::LBracket && expr.kids[0].type == TypeKind::Span) {
      emitSpanIndexAddress(expr.kids[0], expr.kids[1]);
      copy(5, 0);
      emitSpanLoad(expr.type);
      frameHeld_ = false;
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

void Generator::genCallDeref(const Expr& expr) {
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

void Generator::genCallFailOf(const Expr& expr) {
        /* fail.of(status[, note])（M3）：堆上构造 fail 对象。 */
        gen(expr.kids[0]);
        emitFailAlloc();
        if (expr.kids.size() > 1) {
          const int ref = words_ + temp_;
          hold();
          storeSlot(ref, TypeKind::Long);
          gen(expr.kids[1]);
          const int note = words_ + temp_;
          hold();
          storeSlot(note, TypeKind::Long);
          loadSlot(note, TypeKind::Long);
          emit("or r1, r0, r0");
          loadSlot(ref, TypeKind::Long);
          emit("place r5, 192");
          emit("add r5, r0, r5");
          emit("sti.64 r1, r5");
          loadSlot(ref, TypeKind::Long);
          release();
          release();
          frameHeld_ = false;
        }
        return;
      }

void Generator::genCallStruct(const Expr& expr, const Function& target) {
        if (!target.opcode.empty()) fail("指令函数不能收结构体参数或返回结构体");
        std::vector<int> slots;
        std::vector<TypeKind> kinds;
        int held = 0;
        if (target.ret == TypeKind::Struct || target.ret == TypeKind::Span) {
          if (structDestSlot_ < 0) fail("结构体返回值需要落点");
          slots.push_back(structDestSlot_);
          kinds.push_back(TypeKind::Long);
        }
        for (std::size_t index = 0; index < expr.kids.size(); index += 1) {
          const Expr& argument = expr.kids[index];
          const Param& param = target.params[index];
          /* M-C：out/ref 实参是一个地址字（结构体/span 出参也一样），不展平。 */
          if (param.mode != ParamMode::None) {
            emitArgAddress(argument);
            const int saved = words_ + temp_;
            hold();
            storeSlot(saved, TypeKind::Long);
            slots.push_back(saved);
            kinds.push_back(TypeKind::Long);
            held += 1;
            continue;
          }
          if (argument.type == TypeKind::Struct || argument.type == TypeKind::Span) {
            const std::size_t before = slots.size();
            pushStructArgWords(argument, slots, kinds);
            held += static_cast<int>(slots.size() - before);
            continue;
          }
          const TypeKind want = param.type;
          const TypeKind kind = want == TypeKind::Float || want == TypeKind::Double ? want : TypeKind::Long;
          gen(argument);
          if ((want == TypeKind::Float || want == TypeKind::Double) && argument.type != TypeKind::Float && argument.type != TypeKind::Double) {
            emit("itof r0, r0");
          }
          const int saved = words_ + temp_;
          hold();
          storeSlot(saved, kind);
          slots.push_back(saved);
          kinds.push_back(kind);
          held += 1;
        }
        emitIntegerCall(target.label, slots, kinds);
        temp_ -= held;
        if (target.fails) emitFailCheck(expr.ctorChain);
        return;
      }

void Generator::genCall(const Expr& expr) {
      if (expr.integer == -2) {
        genCallDeref(expr);
        return;
      }
      if (expr.integer == -7) {
        genCallFailOf(expr);
        return;
      }
      /* M-B：span 构造/子切片裸值位置（赋值/传参/返回都走 emitStructValueTo 的直写）：
         这里落临时块，值 = 块地址（与结构体值同一约定）。 */
      if (expr.integer == -10 || expr.integer == -11) {
        const int block = words_ + temp_;
        hold();
        hold();
        const int dst = words_ + temp_;
        hold();
        address(block);
        copy(0, 5);
        storeSlot(dst, TypeKind::Long);
        if (expr.integer == -10) emitSpanCtorTo(expr, dst);
        else emitSpanSubTo(expr, dst);
        release();
        address(block);
        copy(0, 5);
        release();
        release();
        frameHeld_ = false;
        return;
      }
      if (expr.integer <= -20 && expr.integer >= -26) {
        emitCollectMethod(expr);
        return;
      }
      const Function& target = (*functions_)[static_cast<std::size_t>(expr.integer)];
      /* 结构体值传递（缺口 1/2/3 收口）：结构体实参展平成字；结构体返回走隐藏目的地址。
         M-B：span 两字值同一路（值语义 = 结构体值语义）。
         M-C：out/ref 实参是一个地址字，不参与展平判定。 */
      bool structCall = target.ret == TypeKind::Struct || target.ret == TypeKind::Span;
      for (std::size_t index = 0; index < expr.kids.size(); index += 1) {
        const Expr& argument = expr.kids[index];
        if (target.params[index].mode == ParamMode::None && (argument.type == TypeKind::Struct || argument.type == TypeKind::Span)) structCall = true;
      }
      if (structCall) {
        genCallStruct(expr, target);
        return;
      }
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
        /* M-C：out/ref 实参传位置（地址字），与 `T*` + `&x` 同槽。 */
        if (target.params[index].mode != ParamMode::None) {
          emitArgAddress(argument);
          const int saved = words_ + temp_;
          hold();
          storeSlot(saved, TypeKind::Long);
          slots[index] = saved;
          continue;
        }
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
      if (target.fails) emitFailCheck(expr.ctorChain);
      return;
    }

void Generator::genNew(const Expr& expr) {
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
      const int words = decl->headerWords + static_cast<int>(decl->fields.size());
      const int allocated = words < 1 ? 1 : words;
      const int bits = allocated * 64;
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
      for (int index = 0; index < allocated; index += 1) {
        loadSlot(base, TypeKind::Long);
        emit("place r1, 0");
        emit("place r5, " + std::to_string(index * 64));
        emit("add r5, r0, r5");
        emit("sti.64 r1, r5");
      }
      if (decl->headerWords > 0) {
        loadSlot(base, TypeKind::Long);
        emit("place r1, " + std::to_string(decl->id));
        emit("sti.64 r1, r0");
      }
      if (expr.integer >= 0) {
        const Function& target = (*functions_)[static_cast<std::size_t>(expr.integer)];
        std::vector<int> params;
        std::vector<TypeKind> paramKinds;
        params.push_back(base);
        paramKinds.push_back(TypeKind::Long);
        int held = 0;
        for (std::size_t index = 0; index < expr.kids.size(); index += 1) {
          const Expr& argument = expr.kids[index];
          /* M-C：构造的 out/ref 实参传位置（params[0] 是 this）。 */
          if (target.params[index + 1].mode != ParamMode::None) {
            emitArgAddress(argument);
            const int saved = words_ + temp_;
            hold();
            storeSlot(saved, TypeKind::Long);
            params.push_back(saved);
            paramKinds.push_back(TypeKind::Long);
            held += 1;
            continue;
          }
          if (argument.type == TypeKind::Struct || argument.type == TypeKind::Span) {
            const std::size_t before = params.size();
            pushStructArgWords(argument, params, paramKinds);
            held += static_cast<int>(params.size() - before);
            continue;
          }
          gen(argument);
          const int saved = words_ + temp_;
          hold();
          storeSlot(saved, TypeKind::Long);
          params.push_back(saved);
          paramKinds.push_back(TypeKind::Long);
          held += 1;
        }
        emitIntegerCall(target.label, params, paramKinds);
        temp_ -= held;
        /* 可失败构造（M3 收口）：new 是可失败操作，失败时 r0 = 0、r1 = fail。 */
        if (target.fails) emitFailCheck();
      }
      loadSlot(base, TypeKind::Long);
      release();
      frameHeld_ = false;
      return;
    }

void Generator::genCast(const Expr& expr) {
      gen(expr.kids[0]);
      /* -5 是 Sema 标的类引用向下强转：按对象头 class ID 做运行时检查。
         检查失败先 halt；M3 落地失败值后这里改抛出，不再停机。 */
      if (expr.integer == -5) {
        const int refSlot = words_ + temp_;
        hold();
        storeSlot(refSlot, TypeKind::Long);
        const std::string done = fresh("e");
        emit("jz r0, " + done);
        bool emitted = false;
        for (const ClassDecl& decl : *classes_) {
          if (decl.id <= 0) continue;
          if (decl.name != expr.typeName && !classDerivesFrom(decl.name, expr.typeName)) continue;
          const std::string next = fresh("e");
          loadSlot(refSlot, TypeKind::Long);
          emit("ldi.64 r0, r0");
          emit("place r1, " + std::to_string(decl.id));
          emit("eq r0, r0, r1");
          emit("jz r0, " + next);
          emit("place r1, 1");
          emit("jnz r1, " + done);
          emit(next + ":");
          emitted = true;
        }
        if (!emitted) fail("强转检查没有可比的 class ID " + expr.typeName);
        /* 检查失败停机，rax 置 -1 与成功区分（M3 后改为抛失败值）。 */
        emit("place r0, -1");
        emit("halt");
        emit(done + ":");
        loadSlot(refSlot, TypeKind::Long);
        release();
        frameHeld_ = false;
      }
      castValue(expr.kids[0].type, expr.type);
      return;
    }

void Generator::genUnary(const Expr& expr) {
      if (expr.op == Tok::BitAnd) {
        /* M-C：&x 对 out/ref 形参给出它指向的位置（槽里的地址字），与 `T*` + `&x` 互调。 */
        if (outModeOf(static_cast<int>(expr.integer)) != ParamMode::None) {
          loadSlot(static_cast<int>(expr.integer), TypeKind::Long);
          return;
        }
        emitSlotAddress(static_cast<int>(expr.integer));
        return;
      }
      if (expr.op == Tok::Star) {
        if (expr.type == TypeKind::Struct || expr.type == TypeKind::Span) {
          /* *指针 的结构体/span 值：指针值就是两字块地址。 */
          gen(expr.kids[0]);
          return;
        }
        if (tryScaled(expr.kids[0], nullptr, expr.type)) return;
        /* M-D：volatile 指针不折叠常量地址（Fold 已关），经 vld. 面逐条读。 */
        long long addr = 0;
        if (constantPtr(expr.kids[0], addr)) {
          emit(std::string(loadAbs(expr.type)) + " r0, " + std::to_string(addr));
          return;
        }
        gen(expr.kids[0]);
        copy(5, 0);
        emitLoad(expr.type, expr.kids[0].volatilePointee);
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

void Generator::genUpdate(const Expr& expr) {
      const Expr& target = expr.kids[0];
      /* M-C：ref 形参的 ++ / -- 经地址字读改写（out 已被 Sema 拒——要读旧值）。 */
      const ParamMode mode = outModeOf(static_cast<int>(target.integer));
      if (mode != ParamMode::None) emitIndirectLoad(static_cast<int>(target.integer), target.type);
      else loadSlot(static_cast<int>(target.integer), target.type);
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
      if (mode != ParamMode::None) emitIndirectStore(static_cast<int>(target.integer), target.type);
      else storeSlot(static_cast<int>(target.integer), target.type);
      knownAddr_.erase(locate(static_cast<int>(target.integer)));
      if (!expr.prefix) {
        loadSlot(words_ + temp_ - 1, target.type);
        release();
      }
      return;
    }

void Generator::genAssign(const Expr& expr) {
      if (expr.type == TypeKind::Struct || expr.type == TypeKind::Span) {
        const int words = valueWordsOf(expr.kids[0]);
        (void)words;
        if (expr.kids[0].kind == Expr::Kind::Binary && expr.kids[0].op == Tok::LBracket) {
          /* 集合槽存装箱引用（缺口 1 收口）：值拷到堆上副本，槽里放引用。
             照普通下标赋值的槽形态：引用停 r1、元素地址停 r5，中间不用 loadSlot 覆盖。 */
          emitStructBoxValue(expr.kids[1]);
          const int ref = words_ + temp_;
          hold();
          storeSlot(ref, TypeKind::Long);
          emitElementAddress(expr.kids[0].kids[0], expr.kids[0].kids[1]);
          const int address = words_ + temp_;
          hold();
          storeSlot(address, TypeKind::Long);
          loadSlot(ref, TypeKind::Long);
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
        /* 结构体整值赋值 = 值拷贝（缺口 2 收口）：变量/字段/指针目标都按地址拷。 */
        emitAddress(expr.kids[0]);
        const int dst = words_ + temp_;
        hold();
        storeSlot(dst, TypeKind::Long);
        emitStructValueTo(expr.kids[1], dst);
        release();
        frameHeld_ = false;
        return;
      }
      if (expr.kids[0].kind == Expr::Kind::Binary && expr.kids[0].op == Tok::LBracket) {
        /* M-B：span 下标写元素（八位组密度，步长 = 值宽度），越界失败值。 */
        if (expr.kids[0].kids[0].type == TypeKind::Span) {
          gen(expr.kids[1]);
          if ((expr.type == TypeKind::Float || expr.type == TypeKind::Double)
            && expr.kids[1].type != TypeKind::Float && expr.kids[1].type != TypeKind::Double) {
            emit("itof r0, r0");
          }
          const int saved = words_ + temp_;
          hold();
          storeSlot(saved, TypeKind::Long);
          emitSpanIndexAddress(expr.kids[0].kids[0], expr.kids[0].kids[1]);
          copy(1, 0);
          loadSlot(saved, TypeKind::Long);
          copy(5, 1);
          release();
          emitSpanStore(expr.type);
          frameHeld_ = false;
          return;
        }
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
        /* M-D：volatile 解引用经 vld./vst. 面读写（Peephole 全屏蔽）；
           复合赋值（`*p += v`）走读旧值、算、写回三步——两跳都在 volatile 面上。 */
        const bool vol = expr.kids[0].kids[0].volatilePointee;
        if (expr.op == Tok::Assign && tryScaled(expr.kids[0].kids[0], &expr.kids[1], expr.kids[0].type)) return;
        long long addr = 0;
        if (expr.op == Tok::Assign && constantPtr(expr.kids[0].kids[0], addr)) {
          gen(expr.kids[1]);
          if ((expr.type == TypeKind::Float || expr.type == TypeKind::Double) && expr.kids[1].type != TypeKind::Float && expr.kids[1].type != TypeKind::Double) {
            emit("itof r0, r0");
          }
          emit(std::string(storeAbs(expr.type)) + " r0, " + std::to_string(addr));
          return;
        }
        if (expr.op != Tok::Assign) {
          gen(expr.kids[0].kids[0]);
          const int pointer = words_ + temp_;
          hold();
          storeSlot(pointer, TypeKind::Long);
          loadSlot(pointer, TypeKind::Long);
          copy(5, 0);
          emitLoad(expr.kids[0].type, vol);
          const int saved = words_ + temp_;
          hold();
          storeSlot(saved, TypeKind::Long);
          gen(expr.kids[1]);
          copy(2, 0);
          loadSlot(saved, TypeKind::Long);
          copy(1, 0);
          release();
          Tok op = Tok::Plus;
          if (expr.op == Tok::MinusEq) op = Tok::Minus;
          else if (expr.op == Tok::StarEq) op = Tok::Star;
          else if (expr.op == Tok::SlashEq) op = Tok::Slash;
          else if (expr.op == Tok::PercentEq) op = Tok::Percent;
          arith(op, expr.kids[0].type, expr.kids[1].type, expr.type);
          const int result = words_ + temp_;
          hold();
          storeSlot(result, TypeKind::Long);
          loadSlot(pointer, TypeKind::Long);
          copy(1, 0);
          loadSlot(result, TypeKind::Long);
          release();
          release();
          copy(5, 1);
          emitStore(expr.type, vol);
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
        emitStore(expr.type, vol);
        return;
      }
      if (expr.op == Tok::Assign) {
        gen(expr.kids[1]);
        if ((expr.type == TypeKind::Float || expr.type == TypeKind::Double) && expr.kids[1].type != TypeKind::Float && expr.kids[1].type != TypeKind::Double) {
          emit("itof r0, r0");
        }
        if (expr.kids[0].kind == Expr::Kind::Name) {
          /* M-C：out/ref 形参目标经槽里的地址字写（与 `*p = v` 同一指令形状）。 */
          if (outModeOf(static_cast<int>(expr.kids[0].integer)) != ParamMode::None) {
            emitIndirectStore(static_cast<int>(expr.kids[0].integer), expr.type);
            return;
          }
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
      /* 复合赋值：读旧值、算、写回。ref 形参经地址字读改写（out 已被 Sema 拒）。
         旧值装载进 r1（arith 的左操作数位）、右值进 r2。 */
      const ParamMode compound = outModeOf(static_cast<int>(expr.kids[0].integer));
      if (compound != ParamMode::None) emitIndirectLoad(static_cast<int>(expr.kids[0].integer), expr.kids[0].type);
      else loadSlot(static_cast<int>(expr.kids[0].integer), expr.kids[0].type);
      const int saved = words_ + temp_;
      hold();
      storeSlot(saved, TypeKind::Long);
      gen(expr.kids[1]);
      copy(2, 0);
      loadSlot(saved, TypeKind::Long);
      copy(1, 0);
      release();
      Tok op = Tok::Plus;
      if (expr.op == Tok::MinusEq) op = Tok::Minus;
      if (expr.op == Tok::StarEq) op = Tok::Star;
      if (expr.op == Tok::SlashEq) op = Tok::Slash;
      if (expr.op == Tok::PercentEq) op = Tok::Percent;
      arith(op, expr.kids[0].type, expr.kids[1].type, expr.type);
      if (compound != ParamMode::None) emitIndirectStore(static_cast<int>(expr.kids[0].integer), expr.type);
      else storeSlot(static_cast<int>(expr.kids[0].integer), expr.type);
      return;
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

}  // namespace obr
