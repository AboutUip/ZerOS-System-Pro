# ZMP1 内存单元初始化状态索引（InitState Index）

> 路径：`Documents/Protocol/PhysicalHardware/Memory/InitStateIndex.md`  
> 所属协议：`ZMP1`（见 [ZMP1.md](./ZMP1.md) §4.12）  
> 规范状态：**索引（与登记表一致；冲突以登记表为准）**  
> 编码登记册：[InitStateRegistry.md](./InitStateRegistry.md)

## 0. 文档定位

本文提供对 **`InitState` 已登记档位** 的专一多维检索。

- 取值与语义的权威定义以 [InitStateRegistry.md](./InitStateRegistry.md) 为准。
- 字段存在性与主路径生命周期约束见 [ZMP1.md](./ZMP1.md) §4.12。
- 若本文与登记表冲突，**以登记表为准**。

## 1. 按取值索引

| 取值 | 规范短名 | 跳转 |
|------|----------|------|
| `0x0` | `InvalidPending` | [登记表](./InitStateRegistry.md#2-登记表完整六档) |
| `0x1` | `Preparing` | [登记表](./InitStateRegistry.md#2-登记表完整六档) |
| `0x2` | `InitFault` | [登记表](./InitStateRegistry.md#2-登记表完整六档) |
| `0x3` | `InitComplete` | [登记表](./InitStateRegistry.md#2-登记表完整六档) |
| `0x4` | `Active` | [登记表](./InitStateRegistry.md#2-登记表完整六档) |
| `0x5` | `Unrecoverable` | [登记表](./InitStateRegistry.md#2-登记表完整六档) |

## 2. 按规范短名索引

| 规范短名 | 取值 | 一句话 |
|----------|------|--------|
| `InvalidPending` | `0x0` | 未执行任何操作前 |
| `Preparing` | `0x1` | 实例化进行中 |
| `InitFault` | `0x2` | 实例化 / 初始化失败 |
| `InitComplete` | `0x3` | 实例化成功（尚未正式可用） |
| `Active` | `0x4` | 正式可用（唯一） |
| `Unrecoverable` | `0x5` | 无法恢复异常（终局） |

## 3. 按生命周期阶段索引（主路径）

| 阶段 | 应处取值 | 短名 |
|------|----------|------|
| A. 未执行任何操作前 | `0x0` | `InvalidPending` |
| B. 颗粒被实例化期间 | `0x1` | `Preparing` |
| C. 实例化完成（成功） | `0x3` | `InitComplete` |
| C. 实例化完成（失败） | `0x2` | `InitFault` |
| D. 全部初始化完成 → 正式可用 | `0x4` | `Active` |
| 无法恢复终局 | `0x5` | `Unrecoverable` |

## 4. 按主题词索引

| 主题词 | 相关取值 |
|--------|----------|
| 未操作 / 无效 / 待初始化 | `0x0` |
| 实例化中 / Preparing | `0x1` |
| 失败 / Fault | `0x2` |
| 实例化完成 / Complete | `0x3` |
| 正式可用 / Active | `0x4` |
| 无法恢复 / 终局 / Unrecoverable | `0x5` |

## 5. 快速核对清单

- [ ] 字段名精确为 `InitState`  
- [ ] 未执行任何操作前为 `0x0`  
- [ ] 实例化期间为 `0x1`  
- [ ] 实例化完成成功为 `0x3`、失败为 `0x2`（无法恢复为 `0x5`）  
- [ ] 全部初始化完成后成功路径为 `0x4`  
- [ ] **仅**在 `0x4` 时宣称正式可用  
- [ ] 当前取值 ∈ {`0x0`,`0x1`,`0x2`,`0x3`,`0x4`,`0x5`}  
- [ ] 未将 `0x5` 单元再宣称已恢复可用  

## 6. 修订记录

| 日期 | 变更 |
|------|------|
| 2026-07-18 | 首版：取值 / 短名 / 生命周期 / 主题词四维索引 |
| 2026-07-19 | 追加 `0x5 Unrecoverable`；核对清单扩至六档 |
| 2026-07-19 | 生命周期索引对齐主路径 A→B→C→D；仅 `0x4` 正式可用 |
