#include "Generator.hpp"
#include "../type/Type.hpp"

#include <cstdint>
#include <cstring>

namespace obr {

void Generator::emitFunction(Function& function) {
    DebugSite next;
    next.file = function.origin;
    next.function = function.name;
    next.line = function.line;
    const SiteGuard guard(*this, next);
    prepareInline();
    /* M-C：out/ref 形参槽的间接读写按当前函数判定。 */
    currentFn_ = &function;
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
    /* 参数按字展平（结构体参数 = N 个字，逐字走 r1..r6/软件栈）；
       结构体返回值的隐藏目的地址是第 0 字。 */
    std::vector<int> wordSlots;
    std::vector<TypeKind> wordKinds;
    if (function.retSlot >= 0) {
      wordSlots.push_back(function.retSlot);
      wordKinds.push_back(TypeKind::Long);
    }
    for (const Param& param : function.params) {
      /* M-C：out/ref 形参是一个地址字（ABI 与 `T*` 同），不按值展平。 */
      if (param.mode != ParamMode::None) {
        wordSlots.push_back(param.slot);
        wordKinds.push_back(TypeKind::Long);
        continue;
      }
      const int words = param.type == TypeKind::Struct ? structWords(param.typeName) : (param.type == TypeKind::Span ? 2 : 1);
      for (int j = 0; j < words; j += 1) {
        wordSlots.push_back(param.slot + j);
        wordKinds.push_back(param.type == TypeKind::Struct || param.type == TypeKind::Span ? TypeKind::Long : param.type);
      }
    }
    const int count = static_cast<int>(wordSlots.size());
    for (int index = 0; index < count && index < 3; index += 1) {
      copy(0, index + 1);
      storeSlot(wordSlots[static_cast<std::size_t>(index)], wordKinds[static_cast<std::size_t>(index)]);
    }
    if (count > 3) {
      frameBase();
      emit("place r5, 128");
      emit("sub r5, r4, r5");
      emit("ldi.64 r0, r5");
      storeSlot(wordSlots[3], wordKinds[3]);
    }
    if (count > 4) {
      frameBase();
      emit("place r5, 64");
      emit("sub r5, r4, r5");
      emit("ldi.64 r0, r5");
      storeSlot(wordSlots[4], wordKinds[4]);
    }
    if (count > 5) {
      copy(0, 6);
      storeSlot(wordSlots[5], wordKinds[5]);
    }
    for (int index = 6; index < count; index += 1) {
      frameBase();
      emit("place r5, " + std::to_string(128 + (count - index) * 64));
      emit("sub r5, r4, r5");
      emit("ldi.64 r0, r5");
      storeSlot(wordSlots[static_cast<std::size_t>(index)], wordKinds[static_cast<std::size_t>(index)]);
    }
    currentFails_ = function.fails;
    failTargets_.clear();
    ctorDtorBase_.clear();
    ctorThisSlot_ = function.params.empty() ? -1 : function.params[0].slot;
    retSlot_ = function.retSlot;
    if (function.fails && !function.owner.empty() && shortFunctionName(function.name) == function.owner) {
      for (const ClassDecl& decl : *classes_) {
        if (decl.name == function.owner) {
          ctorDtorBase_ = decl.base;
          break;
        }
      }
    }
    dtorFrames_.emplace_back();
    for (const Stmt& stmt : function.body) emitStmt(stmt, function.ret);
    if (!endsWithReturn(function.body)) {
      emitAllFrameDtors();
      if (function.ret != TypeKind::Void) emit("place r0, 0");
      if (currentFails_) emit("place r1, 0");
      emitReturn();
    }
    dtorFrames_.pop_back();
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
    if (stmt.kind == Stmt::Kind::Const) return;
    if (stmt.kind == Stmt::Kind::Block) {
      dtorFrames_.emplace_back();
      for (const Stmt& inner : stmt.body) emitStmt(inner, ret);
      emitFrameEndDtors(dtorFrames_.back());
      dtorFrames_.pop_back();
      return;
    }
    if (stmt.kind == Stmt::Kind::Decl) {
      emitStmtDecl(stmt, ret);
      return;
    }
    if (stmt.kind == Stmt::Kind::Switch) {
      emitStmtSwitch(stmt, ret);
      return;
    }
    if (stmt.kind == Stmt::Kind::Fallthrough) {
      if (fallthrough_.empty()) fail("fallthrough 不在 switch 里");
      emit("place r1, 1");
      emit("jnz r1, " + fallthrough_);
      return;
    }
    if (stmt.kind == Stmt::Kind::If) {
      gen(stmt.expr);
      truth(stmt.expr.type);
      const std::string other = fresh("e");
      const std::string end = fresh("e");
      emit("jz r0, " + other);
      dtorFrames_.emplace_back();
      for (const Stmt& inner : stmt.body) emitStmt(inner, ret);
      emitFrameEndDtors(dtorFrames_.back());
      dtorFrames_.pop_back();
      /* 没有 else，或者 then 已经 return，后面就是出口，不必再跳一次。 */
      if (!stmt.other.empty() && !endsWithReturn(stmt.body)) {
        emit("place r1, 1");
        emit("jnz r1, " + end);
      }
      emit(other + ":");
      dtorFrames_.emplace_back();
      for (const Stmt& inner : stmt.other) emitStmt(inner, ret);
      emitFrameEndDtors(dtorFrames_.back());
      dtorFrames_.pop_back();
      emit(end + ":");
      return;
    }
    if (stmt.kind == Stmt::Kind::ForIn) {
      emitStmtForIn(stmt, ret);
      return;
    }
    if (stmt.kind == Stmt::Kind::While) {
      emitStmtWhile(stmt, ret);
      return;
    }
    if (stmt.kind == Stmt::Kind::For) {
      emitStmtFor(stmt, ret);
      return;
    }
    if (stmt.kind == Stmt::Kind::Break) {
      if (breakTargets_.empty()) fail("break 不在循环或 switch 里");
      std::size_t target = dtorFrames_.size();
      while (target > 0) {
        target -= 1;
        if (dtorFrames_[target].loop || dtorFrames_[target].isSwitch) break;
      }
      emitDtorsAbove(target, true);
      emit("place r1, 1");
      emit("jnz r1, " + breakTargets_.back());
      return;
    }
    if (stmt.kind == Stmt::Kind::Continue) {
      std::size_t target = dtorFrames_.size();
      while (target > 0) {
        target -= 1;
        if (dtorFrames_[target].loop) break;
      }
      emitDtorsAbove(target, true);
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
      emitStmtReturn(stmt, ret);
      return;
    }
    if (stmt.kind == Stmt::Kind::Throw) {
      /* throw e（M3）：与可失败调用同一归宿路由（try 捕获 / @Fails 传播 / 未接住终止）。
         抛出的失败值原样出本帧——最近的 catch 原样可得；可失败构造在此销毁已建成的基类链。 */
      gen(stmt.expr);
      const int slot = words_ + temp_;
      hold();
      storeSlot(slot, TypeKind::Long);
      emitFailureSite(slot, false, false);
      release();
      return;
    }
    if (stmt.kind == Stmt::Kind::Try) {
      emitStmtTry(stmt, ret);
      return;
    }
    gen(stmt.expr);
  }

void Generator::emitStmtDecl(const Stmt& stmt, TypeKind ret) {
      /* 带析构的所有权变量（new 直接初始化）记入当前析构帧；无析构类型零代码。
         M2 触发点 (d)：recordSlot >= 0 的变量带影子析构记录（Sema 已分配 3 个字）。 */
      if (stmt.recordSlot >= 0 && !dtorFrames_.empty()) {
        DtorEntry entry;
        entry.slot = stmt.slot;
        entry.typeName = stmt.typeName;
        entry.isInterface = stmt.type == TypeKind::Interface;
        entry.recordSlot = stmt.recordSlot;
        dtorFrames_.back().entries.push_back(entry);
      }
      if (stmt.type == TypeKind::Struct || stmt.type == TypeKind::Span) {
        const bool hasStructInit = !(stmt.expr.kind == Expr::Kind::LitInt && stmt.expr.type == TypeKind::None && stmt.expr.kids.empty());
        if (hasStructInit) {
          /* 结构体/span 值拷贝初值（缺口 2 收口）：同型两字/多字值拷进声明的字块。 */
          const int dst = words_ + temp_;
          hold();
          address(stmt.slot);
          copy(0, 5);
          storeSlot(dst, TypeKind::Long);
          emitStructValueTo(stmt.expr, dst);
          release();
          frameHeld_ = false;
          return;
        }
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
      /* M2 触发点 (d)：构造成功后压影子析构记录 {对象, 析构标签, 前一条}。 */
      if (stmt.recordSlot >= 0) {
        const Function* dtor = findDtor(stmt.expr.text);
        if (dtor == nullptr) fail("所有权变量找不到析构 " + stmt.name);
        emitRecordPush(stmt.recordSlot, dtor->label);
      }
      return;
    }

void Generator::emitStmtSwitch(const Stmt& stmt, TypeKind ret) {
      const std::string end = fresh("d");
      dtorFrames_.push_back(DtorFrame{{}, false, true});
      std::vector<std::string> labels;
      std::string defaultLabel = end;
      for (std::size_t index = 0; index < stmt.body.size(); index += 1) {
        labels.push_back(fresh("c"));
        if (stmt.body[index].kind == Stmt::Kind::Default) defaultLabel = labels.back();
      }
      std::vector<std::pair<long long, std::string>> cases;
      for (std::size_t index = 0; index < stmt.body.size(); index += 1) {
        const Stmt& arm = stmt.body[index];
        if (arm.kind == Stmt::Kind::Case) cases.push_back({arm.expr.integer, labels[index]});
      }
      bool table = false;
      long long minValue = 0;
      long long maxValue = 0;
      if (jumpTables_ && cases.size() >= 4) {
        minValue = cases[0].first;
        maxValue = cases[0].first;
        for (const auto& item : cases) {
          if (item.first < minValue) minValue = item.first;
          if (item.first > maxValue) maxValue = item.first;
        }
        if (minValue >= -2147483648LL && maxValue <= 2147483647LL) {
          const long long range = maxValue - minValue + 1;
          table = range >= 1 && range <= 256 && range <= static_cast<long long>(cases.size()) * 2;
        }
      }
      if (table) {
        gen(stmt.expr);
        std::string line = "switch.table r0, " + std::to_string(minValue) + ", " + defaultLabel;
        for (long long value = minValue; value <= maxValue; value += 1) {
          std::string target = defaultLabel;
          for (const auto& item : cases) {
            if (item.first != value) continue;
            target = item.second;
            break;
          }
          line += ", " + target;
        }
        emit(line);
      } else {
        gen(stmt.expr);
        const int selector = words_ + temp_;
        hold();
        storeSlot(selector, stmt.expr.type);
        for (std::size_t index = 0; index < stmt.body.size(); index += 1) {
          const Stmt& arm = stmt.body[index];
          if (arm.kind != Stmt::Kind::Case) continue;
          loadSlot(selector, stmt.expr.type);
          emit("place r1, " + std::to_string(arm.expr.integer));
          emit("eq r0, r0, r1");
          emit("jnz r0, " + labels[index]);
        }
        emit("place r1, 1");
        emit("jnz r1, " + defaultLabel);
      }
      breakTargets_.push_back(end);
      const std::string savedFallthrough = fallthrough_;
      for (std::size_t index = 0; index < stmt.body.size(); index += 1) {
        const Stmt& arm = stmt.body[index];
        emit(labels[index] + ":");
        const std::string next = index + 1 < labels.size() ? labels[index + 1] : end;
        /* 空 case 共享下一段标签体，例如 case 1: case 2: ...。 */
        if (arm.body.empty()) {
          emit("place r1, 1");
          emit("jnz r1, " + next);
          continue;
        }
        fallthrough_ = next;
        for (const Stmt& inner : arm.body) emitStmt(inner, ret);
        /* 默认不 fallthrough；显式 fallthrough 已经在语句里跳走，这条是不可达的。 */
        emit("place r1, 1");
        emit("jnz r1, " + end);
      }
      fallthrough_ = savedFallthrough;
      breakTargets_.pop_back();
      if (!table) release();
      emit(end + ":");
      emitFrameEndDtors(dtorFrames_.back());
      dtorFrames_.pop_back();
      return;
    }

void Generator::emitStmtForIn(const Stmt& stmt, TypeKind ret) {
      /* for-in 循环变量是集合元素/迭代器值的别名（不是 new 直接初始化），按所有权规则不析构；
         每轮的析构发生在循环体内部的块作用域（所有权变量）。 */
      dtorFrames_.push_back(DtorFrame{{}, true, false});
      if (stmt.expr.type != TypeKind::Array && stmt.expr.type != TypeKind::List) {
        const InterfaceDecl* iterable = findInterface("Iterable");
        if (iterable == nullptr) fail("没有 Iterable 接口");
        int hasNext = -1;
        int next = -1;
        for (std::size_t index = 0; index < iterable->methods.size(); index += 1) {
          const std::string name = shortFunctionName(iterable->methods[index].name);
          if (name == "hasNext") hasNext = static_cast<int>(index);
          if (name == "next") next = static_cast<int>(index);
        }
        if (hasNext < 0 || next < 0) fail("Iterable 接口需要 hasNext() 和 next()");
        gen(stmt.expr);
        const int object = words_ + temp_;
        hold();
        storeSlot(object, TypeKind::Long);
        const std::string head = fresh("w");
        const std::string end = fresh("d");
        loops_.push_back({end, head});
        breakTargets_.push_back(end);
        emit(head + ":");
        emitDispatchCall("Iterable", hasNext, object, {}, {});
        emit("jz r0, " + end);
        emitDispatchCall("Iterable", next, object, {}, {});
        if (stmt.type == TypeKind::Struct) {
          /* r0 = next() 返回的装箱引用（源）；先存源，再算循环变量地址（目的），回载后拷。 */
          const int src = words_ + temp_;
          hold();
          storeSlot(src, TypeKind::Long);
          const int dst = words_ + temp_;
          hold();
          address(stmt.slot);
          copy(0, 5);
          storeSlot(dst, TypeKind::Long);
          loadSlot(src, TypeKind::Long);
          emitStructCopyFrom(structWords(stmt.typeName), dst);
          release();
          release();
          frameHeld_ = false;
        } else {
          storeSlot(stmt.slot, stmt.type);
        }
        /* 体是每轮的作用域（M2 记录链的压/弹平衡在每轮内完成）。 */
        dtorFrames_.push_back(DtorFrame{});
        for (const Stmt& inner : stmt.body) emitStmt(inner, ret);
        emitFrameEndDtors(dtorFrames_.back());
        dtorFrames_.pop_back();
        emit("place r1, 1");
        emit("jnz r1, " + head);
        emit(end + ":");
        emitFrameEndDtors(dtorFrames_.back());
        dtorFrames_.pop_back();
        breakTargets_.pop_back();
        loops_.pop_back();
        release();
        return;
      }
      gen(stmt.expr);
      const int object = words_ + temp_;
      hold();
      storeSlot(object, TypeKind::Long);
      loadSlot(object, TypeKind::Long);
      emit("ldi.64 r0, r0");
      const int length = words_ + temp_;
      hold();
      storeSlot(length, TypeKind::Long);
      const int index = words_ + temp_;
      hold();
      emit("place r0, 0");
      storeSlot(index, TypeKind::Long);
      const std::string head = fresh("w");
      const std::string step = fresh("w");
      const std::string end = fresh("d");
      loops_.push_back({end, step});
      breakTargets_.push_back(end);
      emit(head + ":");
      loadSlot(index, TypeKind::Long);
      copy(1, 0);
      loadSlot(length, TypeKind::Long);
      copy(2, 0);
      emit("lt r0, r1, r2");
      emit("jz r0, " + end);
      if (stmt.expr.type == TypeKind::List) {
        /* 列表在循环里缩短时按当前长度提前结束，不越界。 */
        loadSlot(object, TypeKind::Long);
        emit("ldi.64 r0, r0");
        copy(2, 0);
        emit("lt r0, r1, r2");
        emit("jz r0, " + end);
      }
      loadSlot(index, TypeKind::Long);
      copy(1, 0);
      loadSlot(object, TypeKind::Long);
      emitCollectCall(stmt.expr.type == TypeKind::Array ? "obrcidx" : "obrlidx");
      emit("ldi.64 r0, r0");
      if (stmt.type == TypeKind::Struct) {
        /* 集合元素是装箱引用：r0 = 堆上副本地址（源）；先存源，再算循环变量地址（目的），回载后按值拷。 */
        const int src = words_ + temp_;
        hold();
        storeSlot(src, TypeKind::Long);
        const int dst = words_ + temp_;
        hold();
        address(stmt.slot);
        copy(0, 5);
        storeSlot(dst, TypeKind::Long);
        loadSlot(src, TypeKind::Long);
        emitStructCopyFrom(structWords(stmt.typeName), dst);
        release();
        release();
        frameHeld_ = false;
      } else {
        storeSlot(stmt.slot, stmt.type);
      }
      /* 体是每轮的作用域（M2 记录链的压/弹平衡在每轮内完成）。 */
      dtorFrames_.push_back(DtorFrame{});
      for (const Stmt& inner : stmt.body) emitStmt(inner, ret);
      emitFrameEndDtors(dtorFrames_.back());
      dtorFrames_.pop_back();
      emit(step + ":");
      loadSlot(index, TypeKind::Long);
      emit("place r1, 1");
      emit("add r0, r0, r1");
      storeSlot(index, TypeKind::Long);
      emit("place r1, 1");
      emit("jnz r1, " + head);
      emit(end + ":");
      emitFrameEndDtors(dtorFrames_.back());
      dtorFrames_.pop_back();
      breakTargets_.pop_back();
      loops_.pop_back();
      release();
      release();
      release();
      return;
    }

void Generator::emitStmtWhile(const Stmt& stmt, TypeKind ret) {
      const std::string head = fresh("w");
      const std::string end = fresh("d");
      loops_.push_back({end, head});
      breakTargets_.push_back(end);
      dtorFrames_.push_back(DtorFrame{{}, true, false});
      emit(head + ":");
      gen(stmt.expr);
      truth(stmt.expr.type);
      emit("jz r0, " + end);
      /* 体是每轮的作用域：体里的所有权变量每轮压记录、每轮弹除（M2 记录链的压/弹平衡）。 */
      dtorFrames_.push_back(DtorFrame{});
      for (const Stmt& inner : stmt.body) emitStmt(inner, ret);
      emitFrameEndDtors(dtorFrames_.back());
      dtorFrames_.pop_back();
      emit("place r1, 1");
      emit("jnz r1, " + head);
      emit(end + ":");
      emitFrameEndDtors(dtorFrames_.back());
      dtorFrames_.pop_back();
      breakTargets_.pop_back();
      loops_.pop_back();
      return;
    }

void Generator::emitStmtFor(const Stmt& stmt, TypeKind ret) {
      dtorFrames_.push_back(DtorFrame{{}, true, false});
      if (!stmt.other.empty()) emitStmt(stmt.other[0], ret);
      const std::string head = fresh("w");
      const std::string step = fresh("w");
      const std::string end = fresh("d");
      loops_.push_back({end, step});
      breakTargets_.push_back(end);
      emit(head + ":");
      gen(stmt.expr);
      truth(stmt.expr.type);
      emit("jz r0, " + end);
      /* 体是每轮的作用域（M2 记录链的压/弹平衡在每轮内完成）。 */
      dtorFrames_.push_back(DtorFrame{});
      for (const Stmt& inner : stmt.body) emitStmt(inner, ret);
      emitFrameEndDtors(dtorFrames_.back());
      dtorFrames_.pop_back();
      emit(step + ":");
      if (stmt.other.size() > 1) emitStmt(stmt.other[1], ret);
      emit("place r1, 1");
      emit("jnz r1, " + head);
      emit(end + ":");
      emitFrameEndDtors(dtorFrames_.back());
      dtorFrames_.pop_back();
      breakTargets_.pop_back();
      loops_.pop_back();
      return;
    }

void Generator::emitStmtReturn(const Stmt& stmt, TypeKind ret) {
      const bool hasValue = !(stmt.expr.kind == Expr::Kind::LitInt && stmt.expr.type == TypeKind::None && stmt.expr.kids.empty());
      if (hasValue && (ret == TypeKind::Struct || ret == TypeKind::Span)) {
        /* 结构体/span 返回值：拷进隐藏目的地址（retSlot_ 里存着调用方传入的目的）。 */
        emitStructValueTo(stmt.expr, retSlot_);
      } else if (hasValue) {
        gen(stmt.expr);
        if ((ret == TypeKind::Float || ret == TypeKind::Double) && stmt.expr.type != TypeKind::Float && stmt.expr.type != TypeKind::Double) {
          emit("itof r0, r0");
        }
      }
      if (anyDtorsPending()) {
        const TypeKind savedKind = ret == TypeKind::Float || ret == TypeKind::Double ? ret : TypeKind::Long;
        int saved = -1;
        if (hasValue) {
          saved = words_ + temp_;
          hold();
          storeSlot(saved, savedKind);
        }
        emitAllFrameDtors();
        if (hasValue) {
          loadSlot(saved, savedKind);
          release();
        }
      }
      if (currentFails_) emit("place r1, 0");
      emitReturn();
      return;
    }

void Generator::emitStmtTry(const Stmt& stmt, TypeKind ret) {
      /* try { ... } catch (fail e) { ... }（M3）：失败跳 catch（帧内 goto/绑定）。
         标签用 k 前缀：f 前缀被函数标签占用。 */
      const std::string catchLabel = fresh("k");
      const std::string endLabel = fresh("e");
      dtorFrames_.emplace_back();
      const std::size_t tryFrame = dtorFrames_.size() - 1;
      failTargets_.push_back({catchLabel, tryFrame});
      for (const Stmt& inner : stmt.body) emitStmt(inner, ret);
      failTargets_.pop_back();
      emitFrameEndDtors(dtorFrames_.back());
      dtorFrames_.pop_back();
      emit("place r1, 1");
      emit("jnz r1, " + endLabel);
      emit(catchLabel + ":");
      frameHeld_ = false;
      dtorFrames_.emplace_back();
      copy(0, 1);
      storeSlot(stmt.slot, TypeKind::Long);
      for (const Stmt& inner : stmt.other) emitStmt(inner, ret);
      emitFrameEndDtors(dtorFrames_.back());
      dtorFrames_.pop_back();
      emit(endLabel + ":");
      frameHeld_ = false;
      return;
    }

}  // namespace obr
