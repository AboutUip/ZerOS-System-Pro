# 标准调试

本目录维护 ZerOS-System-Pro 的通用调试标准和当前观测设施说明。

它不针对某一次性能问题，也不把某组命令当成目标。命令、测试程序和工作负载只是验证手段；目标是让任意一个子系统、任意一条路径都能按同一套流程被观察、定位、验证和回归。

## 两层文档

| 层 | 目录 | 性质 | 内容 |
|----|------|------|------|
| 标准 | [Standard](./Standard/) | 规范，跨实现复用 | 方法、证据、观测设计、实验设计 |
| 实现 | [Implementation](./Implementation/) | 当前设施的 profile | 现有 trace 实现、检测点、覆盖快照、runner、v1 合同 |

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
| [V1.md](./Implementation/V1.md) | v1 交付范围、验收命令和明确不在 v1 的能力 |
| [Observability.md](./Implementation/Observability.md) | 当前 trace 页、事件、API、报告和限制 |
| [Points.md](./Implementation/Points.md) | 当前实际写入点清单 |
| [Coverage.md](./Implementation/Coverage.md) | 当前覆盖快照与已确认/未解释项 |
| [Runbook.md](./Implementation/Runbook.md) | 当前 runner、批次和操作步骤 |

## 工具

| 工具 | 回答 |
|------|------|
| [ztrace.mjs](./Tools/ztrace.mjs) | 从预览页抓取启动报告和逐条命令的原始 trace，输出 `capture.json`、`report.txt`、`capture.log`；按提示符事件判断命令完成 |
| [ztrace-check.mjs](./Tools/ztrace-check.mjs) | 校验 `capture.json` 的 schema、命令 status、report、raw entries 和停机快照字段 |
| [ztrace-corpus.json](./Tools/ztrace-corpus.json) / [ztrace-corpus.mjs](./Tools/ztrace-corpus.mjs) | 54 条 `/bin` 命令的全量完成语料、进程级硬超时和逐条汇总 |
| [ztrace-diff.mjs](./Tools/ztrace-diff.mjs) | 对比两份 capture 的结构、事件码、报告段落和停机签名；`--check` 用作门禁 |
| [ztrace-gate.mjs](./Tools/ztrace-gate.mjs) | 组合结构校验、特性段、语料覆盖和可选基线 diff |

工具的前置、参数和输出说明见 [Runbook.md](./Implementation/Runbook.md)。

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
