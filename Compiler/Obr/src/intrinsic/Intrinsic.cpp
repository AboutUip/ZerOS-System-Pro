#include "Intrinsic.hpp"

#include "../Diagnostic.hpp"

#include <initializer_list>
#include <string>

namespace obr {

const OpcodeSpec* opcodeSpec(const std::string& name) {
  static const OpcodeSpec table[] = {
      {"gpu::box", "gpu.box", TypeKind::Long, 6, 0, true, false},
      {"gpu::text", "gpu.text", TypeKind::Long, 5, 0, true, false},
      {"gpu::align", "gpu.align", TypeKind::Void, 3, 0, false, false},
      {"gpu::paint", "gpu.paint", TypeKind::Void, 3, 0, false, false},
      {"gpu::glyph", "gpu.glyph", TypeKind::Void, 2, 0, false, false},
      {"gpu::drop", "gpu.drop", TypeKind::Void, 1, 0, false, false},
      {"gpu::compose", "gpu.compose", TypeKind::Void, 0, 0, false, false},
      {"gpu::present", "gpu.present", TypeKind::Void, 0, 0, false, false},
      {"gpu::accel", "gpu.accel", TypeKind::Long, 5, 0, true, false},
      {"port::state", "port.state", TypeKind::Long, 1, 1, false, false},
      {"port::char", "port.char", TypeKind::Long, 2, 1, false, false},
      {"query", "query", TypeKind::Long, 3, 1, false, false},
      {"inbox", "inbox", TypeKind::Long, 1, 0, false, false},
      {"xchg", "xchg", TypeKind::Long, 3, 1, false, true},
      {"halt", "halt", TypeKind::Void, 0, 0, false, false},
      {"memory::loadOctet", "ldi.octet", TypeKind::Long, 1, 1, false, false},
      {"memory::load16", "ldi.16", TypeKind::Long, 1, 1, false, false},
      {"memory::load32", "ldi.32", TypeKind::Long, 1, 1, false, false},
      {"memory::load64", "ldi.64", TypeKind::Long, 1, 1, false, false},
      {"memory::loadFloat32", "ldi.f32", TypeKind::Long, 1, 1, false, false},
      {"memory::loadFloat64", "ldi.f64", TypeKind::Double, 1, 1, false, false},
      {"memory::storeOctet", "sti.octet", TypeKind::Void, 2, 0, false, false},
      {"memory::store16", "sti.16", TypeKind::Void, 2, 0, false, false},
      {"memory::store32", "sti.32", TypeKind::Void, 2, 0, false, false},
      {"memory::store64", "sti.64", TypeKind::Void, 2, 0, false, false},
      {"memory::storeFloat32", "sti.f32", TypeKind::Void, 2, 0, false, false},
      {"memory::storeFloat64", "sti.f64", TypeKind::Void, 2, 0, false, false},
      {"memory::hertz", "mem.hertz", TypeKind::Void, 1, 0, false, false},
      {"memory::metric", "mem.metric", TypeKind::Long, 1, 1, false, false},
  };
  for (const OpcodeSpec& spec : table) {
    if (name == spec.name) return &spec;
  }
  return nullptr;
}

bool sameShape(const Function& function, std::initializer_list<TypeKind> kinds, TypeKind ret) {
  if (function.ret != ret || function.params.size() != kinds.size()) return false;
  std::size_t index = 0;
  for (const TypeKind kind : kinds) {
    if (function.params[index].type != kind) return false;
    index += 1;
  }
  return true;
}

bool libraryFunction(const Function& function) {
  if (function.name == "obr::ui::pad") return sameShape(function, {TypeKind::Long, TypeKind::Long}, TypeKind::Long);
  if (function.name == "obr::ui::span" || function.name == "obr::ui::alignStart" || function.name == "obr::ui::alignCenter" || function.name == "obr::ui::alignEnd" || function.name == "obr::ui::rgb") {
    return sameShape(function, {TypeKind::Long, TypeKind::Long, TypeKind::Long}, TypeKind::Long);
  }
  if (function.name == "obr::ui::lerp") return sameShape(function, {TypeKind::Long, TypeKind::Long, TypeKind::Long, TypeKind::Long}, TypeKind::Long);
  if (function.name == "obr::ui::advance") return sameShape(function, {TypeKind::Long}, TypeKind::Long);
  if (function.name == "obr::ui::textWidth") {
    return sameShape(function, {TypeKind::Long, TypeKind::String}, TypeKind::Long) || sameShape(function, {TypeKind::Long, TypeKind::Long, TypeKind::String}, TypeKind::Long);
  }
  if (function.name == "obr::ui::align" || function.name == "obr::ui::ease") {
    return sameShape(function, {TypeKind::Long, TypeKind::Long, TypeKind::Long, TypeKind::Long}, TypeKind::Long);
  }
  if (function.name == "obr::ui::meter") return sameShape(function, {TypeKind::Long, TypeKind::Long, TypeKind::Long}, TypeKind::Long);
  if (function.name == "obr::ui::clear") return sameShape(function, {TypeKind::Long, TypeKind::Long}, TypeKind::Void);
  if (function.name == "obr::ui::rect" || function.name == "obr::ui::glyph") {
    return sameShape(function, {TypeKind::Long, TypeKind::Long, TypeKind::Long, TypeKind::Long, TypeKind::Long, TypeKind::Long}, TypeKind::Void);
  }
  if (function.name == "obr::ui::text") {
    return sameShape(function, {TypeKind::Long, TypeKind::Long, TypeKind::Long, TypeKind::String, TypeKind::Long, TypeKind::Long}, TypeKind::Void)
        || sameShape(function, {TypeKind::Long, TypeKind::Long, TypeKind::Long, TypeKind::Long, TypeKind::String, TypeKind::Long, TypeKind::Long}, TypeKind::Void);
  }
  if (function.name == "obr::ui::clip") return sameShape(function, {TypeKind::Long, TypeKind::Long, TypeKind::Long, TypeKind::Long}, TypeKind::Void);
  if (function.name == "obr::ui::round") {
    return sameShape(function, {TypeKind::Long, TypeKind::Long, TypeKind::Long, TypeKind::Long, TypeKind::Long, TypeKind::Long, TypeKind::Long}, TypeKind::Void);
  }
  if (function.name == "obr::ui::ellipse") {
    return sameShape(function, {TypeKind::Long, TypeKind::Long, TypeKind::Long, TypeKind::Long, TypeKind::Long, TypeKind::Long}, TypeKind::Void);
  }
  if (function.name == "obr::ui::bar") {
    return sameShape(function, {TypeKind::Long, TypeKind::Long, TypeKind::Long, TypeKind::Long, TypeKind::Long, TypeKind::Long, TypeKind::Long, TypeKind::Long, TypeKind::Long, TypeKind::Long}, TypeKind::Void);
  }
  if (function.name == "obr::ui::translate") return sameShape(function, {TypeKind::Long, TypeKind::Long}, TypeKind::Void);
  if (function.name == "obr::ui::shadow") {
    return sameShape(function, {TypeKind::Long, TypeKind::Long, TypeKind::Long, TypeKind::Long, TypeKind::Long}, TypeKind::Void);
  }
  if (function.name == "obr::ui::save" || function.name == "obr::ui::restore" || function.name == "obr::ui::unclip" || function.name == "obr::ui::present" || function.name == "obr::ui::noshadow") {
    return sameShape(function, {}, TypeKind::Void);
  }
  if (function.name == "obr::ui::frame" || function.name == "obr::ui::key" || function.name == "obr::ui::enter" || function.name == "obr::ui::width" || function.name == "obr::ui::height") {
    return sameShape(function, {}, TypeKind::Long);
  }
  std::size_t count = 0;
  if (function.name == "obr::math::abs") count = 1;
  else if (function.name == "obr::math::min" || function.name == "obr::math::max") count = 2;
  else if (function.name == "obr::math::clamp") count = 3;
  else return false;
  if (function.params.size() != count) return false;
  if (function.ret != TypeKind::Int && function.ret != TypeKind::Long) return false;
  for (const Param& param : function.params) {
    if (param.type != function.ret) return false;
  }
  return true;
}

void bindOpcode(Function& function) {
  const OpcodeSpec* spec = opcodeSpec(function.name);
  if (spec == nullptr) return;
  if (std::string(spec->opcode) == "inbox") {
    if (function.ret != TypeKind::Long || function.params.size() != 1 || function.params[0].type != TypeKind::Ptr || function.params[0].pointee != TypeKind::Long) {
      fail("指令声明与通用指令不一致 " + function.name);
    }
    if (!function.body.empty()) fail("指令不能再写函数体 " + function.name);
    function.opcode = spec->opcode;
    function.opcodeArg0 = spec->arg0;
    function.opcodeResultR6 = spec->resultR6;
    function.opcodeCopyLast = spec->copyLast;
    return;
  }
  if (function.ret != spec->ret || static_cast<int>(function.params.size()) != spec->count) {
    fail("指令声明与通用指令不一致 " + function.name);
  }
  for (std::size_t index = 0; index < function.params.size(); index += 1) {
    const TypeKind type = function.params[index].type;
    if (std::string(spec->opcode) == "sti.f64" && index == 0) {
      if (type != TypeKind::Double) fail("指令参数必须是 double " + function.name);
      continue;
    }
    if (std::string(spec->opcode) == "gpu.accel" && index >= 1) {
      if (type != TypeKind::Double) fail("指令参数必须是 double " + function.name);
      continue;
    }
    if (type != TypeKind::Long) fail("指令参数必须是 long " + function.name);
  }
  if (!function.body.empty()) fail("指令不能再写函数体 " + function.name);
  function.opcode = spec->opcode;
  function.opcodeArg0 = spec->arg0;
  function.opcodeResultR6 = spec->resultR6;
  function.opcodeCopyLast = spec->copyLast;
}

}  // namespace obr
