#include "Generator.hpp"

namespace obr {
namespace {

constexpr int kLink = 128;
constexpr int kObj = 129;
constexpr int kKey = 130;
constexpr int kVal = 131;
constexpr int kMode = 132;
constexpr int kSlot = 133;
constexpr int kFlag = 134;
constexpr int kCheapLink = 136;
constexpr int kCheapSize = 137;
constexpr int kCheapBase = 138;
constexpr int kFindLink = 140;
constexpr int kFindObj = 141;
constexpr int kFindKey = 142;
constexpr int kFindSlots = 143;
constexpr int kFindMask = 144;
constexpr int kFindStart = 145;
constexpr int kFindTomb = 146;
constexpr int kFindStride = 147;
constexpr int kFindIndex = 148;
constexpr int kFindMode = 149;
constexpr int kFindAddr = 139;
constexpr int kSeqLink = 150;
constexpr int kSeqA = 151;
constexpr int kSeqB = 152;
constexpr int kSeqLen = 153;
constexpr int kSeqI = 154;
constexpr int kGrowLink = 160;
constexpr int kGrowObj = 161;
constexpr int kGrowCap = 162;
constexpr int kGrowNew = 163;
constexpr int kGrowOld = 164;
constexpr int kGrowSlots = 165;
constexpr int kGrowStride = 166;
constexpr int kGrowMode = 167;
constexpr int kGrowI = 168;
constexpr int kGrowKey = 169;
constexpr int kGrowVal = 170;

std::string cell(int index) { return std::to_string(kUi + index * 64); }

}  // namespace

void Generator::markCollect() { needCollect_ = true; }

void Generator::restoreFrame() {
  emit("load.64 r4, " + std::to_string(kSp));
  emit("place r5, " + std::to_string(frameBits()));
  emit("sub r4, r4, r5");
  emit("store.64 r4, " + std::to_string(kFrame));
  frameHeld_ = true;
}

void Generator::emitCollectCall(const std::string& label) {
  markCollect();
  emit("call " + label);
  restoreFrame();
}

void Generator::emitCollectNew(const Expr& expr) {
  if (expr.type == TypeKind::Array) {
    gen(expr.kids[0]);
    emitCollectCall("obranew");
    return;
  }
  const char* label = "obrlnew";
  if (expr.type == TypeKind::Set) label = "obrsnew";
  if (expr.type == TypeKind::Map) label = "obrmnew";
  emitCollectCall(label);
}

void Generator::emitElementAddress(const Expr& box, const Expr& index) {
  gen(box);
  const int saved = words_ + temp_;
  hold();
  storeSlot(saved, TypeKind::Long);
  gen(index);
  copy(1, 0);
  loadSlot(saved, TypeKind::Long);
  release();
  emitCollectCall(box.type == TypeKind::Array ? "obrcidx" : "obrlidx");
  if (failChecks_) emitFailCheck();
}

namespace {

int collectMode(TypeKind key) {
  if (key == TypeKind::String) return 1;
  if (key == TypeKind::Float || key == TypeKind::Double) return 2;
  return 0;
}

}  // namespace

void Generator::emitCollectMethod(const Expr& expr) {
  const int code = static_cast<int>(expr.integer);
  const int mode = collectMode(expr.kids[0].pointee);
  const bool map = expr.kids[0].type == TypeKind::Map;
  const int stride = map ? 192 : 128;
  if (code == -20) {
    if (expr.kids[0].pointee == TypeKind::Struct) {
      /* 结构体元素装箱（缺口 1 收口）：集合槽存堆上副本的引用。 */
      emitStructBoxValue(expr.kids[1]);
    } else {
      gen(expr.kids[1]);
    }
    const int valueSlot = words_ + temp_;
    hold();
    storeSlot(valueSlot, TypeKind::Long);
    gen(expr.kids[0]);
    const int objSlot = words_ + temp_;
    hold();
    storeSlot(objSlot, TypeKind::Long);
    loadSlot(valueSlot, TypeKind::Long);
    copy(1, 0);
    loadSlot(objSlot, TypeKind::Long);
    release();
    release();
    emitCollectCall("obrlpush");
    return;
  }
  if (code == -21) {
    gen(expr.kids[0]);
    emitCollectCall("obrlpop");
    if (failChecks_) emitFailCheck();
    return;
  }
  if (code == -24) {
    if (expr.kids[0].alt == TypeKind::Struct) {
      /* map 的结构体值装箱（缺口 1 收口）：槽存堆上副本的引用。 */
      emitStructBoxValue(expr.kids[2]);
    } else {
      gen(expr.kids[2]);
    }
    const int valueSlot = words_ + temp_;
    hold();
    storeSlot(valueSlot, TypeKind::Long);
    gen(expr.kids[1]);
    const int keySlot = words_ + temp_;
    hold();
    storeSlot(keySlot, TypeKind::Long);
    gen(expr.kids[0]);
    const int objSlot = words_ + temp_;
    hold();
    storeSlot(objSlot, TypeKind::Long);
    loadSlot(keySlot, TypeKind::Long);
    copy(1, 0);
    loadSlot(valueSlot, TypeKind::Long);
    copy(2, 0);
    loadSlot(objSlot, TypeKind::Long);
    release();
    release();
    release();
    emit("place r3, " + std::to_string(mode));
    emitCollectCall("obrmput");
    return;
  }
  gen(expr.kids[1]);
  const int keySlot = words_ + temp_;
  hold();
  storeSlot(keySlot, TypeKind::Long);
  gen(expr.kids[0]);
  const int objSlot = words_ + temp_;
  hold();
  storeSlot(objSlot, TypeKind::Long);
  loadSlot(keySlot, TypeKind::Long);
  copy(1, 0);
  loadSlot(objSlot, TypeKind::Long);
  release();
  release();
  emit("place r3, " + std::to_string(mode));
  if (code == -22 || code == -25) emit("place r2, " + std::to_string(stride));
  if (code == -22) emitCollectCall("obrhas");
  else if (code == -25) emitCollectCall("obrremove");
  else if (code == -26) {
    emitCollectCall("obrget");
    if (failChecks_) emitFailCheck();
  } else emitCollectCall("obrsadd");
}

void Generator::emitCollectRoutines() {

  emit("obrhalt:");
  emit("halt");

  if (failChecks_) {
    emitCollectFailRoutines();
  }

  emitCollectHeapRoutine();
  emitCollectHashRoutines();
  emitCollectSeqRoutine();
  emitCollectFindRoutine();
  emitCollectGrowRoutine();
  emitCollectAllocRoutines();
  emitCollectListRoutines();
  emitCollectQueryRoutines();
}

void Generator::collectJump(const std::string& label) {
  emit("place r6, 1");
  emit("jnz r6, " + label);
}

  void Generator::collectFinishMut(const std::string& growLabel, int stride, bool writeValue) {
    emit("store.64 r0, " + cell(kSlot));
    emit("store.64 r1, " + cell(kFlag));
    emit("load.64 r1, " + cell(kFlag));
    emit("place r2, 1");
    emit("eq r2, r1, r2");
    emit(writeValue ? "jnz r2, " + growLabel + "_have" : "jnz r2, " + growLabel + "_done");
    emit("load.64 r0, " + cell(kSlot));
    emit("place r1, 0");
    emit("eq r1, r0, r1");
    emit("jnz r1, " + growLabel + "_grow");
    emit("ldi.64 r1, r0");
    emit("place r2, 0");
    emit("eq r2, r1, r2");
    emit("jz r2, " + growLabel + "_write");
    emit("load.64 r3, " + cell(kObj));
    emit("ldi.64 r4, r3");
    emit("place r5, 1");
    emit("add r4, r4, r5");
    emit("sti.64 r4, r3");
    emit(growLabel + "_write:");
    emit("load.64 r0, " + cell(kSlot));
    emit("place r1, 1");
    emit("sti.64 r1, r0");
    emit("place r5, 64");
    emit("add r5, r0, r5");
    emit("load.64 r1, " + cell(kKey));
    emit("sti.64 r1, r5");
    if (writeValue) {
      emit("load.64 r0, " + cell(kSlot));
      emit("place r5, 128");
      emit("add r5, r0, r5");
      emit("load.64 r1, " + cell(kVal));
      emit("sti.64 r1, r5");
    }
    collectJump(growLabel + "_done");
    emit(growLabel + "_have:");
    if (writeValue) {
      emit("load.64 r0, " + cell(kSlot));
      emit("place r5, 128");
      emit("add r5, r0, r5");
      emit("load.64 r1, " + cell(kVal));
      emit("sti.64 r1, r5");
    }
    emit(growLabel + "_done:");
    emit("load.64 r7, " + cell(kLink));
    emit("ret");
    emit(growLabel + "_grow:");
    emit("load.64 r0, " + cell(kObj));
    emit("place r2, " + std::to_string(stride));
    emit("load.64 r3, " + cell(kMode));
    emit("call obrgrow");
    collectJump(growLabel + "_retry");
  };

void Generator::emitCollectFailRoutines() {
    if (failClassId_ == 0) {
      for (const ClassDecl& decl : *classes_) {
        if (decl.name == "fail") failClassId_ = decl.id;
      }
      if (failClassId_ == 0) fail("没有内置 fail 类");
    }
    /* M3 失败值：集合例程的失败路径把错误码造成 fail 对象放 r1，成功返回前 r1 置 0。
       1 = 下标越界，2 = 空弹出，3 = 缺键。经 kLink 回调用点。 */
    emit("obrfail1:");
    emit("place r0, 1");
    collectJump("obrfailmk");
    emit("obrfail2:");
    emit("place r0, 2");
    collectJump("obrfailmk");
    emit("obrfail3:");
    emit("place r0, 3");
    collectJump("obrfailmk");
    emit("obrfailmk:");
    emit("load.64 r4, " + std::to_string(kHeapPtr));
    emit("place r5, 0");
    emit("eq r1, r4, r5");
    const std::string ready = "obrfail_ready";
    emit("jz r1, " + ready);
    emit("place r4, " + std::to_string(kHeap));
    emit(ready + ":");
    emit("or r5, r4, r4");
    emit("place r1, 256");
    emit("add r4, r4, r1");
    emit("store.64 r4, " + std::to_string(kHeapPtr));
    emit("place r1, " + std::to_string(failClassId_));
    emit("sti.64 r1, r5");
    emit("place r1, 64");
    emit("add r1, r5, r1");
    emit("sti.64 r0, r1");
    emit("place r1, 128");
    emit("add r1, r5, r1");
    emit("place r2, 0");
    emit("sti.64 r2, r1");
    emit("place r1, 192");
    emit("add r1, r5, r1");
    emit("sti.64 r2, r1");
    emit("or r1, r5, r5");
    emit("place r0, 0");
    emit("load.64 r7, " + cell(kLink));
    emit("ret");
  }

void Generator::emitCollectHeapRoutine() {  emit("obrcheap:");
  emit("store.64 r7, " + cell(kCheapLink));
  emit("store.64 r0, " + cell(kCheapSize));
  emit("load.64 r4, " + std::to_string(kHeapPtr));
  emit("place r5, 0");
  emit("eq r1, r4, r5");
  emit("jz r1, obrcheap_ready");
  emit("place r4, " + std::to_string(kHeap));
  emit("obrcheap_ready:");
  emit("store.64 r4, " + cell(kCheapBase));
  emit("add r4, r4, r0");
  emit("store.64 r4, " + std::to_string(kHeapPtr));
  emit("load.64 r0, " + cell(kCheapBase));
  emit("load.64 r2, " + cell(kCheapSize));
  emit("place r1, 0");
  emit("obrcheap_loop:");
  emit("lt r3, r1, r2");
  emit("jz r3, obrcheap_done");
  emit("add r4, r0, r1");
  emit("place r5, 0");
  emit("sti.64 r5, r4");
  emit("place r5, 64");
  emit("add r1, r1, r5");
  collectJump("obrcheap_loop");
  emit("obrcheap_done:");
  emit("load.64 r7, " + cell(kCheapLink));
  emit("ret");

}

void Generator::emitCollectHashRoutines() {  emit("obrmix:");
  emit("store.64 r7, " + cell(kSeqLink));
  emit("or r1, r0, r0");
  emit("place r2, 16");
  emit("shr r1, r1, r2");
  emit("xor r0, r0, r1");
  emit("load.64 r7, " + cell(kSeqLink));
  emit("ret");

  emit("obrhash:");
  emit("store.64 r7, " + cell(kSeqLink));
  emit("place r1, 0");
  emit("eq r2, r0, r1");
  emit("jnz r2, obrhash_none");
  emit("ldi.64 r2, r0");
  emit("store.64 r0, " + cell(kSeqA));
  emit("store.64 r2, " + cell(kSeqLen));
  emit("place r3, 5381");
  emit("place r4, 0");
  emit("obrhash_loop:");
  emit("lt r5, r4, r2");
  emit("jz r5, obrhash_done");
  emit("place r5, 32");
  emit("mul r5, r4, r5");
  emit("place r1, 64");
  emit("add r5, r5, r1");
  emit("load.64 r0, " + cell(kSeqA));
  emit("add r5, r0, r5");
  emit("ldi.32 r5, r5");
  emit("place r1, 33");
  emit("mul r3, r3, r1");
  emit("add r3, r3, r5");
  emit("place r1, 1");
  emit("add r4, r4, r1");
  emit("load.64 r2, " + cell(kSeqLen));
  collectJump("obrhash_loop");
  emit("obrhash_done:");
  emit("or r0, r3, r3");
  emit("load.64 r7, " + cell(kSeqLink));
  emit("ret");
  emit("obrhash_none:");
  emit("place r0, 0");
  emit("load.64 r7, " + cell(kSeqLink));
  emit("ret");

}

void Generator::emitCollectSeqRoutine() {  emit("obrseq:");
  emit("store.64 r7, " + cell(kSeqLink));
  emit("eq r2, r0, r1");
  emit("jnz r2, obrseq_yes");
  emit("place r2, 0");
  emit("eq r3, r0, r2");
  emit("jnz r3, obrseq_no");
  emit("eq r3, r1, r2");
  emit("jnz r3, obrseq_no");
  emit("store.64 r0, " + cell(kSeqA));
  emit("store.64 r1, " + cell(kSeqB));
  emit("ldi.64 r2, r0");
  emit("ldi.64 r3, r1");
  emit("eq r4, r2, r3");
  emit("jz r4, obrseq_no");
  emit("store.64 r2, " + cell(kSeqLen));
  emit("place r4, 0");
  emit("obrseq_loop:");
  emit("load.64 r2, " + cell(kSeqLen));
  emit("lt r5, r4, r2");
  emit("jz r5, obrseq_yes");
  emit("store.64 r4, " + cell(kSeqI));
  emit("place r5, 32");
  emit("mul r5, r4, r5");
  emit("place r1, 64");
  emit("add r5, r5, r1");
  emit("load.64 r0, " + cell(kSeqA));
  emit("add r5, r0, r5");
  emit("ldi.32 r6, r5");
  emit("load.64 r4, " + cell(kSeqI));
  emit("place r5, 32");
  emit("mul r5, r4, r5");
  emit("place r1, 64");
  emit("add r5, r5, r1");
  emit("load.64 r0, " + cell(kSeqB));
  emit("add r5, r0, r5");
  emit("ldi.32 r5, r5");
  emit("eq r0, r6, r5");
  emit("jz r0, obrseq_no");
  emit("load.64 r4, " + cell(kSeqI));
  emit("place r1, 1");
  emit("add r4, r4, r1");
  collectJump("obrseq_loop");
  emit("obrseq_yes:");
  emit("place r0, 1");
  emit("load.64 r7, " + cell(kSeqLink));
  emit("ret");
  emit("obrseq_no:");
  emit("place r0, 0");
  emit("load.64 r7, " + cell(kSeqLink));
  emit("ret");

}

void Generator::emitCollectFindRoutine() {  emit("obrfind:");
  emit("store.64 r7, " + cell(kFindLink));
  emit("store.64 r0, " + cell(kFindObj));
  emit("store.64 r1, " + cell(kFindKey));
  emit("store.64 r2, " + cell(kFindStride));
  emit("store.64 r3, " + cell(kFindMode));
  emit("place r4, 0");
  emit("eq r4, r0, r4");
  emit("jnz r4, obrhalt");
  emit("place r5, 64");
  emit("add r5, r0, r5");
  emit("ldi.64 r4, r5");
  emit("place r5, 1");
  emit("sub r4, r4, r5");
  emit("store.64 r4, " + cell(kFindMask));
  emit("load.64 r0, " + cell(kFindObj));
  emit("place r5, 128");
  emit("add r5, r0, r5");
  emit("ldi.64 r4, r5");
  emit("store.64 r4, " + cell(kFindSlots));
  emit("load.64 r3, " + cell(kFindMode));
  emit("place r4, 1");
  emit("eq r4, r3, r4");
  emit("jnz r4, obrfind_str");
  emit("load.64 r0, " + cell(kFindKey));
  emit("call obrmix");
  collectJump("obrfind_masked");
  emit("obrfind_str:");
  emit("load.64 r0, " + cell(kFindKey));
  emit("call obrhash");
  emit("obrfind_masked:");
  emit("load.64 r1, " + cell(kFindMask));
  emit("and r0, r0, r1");
  emit("store.64 r0, " + cell(kFindStart));
  emit("store.64 r0, " + cell(kFindIndex));
  emit("place r0, 0");
  emit("store.64 r0, " + cell(kFindTomb));
  emit("obrfind_loop:");
  emit("load.64 r0, " + cell(kFindSlots));
  emit("load.64 r1, " + cell(kFindIndex));
  emit("load.64 r2, " + cell(kFindStride));
  emit("mul r1, r1, r2");
  emit("add r0, r0, r1");
  emit("store.64 r0, " + cell(kFindAddr));
  emit("ldi.64 r1, r0");
  emit("place r2, 0");
  emit("eq r3, r1, r2");
  emit("jnz r3, obrfind_empty");
  emit("place r2, 1");
  emit("eq r3, r1, r2");
  emit("jnz r3, obrfind_live");
  emit("load.64 r2, " + cell(kFindTomb));
  emit("place r3, 0");
  emit("eq r3, r2, r3");
  emit("jz r3, obrfind_next");
  emit("load.64 r0, " + cell(kFindAddr));
  emit("store.64 r0, " + cell(kFindTomb));
  collectJump("obrfind_next");
  emit("obrfind_empty:");
  emit("load.64 r0, " + cell(kFindTomb));
  emit("place r1, 0");
  emit("eq r2, r0, r1");
  emit("jz r2, obrfind_insert");
  emit("load.64 r0, " + cell(kFindAddr));
  emit("obrfind_insert:");
  emit("place r1, 0");
  collectJump("obrfind_ret");
  emit("obrfind_live:");
  emit("load.64 r0, " + cell(kFindAddr));
  emit("place r5, 64");
  emit("add r5, r0, r5");
  emit("ldi.64 r0, r5");
  emit("load.64 r1, " + cell(kFindKey));
  emit("load.64 r3, " + cell(kFindMode));
  emit("place r4, 1");
  emit("eq r4, r3, r4");
  emit("jnz r4, obrfind_seq");
  emit("place r4, 2");
  emit("eq r4, r3, r4");
  emit("jnz r4, obrfind_feq");
  emit("eq r4, r0, r1");
  emit("jnz r4, obrfind_hit");
  collectJump("obrfind_next");
  emit("obrfind_seq:");
  emit("call obrseq");
  emit("place r1, 1");
  emit("eq r4, r0, r1");
  emit("jnz r4, obrfind_hit");
  collectJump("obrfind_next");
  emit("obrfind_feq:");
  emit("feq r4, r0, r1");
  emit("jnz r4, obrfind_hit");
  collectJump("obrfind_next");
  emit("obrfind_hit:");
  emit("load.64 r0, " + cell(kFindAddr));
  emit("place r1, 1");
  collectJump("obrfind_ret");
  emit("obrfind_next:");
  emit("load.64 r0, " + cell(kFindIndex));
  emit("place r1, 1");
  emit("add r0, r0, r1");
  emit("load.64 r1, " + cell(kFindMask));
  emit("and r0, r0, r1");
  emit("store.64 r0, " + cell(kFindIndex));
  emit("load.64 r1, " + cell(kFindStart));
  emit("eq r2, r0, r1");
  emit("jnz r2, obrfind_wrap");
  collectJump("obrfind_loop");
  emit("obrfind_wrap:");
  emit("load.64 r0, " + cell(kFindTomb));
  emit("place r1, 0");
  emit("eq r2, r0, r1");
  emit("jnz r2, obrfind_full");
  emit("place r1, 0");
  collectJump("obrfind_ret");
  emit("obrfind_full:");
  emit("place r0, 0");
  emit("place r1, 0");
  emit("obrfind_ret:");
  emit("store.64 r0, " + cell(kFindAddr));
  emit("store.64 r1, " + cell(kFlag));
  emit("load.64 r7, " + cell(kFindLink));
  emit("load.64 r0, " + cell(kFindAddr));
  emit("load.64 r1, " + cell(kFlag));
  emit("ret");

}

void Generator::emitCollectGrowRoutine() {  emit("obrgrow:");
  emit("store.64 r7, " + cell(kGrowLink));
  emit("store.64 r0, " + cell(kGrowObj));
  emit("store.64 r2, " + cell(kGrowStride));
  emit("store.64 r3, " + cell(kGrowMode));
  emit("place r5, 64");
  emit("add r5, r0, r5");
  emit("ldi.64 r4, r5");
  emit("store.64 r4, " + cell(kGrowCap));
  emit("place r5, 2");
  emit("mul r0, r4, r5");
  emit("store.64 r0, " + cell(kGrowNew));
  emit("load.64 r2, " + cell(kGrowStride));
  emit("mul r0, r0, r2");
  emit("call obrcheap");
  emit("store.64 r0, " + cell(kGrowSlots));
  emit("load.64 r0, " + cell(kGrowObj));
  emit("place r5, 128");
  emit("add r5, r0, r5");
  emit("ldi.64 r4, r5");
  emit("store.64 r4, " + cell(kGrowOld));
  emit("place r4, 0");
  emit("store.64 r4, " + cell(kGrowI));
  emit("obrgrow_loop:");
  emit("load.64 r0, " + cell(kGrowI));
  emit("load.64 r1, " + cell(kGrowCap));
  emit("lt r2, r0, r1");
  emit("jz r2, obrgrow_done");
  emit("load.64 r1, " + cell(kGrowOld));
  emit("load.64 r2, " + cell(kGrowStride));
  emit("mul r0, r0, r2");
  emit("add r0, r1, r0");
  emit("ldi.64 r1, r0");
  emit("place r2, 1");
  emit("eq r3, r1, r2");
  emit("jz r3, obrgrow_step");
  emit("place r5, 64");
  emit("add r5, r0, r5");
  emit("ldi.64 r1, r5");
  emit("store.64 r1, " + cell(kGrowKey));
  emit("load.64 r2, " + cell(kGrowStride));
  emit("place r3, 192");
  emit("eq r4, r2, r3");
  emit("jz r4, obrgrow_noval");
  emit("place r5, 128");
  emit("add r5, r0, r5");
  emit("ldi.64 r1, r5");
  emit("store.64 r1, " + cell(kGrowVal));
  emit("obrgrow_noval:");
  emit("load.64 r3, " + cell(kGrowMode));
  emit("place r4, 1");
  emit("eq r4, r3, r4");
  emit("jnz r4, obrgrow_hashs");
  emit("load.64 r0, " + cell(kGrowKey));
  emit("call obrmix");
  collectJump("obrgrow_place");
  emit("obrgrow_hashs:");
  emit("load.64 r0, " + cell(kGrowKey));
  emit("call obrhash");
  emit("obrgrow_place:");
  emit("load.64 r1, " + cell(kGrowNew));
  emit("place r2, 1");
  emit("sub r1, r1, r2");
  emit("and r0, r0, r1");
  emit("store.64 r0, " + cell(kFindIndex));
  emit("obrgrow_probe:");
  emit("load.64 r1, " + cell(kGrowSlots));
  emit("load.64 r2, " + cell(kFindIndex));
  emit("load.64 r3, " + cell(kGrowStride));
  emit("mul r2, r2, r3");
  emit("add r1, r1, r2");
  emit("ldi.64 r2, r1");
  emit("place r3, 0");
  emit("eq r3, r2, r3");
  emit("jnz r3, obrgrow_put");
  emit("load.64 r0, " + cell(kFindIndex));
  emit("place r2, 1");
  emit("add r0, r0, r2");
  emit("load.64 r2, " + cell(kGrowNew));
  emit("place r3, 1");
  emit("sub r2, r2, r3");
  emit("and r0, r0, r2");
  emit("store.64 r0, " + cell(kFindIndex));
  collectJump("obrgrow_probe");
  emit("obrgrow_put:");
  emit("place r2, 1");
  emit("sti.64 r2, r1");
  emit("store.64 r1, " + cell(kFindAddr));
  emit("place r5, 64");
  emit("add r5, r1, r5");
  emit("load.64 r2, " + cell(kGrowKey));
  emit("sti.64 r2, r5");
  emit("load.64 r2, " + cell(kGrowStride));
  emit("place r3, 192");
  emit("eq r4, r2, r3");
  emit("jz r4, obrgrow_step");
  emit("load.64 r1, " + cell(kFindAddr));
  emit("place r5, 128");
  emit("add r5, r1, r5");
  emit("load.64 r2, " + cell(kGrowVal));
  emit("sti.64 r2, r5");
  emit("obrgrow_step:");
  emit("load.64 r0, " + cell(kGrowI));
  emit("place r1, 1");
  emit("add r0, r0, r1");
  emit("store.64 r0, " + cell(kGrowI));
  collectJump("obrgrow_loop");
  emit("obrgrow_done:");
  emit("load.64 r0, " + cell(kGrowObj));
  emit("place r5, 64");
  emit("add r5, r0, r5");
  emit("load.64 r1, " + cell(kGrowNew));
  emit("sti.64 r1, r5");
  emit("load.64 r0, " + cell(kGrowObj));
  emit("place r5, 128");
  emit("add r5, r0, r5");
  emit("load.64 r1, " + cell(kGrowSlots));
  emit("sti.64 r1, r5");
  emit("load.64 r7, " + cell(kGrowLink));
  emit("ret");

  auto header = [&](const std::string& name, int headerBits, int stride, int cap) {
    emit(name + ":");
    emit("store.64 r7, " + cell(kLink));
    emit("place r0, " + std::to_string(headerBits));
    emit("call obrcheap");
    emit("store.64 r0, " + cell(kObj));
    emit("place r0, " + std::to_string(cap * stride));
    emit("call obrcheap");
    emit("store.64 r0, " + cell(kVal));
    emit("load.64 r0, " + cell(kObj));
    emit("place r1, 0");
    emit("sti.64 r1, r0");
    emit("place r5, 64");
    emit("add r5, r0, r5");
    emit("place r1, " + std::to_string(cap));
    emit("sti.64 r1, r5");
    emit("load.64 r0, " + cell(kObj));
    emit("place r5, 128");
    emit("add r5, r0, r5");
    emit("load.64 r1, " + cell(kVal));
    emit("sti.64 r1, r5");
    emit("load.64 r0, " + cell(kObj));
    emit("load.64 r7, " + cell(kLink));
    emit("ret");
  };
  header("obrsnew", 192, 128, 8);
  header("obrmnew", 192, 192, 8);

}

void Generator::emitCollectAllocRoutines() {  emit("obranew:");
  emit("store.64 r7, " + cell(kLink));
  emit("place r1, 0");
  emit("lt r1, r0, r1");
  emit("jnz r1, obrhalt");
  emit("store.64 r0, " + cell(kKey));
  emit("place r1, 64");
  emit("mul r0, r0, r1");
  emit("place r1, 64");
  emit("add r0, r0, r1");
  emit("call obrcheap");
  emit("store.64 r0, " + cell(kObj));
  emit("load.64 r1, " + cell(kKey));
  emit("sti.64 r1, r0");
  emit("load.64 r0, " + cell(kObj));
  emit("load.64 r7, " + cell(kLink));
  emit("ret");

  emit("obrlnew:");
  emit("store.64 r7, " + cell(kLink));
  emit("place r0, 192");
  emit("call obrcheap");
  emit("store.64 r0, " + cell(kObj));
  emit("place r0, 256");
  emit("call obrcheap");
  emit("store.64 r0, " + cell(kVal));
  emit("load.64 r0, " + cell(kObj));
  emit("place r1, 0");
  emit("sti.64 r1, r0");
  emit("place r5, 64");
  emit("add r5, r0, r5");
  emit("place r1, 4");
  emit("sti.64 r1, r5");
  emit("load.64 r0, " + cell(kObj));
  emit("place r5, 128");
  emit("add r5, r0, r5");
  emit("load.64 r1, " + cell(kVal));
  emit("sti.64 r1, r5");
  emit("load.64 r0, " + cell(kObj));
  emit("load.64 r7, " + cell(kLink));
  emit("ret");

  auto bounds = [&](const std::string& name, bool buffered) {
    emit(name + ":");
    emit("store.64 r7, " + cell(kLink));
    emit("place r2, 0");
    emit("eq r2, r0, r2");
    emit("jnz r2, obrhalt");
    emit("store.64 r0, " + cell(kObj));
    emit("store.64 r1, " + cell(kKey));
    emit("ldi.64 r2, r0");
    emit("place r3, 0");
    emit("lt r3, r1, r3");
    emit(std::string("jnz r3, ") + (failChecks_ ? "obrfail1" : "obrhalt"));
    emit("lt r3, r1, r2");
    emit(std::string("jz r3, ") + (failChecks_ ? "obrfail1" : "obrhalt"));
    emit("place r2, 64");
    emit("mul r1, r1, r2");
    if (buffered) {
      emit("load.64 r0, " + cell(kObj));
      emit("place r5, 128");
      emit("add r5, r0, r5");
      emit("ldi.64 r0, r5");
      emit("add r0, r0, r1");
    } else {
      emit("place r2, 64");
      emit("add r1, r1, r2");
      emit("load.64 r0, " + cell(kObj));
      emit("add r0, r0, r1");
    }
    emit("load.64 r7, " + cell(kLink));
    if (failChecks_) emit("place r1, 0");
    emit("ret");
  };
  bounds("obrcidx", false);
  bounds("obrlidx", true);

}

void Generator::emitCollectListRoutines() {  emit("obrlpush:");
  emit("store.64 r7, " + cell(kLink));
  emit("place r2, 0");
  emit("eq r2, r0, r2");
  emit("jnz r2, obrhalt");
  emit("store.64 r0, " + cell(kObj));
  emit("store.64 r1, " + cell(kVal));
  emit("ldi.64 r2, r0");
  emit("store.64 r2, " + cell(kKey));
  emit("place r5, 64");
  emit("add r5, r0, r5");
  emit("ldi.64 r3, r5");
  emit("lt r4, r2, r3");
  emit("jnz r4, obrlpush_store");
  emit("place r4, 2");
  emit("mul r0, r3, r4");
  emit("store.64 r0, " + cell(kMode));
  emit("place r1, 64");
  emit("mul r0, r0, r1");
  emit("call obrcheap");
  emit("store.64 r0, " + cell(kSlot));
  emit("load.64 r0, " + cell(kObj));
  emit("place r5, 128");
  emit("add r5, r0, r5");
  emit("ldi.64 r1, r5");
  emit("load.64 r0, " + cell(kSlot));
  emit("load.64 r2, " + cell(kKey));
  emit("place r3, 0");
  emit("obrlpush_copy:");
  emit("lt r4, r3, r2");
  emit("jz r4, obrlpush_copied");
  emit("place r4, 64");
  emit("mul r4, r3, r4");
  emit("add r5, r1, r4");
  emit("ldi.64 r6, r5");
  emit("add r5, r0, r4");
  emit("sti.64 r6, r5");
  emit("place r4, 1");
  emit("add r3, r3, r4");
  emit("load.64 r2, " + cell(kKey));
  collectJump("obrlpush_copy");
  emit("obrlpush_copied:");
  emit("load.64 r0, " + cell(kObj));
  emit("place r5, 128");
  emit("add r5, r0, r5");
  emit("load.64 r1, " + cell(kSlot));
  emit("sti.64 r1, r5");
  emit("load.64 r0, " + cell(kObj));
  emit("place r5, 64");
  emit("add r5, r0, r5");
  emit("load.64 r1, " + cell(kMode));
  emit("sti.64 r1, r5");
  emit("obrlpush_store:");
  emit("load.64 r0, " + cell(kObj));
  emit("place r5, 128");
  emit("add r5, r0, r5");
  emit("ldi.64 r1, r5");
  emit("load.64 r2, " + cell(kKey));
  emit("place r3, 64");
  emit("mul r2, r2, r3");
  emit("add r1, r1, r2");
  emit("load.64 r2, " + cell(kVal));
  emit("sti.64 r2, r1");
  emit("load.64 r0, " + cell(kObj));
  emit("load.64 r1, " + cell(kKey));
  emit("place r2, 1");
  emit("add r1, r1, r2");
  emit("sti.64 r1, r0");
  emit("load.64 r7, " + cell(kLink));
  emit("ret");

  emit("obrlpop:");
  emit("store.64 r7, " + cell(kLink));
  emit("place r1, 0");
  emit("eq r1, r0, r1");
  emit("jnz r1, obrhalt");
  emit("store.64 r0, " + cell(kObj));
  emit("ldi.64 r1, r0");
  emit("place r2, 0");
  emit("eq r2, r1, r2");
  emit(std::string("jnz r2, ") + (failChecks_ ? "obrfail2" : "obrhalt"));
  emit("place r2, 1");
  emit("sub r1, r1, r2");
  emit("sti.64 r1, r0");
  emit("store.64 r1, " + cell(kKey));
  emit("place r5, 128");
  emit("add r5, r0, r5");
  emit("ldi.64 r0, r5");
  emit("place r2, 64");
  emit("mul r1, r1, r2");
  emit("add r5, r0, r1");
  emit("ldi.64 r0, r5");
  emit("load.64 r7, " + cell(kLink));
  if (failChecks_) emit("place r1, 0");
  emit("ret");

}

void Generator::emitCollectQueryRoutines() {  emit("obrsadd:");
  emit("store.64 r7, " + cell(kLink));
  emit("store.64 r0, " + cell(kObj));
  emit("store.64 r1, " + cell(kKey));
  emit("store.64 r3, " + cell(kMode));
  emit("obrsadd_retry:");
  emit("load.64 r0, " + cell(kObj));
  emit("load.64 r1, " + cell(kKey));
  emit("place r2, 128");
  emit("load.64 r3, " + cell(kMode));
  emit("call obrfind");
  collectFinishMut("obrsadd", 128, false);

  emit("obrmput:");
  emit("store.64 r7, " + cell(kLink));
  emit("store.64 r0, " + cell(kObj));
  emit("store.64 r1, " + cell(kKey));
  emit("store.64 r2, " + cell(kVal));
  emit("store.64 r3, " + cell(kMode));
  emit("obrmput_retry:");
  emit("load.64 r0, " + cell(kObj));
  emit("load.64 r1, " + cell(kKey));
  emit("place r2, 192");
  emit("load.64 r3, " + cell(kMode));
  emit("call obrfind");
  collectFinishMut("obrmput", 192, true);

  emit("obrhas:");
  emit("store.64 r7, " + cell(kLink));
  emit("call obrfind");
  emit("or r0, r1, r1");
  emit("load.64 r7, " + cell(kLink));
  emit("ret");

  emit("obrget:");
  emit("store.64 r7, " + cell(kLink));
  emit("store.64 r3, " + cell(kMode));
  emit("place r2, 192");
  emit("load.64 r3, " + cell(kMode));
  emit("call obrfind");
  emit("place r2, 1");
  emit("eq r2, r1, r2");
  emit(std::string("jz r2, ") + (failChecks_ ? "obrfail3" : "obrhalt"));
  emit("place r5, 128");
  emit("add r5, r0, r5");
  emit("ldi.64 r0, r5");
  emit("load.64 r7, " + cell(kLink));
  if (failChecks_) emit("place r1, 0");
  emit("ret");

  emit("obrremove:");
  emit("store.64 r7, " + cell(kLink));
  emit("store.64 r0, " + cell(kObj));
  emit("store.64 r3, " + cell(kMode));
  emit("load.64 r3, " + cell(kMode));
  emit("call obrfind");
  emit("place r2, 1");
  emit("eq r2, r1, r2");
  emit("jz r2, obrremove_done");
  emit("place r1, 2");
  emit("sti.64 r1, r0");
  emit("load.64 r3, " + cell(kObj));
  emit("ldi.64 r4, r3");
  emit("place r5, 1");
  emit("sub r4, r4, r5");
  emit("sti.64 r4, r3");
  emit("obrremove_done:");
  emit("load.64 r7, " + cell(kLink));
  emit("ret");
}

}
