#include "Generator.hpp"

#include <cstdint>
#include <cstring>

namespace obr {

std::string Generator::run(Unit& unit) {
    int mainIndex = -1;
    for (std::size_t index = 0; index < unit.functions.size(); index += 1) {
      if (unit.functions[index].exported) unit.functions[index].label = unit.functions[index].name;
      else unit.functions[index].label = "f" + std::to_string(index);
      if (unit.functions[index].name == "main") mainIndex = static_cast<int>(index);
    }
    if (mainIndex < 0) fail("没有 main");
    functions_ = &unit.functions;
    classes_ = &unit.classes;
    structs_ = &unit.structs;
    const Function& entry = unit.functions[static_cast<std::size_t>(mainIndex)];
    if (entry.body.size() == 1 && entry.body[0].kind == Stmt::Kind::Zap) {
      emitZap(entry.body[0].name);
      for (Function& function : unit.functions) {
        if (&function == &entry || !standalone(function)) continue;
        emitFunction(function);
      }
      if (needString_) {
        emitCopyRoutine();
        emitConcatRoutine();
      }
      emitUiRoutines();
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
    if (needString_) {
      emitCopyRoutine();
      emitConcatRoutine();
    }
    emitUiRoutines();
    return out_.str();
  }

std::string generate(Unit& unit) {
  Generator generator;
  return generator.run(unit);
}

}  // namespace obr
