# ZMP1 内存异常标号登记表（Exception Code Registry）

> 路径：`Documents/Protocol/PhysicalHardware/Memory/ExceptionCodeRegistry.md`  
> 所属协议：`ZMP1`（见 [ZMP1.md](./ZMP1.md) §4.11）  
> 规范状态：**规范性（已登记标号）**  
> 配套索引：[ExceptionIndex.md](./ExceptionIndex.md)

## 0. 文档定位

本文是 ZMP1 **异常标号（`ExceptionCode`）** 的编码登记册。

- **约束对象**：声称兼容 ZMP1、并对外报告 `MemoryException` 的实现。
- **作用**：把「已遇到 / 已采纳」的异常固化为稳定十六进制标号；未在本文登记的标号**禁止**冒充 ZMP1 已定义含义。
- **非目标**：不描述宿主如何 `throw`。`ExceptionChain` 的存储形态见 ZMP1 §4.11.5。§4.17–§4.26 已写明的失败记录不在「不规定何时记录」之内。其余异常处理见 ZMP1 §2.2。

读者**无需**阅读 ZerOS-PRO 源码；仅依据本文与 [ZMP1.md](./ZMP1.md) 即可核对标号合法性。

## 1. 编码规则（必须遵守）

| 规则 | 要求 |
|------|------|
| 空间 | `0x0000`–`0xFFFF`（含端点） |
| 起点 | 自 **`0x0000`** 起编 |
| 分配 | 新标号按升序追加；**禁止**复用已登记号作他义 |
| 记法 | 对外文档与互操作记录使用四位十六进制（如 `0x0000`） |
| 升版 | 增删改已登记含义必须修订本表，并在 [ZMP1.md](./ZMP1.md) 修订记录中可追溯 |

## 2. 登记表

| 标号 | 规范短名 | 默认建议类别 | 异常概述（规范说明，非运行时 Summary 原文） | 状态 |
|------|----------|--------------|---------------------------------------------|------|
| `0x0000` | `Unspecified` | 由上报方按实况选择五档之一 | 未细分的通用内存异常占位；在尚无更具体标号前允许使用 | 已登记 |
| `0x0001` | `IllegalUnitSizeBytes` | `0x04 Abort` | 非法颗粒大小：`UnitSizeBytes` 不是 1..536870911 的整数，或按 `BitsPerByte` 展开的 `CellCount` 超出 Uint32 | 已登记 |
| `0x0002` | `IllegalUnitCount` | `0x04 Abort` | 非法颗粒数量：`UnitCount` 不是 1..4294967296 的整数，或关联表大小与 `UnitCount` 不一致 | 已登记 |
| `0x0003` | `CryptoUnavailable` | `0x04 Abort` | 宿主缺少可用的 `crypto.getRandomValues`。用于实现层索引 ID，也用于 §4.7.3 抽取 `MemoryId` 失败因而不得发布总控 | 已登记 |
| `0x0004` | `UnitIndexAlphabetInvalid` | `0x04 Abort` | 颗粒索引 ID 所用字符表非法（例如长度 &lt; 2） | 已登记 |
| `0x0005` | `IllegalShallowDimension` | `0x04 Abort` | 非法浅维度：`ShallowDimension` 不是 1..4294967295 的整数，或浅切块数与之不一致 | 已登记 |
| `0x0006` | `IllegalDeepDimension` | `0x04 Abort` | 非法深维度：`DeepDimension` 不是 1..4294967295 的整数，或浅切后 `NestingDepth` 不满足 `1 ≤ NestingDepth ≤ DeepDimension` | 已登记 |
| `0x0007` | `UnitNotActive` | `0x04 Abort` | 存储端口拒绝：单元 `InitState` 不是 `0x4`。适用于颗粒上的位元、八位组与整数端口，以及经总控或内存块转发之后的同一次调用 | 已登记 |
| `0x0008` | `BitIndexOutOfRange` | `0x04 Abort` | 位元端口拒绝：`CellIndex` 不是满足 `0 ≤ CellIndex < CellCount` 的 Uint32 | 已登记 |
| `0x0009` | `IllegalBitValue` | `0x04 Abort` | 位元端口拒绝：`WriteBit` 的 `BitValue` 不是整数 `0` 或 `1` | 已登记 |
| `0x000A` | `OctetIndexOutOfRange` | `0x04 Abort` | 八位组端口拒绝：`OctetIndex` 不是满足 `0 ≤ OctetIndex < 八位组个数` 的 Uint32 | 已登记 |
| `0x000B` | `IllegalOctetValue` | `0x04 Abort` | 八位组端口拒绝：`WriteOctet` 的 `OctetValue` 不是整数 `0`–`255`。颗粒上记在该颗粒；块上记在总控 | 已登记 |
| `0x000C` | `UnitOrdinalOutOfRange` | `0x04 Abort` | 跨颗粒端口拒绝：`UnitOrdinal` 不是满足 `0 ≤ UnitOrdinal < UnitCount` 的 Uint32。记在总控的 `Exceptions` | 已登记 |
| `0x000D` | `BlockSpanExceedsUint32` | `0x04 Abort` | 浅切或加深时，某一块的位元跨度大于 `4294967295`，不能用 Uint32 偏移命名 | 已登记 |
| `0x000E` | `BlockBitOffsetOutOfRange` | `0x04 Abort` | 块内位元端口拒绝：`BlockBitOffset` 不是满足 `0 ≤ BlockBitOffset < BitLength` 的 Uint32。记在总控的 `Exceptions` | 已登记 |
| `0x000F` | `NestingAtCeiling` | `0x04 Abort` | `Deepen` 拒绝：`NestingDepth` 已经达到 `DeepDimension`。记在总控的 `Exceptions` | 已登记 |
| `0x0010` | `AlreadyDeepened` | `0x04 Abort` | `Deepen` 拒绝：该块的 `Children` 已经非空。记在总控的 `Exceptions` | 已登记 |
| `0x0011` | `TestsNotPassed` | `0x04 Abort` | `Initialize` 拒绝：`MachineMemory.MemoryController` 仍为空，且 `MemoryInit.TestVerdict` 不是 `0x1`。记在 `MemoryInit.Exceptions`。类别必须为 Abort | 已登记 |
| `0x0012` | `NoUsableStorage` | `0x04 Abort` | `Initialize` 拒绝：测试已通过，但各颗 `Cells.length` 之和小于 1。不发布总控，也不改写 `TotalSizeBytes` 与 `MemoryId`。记在 `MemoryInit.Exceptions` | 已登记 |
| `0x0013` | `LinearBitIndexOutOfRange` | `0x04 Abort` | 线性位元地址不是 Uint64，或不满足 `0 ≤ LinearBitIndex <` 全部 `CellCount` 之和。记在总控 | 已登记 |
| `0x0014` | `IllegalIntegerWidth` | `0x04 Abort` | `OctetWidth` 不是 `2`、`4` 或 `8`。颗粒端口记在颗粒；线性端口与块上整数端口记在总控 | 已登记 |
| `0x0015` | `IntegerSpanOutOfRange` | `0x04 Abort` | 整数跨度越出该颗、该块的完整八位组，或越出整机线性八位组。颗粒端口记在颗粒；其余记在总控 | 已登记 |
| `0x0016` | `IllegalIntegerValue` | `0x04 Abort` | 整数值不是该宽度能表示的非负整数 | 已登记 |
| `0x0017` | `BlockOctetIndexOutOfRange` | `0x04 Abort` | 块内八位组下标不能覆盖完整的 8 个位元。记在总控。块内整数跨度越界必须用 `0x0015`，不得改用本标号 | 已登记 |
| `0x0018` | `BlockIndexOutOfRange` | `0x04 Abort` | `Claim` / `Release` 的 `BlockIndex` 不是浅切根下标。记在总控 | 已登记 |
| `0x0019` | `AlreadyClaimed` | `0x04 Abort` | `Claim` 时该浅切根的 `Owner` 已经不是 `null`。存储体不变 | 已登记 |
| `0x001A` | `NotClaimed` | `0x04 Abort` | `Release` 时主人参数不是 Uint32，或该浅切根的 `Owner` 为 `null` | 已登记 |
| `0x001B` | `OwnerMismatch` | `0x04 Abort` | `Claim` 的主人参数不是 Uint32，或 `Release` 的主人与当前 `Owner` 不一致。不一致时存储体与 `Owner` 都不变 | 已登记 |

> **说明：** 「默认建议类别」仅指导选型，**不是**把该标号钉死在某一 `ExceptionCategory`；实际上报时 `ExceptionCategory` 仍必须为 `0x00`–`0x04` 之一（见 ZMP1 §4.11.2）。§4.17–§4.26 与 §4.22 要求使用的标号，类别必须为 `0x04`。

## 3. 预留与待登记

| 号段 / 标号 | 说明 |
|-------------|------|
| `0x001C` 起 | 预留给后续已遇到的具体业务异常；**尚未登记，禁止当作已定义稳定含义使用** |

## 4. 登记流程（后续追加时）

每新增一条「已遇到」的异常，必须同时：

1. 在本表 §2 追加一行（标号、短名、概述、状态=已登记）；
2. 更新 [ExceptionIndex.md](./ExceptionIndex.md) 的检索项；
3. 若影响 ZMP1 正文表述，同步修订 [ZMP1.md](./ZMP1.md) §4.11.3 与修订记录；
4. 若参考实现导出标号常量，须与本文短名/取值**双向一致**。

## 5. 修订记录

| 日期 | 变更 |
|------|------|
| 2026-07-18 | 首版：登记 `0x0000 Unspecified`；明确升序编码与索引联动 |
| 2026-07-18 | 追加 `0x0001`–`0x0004`（非法颗粒大小/数量、Crypto 不可用、索引字符表非法） |
| 2026-09-23 | `0x0001` 扩展：`UnitSizeBytes` 上界与 `CellCount` 超出 Uint32 同属非法颗粒大小 |
| 2026-09-24 | 追加 `0x0005 IllegalShallowDimension`、`0x0006 IllegalDeepDimension` |
| 2026-09-24 | 追加 `0x0007 UnitNotActive`、`0x0008 BitIndexOutOfRange`、`0x0009 IllegalBitValue` |
| 2026-09-24 | 追加 `0x000A`–`0x0010`（八位组端口、跨颗粒序号、块跨度、块内偏移、加深） |
| 2026-09-24 | 追加 `0x0011 TestsNotPassed`（初始化前测试未全部通过，禁止发布总控） |
| 2026-09-24 | 追加 `0x0012`–`0x001B`（总容量、线性地址、小端整数、块内八位组、浅切根所有权） |
| 2026-09-24 | `0x0011` 的未发布判定改为 `MachineMemory.MemoryController` 仍为空 |
