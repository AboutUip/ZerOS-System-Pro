/* Ui.cpp —— UI 任务域的调度面：emitUi 按函数名把调用点分派到各域的收成方法，
   emitUiRoutines 按需求标志把运行时例程分派到例程族的发射方法。
   两个入口只做分派，不收成指令（收成在 UiUtil/UiLayout/UiValue/UiDraw/UiState/UiRoutine* 里）。 */

#include "Generator.hpp"
#include "UiLayout.hpp"

namespace obr {

void Generator::emitUi(const Expr& expr, const Function& target) {
  const std::string& name = target.name;
  if (name == "obr::ui::pad") {
    emitUiPad(expr);
    return;
  }
  if (name == "obr::ui::span") {
    emitUiSpan(expr);
    return;
  }
  if (name == "obr::ui::alignStart") {
    emitUiAlignStart(expr);
    return;
  }
  if (name == "obr::ui::alignCenter" || name == "obr::ui::alignEnd") {
    emitUiAlignEdge(expr, name);
    return;
  }
  if (name == "obr::ui::align") {
    emitUiAlign(expr);
    return;
  }
  if (name == "obr::ui::advance") {
    emitUiAdvance(expr);
    return;
  }
  if (name == "obr::ui::textWidth" && expr.kids.size() == 3) {
    emitUiTextWidthTracked(expr);
    return;
  }
  if (name == "obr::ui::textWidth") {
    emitUiTextWidth(expr);
    return;
  }
  if (name == "obr::ui::lerp") {
    emitUiLerp(expr);
    return;
  }
  if (name == "obr::ui::ease") {
    emitUiEase(expr);
    return;
  }
  if (name == "obr::ui::meter") {
    emitUiMeter(expr);
    return;
  }
  if (name == "obr::ui::rgb") {
    emitUiRgb(expr);
    return;
  }
  if (name == "obr::ui::clear") {
    emitUiClear(expr);
    return;
  }
  if (name == "obr::ui::rect" || name == "obr::ui::round" || name == "obr::ui::ellipse") {
    emitUiShape(expr, name);
    return;
  }
  if (name == "obr::ui::bar") {
    emitUiBar(expr);
    return;
  }
  if (name == "obr::ui::glyph") {
    emitUiGlyph(expr);
    return;
  }
  if (name == "obr::ui::text") {
    emitUiText(expr);
    return;
  }
  if (name == "obr::ui::clip") {
    emitUiClip(expr);
    return;
  }
  if (name == "obr::ui::unclip") {
    emitUiUnclip();
    return;
  }
  if (name == "obr::ui::shift") {
    emitUiShift(expr);
    return;
  }
  if (name == "obr::ui::present") {
    emitUiPresent();
    return;
  }
  if (name == "obr::ui::save") {
    emitUiSave();
    return;
  }
  if (name == "obr::ui::translate") {
    emitUiTranslate(expr);
    return;
  }
  if (name == "obr::ui::restore") {
    emitUiRestore();
    return;
  }
  if (name == "obr::ui::frame") {
    emitUiFrame();
    return;
  }
  if (name == "obr::ui::key" || name == "obr::ui::enter") {
    emitUiKey(name);
    return;
  }
  if (name == "obr::ui::width" || name == "obr::ui::height") {
    emitUiQuery(name);
    return;
  }
  if (name == "obr::ui::title" || name == "obr::ui::below") {
    emitUiTitleBelow(expr, name);
    return;
  }
  if (name == "obr::ui::hit") {
    emitUiHit(expr);
    return;
  }
  if (name == "obr::ui::shadow") {
    emitUiShadow(expr);
    return;
  }
  if (name == "obr::ui::noshadow") {
    emitUiNoShadow();
    return;
  }
  fail("没有这种界面函数 " + name);
}

void Generator::emitUiRoutines() {
  const bool chan = uiInk_ || uiClear_;
  const bool any = chan || uiBox_ || uiGlyph_ || uiText_ || uiClip_ || uiClear_ || uiKey_ || uiSave_ || uiTranslate_ || uiRestore_ || uiFrame_ || uiBar_ || uiMeter_;
  if (!any) return;
  if (chan) emitUiRoutineChan();
  if (uiInk_) emitUiRoutineInk();
  if (uiBox_) emitUiRoutineBox();
  if (uiMeter_) emitUiRoutineMeter();
  if (uiBar_) emitUiRoutineBar();
  if (uiGlyph_ && !uiShadow_) emitUiRoutineGlyphPlain();
  if (uiText_ && !uiShadow_) emitUiRoutineTextPlain();
  if (uiGlyph_ && uiShadow_) emitUiRoutineGlyphShadow();
  if (uiText_ && uiShadow_) emitUiRoutineTextShadow();
  if (uiClip_) emitUiRoutineClip();
  if (uiClear_) emitUiRoutineClear();
  if (uiKey_) emitUiRoutineKey();
  if (uiEnter_) emitUiRoutineEnter();
  if (uiSave_) emitUiRoutineSave();
  if (uiTranslate_) emitUiRoutineTranslate();
  if (uiRestore_) emitUiRoutineRestore();
  if (uiFrame_) emitUiRoutineFrame();
  if (uiText_ || uiSave_ || uiRestore_ || uiBar_ || uiMeter_) emitUiRoutineFault();
}

}  // namespace obr
