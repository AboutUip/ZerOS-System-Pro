#include "../src/codegen/Peephole.hpp"
#include "../src/codegen/Layout.hpp"

#include <iostream>
#include <string>
#include <vector>

namespace {
int checks = 0;

void expect(bool value, const char* reason) {
  ++checks;
  if (!value) throw std::runtime_error(reason);
}

std::string optimize(const std::string& input, obr::OptimizationOptions options = {}, bool opaque = false) {
  std::string text = input;
  std::vector<obr::DebugSite> sites;
  for (char c : input) if (c == '\n') sites.push_back({"test.obr", static_cast<int>(sites.size()) + 1, "main", opaque});
  obr::peel(text, sites, options);
  std::size_t lines = 0;
  for (char c : text) if (c == '\n') ++lines;
  expect(lines == sites.size(), "删除指令后源位置数量不同步");
  for (const auto& site : sites) expect(site.file == "test.obr" && site.line > 0 && site.function == "main", "源位置丢失");
  return text;
}
}

int main() {
  try {
    expect(obr::inlineGrowthBudget(6) == 1, "小单元预算被向上取整超过 20%");
    expect(obr::inlineGrowthBudget(10) == 2, "20% 整数边界预算错误");
    expect(obr::inlineGrowthBudget(1000000) == 512, "全单元绝对成本上限错误");
    for (int cost = 0; cost <= 2600; ++cost) {
      expect(obr::inlineGrowthBudget(cost) * 5 <= cost && obr::inlineGrowthBudget(cost) <= 512,
             "内联预算超过相对或绝对上限");
    }
    std::string runtime = "helper:\nplace r1, 42\nplace r2, 7\nret\n";
    const auto runtimeOriginal = runtime;
    std::vector<obr::DebugSite> runtimeSites(4);
    obr::peel(runtime, runtimeSites);
    expect(runtime == runtimeOriginal, "手写运行时例程的多寄存器返回被 DCE 删除");
    expect(optimize("helper:\nplace r1, 42\nret\n").find("place r1, 42") != std::string::npos,
           "有源码归属的返回边界丢失可观察寄存器状态");
    const std::string finalValue = "place r0, 70\nhalt\n";
    expect(optimize(finalValue) == finalValue, "halt 出口丢失返回值");
    const std::string numeric = "place r0, 0\nplace r1, 42\njz r0, 5\nplace r1, 0\nhalt\nstore.64 r1, 4096\nhalt\n";
    expect(optimize(numeric) == numeric, "数字跳转目标被删行破坏");
    const std::string hexTarget = "place r0, 0\nplace r1, 42\njz r0, 0x5\nplace r1, 0\nhalt\nstore.64 r1, 4096\nhalt\n";
    expect(optimize(hexTarget) == hexTarget, "十六进制数字跳转目标被删行破坏");
    const std::string indirect = "place r1, 3\njmp r1\nplace r0, 0\nhalt\n";
    expect(optimize(indirect) == indirect, "间接控制流丢失目标");
    const std::string raw = "place r1, 42\nplace r0, 70\nhalt\n";
    expect(optimize(raw, {}, true) == raw, "原样汇编被改写");
    expect(optimize(raw).find("place r1") == std::string::npos, "死寄存器定义没有消除");
    const std::string arithmetic = "place r1, 6\nplace r2, 7\nmul r0, r1, r2\nhalt\n";
    expect(optimize(arithmetic) == "place r0, 42\nhalt\n", "常量传播与死代码没有配合");
    const std::string trap = "place r1, 0\ndiv r3, r0, r1\nplace r0, 70\nhalt\n";
    expect(optimize(trap).find("div r3") != std::string::npos, "删除了可能除零的操作");
    const std::string shared = "load.64 r1, 4096\nload.64 r0, 4096\nhalt\n";
    expect(optimize(shared) == shared, "共享内存重复读取被缓存");
    const std::string frame = "load.64 r4, " + std::to_string(obr::kFrame) + "\nldi.64 r0, r4\nldi.64 r0, r4\nhalt\n";
    const auto local = optimize(frame);
    expect(local.find("ldi.64 r0") == local.rfind("ldi.64 r0"), "相同私有栈槽重复读没有消除");
    const std::string alias = "load.64 r4, " + std::to_string(obr::kFrame) + "\nldi.64 r0, r4\nsti.64 r1, r2\nldi.64 r0, r4\nhalt\n";
    const auto aliased = optimize(alias);
    expect(aliased.find("ldi.64 r0") != aliased.rfind("ldi.64 r0"), "未知指针写入没有使栈槽事实失效");
    obr::OptimizationOptions disabled;
    disabled.level = 0;
    expect(optimize(arithmetic, disabled) == arithmetic, "O0 没有回到基线");
    disabled.level = 1;
    disabled.peephole = false;
    expect(optimize(arithmetic, disabled) == arithmetic, "无法独立关闭 peephole");
    disabled.peephole = true;
    disabled.fold = disabled.loadForward = disabled.deadCode = false;
    expect(optimize(arithmetic, disabled) == arithmetic, "无法独立关闭所有子 pass");
    disabled = {};
    disabled.fold = false;
    expect(optimize(arithmetic, disabled).find("mul r0") != std::string::npos, "fold 关闭开关无效");
    disabled = {};
    disabled.deadCode = false;
    expect(optimize(raw, disabled).find("place r1, 42") != std::string::npos, "dce 关闭开关无效");
    disabled = {};
    disabled.loadForward = false;
    expect(optimize(frame, disabled).find("ldi.64 r0") != optimize(frame, disabled).rfind("ldi.64 r0"), "load-forward 关闭开关无效");
    const std::string reloc = "place r1, 1048576\nplace r2, 2\nmul r0, r1, r2\nhalt\n";
    expect(optimize(reloc).find("mul") != std::string::npos, "重定位立即数被当作普通常数折叠");
    disabled = {};
    using Pass = obr::OptimizationPass;
    disabled.passes = {Pass::DeadCode, Pass::Forward, Pass::DeadCode};
    expect(optimize(arithmetic, disabled) == "place r0, 42\nhalt\n", "pass 排序或重复运行不稳定");
    disabled.passes = {Pass::Fold};
    expect(optimize(arithmetic, disabled).find("place r0, 42") != std::string::npos, "独立 fold 没有折叠");
    expect(optimize(frame, disabled) == frame, "独立 fold 意外执行 load-forward");
    disabled.passes = {Pass::LoadForward};
    expect(optimize(arithmetic, disabled) == arithmetic, "独立 load-forward 意外执行 fold");
    const auto forwardedOnly = optimize(frame, disabled);
    expect(forwardedOnly.find("ldi.64 r0") == forwardedOnly.rfind("ldi.64 r0"), "独立 load-forward 没有转发");
    disabled.passes = {Pass::Fold, Pass::LoadForward, Pass::DeadCode, Pass::Fold, Pass::DeadCode};
    expect(optimize(arithmetic, disabled) == "place r0, 42\nhalt\n", "细分 pass 重复顺序不稳定");
    disabled.fold = false;
    expect(optimize(arithmetic, disabled).find("mul r0") != std::string::npos, "显式 fold 绕过关闭开关");
    expect(!obr::optimizationPass("unknown"), "未知 pass 被注册表接受");
    const std::string ordered = "load.64 r4, " + std::to_string(obr::kFrame)
        + "\nplace r0, 6\nsti.64 r0, r4\nldi.64 r1, r4\nplace r2, 7\nmul r0, r1, r2\nhalt\n";
    disabled = {};
    disabled.passes = {Pass::LoadForward, Pass::Fold};
    expect(optimize(ordered, disabled).find("place r0, 42") != std::string::npos,
           "load-forward 产生的值没有交给后续 fold");
    disabled.passes = {Pass::Fold, Pass::LoadForward};
    expect(optimize(ordered, disabled).find("mul r0") != std::string::npos,
           "指定的 pass 顺序没有实际执行");
    disabled.passes.push_back(Pass::Fold);
    expect(optimize(ordered, disabled).find("place r0, 42") != std::string::npos,
           "第二轮 fold 没有利用前一轮转发结果");
    std::cout << "peephole-check: " << checks << " assertions passed\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
