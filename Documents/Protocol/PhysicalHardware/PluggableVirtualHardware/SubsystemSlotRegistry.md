# ZVHP1 子系统 Slot 短名登记表（Subsystem Slot Registry）

> 路径：`Documents/Protocol/PhysicalHardware/PluggableVirtualHardware/SubsystemSlotRegistry.md`  
> 所属协议：`ZVHP1`（见 [ZVHP1.md](./ZVHP1.md)）  
> 规范状态：**规范性（已登记 Slot 短名）**  
> 配套索引：[SubsystemSlotIndex.md](./SubsystemSlotIndex.md)

## 0. 文档定位

本文是 ZVHP1 **子系统插座短名**的权威登记册。

- 未在本文登记的 Slot 短名**禁止**冒充 ZVHP1 已定义插座。
- 冲突时：登记表 > 索引 > 协议正文摘要。

## 1. 编码规则

| 规则 | 要求 |
|------|------|
| 短名字符集 | 可打印 ASCII；推荐 PascalCase 单词 |
| 唯一性 | 短名全局唯一；**禁止**复用他义 |
| 插座对象名 | 内存路径规范对象名为 `MemorySlot`（短名 `Memory` + 后缀 `Slot`） |
| 升版 | 增删改必须修订本表，并在 ZVHP1 修订记录可追溯 |

## 2. 登记表

| 短名 | 规范插座对象名 | 领域协议（ActiveProtocol） | 状态 | 说明 |
|------|----------------|----------------------------|------|------|
| `Memory` | `MemorySlot` | `ZMP1` | 已登记 | 虚拟内存硬件可插拔插座 |
| `Cpu` | `CpuSlot` | `ZCP1` | 已登记 | 虚拟 CPU。核心数由实现声明 |
| `Gpu` | `GpuSlot` | `ZGP1` | 已登记 | 帧宽高由实现声明。主板只转交帧副本 |
| `Bus` | `BusSlot` | （待独立协议） | 预留 | 尚未启用。ZXP1 的 4 个扩展口不是本行 |

## 3. 修订记录

| 日期 | 变更 |
|------|------|
| 2026-07-18 | 首版：登记 `Memory`；预留 `Cpu` / `Bus` |
| 2026-09-24 | `Cpu` 启用，领域协议 `ZCP1` |
| 2026-09-25 | 注明 ZXP1 扩展口不是 `Bus` |
