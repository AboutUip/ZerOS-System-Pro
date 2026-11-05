# ZTrace 调试设施

本目录维护 **ZTrace** 的标准和 v1.1 观测设施说明。ZTrace 是 ZerOS 专用的调试器，目标是成为官方性能分析与故障取证链的一环。

它不针对某一次性能问题，也不把某组命令当成目标。命令、测试程序和工作负载只是验证手段；目标是让任意一个子系统、任意一条路径都能按同一套流程被观察、定位、验证和回归。

当前交付版本是 **v1.1**（2026-11-02），合同见 [V1.1.md](./Implementation/V1.1.md)。v1.0 的 [V1.md](./Implementation/V1.md) 保留为历史。

v2 的完整立项计划在本地 `dev/Plan/ZTrace-v2.md`，不进入版本库；仓库内只保留命名、目录边界和入口条件摘要。v1.1 的本地交付计划见 `dev/Plan/ZTrace-v1.1.md`。

## 两层文档

| 层 | 目录 | 性质 | 内容 |
|----|------|------|------|
| 标准 | [Standard](./Standard/) | 规范，跨实现复用 | 方法、证据、观测设计、实验设计 |
| 实现 | [Implementation](./Implementation/) | 当前设施的 profile | 现有 trace 实现、检测点、覆盖快照、runner、v1.1 合同 |

[Roadmap](./Roadmap.md) 是可复用的能力路线图，不是某次性能任务的待办。

## 权威顺序

1. `Documents/Protocol/` 是协议权威。调试设施不改协议。
2. `Standard/` 是调试方法权威。所有实验和报告按它执行。
3. `Implementation/` 描述当前实现；它可以落后于标准，但不能冒充标准。一次实验的原始输出留在运行目录，不写入本目录。

## 标准文档

| 文档 | 回答 |
|------|------|
| [Method.md](./Standard/Method.md) | 一次调试从问题定义到回归，按什么顺序做 |
| [Evidence.md](./Standard/Evidence.md) | 什么算证据，怎样测量、比较和陈述 |
| [Instrumentation.md](./Standard/Instrumentation.md) | 观测点怎样设计，覆盖怎样算完整，开销怎样约束 |
| [Experiments.md](./Standard/Experiments.md) | 对照实验、重复、超时、原始数据和失败处理 |

## 实现文档

| 文档 | 回答 |
|------|------|
| [V1.1.md](./Implementation/V1.1.md) | v1.1 交付范围、验收结果和明确不在 v1.1 的能力 |
| [V1.md](./Implementation/V1.md) | v1.0 历史合同，保留作基线记录 |
| [Observability.md](./Implementation/Observability.md) | 当前 trace 页、事件、API、报告和限制 |
| [Points.md](./Implementation/Points.md) | 当前实际写入点清单 |
| [Coverage.md](./Implementation/Coverage.md) | 当前覆盖快照与已确认/未解释项 |
| [Runbook.md](./Implementation/Runbook.md) | 当前 runner、批次和操作步骤 |

## 工具

工具入口、工具清单和运行说明归 [Compiler/Debugger](../../Compiler/Debugger/README.md) 管理；`Documents/Debug/` 只保留 `.md` 文档。

运行在宿主、trace 页和硬件线程里的实现仍留在 `ZerOS-PRO/Hardware/Diagnostics/`。

## 基本原则

1. **面向问题，不面向命令**。命令只是测试向量；换一条命令不应改变调试方法。
2. **先复现，再观测，再定位，再修改**。没有基线不动代码。
3. **区分实测、推断、未覆盖**。没有观测点就写未覆盖，不写「正常」。
4. **一次只改一个变量**。修复前后用同一实验、同一噪声条件比较。
5. **观测有成本**。关闭时惰性；开启时有预算；高频事件用计数或采样，不逐条写环。
6. **原始数据不可改**。报告是派生视图；异常先回查原始记录。
7. **不伪造因果**。没有父子或边就留空；时间窗不能自动变成因果。
8. **协议与结构边界**。调试设施默认不改协议。线格式以 `Documents/Protocol/` 为准；开发期可在同一协议标识下原位更新正文并记录，发布后要改字段必须先升版本并改协议正文。不加 CPU 指令、不改任务结构；客程序不能读原始 trace。

## 维护规则

- 改标准：先证明现有标准在真实调试中不足，再改 `Standard/`；同一轮更新受影响的实现文档。
- 改实现：更新 `Implementation/` 和 `Points.md`；覆盖状态必须与写入点一致。
- 得结论：留在当次运行的输出目录。不在本目录追加日期记录。
- 移动文件：保持相对链接有效，并在 `README.md` 更新入口。
- 本地工作期间不因调试新增大量提交或 tag；需要提交时按 `Standard/Method.md` 的改动纪律执行。
