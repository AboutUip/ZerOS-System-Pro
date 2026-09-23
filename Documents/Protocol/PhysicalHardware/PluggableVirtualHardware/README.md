# ZVHP1 · Pluggable Virtual Hardware 协议文档索引

本目录存放 **ZerOS Virtual Hardware Pluggable Protocol（ZVHP1）** 正文及专一登记 / 索引。权威冲突时：登记表 > 索引 > 正文摘要。

| 文档 | 类型 | 说明 |
|------|------|------|
| [ZVHP1.md](./ZVHP1.md) | 协议正文 | 可插拔 Slot / Provider / Bind·GetActive；与 ZMP1 门面衔接 |
| [SubsystemSlotRegistry.md](./SubsystemSlotRegistry.md) | 专一登记 | 子系统 Slot 短名 |
| [SubsystemSlotIndex.md](./SubsystemSlotIndex.md) | 专一索引 | Slot 检索与 Memory Provider 核对清单 |

## 约定

- 内存领域契约见 [`../Memory/`](../Memory/)（ZMP1）。
- 快速替换（推荐）：整体替换 `ZerOS-PRO/Hardware/Memory/ActiveProvider/`（见 ZVHP1 §4.7），无需改主板源码。
- 参考实现：`ZerOS-PRO/Hardware/Motherboard/Slot/`、`ZerOS-PRO/Hardware/Memory/ActiveProvider/`（非规范）。
