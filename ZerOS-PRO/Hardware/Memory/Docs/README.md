# 官方虚拟内存 · API 文档

本目录只描述 **ZerOS-PRO 自带的这一份虚拟内存实现** 的调用表面。

## 两份文档，两种读者

| | 内存协议 | 本目录 |
|--|----------|--------|
| 份数 | 只有一份 | 每个虚拟内存实现各自一份；这里是官方实现 |
| 路径 | [`Documents/Protocol/PhysicalHardware/Memory/`](../../../../Documents/Protocol/PhysicalHardware/Memory/README.md) | `ZerOS-PRO/Hardware/Memory/Docs/` |
| 回答的问题 | 怎样才算符合 ZMP1 | 官方实现导出了什么、构造时做了什么、当前标定是多少 |
| 对其它实现 | 必须遵守 | 不必同名、不必同标定、不必带这份文档 |

协议正文不因本目录而增加条款。本目录也不裁决兼容性。两边冲突时，以 ZMP1 及其登记表 / 索引为准。

## 这份实现是什么

- 命名空间：`ZerOS.Hardware.Memory`
- 源码：`ZerOS-PRO/Hardware/Memory/`（本目录除外，本目录没有可执行代码）
- 插头：`ActiveMemoryProvider`，默认转发 `ReferenceMemoryProvider`
- 声称的领域协议：`ZMP1`

换一套虚拟内存：整体替换 [`ActiveProvider/`](../ActiveProvider/README.md)。主板导入路径不变。替换后的实现遵守 ZMP1 与 ZVHP1，不遵守本目录里的官方方法名与标定值。

官方这份实现上电时的内存 Hz 是 `100000000`。字宽不超过 8 的一次访问计 1 拍，更宽的按字节数计拍。一次访问只等待一次，短于 1 毫秒则不挂起。程序用 ZAP 的 `mem.hertz` 与 `mem.metric` 改读这个记录。Obr 侧的函数头在 [`memory.mr`](../memory.mr)，`import memory` 之后每次调用仍是一条已有的 `ldi` / `sti` 或 `mem.hertz` / `mem.metric`，不另建栈帧，也不增加 ZMP1 条款。

## 文档

| 文档 | 内容 |
|------|------|
| [OfficialApi.md](./OfficialApi.md) | 官方实现当前导出的类型、常量、构造、`Initialize`，以及 Obr 函数头 |
