/* UiDraw.cpp —— UI 绘制控件域调用点收成：shape/bar/glyph/text/clear/clip/unclip/shift/present，
   调用点把实参种进 UI 参数单元并呼叫对应运行时例程。 */

#include "Generator.hpp"
#include "UiLayout.hpp"

namespace obr {

void Generator::emitUiClear(const Expr& expr) {
    uiClear_ = true;
    uiPlant(expr, 0, 0);
    uiPlant(expr, 1, 1);
    emit("call uiclear");
    return;
  }

void Generator::emitUiShape(const Expr& expr, const std::string& name) {
    uiBox_ = true;
    uiInk_ = true;
    uiPlant(expr, 0, 0);
    uiPlant(expr, 1, 1);
    uiPlant(expr, 2, 2);
    uiPlant(expr, 3, 3);
    if (name == "obr::ui::round") {
      uiPlant(expr, 5, 4);
      uiPlant(expr, 6, 5);
      uiPlantImm(36, 6);
      uiPlant(expr, 4, 7);
    } else if (name == "obr::ui::ellipse") {
      uiPlant(expr, 4, 4);
      uiPlant(expr, 5, 5);
      uiPlantImm(37, 6);
      uiPlantImm(0, 7);
    } else {
      uiPlant(expr, 4, 4);
      uiPlant(expr, 5, 5);
      uiPlantImm(33, 6);
      uiPlantImm(0, 7);
    }
    emit("call uibox");
    return;
  }

void Generator::emitUiBar(const Expr& expr) {
    uiBar_ = true;
    uiMeter_ = true;
    uiBox_ = true;
    uiInk_ = true;
    for (int index = 0; index < 10; index += 1) {
      gen(expr.kids[static_cast<std::size_t>(index)]);
      emit("store.64 r0, " + std::to_string(uiAt(UiBar + index)));
    }
    emit("call uibar");
    return;
  }

void Generator::emitUiGlyph(const Expr& expr) {
    uiGlyph_ = true;
    uiInk_ = true;
    uiPlant(expr, 0, 0);
    uiPlant(expr, 1, 1);
    uiPlant(expr, 2, 2);
    uiPlant(expr, 3, 3);
    uiPlant(expr, 4, 4);
    uiPlant(expr, 5, 5);
    emit("call uiglyph");
    return;
  }

void Generator::emitUiText(const Expr& expr) {
    uiText_ = true;
    uiInk_ = true;
    uiPlant(expr, 0, 0);
    uiPlant(expr, 1, 1);
    uiPlant(expr, 2, 2);
    if (expr.kids.size() == 7) {
      uiPlant(expr, 3, 3);
      uiPlant(expr, 4, 4);
      uiPlant(expr, 5, 5);
      uiPlant(expr, 6, 6);
    } else {
      uiPlantImm(0, 3);
      uiPlant(expr, 3, 4);
      uiPlant(expr, 4, 5);
      uiPlant(expr, 5, 6);
    }
    emit("call uitext");
    return;
  }

void Generator::emitUiClip(const Expr& expr) {
    uiClip_ = true;
    uiPlant(expr, 0, 0);
    uiPlant(expr, 1, 1);
    uiPlant(expr, 2, 2);
    uiPlant(expr, 3, 3);
    emit("call uiclip");
    return;
  }

void Generator::emitUiUnclip() {
    emit("place r1, 4");
    emit("itof r1, r1");
    uiZeroFrom(2);
    uiAccel(24);
    return;
  }

void Generator::emitUiShift(const Expr& expr) {
    const int srcY = uiKeep(expr, 0);
    const int dstY = uiKeep(expr, 1);
    const int high = uiKeep(expr, 2);
    const int wide = uiKeep(expr, 3);
    loadSlot(srcY, TypeKind::Long);
    emit("or r1, r0, r0");
    emit("itof r1, r1");
    loadSlot(dstY, TypeKind::Long);
    emit("or r2, r0, r0");
    emit("itof r2, r2");
    loadSlot(high, TypeKind::Long);
    emit("or r3, r0, r0");
    emit("itof r3, r3");
    loadSlot(wide, TypeKind::Long);
    emit("or r4, r0, r0");
    emit("itof r4, r4");
    uiAccel(43);
    uiDrop(4);
    return;
  }

void Generator::emitUiPresent() {
    emit("gpu.present");
    frameHeld_ = false;
    return;
  }

}  // namespace obr
