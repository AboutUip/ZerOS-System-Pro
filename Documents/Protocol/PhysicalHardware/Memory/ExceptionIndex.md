# ZMP1 内存异常索引（Exception Index）

> 路径：`Documents/Protocol/PhysicalHardware/Memory/ExceptionIndex.md`  
> 所属协议：`ZMP1`（见 [ZMP1.md](./ZMP1.md) §4.11）  
> 规范状态：**索引（与登记表一致；冲突以登记表为准）**  
> 编码登记册：[ExceptionCodeRegistry.md](./ExceptionCodeRegistry.md)

## 0. 文档定位

本文提供对**已登记**内存异常的多维检索，便于实现者与审查者按短名、标号或类别意图快速定位。

- 标号的权威定义以 [ExceptionCodeRegistry.md](./ExceptionCodeRegistry.md) 为准。
- 类别五档的权威定义以 [ZMP1.md](./ZMP1.md) §4.11.2 为准。
- 除 ZMP1 §4.17–§4.26 已写明的失败记录外，异常如何处理**不在**协议规定（见 [ZMP1.md](./ZMP1.md) §2.2）。
- 若本文与登记表冲突，**以登记表为准**，并应立即修正本文。

## 1. 按异常标号索引

| 标号 | 规范短名 | 登记状态 | 跳转 |
|------|----------|----------|------|
| `0x0000` | `Unspecified` | 已登记 | [登记表](./ExceptionCodeRegistry.md#2-登记表) |
| `0x0001` | `IllegalUnitSizeBytes` | 已登记 | [登记表](./ExceptionCodeRegistry.md#2-登记表) |
| `0x0002` | `IllegalUnitCount` | 已登记 | [登记表](./ExceptionCodeRegistry.md#2-登记表) |
| `0x0003` | `CryptoUnavailable` | 已登记 | [登记表](./ExceptionCodeRegistry.md#2-登记表) |
| `0x0004` | `UnitIndexAlphabetInvalid` | 已登记 | [登记表](./ExceptionCodeRegistry.md#2-登记表) |
| `0x0005` | `IllegalShallowDimension` | 已登记 | [登记表](./ExceptionCodeRegistry.md#2-登记表) |
| `0x0006` | `IllegalDeepDimension` | 已登记 | [登记表](./ExceptionCodeRegistry.md#2-登记表) |
| `0x0007` | `UnitNotActive` | 已登记 | [登记表](./ExceptionCodeRegistry.md#2-登记表) |
| `0x0008` | `BitIndexOutOfRange` | 已登记 | [登记表](./ExceptionCodeRegistry.md#2-登记表) |
| `0x0009` | `IllegalBitValue` | 已登记 | [登记表](./ExceptionCodeRegistry.md#2-登记表) |
| `0x000A` | `OctetIndexOutOfRange` | 已登记 | [登记表](./ExceptionCodeRegistry.md#2-登记表) |
| `0x000B` | `IllegalOctetValue` | 已登记 | [登记表](./ExceptionCodeRegistry.md#2-登记表) |
| `0x000C` | `UnitOrdinalOutOfRange` | 已登记 | [登记表](./ExceptionCodeRegistry.md#2-登记表) |
| `0x000D` | `BlockSpanExceedsUint32` | 已登记 | [登记表](./ExceptionCodeRegistry.md#2-登记表) |
| `0x000E` | `BlockBitOffsetOutOfRange` | 已登记 | [登记表](./ExceptionCodeRegistry.md#2-登记表) |
| `0x000F` | `NestingAtCeiling` | 已登记 | [登记表](./ExceptionCodeRegistry.md#2-登记表) |
| `0x0010` | `AlreadyDeepened` | 已登记 | [登记表](./ExceptionCodeRegistry.md#2-登记表) |
| `0x0011` | `TestsNotPassed` | 已登记 | [登记表](./ExceptionCodeRegistry.md#2-登记表) |
| `0x0012` | `NoUsableStorage` | 已登记 | [登记表](./ExceptionCodeRegistry.md#2-登记表) |
| `0x0013` | `LinearBitIndexOutOfRange` | 已登记 | [登记表](./ExceptionCodeRegistry.md#2-登记表) |
| `0x0014` | `IllegalIntegerWidth` | 已登记 | [登记表](./ExceptionCodeRegistry.md#2-登记表) |
| `0x0015` | `IntegerSpanOutOfRange` | 已登记 | [登记表](./ExceptionCodeRegistry.md#2-登记表) |
| `0x0016` | `IllegalIntegerValue` | 已登记 | [登记表](./ExceptionCodeRegistry.md#2-登记表) |
| `0x0017` | `BlockOctetIndexOutOfRange` | 已登记 | [登记表](./ExceptionCodeRegistry.md#2-登记表) |
| `0x0018` | `BlockIndexOutOfRange` | 已登记 | [登记表](./ExceptionCodeRegistry.md#2-登记表) |
| `0x0019` | `AlreadyClaimed` | 已登记 | [登记表](./ExceptionCodeRegistry.md#2-登记表) |
| `0x001A` | `NotClaimed` | 已登记 | [登记表](./ExceptionCodeRegistry.md#2-登记表) |
| `0x001B` | `OwnerMismatch` | 已登记 | [登记表](./ExceptionCodeRegistry.md#2-登记表) |

## 2. 按规范短名索引

| 规范短名 | 标号 | 一句话 |
|----------|------|--------|
| `Unspecified` | `0x0000` | 未细分通用占位异常 |
| `IllegalUnitSizeBytes` | `0x0001` | 非法 `UnitSizeBytes`，或 `CellCount` 超出 Uint32 |
| `IllegalUnitCount` | `0x0002` | 非法 `UnitCount`（不在 1..4294967296）或关联表大小不一致 |
| `CryptoUnavailable` | `0x0003` | 缺少 `crypto.getRandomValues` |
| `UnitIndexAlphabetInvalid` | `0x0004` | 索引 ID 字符表非法 |
| `IllegalShallowDimension` | `0x0005` | 非法 `ShallowDimension` 或浅切块数不一致 |
| `IllegalDeepDimension` | `0x0006` | 非法 `DeepDimension`，或浅切后 `NestingDepth` 超出上限 |
| `UnitNotActive` | `0x0007` | 存储端口时 `InitState` 不是 `0x4` |
| `BitIndexOutOfRange` | `0x0008` | `CellIndex` 越出 `CellCount` |
| `IllegalBitValue` | `0x0009` | `WriteBit` 的值不是 `0` 或 `1` |
| `OctetIndexOutOfRange` | `0x000A` | `OctetIndex` 越出八位组个数 |
| `IllegalOctetValue` | `0x000B` | `WriteOctet` 的值不是 `0`–`255` |
| `UnitOrdinalOutOfRange` | `0x000C` | `UnitOrdinal` 越出 `0 .. UnitCount-1` |
| `BlockSpanExceedsUint32` | `0x000D` | 块的位元跨度大于 Uint32 |
| `BlockBitOffsetOutOfRange` | `0x000E` | `BlockBitOffset` 越出 `BitLength` |
| `NestingAtCeiling` | `0x000F` | `Deepen` 时深度已到顶 |
| `AlreadyDeepened` | `0x0010` | `Deepen` 时子块已经存在 |
| `TestsNotPassed` | `0x0011` | 测试未全部通过时禁止发布总控 |
| `NoUsableStorage` | `0x0012` | 八位组之和小于 1 时禁止发布 |
| `LinearBitIndexOutOfRange` | `0x0013` | 线性位元地址越出整机位元线 |
| `IllegalIntegerWidth` | `0x0014` | 整数宽度不是 2、4 或 8 |
| `IntegerSpanOutOfRange` | `0x0015` | 整数跨度越出八位组范围 |
| `IllegalIntegerValue` | `0x0016` | 整数值超出该宽度 |
| `BlockOctetIndexOutOfRange` | `0x0017` | 块内八位组下标越界 |
| `BlockIndexOutOfRange` | `0x0018` | 浅切根下标越界 |
| `AlreadyClaimed` | `0x0019` | 浅切根已经有主人 |
| `NotClaimed` | `0x001A` | 浅切根还没有可归还的主人 |
| `OwnerMismatch` | `0x001B` | 主人参数非法或与当前主人不一致 |

## 3. 按异常类别档位索引（选型参考）

类别取值固定为五档（`0x00`–`0x04`）。下表说明「何时倾向选哪一档」；**具体上报必须仍携带合法 `ExceptionCode`**。

| 类别取值 | 规范档名 | 适用意图（索引） | 与已登记标号的关系 |
|----------|----------|------------------|--------------------|
| `0x00` | `Ignorable` | 可忽略、仅记录 | `0x0000` 可搭配本档 |
| `0x01` | `Advisory` | 提示、默认不中断 | `0x0000` 可搭配本档 |
| `0x02` | `Recoverable` | 可恢复后继续 | `0x0000` 可搭配本档 |
| `0x03` | `Severe` | 当前操作失败，不得当作可忽略 | `0x0000` 可搭配本档 |
| `0x04` | `Abort` | 强制终止相关内存操作路径 | `0x0001`–`0x001B` 默认建议本档；`0x0000` 亦可 |

## 4. 按主题词索引（已遇到）

| 主题词 | 相关标号 | 说明 |
|--------|----------|------|
| 未细分 / 通用 / 占位 | `0x0000` | 尚无更具体标号时的通用项 |
| 非法颗粒大小 | `0x0001` | `UnitSizeBytes` 值域，或位元展开超出 Uint32 |
| 非法颗粒数量 / 关联表大小 | `0x0002` | `UnitCount` 上界 `4294967296` |
| 加密随机源 / crypto | `0x0003` | `getRandomValues` 不可用 |
| 索引字符表 | `0x0004` | 实现层 `UnitIndexId` 字母表 |
| 浅维度 / 浅切块数 | `0x0005` | `ShallowDimension` |
| 深维度 / 嵌套深度 | `0x0006`、`0x000F`、`0x0010` | `DeepDimension`、`NestingDepth`、`Deepen` |
| 未正式可用 | `0x0007` | 存储端口要求 `InitState = 0x4` |
| 越界 | `0x0008`、`0x000A`、`0x000C`、`0x000E`、`0x0013`、`0x0015`、`0x0017`、`0x0018` | 位元、八位组、序号、块偏移、线性地址、整数跨度、块内八位组、浅切根 |
| 非法位元值 | `0x0009` | `WriteBit` 的 `BitValue` |
| 非法八位组值 | `0x000B` | `WriteOctet` 的 `OctetValue` |
| 块跨度 | `0x000D` | 位元跨度不能落入 Uint32 |
| 初始化 / 测试放行 | `0x0011`、`0x0012`、`0x0003` | 测试未通过、没有可发布八位组、或抽不出 `MemoryId` |
| 总容量 | `0x0012` | 各颗 `Cells.length` 之和小于 1 |
| 线性地址 | `0x0013` | `LinearBitIndex` |
| 小端整数 | `0x0014`、`0x0015`、`0x0016` | 宽度、跨度、值 |
| 块内八位组 | `0x0017`、`0x000B` | 下标与八位组值 |
| 所有权 | `0x0018`–`0x001B` | 领取与归还 |

## 5. 快速核对清单（报告异常时）

报告 ZMP1 内存异常前，确认：

- [ ] 对象形态为 `MemoryException` 四属性齐全  
- [ ] `ExceptionCode` 已在 [ExceptionCodeRegistry.md](./ExceptionCodeRegistry.md) 登记（或仅为文档允许的占位用法且不伪称未定义含义）  
- [ ] `ExceptionCategory` ∈ {`0x00`,`0x01`,`0x02`,`0x03`,`0x04`}  
- [ ] `ExceptionSummary` 码点长度严格小于 256  
- [ ] `ExceptionChain` 为非 `null` 的 object，且存储形态含 `Cause`（`null` 或另一条四属性异常）

## 6. 修订记录

| 日期 | 变更 |
|------|------|
| 2026-07-18 | 首版：建立标号 / 短名 / 类别 / 主题词四维索引；收录 `0x0000 Unspecified` |
| 2026-07-18 | 收录 `0x0001`–`0x0004` |
| 2026-07-18 | 移除对异常处理流程的核对项（协议明确不规定） |
| 2026-09-23 | `0x0001` 索引说明覆盖 `CellCount` 超出 Uint32 |
| 2026-09-24 | 收录 `0x0005`、`0x0006` |
| 2026-09-24 | 收录 `0x0007`–`0x0009`；越界主题改指向 `0x0008` |
| 2026-09-24 | 收录 `0x000A`–`0x0010` |
| 2026-09-24 | 收录 `0x0011 TestsNotPassed`；「初始化」主题指向该标号 |
| 2026-09-24 | 收录 `0x0012`–`0x001B` |
