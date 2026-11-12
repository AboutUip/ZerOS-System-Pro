/* UiValue.cpp —— UI 数值/颜色域调用点收成：lerp/ease/rgb/meter，数值插值与颜色通道计算。 */

#include "Generator.hpp"
#include "UiLayout.hpp"

namespace obr {

void Generator::emitUiLerp(const Expr& expr) {
    const int from = uiKeep(expr, 0);
    const int to = uiKeep(expr, 1);
    const int numer = uiKeep(expr, 2);
    const int denom = uiKeep(expr, 3);
    const std::string live = fresh("e");
    const std::string upper = fresh("e");
    const std::string done = fresh("e");
    loadSlot(denom, TypeKind::Long);
    emit("or r1, r0, r0");
    emit("place r2, 0");
    emit("eq r0, r1, r2");
    emit("jz r0, " + live);
    uiFault();
    emit(live + ":");
    loadSlot(numer, TypeKind::Long);
    emit("or r1, r0, r0");
    emit("place r2, 0");
    emit("le r0, r1, r2");
    emit("jz r0, " + upper);
    loadSlot(from, TypeKind::Long);
    emit("place r1, 1");
    emit("jnz r1, " + done);
    emit(upper + ":");
    loadSlot(numer, TypeKind::Long);
    emit("or r1, r0, r0");
    loadSlot(denom, TypeKind::Long);
    emit("or r2, r0, r0");
    emit("ge r0, r1, r2");
    const std::string mid = fresh("e");
    emit("jz r0, " + mid);
    loadSlot(to, TypeKind::Long);
    emit("place r1, 1");
    emit("jnz r1, " + done);
    emit(mid + ":");
    loadSlot(to, TypeKind::Long);
    emit("or r1, r0, r0");
    loadSlot(from, TypeKind::Long);
    emit("or r2, r0, r0");
    emit("sub r0, r1, r2");
    emit("or r1, r0, r0");
    loadSlot(numer, TypeKind::Long);
    emit("or r2, r0, r0");
    emit("mul r0, r1, r2");
    emit("or r1, r0, r0");
    loadSlot(denom, TypeKind::Long);
    emit("or r2, r0, r0");
    emit("div r0, r1, r2");
    emit("or r1, r0, r0");
    loadSlot(from, TypeKind::Long);
    emit("or r2, r0, r0");
    emit("add r0, r2, r1");
    emit(done + ":");
    uiDrop(4);
    return;
  }

void Generator::emitUiEase(const Expr& expr) {
    const int from = uiKeep(expr, 0);
    const int to = uiKeep(expr, 1);
    const int numer = uiKeep(expr, 2);
    const int denom = uiKeep(expr, 3);
    const std::string live = fresh("e");
    const std::string upper = fresh("e");
    const std::string done = fresh("e");
    loadSlot(denom, TypeKind::Long);
    emit("or r1, r0, r0");
    emit("place r2, 0");
    emit("eq r0, r1, r2");
    emit("jz r0, " + live);
    uiFault();
    emit(live + ":");
    loadSlot(numer, TypeKind::Long);
    emit("or r1, r0, r0");
    emit("place r2, 0");
    emit("le r0, r1, r2");
    emit("jz r0, " + upper);
    loadSlot(from, TypeKind::Long);
    emit("place r1, 1");
    emit("jnz r1, " + done);
    emit(upper + ":");
    loadSlot(numer, TypeKind::Long);
    emit("or r1, r0, r0");
    loadSlot(denom, TypeKind::Long);
    emit("or r2, r0, r0");
    emit("ge r0, r1, r2");
    const std::string mid = fresh("e");
    emit("jz r0, " + mid);
    loadSlot(to, TypeKind::Long);
    emit("place r1, 1");
    emit("jnz r1, " + done);
    emit(mid + ":");
    loadSlot(numer, TypeKind::Long);
    emit("or r1, r0, r0");
    emit("mul r0, r1, r0");
    emit("place r2, 2");
    emit("mul r3, r1, r2");
    storeSlot(numer, TypeKind::Long);
    loadSlot(denom, TypeKind::Long);
    emit("or r1, r0, r0");
    emit("place r2, 3");
    emit("mul r0, r1, r2");
    emit("or r1, r0, r0");
    emit("sub r0, r1, r3");
    emit("or r1, r0, r0");
    loadSlot(numer, TypeKind::Long);
    emit("or r2, r0, r0");
    emit("mul r0, r1, r2");
    emit("or r6, r0, r0");
    loadSlot(to, TypeKind::Long);
    emit("or r1, r0, r0");
    loadSlot(from, TypeKind::Long);
    emit("or r2, r0, r0");
    emit("sub r0, r1, r2");
    emit("or r1, r0, r0");
    emit("mul r0, r6, r1");
    emit("or r6, r0, r0");
    loadSlot(denom, TypeKind::Long);
    emit("or r1, r0, r0");
    emit("mul r0, r1, r1");
    emit("or r1, r0, r0");
    loadSlot(denom, TypeKind::Long);
    emit("or r2, r0, r0");
    emit("mul r0, r1, r2");
    emit("or r1, r0, r0");
    emit("div r0, r6, r1");
    emit("or r1, r0, r0");
    loadSlot(from, TypeKind::Long);
    emit("or r2, r0, r0");
    emit("add r0, r2, r1");
    emit(done + ":");
    uiDrop(4);
    return;
  }

void Generator::emitUiMeter(const Expr& expr) {
    uiMeter_ = true;
    for (int index = 0; index < 3; index += 1) {
      gen(expr.kids[static_cast<std::size_t>(index)]);
      emit("store.64 r0, " + std::to_string(uiAt(UiMeter + index)));
    }
    emit("call uimeter");
    return;
  }

void Generator::emitUiRgb(const Expr& expr) {
    const int red = uiKeep(expr, 0);
    const int green = uiKeep(expr, 1);
    const int blue = uiKeep(expr, 2);
    auto clamp = [&](int slot) {
      const std::string above = fresh("e");
      const std::string keepValue = fresh("e");
      const std::string stored = fresh("e");
      loadSlot(slot, TypeKind::Long);
      emit("or r1, r0, r0");
      emit("place r2, 0");
      emit("lt r0, r1, r2");
      emit("jz r0, " + above);
      emit("place r0, 0");
      emit("place r1, 1");
      emit("jnz r1, " + stored);
      emit(above + ":");
      loadSlot(slot, TypeKind::Long);
      emit("or r1, r0, r0");
      emit("place r2, 255");
      emit("gt r0, r1, r2");
      emit("jz r0, " + keepValue);
      emit("place r0, 255");
      emit("place r1, 1");
      emit("jnz r1, " + stored);
      emit(keepValue + ":");
      loadSlot(slot, TypeKind::Long);
      emit(stored + ":");
      storeSlot(slot, TypeKind::Long);
    };
    clamp(red);
    clamp(green);
    clamp(blue);
    loadSlot(red, TypeKind::Long);
    emit("or r1, r0, r0");
    emit("place r2, 65536");
    emit("mul r0, r1, r2");
    emit("or r1, r0, r0");
    loadSlot(green, TypeKind::Long);
    emit("or r2, r0, r0");
    emit("place r5, 256");
    emit("mul r0, r2, r5");
    emit("or r2, r0, r0");
    emit("add r0, r1, r2");
    emit("or r1, r0, r0");
    loadSlot(blue, TypeKind::Long);
    emit("or r2, r0, r0");
    emit("add r0, r1, r2");
    uiDrop(3);
    return;
  }

}  // namespace obr
