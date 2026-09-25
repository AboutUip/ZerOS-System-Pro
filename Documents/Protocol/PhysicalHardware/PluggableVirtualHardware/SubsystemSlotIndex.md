# ZVHP1 子系统 Slot 索引（Subsystem Slot Index）

> 路径：`Documents/Protocol/PhysicalHardware/PluggableVirtualHardware/SubsystemSlotIndex.md`  
> 所属协议：`ZVHP1`  
> 规范状态：**索引（冲突以登记表为准）**  
> 编码登记册：[SubsystemSlotRegistry.md](./SubsystemSlotRegistry.md)

## 1. 按短名索引

| 短名 | 插座对象名 | 状态 | 跳转 |
|------|------------|------|------|
| `Memory` | `MemorySlot` | 已登记 | [登记表](./SubsystemSlotRegistry.md#2-登记表) |
| `Cpu` | `CpuSlot` | 已登记 | [登记表](./SubsystemSlotRegistry.md#2-登记表) |
| `Gpu` | `GpuSlot` | 已登记 | [登记表](./SubsystemSlotRegistry.md#2-登记表) |
| `Bus` | `BusSlot` | 预留 | [登记表](./SubsystemSlotRegistry.md#2-登记表) |

## 2. 按领域协议索引

| ActiveProtocol | 相关 Slot | 说明 |
|----------------|-----------|------|
| `ZMP1` | `Memory` | 内存 Provider 必须声明 |
| `ZCP1` | `Cpu` | CPU Provider 必须声明。`CoreCount` 是该实现的核心数上限 |
| `ZGP1` | `Gpu` | 显卡 Provider 必须声明。`FrameWidth` / `FrameHeight` 是该实现的帧尺寸 |
| （未定） | `Bus` | 预留 |

## 3. 快速核对清单（Memory Provider）

- [ ] 对象可经 `MemorySlot.Bind` 绑定  
- [ ] 含 `ProviderId` / `ProviderVendor` / `ActiveProtocol`（`ActiveProtocol === "ZMP1"`）  
- [ ] 含 `MachineMemory.MemoryInit.Initialize`  
- [ ] 符合 [ZVHP1.md](./ZVHP1.md) §4.2–§4.5 与 [ZMP1](../Memory/ZMP1.md) §4.14  

## 4. 修订记录

| 日期 | 变更 |
|------|------|
| 2026-07-18 | 首版索引 |
| 2026-09-24 | `Cpu` / `ZCP1` 进入索引 |
| 2026-09-24 | `Gpu` / `ZGP1` 进入索引 |
