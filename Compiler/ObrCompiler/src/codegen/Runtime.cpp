#include "Generator.hpp"

#include "../Utf8.hpp"

#include <cstdint>
#include <cstring>
#include <vector>

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
    std::vector<std::uint32_t> scalars;
    if (!utf8Scalars(text, scalars)) fail("字符串里有不合法的 UTF-8");
    emit("place r1, " + std::to_string(scalars.size()));
    emit("sti.64 r1, r0");
    emit("place r1, " + std::to_string(64 + static_cast<int>(scalars.size()) * 32));
    emit("add r4, r4, r1");
    emit("store.64 r4, " + std::to_string(kHeapPtr));
    for (std::size_t index = 0; index < scalars.size(); index += 1) {
      emit("place r1, " + std::to_string(scalars[index]));
      emit("place r5, " + std::to_string(64 + static_cast<int>(index) * 32));
      emit("add r5, r0, r5");
      emit("sti.32 r1, r5");
    }
  }

void Generator::layoutConstStrings() {
    stringAddresses_.clear();
    structAddresses_.clear();
    classAddresses_.clear();
    stringHeapEnd_ = kHeap;
    int cursor = kHeap;
    if (strings_ != nullptr) {
      for (const std::string& text : *strings_) {
        std::vector<std::uint32_t> scalars;
        if (!utf8Scalars(text, scalars)) fail("字符串常量里有不合法的 UTF-8");
        stringAddresses_.push_back(cursor);
        const int bits = 64 + static_cast<int>(scalars.size()) * 32;
        cursor += (bits + 63) & ~63;
      }
    }
    if (structConstants_ != nullptr && structs_ != nullptr) {
      for (const ConstStruct& item : *structConstants_) {
        const StructDecl* decl = nullptr;
        for (const StructDecl& candidate : *structs_) {
          if (candidate.name == item.typeName) decl = &candidate;
        }
        if (decl == nullptr) fail("没有结构体常量类型 " + item.typeName);
        structAddresses_.push_back(cursor);
        cursor += decl->words * 64;
      }
    }
    if (classConstants_ != nullptr && classes_ != nullptr) {
      for (const ConstClass& item : *classConstants_) {
        const ClassDecl* decl = nullptr;
        for (const ClassDecl& candidate : *classes_) {
          if (candidate.name == item.typeName) decl = &candidate;
        }
        if (decl == nullptr) fail("没有类常量类型 " + item.typeName);
        const int words = decl->headerWords + static_cast<int>(decl->fields.size());
        classAddresses_.push_back(cursor);
        cursor += (words < 1 ? 1 : words) * 64;
      }
    }
    stringHeapEnd_ = cursor;
  }

void Generator::emitConstValue(int address, TypeKind type, const Expr& value) {
    if (value.kind == Expr::Kind::LitStringStatic) {
      if (value.integer < 0 || value.integer >= static_cast<long long>(stringAddresses_.size())) fail("字符串常量编号越界");
      emit("place r0, " + std::to_string(stringAddresses_[static_cast<std::size_t>(value.integer)]));
    } else if (value.kind == Expr::Kind::LitFloat) {
      emit("place r0, " + floatBits(value.number));
    } else if (value.kind == Expr::Kind::LitInt || value.kind == Expr::Kind::LitBool || value.kind == Expr::Kind::LitChar) {
      emit("place r0, " + std::to_string(value.integer));
    } else if (value.kind == Expr::Kind::LitNull) {
      emit("place r0, 0");
    } else if (value.kind == Expr::Kind::ClassConst) {
      if (value.integer < 0 || value.integer >= static_cast<long long>(classAddresses_.size())) fail("类常量编号越界");
      emit("place r0, " + std::to_string(classAddresses_[static_cast<std::size_t>(value.integer)]));
    } else if (value.kind == Expr::Kind::StructConst) {
      if (value.integer < 0 || value.integer >= static_cast<long long>(structAddresses_.size())) fail("结构体常量编号越界");
      emit("place r0, " + std::to_string(structAddresses_[static_cast<std::size_t>(value.integer)]));
    } else {
      fail("常量字段值不是常量");
    }
    emit("place r5, " + std::to_string(address));
    emitStore(type);
  }

void Generator::emitConstStringInit() {
    if (stringAddresses_.empty() && structAddresses_.empty() && classAddresses_.empty()) return;
    for (std::size_t index = 0; index < stringAddresses_.size(); index += 1) {
      const std::string& text = (*strings_)[index];
      std::vector<std::uint32_t> scalars;
      if (!utf8Scalars(text, scalars)) fail("字符串常量里有不合法的 UTF-8");
      const int address = stringAddresses_[index];
      emit("place r1, " + std::to_string(scalars.size()));
      emit("place r5, " + std::to_string(address));
      emit("sti.64 r1, r5");
      for (std::size_t item = 0; item < scalars.size(); item += 1) {
        emit("place r1, " + std::to_string(scalars[item]));
        emit("place r5, " + std::to_string(address + 64 + static_cast<int>(item) * 32));
        emit("sti.32 r1, r5");
      }
    }
    for (std::size_t index = 0; index < structAddresses_.size(); index += 1) {
      const ConstStruct& item = (*structConstants_)[index];
      const StructDecl* decl = nullptr;
      for (const StructDecl& candidate : *structs_) {
        if (candidate.name == item.typeName) decl = &candidate;
      }
      if (decl == nullptr) fail("没有结构体常量类型 " + item.typeName);
      if (item.values.size() != decl->fields.size()) fail("结构体常量字段数不对 " + item.typeName);
      for (std::size_t field = 0; field < decl->fields.size(); field += 1) {
        emitConstValue(structAddresses_[index] + decl->fields[field].offset, decl->fields[field].type, item.values[field]);
      }
    }
    for (std::size_t index = 0; index < classAddresses_.size(); index += 1) {
      const ConstClass& item = (*classConstants_)[index];
      const ClassDecl* decl = nullptr;
      for (const ClassDecl& candidate : *classes_) {
        if (candidate.name == item.typeName) decl = &candidate;
      }
      if (decl == nullptr) fail("没有类常量类型 " + item.typeName);
      if (item.values.size() != decl->fields.size()) fail("类常量字段数不对 " + item.typeName);
      if (decl->headerWords > 0) {
        emit("place r0, " + std::to_string(decl->id));
        emit("place r5, " + std::to_string(classAddresses_[index]));
        emit("sti.64 r0, r5");
      }
      for (std::size_t field = 0; field < decl->fields.size(); field += 1) {
        emitConstValue(classAddresses_[index] + decl->fields[field].offset, decl->fields[field].type, item.values[field]);
      }
    }
    emit("place r1, " + std::to_string(stringHeapEnd_));
    emit("store.64 r1, " + std::to_string(kHeapPtr));
  }

void Generator::boxChar() {
    const int code = words_ + temp_;
    hold();
    storeSlot(code, TypeKind::Long);
    emit("place r0, 96");
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
    emit("sti.32 r1, r5");
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
    emit("place r1, 32");
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
    emit("place r0, 4");
    emit("mul r2, r2, r0");
    emit("load.64 r4, 4522304");
    emit("add r3, r4, r5");
    emit("call scopy");
    emit("load.64 r4, 4522112");
    emit("place r5, 64");
    emit("add r1, r4, r5");
    emit("load.64 r2, 4522240");
    emit("place r0, 4");
    emit("mul r2, r2, r0");
    emit("load.64 r4, 4522304");
    emit("add r3, r4, r5");
    emit("load.64 r4, 4522176");
    emit("place r5, 32");
    emit("mul r4, r4, r5");
    emit("add r3, r3, r4");
    emit("call scopy");
    emit("load.64 r0, 4522304");
    emit("load.64 r7, 4521984");
    emit("ret");
  }

void Generator::emitFrom(const Expr& expr) {
    gen(expr.kids[0]);
    const int array = words_ + temp_;
    hold();
    storeSlot(array, TypeKind::Long);
    gen(expr.kids[1]);
    copy(1, 0);
    loadSlot(array, TypeKind::Long);
    release();
    emit("call sfrom");
    emit("load.64 r4, " + std::to_string(kSp));
    emit("place r5, " + std::to_string(frameBits()));
    emit("sub r4, r4, r5");
    emit("store.64 r4, " + std::to_string(kFrame));
    frameHeld_ = true;
    needFrom_ = true;
}

/* 把 array[long] 的前 count 个标量收成一份字符串。个数为 0 得到空字符串。
   个数为负、超过数组长度、或标量不在 Unicode 范围时停机。布局和字符串字面量相同。 */
void Generator::emitFromRoutine() {
    emit("sfrom:");
    emit("store.64 r7, 4784128");
    emit("store.64 r0, 4784192");
    emit("store.64 r1, 4784256");
    emit("place r2, 0");
    emit("lt r0, r1, r2");
    emit("jnz r0, sfrombad");
    emit("place r2, 0");
    emit("eq r0, r1, r2");
    emit("jnz r0, sfromalloc");
    emit("load.64 r0, 4784192");
    emit("place r2, 0");
    emit("eq r0, r0, r2");
    emit("jnz r0, sfrombad");
    emit("load.64 r0, 4784192");
    emit("ldi.64 r2, r0");
    emit("load.64 r1, 4784256");
    emit("lt r0, r2, r1");
    emit("jnz r0, sfrombad");
    emit("place r4, 0");
    emit("store.64 r4, 4784384");
    emit("sfromcheck:");
    emit("load.64 r4, 4784384");
    emit("load.64 r1, 4784256");
    emit("lt r0, r4, r1");
    emit("jz r0, sfromalloc");
    emit("load.64 r0, 4784192");
    emit("place r5, 64");
    emit("mul r5, r4, r5");
    emit("add r5, r0, r5");
    emit("place r0, 64");
    emit("add r5, r5, r0");
    emit("ldi.64 r1, r5");
    emit("place r2, 0");
    emit("lt r0, r1, r2");
    emit("jnz r0, sfrombad");
    emit("place r2, 1114111");
    emit("lt r0, r2, r1");
    emit("jnz r0, sfrombad");
    emit("place r2, 55296");
    emit("lt r0, r1, r2");
    emit("jnz r0, sfromstep");
    emit("place r2, 57343");
    emit("lt r0, r2, r1");
    emit("jz r0, sfrombad");
    emit("sfromstep:");
    emit("place r2, 1");
    emit("add r4, r4, r2");
    emit("store.64 r4, 4784384");
    emit("place r2, 1");
    emit("jnz r2, sfromcheck");
    emit("sfromalloc:");
    emit("load.64 r0, 4784256");
    emit("place r1, 32");
    emit("mul r0, r0, r1");
    emit("place r1, 64");
    emit("add r0, r0, r1");
    emit("load.64 r4, " + std::to_string(kHeapPtr));
    emit("place r5, 0");
    emit("eq r1, r4, r5");
    emit("jz r1, sfromhave");
    emit("place r4, " + std::to_string(kHeap));
    emit("sfromhave:");
    copy(1, 4);
    emit("add r4, r4, r0");
    emit("store.64 r4, " + std::to_string(kHeapPtr));
    emit("store.64 r1, 4784320");
    emit("load.64 r4, 4784256");
    emit("sti.64 r4, r1");
    emit("place r4, 0");
    emit("store.64 r4, 4784384");
    emit("sfromwrite:");
    emit("load.64 r4, 4784384");
    emit("load.64 r1, 4784256");
    emit("lt r0, r4, r1");
    emit("jz r0, sfromdone");
    emit("load.64 r0, 4784192");
    emit("place r5, 64");
    emit("mul r5, r4, r5");
    emit("add r5, r0, r5");
    emit("place r0, 64");
    emit("add r5, r5, r0");
    emit("ldi.64 r1, r5");
    emit("load.64 r0, 4784320");
    emit("place r5, 32");
    emit("mul r5, r4, r5");
    emit("add r5, r0, r5");
    emit("place r0, 64");
    emit("add r5, r5, r0");
    emit("sti.32 r1, r5");
    emit("place r2, 1");
    emit("add r4, r4, r2");
    emit("store.64 r4, 4784384");
    emit("place r2, 1");
    emit("jnz r2, sfromwrite");
    emit("sfromdone:");
    emit("load.64 r0, 4784320");
    emit("load.64 r7, 4784128");
    emit("ret");
    emit("sfrombad:");
    emit("halt");
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
      emit("place r1, 255");
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

/* 显式 cast 的整数落位。ZAP 寄存器是数学整数，右移不会自动截断，
   所以先按位宽取低位，再按有符号/无符号解释。 */
void Generator::truncate(TypeKind type) {
    if (type == TypeKind::Byte) {
      emit("place r1, 255");
      emit("and r0, r0, r1");
      return;
    }
    if (type == TypeKind::Char) {
      emit("place r1, 2097151");
      emit("and r0, r0, r1");
      const std::string ok = fresh("e");
      emit("place r1, 1114111");
      emit("le r2, r0, r1");
      emit("jnz r2, " + ok);
      emit("halt");
      emit(ok + ":");
      return;
    }
    if (type == TypeKind::Int || type == TypeKind::Short) {
      const int bits = type == TypeKind::Int ? 32 : 16;
      const long long mask = (1LL << bits) - 1;
      const long long sign = 1LL << (bits - 1);
      const long long span = 1LL << bits;
      const std::string done = fresh("e");
      emit("place r1, " + std::to_string(mask));
      emit("and r0, r0, r1");
      emit("place r1, " + std::to_string(sign));
      emit("lt r2, r0, r1");
      emit("jnz r2, " + done);
      emit("place r1, " + std::to_string(span));
      emit("sub r0, r0, r1");
      emit(done + ":");
      return;
    }
    if (type == TypeKind::Boolean) {
      emit("place r1, 0");
      emit("eq r2, r0, r1");
      emit("place r1, 1");
      emit("sub r0, r1, r2");
    }
  }

/* IEEE 754 二进制 64 转数学整数，向零截断。
   ZAP 没有 ftoi，这里按位拆指数和尾数；NaN/Inf/超出 long 范围时 halt。 */
void Generator::floatToInteger() {
    const std::string zero = fresh("e");
    const std::string big = fresh("e");
    const std::string sign = fresh("e");
    const std::string done = fresh("e");
    const std::string fail = fresh("e");
    const std::string end = fresh("e");
    emit("place r1, 0");
    emit("lt r2, r0, r1");
    emit("place r1, 9223372036854775807");
    emit("and r3, r0, r1");
    emit("place r1, 52");
    emit("shr r6, r3, r1");
    emit("place r5, 2047");
    emit("eq r0, r6, r5");
    emit("jnz r0, " + fail);
    emit("place r1, 4503599627370495");
    emit("and r5, r3, r1");
    emit("jz r6, " + zero);
    emit("place r1, 1023");
    emit("sub r6, r6, r1");
    emit("place r1, 4503599627370496");
    emit("or r5, r5, r1");
    emit("place r1, 0");
    emit("lt r0, r6, r1");
    emit("jnz r0, " + zero);
    emit("place r1, 62");
    emit("gt r0, r6, r1");
    emit("jnz r0, " + fail);
    emit("place r1, 52");
    emit("gt r0, r6, r1");
    emit("jnz r0, " + big);
    emit("sub r1, r1, r6");
    emit("shr r5, r5, r1");
    emit("place r0, 1");
    emit("jnz r0, " + sign);
    emit(big + ":");
    emit("place r1, 52");
    emit("sub r1, r6, r1");
    emit("shl r5, r5, r1");
    emit(sign + ":");
    emit("jz r2, " + done);
    emit("place r0, 0");
    emit("sub r5, r0, r5");
    emit(done + ":");
    copy(0, 5);
    /* 这里不能用 r0 做无条件跳转，否则会把刚算出的结果盖成 1。 */
    emit("place r6, 1");
    emit("jnz r6, " + end);
    emit(zero + ":");
    emit("place r5, 0");
    emit("place r0, 1");
    emit("jnz r0, " + sign);
    emit(fail + ":");
    emit("halt");
    emit(end + ":");
  }

void Generator::castValue(TypeKind from, TypeKind to) {
    if (to == TypeKind::Boolean) {
      if (from == TypeKind::Boolean) return;
      if (from == TypeKind::Float || from == TypeKind::Double) {
        truth(from);
        return;
      }
      truncate(TypeKind::Boolean);
      return;
    }
    if (to == TypeKind::Byte || to == TypeKind::Short || to == TypeKind::Int
      || to == TypeKind::Long || to == TypeKind::Char) {
      if (from == TypeKind::Float || from == TypeKind::Double) {
        floatToInteger();
      }
      truncate(to);
      return;
    }
    if (to == TypeKind::Float || to == TypeKind::Double) {
      if (from == TypeKind::Float || from == TypeKind::Double) return;
      emit("itof r0, r0");
      return;
    }
    /* 指针到指针、整数到指针只是位型不变。 */
  }

}  // namespace obr
