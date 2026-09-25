# 官方显示器

这一份是 ZDP1 的官方实现。协议正文在 `Documents/Protocol/PhysicalHardware/Display/ZDP1.md`。本目录的 `Docs/` 只描述这一份实现。

| 文档 | 说明 |
|------|------|
| [OfficialApi.md](./OfficialApi.md) | 官方字段、宿主接法、页面封印 |

显示器不经主板接入。页面先接上画布。主板、内存、CPU 和显卡自检都通过之后，页面再做显示器自检，然后接收显卡交出的一帧。换一份显示器实现时，对齐的是 ZDP1 的帧缓冲，不是这里的 `Attach`。
