# 检测点清单（当前实现）

> 这是 `Implementation/` 层的写入点清单，不是标准。
> 设计要求和覆盖方法见 `../Standard/Instrumentation.md`。
> 没有列出的边界就是未覆盖，不能因为报告里没出现就当正常。

## 1. 记录点

| # | 点 | 位置 | 触发 | 记录 | 频率 |
|---|----|------|------|------|------|
| 1 | 启动阶段 | `BoardDispatch` / `__zerosBoot` | 固件打点 | 启动标记 | 一次启动 |
| 2 | 核心停机 | `CpuSeat.forwardCoreStop` | 核心停下 | `CoreStop` | 每次停机 |
| 3 | svc 进入 | `CpuRuntime.nativeSvc` / 解释器 svc | 客程序发系统调用 | `Svc` | 每次 svc |
| 4 | svc 回复 | `CpuRuntime.acceptNativeReply` / 解释器回复 | 监督核回复 | `SvcReply` | 每次回复 |
| 5 | 命令开始 | `CpuRuntime.beginSvcSpan`，服务 36 | 壳 `runParsed` | `Command` + `Svc` | 每条命令 |
| 6 | 命令结束 | 服务 35 | 壳画完提示符 | `CommandEnd` + `Prompt` | 每条命令 |
| 7 | 监督核取走 | `nativeTake` / 解释器 `take` | 取走 svc | `Dispatch` | 每次 svc |
| 8 | 执行量 | `CpuRuntime.emitCommandExec` | 命令结束 | `Exec` | 每命令每核 |
| 9 | 装载 | `CpuRuntime.installImage` | 装子程序 | `Install` | 每次安装 |
| 10 | 扩展口 | `CoreDispatch` 的 `onExchange/onFill/onCarry/onOffer` | 端口命令 | `Port` | 每次端口命令 |
| 11 | 访存批次 | `CoreDispatch.finishAccessBatchTrace` → `traceMem` | 访问批完成 | 全局计数 | 每批一次累加 |
| 12 | 显卡 | `CpuRuntime.gpu` | compose/present | `Gpu` | 每次呈现/合成 |
| 13 | 显示帧 | `BoardDispatch.onPresent` | 页面要帧 | `Frame` | 每次 Present |
| 14 | 页面事件 | `BoardDispatch.acceptBoardMessage` | Inbox/Pointer/Debug/Panel | `HostEvent` | 每批事件 |
| 15 | 键盘事件 | `KeyboardRuntime.acceptHost` | 收满 6 个字 | `HostEvent keyboard` | 每次按键事件 |
| 16 | 鼠标事件 | `PointerRuntime.acceptHost` | 收满 6 个字 | `HostEvent pointer-dev` | 每次指针事件 |
| 17 | 页面交换 | `BoardDispatch.onExchange` | 页面发起扩展口交换 | `Exchange` | 每次交换 |
| 18 | 失败记录 | `CpuRuntime.reportInstalledFault` | 客程序/核心失败 | `HostEvent fault` | 每次失败 |
| 19 | 指令采样 | `NativeCore.noteNativeInsn`、`CoreDispatch.runBurst` | 原生核 1/1024 条；局部每拍 | `Insn` | 采样，非全量 |
| 20 | 源行表 | `PageHost.loadTraceMaps` → `DebugMap.parseDebugText` | 调试开关打开且存在 `--debug-maps` 产物 | 页面全局 `__zerosDebugMaps` | 一次加载 |
| 21 | 时钟长等待 | `HostClock.waitSpan` | 等待 ≥2ms | `HostEvent clock` | 低频 |
| 22 | 沙盒命令 | `SandboxRuntime.exchangeWord` | 方向 0 命令 | `HostEvent sandbox` | 每次命令 |
| 23 | 显示接收帧 | `AcceptGpuFrame.acceptGpuFrame/acceptGpuBitmap` | 页面接帧 | `HostEvent display` | 每帧 |
| 24 | 唤醒 | `CpuRuntime.endSvcSpan` | svc 回复到达 | `Wake`（Span 指回 svc） | 每次回复 |
| 25 | 板级消息 | `BoardDispatch.acceptBoardMessage` | Power/Bind/Go/Ready/Fault/Debug 等 | `HostMessage` | 低频 |
| 26 | 沙盒结果 | `SandboxRuntime.noteGuestResult` | 结果票号匹配 | `HostEvent sandbox-result` | 每次结果 |
| 27 | 页面键盘 | `PublishKeyboard.publish` | 键盘事件打包并交给主板 | `HostEvent keyboard-page` + `Input`（A0 是 ZKP1 第 7 字） | 每次按下/连按 |
| 28 | 页面指针 | `PublishPointer.publish` | 按下/松开/滚轮交给主板 | `HostEvent pointer-page` + `Input`（A0 是 ZPP1 第 7 字） | 低频；移动不记 |
| 29 | 拒绝路径 | `BoardDispatch`/`AcceptGpuFrame` | 形状/溢出/非法 `pushInbox` 结果等 | `HostReject` | 仅失败 |
| 30 | 工作线程生命周期 | `QueuedWorker.openQueued` | 创建、引导脚本就绪 | `Worker`（spawn/ready；`A1` 为核心号） | 每线程一次 |
| 31 | 工作线程错误 | `WorkerTrace.observeWorker` | `error`/`messageerror` | `Worker` + `HostReject worker` | 仅错误 |
| 32 | 页面发送失败 | `Motherboard.sendBoard` | 同步 `postMessage` 抛出 | `HostReject page` | 仅失败 |
| 33 | 任务等待/退出 | `sig.obr` `diagTask` → `CpuSeat` | 父任务睡下或被子任务唤醒 | 诊断字 4416，`TaskWait` / `TaskExit` | 每次阻塞/唤醒 |
| 34 | 调度睡眠/唤醒 | `sched.obr` `schedSleep`/`schedWake`、`start.obr` `reply` | 任务状态切换 | 诊断字 4416，`TaskSleep` / `TaskWake` | 每次状态切换 |
| 35 | 键盘环写栅栏 | `Keys.obr` `keyOffer` | 写 key ring 次数之前 | 共享字 6592 写 0 | 每次按键消费 |
| 36 | 客侧键盘消费 | `CpuSeat.noteKeyRingCount` | 6528 次数增加 | `KeyConsumed`（A0 是 ZKP1 关联号，A1 是键值） | 每次按键消费 |
| 37 | 故障快照 | `DebugSurface` / `ztrace` | 采集启动和每条命令 | `capture.json` 的 `faults` | 每次采集 |

## 2. 报告检查点

| 检查项 | 位置 | 用途 |
|--------|------|------|
| `records` | `TracePage.traceStatus` | 当前环里有多少条 |
| `dropped` | `DroppedSlot` | 是否覆盖过旧记录 |
| `pending` | `PendingSlot` | 未回复 svc 数 |
| `prompts` | `PromptSlot` | 提示符事件数 |
| `queue` | `Dispatch` 到 svc 起点 | 排队时间 |
| `exec` | `Exec` 与命令 span | 客内核执行量 |
| `instruction samples` | `Insn` 按核/范围聚合 | 采样热区；有源行表时显示文件:行 函数；`time=` 是相邻采样间隔估算 |
| `source maps` | `__zerosDebugMaps` 状态 | core 2/6 表是否已载入 |
| `memory batches` | `MemCount/Total/Max` | 访存批次总量 |
| `host events` | `HostEvent` 计数 | 页面/设备事件数 |
| `host messages` | `HostMessage` 计数 | 板级生命周期消息数 |
| `host rejects` | `HostReject` 按来源/原因计数 | 拒绝路径；含页面同步发送和 Worker 错误 |
| `worker lifecycle` | `Worker` 按种类/阶段计数 | 线程创建/就绪/错误；不表示线程内部耗时 |
| `frame` | `Frame` span | 帧捕获/传输时间 |
| `wait spans` | `CoreStop(wait)` + `Wake` | 宿主侧等待区间；不与 svc 相加 |
| `task waits` | `TaskWait` + `TaskExit` | 父任务等子任务的 pid/ppid/退出码/时长 |
| `task sleeps` | `TaskSleep` + `TaskWake` | 任务级睡眠区间；按 pid 配对 |
| `input spans` | `Input` + `KeyConsumed` | 页面按下的键到客侧 key ring 消费；按 ZKP1 唯一关联号配对 |
| `pointer spans` | `Input` + `PointerConsumed` | 未接；ZPP1 设备查询码 10 可用，但 shell 没有指针消费者 |
| `protocol ports` | `Port` span 聚合 | 端口/种类次数与字节数 |
| `other spans` | 无父 span | 未归类边界，不强行归类 |

## 3. 已接但样本不足

| 点 | 原因 |
|----|------|
| `Frame` | `Frame` span 当前批次没有稳定触发；接近 `Present` 处 |
| `HostEvent display` | 有少量接收帧样本；没有帧内阶段耗时 |
| `HostEvent clock` | 只覆盖 ≥2ms 的长等待；短等待未记 |
| `HostEvent sandbox` | 本轮未运行沙盒命令，未触发 |
| `pointer-dev` | runner 没有驱动鼠标 |
| `HostEvent panel` | 面板参数只在启动/换档时出现 |
| `HostEvent debug` | 只在调试运行路径出现 |
| `Worker` | 只在创建线程已经挂上 trace 页时记录；GPU/内存线程没有内部 trace |
| `HostReject page` | 只有同步 `postMessage` 失败才触发；正常路径不会出现 |
| `pointer spans` | 普通 shell 没有指针消费者；只在 BIOS 设置页出现 |

## 4. 未接

| 边界 | 原因 | 下一步 |
|------|------|--------|
| 时钟短等待 | `waitSpan` 高频，逐次 span 会污染环 | 总量计数或采样 |
| GPU `accel` 单条 | 频率高，未逐条记 | 只记 `present` 的 `cmds` 数 |
| 源行映射 | core 2/6 已接；core 7 外部命令没有 `.debug` 表 | 命令构建时生成 `.debug` 或按任务切换表 |
| 鼠标到 shell 指针 | 普通 shell 没有指针消费者 | 需要 GUI 消费者 |
| 宿主 JS 内部 | 没有 profiler/sampling | 单独采样 |
| 工作线程内部 | 只有生命周期；没有线程内消息队列/逐条耗时 | 需要线程内探针时单独加，不按消息记 |
| 页面到主板 ack | 成功只表示交给 Worker | 需要时做宿主侧计数 |
| 指令环 | B1/B2 采样和 core 2/6 源行已接；无完整指令环 | 有界全量/指令环 |
| 协议字节直方图 | 只有 NAS 端口字节数 | 扩展口分类计数 |
| 显示/GPU 阶段拆分 | 只有 `gpu.present cmds=N` | GPU 线程内部探针 |

## 5. 维护规则

- 新增写入点必须同时更新本表和 `Coverage.md`。
- 删除写入点前先确认 `TraceReport` 和采集工具不再读取它。
- 采样点必须写明采样条件和可能漏掉的量。
- 没有父编号的点可以留 `parent=0`，但必须在报告里归到 `other spans`，不能伪造父子关系。
- 共享内存写点必须说明栅栏/可见性。键盘环的次数写入之前写 6592，任务诊断字在 4416。两格都记在 `Bios.obr`，不占用引导探针 7296，也不写进显示器尺寸 7360。
- 固件扫描扩展口时按 `ZKP1` 匹配；设备也用 `ZKP1`，不会因标识不匹配在 BIOS 直接 `halt()`。
