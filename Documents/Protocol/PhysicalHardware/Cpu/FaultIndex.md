# ZCP1 指令失败索引

> 路径：`Documents/Protocol/PhysicalHardware/Cpu/FaultIndex.md`  
> 权威优先级：[FaultRegistry.md](./FaultRegistry.md) > 本索引 > [ZCP1.md](./ZCP1.md) 摘要

本索引不增加登记表以外的标号。

## 1. 按错误码

| 标号 | 短名 |
|------|------|
| `0` | [Unspecified](./FaultRegistry.md#2-错误码) |
| `1` | [JumpOutOfRange](./FaultRegistry.md#2-错误码) |
| `2` | [RegisterIndex](./FaultRegistry.md#2-错误码) |
| `3` | [CoreNotRunning](./FaultRegistry.md#2-错误码) |
| `4` | [CoreBusy](./FaultRegistry.md#2-错误码) |
| `5` | [HertzOutOfRange](./FaultRegistry.md#2-错误码) |
| `6` | [BadOpcode](./FaultRegistry.md#2-错误码) |
| `7` | [MetricKind](./FaultRegistry.md#2-错误码) |
| `8` | [Exchange](./FaultRegistry.md#2-错误码) |
| `9` | [Query](./FaultRegistry.md#2-错误码) |
| `10` | [Gpu](./FaultRegistry.md#2-错误码) |
| `11` | [Memory](./FaultRegistry.md#2-错误码) |

## 2. 按来源

| 标号 | 短名 |
|------|------|
| `0` | [Board](./FaultRegistry.md#3-来源) |
| `1` | [Cpu](./FaultRegistry.md#3-来源) |
| `2` | [Memory](./FaultRegistry.md#3-来源) |
| `3` | [Gpu](./FaultRegistry.md#3-来源) |
| `4` | [Display](./FaultRegistry.md#3-来源) |
| `5` | [Expansion](./FaultRegistry.md#3-来源) |
| `6` | [Keyboard](./FaultRegistry.md#3-来源) |

## 3. 按主题

| 主题 | 标号 |
|------|------|
| 尚未归类 | 错误码 `0` |
| 取指与跳转 | 错误码 `1` |
| 寄存器 | 错误码 `2` |
| 核心状态 | 错误码 `3`、`4` |
| 频率与指标 | 错误码 `5`、`7` |
| 访存 | 错误码 `6`、`11` |
| 扩展口与键盘 | 错误码 `8`，来源 `5`、`6` |
| 查询 | 错误码 `9` |
| 显卡 | 错误码 `10`，来源 `3` |
