#include "Generator.hpp"

namespace obr {

void Generator::emitFont(const Expr& expr, const Function& target) {
  int op = 0;
  int count = 0;
  bool result = false;
  if (target.name == "obr::font::face") {
    op = 40;
    count = 3;
    result = true;
  } else if (target.name == "obr::font::select") {
    op = 41;
    count = 3;
  } else if (target.name == "obr::font::draw") {
    op = 42;
    count = 2;
  } else {
    fail("没有这种字体调用 " + target.name);
  }
  /* 参数先落到临时槽。后面的 itof 会占用 r1 起的寄存器，不能边求值边转换。 */
  int slots[3] = {};
  for (int index = 0; index < count; index += 1) {
    gen(expr.kids[static_cast<std::size_t>(index)]);
    slots[index] = words_ + temp_;
    hold();
    storeSlot(slots[index], TypeKind::Long);
  }
  for (int index = 0; index < count; index += 1) {
    loadSlot(slots[index], TypeKind::Long);
    const int reg = index + 1;
    copy(reg, 0);
    emit("itof r" + std::to_string(reg) + ", r" + std::to_string(reg));
  }
  /* 用不到的 double 参数写成 0。协议忽略 FontFace 的第四个、FontSelect 的第四个、FontDraw 的后两个。 */
  for (int reg = count + 1; reg <= 4; reg += 1) {
    emit("place r" + std::to_string(reg) + ", 0");
    emit("itof r" + std::to_string(reg) + ", r" + std::to_string(reg));
  }
  emit("place r0, " + std::to_string(op));
  emit("gpu.accel r6, r0, r1, r2, r3, r4");
  if (result) emit("or r0, r6, r6");
  frameHeld_ = false;
  for (int index = 0; index < count; index += 1) release();
}

}  // namespace obr
