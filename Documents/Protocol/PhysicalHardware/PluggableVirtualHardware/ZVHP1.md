# ZVHP1 — ZerOS Virtual Hardware Pluggable Protocol · 第 1 版

> 文档路径：`Documents/Protocol/PhysicalHardware/PluggableVirtualHardware/ZVHP1.md`  
> 规范状态：**规范性（Normative）**  
> 协议标识字符串（唯一）：`ZVHP1`  
> 参考实现（非规范）：`ZerOS-PRO/Hardware/Motherboard/Slot/`

---

## 0. 文档定位与符合性

### 0.1 目的

本文是 **ZerOS Virtual Hardware Pluggable Protocol 第 1 版（ZVHP1）** 的对外契约。

- 规定虚拟硬件**可插拔替换**时，主机与第三方实现必须共用的**插座名、Provider 形态、绑定语义**。
- 使社区实现可在**不修改坐座主机源码**的前提下替换参考实现。
- 第三方**不得以查阅 ZerOS-PRO 源码为前提**理解本文；仅依据本文即可判定是否兼容 ZVHP1。

### 0.2 与领域协议的关系

| 协议 | 职责 |
|------|------|
| **ZVHP1**（本文） | 插槽、Provider 元数据、`Bind` / `GetActive`、替换规则 |
| **ZMP1** 等 | 某一子系统（如内存）的配置、异常、单元状态、引导字段（如 `MachineMemory`） |

声称提供「可插拔内存实现」时：**必须**同时符合 ZVHP1 **与** 该子系统领域协议（内存为 ZMP1）。  
**禁止**仅满足其一却声称「可在 ZerOS-PRO 下热换内存」。

### 0.3 规范性用语

| 用语 | 含义 |
|------|------|
| **必须（MUST）** | 绝对要求；违反即不符合 ZVHP1 |
| **禁止（MUST NOT）** | 绝对禁止 |
| **应（SHOULD）** | 强烈建议 |
| **可以（MAY）** | 可选 |

### 0.4 符合性声明

仅当实现同时满足以下全部条件时，方可声称「完全兼容 ZVHP1」或同等含义：

1. 协议标识字符串精确为 `ZVHP1`（四个字符，大小写敏感）；
2. 提供本文规定的**全部必选字段与方法名**，拼写与大小写逐字一致；
3. 遵守本文对 Slot / Provider / Bind / GetActive 的语义与角色约束；
4. 对已登记子系统 Slot，其 Provider 所暴露的领域门面符合对应领域协议（如 Memory → ZMP1）；
5. 不依赖本文「明确不规定」的内容作为与 ZerOS-PRO 互操作的前提。

### 0.5 字段名与标识的规范性

- 本文给出的**规范名**（如 `ProviderId`、`Bind`、`GetActive`、`MemorySlot`）**必须**精确使用。
- **禁止**以语义近似名（如 `provider_id`、`bindProvider`、`Get`）冒充兼容 ZVHP1。

---

## 1. 概述

ZVHP1 规定虚拟硬件的可插拔模型：

- 每个子系统对应一个 **Slot**（插座）；
- 每个 Slot 在同一时刻至多绑定一个 **Provider**（插头 / 实现）；
- 坐座主机通过 **`Bind`** 选定实现，通过 **`GetActive`** 取得当前实现；
- 坐座主机**只经领域协议门面**调用（如 ZMP1 的 `MachineMemory.MemoryInit.Test` 与 `Initialize`），**禁止**把某一厂商私有类型写进引导契约。

---

## 2. 契约范围

### 2.1 本协议规定（规范性）

- 协议标识字符串 `ZVHP1`；
- Slot 规范短名登记与必选 Slot 集合（见专一登记文档）；
- Provider 必选元数据字段名与值域；
- Memory 子系统 Provider 必选领域门面字段（与 ZMP1 对齐的挂载名）；
- `Bind` / `GetActive` 的方法名、参数形态摘要、幂等与替换语义；
- 访问角色：谁可 `Bind`、谁应只读 `GetActive`；
- 符合性判定规则。

### 2.2 本协议明确不规定（非规范性缺口）

下列事项**不在** ZVHP1 内；**禁止**宣称为 ZVHP1 已规定：

- Provider 内部算法、数据结构、性能指标；
- 除已锁定最小集合外的业务 API（读写、调度等）；
- 宿主语言模块加载语法、包管理器、URL 查询参数如何映射到 `Bind`；
- 多 Provider 并存的负载均衡、热迁移、无停机切换算法；
- CPU / Bus 等子系统的领域协议正文（由其独立协议规定；本文仅预留 Slot 短名登记）；
- 参考实现目录布局与 TypeScript `namespace` 路径。

---

## 3. 术语

| 术语 | 定义 |
|------|------|
| Slot | 某一虚拟硬件子系统的插座；规范短名见登记表；同一时刻至多一个 Active Provider |
| Provider | 声称兼容 ZVHP1（及对应领域协议）的可绑定实现对象 |
| Active Provider | 经 `Bind` 成功后，`GetActive` 返回的当前 Provider；未绑定则为空 |
| 领域门面 | Provider 上暴露的、由领域协议规定的挂载对象（如 ZMP1 的 `MachineMemory`） |
| 参考实现 | ZerOS-PRO 自带实现；**不是**规范正文的一部分 |

---

## 4. 规范正文

### 4.0 协议标识

对外机器可读协议修订标识**必须**精确为字符串 `ZVHP1`。  
**禁止**使用 `zvhp1`、`ZVHP-1`、`ZVHP 1` 等变体冒充。

### 4.1 Slot（插座）

#### 4.1.1 必选 Slot

声称兼容 ZVHP1 且支持内存可插拔的主机**必须**提供规范名 **`MemorySlot`** 的插座对象。

权威 Slot 短名登记见：

- [SubsystemSlotRegistry.md](./SubsystemSlotRegistry.md)
- [SubsystemSlotIndex.md](./SubsystemSlotIndex.md)

当前已登记且内存路径**必须**使用的短名：`Memory`（与插座对象名 `MemorySlot` 对应）。

#### 4.1.2 单 Active 规则

- 每个 Slot **必须**保证：同一时刻至多一个 Active Provider。
- 再次 `Bind` **必须**替换 Active Provider（见 §4.3）；**禁止**静默保留旧 Provider 却声称已绑定新 Provider。

### 4.2 Provider（插头）必选形态

凡声称可作为某 Slot 的 ZVHP1 Provider 的对象，**必须**包含下列规范属性（名称逐字固定）：

| 规范属性名 | 类型要求 | 约束 |
|------------|----------|------|
| `ProviderId` | 字符串 | 长度 L 满足 **1 ≤ L ≤ 64**；每一位**必须**为可打印 ASCII（`U+0021`–`U+007E`）；**禁止**空串 |
| `ProviderVendor` | 字符串 | 长度 L 满足 **1 ≤ L ≤ 32**；每一位**必须**为可打印 ASCII；**禁止**空串 |
| `ActiveProtocol` | 字符串 | **必须**为该子系统领域协议标识（内存 Provider **必须**为 `ZMP1`）；大小写敏感 |

#### 4.2.1 Memory Provider 额外必选字段

凡绑定到 `MemorySlot` 的 Provider，**额外必须**提供：

| 规范属性名 | 约束 |
|------------|------|
| `MachineMemory` | **必须**符合 ZMP1 §4.14 与 §4.22：含字段 `MemoryInit`，且 `MemoryInit` **必须**提供无参、无返回值的 `Test` 与 `Initialize` |

**禁止**以 `memory` / `InitFacade` 等非规范名替代 `MachineMemory`。  
**禁止**要求主机导入 Provider 私有类名才能完成引导。

### 4.3 绑定 API（必选方法名）

`MemorySlot`（以及日后同构 Slot）**必须**提供下列方法（名称逐字固定）：

| 规范方法名 | 参数 | 返回值 | 语义 |
|------------|------|--------|------|
| `Bind` | 恰好 1 个参数：待激活的 Provider 对象 | 无（`void`） | 将该 Provider 设为本 Slot 的 Active Provider；若已有 Active，**必须**替换为新 Provider |
| `GetActive` | 无 | Provider 对象，或表示「未绑定」的空值（宿主语言 `null` / `undefined` 等价空） | 返回当前 Active Provider；未绑定**必须**返回空，**禁止**抛错冒充未绑定 |

附加约束：

- **禁止**以 `bind` / `SetProvider` / `Get` / `Current` 等非规范名替代后仍声称兼容 ZVHP1。
- `Bind` 的参数**必须**满足 §4.2（及 Memory 时的 §4.2.1）；主机**可以**在 `Bind` 时校验并拒绝非法 Provider；若拒绝，**必须**使 Active 保持不变或变为空（实现自选其一，但**禁止**留下半绑定状态却声称绑定成功）。
- 在已调用领域 `Initialize` 且 `MachineMemory.MemoryController` 已非空之后再次 `Bind` 不同 Provider 的行为：**本协议不规定**（见 §2.2）；主机**应**在文档中说明其策略，但不得把某一策略宣称为 ZVHP1 唯一合法策略。

### 4.4 访问角色

| 角色 | 约束 |
|------|------|
| 坐座主机 | **可以**调用 `Bind`；**必须**在调用领域 `Initialize` 之前确保 MemorySlot 已有 Active Provider。`MachineMemory.MemoryController` 仍为空时，**必须**先调用 ZMP1 的 `Test`，仅在裁定为通过后再调用 `Initialize`。参考实现的坐座主机是主板 |
| Kernel | **禁止**把 `Bind` 当作内核路径。ZMP1 不把 `MemoryController` 交给 Kernel |
| 其它子系统 / 用户态 | **禁止**擅自 `Bind` 替换 Active Provider，除非主机另有明确的特权通道（该通道**不是** ZVHP1 符合性条件） |

### 4.5 引导与替换关系（规范性链路）

符合 ZVHP1 且启用内存可插拔的主机**必须**支持：

1. 经 `MemorySlot.Bind(provider)` 选定 Memory Provider（若启动时已绑定可跳过）；
2. 经 `MemorySlot.GetActive()` 取得 Active Provider（或经主机转发的、等价于 Active 的 `MachineMemory` 门面）；
3. `MachineMemory.MemoryController` 仍为空时，调用 ZMP1 规定的 `MachineMemory.MemoryInit.Test()`，并完成全部已登记用例；
4. 该次裁定为通过之后，调用 `MachineMemory.MemoryInit.Initialize()`；
5. 初始化完成后，领域总控出现在 `MachineMemory.MemoryController`（ZMP1 §4.14）。

**快速替换社区实现**的符合性含义（主机侧）：

- **应（SHOULD）** 提供固定目录约定（见 §4.7），使替换者**只需替换该目录、不必修改坐座主机源码**；
- 更换的 Provider **必须**满足 §4.2 / §4.2.1 与 ZMP1；
- **禁止**要求修改坐座主机中的协议字段名，或 `Test` / `Initialize` 方法名。

### 4.6 元数据只读性

`ProviderId`、`ProviderVendor`、`ActiveProtocol` 在 Provider 对象上**必须**可被主机读取。  
本修订**不要求**其为运行期可写字段；实现**可以**使用只读属性。

### 4.7 主机 ActiveProvider 目录约定（强烈建议 · 参考实现采用）

为达到「**只换文件夹、不改引导源码**」，声称支持可插拔内存的主机**应**遵守：

| 约定项 | 要求 |
|--------|------|
| 目录路径 | 相对产品源码根：`Hardware/Memory/ActiveProvider/`（PascalCase） |
| 入口模块文件名 | **必须**为 `Provider.ts`（若主机使用 TypeScript；其它语言应提供等价固定入口名并在清单中写明） |
| 规范导出名 | **必须**导出 `ActiveMemoryProvider`（位于主机约定命名空间下，参考实现为 `ZerOS.Hardware.Memory.ActiveMemoryProvider`） |
| 清单文件 | **应**提供 `ProviderManifest.json`，且含字段 `Schema` = `ZVHP1-ActiveProvider-Manifest`、`EntryModule`、`ExportName` |
| 坐座行为 | **必须**仅从上述固定入口导入并 `Bind(ActiveMemoryProvider)`；**禁止**在坐座源码中写死某一社区厂商模块路径。参考实现的坐座源码是主板，不是 Boot |
| 替换操作 | 用社区实现**整体替换** `ActiveProvider/` 目录内容（保持入口文件名与导出名），然后重新构建/加载 |

本条为**主机交付约定**（使替换零改 Boot）；Provider 本身的符合性仍以 §4.2 与 ZMP1 为准。

---

## 5. 不符合示例（非穷尽）

1. 协议标识使用 `zvhp1` 或 `ZVHP-1`；
2. 使用 `Get` / `CurrentProvider` 替代 `GetActive`；
3. Memory Provider 缺少 `MachineMemory`、`Test` 或 `Initialize`；
4. `ActiveProtocol` 对内存 Provider 填 `ZVHP1` 而非 `ZMP1`；
5. `ProviderId` 为空或含空格 / 非可打印 ASCII；
6. 同时保持两个 Active Memory Provider；
7. 声称「换实现必须改坐座主机去 import 厂商类名」且仍称兼容 ZVHP1；
8. 仅实现 ZMP1 配置面、未提供 `MemorySlot.Bind` / `GetActive`，却声称兼容 ZVHP1 可插拔；
9. 主机宣称「文件夹即可替换」，但坐座源码仍硬编码某一非 `ActiveProvider` 路径。

---

## 6. 修订记录

| 版本 | 说明 |
|------|------|
| ZVHP1 | 首版：Slot / Provider / Bind·GetActive；§4.7 ActiveProvider 目录约定（文件夹替换） |
| ZVHP1（修订） | 内存引导在发布总控之前必须先调用 ZMP1 的 `Test` |
| ZVHP1（修订） | 坐座主机调用 `Bind` / `Test` / `Initialize`。发布后的总控在 `MachineMemory.MemoryController`。参考实现的坐座主机是主板 |
| ZVHP1（修订） | `Cpu` 槽启用。领域协议为 `ZCP1`。固定入口 `Hardware/Cpu/ActiveProvider/Provider.ts`，导出名 `ActiveCpuProvider` |
| ZVHP1（修订） | `Gpu` 槽启用。领域协议为 `ZGP1`。固定入口 `Hardware/Gpu/ActiveProvider/Provider.ts`，导出名 `ActiveGpuProvider` |
