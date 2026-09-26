#include "Generator.hpp"

#include <cstdint>
#include <cstring>

namespace obr {

void Generator::emit(const std::string& line) {
    out_ << line << "\n";
    const bool call = line.rfind("call ", 0) == 0 || line == "ret" || (!line.empty() && line.back() == ':');
    const std::size_t dest = line.find(" r");
    const bool writesFrame = dest != std::string::npos && line.compare(dest, 3, " r4") == 0 && line.rfind("store", 0) != 0;
    if (call || writesFrame) frameHeld_ = false;
  }

void Generator::copy(int dest, int src) {
    if (dest == src) return;
    emit("or r" + std::to_string(dest) + ", r" + std::to_string(src) + ", r" + std::to_string(src));
  }

std::string Generator::fresh(const std::string& prefix) { return prefix + std::to_string(labels_++); }

int Generator::frameBits() const { return (words_ + kTemps) * 64; }

void Generator::frameBase() {
    emit("load.64 r4, " + std::to_string(kFrame));
  }

void Generator::address(int slot) {
    slot = locate(slot);
    if (slot < 0) {
      const bool held = frameHeld_;
      emit("place r5, " + std::to_string(kStatic + (-slot - 1) * 128 + 64));
      frameHeld_ = held;
      return;
    }
    if (!frameHeld_) frameBase();
    emit("place r5, " + std::to_string(slot * 64));
    emit("add r5, r4, r5");
    frameHeld_ = true;
  }

void Generator::emitStore(TypeKind type) {
    if (type == TypeKind::Float || type == TypeKind::Double) emit("sti.f64 r0, r5");
    else if (type == TypeKind::Short) emit("sti.16 r0, r5");
    else if (type == TypeKind::Int || type == TypeKind::Char) emit("sti.32 r0, r5");
    else if (type == TypeKind::Long || type == TypeKind::Ptr || type == TypeKind::String) emit("sti.64 r0, r5");
    else emit("sti.64 r0, r5");
  }

void Generator::emitLoad(TypeKind type) {
    if (type == TypeKind::Float || type == TypeKind::Double) emit("ldi.f64 r0, r5");
    else if (type == TypeKind::Short) emit("ldi.16 r0, r5");
    else if (type == TypeKind::Int || type == TypeKind::Char) emit("ldi.32 r0, r5");
    else if (type == TypeKind::Long || type == TypeKind::Ptr || type == TypeKind::String) emit("ldi.64 r0, r5");
    else emit("ldi.64 r0, r5");
  }

void Generator::emitZap(const std::string& body) {
    std::size_t index = 0;
    while (index < body.size()) {
      std::size_t end = body.find('\n', index);
      if (end == std::string::npos) end = body.size();
      std::string line = body.substr(index, end - index);
      const std::size_t trim = line.find_first_not_of(" \t");
      if (trim == std::string::npos) line.clear();
      else if (trim > 0) line = line.substr(trim);
      if (!line.empty()) emit(line);
      index = end < body.size() ? end + 1 : end;
    }
    frameHeld_ = false;
  }

void Generator::storeSlot(int slot, TypeKind type) {
    address(slot);
    emitStore(type);
  }

void Generator::loadSlot(int slot, TypeKind type) {
    address(slot);
    emitLoad(type);
  }

int Generator::spill() {
    const int slot = words_ + temp_;
    temp_ += 1;
    if (temp_ > kTemps) fail("表达式临时槽不够");
    storeSlot(slot, TypeKind::Long);
    temp_ -= 1;
    return slot;
  }

void Generator::hold() { temp_ += 1; }

void Generator::release() { temp_ -= 1; }

int Generator::keep(int reg) {
    copy(0, reg);
    const int slot = words_ + temp_;
    hold();
    storeSlot(slot, TypeKind::Long);
    return slot;
  }

}  // namespace obr
