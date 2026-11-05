# ZTrace Debugger

本目录是 ZerOS 调试器的独立工程目录，和 `BuildSystem`、`ObrCompiler`、`ObrExtension` 并列。

## 名称

- 产品名：**ZTrace**
- 命令行：`ztrace`
- 采集 schema：**v1.1 使用 `zeros.ztrace.capture/2`**；v1.0 的 `/1` 仍可读
- 后续可视化层如需独立品牌，可用 `ZTrace Studio`；运行时记录器可用 `ZTrace Recorder`

选择 `ZTrace` 是为了延续现有 `ztrace.mjs`、capture schema 和文档，不在 v2 前制造改名成本。

## 边界

- 必须运行在客程序、宿主 trace 页或硬件线程内的实现，继续留在 `ZerOS-PRO/Hardware/Diagnostics/`，不迁入本目录。
- 本目录只承载调试器自身的工具、格式、CLI、查看器、测试和文档。
- v1.1 工具已统一放在 `Compiler/Debugger/Tools/`；本目录是唯一工具入口。

## 工具

| 工具 | 回答 |
|------|------|
| [ztrace.mjs](./Tools/ztrace.mjs) | 从预览页抓取启动报告和逐条命令的原始 trace，输出 `capture.json`、`report.txt`、`capture.log`；按提示符事件判断命令完成 |
| [ztrace-check.mjs](./Tools/ztrace-check.mjs) | 校验 `capture.json` 的 schema、命令 status、report、raw entries 和停机快照字段 |
| [ztrace-corpus.json](./Tools/ztrace-corpus.json) / [ztrace-corpus.mjs](./Tools/ztrace-corpus.mjs) | 54 条 `/bin` 命令的全量完成语料、进程级硬超时和逐条汇总 |
| [ztrace-diff.mjs](./Tools/ztrace-diff.mjs) | 对比两份 capture 的结构、事件码、报告段落和停机签名；`--check` 用作门禁 |
| [ztrace-gate.mjs](./Tools/ztrace-gate.mjs) | 组合结构校验、特性段、语料覆盖和可选基线 diff |
| [ztrace-sched-gate.mjs](./Tools/ztrace-sched-gate.mjs) | 调度门禁：检出客调用已交出却没有回复、监督核随后消失的卡死 |
| [ztrace-scope.mjs](./Tools/ztrace-scope.mjs) | ObservationScope 工具侧第 1/2 步：按观测域筛选 capture（窗口/core/op/service/pid/At/span），svc 配对判读，命名 scope 会话（定义/激活/停用/审计日志）与任务域动态成员；`--out-file` 写 UTF-8 + BOM 报告；只读，不改产品 |
| [ztrace-scope-test.mjs](./Tools/ztrace-scope-test.mjs) | ztrace-scope 第 1 步自证：用旧卡死与修复后 capture 断言不制造误判 |
| [ztrace-scope-session-test.mjs](./Tools/ztrace-scope-session-test.mjs) | ztrace-scope 第 2 步自证：诊断字反解、任务图缺边、会话落盘/审计、动态切换、direct/core-attributed 分离 |

工具的前置、参数和输出说明见 `Documents/Debug/Implementation/Runbook.md`。

## 当前阶段

**ZTrace v1.1 已交付（2026-11-02，工作区基线）；v2 P4 进行中。**

- v1.1 合同：`Documents/Debug/Implementation/V1.1.md`
- v1.1 交付计划：`dev/Plan/ZTrace-v1.1.md`
- 完整 v2 计划：`dev/Plan/ZTrace-v2.md`（`dev/` 不进版本库）
- 入口条件摘要：`Documents/Debug/Roadmap.md` 第 5 节 G0–G7
- v1.1 运行入口是 `Compiler/Debugger/Tools/`；不迁移 Hardware 实现，不改 v1.1 CLI/schema。
