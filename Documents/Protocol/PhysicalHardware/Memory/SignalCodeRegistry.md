# ZMP1 内存信号标号登记表（Signal Code Registry）

> 路径：`Documents/Protocol/PhysicalHardware/Memory/SignalCodeRegistry.md`  
> 所属协议：`ZMP1`（见 [ZMP1.md](./ZMP1.md) §4.13）  
> 规范状态：**规范性（已登记标号）**  
> 配套索引：[SignalCodeIndex.md](./SignalCodeIndex.md)

## 0. 文档定位

本文是 ZMP1 **信号标号（`SignalCode`）** 的编码登记册。信号是电平，不是追加日志。

- **约束对象**：声称兼容 ZMP1、并维护 `Signals` 的实现。
- **非目标**：不规定宿主如何观察信号。事件见 [EventCodeRegistry.md](./EventCodeRegistry.md)。

读者无需阅读 ZerOS-PRO 源码。冲突时：**本文 > [SignalCodeIndex.md](./SignalCodeIndex.md) > [ZMP1.md](./ZMP1.md) 正文摘要**。

## 1. 编码规则（必须遵守）

| 规则 | 要求 |
|------|------|
| 空间 | `0x0001`–`0xFFFF` |
| 元素 | 每条信号必须恰好含 `SignalCode`、`Level`、`Subject`。`SignalCode` 与 `Subject` 是 Uint32。`Level` 只能是整数 `0` 或 `1` |
| 更新 | 同一 `SignalCode` 与同一 `Subject` 在数组里只保留一条。后写的 `Level` 覆盖先前的 |
| 升版 | 增删改已登记含义必须修订本表，并在 [ZMP1.md](./ZMP1.md) 修订记录中可追溯 |

## 2. 登记表

| 标号 | 规范短名 | 记在 | Subject | `Level = 1` 当且仅当 | 状态 |
|------|----------|------|---------|----------------------|------|
| `0x0001` | `Usable` | 该颗粒 `Signals` | `UnitOrdinal` | `InitState` 为 `0x4` | 已登记 |
| `0x0002` | `Fault` | 该颗粒 `Signals` | `UnitOrdinal` | `InitState` 为 `0x2` 或 `0x5` | 已登记 |
| `0x0003` | `Ready` | 总控 `Signals` | `0` | 至少有一颗颗粒的 `InitState` 为 `0x4` | 已登记 |

颗粒进入 `0x2`、`0x3`、`0x4` 或 `0x5` 时，必须按上表刷新该颗粒的 `Usable` 与 `Fault`。总控在浅切与阶段 D 收尾时必须刷新 `Ready`。`0x0` 与 `0x1` 不要求已经出现这两条颗粒信号。

## 3. 预留与待登记

| 号段 / 标号 | 说明 |
|-------------|------|
| `0x0000` | 不使用 |
| `0x0004` 起 | 尚未登记，禁止当作已定义稳定含义使用 |

## 4. 登记流程（后续追加时）

1. 在本表 §2 追加一行；
2. 更新 [SignalCodeIndex.md](./SignalCodeIndex.md)；
3. 若影响正文，同步修订 [ZMP1.md](./ZMP1.md) §4.13 与修订记录；
4. 若参考实现导出标号常量，须与本文短名和取值双向一致。

## 5. 修订记录

| 日期 | 变更 |
|------|------|
| 2026-09-24 | 首版：登记 `0x0001`–`0x0003` |
