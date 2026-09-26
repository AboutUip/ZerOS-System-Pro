#include "Generator.hpp"

#include <cstdint>
#include <cstring>

namespace obr {

std::string Generator::floatBits(double value) {
    std::int64_t bits = 0;
    std::memcpy(&bits, &value, sizeof(bits));
    return std::to_string(bits);
  }

void Generator::bump() {
    const int size = words_ + temp_ - 1;
    const std::string ready = fresh("e");
    emit("load.64 r4, " + std::to_string(kHeapPtr));
    emit("place r5, 0");
    emit("eq r1, r4, r5");
    emit("jz r1, " + ready);
    emit("place r4, " + std::to_string(kHeap));
    emit(ready + ":");
    copy(0, 4);
    const int dest = words_ + temp_;
    hold();
    storeSlot(dest, TypeKind::Long);
    loadSlot(size, TypeKind::Long);
    copy(5, 0);
    emit("add r4, r4, r5");
    emit("store.64 r4, " + std::to_string(kHeapPtr));
    loadSlot(dest, TypeKind::Long);
    release();
  }

void Generator::emitString(const std::string& text) {
    const std::string ready = fresh("e");
    emit("load.64 r4, " + std::to_string(kHeapPtr));
    emit("place r5, 0");
    emit("eq r0, r4, r5");
    emit("jz r0, " + ready);
    emit("place r4, " + std::to_string(kHeap));
    emit(ready + ":");
    copy(0, 4);
    emit("place r1, " + std::to_string(text.size()));
    emit("sti.64 r1, r0");
    emit("place r1, " + std::to_string(64 + static_cast<int>(text.size()) * 8));
    emit("add r4, r4, r1");
    emit("store.64 r4, " + std::to_string(kHeapPtr));
    for (std::size_t index = 0; index < text.size(); index += 1) {
      emit("place r1, " + std::to_string(static_cast<unsigned char>(text[index])));
      emit("place r5, " + std::to_string(64 + static_cast<int>(index) * 8));
      emit("add r5, r0, r5");
      emit("sti.octet r1, r5");
    }
  }

void Generator::boxChar() {
    const int code = words_ + temp_;
    hold();
    storeSlot(code, TypeKind::Long);
    emit("place r0, 72");
    const int size = words_ + temp_;
    hold();
    storeSlot(size, TypeKind::Long);
    bump();
    release();
    const int dest = words_ + temp_;
    hold();
    storeSlot(dest, TypeKind::Long);
    loadSlot(code, TypeKind::Long);
    copy(1, 0);
    loadSlot(dest, TypeKind::Long);
    emit("place r2, 1");
    emit("sti.64 r2, r0");
    emit("place r5, 64");
    emit("add r5, r0, r5");
    emit("sti.octet r1, r5");
    loadSlot(dest, TypeKind::Long);
    release();
    release();
  }

void Generator::concat() {
    needString_ = true;
    emit("call sconcat");
    emit("load.64 r4, " + std::to_string(kSp));
    emit("place r5, " + std::to_string(frameBits()));
    emit("sub r4, r4, r5");
    emit("store.64 r4, " + std::to_string(kFrame));
    frameHeld_ = true;
  }

void Generator::emitConcatRoutine() {
    emit("sconcat:");
    emit("store.64 r7, 4521984");
    emit("store.64 r1, 4522048");
    emit("store.64 r2, 4522112");
    emit("ldi.64 r4, r1");
    emit("ldi.64 r5, r2");
    emit("store.64 r4, 4522176");
    emit("store.64 r5, 4522240");
    emit("add r0, r4, r5");
    emit("place r1, 8");
    emit("mul r0, r0, r1");
    emit("place r1, 64");
    emit("add r0, r0, r1");
    emit("load.64 r4, " + std::to_string(kHeapPtr));
    emit("place r5, 0");
    emit("eq r1, r4, r5");
    emit("jz r1, shave");
    emit("place r4, " + std::to_string(kHeap));
    emit("shave:");
    copy(1, 4);
    emit("add r4, r4, r0");
    emit("store.64 r4, " + std::to_string(kHeapPtr));
    emit("store.64 r1, 4522304");
    emit("load.64 r4, 4522176");
    emit("load.64 r5, 4522240");
    emit("add r4, r4, r5");
    emit("sti.64 r4, r1");
    emit("load.64 r4, 4522048");
    emit("place r5, 64");
    emit("add r1, r4, r5");
    emit("load.64 r2, 4522176");
    emit("load.64 r4, 4522304");
    emit("add r3, r4, r5");
    emit("call scopy");
    emit("load.64 r4, 4522112");
    emit("place r5, 64");
    emit("add r1, r4, r5");
    emit("load.64 r2, 4522240");
    emit("load.64 r4, 4522304");
    emit("add r3, r4, r5");
    emit("load.64 r4, 4522176");
    emit("place r5, 8");
    emit("mul r4, r4, r5");
    emit("add r3, r3, r4");
    emit("call scopy");
    emit("load.64 r0, 4522304");
    emit("load.64 r7, 4521984");
    emit("ret");
  }

void Generator::emitCopyRoutine() {
    emit("scopy:");
    emit("store.64 r7, 4587520");
    emit("place r0, 0");
    emit("schead:");
    emit("lt r4, r0, r2");
    emit("jz r4, sdone");
    emit("place r5, 8");
    emit("mul r4, r0, r5");
    emit("add r4, r1, r4");
    emit("ldi.octet r5, r4");
    emit("place r4, 8");
    emit("mul r4, r0, r4");
    emit("add r4, r3, r4");
    emit("sti.octet r5, r4");
    emit("place r4, 1");
    emit("add r0, r0, r4");
    emit("place r4, 1");
    emit("jnz r4, schead");
    emit("sdone:");
    emit("load.64 r7, 4587520");
    emit("ret");
  }

void Generator::asFloat() {
    if (true) {
      emit("itof r0, r0");
    }
  }

void Generator::truth(TypeKind type) {
    if (type == TypeKind::Boolean || type == TypeKind::Byte) return;
    if (type == TypeKind::String) {
      const std::string empty = fresh("e");
      const std::string done = fresh("e");
      emit("place r1, 0");
      emit("eq r2, r0, r1");
      emit("jnz r2, " + empty);
      emit("ldi.64 r0, r0");
      emit("eq r0, r0, r1");
      emit("place r1, 1");
      emit("sub r0, r1, r0");
      emit("place r1, 1");
      emit("jnz r1, " + done);
      emit(empty + ":");
      emit("place r0, 0");
      emit(done + ":");
      return;
    }
    if (type == TypeKind::Undefined) {
      emit("place r0, 0");
      return;
    }
    if (type == TypeKind::Float || type == TypeKind::Double) {
      emit("place r1, " + floatBits(0));
      emit("feq r0, r0, r1");
    } else {
      emit("place r1, 0");
      emit("eq r0, r0, r1");
    }
    emit("place r1, 1");
    emit("sub r0, r1, r0");
  }

void Generator::narrow(TypeKind type) {
    if (type == TypeKind::Byte) {
      emit("place r1, 1");
      emit("and r0, r0, r1");
      return;
    }
    if (type == TypeKind::Boolean) {
      emit("place r1, 0");
      emit("eq r2, r0, r1");
      emit("place r1, 1");
      emit("sub r0, r1, r2");
    }
  }

}  // namespace obr
