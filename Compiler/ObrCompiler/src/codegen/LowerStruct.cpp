#include "Generator.hpp"
#include "../type/Type.hpp"

#include <cstdint>
#include <cstring>

namespace obr {

void Generator::emitStructCopyFrom(int count, int dstAddrSlot) {
  const int src = words_ + temp_;
  hold();
  storeSlot(src, TypeKind::Long);
  for (int j = 0; j < count; j += 1) {
    loadSlot(src, TypeKind::Long);
    emit("place r5, " + std::to_string(j * 64));
    emit("add r0, r0, r5");
    emit("ldi.64 r0, r0");
    emit("or r1, r0, r0");
    loadSlot(dstAddrSlot, TypeKind::Long);
    emit("place r5, " + std::to_string(j * 64));
    emit("add r0, r0, r5");
    copy(5, 0);
    copy(0, 1);
    emit("sti.64 r0, r5");
  }
  release();
  frameHeld_ = false;
}

/* 结构体装箱：r0 = 源地址 → r0 = 堆上副本地址（集合槽存这个引用）。 */

void Generator::emitStructBox(int count) {
  const int src = words_ + temp_;
  hold();
  storeSlot(src, TypeKind::Long);
  const std::string ready = fresh("e");
  emit("load.64 r4, " + std::to_string(kHeapPtr));
  emit("place r5, 0");
  emit("eq r0, r4, r5");
  emit("jz r0, " + ready);
  emit("place r4, " + std::to_string(kHeap));
  emit(ready + ":");
  copy(0, 4);
  emit("place r1, " + std::to_string(count * 64));
  emit("add r4, r4, r1");
  emit("store.64 r4, " + std::to_string(kHeapPtr));
  const int base = words_ + temp_;
  hold();
  storeSlot(base, TypeKind::Long);
  for (int j = 0; j < count; j += 1) {
    loadSlot(src, TypeKind::Long);
    emit("place r5, " + std::to_string(j * 64));
    emit("add r0, r0, r5");
    emit("ldi.64 r0, r0");
    emit("or r1, r0, r0");
    loadSlot(base, TypeKind::Long);
    emit("place r5, " + std::to_string(j * 64));
    emit("add r0, r0, r5");
    copy(5, 0);
    copy(0, 1);
    emit("sti.64 r0, r5");
  }
  loadSlot(base, TypeKind::Long);
  release();
  release();
  frameHeld_ = false;
}

/* 结构体装箱（任意值形态）：先落临时字块，再拷上堆；r0 = 堆副本地址。 */

void Generator::emitStructBoxValue(const Expr& arg) {
  const int count = structWords(arg.typeName);
  const int block = words_ + temp_;
  for (int j = 0; j < count; j += 1) hold();
  const int addrSlot = words_ + temp_;
  hold();
  address(block);
  copy(0, 5);
  storeSlot(addrSlot, TypeKind::Long);
  emitStructValueTo(arg, addrSlot);
  release();
  address(block);
  copy(0, 5);
  emitStructBox(count);
  for (int j = 0; j < count; j += 1) release();
}

/* 结构体值落到目的地址：真正返回结构体的函数调用直写目的（省一次拷贝）；
   其余（变量/字段/下标/集合 pop、get/装箱引用）取值地址再拷。 */

void Generator::emitStructValueTo(const Expr& expr, int dstAddrSlot) {
  /* M-B：span 构造/子切片是两字值生产点，直写目的块（同结构体调用直写省一次拷贝）。 */
  if (expr.kind == Expr::Kind::Call && (expr.integer == -10 || expr.integer == -11)) {
    if (expr.integer == -10) emitSpanCtorTo(expr, dstAddrSlot);
    else emitSpanSubTo(expr, dstAddrSlot);
    return;
  }
  const int count = valueWordsOf(expr);
  const bool direct = (expr.kind == Expr::Kind::Call || expr.kind == Expr::Kind::VirtualCall)
    && expr.integer >= 0
    && ((*functions_)[static_cast<std::size_t>(expr.integer)].ret == TypeKind::Struct
      || (*functions_)[static_cast<std::size_t>(expr.integer)].ret == TypeKind::Span);
  if (direct) {
    structDestSlot_ = dstAddrSlot;
    structDestWords_ = count;
    gen(expr);
    structDestSlot_ = -1;
    return;
  }
  emitAddress(expr);
  emitStructCopyFrom(count, dstAddrSlot);
}

/* 结构体实参展平成 count 个字槽（值传递 ABI：参数按字走 r1..r6/软件栈）。
   M-B：span 实参同样展平（两字：元素位地址 + 元素个数）。 */

void Generator::pushStructArgWords(const Expr& arg, std::vector<int>& slots, std::vector<TypeKind>& kinds) {
  const int count = valueWordsOf(arg);
  /* 目的块 = N 个字槽，直接当实参字（值传递 ABI）；调用结果直写块，其余取地址拷入。 */
  const int block = words_ + temp_;
  for (int j = 0; j < count; j += 1) hold();
  const int addrSlot = words_ + temp_;
  hold();
  address(block);
  copy(0, 5);
  storeSlot(addrSlot, TypeKind::Long);
  emitStructValueTo(arg, addrSlot);
  release();
  for (int j = 0; j < count; j += 1) {
    slots.push_back(block + j);
    kinds.push_back(TypeKind::Long);
  }
}

}  // namespace obr
