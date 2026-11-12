/* UiRoutineState.cpp —— UI 状态/输入例程族发射：uiclip/uiclear/uikey/uienter/uisave/uitranslate/uirestore/uiframe/uifault。 */

#include "Generator.hpp"
#include "UiLayout.hpp"

namespace obr {

void Generator::emitUiRoutineClip() {
    emit("uiclip:");
    emit("place r1, 4");
    emit("itof r1, r1");
    uiZeroFrom(2);
    emit("place r0, 23");
    uiGpuAccel();
    emit("load.64 r0, " + uiCellText(UiArg + 0));
    emit("load.64 r1, " + uiCellText(UiOx));
    emit("add r0, r0, r1");
    emit("itof r1, r0");
    emit("load.64 r0, " + uiCellText(UiArg + 1));
    emit("load.64 r2, " + uiCellText(UiOy));
    emit("add r0, r0, r2");
    emit("itof r2, r0");
    emit("load.64 r0, " + uiCellText(UiArg + 2));
    emit("itof r3, r0");
    emit("load.64 r0, " + uiCellText(UiArg + 3));
    emit("itof r4, r0");
    emit("place r0, 2");
    uiGpuAccel();
    emit("ret");
  }

void Generator::emitUiRoutineClear() {
    emit("uiclear:");
    emit("store.64 r7, " + uiCellText(UiLinkClear));
    emit("load.64 r1, " + uiCellText(UiArg));
    emit("load.64 r2, " + uiCellText(UiArg + 1));
    emit("call uichan");
    emit("place r0, 3");
    uiGpuAccel();
    emit("place r1, 1");
    emit("itof r1, r1");
    uiZeroFrom(2);
    emit("place r0, 5");
    uiGpuAccel();
    emit("load.64 r7, " + uiCellText(UiLinkClear));
    emit("ret");
  }

void Generator::emitUiRoutineKey() {
    emit("uikey:");
    emit("load.64 r0, " + uiCellText(UiPrimed));
    emit("place r1, 0");
    emit("eq r0, r0, r1");
    emit("jz r0, ukready");
    emit("place r0, 1");
    emit("store.64 r0, " + uiCellText(UiPrimed));
    emit("place r0, -1");
    emit("store.64 r0, " + uiCellText(UiPort));
    emit("place r0, 0");
    emit("store.64 r0, " + uiCellText(UiTempI));
    emit("ukloop:");
    emit("load.64 r0, " + uiCellText(UiTempI));
    emit("place r1, 4");
    emit("lt r0, r0, r1");
    emit("jz r0, ukready");
    emit("load.64 r1, " + uiCellText(UiTempI));
    emit("port.state r0, r1");
    emit("place r1, 2");
    emit("eq r0, r0, r1");
    emit("jz r0, uknext");
    emit("load.64 r1, " + uiCellText(UiTempI));
    emit("place r2, 0");
    emit("port.char r0, r1, r2");
    emit("place r1, 90");
    emit("eq r0, r0, r1");
    emit("jz r0, uknext");
    emit("load.64 r1, " + uiCellText(UiTempI));
    emit("place r2, 1");
    emit("port.char r0, r1, r2");
    emit("place r1, 75");
    emit("eq r0, r0, r1");
    emit("jz r0, uknext");
    emit("load.64 r1, " + uiCellText(UiTempI));
    emit("place r2, 2");
    emit("port.char r0, r1, r2");
    emit("place r1, 80");
    emit("eq r0, r0, r1");
    emit("jz r0, uknext");
    emit("load.64 r1, " + uiCellText(UiTempI));
    emit("place r2, 3");
    emit("port.char r0, r1, r2");
    emit("place r1, 49");
    emit("eq r0, r0, r1");
    emit("jz r0, uknext");
    emit("load.64 r0, " + uiCellText(UiTempI));
    emit("store.64 r0, " + uiCellText(UiPort));
    emit("place r1, 1");
    emit("jnz r1, ukready");
    emit("uknext:");
    emit("load.64 r0, " + uiCellText(UiTempI));
    emit("place r1, 1");
    emit("add r0, r0, r1");
    emit("store.64 r0, " + uiCellText(UiTempI));
    emit("place r1, 1");
    emit("jnz r1, ukloop");
    emit("ukready:");
    emit("load.64 r0, " + uiCellText(UiPort));
    emit("place r1, 0");
    emit("lt r0, r0, r1");
    emit("jz r0, ukhave");
    emit("place r0, 0");
    emit("place r1, 1");
    emit("jnz r1, ukret");
    emit("ukhave:");
    emit("load.64 r1, " + uiCellText(UiPort));
    emit("place r2, 1");
    emit("place r3, 0");
    emit("xchg r1, r2, r3");
    emit("or r0, r3, r3");
    emit("store.64 r0, " + uiCellText(UiTempX));
    emit("load.64 r0, " + uiCellText(UiSeen));
    emit("place r1, 0");
    emit("eq r0, r0, r1");
    emit("jz r0, ukedge");
    emit("place r0, 1");
    emit("store.64 r0, " + uiCellText(UiSeen));
    emit("load.64 r0, " + uiCellText(UiTempX));
    emit("store.64 r0, " + uiCellText(UiCount));
    emit("place r0, 0");
    emit("place r1, 1");
    emit("jnz r1, ukret");
    emit("ukedge:");
    emit("load.64 r0, " + uiCellText(UiTempX));
    emit("load.64 r1, " + uiCellText(UiCount));
    emit("eq r0, r0, r1");
    emit("jz r0, uknew");
    emit("place r0, 0");
    emit("place r1, 1");
    emit("jnz r1, ukret");
    emit("uknew:");
    emit("load.64 r0, " + uiCellText(UiTempX));
    emit("store.64 r0, " + uiCellText(UiCount));
    emit("load.64 r1, " + uiCellText(UiPort));
    emit("place r2, 1");
    emit("place r3, 1");
    emit("xchg r1, r2, r3");
    emit("or r0, r3, r3");
    emit("place r1, 1");
    emit("eq r0, r0, r1");
    emit("jz r0, ukcode");
    emit("place r0, 0");
    emit("place r1, 1");
    emit("jnz r1, ukret");
    emit("ukcode:");
    emit("load.64 r1, " + uiCellText(UiPort));
    emit("place r2, 1");
    emit("place r3, 3");
    emit("xchg r1, r2, r3");
    emit("or r0, r3, r3");
    emit("ukret:");
    emit("ret");
  }

void Generator::emitUiRoutineEnter() {
    emit("uienter:");
    emit("store.64 r7, " + uiCellText(UiLinkEnter));
    emit("call uikey");
    emit("place r1, 114");
    emit("place r2, 32");
    emit("shl r1, r1, r2");
    emit("place r2, 101");
    emit("place r3, 24");
    emit("shl r2, r2, r3");
    emit("or r1, r1, r2");
    emit("place r2, 116");
    emit("place r3, 16");
    emit("shl r2, r2, r3");
    emit("or r1, r1, r2");
    emit("place r2, 110");
    emit("place r3, 8");
    emit("shl r2, r2, r3");
    emit("or r1, r1, r2");
    emit("place r2, 69");
    emit("or r1, r1, r2");
    emit("eq r0, r0, r1");
    emit("load.64 r7, " + uiCellText(UiLinkEnter));
    emit("ret");
  }

void Generator::emitUiRoutineSave() {
    emit("uisave:");
    emit("load.64 r0, " + uiCellText(UiDepth));
    emit("place r1, 32");
    emit("ge r0, r0, r1");
    emit("jnz r0, uifault");
    emit("load.64 r0, " + uiCellText(UiDepth));
    emit("place r1, 128");
    emit("mul r0, r0, r1");
    emit("place r1, " + uiCellText(UiStack));
    emit("add r5, r0, r1");
    emit("load.64 r0, " + uiCellText(UiOx));
    emit("sti.64 r0, r5");
    emit("place r1, 64");
    emit("add r5, r5, r1");
    emit("load.64 r0, " + uiCellText(UiOy));
    emit("sti.64 r0, r5");
    emit("load.64 r0, " + uiCellText(UiDepth));
    emit("place r1, 1");
    emit("add r0, r0, r1");
    emit("store.64 r0, " + uiCellText(UiDepth));
    emit("ret");
  }

void Generator::emitUiRoutineTranslate() {
    emit("uitranslate:");
    emit("load.64 r0, " + uiCellText(UiOx));
    emit("load.64 r1, " + uiCellText(UiArg));
    emit("add r0, r0, r1");
    emit("store.64 r0, " + uiCellText(UiOx));
    emit("load.64 r0, " + uiCellText(UiOy));
    emit("load.64 r1, " + uiCellText(UiArg + 1));
    emit("add r0, r0, r1");
    emit("store.64 r0, " + uiCellText(UiOy));
    emit("ret");
  }

void Generator::emitUiRoutineRestore() {
    emit("uirestore:");
    emit("load.64 r0, " + uiCellText(UiDepth));
    emit("place r1, 0");
    emit("eq r0, r0, r1");
    emit("jnz r0, uifault");
    emit("load.64 r0, " + uiCellText(UiDepth));
    emit("place r1, 1");
    emit("sub r0, r0, r1");
    emit("store.64 r0, " + uiCellText(UiDepth));
    emit("load.64 r0, " + uiCellText(UiDepth));
    emit("place r1, 128");
    emit("mul r0, r0, r1");
    emit("place r1, " + uiCellText(UiStack));
    emit("add r5, r0, r1");
    emit("ldi.64 r0, r5");
    emit("store.64 r0, " + uiCellText(UiOx));
    emit("place r1, 64");
    emit("add r5, r5, r1");
    emit("ldi.64 r0, r5");
    emit("store.64 r0, " + uiCellText(UiOy));
    emit("ret");
  }

void Generator::emitUiRoutineFrame() {
    emit("uiframe:");
    emit("load.64 r0, " + uiCellText(UiTick));
    emit("place r1, 1");
    emit("add r0, r0, r1");
    emit("store.64 r0, " + uiCellText(UiTick));
    emit("ret");
  }

void Generator::emitUiRoutineFault() {
    emit("uifault:");
    emit("place r1, 0");
    emit("div r0, r0, r1");
  }

}  // namespace obr
