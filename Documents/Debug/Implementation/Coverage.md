# 覆盖快照（当前实现）

> 这是 `Implementation/` 层的当前快照，不是覆盖目标，也不是调试标准。
> 命令和批次只是验证载荷。覆盖按层、边界和因果能力判断。
> 目标与缺口见 `../Roadmap.md`。观测设计要求见 `../Standard/Instrumentation.md`。
> 源行只在 `build-guest.mjs --debug-maps` 生成的同一次表下有效。与客映像不是同一次构建的旧表不能用来下结论。

状态以当前实现为准。覆盖不等于正确，也不等于性能已经解释完。

## 1. 矩阵

| 层 | 当前能看到的 | 状态 | 说明 |
|----|--------------|------|------|
| CPU 系统调用 | `svc`、`svc-reply`、服务号 | 已覆盖 | 同一核按 span 配对 |
| CPU 命令 | `command`、`command-end`、`prompt` | 已覆盖 | 服务 36 开，35 关 |
| CPU 调度 | `dispatch`、`queue`、`task-sleep`、`task-wake` | 已覆盖 | 任务级睡眠和唤醒按 pid 配对。进程 wait/exit 另有 `task waits`。诊断字在 4416 |
| CPU 安装 | `install`、目标核、长度 | 已覆盖 | 启动期无父的安装不记 |
| CPU 核心停机 | `core-stop`、原因 | 已覆盖 | `CpuSeat.forwardCoreStop` 记原因，不含前后文 |
| CPU 执行量与采样 | 命令级 `exec=N`、`instruction samples` | 部分 | 有各核条数、采样范围和 core 2/6 源行。没有完整指令环 |
| 源行映射 | `obr-debug 1/2` 到文件、行、函数 | 部分 | core 2/6 有表。core 7 外部命令没有 |
| 失败 | `HostEvent fault`、`core-stop` | 已覆盖 | 计数和原因。不含完整错误上下文 |
| 扩展口 | `exchange`、`exchange-reply`、端口、方向、`protocol ports` | 部分 | 页面发起的交换没有父 span。设备 opcode 语义仍缺 |
| NAS | `offer`、`carry`、`fill`、`xchg`、端口、字节数、父 span | 已覆盖 | 只覆盖数据面，不解释文件语义 |
| GPU | `gpu.compose`、`gpu.present cmds=N` | 部分 | 有每次呈现的绘制命令数。`accel` 未逐条记账 |
| 显示器 | 启动标记、`gpu.present`、`frame` span、`HostEvent display` | 部分 | 有页面接帧计数。没有帧内阶段耗时 |
| 内存 | 批次数、总耗时、最大批 | 部分 | 命令报告有本命令的批次。仍不按核或服务归属 |
| 键盘 | `keyboard-page`、`Input`、`KeyConsumed` | 部分 | 关联号按现行 `ZKP1` 第 7 字。页面按下到客侧 key ring 按 `A0` 配对。不到回显。发布栅栏在 6592 |
| 鼠标 | `pointer`、`pointer-dev`、`pointer-page`、`PointerConsumed` | 部分 | 普通 shell 没有指针消费者。只在 BIOS 设置页有消费区间 |
| 沙盒 | 扩展口交换、`sandbox`、`sandbox-result` | 部分 | 有命令和结果计数。没有状态和故障明细 |
| 宿主页面事件 | `HostEvent` 各类计数 | 部分 | 有计数，没有端到端配对 |
| 时钟 | `HostEvent clock`（不少于 2 毫秒） | 部分 | 长等待有计数。tick、dwell、时间片未覆盖 |
| 宿主 JS | `HostMessage`、`HostReject`、`Worker` 生命周期 | 部分 | 有板级消息、同步发送失败和线程生命周期。线程内队列仍未覆盖 |
| 指令环 | `Insn` 采样、core 2/6 源行 | 部分 | 无完整指令环。core 7 无源行表 |
| 等待与唤醒 | `wait spans`、`task waits`、`task sleeps` | 已覆盖 | 三层都有事件。短时钟等待仍未逐次记 |
| 因果边 | `task waits`、`task sleeps`、`input spans` | 部分 | 任务级和键盘关联号已接。通用请求和回复边仍未接 |

## 2. 不能写成已确认根因的内容

按 `Standard/Evidence.md`，单次会话的命令耗时、队列时间和采样归属只是线索，不是 E4 根因。这些输出留在当次运行目录，不写入本目录。

下面这些话只描述设施，不解释某条命令为什么慢：

- 采样次数不是执行次数。`time=` 是相邻采样间隔，不是函数自耗时。
- 调试页挂上之前创建的线程不会补记 `spawn`。
- 没有 `HostReject` 只说明没有同步发送失败，不说明主板已经接受每条页面消息。
- 键盘发布栅栏是 6592，任务诊断字是 4416。两格都不占用引导探针 7296，也不写进显示器尺寸 7360。
- 与客映像不是同一次构建的 `.debug` 表已作废。

## 3. 仍未解释

1. `spawn.handArgs`、`kArena`、`vfsBase`、`edit.*` 各占多少墙钟时间。现有源行只是采样归属。
2. 慢段 `write` 的执行条数和时长怎么对应。`gpu.present` 的单次样本不能单独排除它。
3. `wait` 的 queue 为什么会到几百毫秒。需要 `task sleeps` 和 `task waits` 的对照，而不是一次会话。
4. 内存全局计数里，多少属于命令，多少属于提示符之后的空转。
5. `accel` 的数量和总耗时。
6. 键盘到回显、鼠标到 shell 指针的端到端延迟。当前只到 key ring，以及 BIOS 设置页的指针消费。
7. 全部命令的分布。

## 4. 下一步

按信息量，而不是按某一条命令：

1. 固定屏幕状态重复采样，先看源行波动。
2. 对候选做单函数对照，再决定是否改。总时长噪声里不下结论。
3. 给 `accel` 做计数和总耗时，不逐条 span。
4. 用 `task sleeps` 和 `task waits` 分开 queue 里真正睡下的部分。
5. 全量命令普查仍然缺。
