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
    expect(local.find("ldi.64 r0") != local.rfind("ldi.64 r0"), "仅凭帧指针来源就消除了没有范围证明的读取");
    const std::string knownFrame = "place r4, " + std::to_string(obr::kStack) + "\nldi.64 r0, r4\nldi.64 r0, r4\nhalt\n";
    const auto knownLocal = optimize(knownFrame);
    expect(knownLocal.find("ldi.64 r0") == knownLocal.rfind("ldi.64 r0"), "已证明完整私有范围的重复读没有消除");
    const std::string alias = "load.64 r4, " + std::to_string(obr::kFrame) + "\nldi.64 r0, r4\nsti.64 r1, r2\nldi.64 r0, r4\nhalt\n";
    const auto aliased = optimize(alias);
    expect(aliased.find("ldi.64 r0") != aliased.rfind("ldi.64 r0"), "未知指针写入没有使栈槽事实失效");
    // 可重定位的高地址经算术移动后可以落入小绝对地址区；在 slot 0 两者会指向同一字。
    // 两次写入分别通过这两种来源，最后读取必须看到第二次的 9，不能沿用第一次的 7。
    std::string crossed = "place r4, " + std::to_string(obr::kStack) + "\nplace r5, 1040000\n";
    int remaining = obr::kStack - 4096;
    while (remaining >= 1040000) {
      crossed += "sub r4, r4, r5\n";
      remaining -= 1040000;
    }
    crossed += "place r5, " + std::to_string(remaining) + "\nsub r4, r4, r5\n";
    const std::string escapedReads = crossed + "ldi.64 r0, r4\nldi.64 r0, r4\nhalt\n";
    const auto escaped = optimize(escapedReads);
    expect(escaped.find("ldi.64 r0, r4") != escaped.rfind("ldi.64 r0, r4"),
           "指针移出私有区后，仍错误缓存共享内存读取");
    crossed += "place r0, 7\nsti.64 r0, r4\nplace r3, 4096\nplace r0, 9\nsti.64 r0, r3\nldi.64 r0, r4\nhalt\n";
    expect(optimize(crossed).find("ldi.64 r0, r4") != std::string::npos,
           "地址算术跨越重定位分类后，别名写入没有使旧值失效");
    // 同样的逃逸也可能起于运行时装入的帧指针，不能只检查数值型地址来源。
    std::string symbolic = "place r1, " + std::to_string(obr::kStack) + "\nstore.64 r1, "
        + std::to_string(obr::kFrame) + "\nplace r1, 0\nload.64 r4, "
        + std::to_string(obr::kFrame) + "\n";
    symbolic += crossed.substr(crossed.find("place r5"), crossed.find("place r0, 7") - crossed.find("place r5"));
    const auto symbolicReads = optimize(symbolic + "ldi.64 r0, r4\nldi.64 r0, r4\nhalt\n");
    expect(symbolicReads.find("ldi.64 r0, r4") != symbolicReads.rfind("ldi.64 r0, r4"),
           "运行时帧指针移出私有区后仍被当作私有地址");
    // 从零算出的地址不会获得重定位分类，但 slot 0 上仍可与私有字的绝对地址相同。
    std::string distinctOrigins = "place r4, " + std::to_string(obr::kStack)
        + "\nplace r0, 7\nsti.64 r0, r4\nplace r3, 0\nplace r5, 1040000\n";
    remaining = obr::kStack;
    while (remaining >= 1040000) {
      distinctOrigins += "add r3, r3, r5\n";
      remaining -= 1040000;
    }
    distinctOrigins += "place r5, " + std::to_string(remaining) + "\nadd r3, r3, r5\n";
    distinctOrigins += "place r0, 9\nsti.64 r0, r3\nldi.64 r0, r4\nhalt\n";
    expect(optimize(distinctOrigins).find("ldi.64 r0, r4") != std::string::npos,
           "同一私有字的不同来源地址被错误判定为不重叠");
    const std::string crossingRead = "place r4, " + std::to_string(obr::kUi - 8)
        + "\nldi.64 r0, r4\nldi.64 r0, r4\nhalt\n";
    const auto crossingReads = optimize(crossingRead);
    expect(crossingReads.find("ldi.64 r0, r4") != crossingReads.rfind("ldi.64 r0, r4"),
           "跨越私有区上界的完整访问被错误缓存");
    const std::string lastPrivateWord = "place r4, " + std::to_string(obr::kUi - 64)
        + "\nldi.64 r0, r4\nldi.64 r0, r4\nhalt\n";
    const auto withinBoundary = optimize(lastPrivateWord);
    expect(withinBoundary.find("ldi.64 r0, r4") == withinBoundary.rfind("ldi.64 r0, r4"),
           "完整落在私有区末尾的访问失去转发资格");
    // 即使完整帧指针合法且按 64 位对齐，窄加载也只得到其低位，不再是该私有指针。
    const std::string narrowFrame = "place r1, " + std::to_string(obr::kStack + 53248)
        + "\nstore.64 r1, " + std::to_string(obr::kFrame)
        + "\nplace r1, 0\nload.16 r4, " + std::to_string(obr::kFrame)
        + "\nldi.64 r0, r4\nldi.64 r0, r4\nhalt\n";
    const auto narrowReads = optimize(narrowFrame);
    expect(narrowReads.find("ldi.64 r0, r4") != narrowReads.rfind("ldi.64 r0, r4"),
           "窄加载帧指针后错误继承私有地址资格");
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
    expect(optimize(knownFrame, disabled).find("ldi.64 r0") != optimize(knownFrame, disabled).rfind("ldi.64 r0"), "load-forward 关闭开关无效");
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
    const auto forwardedOnly = optimize(knownFrame, disabled);
    expect(forwardedOnly.find("ldi.64 r0") == forwardedOnly.rfind("ldi.64 r0"), "独立 load-forward 没有转发");
    disabled.passes = {Pass::Fold, Pass::LoadForward, Pass::DeadCode, Pass::Fold, Pass::DeadCode};
    expect(optimize(arithmetic, disabled) == "place r0, 42\nhalt\n", "细分 pass 重复顺序不稳定");
    disabled.fold = false;
    expect(optimize(arithmetic, disabled).find("mul r0") != std::string::npos, "显式 fold 绕过关闭开关");
    expect(!obr::optimizationPass("unknown"), "未知 pass 被注册表接受");
    const std::string ordered = "place r4, " + std::to_string(obr::kStack)
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
