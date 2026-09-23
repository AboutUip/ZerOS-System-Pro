# ZMP1 初始化前测试用例登记表（Test Case Registry）

> 路径：`Documents/Protocol/PhysicalHardware/Memory/TestCaseRegistry.md`  
> 所属协议：`ZMP1`（见 [ZMP1.md](./ZMP1.md) §4.22）  
> 规范状态：**规范性（已登记用例）**  
> 配套索引：[TestCaseIndex.md](./TestCaseIndex.md)

## 0. 文档定位

本文是 ZMP1 **初始化前必选用例**的登记册。

- **约束对象**：声称兼容 ZMP1 的实现。`MemoryInit.Test` 必须按本文顺序执行全部已登记用例。
- **作用**：把用例规范名、顺序和通过条件写成第三方不读源码也能裁决的规则。
- **非目标**：不规定官方实现里的函数名、文件名或标定数字。不规定宿主如何 `throw`。用例失败记在 `TestReport`，不要求再写入 `MemoryInit.Exceptions`。

读者**无需**阅读 ZerOS-PRO 源码。冲突时：**本文 > [TestCaseIndex.md](./TestCaseIndex.md) > [ZMP1.md](./ZMP1.md) 正文摘要**。

## 1. 编码规则（必须遵守）

| 规则 | 要求 |
|------|------|
| 规范名 | Unicode 拼写与大小写逐字固定。禁止用别名冒充 |
| 顺序 | 下表从上到下就是 `Test` 的执行顺序。禁止换序后仍声称这是同一次完整测试 |
| 完整性 | 一次 `Test` 必须执行每一个已登记用例。禁止参数选择子集，禁止因一条失败而跳过后面的用例 |
| 通过位 | `Passed` 只能是整数 `0` 或 `1`。禁止用布尔值。`1` 表示通过。通过时 `Summary` 必须为空字符串 |
| 概述 | 未通过时 `Summary` 的 Unicode 码点长度必须严格小于 256 |
| 隔离 | 用例使用的总控或颗粒不得写入 `MachineMemory.MemoryController` |
| 升版 | 增删改已登记用例必须修订本表，并在 [ZMP1.md](./ZMP1.md) 修订记录中可追溯 |

## 2. 登记表

| 顺序 | 规范名 | 通过条件（摘要；细则见 §3） | 状态 |
|------|--------|------------------------------|------|
| 1 | `StorageCleared` | 临时总控上没有 `0x3`；`0x4` 全 0 且容量正确；`0x2` / `0x5` 存储体为空 | 已登记 |
| 2 | `UnitOrdinalDense` | `UnitOrdinal` 恰好是 `0 .. UnitCount-1` 各一次 | 已登记 |
| 3 | `InactiveReportsUnitNotActive` | 仍为 `0x3` 的颗粒在下标也越界时报告 `0x0007`，存储体不变 | 已登记 |
| 4 | `BitRoundTrip` | 正式可用颗粒上写一位、读回、相邻位保持 0，然后写回 0 | 已登记 |
| 5 | `IllegalBitRejected` | 写入 `2` 不改八位组，标号 `0x0009`，类别 Abort | 已登记 |
| 6 | `OctetRoundTrip` | 写入 `129` 后最低位与最高位为 1、相邻低位为 0，然后恢复为 0 | 已登记 |
| 7 | `IllegalOctetRejected` | 写入 `256` 不改八位组，标号 `0x000B`，类别 Abort | 已登记 |
| 8 | `CrossUnitMatches` | 总控按序号读写与该颗粒自己的端口一致 | 已登记 |
| 9 | `UnitOrdinalOutOfRange` | 序号等于 `UnitCount` 且该值仍是 Uint32 时，总控记下 `0x000C`；满量程时不得误报 | 已登记 |
| 10 | `ShallowCutShape` | 块数、下标、深度、空子块、跨度之和与相差至多 1 | 已登记 |
| 11 | `BlockPortAgrees` | 块内偏移 0 落到线性位元；空块则记 `0x000E` | 已登记 |
| 12 | `DeepenOneLevel` | 只加一层或在深度上限处拒绝；父块跨度不变；存储体不变 | 已登记 |
| 13 | `CapacityIsOctetSum` | 各颗 `Cells.length` 之和 ≥ 1，且临时总控不改写配置面 | 已登记 |
| 14 | `MemoryIdDraw` | 按 §4.7.3 抽出已启用的 256 字符，且不改写配置面 | 已登记 |
| 15 | `LinearBitRoundTrip` | 线性地址 0 等于第 0 颗的位元 0 | 已登记 |
| 16 | `IntegerLittleEndian` | 宽度 2 的 `0x0181` 拆成 `0x81` 与 `0x01` | 已登记 |
| 17 | `BlockOctetRoundTrip` | 块内八位组 `0x81` 的最低位为 1、次低位为 0 | 已登记 |
| 18 | `ClaimReleaseZeros` | 重复领取被拒绝；主人不对时不清零；归还后位元为 0 且 `Owner` 为 `null` | 已登记 |

## 3. 判定规则

下列规则使用实现自己的配置面。**禁止**把某一官方标定（例如颗粒数 8、浅维度 16）写成通过条件。

临时总控指：完成与正式初始化相同的颗粒构造、浅切和阶段 D，但**不得**把该总控写入 `MachineMemory.MemoryController`。

### 3.1 `StorageCleared`

构造一台临时总控。通过当且仅当同时满足：

- 至少有一颗颗粒；
- 没有任何颗粒的 `InitState` 为 `0x3`、`0x0` 或 `0x1`；
- 每一颗 `InitState === 0x4` 的颗粒：`Cells` 的长度等于 `UnitSizeBytes`，每个八位组为整数 `0`，`CellCount` 等于 `UnitSizeBytes × BitsPerByte`；
- 每一颗 `InitState` 为 `0x2` 或 `0x5` 的颗粒：`CellCount` 为 `0`，且 `Cells` 的长度为 `0`。

### 3.2 `UnitOrdinalDense`

在一台临时总控上，全部颗粒的 `UnitOrdinal` 必须恰好是整数 `0`、`1`、…、`UnitCount − 1` 各一次。多一个、少一个或重复都未通过。

### 3.3 `InactiveReportsUnitNotActive`

必须能观察到一颗 `InitState === 0x3`、尚未晋升到 `0x4` 的颗粒。对该颗粒以一个不满足 `0 ≤ CellIndex < CellCount` 的 Uint32 调用 `ReadBit`（`CellCount` 不超过 Uint32 上界时，可以使用 Uint32 上界）。

通过当且仅当：调用失败；存储体不变；该颗粒 `Exceptions` 新增的最后一条 `ExceptionCode` 为 `0x0007`，`ExceptionCategory` 为 `0x04`。标号是 `0x0008` 则未通过。无法造出停在 `0x3` 的颗粒，则本用例未通过。

### 3.4 `BitRoundTrip`

在临时总控上取一颗 `InitState === 0x4` 且 `CellCount ≥ 2` 的颗粒。没有这样的颗粒则未通过。

对该颗粒：`WriteBit(0, 1)` 之后 `ReadBit(0)` 必须为 `1`，`ReadBit(1)` 必须为 `0`；再 `WriteBit(0, 0)` 之后 `ReadBit(0)` 必须为 `0`。

### 3.5 `IllegalBitRejected`

在临时总控上取一颗 `InitState === 0x4` 且至少有一个八位组的颗粒。没有则未通过。

记下八位组下标 `0` 的当前值，再 `WriteBit(0, 2)`。通过当且仅当：调用失败；该八位组仍是原值；该颗粒 `Exceptions` 新增的最后一条为 `0x0009`，类别 `0x04`。

### 3.6 `OctetRoundTrip`

在临时总控上取一颗 `InitState === 0x4` 且 `CellCount ≥ 8` 的颗粒。没有则未通过。

`WriteOctet(0, 129)` 之后：`ReadOctet(0)` 必须为 `129`；位元下标 `0` 必须为 `1`；位元下标 `1` 必须为 `0`；位元下标 `7` 必须为 `1`。再 `WriteOctet(0, 0)` 之后 `ReadOctet(0)` 必须为 `0`。

### 3.7 `IllegalOctetRejected`

取与 §3.5 相同条件的颗粒。记下八位组下标 `0` 的当前值，再 `WriteOctet(0, 256)`。通过当且仅当：调用失败；该八位组仍是原值；该颗粒 `Exceptions` 新增的最后一条为 `0x000B`，类别 `0x04`。

### 3.8 `CrossUnitMatches`

取与 §3.4 相同条件的颗粒，设其序号为 `UnitOrdinal`。

颗粒 `WriteBit(0, 1)` 之后，总控 `ReadBit(UnitOrdinal, 0)` 必须为 `1`。总控 `WriteBit(UnitOrdinal, 0, 0)` 之后，颗粒 `ReadBit(0)` 必须为 `0`。

### 3.9 `UnitOrdinalOutOfRange`

在一台临时总控上：

- 若 `UnitCount ≤ 4294967295`：以 `UnitOrdinal = UnitCount`、`CellIndex = 0` 调用总控 `ReadBit`。通过当且仅当调用失败；任一正式可用颗粒的被观察八位组不变；该颗粒 `Exceptions` 的条数不因此增加；总控 `Exceptions` 新增的最后一条为 `0x000C`，类别 `0x04`。没有可供观察的正式可用颗粒则未通过。
- 若 `UnitCount = 4294967296`：每一个 Uint32 都落在 `0 .. UnitCount-1`。以 Uint32 上界调用总控 `ReadBit` 时，总控 `Exceptions` **不得**因此出现 `0x000C`。出现该标号则未通过。

### 3.10 `ShallowCutShape`

在一台临时总控上，通过当且仅当同时满足：

- `Blocks` 的长度等于 `ShallowDimension`；
- 第 `i` 块（`i` 从 `0` 起）的 `BlockIndex` 等于 `i`，`NestingDepth` 等于 `1`，`Children` 的长度为 `0`；
- 若根块提供 `ChildIndex`，该值不得是 `0 .. ShallowDimension − 1` 中的下标；
- 按 `UnitOrdinal` 从 `0` 升序，各颗粒 `CellCount` 之和（精确整数，允许大于 Uint32）等于各块 `BitLength` 之和；
- 任意两块的 `BitLength` 相差不超过 `1`。

### 3.11 `BlockPortAgrees`

在一台临时总控上取 `BlockIndex === 0` 的块。没有该块则未通过。

- 若该块 `BitLength = 0`：`ReadBit(0)` 必须失败，且总控 `Exceptions` 新增的最后一条为 `0x000E`，类别 `0x04`。
- 若 `BitLength > 0`：块内偏移 `0` 对应 §4.20 的线性下标 `0`。`WriteBit(0, 1)` 之后，落点颗粒上的对应位元必须为 `1`；再 `WriteBit(0, 0)` 之后该位元必须为 `0`。无法定位落点则未通过。

### 3.12 `DeepenOneLevel`

在一台临时总控上取 `BlockIndex === 0` 的块。若存在 `InitState === 0x4` 且至少有一个八位组的颗粒，记下其中一个八位组的值。通过时该值必须不变；不存在这样的颗粒时，不因「没有可观察八位组」而失败。

- 若 `DeepDimension = 1`：第一次 `Deepen` 必须失败；`Children` 长度仍为 `0`；`BitLength` 不变；总控 `Exceptions` 新增的最后一条为 `0x000F`，类别 `0x04`。
- 若 `DeepDimension ≥ 2`：第一次 `Deepen` 之后，父块 `NestingDepth` 仍为 `1`，`BitLength` 不变，`Children` 长度等于 `ShallowDimension`。子块 `ChildIndex = 0` 的那一块：`NestingDepth` 为 `2`，自身 `Children` 长度为 `0`。全部子块的 `BitLength` 之和等于父块 `BitLength`。第二次对同一父块 `Deepen` 必须失败，`Children` 长度不变，总控 `Exceptions` 新增的最后一条为 `0x0010`，类别 `0x04`。

### 3.13 `CapacityIsOctetSum`

构造一台临时总控。设 `S` 为各颗 `Cells.length` 按任意顺序相加得到的非负整数。通过当且仅当同时满足：

- `S ≥ 1`，并且与逐颗相加的结果相同；
- 本用例开始时配置面 `TotalSizeBytes` 为 `0`，`MemoryId` 等于 `ZeroId`；
- 构造临时总控之后，这两个字段仍与开始时相同。

临时总控不得写入 `MachineMemory.MemoryController`。

### 3.14 `MemoryIdDraw`

在不改写配置面的前提下，按 §4.7.3 抽出一条候选 `MemoryId`。通过当且仅当：长度为 256；每一位属于 `U+0021`–`U+007E`；不等于 `ZeroId`；配置面 `MemoryId` 与 `TotalSizeBytes` 与调用前相同。宿主缺少 `crypto.getRandomValues` 时本用例未通过。

### 3.15 `LinearBitRoundTrip`

临时总控上 `UnitOrdinal = 0` 的颗粒必须是 `InitState === 0x4` 且 `CellCount ≥ 8`。没有则未通过。

`WriteLinearBit(0, 1)` 之后，该颗 `ReadBit(0)` 必须为 `1`，`ReadLinearBit(0)` 必须为 `1`。再 `WriteLinearBit(0, 0)` 之后，`ReadBit(0)` 必须为 `0`。

### 3.16 `IntegerLittleEndian`

使用与 `LinearBitRoundTrip` 相同的那一颗正式可用颗粒。没有则未通过。

`WriteInteger(0, 2, 385)`（即 `0x0181`）之后，八位组 0 必须为 `129`（`0x81`），八位组 1 必须为 `1`，`ReadInteger(0, 2)` 必须为 `385`。再 `WriteInteger(0, 2, 0)` 之后，八位组 0 必须为 `0`。

### 3.17 `BlockOctetRoundTrip`

临时总控上 `BlockIndex = 0` 的块必须存在，且 `BitLength ≥ 8`。没有则未通过。

`WriteOctet(0, 129)` 之后，`ReadOctet(0)` 必须为 `129`，`ReadBit(0)` 必须为 `1`，`ReadBit(1)` 必须为 `0`。再 `WriteOctet(0, 0)` 之后，`ReadOctet(0)` 必须为 `0`。

### 3.18 `ClaimReleaseZeros`

临时总控上 `BlockIndex = 0` 的浅切根必须存在，`BitLength ≥ 1`，且 `Owner` 为 `null`。没有则未通过。设两个不同的 Uint32 主人 `A` 与 `B`。

- `Claim(0, A)` 之后 `Owner` 必须为 `A`；
- `Claim(0, B)` 必须失败，总控 `Exceptions` 新增的最后一条为 `0x0019`，类别 `0x04`，`Owner` 仍为 `A`；
- 对该块 `WriteBit(0, 1)` 之后，`Release(0, B)` 必须失败，最后一条为 `0x001B`，该位元仍为 `1`；
- `Release(0, A)` 之后 `Owner` 必须为 `null`，该位元必须为 `0`。

## 4. 预留与待登记

| 位置 | 说明 |
|------|------|
| 顺序 19 起 | 预留给后续已遇到的必选用例。**尚未登记，禁止**把未列入上表的名字当作 ZMP1 必选用例 |

## 5. 登记流程（后续追加时）

每新增一条必选用例，必须同时：

1. 在本表 §2 按顺序追加一行，并在 §3 写明通过条件；
2. 更新 [TestCaseIndex.md](./TestCaseIndex.md)；
3. 若影响正文表述，同步修订 [ZMP1.md](./ZMP1.md) §4.22 与修订记录；
4. 若参考实现导出用例顺序常量，须与本文规范名和顺序双向一致。

## 6. 修订记录

| 日期 | 变更 |
|------|------|
| 2026-09-24 | 首版：登记 `StorageCleared` 至 `DeepenOneLevel`，共 12 条，顺序固定 |
| 2026-09-24 | 追加顺序 13–18：`CapacityIsOctetSum` 至 `ClaimReleaseZeros` |
