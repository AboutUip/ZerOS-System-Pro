#include "Generator.hpp"
#include "../type/Type.hpp"

#include <cstdint>
#include <cstring>

namespace obr {

void Generator::emitFailAlloc() {
  if (failClassId_ == 0) {
    for (const ClassDecl& decl : *classes_) {
      if (decl.name == "fail") failClassId_ = decl.id;
    }
    if (failClassId_ == 0) fail("没有内置 fail 类");
  }
  const int code = words_ + temp_;
  hold();
  storeSlot(code, TypeKind::Long);
  const std::string ready = fresh("e");
  emit("load.64 r4, " + std::to_string(kHeapPtr));
  emit("place r5, 0");
  emit("eq r0, r4, r5");
  emit("jz r0, " + ready);
  emit("place r4, " + std::to_string(kHeap));
  emit(ready + ":");
  copy(0, 4);
  emit("place r1, 256");
  emit("add r4, r4, r1");
  emit("store.64 r4, " + std::to_string(kHeapPtr));
  const int base = words_ + temp_;
  hold();
  storeSlot(base, TypeKind::Long);
  loadSlot(base, TypeKind::Long);
  emit("place r1, " + std::to_string(failClassId_));
  emit("sti.64 r1, r0");
  loadSlot(code, TypeKind::Long);
  emit("or r1, r0, r0");
  loadSlot(base, TypeKind::Long);
  emit("place r5, 64");
  emit("add r5, r0, r5");
  emit("sti.64 r1, r5");
  loadSlot(base, TypeKind::Long);
  emit("place r5, 128");
  emit("add r5, r0, r5");
  emit("place r1, 0");
  emit("sti.64 r1, r5");
  loadSlot(base, TypeKind::Long);
  emit("place r5, 192");
  emit("add r5, r0, r5");
  emit("place r1, 0");
  emit("sti.64 r1, r5");
  loadSlot(base, TypeKind::Long);
  release();
  release();
  frameHeld_ = false;
}

/* 沿调用叠原因（M3）：r0 = 子 fail → r0 = 新 fail（code 沿用，cause = 子）。 */

void Generator::emitFailWrap() {
  const int child = words_ + temp_;
  hold();
  storeSlot(child, TypeKind::Long);
  loadSlot(child, TypeKind::Long);
  emit("place r5, 64");
  emit("add r5, r0, r5");
  emit("ldi.64 r0, r5");
  emitFailAlloc();
  const int wrapped = words_ + temp_;
  hold();
  storeSlot(wrapped, TypeKind::Long);
  loadSlot(child, TypeKind::Long);
  emit("or r1, r0, r0");
  loadSlot(wrapped, TypeKind::Long);
  emit("place r5, 128");
  emit("add r5, r0, r5");
  emit("sti.64 r1, r5");
  loadSlot(wrapped, TypeKind::Long);
  release();
  release();
  frameHeld_ = false;
}

/* 可失败操作后的统一检查：r1 = fail 对象（0 = 成功）。
   失败归宿：最近的 try → 跳 catch；@Fails 函数 → 包装原因、沿返回通道传播；
   都没有 = 未接住的失败 → 终止（halt，rax = -code）。 */

void Generator::emitFailCheck(bool noObjectChain) {
  const std::string failed = fresh("k");
  const std::string ok = fresh("e");
  emit("place r6, 0");
  emit("eq r6, r1, r6");
  emit("jz r6, " + failed);
  emit("place r6, 1");
  emit("jnz r6, " + ok);
  emit(failed + ":");
  const int slot = words_ + temp_;
  hold();
  copy(0, 1);
  storeSlot(slot, TypeKind::Long);
  emitFailureSite(slot, noObjectChain, true);
  release();
  emit(ok + ":");
}

void Generator::emitFailureSite(int failSlot, bool noObjectChain, bool wrap) {
  if (!failTargets_.empty()) {
    /* (a) 最近的 try：析构到 try 帧（含）为止，把 fail 交给 catch 变量
       （catch 原样得到传来的失败值；throw 的对象在同帧 catch 处保持同一对象）。 */
    const std::string label = failTargets_.back().first;
    const std::size_t frameIndex = failTargets_.back().second;
    const int saved = words_ + temp_;
    hold();
    loadSlot(failSlot, TypeKind::Long);
    storeSlot(saved, TypeKind::Long);
    emitDtorsThrough(frameIndex);
    loadSlot(saved, TypeKind::Long);
    copy(1, 0);
    release();
    frameHeld_ = false;
    emit("place r6, 1");
    emit("jnz r6, " + label);
    return;
  }
  if (currentFails_) {
    /* (b) 沿返回通道传播（M2 的失败路径析构在这里跑）。
       跨出本帧时包一层原因（沿调用叠原因：一帧一个节点）；throw 的失败值
       原样出本帧（最近 catch 原样可得），跨帧后再包装。
       可失败构造的失败再销毁已建成的基类链（自类不析构——对象没建完）；
       构造链调用点豁免（基类构造自己的失败路径已销毁它下面的链）。 */
    loadSlot(failSlot, TypeKind::Long);
    if (wrap) emitFailWrap();
    const int saved = words_ + temp_;
    hold();
    storeSlot(saved, TypeKind::Long);
    emitAllFrameDtors();
    if (!noObjectChain && !ctorDtorBase_.empty()) {
      const Function* dtor = nullptr;
      std::string cursor = ctorDtorBase_;
      while (!cursor.empty() && dtor == nullptr) {
        for (const Function& fn : *functions_) {
          if (fn.destruct && fn.owner == cursor) {
            dtor = &fn;
            break;
          }
        }
        if (dtor == nullptr) {
          std::string next;
          for (const ClassDecl& decl : *classes_) {
            if (decl.name == cursor) {
              next = decl.base;
              break;
            }
          }
          cursor = next;
        }
      }
      if (dtor != nullptr && ctorThisSlot_ >= 0) {
        std::vector<int> slots(1, ctorThisSlot_);
        std::vector<TypeKind> kinds(1, TypeKind::Long);
        emitIntegerCall(dtor->label, slots, kinds);
      }
    }
    loadSlot(saved, TypeKind::Long);
    copy(1, 0);
    release();
    emit("place r0, 0");
    emitReturn();
    return;
  }
  /* (c) 未接住的失败：终止，rax = -code。 */
  loadSlot(failSlot, TypeKind::Long);
  emit("place r6, 64");
  emit("add r0, r0, r6");
  emit("ldi.64 r0, r0");
  emit("place r6, 0");
  emit("sub r0, r6, r0");
  emit("halt");
}

/* 销毁 top..=frameIndex 的全部帧（含自身），帧内逆序。 */

}  // namespace obr
