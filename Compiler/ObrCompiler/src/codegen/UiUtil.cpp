/* UiUtil.cpp —— UI 任务域的共享辅助：调用点收成（UiLayout/UiValue/UiDraw/UiState）
   与运行时例程发射（UiRoutine*）共用的小工具。只搬运指令形态，不改变收成顺序。 */

#include "Generator.hpp"
#include "UiLayout.hpp"

namespace obr {

int Generator::uiAt(int index) const { return kUi + index * 64; }

std::string Generator::uiCellText(int index) const { return std::to_string(uiAt(index)); }

int Generator::uiKeep(const Expr& expr, std::size_t index) {
  gen(expr.kids[index]);
  const int slot = words_ + temp_;
  hold();
  storeSlot(slot, TypeKind::Long);
  return slot;
}

void Generator::uiDrop(int count) {
  for (int index = 0; index < count; index += 1) release();
}

void Generator::uiAccel(int op) {
  emit("place r0, " + std::to_string(op));
  emit("gpu.accel r6, r0, r1, r2, r3, r4");
  emit("or r0, r6, r6");
  frameHeld_ = false;
}

void Generator::uiGpuAccel() { emit("gpu.accel r6, r0, r1, r2, r3, r4"); }

void Generator::uiZeroFrom(int from) {
  for (int reg = from; reg <= 4; reg += 1) {
    emit("place r" + std::to_string(reg) + ", 0");
    emit("itof r" + std::to_string(reg) + ", r" + std::to_string(reg));
  }
}

void Generator::uiFault() {
  emit("place r1, 0");
  emit("div r0, r0, r1");
}

void Generator::uiLoadAdvance(int sizeSlot) {
  const std::string half = fresh("e");
  const std::string done = fresh("e");
  loadSlot(sizeSlot, TypeKind::Long);
  emit("or r1, r0, r0");
  emit("place r2, 1");
  emit("lt r0, r1, r2");
  const std::string ready = fresh("e");
  emit("jz r0, " + ready);
  uiFault();
  emit(ready + ":");
  loadSlot(sizeSlot, TypeKind::Long);
  emit("or r1, r0, r0");
  emit("place r2, 2");
  emit("lt r0, r1, r2");
  emit("jz r0, " + half);
  emit("place r0, 1");
  emit("place r1, 1");
  emit("jnz r1, " + done);
  emit(half + ":");
  loadSlot(sizeSlot, TypeKind::Long);
  emit("or r1, r0, r0");
  emit("place r2, 2");
  emit("div r0, r1, r2");
  emit("place r1, 1");
  emit("add r0, r0, r1");
  emit(done + ":");
}

void Generator::uiPlant(const Expr& expr, std::size_t kid, int arg) {
  gen(expr.kids[kid]);
  emit("store.64 r0, " + std::to_string(uiAt(UiArg + arg)));
}

void Generator::uiPlantImm(int value, int arg) {
  emit("place r0, " + std::to_string(value));
  emit("store.64 r0, " + std::to_string(uiAt(UiArg + arg)));
}

void Generator::uiChannel(int mode) {
  if (mode == 0) {
    emit("place r5, 65536");
    emit("div r0, r6, r5");
  } else if (mode == 1) {
    emit("place r5, 256");
    emit("div r0, r6, r5");
    emit("place r5, 256");
    emit("mod r0, r0, r5");
  } else {
    emit("place r5, 256");
    emit("mod r0, r6, r5");
  }
  emit("itof r5, r0");
  emit("place r0, " + floatBits(255));
  emit("fdiv r0, r5, r0");
}

}  // namespace obr
