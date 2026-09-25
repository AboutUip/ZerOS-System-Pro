# ZCP1 · CPU 协议文档索引

本目录存放 **ZerOS CPU Protocol（ZCP1）** 正文。

核心运行状态、执行命令和度量种类是封闭数值集合，留在正文。查询字段与指令失败的错误码、来源会追加，分别以登记表为准。

权威优先级：登记表 > 索引 > 正文摘要。

| 文档 | 类型 | 说明 |
|------|------|------|
| [ZCP1.md](./ZCP1.md) | 协议正文 | 核心数声明、8 个寄存器、调度、访存、失败记录与面板 |
| [CallingConvention.md](./CallingConvention.md) | 程序约定 | `r0` 返回值，`r1`–`r3` 参数，`r6` / `r7` 链接。不约束 CPU |
| [QueryRegistry.md](./QueryRegistry.md) | 登记表 | `query` 的座位与字段 |
| [QueryIndex.md](./QueryIndex.md) | 索引 | 查询字段检索 |
| [FaultRegistry.md](./FaultRegistry.md) | 登记表 | 指令失败的错误码与来源 |
| [FaultIndex.md](./FaultIndex.md) | 索引 | 错误码与来源检索 |

## 约定

- 本文是 CPU 的领域协议。可插拔插座短名 `Cpu` 登记在 ZVHP1。
- 指令文本的语言简称是 `ZAP`，写法在 [ZCP1.md](./ZCP1.md) §4.6。
- 参考实现（非规范）：`ZerOS-PRO/Hardware/Cpu/`。其中 `Docs/` 只描述这一份官方实现。
- 官方实现声明的核心数不是协议常量。另一份实现可以只声明 1 个核心。
