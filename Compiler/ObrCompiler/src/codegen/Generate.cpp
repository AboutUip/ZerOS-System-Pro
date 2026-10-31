#include "Generator.hpp"
#include "Peephole.hpp"
#include "../image/NativeImage.hpp"

#include <cstdint>
#include <cstring>

namespace obr {

Generated Generator::run(Unit& unit) {
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
    // scaled 是 native 后端的内部行，PIE/shared/导入程序必须保留可写入 ZPB1 的通用 lowering。
    nativeTarget_ = !options_.genericMemory && !unit.pie && !unit.shared && unit.imports.empty();
    auto finish = [&]() {
      Generated result{out_.str(), std::move(sites_)};
      // 源位置和原样汇编边界一起经过流水线；O0 与单 pass 开关可回到基线定位。
      if (nativeTarget_ && (result.text.find("load.scale ") != std::string::npos || result.text.find("store.scale ") != std::string::npos)
          && !nativeLoweringReady(result.text)) {
        OptimizationOptions fallback = options_;
        fallback.genericMemory = true;
        return Generator(fallback).run(unit);
      }
      peel(result.text, result.sites, options_);
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

Generated generate(Unit& unit, const OptimizationOptions& options) {
  Generator generator(options);
  return generator.run(unit);
}

}  // namespace obr
