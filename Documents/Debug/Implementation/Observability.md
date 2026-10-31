# 观测设施（当前实现）

> 这是 `Implementation/` 层：描述当前仓库里的参考实现，不是调试标准。
> 规范见 `../Standard/Instrumentation.md`；实现可以落后于标准，但不能冒充标准。

本文描述当前仓库里的宿主侧 trace 实现。它是实现说明，不是协议。

## 1. 开关与线程

`/boot/debug` 是唯一总开关。

- 打开：页面线程调用 `openTracePage()` 建立 `SharedArrayBuffer`，经 `page.Trace(...)` 交给主板、CPU 线程和核心工作线程。
- 关闭：页面线程调用 `closeTracePage()`；已挂载线程看到启用位为 0 后不再写。开启位、时钟、记录环都在下一次开页重建。
- 关闭状态下，`traceSpanBegin` 返回 0，`traceInstant`、`traceSpanEnd`、`traceMem` 直接返回。不分配编号，不读时钟。

挂载关系：

```text
页面线程
  └─ TracePage（SharedArrayBuffer）
       ├─ 主板线程（扩展口、启动、呈现）
       ├─ CPU 线程（svc、命令、安装、显卡、调度取走）
       └─ 核心工作线程（端口命令、访存批次计数）
```

报告在页面线程读回，不写回。

GPU 和内存线程没有挂 trace 页：它们不写 `Port`/`Insn`，也不写自己的 `Worker` 事件。它们的创建、就绪和 `error`/`messageerror` 由创建它们的主板线程观察；主板线程自己由页面线程观察。创建时还没挂页的线程不会补记 `spawn`/`ready`，只从下一次能看到的生命周期开始。

## 2. 页布局

文件：`ZerOS-PRO/Hardware/Diagnostics/Config/TraceConfig.ts`

| 项 | 值 |
|----|----|
| 魔数 | `0x5a545243` |
| 版本 | `1` |
| 容量 | `65536` 条 |
| 记录宽度 | `32` 字节 |
| 头部 | `64` 字节 |
| 页大小 | `64 + 65536 × 32` 字节 |

头部按 32 位字：

| 字 | 名称 | 说明 |
|----|------|------|
| 0 | `HeadSlot` | 已写条数，原子加 |
| 1 | `DroppedSlot` | 被覆盖的条数 |
| 2 | `EnabledSlot` | `1` 收记录 |
| 3 | `CapacitySlot` | 容量 |
| 4 | `VersionSlot` | 版本 |
| 5 | `MagicSlot` | 魔数 |
| 6 | `SeqSlot` | 每格序号 |
| 7 | `PendingSlot` | 未回复 svc 数 |
| 8 | `PromptSlot` | 提示符事件数 |
| 9 | `SpanSlot` | span 编号分配器 |
| 10–11 | 起始时刻 | `Float64`，偏移 40 字节 |
| 12 | `MemCountSlot` | 访存批次数 |
| 13 | `MemTotalSlot` | 访存总耗时，微秒 |
| 14 | `MemMaxSlot` | 单批最大耗时，微秒 |
| 15 | 未用 | — |

注意：10–11 必须留给起始时刻。它们曾经和 `PromptSlot`/`SpanSlot` 重叠，导致 span 编号从浮点高位开始，`clear` 还会清零时钟。当前偏移是 40 字节。

## 3. 记录

每条记录 32 字节：

| 偏移 | 字段 | 类型 | 说明 |
|------|------|------|------|
| 0 | `seq` | `int32` | 先清 0，写完再写序号；读方两次一致才收 |
| 4 | `Op` | `uint8` | 事件码 |
| 5 | `Layer` | `uint8` | 层 |
| 6 | `Core` | `uint16` | 核号；宿主事件用 `-1` |
| 8 | `At` | `uint32` | 从会话起点起的微秒 |
| 12 | `A0` | `int32` | 服务号、端口、原因或编码后的种类 |
| 16 | `A1` | `int32` | 方向、字节数、耗时或第二个参数 |
| 20 | `Span` | `uint32` | span 编号；0 表示不是 span |
| 24 | `Parent` | `uint32` | 父 span；0 表示没有父 |

写入顺序：清序号 → 写字段 → 写序号。满页覆盖最旧。

## 4. 事件码

| 码 | 名称 | 写入方 | 参数 |
|----|------|--------|------|
| 1 | `Svc` | CPU | `A0` 服务号 |
| 2 | `SvcReply` | CPU | `A0` 服务号 |
| 3 | `Exchange` | 主板 | `A0` 端口，`A1` 方向 |
| 4 | `ExchangeReply` | 主板 | 同上 |
| 5 | `CoreStop` | 主板 | `A0` 停机原因 |
| 6 | `Prompt` | CPU | `Span` 指向命令根 |
| 7 | `Command` | CPU | 命令根开始 |
| 8 | `CommandEnd` | CPU | 命令根结束 |
| 9 | `Install` | CPU | `A0` 目标核，`A1` 长度 |
| 10 | `InstallEnd` | CPU | 同上 |
| 11 | `Port` | 核心线程 | `A0 = 端口 + 种类×256`，`A1` 字节数/方向 |
| 12 | `PortEnd` | 核心线程 | 同上 |
| 13 | `Dispatch` | CPU | 监督核取走 svc；`Span` 指向该 svc |
| 14 | `Gpu` | CPU | `A0` 1=compose，2=present；`A1` 本次绘制命令数 |
| 15 | `GpuEnd` | CPU | 同上 |
| 16 | `HostEvent` | 主板/键盘/鼠标 | `A0` 种类，`A1` 键号或字数 |
| 17 | `Frame` | 主板 | 显示帧开始 |
| 18 | `FrameEnd` | 主板 | 显示帧结束 |
| 19 | `Exec` | CPU | `A0` 命令期间执行条数，`Span` 指向命令 |
| 20 | `Insn` | CPU/核心 | `A0` ZAP 指令号或原生相对位地址，`A1` 执行条数（原生单条采样为 1） |
| 21 | `Wake` | CPU | svc 回复到达；`Span` 指回同一个 svc，与 `CoreStop(wait)` 按 span 配对 |
| 22 | `HostMessage` | 主板 | 板级生命周期消息，`A0` 为稳定编号 |
| 23 | `HostReject` | 页面/主板/显示 | `A0` 来源，`A1` 原因；只记拒绝路径 |
| 24 | `Worker` | 页面/主板 | `A0 = (种类 << 8) \| 阶段`，`A1` 为核心号或 0；只记创建/就绪/错误 |
| 25 | `TaskWait` | 主板 | `A0` 等待者 pid，`A1` 目标 pid（`-1` 表示任意子任务） |
| 26 | `TaskExit` | 主板 | `A0 = 子 pid × 65536 + 退出码`，`A1` 父 pid |
| 27 | `TaskSleep` | 主板 | `A0` 任务 pid，`A1` 核心 |
| 28 | `TaskWake` | 主板 | `A0` 任务 pid，`A1` 核心 |
| 29 | `Input` | 页面 | `A0` ZKP1/ZPP1 第 7 字关联号，`A1` 键值（键盘）或种类（鼠标） |
| 30 | `KeyConsumed` | 主板 | `A0` ZKP1 关联号，`A1` 键值 |
| 31 | `PointerConsumed` | 主板 | `A0` ZPP1 关联号，`A1 = 横坐标 × 65536 + 纵坐标` |

端口种类：1=`xchg`，2=`fill`，3=`carry`，4=`offer`。

`Worker` 种类：1=`board`，2=`cpu`，3=`core`，4=`gpu`，5=`memory`。阶段：1=`spawn`，2=`ready`，3=`error`，4=`message-error`。`spawn`/`ready`/`error`/`message-error` 都只在创建线程上观察；GPU 和内存线程本身没有挂 trace 页，它们的内部代码不写事件。

`HostReject` 来源：1=`inbox`，2=`pointer`，3=`frame`，4=`exchange`，5=`debug`，6=`unknown`，7=`buffer`，8=`page`，9=`worker`。原因：1=`shape`，2=`overflow`，3=`unknown`，4=`buffer`，5=`timeout`，6=`invalid`，7=`clone`。`page` 只在页面同步 `postMessage` 失败时出现；`worker` 只在 Worker 的 `error`/`messageerror` 监听上出现。`timeout` 留给已有等待路径，同步发送本身没有超时。

`HostEvent` 种类：1=`pointer`（页面交来鼠标）、2=`inbox`（页面交来入站字）、3=`debug`（调试运行）、4=`panel`（面板参数）、5=`keyboard`（键盘收满一次事件）、6=`pointer-dev`（鼠标收满一次事件）、7=`fault`（失败记录）、8=`clock`（≥2ms 的宿主等待）、9=`sandbox`（沙盒命令）、10=`display`（页面接收帧，A1 为像素数）、11=`sandbox-result`（沙盒结果，A1 为成功/失败）、12=`keyboard-page`（页面键盘事件，A1 为键号；同步交给主板成功后才记）、13=`pointer-page`（页面按下/松开/滚轮，A1 为种类；移动不记；同步交给主板成功后才记）。

`Port` 的 `A1`：`xchg` 是方向；`fill/carry/offer` 是字节数。

## 5. 层

| 值 | 名称 | 用途 |
|----|------|------|
| 1 | `Host` | 命令、提示符、安装、显卡 |
| 2 | `Core` | 核心线程与访存计数 |
| 3 | `Protocol` | 扩展口 |
| 4 | `Syscall` | 系统调用 |
| 5 | `Sched` | 监督核取走 |
| 6 | `Boot` | 启动标记 |

## 6. 父与子

- 命令根：壳在 `runParsed` 开始发服务 36；宿主开 `Command` span。提示符服务 35 关闭 `CommandEnd`，同时记 `Prompt`。
- 普通 svc：父是本核当前命令 span。没有命令时 `parent=0`。
- 子核：宿主在 `installImage` 装入子程序时，把正在处理的 svc span 继承给目标核。子核后面的 svc 挂在这个父下。这是真实因果边，不是时间窗猜测。
- 端口：父由 `beginCommand` 随命令带到核心线程；监督核用当前 svc，其它核用本核命令或继承 span。
- 安装：父是当前 svc；启动期没有父的安装不记。
- 显卡：只记 `compose/present`，父是当前 svc/命令。`accel` 不逐条记。
- 无法确定父时保持 0。报告把这类 span 放在 `other spans (no command parent)`，不强行归档。

## 7. API

| 函数 | 线程 | 说明 |
|------|------|------|
| `openTracePage()` | 页面 | 建立页，返回 SAB |
| `attachTracePage(buffer)` | 主板/CPU/核心 | 挂上同一块 SAB |
| `closeTracePage()` / `detachTracePage()` | 页面/持有方 | 清启用位并摘视图 |
| `traceBuffer()` | 页面/主板 | 当前 SAB，未开页为 `null` |
| `traceEnabled()` | 任意 | 启用位是否为 1 |
| `traceInstant(op, layer, core, a0, a1)` | 任意 | 写一条无 span 事件 |
| `traceSpanBegin(op, layer, core, parent, a0, a1)` | 任意 | 开 span，返回编号；关闭时返回 0 |
| `traceSpanEnd(op, layer, core, span, a0, a1)` | 任意 | 关 span |
| `traceSpanEvent(op, layer, core, span, parent, a0, a1)` | 任意 | 写挂已有 span 的事件 |
| `traceMem(count, total, max)` | 核心 | 累加访存批次计数 |
| `traceMemStatus()` | 页面 | 读访存计数 |
| `traceStatus()` | 页面 | 记录数、pending、dropped、prompts |
| `readTrace()` | 页面 | 按时间读回记录；写到一半的格子丢掉 |
| `clearTrace()` | 页面 | 清头、span 计数、访存计数和格子 |

调试入口：`ZerOSDebug.trace.report()`（文本）、`.dump()`（原始记录数组）、`.status()`、`.clear()`。控制台和全局各有一份入口，取决于调试开关落点。

仓库内的 `Documents/Debug/Tools/ztrace.mjs` 把 `report`、`dump`、`status` 组合成可保存的 `capture.json`；它是研发团队使用的默认入口。

## 8. 报告

`TraceReport.ts` 只读记录和 `__zerosBoot`，生成纯文本：

- `records / dropped / pending / prompts / boot marks`
- `command` 树：`command → svc → port / install / gpu.present cmds=N`
- 命令根上的 `exec=N`：命令期间各核执行的指令条数之和
- `instruction samples`：各核的采样范围；原生每 1024 条一条，局部突发每拍一条。`time=` 是相邻采样的间隔估算，超过 50ms 的跨空档不计入
- `source maps`：core 2 的 `start.debug`（`obr-debug 2`）和 core 6 的 `sh.debug`（`obr-debug 1`）是否已载入
- `service totals`
- `longest calls`
- `exchanges`
- `protocol ports`：按端口/种类统计次数和字节
- `core stops`
- `wait spans`：按 svc span 配对的 `CoreStop(wait)` → `Wake` 宿主侧区间，显示服务名
- `memory batches`：全局计数，不按 span 归属
- `host events`：按种类计数
- `host messages`：板级生命周期消息计数
- `host rejects`：拒绝路径的来源/原因计数
- `worker lifecycle`：工作线程的 `spawn`/`ready`/`error`/`message-error` 计数
- `verdict`
- `boot`

`queue` 是 svc 从发出到监督核取走的时间。没有 `Dispatch` 事件时，`queue` 不显示。`exec` 是条数，不是时间；它回答「客内核执行了多少」，不回答「哪条语句慢」。`insn` 是采样范围，不是完整指令环；原生采样按 64 字节窗口聚合，有源行表时按源行聚合。`insn` 的 `time=` 是相邻采样间隔的估算，不是函数内部计时。`wait spans` 是宿主侧 `CoreStop(wait)` → `Wake` 的区间；svc 等待会和 `svc` span 重叠，不能相加，也不等于任务级因果。`frame` 和 `host events` 是宿主边界；键盘/鼠标的设备完成事件与页面事件的端到端配对尚未实现。`worker lifecycle` 只回答「哪个线程何时创建/就绪/报错」，不回答线程内部哪条消息慢；`ready` 之前没有挂页的线程只能看到后续错误，`fault` 消息仍只走原有失败记录，不在 `Worker` 里重复。

## 9. 源行映射

源行表是**可选调试工件**，不是发布产物。默认客映像构建不生成，普通构建会删除旧表；需要时显式构建：

```text
node ZerOS-PRO/Hardware/Nas/Server/build-guest.mjs --debug-maps
```

调试开关打开时，页面通过 NAS 读取：

- `/kernel/start.debug`：`obr-debug 2`，首列是位地址，映射到 core 2。
- `/os/sh.debug`：`obr-debug 1`，首列是指令号，映射到 core 6。

`DebugMap.parseDebugText` 同时接受两种表头。原生表只给指令起始地址，解析时把每段补到下一条起始地址，采样落在指令中间也能查。对照表暂存在页面全局 `__zerosDebugMaps`，报告按核解析源行。

限制：

- 只加载 core 2 和 core 6 两份；core 7 的外部命令没有 `.debug` 表，显示 `#地址`。
- 表是异步读取的。报告里 `source maps: not started/loading` 表示没有生成、还没读完或已按普通构建清理，不是没有源行。
- 表必须与客映像同一次构建；旧表会给出错误行号，比没有表更危险。普通构建会删除旧表。
- 无名行会被跳过；原生表中间的无名段会落到上一个有名源行，可能误归属。看到 `unknown.obr` 或可疑归属时先回查原始表。
- 源行是采样归属，不是逐条全量；同一函数出现次数是采样次数，不是执行次数。`time=` 由相邻采样时间差估算，不能当作函数自耗时。


## 10. 明确限制

- 记录环 65,536 条（调试模式约 2MB）。`dropped` 大于 0 时，样本不完整。
- `pending` 在报告时可能仍为 1，因为提示符 svc 的回复可能还没写回。
- 访存计数是全局的，不区分核、svc 或命令；它只回答「内存批次总共占了多少」，不能单独归因。
- GPU 只覆盖 `compose/present`；`accel` 顶点/字形命令没有逐条记账。
- 键盘、鼠标、显示器帧、沙盒已有宿主事件/帧 span，但没有端到端配对；时钟 tick、宿主 JS 内部还没有 span。
- `Worker` 只有创建/就绪/`error`/`messageerror` 四类低频点；没有线程内消息队列深度、每条消息的耗时，也没有 `fault` 消息的第二次记录。
- GPU 和内存线程没有 trace 页；它们的生命周期只从主板线程观察，线程内部失败仍走原有 `fault`/超时路径。
- 页面到主板的 `postMessage` 没有 ack；同步失败会记 `HostReject page`，成功只表示已经交给 Worker，不表示主板接受。`keyboard-page`/`pointer-page` 只在同步交给 Worker 成功后出现；页面事件和主板 `inbox`/`keyboard`/`pointer` 计数只能按顺序和时间对照，不能按编号配对。
- B1 只有采样范围，没有完整指令环。core 2/6 已能映射源行；core 7 的外部命令没有 `.debug` 表。
- 源行是采样归属，不是逐条全量；同一函数出现次数是采样次数，不是执行次数。`time=` 由相邻采样时间差估算，不能当作函数自耗时。
- `exec` 只有总条数；`insn` 只有采样，不是逐条全量。
- 有宿主侧 `CoreStop(wait)` → `Wake` 区间，也有 `TaskWait`/`TaskExit` 和 `TaskSleep`/`TaskWake`；但 `TaskSleep` 只知道任务睡/醒，不解释等待对象。
- 键盘有页面按下到客侧 key ring 的 `input spans`，按 ZKP1 第 7 字唯一关联号配对；不到回显。
- 鼠标只在 BIOS 设置页消费指针事件；普通 shell 没有指针消费者，不能声称“鼠标到 shell 指针”。ZPP1 查询码 `10` 在设备层可用。
- `Keys.obr` 在写 key ring 次数前写 6592；没有这次写，槽数据和次数可能乱序可见，终端收不到按键。任务诊断字在 4416。两格都不占用引导探针 7296，也不写进显示器尺寸 7360。
- 固件扫描扩展口时按 `ZKP1` 匹配；设备也用 `ZKP1`，不会因标识不匹配在 BIOS 直接 `halt()`，内核可以启动。
- 显示帧 span 已接在 `Present` 上，但当前批次没有稳定触发，样本不足。
- 扩展口交换有 begin/end，但页面发起的交换没有父 span。

## 11. 实现位置

| 路径 | 职责 |
|------|------|
| `Hardware/Diagnostics/Config/TraceConfig.ts` | 页形状、头部槽位 |
| `Hardware/Diagnostics/Enum/TraceOp.ts` | 事件码、层、名字 |
| `Hardware/Diagnostics/Structure/TraceEntry.ts` | 读回记录结构 |
| `Hardware/Diagnostics/Host/TracePage.ts` | 开页、挂页、写、读、清 |
| `Hardware/Diagnostics/Host/TraceReport.ts` | 配对、组树、文本报告 |
| `Hardware/Diagnostics/Host/WorkerTrace.ts` | 工作线程生命周期、`error`/`messageerror`、页面拒绝点 |
| `Hardware/Motherboard/Host/QueuedWorker.ts` | 打开五类 Worker；挂生命周期监听 |
| `Hardware/Display/Host/PageHost.ts` | 调试开关与页面入口 |
| `Hardware/Cpu/Bootstrap/CpuRuntime.ts` | svc、命令、安装、取走、显卡 span、执行计数、原生父 span |
| `Hardware/Cpu/Native/NativeCore.ts` | 原生指令采样 |
| `Hardware/Cpu/Host/CoreDispatch.ts` | 端口 span、局部突发采样、访存计数 |
| `Hardware/Motherboard/Host/BoardDispatch.ts` | 页面交换、帧、宿主事件 span |
| `Hardware/Motherboard/Bootstrap/Motherboard.ts` | 页面到主板的统一发送口、同步失败拒绝 |
| `Hardware/Keyboard/Bootstrap/KeyboardRuntime.ts` | 键盘完成事件 |
| `Hardware/Pointer/Bootstrap/PointerRuntime.ts` | 鼠标完成事件 |
| `Hardware/Debug/Host/DebugMap.ts` | `obr-debug 1/2` 源行表 |
| `Hardware/Nas/Bootstrap/NasRuntime.ts` | 调试对照表只读加载 |
| `Hardware/Motherboard/Seat/CpuSeat.ts` | 核心挂载与 trace 转发 |
