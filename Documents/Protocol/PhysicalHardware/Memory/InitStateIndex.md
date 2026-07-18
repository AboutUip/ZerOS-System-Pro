# ZMP1 内存单元初始化状态索引（InitState Index）

> 路径：`Documents/Protocol/PhysicalHardware/Memory/InitStateIndex.md`  
> 所属协议：`ZMP1`（见 [ZMP1.md](./ZMP1.md) §4.12）  
> 规范状态：**索引（与登记表一致；冲突以登记表为准）**  
> 编码登记册：[InitStateRegistry.md](./InitStateRegistry.md)

## 0. 文档定位

本文提供对 **`InitState` 已登记档位** 的专一多维检索。

- 取值与语义的权威定义以 [InitStateRegistry.md](./InitStateRegistry.md) 为准。
- 字段存在性与默认值约束见 [ZMP1.md](./ZMP1.md) §4.12。
- 若本文与登记表冲突，**以登记表为准**。

## 1. 按取值索引

| 取值 | 规范短名 | 跳转 |
|------|----------|------|
| `0x0` | `InvalidPending` | [登记表](./InitStateRegistry.md#2-登记表完整五档) |
| `0x1` | `Preparing` | [登记表](./InitStateRegistry.md#2-登记表完整五档) |
| `0x2` | `InitFault` | [登记表](./InitStateRegistry.md#2-登记表完整五档) |
| `0x3` | `InitComplete` | [登记表](./InitStateRegistry.md#2-登记表完整五档) |
| `0x4` | `Active` | [登记表](./InitStateRegistry.md#2-登记表完整五档) |

## 2. 按规范短名索引

| 规范短名 | 取值 | 一句话 |
|----------|------|--------|
| `InvalidPending` | `0x0` | 无效待初始化（默认） |
| `Preparing` | `0x1` | 准备 / 初始化中 |
| `InitFault` | `0x2` | 初始化异常 |
| `InitComplete` | `0x3` | 初始化完成（未启用） |
| `Active` | `0x4` | 正式启用 |

## 3. 按生命周期阶段索引

| 阶段 | 应处取值 | 短名 |
|------|----------|------|
| 构造完成、待初始化 | `0x0` | `InvalidPending` |
| 初始化进行中 | `0x1` | `Preparing` |
| 初始化失败 | `0x2` | `InitFault` |
| 初始化成功、待启用 | `0x3` | `InitComplete` |
| 正式启用 | `0x4` | `Active` |

## 4. 按主题词索引

| 主题词 | 相关取值 |
|--------|----------|
| 默认 / 无效 / 待初始化 | `0x0` |
| 准备 / 进行中 | `0x1` |
| 失败 / 异常 / Fault | `0x2` |
| 完成 / Complete | `0x3` |
| 启用 / Active / 可用 | `0x4` |

## 5. 快速核对清单

- [ ] 字段名精确为 `InitState`  
- [ ] 构造后默认为 `0x0`  
- [ ] 当前取值 ∈ {`0x0`,`0x1`,`0x2`,`0x3`,`0x4`}  
- [ ] 未在非 `0x4` 时宣称「正式启用」  

## 6. 修订记录

| 日期 | 变更 |
|------|------|
| 2026-07-18 | 首版：取值 / 短名 / 生命周期 / 主题词四维索引 |
