#include "Generator.hpp"
#include "../type/Type.hpp"

#include <cstdint>
#include <cstring>

namespace obr {

/* M-B：span[T] 切片降级。两字值 = 元素位地址 + 元素个数，按结构体值语义传参/返回
   （retSlot 隐藏目的槽、字展平），零分配、无对象头、不进任务结构。
   元素按八位组密度访问：步长 = 元素值宽度（M-A alignof），byte 8、short 16、
   int/char 32、long/float/double/指针 64 位。下标/子切片越界造 Plan 2 失败值
   （code 1 = 下标越界，与容器同一失败面）进 emitFailCheck 归宿链，不另设停机。 */

int Generator::spanStride(TypeKind elem) {
  if (elem == TypeKind::Byte || elem == TypeKind::Boolean) return 8;
  if (elem == TypeKind::Short) return 16;
  if (elem == TypeKind::Int || elem == TypeKind::Char) return 32;
  return 64;
}

/* span[T](地址, 个数)：两字直写目的块（同结构体调用直写省一次拷贝）。 */

void Generator::emitSpanCtorTo(const Expr& expr, int dstAddrSlot) {
  gen(expr.kids[0]);
  const int data = words_ + temp_;
  hold();
  storeSlot(data, TypeKind::Long);
  gen(expr.kids[1]);
  const int count = words_ + temp_;
  hold();
  storeSlot(count, TypeKind::Long);
  loadSlot(data, TypeKind::Long);
  copy(1, 0);
  loadSlot(dstAddrSlot, TypeKind::Long);
  copy(5, 0);
  copy(0, 1);
  emit("sti.64 r0, r5");
  loadSlot(count, TypeKind::Long);
  copy(1, 0);
  loadSlot(dstAddrSlot, TypeKind::Long);
  emit("place r5, 64");
  emit("add r0, r0, r5");
  copy(5, 0);
  copy(0, 1);
  emit("sti.64 r0, r5");
  release();
  release();
  frameHeld_ = false;
}

/* span 对象的两字取进两个已持有的槽。构造/子切片/两字调用结果先落临时块再读；
   变量/字段/解引用直接按地址读两字。 */

void Generator::emitSpanObjectWords(const Expr& object, int dataSlot, int lenSlot) {
  const bool produced = object.kind == Expr::Kind::Call || object.kind == Expr::Kind::VirtualCall;
  if (produced) {
    const int block = words_ + temp_;
    hold();
    hold();
    const int dst = words_ + temp_;
    hold();
    address(block);
    copy(0, 5);
    storeSlot(dst, TypeKind::Long);
    emitStructValueTo(object, dst);
    release();
    loadSlot(block, TypeKind::Long);
    storeSlot(dataSlot, TypeKind::Long);
    loadSlot(block + 1, TypeKind::Long);
    storeSlot(lenSlot, TypeKind::Long);
    release();
    release();
    frameHeld_ = false;
    return;
  }
  emitAddress(object);
  const int at = words_ + temp_;
  hold();
  storeSlot(at, TypeKind::Long);
  loadSlot(at, TypeKind::Long);
  emit("ldi.64 r0, r0");
  storeSlot(dataSlot, TypeKind::Long);
  loadSlot(at, TypeKind::Long);
  emit("place r5, 64");
  emit("add r5, r0, r5");
  emit("ldi.64 r0, r5");
  storeSlot(lenSlot, TypeKind::Long);
  release();
  frameHeld_ = false;
}

/* 越界失败块：成功路径 r1 = 0；越界造 fail 对象（code 1）进 r1，然后走统一检查
   （try → @Fails → 终止），不 halt、不另设停机。 */

void Generator::emitSpanBoundsEnd(const std::string& mkfail, const std::string& checked) {
  emit("place r1, 0");
  emit("place r6, 1");
  emit("jnz r6, " + checked);
  emit(mkfail + ":");
  emit("place r0, 1");
  emitFailAlloc();
  copy(1, 0);
  emit(checked + ":");
  emitFailCheck();
}

/* s.sub(起, 个数)：子切片直写目的块。起/个数非负且起 + 个数 ≤ .count，否则越界失败值。 */

void Generator::emitSpanSubTo(const Expr& expr, int dstAddrSlot) {
  const int data = words_ + temp_;
  hold();
  const int len = words_ + temp_;
  hold();
  emitSpanObjectWords(expr.kids[0], data, len);
  gen(expr.kids[1]);
  const int start = words_ + temp_;
  hold();
  storeSlot(start, TypeKind::Long);
  gen(expr.kids[2]);
  const int count = words_ + temp_;
  hold();
  storeSlot(count, TypeKind::Long);
  const std::string mkfail = fresh("k");
  const std::string checked = fresh("e");
  loadSlot(start, TypeKind::Long);
  emit("place r1, 0");
  emit("lt r2, r0, r1");
  emit("jnz r2, " + mkfail);
  loadSlot(count, TypeKind::Long);
  emit("place r1, 0");
  emit("lt r2, r0, r1");
  emit("jnz r2, " + mkfail);
  loadSlot(start, TypeKind::Long);
  copy(2, 0);
  loadSlot(count, TypeKind::Long);
  copy(1, 0);
  emit("add r0, r1, r2");
  copy(2, 0);
  loadSlot(len, TypeKind::Long);
  copy(1, 0);
  emit("lt r0, r1, r2");
  emit("jnz r0, " + mkfail);
  emitSpanBoundsEnd(mkfail, checked);
  /* 结果 = { data + 起 × 步长, 个数 } */
  loadSlot(start, TypeKind::Long);
  emit("place r1, " + std::to_string(spanStride(expr.pointee)));
  emit("mul r0, r0, r1");
  copy(1, 0);
  loadSlot(data, TypeKind::Long);
  emit("add r0, r0, r1");
  copy(1, 0);
  loadSlot(dstAddrSlot, TypeKind::Long);
  copy(5, 0);
  copy(0, 1);
  emit("sti.64 r0, r5");
  loadSlot(count, TypeKind::Long);
  copy(1, 0);
  loadSlot(dstAddrSlot, TypeKind::Long);
  emit("place r5, 64");
  emit("add r0, r0, r5");
  copy(5, 0);
  copy(0, 1);
  emit("sti.64 r0, r5");
  release();
  release();
  release();
  release();
  frameHeld_ = false;
}

/* s[i] 元素地址（带越界检查）：出来时元素位地址在 r0。0 ≤ i < .count，否则失败值。 */

void Generator::emitSpanIndexAddress(const Expr& object, const Expr& index) {
  const int data = words_ + temp_;
  hold();
  const int len = words_ + temp_;
  hold();
  emitSpanObjectWords(object, data, len);
  gen(index);
  const int at = words_ + temp_;
  hold();
  storeSlot(at, TypeKind::Long);
  const std::string mkfail = fresh("k");
  const std::string checked = fresh("e");
  loadSlot(at, TypeKind::Long);
  emit("place r1, 0");
  emit("lt r2, r0, r1");
  emit("jnz r2, " + mkfail);
  loadSlot(at, TypeKind::Long);
  copy(2, 0);
  loadSlot(len, TypeKind::Long);
  copy(1, 0);
  /* 越界判定：len ≤ i（i 从 0 起，i == count 也算越界）。 */
  emit("le r0, r1, r2");
  emit("jnz r0, " + mkfail);
  emitSpanBoundsEnd(mkfail, checked);
  loadSlot(at, TypeKind::Long);
  emit("place r1, " + std::to_string(spanStride(object.pointee)));
  emit("mul r0, r0, r1");
  copy(1, 0);
  loadSlot(data, TypeKind::Long);
  emit("add r0, r0, r1");
  release();
  release();
  release();
  frameHeld_ = false;
}

/* 元素按值宽度访问：地址在 r5。byte 读出压回 0..255（ldi.octet 是补码，与 obr::oct 同口径）。 */

void Generator::emitSpanLoad(TypeKind type) {
  if (type == TypeKind::Byte || type == TypeKind::Boolean) {
    emit("ldi.octet r0, r5");
    emit("place r1, 255");
    emit("and r0, r0, r1");
    if (type == TypeKind::Boolean) narrow(TypeKind::Boolean);
    return;
  }
  if (type == TypeKind::Short) {
    emit("ldi.16 r0, r5");
    return;
  }
  if (type == TypeKind::Int || type == TypeKind::Char) {
    emit("ldi.32 r0, r5");
    return;
  }
  if (type == TypeKind::Float || type == TypeKind::Double) {
    emit("ldi.f64 r0, r5");
    return;
  }
  emit("ldi.64 r0, r5");
}

void Generator::emitSpanStore(TypeKind type) {
  if (type == TypeKind::Byte || type == TypeKind::Boolean) {
    emit("sti.octet r0, r5");
    return;
  }
  if (type == TypeKind::Short) {
    emit("sti.16 r0, r5");
    return;
  }
  if (type == TypeKind::Int || type == TypeKind::Char) {
    emit("sti.32 r0, r5");
    return;
  }
  if (type == TypeKind::Float || type == TypeKind::Double) {
    emit("sti.f64 r0, r5");
    return;
  }
  emit("sti.64 r0, r5");
}

}  // namespace obr
