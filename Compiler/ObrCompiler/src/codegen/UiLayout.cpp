/* UiLayout.cpp —— UI 布局域调用点收成：pad/span/alignStart/alignCenter/alignEnd/align/advance/textWidth/title/below/hit，
   整数布局与字宽计算收成寄存器运算。 */

#include "Generator.hpp"
#include "UiLayout.hpp"

namespace obr {

void Generator::emitUiPad(const Expr& expr) {
    const int edge = uiKeep(expr, 0);
    const int amount = uiKeep(expr, 1);
    loadSlot(edge, TypeKind::Long);
    emit("or r1, r0, r0");
    loadSlot(amount, TypeKind::Long);
    emit("or r2, r0, r0");
    emit("add r0, r1, r2");
    uiDrop(2);
    return;
  }

void Generator::emitUiSpan(const Expr& expr) {
    const int start = uiKeep(expr, 0);
    const int step = uiKeep(expr, 1);
    const int index = uiKeep(expr, 2);
    loadSlot(index, TypeKind::Long);
    emit("or r1, r0, r0");
    loadSlot(step, TypeKind::Long);
    emit("or r2, r0, r0");
    emit("mul r0, r1, r2");
    emit("or r1, r0, r0");
    loadSlot(start, TypeKind::Long);
    emit("or r2, r0, r0");
    emit("add r0, r2, r1");
    uiDrop(3);
    return;
  }

void Generator::emitUiAlignStart(const Expr& expr) {
    const int origin = uiKeep(expr, 0);
    gen(expr.kids[1]);
    gen(expr.kids[2]);
    loadSlot(origin, TypeKind::Long);
    uiDrop(1);
    return;
  }

void Generator::emitUiAlignEdge(const Expr& expr, const std::string& name) {
    const int origin = uiKeep(expr, 0);
    const int space = uiKeep(expr, 1);
    const int item = uiKeep(expr, 2);
    loadSlot(space, TypeKind::Long);
    emit("or r1, r0, r0");
    loadSlot(item, TypeKind::Long);
    emit("or r2, r0, r0");
    emit("sub r0, r1, r2");
    if (name == "obr::ui::alignCenter") {
      emit("or r1, r0, r0");
      emit("place r2, 2");
      emit("div r0, r1, r2");
    }
    emit("or r1, r0, r0");
    loadSlot(origin, TypeKind::Long);
    emit("or r2, r0, r0");
    emit("add r0, r2, r1");
    uiDrop(3);
    return;
  }

void Generator::emitUiAlign(const Expr& expr) {
    const int origin = uiKeep(expr, 0);
    const int space = uiKeep(expr, 1);
    const int item = uiKeep(expr, 2);
    const int mode = uiKeep(expr, 3);
    const std::string notNeg = fresh("e");
    const std::string notBig = fresh("e");
    const std::string notStart = fresh("e");
    const std::string notCenter = fresh("e");
    const std::string done = fresh("e");
    loadSlot(mode, TypeKind::Long);
    emit("or r1, r0, r0");
    emit("place r2, 0");
    emit("lt r0, r1, r2");
    emit("jz r0, " + notNeg);
    uiFault();
    emit(notNeg + ":");
    loadSlot(mode, TypeKind::Long);
    emit("or r1, r0, r0");
    emit("place r2, 2");
    emit("gt r0, r1, r2");
    emit("jz r0, " + notBig);
    uiFault();
    emit(notBig + ":");
    loadSlot(mode, TypeKind::Long);
    emit("or r1, r0, r0");
    emit("place r2, 0");
    emit("eq r0, r1, r2");
    emit("jz r0, " + notStart);
    loadSlot(origin, TypeKind::Long);
    emit("place r1, 1");
    emit("jnz r1, " + done);
    emit(notStart + ":");
    loadSlot(space, TypeKind::Long);
    emit("or r1, r0, r0");
    loadSlot(item, TypeKind::Long);
    emit("or r2, r0, r0");
    emit("sub r0, r1, r2");
    emit("or r3, r0, r0");
    loadSlot(mode, TypeKind::Long);
    emit("or r1, r0, r0");
    emit("place r2, 1");
    emit("eq r0, r1, r2");
    emit("jz r0, " + notCenter);
    emit("or r1, r3, r3");
    emit("place r2, 2");
    emit("div r0, r1, r2");
    emit("or r3, r0, r0");
    emit(notCenter + ":");
    emit("or r1, r3, r3");
    loadSlot(origin, TypeKind::Long);
    emit("or r2, r0, r0");
    emit("add r0, r2, r1");
    emit(done + ":");
    uiDrop(4);
    return;
  }

void Generator::emitUiAdvance(const Expr& expr) {
    const int size = uiKeep(expr, 0);
    uiLoadAdvance(size);
    uiDrop(1);
    return;
  }

void Generator::emitUiTextWidthTracked(const Expr& expr) {
    const int size = uiKeep(expr, 0);
    const int tracking = uiKeep(expr, 1);
    const int text = uiKeep(expr, 2);
    const std::string spaced = fresh("e");
    const std::string empty = fresh("e");
    const std::string done = fresh("e");
    uiLoadAdvance(size);
    const int advance = words_ + temp_;
    hold();
    storeSlot(advance, TypeKind::Long);
    emit("or r1, r0, r0");
    loadSlot(tracking, TypeKind::Long);
    emit("or r2, r0, r0");
    emit("add r0, r1, r2");
    emit("or r1, r0, r0");
    emit("place r2, 1");
    emit("lt r0, r1, r2");
    emit("jz r0, " + spaced);
    uiFault();
    emit(spaced + ":");
    loadSlot(text, TypeKind::Long);
    emit("ldi.64 r0, r0");
    emit("or r1, r0, r0");
    emit("place r2, 0");
    emit("eq r0, r1, r2");
    emit("jz r0, " + empty);
    emit("place r0, 0");
    emit("place r1, 1");
    emit("jnz r1, " + done);
    emit(empty + ":");
    emit("or r3, r1, r1");
    emit("place r2, 1");
    emit("sub r0, r3, r2");
    emit("or r1, r0, r0");
    loadSlot(tracking, TypeKind::Long);
    emit("or r2, r0, r0");
    emit("mul r0, r1, r2");
    emit("or r1, r0, r0");
    loadSlot(advance, TypeKind::Long);
    emit("or r2, r0, r0");
    emit("mul r0, r3, r2");
    emit("add r0, r0, r1");
    emit(done + ":");
    uiDrop(4);
    return;
  }

void Generator::emitUiTextWidth(const Expr& expr) {
    const int size = uiKeep(expr, 0);
    const int text = uiKeep(expr, 1);
    uiLoadAdvance(size);
    const int advance = words_ + temp_;
    hold();
    storeSlot(advance, TypeKind::Long);
    loadSlot(text, TypeKind::Long);
    emit("ldi.64 r0, r0");
    emit("or r1, r0, r0");
    loadSlot(advance, TypeKind::Long);
    emit("or r2, r0, r0");
    emit("mul r0, r2, r1");
    uiDrop(3);
    return;
  }

void Generator::emitUiTitleBelow(const Expr& expr, const std::string& name) {
    int topSlot = -1;
    if (name == "obr::ui::below") topSlot = uiKeep(expr, 0);
    const int size = uiKeep(expr, name == "obr::ui::title" ? 0 : 1);
    const std::string ready = fresh("e");
    loadSlot(size, TypeKind::Long);
    emit("or r1, r0, r0");
    emit("place r2, 1");
    emit("lt r0, r1, r2");
    emit("jz r0, " + ready);
    uiFault();
    emit(ready + ":");
    loadSlot(size, TypeKind::Long);
    emit("or r1, r0, r0");
    emit("place r2, 8");
    emit("add r0, r1, r2");
    if (name == "obr::ui::below") {
      emit("or r1, r0, r0");
      loadSlot(topSlot, TypeKind::Long);
      emit("or r2, r0, r0");
      emit("add r0, r2, r1");
      uiDrop(2);
    } else {
      uiDrop(1);
    }
    return;
  }

void Generator::emitUiHit(const Expr& expr) {
    const int x = uiKeep(expr, 0);
    const int y = uiKeep(expr, 1);
    const int left = uiKeep(expr, 2);
    const int top = uiKeep(expr, 3);
    const int width = uiKeep(expr, 4);
    const int height = uiKeep(expr, 5);
    const std::string miss = fresh("e");
    const std::string accept = fresh("e");
    loadSlot(width, TypeKind::Long);
    emit("or r1, r0, r0");
    emit("place r2, 1");
    emit("lt r0, r1, r2");
    emit("jnz r0, " + miss);
    loadSlot(height, TypeKind::Long);
    emit("or r1, r0, r0");
    emit("place r2, 1");
    emit("lt r0, r1, r2");
    emit("jnz r0, " + miss);
    loadSlot(x, TypeKind::Long);
    emit("or r1, r0, r0");
    loadSlot(left, TypeKind::Long);
    emit("or r2, r0, r0");
    emit("lt r0, r1, r2");
    emit("jnz r0, " + miss);
    loadSlot(y, TypeKind::Long);
    emit("or r1, r0, r0");
    loadSlot(top, TypeKind::Long);
    emit("or r2, r0, r0");
    emit("lt r0, r1, r2");
    emit("jnz r0, " + miss);
    loadSlot(left, TypeKind::Long);
    emit("or r1, r0, r0");
    loadSlot(width, TypeKind::Long);
    emit("or r2, r0, r0");
    emit("add r2, r1, r2");
    loadSlot(x, TypeKind::Long);
    emit("or r1, r0, r0");
    emit("lt r0, r1, r2");
    emit("jz r0, " + miss);
    loadSlot(top, TypeKind::Long);
    emit("or r1, r0, r0");
    loadSlot(height, TypeKind::Long);
    emit("or r2, r0, r0");
    emit("add r2, r1, r2");
    loadSlot(y, TypeKind::Long);
    emit("or r1, r0, r0");
    emit("lt r0, r1, r2");
    emit("jz r0, " + miss);
    emit("place r0, 1");
    emit("place r1, 1");
    emit("jnz r1, " + accept);
    emit(miss + ":");
    emit("place r0, 0");
    emit(accept + ":");
    uiDrop(6);
    return;
  }

}  // namespace obr
