# ZMP1 内存事件标号登记表（Event Code Registry）

> 路径：`Documents/Protocol/PhysicalHardware/Memory/EventCodeRegistry.md`  
> 所属协议：`ZMP1`（见 [ZMP1.md](./ZMP1.md) §4.13）  
> 规范状态：**规范性（已登记标号）**  
> 配套索引：[EventCodeIndex.md](./EventCodeIndex.md)

## 0. 文档定位

本文是 ZMP1 **事件标号（`EventCode`）** 的编码登记册。

- **约束对象**：声称兼容 ZMP1、并维护 `Events` 的实现。
- **作用**：把已采纳的生命周期、浅切、加深与所有权事件固化为稳定十六进制标号。
- **非目标**：不规定宿主如何投递事件。不规定 `Exceptions`。信号电平见 [SignalCodeRegistry.md](./SignalCodeRegistry.md)。

读者无需阅读 ZerOS-PRO 源码。冲突时：**本文 > [EventCodeIndex.md](./EventCodeIndex.md) > [ZMP1.md](./ZMP1.md) 正文摘要**。

## 1. 编码规则（必须遵守）

| 规则 | 要求 |
|------|------|
| 空间 | `0x0001`–`0xFFFF`（`0x0000` 不表示任何事件） |
| 分配 | 新标号按升序追加；禁止复用已登记号作他义 |
| 记法 | 四位十六进制 |
| 元素 | 每条事件必须恰好含 `EventCode`、`Subject`、`Detail`，三者都是 Uint32。`EventCode` 必须是已登记标号 |
| 追加 | `Events` 只追加。禁止用后来的事件覆盖先前的条目 |
| 升版 | 增删改已登记含义必须修订本表，并在 [ZMP1.md](./ZMP1.md) 修订记录中可追溯 |

`Subject` 与 `Detail` 的含义由下表按标号规定。没有额外细节时 `Detail` 必须为 `0`。

## 2. 登记表

| 标号 | 规范短名 | 记在 | Subject | Detail | 何时追加 | 状态 |
|------|----------|------|---------|--------|----------|------|
| `0x0001` | `BecameActive` | 该颗粒 `Events` | `UnitOrdinal` | `0` | `InitState` 从 `0x3` 进入 `0x4` | 已登记 |
| `0x0002` | `InitFailed` | 该颗粒 `Events` | `UnitOrdinal` | `0` | `InitState` 进入 `0x2` | 已登记 |
| `0x0003` | `BecameUnrecoverable` | 该颗粒 `Events` | `UnitOrdinal` | `0` | `InitState` 进入 `0x5` | 已登记 |
| `0x0004` | `Instantiated` | 该颗粒 `Events` | `UnitOrdinal` | `0` | `InitState` 进入 `0x3` | 已登记 |
| `0x0005` | `ShallowCutCompleted` | 总控 `Events` | 浅切根块数 | `0` | 浅切完成且阶段 D 已处理完各颗状态之后 | 已登记 |
| `0x0006` | `Deepened` | 总控 `Events` | `BlockIndex` | 子块的 `NestingDepth` | `Deepen` 成功 | 已登记 |
| `0x0007` | `Claimed` | 总控 `Events` | `BlockIndex` | 主人（Uint32） | `Claim` 成功 | 已登记 |
| `0x0008` | `Released` | 总控 `Events` | `BlockIndex` | 归还时的主人 | `Release` 已经清零并放下主人之后 | 已登记 |

`InitState` 为 `0x0` 或 `0x1` 时禁止追加上表事件。

## 3. 预留与待登记

| 号段 / 标号 | 说明 |
|-------------|------|
| `0x0000` | 不使用 |
| `0x0009` 起 | 尚未登记，禁止当作已定义稳定含义使用 |

## 4. 登记流程（后续追加时）

1. 在本表 §2 追加一行；
2. 更新 [EventCodeIndex.md](./EventCodeIndex.md)；
3. 若影响正文，同步修订 [ZMP1.md](./ZMP1.md) §4.13 与修订记录；
4. 若参考实现导出标号常量，须与本文短名和取值双向一致。

## 5. 修订记录

| 日期 | 变更 |
|------|------|
| 2026-09-24 | 首版：登记 `0x0001`–`0x0008` |
