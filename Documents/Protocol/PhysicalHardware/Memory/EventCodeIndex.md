# ZMP1 内存事件索引（Event Code Index）

> 路径：`Documents/Protocol/PhysicalHardware/Memory/EventCodeIndex.md`  
> 所属协议：`ZMP1`（见 [ZMP1.md](./ZMP1.md) §4.13）  
> 规范状态：**索引（冲突以登记表为准）**  
> 编码登记册：[EventCodeRegistry.md](./EventCodeRegistry.md)

## 0. 文档定位

本文只检索已登记事件。权威语义在登记表。

## 1. 按标号索引

| 标号 | 规范短名 | 登记状态 | 跳转 |
|------|----------|----------|------|
| `0x0001` | `BecameActive` | 已登记 | [登记表](./EventCodeRegistry.md#2-登记表) |
| `0x0002` | `InitFailed` | 已登记 | [登记表](./EventCodeRegistry.md#2-登记表) |
| `0x0003` | `BecameUnrecoverable` | 已登记 | [登记表](./EventCodeRegistry.md#2-登记表) |
| `0x0004` | `Instantiated` | 已登记 | [登记表](./EventCodeRegistry.md#2-登记表) |
| `0x0005` | `ShallowCutCompleted` | 已登记 | [登记表](./EventCodeRegistry.md#2-登记表) |
| `0x0006` | `Deepened` | 已登记 | [登记表](./EventCodeRegistry.md#2-登记表) |
| `0x0007` | `Claimed` | 已登记 | [登记表](./EventCodeRegistry.md#2-登记表) |
| `0x0008` | `Released` | 已登记 | [登记表](./EventCodeRegistry.md#2-登记表) |

## 2. 按规范短名索引

| 规范短名 | 标号 | 一句话 |
|----------|------|--------|
| `BecameActive` | `0x0001` | 颗粒进入正式可用 |
| `InitFailed` | `0x0002` | 颗粒实例化失败 |
| `BecameUnrecoverable` | `0x0003` | 颗粒进入无法恢复终局 |
| `Instantiated` | `0x0004` | 颗粒实例化成功，停在 `0x3` |
| `ShallowCutCompleted` | `0x0005` | 浅切完成 |
| `Deepened` | `0x0006` | 一块加深了一层 |
| `Claimed` | `0x0007` | 浅切根被领取 |
| `Released` | `0x0008` | 浅切根被归还并清零 |

## 3. 按挂载处索引

| 挂载处 | 标号 |
|--------|------|
| 颗粒 `Events` | `0x0001`–`0x0004` |
| 总控 `Events` | `0x0005`–`0x0008` |

## 4. 按主题词索引

| 主题词 | 相关标号 |
|--------|----------|
| 生命周期 | `0x0001`–`0x0004` |
| 浅切 | `0x0005` |
| 加深 | `0x0006` |
| 所有权 | `0x0007`、`0x0008` |

## 5. 快速核对清单

- [ ] 元素含且仅按规范性识别 `EventCode`、`Subject`、`Detail`
- [ ] `EventCode` 已在登记表出现
- [ ] `0x0` / `0x1` 没有对应事件
- [ ] 数组只追加，不按标号覆盖

## 6. 修订记录

| 日期 | 变更 |
|------|------|
| 2026-09-24 | 首版：收录 `0x0001`–`0x0008` |
