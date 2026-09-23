# ZMP1 初始化前测试用例索引（Test Case Index）

> 路径：`Documents/Protocol/PhysicalHardware/Memory/TestCaseIndex.md`  
> 所属协议：`ZMP1`（见 [ZMP1.md](./ZMP1.md) §4.22）  
> 规范状态：**索引（与登记表一致；冲突以登记表为准）**  
> 用例登记册：[TestCaseRegistry.md](./TestCaseRegistry.md)

## 0. 文档定位

本文提供对**已登记**初始化前用例的检索。通过条件的权威文本在登记表 §3。

- 一次 `Test` 必须按登记表顺序执行全部已登记用例。
- 若本文与登记表冲突，**以登记表为准**，并应立即修正本文。

## 1. 按执行顺序索引

| 顺序 | 规范名 | 登记状态 | 跳转 |
|------|--------|----------|------|
| 1 | `StorageCleared` | 已登记 | [登记表](./TestCaseRegistry.md#31-storagecleared) |
| 2 | `UnitOrdinalDense` | 已登记 | [登记表](./TestCaseRegistry.md#32-unitordinaldense) |
| 3 | `InactiveReportsUnitNotActive` | 已登记 | [登记表](./TestCaseRegistry.md#33-inactivereportsunitnotactive) |
| 4 | `BitRoundTrip` | 已登记 | [登记表](./TestCaseRegistry.md#34-bitroundtrip) |
| 5 | `IllegalBitRejected` | 已登记 | [登记表](./TestCaseRegistry.md#35-illegalbitrejected) |
| 6 | `OctetRoundTrip` | 已登记 | [登记表](./TestCaseRegistry.md#36-octetroundtrip) |
| 7 | `IllegalOctetRejected` | 已登记 | [登记表](./TestCaseRegistry.md#37-illegaloctetrejected) |
| 8 | `CrossUnitMatches` | 已登记 | [登记表](./TestCaseRegistry.md#38-crossunitmatches) |
| 9 | `UnitOrdinalOutOfRange` | 已登记 | [登记表](./TestCaseRegistry.md#39-unitordinaloutofrange) |
| 10 | `ShallowCutShape` | 已登记 | [登记表](./TestCaseRegistry.md#310-shallowcutshape) |
| 11 | `BlockPortAgrees` | 已登记 | [登记表](./TestCaseRegistry.md#311-blockportagrees) |
| 12 | `DeepenOneLevel` | 已登记 | [登记表](./TestCaseRegistry.md#312-deepenonelevel) |
| 13 | `CapacityIsOctetSum` | 已登记 | [登记表](./TestCaseRegistry.md#313-capacityisoctetsum) |
| 14 | `MemoryIdDraw` | 已登记 | [登记表](./TestCaseRegistry.md#314-memoryiddraw) |
| 15 | `LinearBitRoundTrip` | 已登记 | [登记表](./TestCaseRegistry.md#315-linearbitroundtrip) |
| 16 | `IntegerLittleEndian` | 已登记 | [登记表](./TestCaseRegistry.md#316-integerlittleendian) |
| 17 | `BlockOctetRoundTrip` | 已登记 | [登记表](./TestCaseRegistry.md#317-blockoctetroundtrip) |
| 18 | `ClaimReleaseZeros` | 已登记 | [登记表](./TestCaseRegistry.md#318-claimreleasezeros) |

## 2. 按规范名索引

| 规范名 | 顺序 | 一句话 |
|--------|------|--------|
| `StorageCleared` | 1 | 阶段 D 之后存储体要么全 0，要么为空 |
| `UnitOrdinalDense` | 2 | 序号恰好覆盖 `0 .. UnitCount-1` |
| `InactiveReportsUnitNotActive` | 3 | 未正式可用时先报告 `0x0007` |
| `BitRoundTrip` | 4 | 一位写入可读回，且不碰到相邻位 |
| `IllegalBitRejected` | 5 | 位元值 `2` 被拒绝 |
| `OctetRoundTrip` | 6 | 八位组 `129` 与位序一致，并可恢复 |
| `IllegalOctetRejected` | 7 | 八位组值 `256` 被拒绝 |
| `CrossUnitMatches` | 8 | 总控端口与颗粒端口一致 |
| `UnitOrdinalOutOfRange` | 9 | 越界序号记在总控，满量程不误报 |
| `ShallowCutShape` | 10 | 浅切的块数、深度和跨度 |
| `BlockPortAgrees` | 11 | 块内偏移与线性落点一致 |
| `DeepenOneLevel` | 12 | 一次只加一层，存储体不复制 |
| `CapacityIsOctetSum` | 13 | 总容量是各颗八位组长度之和 |
| `MemoryIdDraw` | 14 | 抽出已启用的 MemoryId，且不改配置面 |
| `LinearBitRoundTrip` | 15 | 线性地址 0 对上第 0 颗的位元 0 |
| `IntegerLittleEndian` | 16 | 低八位组是最低有效字节 |
| `BlockOctetRoundTrip` | 17 | 块内八位组的位元 0 是最低有效位 |
| `ClaimReleaseZeros` | 18 | 领取、拒绝重复领取，归还后清零 |

## 3. 按主题词索引

| 主题词 | 相关用例 |
|--------|----------|
| 存储体 / 清零 | `StorageCleared` |
| 序号 | `UnitOrdinalDense`、`UnitOrdinalOutOfRange`、`CrossUnitMatches` |
| 尚未正式可用 | `InactiveReportsUnitNotActive` |
| 位元端口 | `BitRoundTrip`、`IllegalBitRejected` |
| 八位组端口 | `OctetRoundTrip`、`IllegalOctetRejected` |
| 浅切 / 块跨度 | `ShallowCutShape`、`BlockPortAgrees` |
| 加深 | `DeepenOneLevel` |
| 总容量 / 内存 ID | `CapacityIsOctetSum`、`MemoryIdDraw` |
| 线性地址 | `LinearBitRoundTrip` |
| 小端整数 | `IntegerLittleEndian` |
| 块内八位组 | `BlockOctetRoundTrip` |
| 所有权 | `ClaimReleaseZeros` |

## 4. 快速核对清单（实现 `Test` 时）

- [ ] 无参数，无返回值  
- [ ] `Cases` 的长度、顺序、`CaseName` 与登记表一致  
- [ ] 某一条失败或抛错之后，后面的用例仍然执行  
- [ ] 不把临时总控写入 `MachineMemory.MemoryController`  
- [ ] `AllPassed` 为 `1` 当且仅当每一条 `Passed` 都是 `1`  
- [ ] 通过的条目 `Summary` 为空字符串  

## 5. 修订记录

| 日期 | 变更 |
|------|------|
| 2026-09-24 | 首版：收录顺序 1–12 |
| 2026-09-24 | 收录顺序 13–18 |
