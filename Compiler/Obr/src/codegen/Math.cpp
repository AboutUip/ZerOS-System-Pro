#include "Generator.hpp"

namespace obr {

void Generator::emitLibrary(const Expr& expr, const Function& target) {
  if (target.name.rfind("obr::ui::", 0) == 0) {
    emitUi(expr, target);
    return;
  }
  const TypeKind type = target.ret;
  if (target.name == "obr::math::abs") {
    gen(expr.kids[0]);
    copy(1, 0);
    emit("place r2, 0");
    emit("lt r0, r1, r2");
    const std::string done = fresh("e");
    emit("jz r0, " + done);
    emit("place r2, 0");
    emit("sub r0, r2, r1");
    emit(done + ":");
    return;
  }
  if (target.name == "obr::math::min" || target.name == "obr::math::max") {
    const bool wantMin = target.name == "obr::math::min";
    gen(expr.kids[0]);
    const int left = words_ + temp_;
    hold();
    storeSlot(left, type);
    gen(expr.kids[1]);
    const int right = words_ + temp_;
    hold();
    storeSlot(right, type);
    loadSlot(left, type);
    copy(1, 0);
    loadSlot(right, type);
    copy(2, 0);
    emit(wantMin ? "lt r0, r1, r2" : "gt r0, r1, r2");
    const std::string useRight = fresh("e");
    const std::string done = fresh("e");
    emit("jz r0, " + useRight);
    loadSlot(left, type);
    emit("place r1, 1");
    emit("jnz r1, " + done);
    emit(useRight + ":");
    loadSlot(right, type);
    emit(done + ":");
    release();
    release();
    return;
  }
  if (target.name != "obr::math::clamp") fail("没有这种库函数 " + target.name);
  gen(expr.kids[0]);
  const int value = words_ + temp_;
  hold();
  storeSlot(value, type);
  gen(expr.kids[1]);
  const int low = words_ + temp_;
  hold();
  storeSlot(low, type);
  gen(expr.kids[2]);
  const int high = words_ + temp_;
  hold();
  storeSlot(high, type);
  loadSlot(value, type);
  copy(1, 0);
  loadSlot(low, type);
  copy(2, 0);
  emit("lt r0, r1, r2");
  const std::string notBelow = fresh("e");
  const std::string done = fresh("e");
  emit("jz r0, " + notBelow);
  loadSlot(low, type);
  emit("place r1, 1");
  emit("jnz r1, " + done);
  emit(notBelow + ":");
  loadSlot(value, type);
  copy(1, 0);
  loadSlot(high, type);
  copy(2, 0);
  emit("gt r0, r1, r2");
  const std::string notAbove = fresh("e");
  emit("jz r0, " + notAbove);
  loadSlot(high, type);
  emit("place r1, 1");
  emit("jnz r1, " + done);
  emit(notAbove + ":");
  loadSlot(value, type);
  emit(done + ":");
  release();
  release();
  release();
}

}  // namespace obr
