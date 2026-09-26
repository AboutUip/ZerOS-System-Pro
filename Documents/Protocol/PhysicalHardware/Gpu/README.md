# ZGP1 · 显卡协议文档索引

本目录存放 **ZerOS GPU Protocol（ZGP1）** 正文。

帧尺寸的上下界、像素整数和字形编码是协议固定常量。字形字节是封闭表，不是可增长登记册，因此不单列 Registry / Index。节点树字形冲突时以 [Glyph.md](./Glyph.md) 为准，屏幕字形冲突时以 [AccelGlyph.md](./AccelGlyph.md) 为准，命令冲突时以正文为准。

| 文档 | 类型 | 说明 |
|------|------|------|
| [ZGP1.md](./ZGP1.md) | 协议正文 | 显存、频率、帧、绘图命令与 `Present` |
| [Glyph.md](./Glyph.md) | 封闭字形 | `0x20` 至 `0x7E` 的 8 行字节 |
| [AccelGlyph.md](./AccelGlyph.md) | 封闭字形 | `ScreenGlyph` 的 5×7 位图 |
| [AccelRegistry.md](./AccelRegistry.md) | 登记表 | `gpu.accel` 的操作码 |
| [AccelIndex.md](./AccelIndex.md) | 索引 | 操作码检索 |

## 约定

- 本文是显卡的领域协议。可插拔插座短名 `Gpu` 登记在 ZVHP1。
- 参考实现（非规范）：`ZerOS-PRO/Hardware/Gpu/`。其中 `Docs/` 只描述这一份官方实现。
- 面板的分辨率、刷新率和呈现属于显示器协议 ZDP1。本协议不规定面板。
- 官方实现声明的帧宽高、显存字节数和 Hz 都不是协议常量。另一份实现可以声明不同的合法值。
