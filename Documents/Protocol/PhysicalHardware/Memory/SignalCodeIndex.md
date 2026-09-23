# ZMP1 内存信号索引（Signal Code Index）

> 路径：`Documents/Protocol/PhysicalHardware/Memory/SignalCodeIndex.md`  
> 所属协议：`ZMP1`（见 [ZMP1.md](./ZMP1.md) §4.13）  
> 规范状态：**索引（冲突以登记表为准）**  
> 编码登记册：[SignalCodeRegistry.md](./SignalCodeRegistry.md)

## 0. 文档定位

本文只检索已登记信号。权威语义在登记表。

## 1. 按标号索引

| 标号 | 规范短名 | 登记状态 | 跳转 |
|------|----------|----------|------|
| `0x0001` | `Usable` | 已登记 | [登记表](./SignalCodeRegistry.md#2-登记表) |
| `0x0002` | `Fault` | 已登记 | [登记表](./SignalCodeRegistry.md#2-登记表) |
| `0x0003` | `Ready` | 已登记 | [登记表](./SignalCodeRegistry.md#2-登记表) |

## 2. 按规范短名索引

| 规范短名 | 标号 | 一句话 |
|----------|------|--------|
| `Usable` | `0x0001` | 该颗粒是否正式可用 |
| `Fault` | `0x0002` | 该颗粒是否处于失败终局 |
| `Ready` | `0x0003` | 总控是否至少有一颗正式可用颗粒 |

## 3. 按挂载处索引

| 挂载处 | 标号 |
|--------|------|
| 颗粒 `Signals` | `0x0001`、`0x0002` |
| 总控 `Signals` | `0x0003` |

## 4. 按电平索引

| Level | 含义 |
|-------|------|
| `0` | 该条件不成立 |
| `1` | 该条件成立 |

禁止用布尔值代替 `0` / `1`。

## 5. 快速核对清单

- [ ] 同一 `SignalCode` + `Subject` 只有一条
- [ ] `Level` 是整数 `0` 或 `1`
- [ ] `Ready` 的 `Subject` 是 `0`

## 6. 修订记录

| 日期 | 变更 |
|------|------|
| 2026-09-24 | 首版：收录 `0x0001`–`0x0003` |
