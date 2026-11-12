/* UiState.cpp —— UI 状态/输入域调用点收成：save/translate/restore/frame/key/enter/query/shadow/noshadow。 */

#include "Generator.hpp"
#include "UiLayout.hpp"

namespace obr {

void Generator::emitUiSave() {
    uiSave_ = true;
    emit("call uisave");
    return;
  }

void Generator::emitUiTranslate(const Expr& expr) {
    uiTranslate_ = true;
    uiPlant(expr, 0, 0);
    uiPlant(expr, 1, 1);
    emit("call uitranslate");
    return;
  }

void Generator::emitUiRestore() {
    uiRestore_ = true;
    emit("call uirestore");
    return;
  }

void Generator::emitUiFrame() {
    uiFrame_ = true;
    emit("call uiframe");
    return;
  }

void Generator::emitUiKey(const std::string& name) {
    uiKey_ = true;
    if (name == "obr::ui::enter") uiEnter_ = true;
    emit(name == "obr::ui::enter" ? "call uienter" : "call uikey");
    return;
  }

void Generator::emitUiQuery(const std::string& name) {
    emit("place r1, 3");
    emit("place r2, " + std::string(name == "obr::ui::width" ? "0" : "1"));
    emit("place r3, 0");
    emit("query r0, r1, r2, r3");
    return;
  }

void Generator::emitUiShadow(const Expr& expr) {
    uiShadow_ = true;
    const int count = uiKeep(expr, 2);
    const std::string low = fresh("e");
    const std::string high = fresh("e");
    loadSlot(count, TypeKind::Long);
    emit("or r1, r0, r0");
    emit("place r2, 1");
    emit("lt r0, r1, r2");
    emit("jz r0, " + low);
    uiFault();
    emit(low + ":");
    loadSlot(count, TypeKind::Long);
    emit("or r1, r0, r0");
    emit("place r2, 8");
    emit("gt r0, r1, r2");
    emit("jz r0, " + high);
    uiFault();
    emit(high + ":");
    uiDrop(1);
    for (int index = 0; index < 5; index += 1) {
      gen(expr.kids[static_cast<std::size_t>(index)]);
      emit("store.64 r0, " + std::to_string(uiAt(UiShade + index)));
    }
    return;
  }

void Generator::emitUiNoShadow() {
    emit("place r0, 0");
    emit("store.64 r0, " + std::to_string(uiAt(UiShade + 2)));
    return;
  }

}  // namespace obr
