# 官方虚拟内存 API

命名空间：`ZerOS.Hardware.Memory`。  
本文只记录**这一份官方实现**已经导出的符号，以及 `Test` / `Initialize` 的实际步骤。字段的符合性规则在 ZMP1，不在这里复述。

其它虚拟内存实现要满足的是 ZMP1 与 ZVHP1，不是下表里的函数名和标定数字。

## 1. 引导

主机入口是 Boot 给主板通电。主板再 `MemorySlot.Bind(ActiveMemoryProvider)`，然后 `MachineMemory.MemoryInit.Test()`，通过后再 `MachineMemory.MemoryInit.Initialize()`。内存自己不 Bind。

| 符号 | 种类 | 官方行为 |
|------|------|----------|
| `ActiveMemoryProvider` | 常量 | 当前插头。默认等于 `ReferenceMemoryProvider` |
| `ReferenceMemoryProvider` | 常量 | `ProviderId = "ZerOS-Reference-Memory"`，`ProviderVendor = "ZerOS-Team"`，`ActiveProtocol = "ZMP1"`，`MachineMemory.MemoryInit` 指向 `MemoryInitInstance` |
| `MachineMemory.MemoryInit` | 读取 | 若插座上还没有 Active，先 Bind `ActiveMemoryProvider`，再返回其 `MemoryInit`。Bind 之后仍无 Active 时抛出 `[ZerOS.Hardware.Memory.MachineMemory]` |
| `MemoryInitInstance` | 常量 | 官方 `MemoryInit` 对象 |
| `MemoryInitInstance.__MemoryInitBrand` | 字段 | 固定字符串 `"MemoryInit"`。这是官方品牌，不是 ZMP1 必选字段 |
| `TestVerdict` | 字段 | `0x0` 尚未测试，`0x1` 最近一次全部通过，`0x2` 有用例未通过 |
| `TestReport` | 字段 | `Cases` 与 `AllPassed`（`0` 或 `1`）。尚未测试时 `Cases` 为空 |
| `Exceptions` | 字段 | 只收初始化放行失败。用例失败写在报告里 |
| `Test()` | 方法 | 无参数，无返回值。一次跑完登记表里的 18 个用例，中途不跳过。不写入 `MachineMemory.MemoryController`，也不改 `Config.TotalSizeBytes` / `Config.MemoryId` |
| `Initialize()` | 方法 | 无参数，无返回值。见下一节 |

`Test` 不由 `Initialize` 代为调用。嵌套调用 `Test` 时抛出 `[ZerOS.Hardware.Memory.MemoryInit]`，并且不把裁定改成通过。

`Initialize` 的官方步骤：

1. `MachineMemory.MemoryController` 已经不是 `null` 时直接返回。不重新抽 `MemoryId`，也不再造一台总控。
2. `TestVerdict` 不是 `0x1` 时，向 `MemoryInit.Exceptions` 追加 `TestsNotPassed` / `Abort`，抛出 `[ZerOS.Hardware.Memory.MemoryInit]`，不构造总控。
3. `new MemoryController()`，此时还没有发布到 `MachineMemory`。
4. 各颗 `Cells.length` 之和小于 `1n` 时，追加 `NoUsableStorage` / `Abort`，抛出同一前缀。不改配置面，不发布。
5. `drawMemoryId(256)`。返回 `null` 时追加 `CryptoUnavailable` / `Abort`，同样不改配置面、不发布。
6. `Config.publishCapacity(和, 抽出的 id)`，把 `TotalSizeBytes`、`MemoryId` 和 `Identity` 写成这一次的结果。
7. 把该实例写入 `MachineMemory.MemoryController`。不写入内核。

`MemorySlot.Bind` 会拒绝 `Test` 或 `Initialize` 不是函数的插头。

18 个用例的规范名和顺序以 ZMP1 登记表为准：`StorageCleared`、`UnitOrdinalDense`、`InactiveReportsUnitNotActive`、`BitRoundTrip`、`IllegalBitRejected`、`OctetRoundTrip`、`IllegalOctetRejected`、`CrossUnitMatches`、`UnitOrdinalOutOfRange`、`ShallowCutShape`、`BlockPortAgrees`、`DeepenOneLevel`、`CapacityIsOctetSum`、`MemoryIdDraw`、`LinearBitRoundTrip`、`IntegerLittleEndian`、`BlockOctetRoundTrip`、`ClaimReleaseZeros`。`Test/` 里的函数名不是协议名。用例各自构造临时总控，不发布到 `MachineMemory.MemoryController`。

## 2. 配置面标定

`Config` 是这份实现的当前标定。协议固定常量与 ZMP1 写死值一致。可标定项是官方选择，换实现时可以另选。

| 符号 | 当前值 | 身份 |
|------|--------|------|
| `Protocol.ZMP1` | `"ZMP1"` | 协议标识枚举 |
| `Config.ActiveProtocol` | `Protocol.ZMP1` | 本实现声称的协议 |
| `Config.MemoryIdByteLength` | `256` | 协议固定常量 |
| `Config.MemoryVendorMaxLength` | `16` | 协议固定常量 |
| `Config.BitsPerByte` | `8` | 协议固定常量 |
| `Config.ShallowDimension` | `16` | 官方标定。浅切块数 |
| `Config.DeepDimension` | `8` | 官方标定。单块嵌套深度上限 |
| `Config.UnitCount` | `8` | 官方标定。协议上界是 `4294967296` |
| `Config.UnitSizeBytes` | `2097152` | 官方标定，单位字节；加载时经 `uint32OrThrow` |
| `Config.TotalSizeBytes` | `0n` | 发布前的初值。发布后等于各颗 `Cells.length` 之和，类型是 `bigint` |
| `Config.MemoryId` | 256 个字符 `0` | 发布前按 ZMP1 判定为禁用。发布后是一条已启用的可打印 ASCII |
| `Config.MemoryVendor` | `"ZerOS-Team-M1"` | 官方厂商标识 |
| `Config.Dimensions` / `Units` / `Identity` | 上列字段的分组 | 汇聚视图，不是协议必选成员。`Identity` 在发布时与 `MemoryId` 一起刷新 |
| `Config.publishCapacity(total, memoryId)` | 函数 | 只应由 `Initialize` 调用。写入上面三项 |

类型名 `BitsPerByte`、`UnitSizeBytes`、`ShallowDimension`、`DeepDimension`、`UnitCount`、`TotalSizeBytes`、`MemoryId`、`MemoryVendor`，以及 `DimensionConfig`、`UnitConfig`、`IdentityConfig`，是这份实现的 TypeScript 类型。数值规则以 ZMP1 为准。

当前标定下，8 颗都成功时 `TotalSizeBytes` 为 `16777216n`。

## 3. 颗粒与总控

颗粒在 `InitState === 0x4` 之后提供位元、八位组和小端整数端口。总控用 `UnitOrdinal` 跨颗粒调用同名方法，并另有整机线性端口与浅切根的领取 / 归还。浅切块按位元线均分，可以 `Deepen`，也可以按块内连续 8 位读写八位组。

### `MemoryUnit`

`new MemoryUnit(UnitOrdinal)` 使用 `Config.UnitSizeBytes`。`UnitOrdinal` 必须已是 Uint32。总控按创建顺序传入 `0` 起的序号。

| 成员 | 官方含义 |
|------|----------|
| `Cells` | 八位组序列。成功时长度等于 `UnitSizeBytes` 且每个八位组为 `0`；失败时长度为 `0` |
| `CellCount` | 成功时等于 `UnitSizeBytes × BitsPerByte`；失败时为 `0` |
| `UnitOrdinal` | 创建时写入的序号。阶段 D 不改它 |
| `InitState` | 构造结束时为 `0x3`（成功）、`0x2`（分配失败）或 `0x5`（颗粒大小非法，或序号不是 Uint32）。`promoteToActive()` 只允许从 `0x3` 升到 `0x4` |
| `Events` / `Signals` | 进入 `0x2` / `0x3` / `0x4` / `0x5` 时追加一条生命周期事件，并刷新 `Usable` 与 `Fault`。`0x0` 与 `0x1` 不追加事件 |
| `Exceptions` | 端口失败记在这里 |
| `ReadBit` / `WriteBit` / `ReadOctet` / `WriteOctet` | 与 ZMP1 同名。失败顺序是正式可用、下标、写入值 |
| `ReadInteger(OctetIndex, OctetWidth)` / `WriteInteger(OctetIndex, OctetWidth, IntegerValue)` | 小端。宽度只接受 `2`、`4`、`8`。跨度必须整段落在本颗。`IntegerValue` 是 `bigint`。失败顺序是正式可用、宽度、跨度、值 |

构造顺序：侧信道空数组且 `InitState = 0x0`，然后 `0x1`，再检查序号、大小、计算 `CellCount`、分配并 `fill(0)`。非法大小写入 `IllegalUnitSizeBytes` / `Abort` 后进入 `0x5`。序号不是 Uint32 时写入 `Unspecified` / `Abort` 后进入 `0x5`。分配抛错时写入 `Unspecified` / `Severe` 后进入 `0x2`，存储体为空。

端口失败时：存储体不变，向本颗粒 `Exceptions` 追加一条 `Abort`，再抛出 `[ZerOS.Hardware.Memory.MemoryUnit]`。对 `Cells` 下标直接赋值不是这些端口。`Release` 清零走的是总控直接改 `Cells`，不经过这些端口。

### `MemoryController`

`new MemoryController()` 无构造参数。

| 成员 | 官方含义 |
|------|----------|
| `Units` | `UnitIndexId → MemoryUnit`。成功时条目数等于 `Config.UnitCount`，构造后冻结增删改绑。键由 `crypto.getRandomValues` 生成，长度 `UnitIndexIdLength`（16），字符来自 `UnitIndexIdAlphabet` |
| `Blocks` | 浅切根块。长度等于 `Config.ShallowDimension`（当前 16）。`BlockIndex` 从 0 升序。每块 `NestingDepth` 为 1，`ChildIndex` 为 `null`，`Children` 为空，`Owner` 为 `null`。当前标定下每一块是 `8388608` 个位元 |
| `Events` / `Signals` | 构造收尾追加 `ShallowCutCompleted`（`Subject` 为块数），并写入 `Ready`。`Deepen` 成功追加 `Deepened`。`Claim` / `Release` 成功追加 `Claimed` / `Released` |
| `Exceptions` | 总控级 `MemoryException` 数组 |
| `ReadBit` / `WriteBit` / `ReadOctet` / `WriteOctet` / `ReadInteger` / `WriteInteger` | 第一个参数是 `UnitOrdinal`。先检查序号，再转交那一颗 |
| `ReadLinearBit(LinearBitIndex)` / `WriteLinearBit(LinearBitIndex, BitValue)` | `LinearBitIndex` 是 `bigint`。地址 0 是第 0 颗的位元 0 |
| `ReadLinearInteger` / `WriteLinearInteger` | 可以跨颗粒。线性写入先查宽度和值，再查跨度 |
| `Claim(BlockIndex, Owner)` / `Release(BlockIndex, Owner)` | 只针对浅切根。`Claim` 不改存储体。`Release` 成功时先把该根跨度内的位元清成 0，再把 `Owner` 放回 `null` |

构造顺序：检查 `UnitCount`；循环 `new MemoryUnit(序号)`；冻结关联表；浅切 `Blocks`；只对 `InitState === 0x3` 的颗粒调用 `promoteToActive()`。`0x2` 与 `0x5` 保持不动。晋升不改 `Cells` / `CellCount` / `UnitOrdinal` / `Blocks`。

序号越界记在总控上，标号 `UnitOrdinalOutOfRange`，然后抛出 `[ZerOS.Hardware.Memory.MemoryController]`。序号合法之后若颗粒端口失败，异常只记在那一颗上。

`UnitIndexId` 只是颗粒表的键。它不是 ZMP1 的 `MemoryId`，也不是 `UnitOrdinal`。

当前标定下，8 颗 × `16777216` 位元 = `134217728`。16 块正好各 `8388608` 位元。

### `MemoryBlock`

浅切根由总控构造。调用方用 `Deepen()` 得到子块。

| 成员 | 官方含义 |
|------|----------|
| `Owner` | `Uint32` 或 `null`。浅切根初值 `null`。子块保持 `null`。端口不看这个字段 |
| `ReadBit` / `WriteBit` | 偏移必须落在 `BitLength` 内，然后落到颗粒的位元端口 |
| `ReadOctet` / `WriteOctet` | 块内连续 8 个位元。窗口里的位偏移 0 是最低有效位，不必对齐颗粒八位组 |
| `ReadInteger` / `WriteInteger` | 按块内八位组计的小端整数。跨度越界记 `IntegerSpanOutOfRange`，不记成 `BlockOctetIndexOutOfRange` |
| `Deepen()` | 无参数。成功后父块深度和 `BitLength` 不变，存储体不变，总控追加 `Deepened` |

当前标定下，第一层子块各 `524288` 个位元。子块还可以再 `Deepen`，直到深度等于 `8`。

## 4. 官方辅助符号

这些名字属于这份实现。协议没有要求其它实现导出它们。

| 符号 | 行为 |
|------|------|
| `Uint32` / `toUint32` / `uint32OrThrow` / `Uint32Max` / `Uint32Zero` | 有限整数 `0 .. 4294967295` 的门闩 |
| `Uint64` / `toUint64` / `Uint64Max` | `bigint` 门闩，上界 `18446744073709551615n` |
| `MaxUnitCount` | `4294967296` |
| `OctetValue` / `toOctetValue` / `OctetValueMax` | 八位组整数 `0`–`255` |
| `IntegerWidth` / `toIntegerWidth` / `integerValueMax` | 封闭宽度 `2`、`4`、`8` |
| `packLittleEndian` / `unpackLittleEndian` | 把八位组数组和 `bigint` 互转。非法值返回 `null` |
| `totalOctetCount` | 各颗 `Cells.length` 的 `bigint` 和 |
| `MemoryIdAlphabet` / `drawMemoryId` | 可打印 ASCII 拒绝采样。不写 `Config`。没有 `crypto.getRandomValues` 时返回 `null` |
| `appendEvent` / `upsertSignal` | 事件只追加；同一信号标号和主体只留一条 |
| `EventCodeValue` / `SignalCodeValue` | 与事件、信号登记表短名对应的数值常量 |
| `totalBitCount` / `rangeOfBlock` / `bitLengthAsUint32` / `locateLinear` | 位元线与浅切跨度。运算用 `bigint` |
| `createMemoryException` | 四属性合法时返回对象，否则 `null`。链被收成只含 `Cause` 的对象；没有 `Cause` 键时存成 `{ Cause: null }` |
| `freezeUnitMap` | 把构造期 `Map` 封成不可增删改绑的 `ReadonlyMap` |
| `ExceptionCodeValue` / `ExceptionCategoryCode` / `UnitInitStateCode` | 与登记表短名对应的数值常量 |
| `TestCaseOrder` | 18 个用例规范名，顺序固定 |
| `BitValue` | 位元取值，仅 `0` 或 `1` |
| `MemoryEvent` / `MemorySignal` | `{ EventCode, Subject, Detail }` 与 `{ SignalCode, Level, Subject }` |

`MemoryBlockParams` 与 `PortFailure` 是构造内存块时的官方参数形状。`StartLinear` 用 `bigint` 保存，不是协议字段。

## 5. 仍然不属于虚拟内存契约的部分

ZMP1 已经写明总容量公式、`MemoryId` 抽取、线性地址、小端整数、块内八位组、浅切根所有权、`ExceptionChain.Cause`，以及事件和信号的字段。官方实现按这些条款工作。

下列事项协议明文不规定，这份实现也没有另做一套：

- `InitState` 由谁写入（颗粒用 `promoteToActive`，协议不要求这个函数名）
- 主路径以外的可选状态跳转
- 宿主 `throw` 与协议异常记录之间的映射（官方会抛，前缀见上文）
- Boot 加载模块的宿主语法
- `MemoryInit` 上除 `Test` 与 `Initialize` 以外的方法
- 颗粒索引 ID 的随机算法（它不是 `MemoryId`）
- 操作系统页表、进程虚拟地址空间、调度与权限

这些留下的事项属于内核，或者属于协议已经声明不管的宿主细节。
