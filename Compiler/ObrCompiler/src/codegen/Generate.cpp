#include "Generator.hpp"
#include "Peephole.hpp"
#include "../type/Type.hpp"

#include <cctype>
#include <cstdint>
#include <cstring>
#include <map>

namespace obr {

/* 标号和链接目录都不能带冒号。obr::print::out 的符号是 obr_print_out。
   同一个导出名有多份时，后面再接参数类型，避免两份重载写成同一个 .zdll 符号。 */
std::string linkSymbol(const std::string& name) {
  std::string symbol;
  for (std::size_t index = 0; index < name.size(); index += 1) {
    if (name[index] == ':' && index + 1 < name.size() && name[index + 1] == ':') {
      symbol.push_back('_');
      index += 1;
      continue;
    }
    symbol.push_back(name[index]);
  }
  return symbol;
}

/* 参数类型收成符号里允许的字符。没有参数时是空串。 */
std::string paramSymbol(const Function& function) {
  std::string text;
  for (const Param& param : function.params) {
    if (!text.empty()) text.push_back('_');
    const std::string part = typeText(param.type, param.typeName, param.alt, param.altName);
    for (const char unit : part) {
      const unsigned char byte = static_cast<unsigned char>(unit);
      text.push_back(std::isalnum(byte) ? static_cast<char>(byte) : '_');
    }
  }
  return text;
}

Generated Generator::run(Unit& unit) {
    unit.exports.clear();
    unit.imports.clear();
    int mainIndex = -1;
    std::map<std::string, int> sharedNames;
    for (const Function& function : unit.functions) {
      if (!function.imported && !(function.exported && function.opcode.empty())) continue;
      sharedNames[linkSymbol(function.name)] += 1;
    }
    for (std::size_t index = 0; index < unit.functions.size(); index += 1) {
      Function& function = unit.functions[index];
      std::string symbol = linkSymbol(function.name);
      /* 只有同名导出或导入多于一份时才带上参数。单独一份仍是原来的符号。 */
      if (sharedNames[symbol] > 1) {
        symbol += "__";
        symbol += paramSymbol(function);
        if (symbol.size() > 64) fail("符号名超出范围");
      }
      if (function.imported) {
        function.label = "z" + symbol;
        unit.imports.push_back(LinkName{symbol, function.label, function.origin});
      } else if (function.exported && function.opcode.empty()) {
        function.label = symbol;
        unit.exports.push_back(LinkName{symbol, function.label, ""});
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
    jumpTables_ = !unit.shared && !unit.pie && unit.imports.empty();
    itables_ = jumpTables_;
    functions_ = &unit.functions;
    classes_ = &unit.classes;
    interfaces_ = &unit.interfaces;
    strings_ = &unit.strings;
    structConstants_ = &unit.structConstants;
    classConstants_ = &unit.classConstants;
    structs_ = &unit.structs;
    layoutConstStrings();
    auto finish = [&]() {
      Generated result{out_.str(), std::move(sites_)};
      /* 窥孔编出来的内核停在 Starting，自检画面被固件盖住。先关掉，等内核能到提示符再开。 */
      return result;
    };
    auto emitStubs = [&]() {
      for (const Function& function : unit.functions) {
        if (!function.imported) continue;
        DebugSite next;
        next.file = function.origin;
        next.function = function.name;
        next.line = function.line;
        const SiteGuard guard(*this, next);
        emit(function.label + ":");
        emit("halt");
      }
    };
    auto emitTails = [&]() {
      emitStubs();
      /* 运行时例程没有源行。清掉上一个函数，避免把它们记成用户函数。 */
      const SiteGuard guard(*this, DebugSite{});
      if (needString_) {
        emitCopyRoutine();
        emitConcatRoutine();
      }
      if (needFrom_) emitFromRoutine();
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
      return finish();
    }
    if (mainIndex < 0) fail("没有 main");
    const Function& entry = unit.functions[static_cast<std::size_t>(mainIndex)];
    site_.file = entry.origin;
    site_.function = entry.name;
    site_.line = entry.line;
    if (entry.body.size() == 1 && entry.body[0].kind == Stmt::Kind::Zap) {
      {
        const SiteGuard guard(*this, DebugSite{});
        emitConstStringInit();
      }
      emitZap(entry.body[0].name, entry.body[0].line);
      for (Function& function : unit.functions) {
        if (&function == &entry || !standalone(function)) continue;
        emitFunction(function);
      }
      emitTails();
      return finish();
    }
    {
      /* main 外面的启动指令没有语句。不把它们记到 deRfun 那一行。 */
      const SiteGuard guard(*this, DebugSite{});
      emit("place r0, " + std::to_string(kStack));
      emit("store.64 r0, " + std::to_string(kSp));
      emitConstStringInit();
      emit("call " + unit.functions[static_cast<std::size_t>(mainIndex)].label);
      emit("halt");
    }
    for (Function& function : unit.functions) {
      if (!standalone(function)) continue;
      emitFunction(function);
    }
    emitTails();
    return finish();
  }

Generated generate(Unit& unit) {
  Generator generator;
  return generator.run(unit);
}

}  // namespace obr
