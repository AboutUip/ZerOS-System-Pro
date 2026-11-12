#include "Generator.hpp"
#include "../type/Type.hpp"

#include <cstdint>
#include <cstring>

namespace obr {

void Generator::emitDtorCall(const DtorEntry& entry) {
  /* M2 触发点 (d)：销毁 = 先弹除影子记录，对象引用取记录里登记的那只
     （所有权绑定构造出来的对象，变量后来被重赋值也不转移所有权）。 */
  if (entry.recordSlot >= 0) {
    emitRecordUnlink(entry.recordSlot);
    address(entry.recordSlot);
    emit("or r0, r5, r5");
    emit("ldi.64 r0, r0");
    frameHeld_ = false;
  } else {
    loadSlot(entry.slot, TypeKind::Long);
  }
  std::vector<std::pair<int, int>> targets;
  for (const ClassDecl& decl : *classes_) {
    if (decl.id < 1) continue;
    if (entry.isInterface ? !classImplements(decl.name, entry.typeName)
                          : (decl.name != entry.typeName && !classDerivesFrom(decl.name, entry.typeName))) continue;
    const Function* dtor = findDtor(decl.name);
    if (dtor == nullptr) continue;
    const int index = functionIndex(*dtor);
    if (index < 0) continue;
    targets.push_back({decl.id, index});
  }
  if (targets.empty()) return;
  const int refSlot = words_ + temp_;
  hold();
  storeSlot(refSlot, TypeKind::Long);
  const std::string done = fresh("e");
  emit("jz r0, " + done);
  for (const std::pair<int, int>& target : targets) {
    const std::string next = fresh("e");
    loadSlot(refSlot, TypeKind::Long);
    emit("ldi.64 r0, r0");
    emit("place r1, " + std::to_string(target.first));
    emit("eq r0, r0, r1");
    emit("jz r0, " + next);
    std::vector<int> slots(1, refSlot);
    std::vector<TypeKind> kinds(1, TypeKind::Long);
    emitIntegerCall((*functions_)[static_cast<std::size_t>(target.second)].label, slots, kinds);
    emit("place r1, 1");
    emit("jnz r1, " + done);
    emit(next + ":");
  }
  emit(done + ":");
  release();
  frameHeld_ = false;
}

/* 作用域尽头：本帧内逆序（LIFO）。perIteration 记录（for-in 循环变量）不在这跑。 */

void Generator::emitFrameEndDtors(DtorFrame& frame) {
  for (std::size_t index = frame.entries.size(); index > 0; index -= 1) {
    const DtorEntry& entry = frame.entries[index - 1];
    if (entry.perIteration) continue;
    emitDtorCall(entry);
  }
}

/* return / 函数收尾：所有帧自顶向下、帧内逆序，含 perIteration 记录。
   只扫到内联边界（dtorBarrier_）：被调方的 return 不能扫调用方的析构帧。 */

void Generator::emitAllFrameDtors() {
  for (std::size_t frame = dtorFrames_.size(); frame > dtorBarrier_; frame -= 1) {
    const std::vector<DtorEntry>& entries = dtorFrames_[frame - 1].entries;
    for (std::size_t index = entries.size(); index > 0; index -= 1) emitDtorCall(entries[index - 1]);
  }
}

/* break / continue：销毁目标帧以上的全部帧（含 perIteration），可选再销毁目标帧的
   perIteration 记录（for-in 循环变量按每轮销毁）。目标帧自己的其它记录留给它的尽头。 */

void Generator::emitDtorsAbove(std::size_t frameIndex, bool withTargetPerIteration) {
  for (std::size_t frame = dtorFrames_.size(); frame > frameIndex + 1; frame -= 1) {
    const std::vector<DtorEntry>& entries = dtorFrames_[frame - 1].entries;
    for (std::size_t index = entries.size(); index > 0; index -= 1) emitDtorCall(entries[index - 1]);
  }
  if (withTargetPerIteration && frameIndex < dtorFrames_.size()) {
    const std::vector<DtorEntry>& entries = dtorFrames_[frameIndex].entries;
    for (std::size_t index = entries.size(); index > 0; index -= 1) {
      if (entries[index - 1].perIteration) emitDtorCall(entries[index - 1]);
    }
  }
}

bool Generator::anyDtorsPending() const {
  for (std::size_t frame = dtorBarrier_; frame < dtorFrames_.size(); frame += 1) {
    if (!dtorFrames_[frame].entries.empty()) return true;
  }
  return false;
}

/* ===== M2 触发点 (d)：影子析构记录链（2026-11-06） =====
   记录 = {对象引用, 析构函数标签, 前一条}，3 个字，放在所有权变量自己的帧槽后面。
   链根是任务私有窗口里的固定槽（每任务一份，任务入口清零），不占任务结构 19 字。
   (a)-(c) 触发点销毁时按 LIFO 弹除；任务被放弃时 __dtor_sweep 沿链清扫。
   析构派发用标签比较链 + 直接调用（原生映像与链接映像同一形态，不加指令）。 */
namespace {
std::string dtorCell(int index) { return std::to_string(kUi + index * 64); }
}  // namespace

/* 构造成功后压记录：r0 = 对象引用（刚建好的所有权对象）。 */

void Generator::emitRecordPush(int recordSlot, const std::string& dtorLabel) {
  emit("or r1, r0, r0");
  address(recordSlot);
  emit("or r2, r5, r5");
  emit("sti.64 r1, r2");
  emit("place r5, 64");
  emit("add r5, r2, r5");
  emit("place r0, " + dtorLabel);
  emit("sti.64 r0, r5");
  emit("place r5, 128");
  emit("add r5, r2, r5");
  emit("load.64 r0, " + dtorCell(kDtorRootCell));
  emit("sti.64 r0, r5");
  emit("store.64 r2, " + dtorCell(kDtorRootCell));
  frameHeld_ = false;
}

/* 销毁时弹除（严格 LIFO，前一条就是销毁前的链根）。 */

void Generator::emitRecordUnlink(int recordSlot) {
  address(recordSlot);
  emit("or r0, r5, r5");
  emit("place r5, 128");
  emit("add r5, r0, r5");
  emit("ldi.64 r0, r5");
  emit("store.64 r0, " + dtorCell(kDtorRootCell));
  frameHeld_ = false;
}

/* __dtor_sweep_core：沿链 LIFO 清扫（每条记录弹除 + 调析构），返回 r7 调用方。
   __dtor_sweep：reap 钩子换 PC 到这里——清扫完 halt（正常任务退出形态）。
   清扫保持 r0 不动：最后一发析构留在 r0 的值就是停机时的 rax（探针靠它观察）。 */

void Generator::emitDtorSweepRoutines() {
  const SiteGuard guard(*this, DebugSite{});
  emit("__dtor_sweep_core:");
  emit("store.64 r7, " + dtorCell(kDtorLinkCell));
  emit("load.64 r5, " + std::to_string(kFrame));
  emit("store.64 r5, " + dtorCell(kDtorFrameCell));
  const std::string loop = "__dtor_loop";
  const std::string done = "__dtor_done";
  emit(loop + ":");
  emit("load.64 r6, " + dtorCell(kDtorRootCell));
  emit("place r5, 0");
  emit("eq r5, r6, r5");
  emit("jnz r5, " + done);
  emit("ldi.64 r1, r6");
  emit("place r5, 64");
  emit("add r5, r6, r5");
  emit("ldi.64 r2, r5");
  emit("place r5, 128");
  emit("add r5, r6, r5");
  emit("ldi.64 r5, r5");
  emit("store.64 r5, " + dtorCell(kDtorRootCell));
  for (const Function& fn : *functions_) {
    if (!fn.destruct) continue;
    const std::string next = fresh("k");
    emit("place r5, " + fn.label);
    emit("eq r5, r2, r5");
    emit("jz r5, " + next);
    emit("call " + fn.label);
    emit("place r6, 1");
    emit("jnz r6, " + loop);
    emit(next + ":");
  }
  emit("place r6, 1");
  emit("jnz r6, " + loop);
  emit(done + ":");
  emit("load.64 r5, " + dtorCell(kDtorFrameCell));
  emit("store.64 r5, " + std::to_string(kFrame));
  emit("load.64 r7, " + dtorCell(kDtorLinkCell));
  emit("ret");
  emit("__dtor_sweep:");
  emit("call __dtor_sweep_core");
  emit("halt");
}

/* M3 失败值：r0 = code → r0 = 新 fail 对象（对象头 + code/cause/note，32 字节）。
   与 new 同一条堆分配路径。 */

void Generator::emitDtorsThrough(std::size_t frameIndex) {
  for (std::size_t frame = dtorFrames_.size(); frame > frameIndex && frame > 0; frame -= 1) {
    const std::vector<DtorEntry>& entries = dtorFrames_[frame - 1].entries;
    for (std::size_t index = entries.size(); index > 0; index -= 1) emitDtorCall(entries[index - 1]);
  }
}

/* 结构体值拷贝（M5 缺口 1/2/3 收口）：把 r0 指向的 count 个字拷到 dstAddrSlot 指向的目的。 */

}  // namespace obr
