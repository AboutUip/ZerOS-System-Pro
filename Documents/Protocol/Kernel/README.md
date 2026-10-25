# 内核文本

本目录是内核与显卡之间的文本契约。固件点阵不在这里。

| 文档 | 说明 |
|------|------|
| [Utf8.md](./Utf8.md) | 字节串到 Unicode 标量。失败必须给出字节下标 |

字体文件、光栅和绘制命令在 [../PhysicalHardware/Gpu/Font.md](../PhysicalHardware/Gpu/Font.md)。冲突时，标量的合法性以本文为准，字形像素以字体面为准。
