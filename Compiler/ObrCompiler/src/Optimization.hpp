#pragma once

#include <string>
#include <optional>
#include <string_view>
#include <vector>

namespace obr {

/** 机器 IR 的变换使用同一注册表；CLI 和执行器不能各自维护一套名称。 */
enum class OptimizationPass { Forward, Fold, LoadForward, DeadCode };

/** 增长必须严格不超过原始单元成本的 20%；小单元不能因向上取整获得额外名额。 */
constexpr int inlineGrowthBudget(int totalCost) {
  if (totalCost <= 0) return 0;
  return totalCost / 5 < 512 ? totalCost / 5 : 512;
}

inline std::optional<OptimizationPass> optimizationPass(std::string_view name) {
  if (name == "forward") return OptimizationPass::Forward;
  if (name == "fold") return OptimizationPass::Fold;
  if (name == "load-forward") return OptimizationPass::LoadForward;
  if (name == "dce") return OptimizationPass::DeadCode;
  return std::nullopt;
}

/** 宿主编译选项，不进入语言、ZAP 或映像头。O0 保留原生成路径并关闭新优化；正确性修复不回退。 */
struct OptimizationOptions {
  int level = 1;
  bool genericMemory = false; // 内部回退：不可整段 native 时重新用通用访存 lowering。
  bool peephole = true;
  bool fold = true;
  bool loadForward = true;
  bool deadCode = true;
  bool compactNative = true;
  bool scaled = true;
  bool inlineSmall = true;
  std::string nativeReport;
  std::vector<OptimizationPass> passes; // 空列表使用级别默认顺序；显式顺序最多 8 个 pass。

  bool compact() const { return level > 0 && compactNative; }
};

}  // namespace obr
