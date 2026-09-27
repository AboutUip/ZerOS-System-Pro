#include "Generator.hpp"

#include <cstdint>
#include <cstring>

namespace obr {

std::string Generator::run(Unit& unit) {
    unit.exports.clear();
    unit.imports.clear();
    int mainIndex = -1;
    for (std::size_t index = 0; index < unit.functions.size(); index += 1) {
      Function& function = unit.functions[index];
      if (function.imported) {
        function.label = "z" + function.name;
        unit.imports.push_back(LinkName{function.name, function.label});
      } else if (function.exported && function.opcode.empty()) {
        function.label = function.name;
        unit.exports.push_back(LinkName{function.name, function.label});
      } else {
        function.label = "f" + std::to_string(index);
      }
      if (function.name == "main") mainIndex = static_cast<int>(index);
    }
    for (std::size_t left = 0; left < unit.functions.size(); left += 1) {
      for (std::size_t right = left + 1; right < unit.functions.size(); right += 1) {
        if (unit.functions[left].label == unit.functions[right].label) fail("标号重复 " + unit.functions[left].label);
      }
    }
    if (unit.shared && unit.exports.empty()) fail("动态库没有导出");
    functions_ = &unit.functions;
    classes_ = &unit.classes;
    structs_ = &unit.structs;
    auto emitStubs = [&]() {
      for (const Function& function : unit.functions) {
        if (!function.imported) continue;
        emit(function.label + ":");
        emit("halt");
      }
    };
    auto emitTails = [&]() {
      emitStubs();
      if (needString_) {
        emitCopyRoutine();
        emitConcatRoutine();
      }
      if (needCollect_) emitCollectRoutines();
      emitUiRoutines();
    };
    if (unit.shared) {
      if (mainIndex >= 0) fail("动态库不能有 main");
      for (Function& function : unit.functions) {
        if (!standalone(function)) continue;
        emitFunction(function);
      }
      emitTails();
      return out_.str();
    }
    if (mainIndex < 0) fail("没有 main");
    const Function& entry = unit.functions[static_cast<std::size_t>(mainIndex)];
    if (entry.body.size() == 1 && entry.body[0].kind == Stmt::Kind::Zap) {
      emitZap(entry.body[0].name);
      for (Function& function : unit.functions) {
        if (&function == &entry || !standalone(function)) continue;
        emitFunction(function);
      }
      emitTails();
      return out_.str();
    }
    emit("place r0, " + std::to_string(kStack));
    emit("store.64 r0, " + std::to_string(kSp));
    emit("call " + unit.functions[static_cast<std::size_t>(mainIndex)].label);
    emit("halt");
    for (Function& function : unit.functions) {
      if (!standalone(function)) continue;
      emitFunction(function);
    }
    emitTails();
    return out_.str();
  }

std::string generate(Unit& unit) {
  Generator generator;
  return generator.run(unit);
}

}  // namespace obr
