#include "Generator.hpp"

namespace obr {
namespace {

constexpr int UiArg = 9;
constexpr int UiOx = 17;
constexpr int UiOy = 18;
constexpr int UiDepth = 19;
constexpr int UiPrimed = 20;
constexpr int UiPort = 21;
constexpr int UiCount = 22;
constexpr int UiTick = 23;
constexpr int UiStack = 24;
constexpr int UiTempX = 88;
constexpr int UiTempI = 89;
constexpr int UiTempN = 90;
constexpr int UiTempS = 91;
constexpr int UiTempC = 92;
constexpr int UiSeen = 93;
constexpr int UiLinkInk = 0;
constexpr int UiLinkBox = 1;
constexpr int UiLinkGlyph = 2;
constexpr int UiLinkText = 3;
constexpr int UiLinkClear = 5;
constexpr int UiLinkEnter = 7;
constexpr int UiLinkBar = 4;
constexpr int UiLinkMeter = 8;
/* 94 到 104 是进度条。105 到 107 是填充宽度。108 到 112 是文字阴影，116 的位地址是 4611328，仍低于帧缓存。 */
constexpr int UiBar = 94;
constexpr int UiMeter = 105;
constexpr int UiShade = 108;
constexpr int UiPassX = 114;
constexpr int UiPassY = 115;
constexpr int UiLayer = 116;

}  // namespace

int Generator::uiAt(int index) const { return kUi + index * 64; }

void Generator::emitUi(const Expr& expr, const Function& target) {
  const std::string& name = target.name;
  auto keep = [&](std::size_t index) -> int {
    gen(expr.kids[index]);
    const int slot = words_ + temp_;
    hold();
    storeSlot(slot, TypeKind::Long);
    return slot;
  };
  auto drop = [&](int count) {
    for (int index = 0; index < count; index += 1) release();
  };
  auto accel = [&](int op) {
    emit("place r0, " + std::to_string(op));
    emit("gpu.accel r6, r0, r1, r2, r3, r4");
    emit("or r0, r6, r6");
    frameHeld_ = false;
  };
  auto zeroDoubles = [&](int from) {
    for (int reg = from; reg <= 4; reg += 1) {
      emit("place r" + std::to_string(reg) + ", 0");
      emit("itof r" + std::to_string(reg) + ", r" + std::to_string(reg));
    }
  };
  auto fault = [&]() {
    emit("place r1, 0");
    emit("div r0, r0, r1");
  };
  auto loadAdvance = [&](int sizeSlot) {
    const std::string half = fresh("e");
    const std::string done = fresh("e");
    loadSlot(sizeSlot, TypeKind::Long);
    emit("or r1, r0, r0");
    emit("place r2, 1");
    emit("lt r0, r1, r2");
    const std::string ready = fresh("e");
    emit("jz r0, " + ready);
    fault();
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
    emit(done + ":");
  };
  auto plant = [&](std::size_t kid, int arg) {
    gen(expr.kids[kid]);
    emit("store.64 r0, " + std::to_string(uiAt(UiArg + arg)));
  };
  auto plantImm = [&](int value, int arg) {
    emit("place r0, " + std::to_string(value));
    emit("store.64 r0, " + std::to_string(uiAt(UiArg + arg)));
  };

  if (name == "obr::ui::pad") {
    const int edge = keep(0);
    const int amount = keep(1);
    loadSlot(edge, TypeKind::Long);
    emit("or r1, r0, r0");
    loadSlot(amount, TypeKind::Long);
    emit("or r2, r0, r0");
    emit("add r0, r1, r2");
    drop(2);
    return;
  }
  if (name == "obr::ui::span") {
    const int start = keep(0);
    const int step = keep(1);
    const int index = keep(2);
    loadSlot(index, TypeKind::Long);
    emit("or r1, r0, r0");
    loadSlot(step, TypeKind::Long);
    emit("or r2, r0, r0");
    emit("mul r0, r1, r2");
    emit("or r1, r0, r0");
    loadSlot(start, TypeKind::Long);
    emit("or r2, r0, r0");
    emit("add r0, r2, r1");
    drop(3);
    return;
  }
  if (name == "obr::ui::alignStart") {
    const int origin = keep(0);
    gen(expr.kids[1]);
    gen(expr.kids[2]);
    loadSlot(origin, TypeKind::Long);
    drop(1);
    return;
  }
  if (name == "obr::ui::alignCenter" || name == "obr::ui::alignEnd") {
    const int origin = keep(0);
    const int space = keep(1);
    const int item = keep(2);
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
    drop(3);
    return;
  }
  if (name == "obr::ui::align") {
    const int origin = keep(0);
    const int space = keep(1);
    const int item = keep(2);
    const int mode = keep(3);
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
    fault();
    emit(notNeg + ":");
    loadSlot(mode, TypeKind::Long);
    emit("or r1, r0, r0");
    emit("place r2, 2");
    emit("gt r0, r1, r2");
    emit("jz r0, " + notBig);
    fault();
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
    drop(4);
    return;
  }
  if (name == "obr::ui::advance") {
    const int size = keep(0);
    loadAdvance(size);
    drop(1);
    return;
  }
  if (name == "obr::ui::textWidth" && expr.kids.size() == 3) {
    const int size = keep(0);
    const int tracking = keep(1);
    const int text = keep(2);
    const std::string spaced = fresh("e");
    const std::string empty = fresh("e");
    const std::string done = fresh("e");
    loadAdvance(size);
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
    fault();
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
    drop(4);
    return;
  }
  if (name == "obr::ui::textWidth") {
    const int size = keep(0);
    const int text = keep(1);
    loadAdvance(size);
    const int advance = words_ + temp_;
    hold();
    storeSlot(advance, TypeKind::Long);
    loadSlot(text, TypeKind::Long);
    emit("ldi.64 r0, r0");
    emit("or r1, r0, r0");
    loadSlot(advance, TypeKind::Long);
    emit("or r2, r0, r0");
    emit("mul r0, r2, r1");
    drop(3);
    return;
  }
  if (name == "obr::ui::lerp") {
    const int from = keep(0);
    const int to = keep(1);
    const int numer = keep(2);
    const int denom = keep(3);
    const std::string live = fresh("e");
    const std::string upper = fresh("e");
    const std::string done = fresh("e");
    loadSlot(denom, TypeKind::Long);
    emit("or r1, r0, r0");
    emit("place r2, 0");
    emit("eq r0, r1, r2");
    emit("jz r0, " + live);
    fault();
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
    drop(4);
    return;
  }
  if (name == "obr::ui::ease") {
    const int from = keep(0);
    const int to = keep(1);
    const int numer = keep(2);
    const int denom = keep(3);
    const std::string live = fresh("e");
    const std::string upper = fresh("e");
    const std::string done = fresh("e");
    loadSlot(denom, TypeKind::Long);
    emit("or r1, r0, r0");
    emit("place r2, 0");
    emit("eq r0, r1, r2");
    emit("jz r0, " + live);
    fault();
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
    drop(4);
    return;
  }
  if (name == "obr::ui::meter") {
    uiMeter_ = true;
    for (int index = 0; index < 3; index += 1) {
      gen(expr.kids[static_cast<std::size_t>(index)]);
      emit("store.64 r0, " + std::to_string(uiAt(UiMeter + index)));
    }
    emit("call uimeter");
    return;
  }
  if (name == "obr::ui::rgb") {
    const int red = keep(0);
    const int green = keep(1);
    const int blue = keep(2);
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
    drop(3);
    return;
  }
  if (name == "obr::ui::clear") {
    uiClear_ = true;
    plant(0, 0);
    plant(1, 1);
    emit("call uiclear");
    return;
  }
  if (name == "obr::ui::rect" || name == "obr::ui::round" || name == "obr::ui::ellipse") {
    uiBox_ = true;
    uiInk_ = true;
    plant(0, 0);
    plant(1, 1);
    plant(2, 2);
    plant(3, 3);
    if (name == "obr::ui::round") {
      plant(5, 4);
      plant(6, 5);
      plantImm(36, 6);
      plant(4, 7);
    } else if (name == "obr::ui::ellipse") {
      plant(4, 4);
      plant(5, 5);
      plantImm(37, 6);
      plantImm(0, 7);
    } else {
      plant(4, 4);
      plant(5, 5);
      plantImm(33, 6);
      plantImm(0, 7);
    }
    emit("call uibox");
    return;
  }
  if (name == "obr::ui::bar") {
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
  if (name == "obr::ui::glyph") {
    uiGlyph_ = true;
    uiInk_ = true;
    plant(0, 0);
    plant(1, 1);
    plant(2, 2);
    plant(3, 3);
    plant(4, 4);
    plant(5, 5);
    emit("call uiglyph");
    return;
  }
  if (name == "obr::ui::text") {
    uiText_ = true;
    uiInk_ = true;
    plant(0, 0);
    plant(1, 1);
    plant(2, 2);
    if (expr.kids.size() == 7) {
      plant(3, 3);
      plant(4, 4);
      plant(5, 5);
      plant(6, 6);
    } else {
      plantImm(0, 3);
      plant(3, 4);
      plant(4, 5);
      plant(5, 6);
    }
    emit("call uitext");
    return;
  }
  if (name == "obr::ui::clip") {
    uiClip_ = true;
    plant(0, 0);
    plant(1, 1);
    plant(2, 2);
    plant(3, 3);
    emit("call uiclip");
    return;
  }
  if (name == "obr::ui::unclip") {
    emit("place r1, 4");
    emit("itof r1, r1");
    zeroDoubles(2);
    accel(24);
    return;
  }
  if (name == "obr::ui::present") {
    emit("gpu.present");
    frameHeld_ = false;
    return;
  }
  if (name == "obr::ui::save") {
    uiSave_ = true;
    emit("call uisave");
    return;
  }
  if (name == "obr::ui::translate") {
    uiTranslate_ = true;
    plant(0, 0);
    plant(1, 1);
    emit("call uitranslate");
    return;
  }
  if (name == "obr::ui::restore") {
    uiRestore_ = true;
    emit("call uirestore");
    return;
  }
  if (name == "obr::ui::frame") {
    uiFrame_ = true;
    emit("call uiframe");
    return;
  }
  if (name == "obr::ui::key" || name == "obr::ui::enter") {
    uiKey_ = true;
    if (name == "obr::ui::enter") uiEnter_ = true;
    emit(name == "obr::ui::enter" ? "call uienter" : "call uikey");
    return;
  }
  if (name == "obr::ui::width" || name == "obr::ui::height") {
    emit("place r1, " + std::string(name == "obr::ui::width" ? "0" : "1"));
    emit("itof r1, r1");
    zeroDoubles(2);
    accel(38);
    return;
  }
  if (name == "obr::ui::shadow") {
    uiShadow_ = true;
    const int count = keep(2);
    const std::string low = fresh("e");
    const std::string high = fresh("e");
    loadSlot(count, TypeKind::Long);
    emit("or r1, r0, r0");
    emit("place r2, 1");
    emit("lt r0, r1, r2");
    emit("jz r0, " + low);
    fault();
    emit(low + ":");
    loadSlot(count, TypeKind::Long);
    emit("or r1, r0, r0");
    emit("place r2, 8");
    emit("gt r0, r1, r2");
    emit("jz r0, " + high);
    fault();
    emit(high + ":");
    drop(1);
    for (int index = 0; index < 5; index += 1) {
      gen(expr.kids[static_cast<std::size_t>(index)]);
      emit("store.64 r0, " + std::to_string(uiAt(UiShade + index)));
    }
    return;
  }
  if (name == "obr::ui::noshadow") {
    emit("place r0, 0");
    emit("store.64 r0, " + std::to_string(uiAt(UiShade + 2)));
    return;
  }
  fail("没有这种界面函数 " + name);
}

void Generator::emitUiRoutines() {
  const bool chan = uiInk_ || uiClear_;
  const bool any = chan || uiBox_ || uiGlyph_ || uiText_ || uiClip_ || uiClear_ || uiKey_ || uiSave_ || uiTranslate_ || uiRestore_ || uiFrame_ || uiBar_ || uiMeter_;
  if (!any) return;
  auto at = [&](int index) { return std::to_string(uiAt(index)); };
  auto channel = [&](int mode) {
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
  };
  auto zeroFrom = [&](int from) {
    for (int reg = from; reg <= 4; reg += 1) {
      emit("place r" + std::to_string(reg) + ", 0");
      emit("itof r" + std::to_string(reg) + ", r" + std::to_string(reg));
    }
  };
  auto accel = [&]() { emit("gpu.accel r6, r0, r1, r2, r3, r4"); };
  if (chan) {
    emit("uichan:");
    emit("or r6, r1, r1");
    emit("or r3, r2, r2");
    channel(0);
    emit("or r1, r0, r0");
    channel(1);
    emit("or r2, r0, r0");
    channel(2);
    emit("or r4, r0, r0");
    emit("itof r0, r3");
    emit("place r5, " + floatBits(255));
    emit("fdiv r0, r0, r5");
    emit("or r3, r4, r4");
    emit("or r4, r0, r0");
    emit("ret");
  }
  if (uiInk_) {
    emit("uiink:");
    emit("store.64 r7, " + at(UiLinkInk));
    emit("call uichan");
    emit("place r0, 6");
    accel();
    emit("load.64 r7, " + at(UiLinkInk));
    emit("ret");
  }
  if (uiBox_) {
    emit("uibox:");
    emit("store.64 r7, " + at(UiLinkBox));
    emit("load.64 r1, " + at(UiArg + 4));
    emit("load.64 r2, " + at(UiArg + 5));
    emit("call uiink");
    emit("load.64 r0, " + at(UiArg + 6));
    emit("place r1, 36");
    emit("eq r0, r0, r1");
    emit("jz r0, uboxs");
    emit("load.64 r0, " + at(UiArg + 7));
    emit("itof r1, r0");
    zeroFrom(2);
    emit("place r0, 35");
    accel();
    emit("uboxs:");
    emit("load.64 r0, " + at(UiArg + 0));
    emit("load.64 r1, " + at(UiOx));
    emit("add r0, r0, r1");
    emit("itof r1, r0");
    emit("load.64 r0, " + at(UiArg + 1));
    emit("load.64 r2, " + at(UiOy));
    emit("add r0, r0, r2");
    emit("itof r2, r0");
    emit("load.64 r0, " + at(UiArg + 2));
    emit("itof r3, r0");
    emit("load.64 r0, " + at(UiArg + 3));
    emit("itof r4, r0");
    emit("load.64 r0, " + at(UiArg + 6));
    accel();
    emit("load.64 r7, " + at(UiLinkBox));
    emit("ret");
  }
  if (uiMeter_) {
    emit("uimeter:");
    emit("store.64 r7, " + at(UiLinkMeter));
    emit("load.64 r0, " + at(UiMeter + 0));
    emit("or r1, r0, r0");
    emit("place r2, 0");
    emit("lt r0, r1, r2");
    emit("jnz r0, uifault");
    emit("load.64 r0, " + at(UiMeter + 2));
    emit("or r1, r0, r0");
    emit("place r2, 1");
    emit("lt r0, r1, r2");
    emit("jnz r0, uifault");
    emit("load.64 r0, " + at(UiMeter + 1));
    emit("or r1, r0, r0");
    emit("place r2, 0");
    emit("le r0, r1, r2");
    emit("jz r0, umhi");
    emit("place r0, 0");
    emit("place r1, 1");
    emit("jnz r1, umdone");
    emit("umhi:");
    emit("load.64 r0, " + at(UiMeter + 1));
    emit("or r1, r0, r0");
    emit("load.64 r0, " + at(UiMeter + 2));
    emit("or r2, r0, r0");
    emit("ge r0, r1, r2");
    emit("jz r0, ummid");
    emit("load.64 r0, " + at(UiMeter + 0));
    emit("place r1, 1");
    emit("jnz r1, umdone");
    emit("ummid:");
    emit("load.64 r0, " + at(UiMeter + 0));
    emit("or r1, r0, r0");
    emit("load.64 r0, " + at(UiMeter + 1));
    emit("or r2, r0, r0");
    emit("mul r0, r1, r2");
    emit("or r1, r0, r0");
    emit("load.64 r0, " + at(UiMeter + 2));
    emit("or r2, r0, r0");
    emit("div r0, r1, r2");
    emit("umdone:");
    emit("load.64 r7, " + at(UiLinkMeter));
    emit("ret");
  }
  if (uiBar_) {
    auto reject = [&](int slot, int limit) {
      emit("load.64 r0, " + at(slot));
      emit("or r1, r0, r0");
      emit("place r2, " + std::to_string(limit));
      emit("lt r0, r1, r2");
      emit("jnz r0, uifault");
    };
    auto paint = [&](int widthSlot, int colorSlot) {
      emit("load.64 r0, " + at(UiBar + 0));
      emit("store.64 r0, " + at(UiArg + 0));
      emit("load.64 r0, " + at(UiBar + 1));
      emit("store.64 r0, " + at(UiArg + 1));
      emit("load.64 r0, " + at(widthSlot));
      emit("store.64 r0, " + at(UiArg + 2));
      emit("load.64 r0, " + at(UiBar + 3));
      emit("store.64 r0, " + at(UiArg + 3));
      emit("load.64 r0, " + at(colorSlot));
      emit("store.64 r0, " + at(UiArg + 4));
      emit("load.64 r0, " + at(UiBar + 9));
      emit("store.64 r0, " + at(UiArg + 5));
      emit("place r0, 36");
      emit("store.64 r0, " + at(UiArg + 6));
      emit("load.64 r0, " + at(UiBar + 4));
      emit("store.64 r0, " + at(UiArg + 7));
      emit("call uibox");
    };
    emit("uibar:");
    emit("store.64 r7, " + at(UiLinkBar));
    reject(UiBar + 2, 0);
    reject(UiBar + 3, 0);
    reject(UiBar + 4, 0);
    emit("load.64 r0, " + at(UiBar + 2));
    emit("store.64 r0, " + at(UiMeter + 0));
    emit("load.64 r0, " + at(UiBar + 5));
    emit("store.64 r0, " + at(UiMeter + 1));
    emit("load.64 r0, " + at(UiBar + 6));
    emit("store.64 r0, " + at(UiMeter + 2));
    emit("call uimeter");
    emit("store.64 r0, " + at(UiBar + 10));
    paint(UiBar + 2, UiBar + 7);
    emit("load.64 r0, " + at(UiBar + 10));
    emit("or r1, r0, r0");
    emit("place r2, 0");
    emit("eq r0, r1, r2");
    emit("jnz r0, ubdone");
    paint(UiBar + 10, UiBar + 8);
    emit("ubdone:");
    emit("load.64 r7, " + at(UiLinkBar));
    emit("ret");
  }
  if (uiGlyph_ && !uiShadow_) {
    emit("uiglyph:");
    emit("store.64 r7, " + at(UiLinkGlyph));
    emit("load.64 r1, " + at(UiArg + 4));
    emit("load.64 r2, " + at(UiArg + 5));
    emit("call uiink");
    emit("load.64 r0, " + at(UiArg + 1));
    emit("load.64 r1, " + at(UiOx));
    emit("add r0, r0, r1");
    emit("itof r2, r0");
    emit("load.64 r0, " + at(UiArg + 2));
    emit("load.64 r1, " + at(UiOy));
    emit("add r0, r0, r1");
    emit("itof r3, r0");
    emit("load.64 r0, " + at(UiArg + 3));
    emit("itof r4, r0");
    emit("load.64 r0, " + at(UiArg + 0));
    emit("itof r0, r0");
    emit("or r1, r0, r0");
    emit("place r0, 34");
    accel();
    emit("load.64 r7, " + at(UiLinkGlyph));
    emit("ret");
  }
  if (uiText_ && !uiShadow_) {
    emit("uitext:");
    emit("store.64 r7, " + at(UiLinkText));
    emit("load.64 r1, " + at(UiArg + 5));
    emit("load.64 r2, " + at(UiArg + 6));
    emit("call uiink");
    emit("load.64 r7, " + at(UiLinkText));
    emit("load.64 r0, " + at(UiArg + 2));
    emit("place r1, 1");
    emit("lt r2, r0, r1");
    emit("jnz r2, uifault");
    emit("place r1, 2");
    emit("lt r2, r0, r1");
    emit("jz r2, txhalf");
    emit("place r0, 1");
    emit("place r1, 1");
    emit("jnz r1, txadv");
    emit("txhalf:");
    emit("load.64 r0, " + at(UiArg + 2));
    emit("place r1, 2");
    emit("div r0, r0, r1");
    emit("txadv:");
    emit("load.64 r1, " + at(UiArg + 3));
    emit("add r0, r0, r1");
    emit("place r1, 1");
    emit("lt r2, r0, r1");
    emit("jnz r2, uifault");
    emit("store.64 r0, " + at(UiTempS));
    emit("load.64 r0, " + at(UiArg + 4));
    emit("ldi.64 r0, r0");
    emit("store.64 r0, " + at(UiTempN));
    emit("place r0, 0");
    emit("store.64 r0, " + at(UiTempI));
    emit("load.64 r0, " + at(UiArg + 0));
    emit("store.64 r0, " + at(UiTempX));
    emit("txhead:");
    emit("load.64 r0, " + at(UiTempI));
    emit("load.64 r1, " + at(UiTempN));
    emit("lt r0, r0, r1");
    emit("jz r0, txdone");
    emit("load.64 r0, " + at(UiTempI));
    emit("place r1, 8");
    emit("mul r0, r0, r1");
    emit("place r1, 64");
    emit("add r0, r0, r1");
    emit("load.64 r1, " + at(UiArg + 4));
    emit("add r5, r1, r0");
    emit("ldi.octet r0, r5");
    emit("store.64 r0, " + at(UiTempC));
    emit("load.64 r0, " + at(UiTempX));
    emit("load.64 r1, " + at(UiOx));
    emit("add r0, r0, r1");
    emit("itof r2, r0");
    emit("load.64 r0, " + at(UiArg + 1));
    emit("load.64 r1, " + at(UiOy));
    emit("add r0, r0, r1");
    emit("itof r3, r0");
    emit("load.64 r0, " + at(UiArg + 2));
    emit("itof r4, r0");
    emit("load.64 r0, " + at(UiTempC));
    emit("itof r0, r0");
    emit("or r1, r0, r0");
    emit("place r0, 34");
    accel();
    emit("load.64 r0, " + at(UiTempX));
    emit("load.64 r1, " + at(UiTempS));
    emit("add r0, r0, r1");
    emit("store.64 r0, " + at(UiTempX));
    emit("load.64 r0, " + at(UiTempI));
    emit("place r1, 1");
    emit("add r0, r0, r1");
    emit("store.64 r0, " + at(UiTempI));
    emit("place r1, 1");
    emit("jnz r1, txhead");
    emit("txdone:");
    emit("ret");
  }
  if (uiGlyph_ && uiShadow_) {
    emit("uiglyph:");
    emit("store.64 r7, " + at(UiLinkGlyph));
    emit("load.64 r0, " + at(UiShade + 2));
    emit("or r1, r0, r0");
    emit("place r2, 0");
    emit("eq r0, r1, r2");
    emit("jnz r0, ugsolid");
    emit("load.64 r0, " + at(UiShade + 2));
    emit("store.64 r0, " + at(UiLayer));
    emit("uglayer:");
    emit("load.64 r0, " + at(UiLayer));
    emit("or r1, r0, r0");
    emit("place r2, 0");
    emit("eq r0, r1, r2");
    emit("jnz r0, ugsolid");
    emit("load.64 r0, " + at(UiShade + 2));
    emit("or r1, r0, r0");
    emit("load.64 r0, " + at(UiLayer));
    emit("or r2, r0, r0");
    emit("sub r0, r1, r2");
    emit("place r1, 1");
    emit("add r0, r0, r1");
    emit("or r3, r0, r0");
    emit("load.64 r0, " + at(UiShade + 4));
    emit("or r1, r0, r0");
    emit("or r2, r3, r3");
    emit("mul r0, r1, r2");
    emit("or r1, r0, r0");
    emit("load.64 r0, " + at(UiShade + 2));
    emit("or r2, r0, r0");
    emit("div r0, r1, r2");
    emit("or r2, r0, r0");
    emit("load.64 r0, " + at(UiShade + 3));
    emit("or r1, r0, r0");
    emit("call uiink");
    emit("load.64 r0, " + at(UiArg + 1));
    emit("load.64 r1, " + at(UiOx));
    emit("add r0, r0, r1");
    emit("or r6, r0, r0");
    emit("load.64 r0, " + at(UiLayer));
    emit("or r1, r0, r0");
    emit("load.64 r0, " + at(UiShade));
    emit("or r2, r0, r0");
    emit("mul r0, r1, r2");
    emit("or r1, r0, r0");
    emit("or r2, r6, r6");
    emit("add r0, r2, r1");
    emit("itof r2, r0");
    emit("load.64 r0, " + at(UiArg + 2));
    emit("load.64 r1, " + at(UiOy));
    emit("add r0, r0, r1");
    emit("or r6, r0, r0");
    emit("load.64 r0, " + at(UiLayer));
    emit("or r1, r0, r0");
    emit("load.64 r0, " + at(UiShade + 1));
    emit("or r2, r0, r0");
    emit("mul r0, r1, r2");
    emit("or r1, r0, r0");
    emit("or r2, r6, r6");
    emit("add r0, r2, r1");
    emit("itof r3, r0");
    emit("load.64 r0, " + at(UiArg + 3));
    emit("itof r4, r0");
    emit("load.64 r0, " + at(UiArg));
    emit("itof r0, r0");
    emit("or r1, r0, r0");
    emit("place r0, 34");
    accel();
    emit("load.64 r0, " + at(UiLayer));
    emit("or r1, r0, r0");
    emit("place r2, 1");
    emit("sub r0, r1, r2");
    emit("store.64 r0, " + at(UiLayer));
    emit("place r1, 1");
    emit("jnz r1, uglayer");
    emit("ugsolid:");
    emit("load.64 r1, " + at(UiArg + 4));
    emit("load.64 r2, " + at(UiArg + 5));
    emit("call uiink");
    emit("load.64 r0, " + at(UiArg + 1));
    emit("load.64 r1, " + at(UiOx));
    emit("add r0, r0, r1");
    emit("itof r2, r0");
    emit("load.64 r0, " + at(UiArg + 2));
    emit("load.64 r1, " + at(UiOy));
    emit("add r0, r0, r1");
    emit("itof r3, r0");
    emit("load.64 r0, " + at(UiArg + 3));
    emit("itof r4, r0");
    emit("load.64 r0, " + at(UiArg));
    emit("itof r0, r0");
    emit("or r1, r0, r0");
    emit("place r0, 34");
    accel();
    emit("load.64 r7, " + at(UiLinkGlyph));
    emit("ret");
  }
  if (uiText_ && uiShadow_) {
    emit("uipass:");
    emit("place r0, 0");
    emit("store.64 r0, " + at(UiTempI));
    emit("load.64 r0, " + at(UiArg));
    emit("load.64 r1, " + at(UiPassX));
    emit("add r0, r0, r1");
    emit("store.64 r0, " + at(UiTempX));
    emit("uphead:");
    emit("load.64 r0, " + at(UiTempI));
    emit("load.64 r1, " + at(UiTempN));
    emit("lt r0, r0, r1");
    emit("jz r0, updone");
    emit("load.64 r0, " + at(UiTempI));
    emit("place r1, 8");
    emit("mul r0, r0, r1");
    emit("place r1, 64");
    emit("add r0, r0, r1");
    emit("load.64 r1, " + at(UiArg + 4));
    emit("add r5, r1, r0");
    emit("ldi.octet r0, r5");
    emit("store.64 r0, " + at(UiTempC));
    emit("load.64 r0, " + at(UiTempX));
    emit("load.64 r1, " + at(UiOx));
    emit("add r0, r0, r1");
    emit("itof r2, r0");
    emit("load.64 r0, " + at(UiArg + 1));
    emit("load.64 r1, " + at(UiOy));
    emit("add r0, r0, r1");
    emit("load.64 r1, " + at(UiPassY));
    emit("add r0, r0, r1");
    emit("itof r3, r0");
    emit("load.64 r0, " + at(UiArg + 2));
    emit("itof r4, r0");
    emit("load.64 r0, " + at(UiTempC));
    emit("itof r0, r0");
    emit("or r1, r0, r0");
    emit("place r0, 34");
    accel();
    emit("load.64 r0, " + at(UiTempX));
    emit("load.64 r1, " + at(UiTempS));
    emit("add r0, r0, r1");
    emit("store.64 r0, " + at(UiTempX));
    emit("load.64 r0, " + at(UiTempI));
    emit("place r1, 1");
    emit("add r0, r0, r1");
    emit("store.64 r0, " + at(UiTempI));
    emit("place r1, 1");
    emit("jnz r1, uphead");
    emit("updone:");
    emit("ret");
    emit("uitext:");
    emit("store.64 r7, " + at(UiLinkText));
    emit("load.64 r0, " + at(UiArg + 2));
    emit("place r1, 1");
    emit("lt r2, r0, r1");
    emit("jnz r2, uifault");
    emit("place r1, 2");
    emit("lt r2, r0, r1");
    emit("jz r2, txhalf");
    emit("place r0, 1");
    emit("place r1, 1");
    emit("jnz r1, txadv");
    emit("txhalf:");
    emit("load.64 r0, " + at(UiArg + 2));
    emit("place r1, 2");
    emit("div r0, r0, r1");
    emit("txadv:");
    emit("load.64 r1, " + at(UiArg + 3));
    emit("add r0, r0, r1");
    emit("place r1, 1");
    emit("lt r2, r0, r1");
    emit("jnz r2, uifault");
    emit("store.64 r0, " + at(UiTempS));
    emit("load.64 r0, " + at(UiArg + 4));
    emit("ldi.64 r0, r0");
    emit("store.64 r0, " + at(UiTempN));
    emit("load.64 r0, " + at(UiShade + 2));
    emit("or r1, r0, r0");
    emit("place r2, 0");
    emit("eq r0, r1, r2");
    emit("jnz r0, txsolid");
    emit("load.64 r0, " + at(UiShade + 2));
    emit("store.64 r0, " + at(UiLayer));
    emit("txlayer:");
    emit("load.64 r0, " + at(UiLayer));
    emit("or r1, r0, r0");
    emit("place r2, 0");
    emit("eq r0, r1, r2");
    emit("jnz r0, txsolid");
    emit("load.64 r0, " + at(UiShade + 2));
    emit("or r1, r0, r0");
    emit("load.64 r0, " + at(UiLayer));
    emit("or r2, r0, r0");
    emit("sub r0, r1, r2");
    emit("place r1, 1");
    emit("add r0, r0, r1");
    emit("or r3, r0, r0");
    emit("load.64 r0, " + at(UiShade + 4));
    emit("or r1, r0, r0");
    emit("or r2, r3, r3");
    emit("mul r0, r1, r2");
    emit("or r1, r0, r0");
    emit("load.64 r0, " + at(UiShade + 2));
    emit("or r2, r0, r0");
    emit("div r0, r1, r2");
    emit("or r2, r0, r0");
    emit("load.64 r0, " + at(UiShade + 3));
    emit("or r1, r0, r0");
    emit("call uiink");
    emit("load.64 r0, " + at(UiLayer));
    emit("or r1, r0, r0");
    emit("load.64 r0, " + at(UiShade));
    emit("or r2, r0, r0");
    emit("mul r0, r1, r2");
    emit("store.64 r0, " + at(UiPassX));
    emit("load.64 r0, " + at(UiLayer));
    emit("or r1, r0, r0");
    emit("load.64 r0, " + at(UiShade + 1));
    emit("or r2, r0, r0");
    emit("mul r0, r1, r2");
    emit("store.64 r0, " + at(UiPassY));
    emit("call uipass");
    emit("load.64 r0, " + at(UiLayer));
    emit("or r1, r0, r0");
    emit("place r2, 1");
    emit("sub r0, r1, r2");
    emit("store.64 r0, " + at(UiLayer));
    emit("place r1, 1");
    emit("jnz r1, txlayer");
    emit("txsolid:");
    emit("load.64 r1, " + at(UiArg + 5));
    emit("load.64 r2, " + at(UiArg + 6));
    emit("call uiink");
    emit("place r0, 0");
    emit("store.64 r0, " + at(UiPassX));
    emit("place r0, 0");
    emit("store.64 r0, " + at(UiPassY));
    emit("call uipass");
    emit("load.64 r7, " + at(UiLinkText));
    emit("ret");
  }
  if (uiClip_) {
    emit("uiclip:");
    emit("place r1, 4");
    emit("itof r1, r1");
    zeroFrom(2);
    emit("place r0, 23");
    accel();
    emit("load.64 r0, " + at(UiArg + 0));
    emit("load.64 r1, " + at(UiOx));
    emit("add r0, r0, r1");
    emit("itof r1, r0");
    emit("load.64 r0, " + at(UiArg + 1));
    emit("load.64 r2, " + at(UiOy));
    emit("add r0, r0, r2");
    emit("itof r2, r0");
    emit("load.64 r0, " + at(UiArg + 2));
    emit("itof r3, r0");
    emit("load.64 r0, " + at(UiArg + 3));
    emit("itof r4, r0");
    emit("place r0, 2");
    accel();
    emit("ret");
  }
  if (uiClear_) {
    emit("uiclear:");
    emit("store.64 r7, " + at(UiLinkClear));
    emit("load.64 r1, " + at(UiArg));
    emit("load.64 r2, " + at(UiArg + 1));
    emit("call uichan");
    emit("place r0, 3");
    accel();
    emit("place r1, 1");
    emit("itof r1, r1");
    zeroFrom(2);
    emit("place r0, 5");
    accel();
    emit("load.64 r7, " + at(UiLinkClear));
    emit("ret");
  }
  if (uiKey_) {
    emit("uikey:");
    emit("load.64 r0, " + at(UiPrimed));
    emit("place r1, 0");
    emit("eq r0, r0, r1");
    emit("jz r0, ukready");
    emit("place r0, 1");
    emit("store.64 r0, " + at(UiPrimed));
    emit("place r0, -1");
    emit("store.64 r0, " + at(UiPort));
    emit("place r0, 0");
    emit("store.64 r0, " + at(UiTempI));
    emit("ukloop:");
    emit("load.64 r0, " + at(UiTempI));
    emit("place r1, 4");
    emit("lt r0, r0, r1");
    emit("jz r0, ukready");
    emit("load.64 r1, " + at(UiTempI));
    emit("port.state r0, r1");
    emit("place r1, 2");
    emit("eq r0, r0, r1");
    emit("jz r0, uknext");
    emit("load.64 r1, " + at(UiTempI));
    emit("place r2, 0");
    emit("port.char r0, r1, r2");
    emit("place r1, 90");
    emit("eq r0, r0, r1");
    emit("jz r0, uknext");
    emit("load.64 r1, " + at(UiTempI));
    emit("place r2, 1");
    emit("port.char r0, r1, r2");
    emit("place r1, 75");
    emit("eq r0, r0, r1");
    emit("jz r0, uknext");
    emit("load.64 r1, " + at(UiTempI));
    emit("place r2, 2");
    emit("port.char r0, r1, r2");
    emit("place r1, 80");
    emit("eq r0, r0, r1");
    emit("jz r0, uknext");
    emit("load.64 r1, " + at(UiTempI));
    emit("place r2, 3");
    emit("port.char r0, r1, r2");
    emit("place r1, 49");
    emit("eq r0, r0, r1");
    emit("jz r0, uknext");
    emit("load.64 r0, " + at(UiTempI));
    emit("store.64 r0, " + at(UiPort));
    emit("place r1, 1");
    emit("jnz r1, ukready");
    emit("uknext:");
    emit("load.64 r0, " + at(UiTempI));
    emit("place r1, 1");
    emit("add r0, r0, r1");
    emit("store.64 r0, " + at(UiTempI));
    emit("place r1, 1");
    emit("jnz r1, ukloop");
    emit("ukready:");
    emit("load.64 r0, " + at(UiPort));
    emit("place r1, 0");
    emit("lt r0, r0, r1");
    emit("jz r0, ukhave");
    emit("place r0, 0");
    emit("place r1, 1");
    emit("jnz r1, ukret");
    emit("ukhave:");
    emit("load.64 r1, " + at(UiPort));
    emit("place r2, 1");
    emit("place r3, 0");
    emit("xchg r1, r2, r3");
    emit("or r0, r3, r3");
    emit("store.64 r0, " + at(UiTempX));
    emit("load.64 r0, " + at(UiSeen));
    emit("place r1, 0");
    emit("eq r0, r0, r1");
    emit("jz r0, ukedge");
    emit("place r0, 1");
    emit("store.64 r0, " + at(UiSeen));
    emit("load.64 r0, " + at(UiTempX));
    emit("store.64 r0, " + at(UiCount));
    emit("place r0, 0");
    emit("place r1, 1");
    emit("jnz r1, ukret");
    emit("ukedge:");
    emit("load.64 r0, " + at(UiTempX));
    emit("load.64 r1, " + at(UiCount));
    emit("eq r0, r0, r1");
    emit("jz r0, uknew");
    emit("place r0, 0");
    emit("place r1, 1");
    emit("jnz r1, ukret");
    emit("uknew:");
    emit("load.64 r0, " + at(UiTempX));
    emit("store.64 r0, " + at(UiCount));
    emit("load.64 r1, " + at(UiPort));
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
    emit("load.64 r1, " + at(UiPort));
    emit("place r2, 1");
    emit("place r3, 3");
    emit("xchg r1, r2, r3");
    emit("or r0, r3, r3");
    emit("ukret:");
    emit("ret");
  }
  if (uiEnter_) {
    emit("uienter:");
    emit("store.64 r7, " + at(UiLinkEnter));
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
    emit("load.64 r7, " + at(UiLinkEnter));
    emit("ret");
  }
  if (uiSave_) {
    emit("uisave:");
    emit("load.64 r0, " + at(UiDepth));
    emit("place r1, 32");
    emit("ge r0, r0, r1");
    emit("jnz r0, uifault");
    emit("load.64 r0, " + at(UiDepth));
    emit("place r1, 128");
    emit("mul r0, r0, r1");
    emit("place r1, " + at(UiStack));
    emit("add r5, r0, r1");
    emit("load.64 r0, " + at(UiOx));
    emit("sti.64 r0, r5");
    emit("place r1, 64");
    emit("add r5, r5, r1");
    emit("load.64 r0, " + at(UiOy));
    emit("sti.64 r0, r5");
    emit("load.64 r0, " + at(UiDepth));
    emit("place r1, 1");
    emit("add r0, r0, r1");
    emit("store.64 r0, " + at(UiDepth));
    emit("ret");
  }
  if (uiTranslate_) {
    emit("uitranslate:");
    emit("load.64 r0, " + at(UiOx));
    emit("load.64 r1, " + at(UiArg));
    emit("add r0, r0, r1");
    emit("store.64 r0, " + at(UiOx));
    emit("load.64 r0, " + at(UiOy));
    emit("load.64 r1, " + at(UiArg + 1));
    emit("add r0, r0, r1");
    emit("store.64 r0, " + at(UiOy));
    emit("ret");
  }
  if (uiRestore_) {
    emit("uirestore:");
    emit("load.64 r0, " + at(UiDepth));
    emit("place r1, 0");
    emit("eq r0, r0, r1");
    emit("jnz r0, uifault");
    emit("load.64 r0, " + at(UiDepth));
    emit("place r1, 1");
    emit("sub r0, r0, r1");
    emit("store.64 r0, " + at(UiDepth));
    emit("load.64 r0, " + at(UiDepth));
    emit("place r1, 128");
    emit("mul r0, r0, r1");
    emit("place r1, " + at(UiStack));
    emit("add r5, r0, r1");
    emit("ldi.64 r0, r5");
    emit("store.64 r0, " + at(UiOx));
    emit("place r1, 64");
    emit("add r5, r5, r1");
    emit("ldi.64 r0, r5");
    emit("store.64 r0, " + at(UiOy));
    emit("ret");
  }
  if (uiFrame_) {
    emit("uiframe:");
    emit("load.64 r0, " + at(UiTick));
    emit("place r1, 1");
    emit("add r0, r0, r1");
    emit("store.64 r0, " + at(UiTick));
    emit("ret");
  }
  if (uiText_ || uiSave_ || uiRestore_ || uiBar_ || uiMeter_) {
    emit("uifault:");
    emit("place r1, 0");
    emit("div r0, r0, r1");
  }
}

}  // namespace obr
