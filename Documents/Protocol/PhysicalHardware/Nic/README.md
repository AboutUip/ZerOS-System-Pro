# 网卡协议索引

| 协议 | 管什么 | 正文 |
|------|--------|------|
| **ZNC1** | 哑网卡：原始以太网帧收发与控制字 | [ZNC1.md](./ZNC1.md) |

ZNC1 坐 [ZXP1](../Expansion/ZXP1.md) 的扩展口，数据交换走 [ZXD1](../Expansion/ZXD1.md)。它不是 ZVHP1 的 `BusSlot`。

网卡只搬原始以太网帧，不提供 HTTP、DNS、TCP、UDP 或 socket 级 API。网络栈、连接、重传和调度属于驱动。
