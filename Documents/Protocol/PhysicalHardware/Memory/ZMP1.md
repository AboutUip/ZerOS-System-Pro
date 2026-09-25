# ZMP1 — ZerOS Memory Protocol · 第 1 版

> 文档路径：`Documents/Protocol/PhysicalHardware/Memory/ZMP1.md`  
> 规范状态：**规范性（Normative）**  
> 协议标识字符串（唯一）：`ZMP1`  
> 参考实现（非规范）：`ZerOS-PRO/Hardware/Memory/Config/MemoryConfig.ts`

---

## 0. 文档定位与符合性

### 0.1 目的

本文是 **ZerOS Memory Protocol 第 1 版（ZMP1）** 的完整对外契约。

- ZerOS-PRO **仅保证**对「符合本文全部规范性要求」的内存实现提供支持。
- 第三方开发者**不得以查阅 ZerOS-PRO 源码为前提**理解本协议；**仅依据本文**即可判定自身实现是否兼容 ZMP1。
- 若某实现**声称**完全兼容 ZMP1，却因偏离本文而导致无法在 ZerOS-PRO 下按约定运行，则在协议层面视为该实现**不符合 ZMP1**，而非 ZerOS-PRO「未写明约定」。

### 0.2 规范性用语

本文中：

| 用语 | 含义 |
|------|------|
| **必须（MUST）** | 绝对要求；违反即不符合 ZMP1 |
| **禁止（MUST NOT）** | 绝对禁止；违反即不符合 ZMP1 |
| **应（SHOULD）** | 强烈建议；不满足不自动构成不符合，但可能影响互操作质量 |
| **可以（MAY）** | 真正可选 |

未使用上述用语的叙述，若出现在「规范正文」中且表述为定义、判定或约束，仍按**必须**理解。

### 0.3 符合性声明

仅当实现同时满足以下全部条件时，方可声称「完全兼容 ZMP1」或同等含义表述：

1. 提供本文规定的**全部必选字段与协议固定常量**；
2. 所有字段名、协议标识字符串、固定常量取值与本文**逐字一致**（大小写敏感）；
3. 所有字段满足本文对其**类型、值域、长度、字符集与语义判定**的要求；
4. 凡对外报告内存子系统异常，均使用符合 §4.11 的 `MemoryException` 四属性形态；
5. 凡提供内存单元，均维护符合 §4.12 的 `InitState`（操作前 `0x0`；主路径见登记表；**仅 `0x4` 正式可用**）；
6. 凡提供内存单元与内存总控，均维护符合 §4.13 的 `Events` 与 `Signals`（字段、标号与追加规则见登记表）；内存单元另维护 `Exceptions`；
7. 提供符合 §4.14 的引导暴露字段：`MachineMemory`、`MachineMemory.MemoryInit`，以及`MachineMemory` 上的 `MemoryController` 字段名；
8. 凡提供内存单元，均维护符合 §4.15 的存储体：配置面 `BitsPerByte = 8`；单元字段 `Cells` 与 `CellCount`；位序、成功初值与失败时空存储体满足该节；
9. 凡完成内存初始化并进入颗粒 `0x4`，均已按 §4.16 与 §4.20 完成浅切：`Blocks` 长度等于 `ShallowDimension`，每块 `BlockIndex` 升序唯一，`NestingDepth = 1`，`Children` 为空，`BitLength` 满足 §4.20，且深度不超过 `DeepDimension`；
10. 凡提供内存单元，均提供 §4.17 的 `ReadBit` 与 `WriteBit`，以及 §4.18 的 `ReadOctet` 与 `WriteOctet`：仅 `InitState === 0x4` 时成功；失败时不改存储体，并向该单元 `Exceptions` 追加规定标号；
11. 凡提供内存单元，均维护 §4.19 的 `UnitOrdinal`（`0 .. UnitCount-1` 各一次）；凡提供内存总控，均提供 §4.19 的跨颗粒 `ReadBit` / `WriteBit` / `ReadOctet` / `WriteOctet`；
12. 凡提供内存块，均提供 §4.20 的块内 `ReadBit` / `WriteBit`，以及 §4.21 的 `Children` 与 `Deepen`；
13. 不依赖本文「明确不规定」的内容作为与 ZerOS-PRO 互操作的前提；
14. 提供 §4.22 的 `Test`：无参数，一次执行 [TestCaseRegistry.md](./TestCaseRegistry.md) 中的全部用例，失败不跳过后续用例，且不发布 `MemoryController`，也不改写 `TotalSizeBytes` 与 `MemoryId`；`MachineMemory.MemoryController` 仍为空时，仅当 `TestVerdict` 为 `0x1`、八位组之和 ≥ 1、且已抽出已启用 `MemoryId` 时，才允许 `Initialize` 发布总控；否则分别追加 `0x0011`、`0x0012` 或 `0x0003`；
15. `TotalSizeBytes` 按 §4.6 等于各颗 `Cells.length` 之和；
16. 已启用的 `MemoryId` 按 §4.7.3 抽取；
17. 提供 §4.23 的线性位元端口，§4.24 的小端整数端口，§4.25 的块内八位组与块内整数，§4.26 的 `Owner` / `Claim` / `Release`，以及 §4.27 的 `SetHertz` 与 `Metric`；
18. 对外报告的 `ExceptionChain` 符合 §4.11.5 的 `Cause` 形态。

**禁止**在未满足以上条件时声称兼容 ZMP1。

### 0.4 字段名与标识的规范性

为避免「口头兼容、机器无法对接」：

- 本文给出的**字段名**（如 `MemoryIdByteLength`、`ShallowDimension`）为**规范名**，**必须**按此精确使用（Unicode 拼写与大小写均不可更改）。
- **禁止**以「语义等价但标识符不同」的命名替代规范名后仍声称兼容 ZMP1。
- 协议修订标识的对外机器可读值**必须**精确为字符串 `ZMP1`（四个字符：`Z` `M` `P` `1`），**禁止**使用 `zmp1`、`ZMP-1`、`ZMP 1` 等变体冒充。

### 0.5 本文与参考实现的关系

- `ZerOS-PRO/Hardware/Memory/` 是官方虚拟内存实现，**不是**规范正文。其中 `Docs/` 是这一份实现的 API 文档，**不是**本协议的另一份副本。
- 协议只有 ZMP1 这一份。虚拟内存实现可以有很多份。其它实现**不必**提供官方辅助函数名、标定值或 `Docs/` 目录。本文写死的方法名**必须**在规定的挂载处逐字提供：`MemoryInit` 上的 `Test`、`Initialize`；内存单元上的 `ReadBit`、`WriteBit`、`ReadOctet`、`WriteOctet`、`ReadInteger`、`WriteInteger`；内存总控上同名的六个方法（首参数为 `UnitOrdinal`），以及 `ReadLinearBit`、`WriteLinearBit`、`ReadLinearInteger`、`WriteLinearInteger`、`Claim`、`Release`；内存块上的 `ReadBit`、`WriteBit`、`ReadOctet`、`WriteOctet`、`ReadInteger`、`WriteInteger`、`Deepen`。
- 官方实现中的具体标定数值（如某一版的 `UnitCount`）**不构成**对第三方的强制取值，除非本文明文写死。
- 若官方实现或它的 API 文档与本文冲突，**以本文为准**。符合性只依据本文及登记表 / 索引裁决。

---

## 1. 概述

ZMP1 规定虚拟内存硬件在**配置契约**、**异常契约**、**内存单元状态契约**与**颗粒存储体契约**上必须遵守的约定，包括：

- 浅维度、深维度；
- 内存颗粒数量、单个内存颗粒大小（字节）；
- **总内存大小（字节）**；
- 内存 ID、内存标识（厂商）；
- 协议固定常量及其不可变取值；
- **内存异常对象**（`MemoryException`）的形态、四属性与类别档位；
- **内存单元初始化状态字段**（`InitState`）及其六档取值；
- **颗粒存储体**（位元、八位组、`Cells`、`CellCount`）；
- **浅切内存块**（块数、`BlockIndex`、初始 `NestingDepth`、`BitLength`）；
- **颗粒端口**（位元 `ReadBit` / `WriteBit`，八位组 `ReadOctet` / `WriteOctet`）；
- **颗粒序号与跨颗粒端口**（`UnitOrdinal`，总控上的同名读写）；
- **块内位元端口与加深**（`Deepen`、`Children`）；
- **侧信道**（`Events` / `Signals` / `Exceptions` 的字段、标号与追加规则）；
- **线性位元地址、小端整数、块内八位组、浅切根所有权、内存频率**；
- **引导与对外暴露字段**（`MachineMemory` / `MemoryInit` / `MachineMemory` 上的 `MemoryController`）；
- **初始化前测试**（`Test`、`TestVerdict`、`TestReport`），以及发布时写入的总容量与内存 ID；
- 可插拔替换见独立协议 **ZVHP1**（[PluggableVirtualHardware/ZVHP1.md](../PluggableVirtualHardware/ZVHP1.md)）：`MemorySlot.Bind` / `GetActive`。

颗粒存储体见 §4.15。浅切见 §4.16。位元端口见 §4.17。八位组端口见 §4.18。序号与跨颗粒端口见 §4.19。块的位元跨度见 §4.20。加深见 §4.21。初始化前测试见 §4.22。线性位元地址见 §4.23。小端整数见 §4.24。块内八位组见 §4.25。浅切根所有权见 §4.26。内存频率见 §4.27。下列事项不在本文范围：`InitState` 由谁写入、颗粒索引 ID 的随机算法（它不是 `MemoryId`）、除 §4.17–§4.26 与 §4.22 已规定的失败记录以外异常如何处理或抛出到宿主、哪个主机角色调用 `MemoryInit` 以及宿主语言模块语法、操作系统页表与进程地址空间。实现一旦对外暴露「ZMP1 配置面」、报告「ZMP1 内存异常」或提供「ZMP1 内存单元」，**必须**满足本文对应契约。可插拔绑定语义以 ZVHP1 为准。

---

## 2. 契约范围

### 2.1 本协议规定（规范性）

- 必选字段集合、规范字段名、协议固定常量及其取值；
- 各字段的类型、值域、长度计量方式与字符集；
- 浅维度与深维度的语义定义（不含二者与颗粒数量之间的算术公式）；
- 总内存大小（字节）：默认 0；发布时等于各颗 `Cells.length` 之和（§4.6）；
- 内存 ID 的启用 / 禁用判定，以及已启用时的抽取算法（§4.7）；
- 内存异常对象 `MemoryException` 的四属性形态、类别五档、标号空间与概述长度约束；
- 内存单元 `InitState` 六档取值、主路径生命周期与「仅 `0x4` 正式可用」；
- 内存颗粒存储体：`BitsPerByte`、`Cells`、`CellCount`、位元二值、八位组位序与实例化初值（§4.15）；
- 浅切内存块：块数等于 `ShallowDimension`，`Blocks` / `BlockIndex` / `NestingDepth` 的初值与上限（§4.16）；
- 内存单元上的位元端口：`ReadBit`、`WriteBit`（§4.17）；
- 内存单元上的八位组端口：`ReadOctet`、`WriteOctet`（§4.18）；
- 颗粒序号 `UnitOrdinal`，以及内存总控上的跨颗粒端口（§4.19）；
- 内存块的位元跨度、`BitLength`，以及块上的 `ReadBit` / `WriteBit`（§4.20）；
- 内存块的 `Children` 与 `Deepen`（§4.21）；
- 内存单元与内存总控的 `Events`、`Signals`，以及单元的 `Exceptions`（§4.13）；
- 线性位元地址（§4.23）、小端整数（§4.24）、块内八位组（§4.25）、浅切根所有权（§4.26）；
- 内存频率：一次成功访问按字宽推进时间，`SetHertz` 与 `Metric`（§4.27）；
- 引导与对外暴露规范字段名：`MachineMemory`、`MemoryInit`、`MachineMemory` 上的 `MemoryController`（§4.14）；
- 初始化前测试：`MemoryInit.Test`、裁定、报告，以及未通过时禁止发布总控（§4.22）；
- 符合性判定规则。

### 2.2 本协议明确不规定（非规范性缺口，禁止当作隐含约定）

下列事项**不在** ZMP1 内；符合本协议的实现**禁止**把下列事项宣称为「ZMP1 已规定」：

- `InitState` 字段由谁写入（单元自身或总控均可）；以及超出 [InitStateRegistry.md](./InitStateRegistry.md) §3 已规定主路径之外的其它可选跳转边（主路径阶段取值与「仅 `0x4` 正式可用」**已在** §4.12 / 登记表规定，**禁止**宣称为未规定）；
- 颗粒索引 ID（关联表键）的随机算法；它**不是** `MemoryId`，**禁止**把该算法宣称为 §4.7.3；
- 除本文已登记标号外，其余 `ExceptionCode`、`EventCode`、`SignalCode` 的业务含义（后续修订追加）；
- **除 §4.17–§4.26 与 §4.22 以外，异常如何被处理**：含是否 `throw`、是否恢复/降级、检查与 try 的顺序、终止策略等（一旦以 ZMP1 异常对象对外报告，该对象**必须**符合 §4.11；上述各节对失败记录另有要求）；
- 异常如何映射到宿主语言的 `throw` / Promise rejection / 日志通道；
- `MemoryInit` 上除 `Test` 与 `Initialize` 以外的方法（二者见 §4.14.3 与 §4.22；总控与块上已规定的方法见 §4.19–§4.26，**禁止**宣称为未规定）；
- 哪个主机角色调用 `MemoryInit`，以及该角色如何发现与加载实现的宿主语言模块语法（先 `Test`、再 `Initialize` 的顺序仍属 §4.14 与 §4.22）；
- 操作系统页表、进程虚拟地址空间、调度与权限模型。

上述缺口若需标准化，必须通过后续协议修订（如 ZMP2+ 或其它独立协议）明文规定。

---

## 3. 术语

| 术语 | 定义 |
|------|------|
| 配置面 | 实现对外提供的、可被主机侧读取的静态配置集合；声称兼容 ZMP1 时，其必选成员必须齐全且满足本文 |
| 协议固定常量 | 配置面必须提供、取值由本文写死、禁止改写的常量 |
| 可标定字段 | 配置面必须提供，取值在本文值域内可由实现自行选定的字段 |
| 正整数 | 有限整数，且 **≥ 1**（不含 0、不含负数、不含非整数值、不含 NaN / Infinity） |
| 非负整数 | 有限整数，且 **≥ 0**（不含负数、不含非整数值、不含 NaN / Infinity；**允许 0**） |
| Uint32 | 无符号 32 位整数：有限整数，且 **0 ≤ n ≤ 4294967295**（即 `2^32 − 1`）。**禁止**用 NaN、Infinity、非整数或该区间外的值冒充。宿主浮点数不是 Uint32；只有已落入本区间的整数才是 |
| 位元 | 颗粒存储体的最小观测单位。规范取值**仅**整数 `0` 或 `1`。**禁止**把 `2`–`255` 或整个八位组称作一个位元的取值 |
| 八位组 | 连续 `BitsPerByte`（8）个位元的紧凑载体。规范取值是整数 `0`–`255`。八位组不是位元 |
| `Cells` | 内存单元上的八位组序列。成功实例化时，长度（八位组个数）等于 `UnitSizeBytes` |
| `CellCount` | 内存单元上的位元个数。成功实例化时等于精确乘积 `UnitSizeBytes × BitsPerByte`，且必须为 Uint32 |
| `CellIndex` | 颗粒内位元下标，类型 Uint32。当且仅当 `0 ≤ CellIndex < CellCount` 时，该下标指向本颗粒内的一个位元 |
| ASCII 字符 | Unicode 码点落在 `U+0000`–`U+007F` 的字符 |
| 可打印 ASCII | 码点落在 `U+0021`–`U+007E` 的字符（不含空格） |
| 数字字符 `0` | 码点精确为 `U+0030` 的字符（不是 NUL `U+0000`，也不是其它看起来像零的字符） |
| 内存块 | 浅切所得的一块，或 `Deepen` 所得的子块。浅切块数等于 `ShallowDimension`。浅切完成时 `NestingDepth` 为 `1` 且 `Children` 为空。位元跨度见 §4.20 |
| `BlockIndex` | 内存块在浅切序列中的下标，类型 Uint32。浅切序列必须恰好包含 `0 .. ShallowDimension-1` 各一次，并按升序排列 |
| `NestingDepth` | 内存块的嵌套深度，类型 Uint32。浅切根必须为 `1`。子块为父深度加 `1`。任何块都必须满足 `1 ≤ NestingDepth ≤ DeepDimension` |
| `Blocks` | 内存总控上的浅切根序列。长度必须等于 `ShallowDimension`。子块不进入本序列，只进入父块的 `Children` |
| 内存颗粒 | 配置面所计数的最小同构容量单元。存储体见 §4.15。位元端口见 §4.17，八位组端口见 §4.18，序号见 §4.19。浅切根所有权见 §4.26 |
| 内存异常对象 | 规范类型名 `MemoryException`；报告内存子系统异常时必须使用的对象形态；**必须**含四属性 `ExceptionCode`、`ExceptionCategory`、`ExceptionSummary`、`ExceptionChain`（见 §4.11.1） |
| 异常标号 | `ExceptionCode`；十六进制记法下的异常编号，空间自 `0x0000` 起 |
| 异常类别 | `ExceptionCategory`；十六进制记法下的严重度档位，仅 `0x00`–`0x04` 五档 |
| 异常概述 | `ExceptionSummary`；人类可读摘要字符串，长度必须小于 256 |
| 异常链 | `ExceptionChain`；必须为非 null 的 object；存储形态必须含键 `Cause`（见 §4.11.5） |
| 内存单元初始化状态 | `InitState`；内存单元必须维护；未操作前 `0x0`；六档 `0x0`–`0x5`；**仅 `0x4` 正式可用** |
| 事件数组 | `Events`；内存单元与内存总控都必须维护；元素为 `EventCode`、`Subject`、`Detail`（见 §4.13） |
| 信号数组 | `Signals`；内存单元与内存总控都必须维护；元素为 `SignalCode`、`Level`、`Subject`（见 §4.13） |
| 线性位元地址 | `LinearBitIndex`；Uint64。等于更小序号颗粒的 `CellCount` 之和，再加上目标 `CellIndex`（见 §4.23） |
| 小端 | 下标最小的八位组是最低有效字节。整数宽度只允许 `2`、`4`、`8`（见 §4.24） |
| `Owner` | 浅切根上的主人标记，Uint32 或 `null`。不是端口锁（见 §4.26） |
| 异常数组 | `Exceptions`；内存单元必须维护；元素必须为 `MemoryException` |
| 内存引导门面 | 规范名 `MachineMemory`；内存初始化入口的挂载面 |
| 内存初始化入口 | 规范名 `MemoryInit`；必须挂在 `MachineMemory` 上。调用角色不在本协议内 |
| 内存总控对外实例字段 | 规范名 `MemoryController`；必须挂在 `MachineMemory` 上。发布前为空，成功发布后为总控自身 |

---

## 4. 规范正文

### 4.0 协议固定常量（必选 · 取值不可变）

配置面**必须**提供下列常量，名称与取值**必须**如下，**禁止**缺失或改值：

| 规范字段名 | 类型要求 | 固定取值 | 附加约束 |
|------------|----------|----------|----------|
| `MemoryIdByteLength` | 正整数 | `256` | 必须恒为 256 |
| `MemoryVendorMaxLength` | 正整数 | `16` | 必须恒为 16 |
| `BitsPerByte` | 正整数 | `8` | 必须恒为 8。表示一个字节所含位元数。**禁止**改为其它宽度后仍标识为 `ZMP1` |

任一违反，即**不符合 ZMP1**。

若需改变上述固定取值，**必须**发布新的协议修订（ZMP2+），**禁止**在仍标识为 `ZMP1` 时改写。

### 4.1 协议修订标识（必选）

| 规范字段名 | 类型要求 | 取值约束 |
|------------|----------|----------|
| `ActiveProtocol` | 字符串 | **必须**精确等于 `ZMP1` |

### 4.2 浅维度（必选 · 可标定）

| 规范字段名 | 类型要求 | 值域 |
|------------|----------|------|
| `ShallowDimension` | Uint32 且 ≥ 1 | **1 ≤ n ≤ 4294967295** |

**语义（规范性）：** `ShallowDimension` 是浅切尺度，并且**就是**浅切所得的内存块个数。块数**必须**等于 `ShallowDimension`。

**禁止**把块数规定成 `UnitCount`、`ShallowDimension × DeepDimension` 或其它公式后仍声称符合 ZMP1。块个数与 `UnitCount` **没有**强制数量关系。

某一块覆盖哪些位元见 §4.20。

### 4.3 深维度（必选 · 可标定）

| 规范字段名 | 类型要求 | 值域 |
|------------|----------|------|
| `DeepDimension` | Uint32 且 ≥ 1 | **1 ≤ n ≤ 4294967295** |

**语义（规范性）：** `DeepDimension` 是**单个内存块**的嵌套深度上限。

浅切完成时，每一块的 `NestingDepth` **必须**为 `1`，并且**必须**满足 `1 ≤ NestingDepth ≤ DeepDimension`。因此 `DeepDimension` 小于 `1` 时浅切不能完成。

把嵌套加深到大于 `1` 的操作见 §4.21。

### 4.4 内存颗粒数量（必选 · 可标定）

| 规范字段名 | 类型要求 | 值域 |
|------------|----------|------|
| `UnitCount` | 正整数 | **1 ≤ n ≤ 4294967296** |

**语义（规范性）：** 表示配置面上的内存颗粒个数。

上界 `4294967296`（即 `2^32`）是为了让最后一颗的 `UnitOrdinal = UnitCount − 1` 仍是 Uint32。`4294967297` 与 `0`、负数、非整数一样，都是非法颗粒数量（标号 `IllegalUnitCount`）。

### 4.5 单个内存颗粒大小（必选 · 可标定 · 单位固定）

| 规范字段名 | 类型要求 | 值域 | 单位 |
|------------|----------|------|------|
| `UnitSizeBytes` | Uint32 中的正整数 | **1 ≤ n ≤ 536870911** | **必须**为字节（byte，正好 `BitsPerByte` 个位元）；**禁止**改用 bit、字、页等其它单位表达同一字段 |

**语义（规范性）：** 每一颗内存颗粒的容量，单位是字节；在配置面上，全体颗粒**必须**视为同构（同一 `UnitSizeBytes`）。

- 一个字节**必须**正好等于 `BitsPerByte`（8）个位元。**禁止**把 `UnitSizeBytes` 改成按位、按字或按页计数后仍使用该字段名。
- `536870911 = floor((2^32 − 1) / 8)`。该上界使精确乘积 `UnitSizeBytes × BitsPerByte` **必须**仍落入 Uint32（见 §3、§4.15）。
- `UnitSizeBytes = 0`、负数、非整数，或大于 `536870911`，均为非法颗粒大小（标号 `IllegalUnitSizeBytes`）。

### 4.6 总内存大小（必选 · 单位固定 · 默认 0 · 由初始化确定）

| 规范字段名 | 类型要求 | 值域 | 单位 |
|------------|----------|------|------|
| `TotalSizeBytes` | 非负整数 | ≥ 0 | **必须**为字节（byte，8 bit）；**禁止**改用其它单位表达同一字段 |

**语义（规范性）：**

- `TotalSizeBytes` 表示整机**已经存在**的八位组个数。
- **配置面默认值必须为 `0`**。`Test` **禁止**改写它。尚未发布总控时它必须保持 `0`。
- 发布总控时，`TotalSizeBytes` **必须**等于各颗 `Cells.length` 之和。失败颗粒的长度为 `0`，加进去仍是 `0`。相加顺序不影响结果。
- **禁止**把 `UnitCount × UnitSizeBytes` 写成必须成立的等式。某一颗失败时，和小于该乘积，这仍然符合本条。
- 和小于 `1` 时**禁止**发布总控，也**禁止**把 `TotalSizeBytes` 写成该和。标号见 §4.22.3 的 `0x0012`。
- 和可以超过 `2^53`。它仍是非负整数。在本文的颗粒大小上界与颗粒数上界之下，该和不超过 `18446744073709551615`。

**判定摘要：**

| `TotalSizeBytes` | 含义 |
|------------------|------|
| `0` | 未由初始化确定（默认 / 未就绪） |
| ≥ 1 | 已确定的总容量（字节） |

### 4.7 内存 ID（必选）

| 规范字段名 | 类型要求 | 长度 | 字符集 |
|------------|----------|------|--------|
| `MemoryId` | 字符串 | **必须**精确等于 `MemoryIdByteLength`（即 256） | 每一位**必须**为可打印 ASCII（`U+0021`–`U+007E`） |

#### 4.7.1 长度计量（消除歧义）

因每位均为 ASCII 字符，下列计量**必须**同时成立且彼此相等：

- 字符串长度为 256（按 Unicode 码点计数为 256；因均在 BMP 基本ASCII，亦等于 256 个 UTF-16 code unit）；
- 以 UTF-8 编码时的字节数为 256。

本文所称「256 字节的内存 ID」，在 ZMP1 下**即指**满足上款的 256 位 ASCII 字符串，**禁止**使用需要代理对的非 BMP 字符充数。

#### 4.7.2 启用 / 禁用判定（不另设布尔字段）

设 `ZeroId` 为：长度为 256、每一位均为数字字符 `0`（`U+0030`）的字符串。

- 当且仅当 `MemoryId` **逐位等于** `ZeroId` 时，判定为**禁用 / 未初始化**。
- 当 `MemoryId` 长度为 256、字符集合法，且**至少有一位不是** `U+0030` 时，判定为**已启用**。
- **禁止**使用单独的布尔「启用标志」字段替代上述判定后仍声称兼容 ZMP1（主机侧只认本判定）。
- **禁止**用 NUL（`U+0000`）全填充或其它字符冒充「全零禁用」语义。

#### 4.7.3 初始化与随机串

- 尚未发布总控时，`MemoryId` **必须**等于 `ZeroId`。`Test` **禁止**改写它。
- 发布总控时，`MemoryId` **必须**为已启用状态，并按下列算法抽出：
  1. 字符表是 `U+0021` 至 `U+007E` 的 94 个字符，含 `U+0030`，按码点升序排列；
  2. 熵源必须是 `crypto.getRandomValues`，一次取一个字节；
  3. 令 `L = floor(256 / 94) × 94`。样本字节 ≥ `L` 时丢弃；否则取字符表中下标为「样本模 94」的字符；
  4. 凑满 256 个字符。若该串等于 `ZeroId`，整串丢弃并重抽。
- 宿主没有 `crypto.getRandomValues` 时，**禁止**发布总控，**禁止**改写 `TotalSizeBytes` 与 `MemoryId`，并**必须**向 `MemoryInit.Exceptions` 追加 `0x0003`，类别为 `0x04`。
- 总控已经发布之后再次 `Initialize`，**禁止**重新抽取 `MemoryId`，也**禁止**改写已经写下的 `TotalSizeBytes`。
- 若实现提供可选视图 `Identity`，其中的 `MemoryId` **必须**与配置面 `MemoryId` 相同。

### 4.8 内存标识 / 厂商（必选 · 内容可自定）

| 规范字段名 | 类型要求 | 长度 | 字符集 |
|------------|----------|------|--------|
| `MemoryVendor` | 字符串 | 长度 L 满足 **1 ≤ L ≤ `MemoryVendorMaxLength`**（即 1–16） | 每一位**必须**为可打印 ASCII（`U+0021`–`U+007E`） |

- **禁止**空字符串。
- **禁止**空格（`U+0020`）及可打印 ASCII 以外的字符。
- 厂商具体文案由实现自定；参考实现使用 `ZerOS-Team-M1`，该具体字符串**不是**对其它实现的强制内容。

### 4.9 配置面必选成员总表（机器核对清单）

声称兼容 ZMP1 的配置面**必须**同时包含下表全部成员，不多不少地满足各列约束（汇聚用视图字段见 4.10）：

| 规范字段名 | 类别 | 约束摘要 |
|------------|------|----------|
| `ActiveProtocol` | 标识 | 精确字符串 `ZMP1` |
| `MemoryIdByteLength` | 协议固定常量 | 正整数，值 = 256 |
| `MemoryVendorMaxLength` | 协议固定常量 | 正整数，值 = 16 |
| `BitsPerByte` | 协议固定常量 | 正整数，值 = 8 |
| `ShallowDimension` | 可标定 | Uint32，1 ≤ n ≤ 4294967295；块数必须等于该值 |
| `DeepDimension` | 可标定 | Uint32，1 ≤ n ≤ 4294967295；浅切根的 `NestingDepth` 为 1，任何块的深度都不得超过该值 |
| `UnitCount` | 可标定 | 整数，1 ≤ n ≤ 4294967296 |
| `UnitSizeBytes` | 可标定 | 整数，1 ≤ n ≤ 536870911，单位 = byte |
| `TotalSizeBytes` | 规模 | 非负整数 ≥ 0，单位 = byte；默认 0；发布时等于各颗 `Cells.length` 之和，且必须 ≥ 1 |
| `MemoryId` | 身份 | 长度 256，可打印 ASCII；全 `U+0030` = 禁用；发布时按 §4.7.3 抽出 |
| `MemoryVendor` | 身份 | 长度 1–16，可打印 ASCII |

### 4.10 可选汇聚视图（非必选）

下列名称若出现在参考实现中，仅为便利分组，**不是** ZMP1 符合性的必选条件：

- `Dimensions`、`Units`、`Identity`

实现**可以**提供、**可以**不提供；不得因缺少它们而单独判定不符合 ZMP1。若提供，其内嵌字段仍**必须**与必选字段语义一致，且**禁止**与必选字段取值冲突。

### 4.11 内存异常对象（必选形态 · 报告内存异常时）

凡符合本协议的实现，在对外报告**内存子系统异常**时，**必须**使用规范对象 `MemoryException`，且**必须**包含下列四个规范属性（名称逐字固定、大小写敏感）。**禁止**以普通字符串、无结构 Error、或缺属性对象冒充 ZMP1 内存异常。

#### 4.11.1 对象与属性总表

| 规范属性名 | 类型要求 | 值域 / 约束 |
|------------|----------|-------------|
| `ExceptionCode` | 非负整数 | **必须**落在 `0x0000`–`0xFFFF`（含端点）；对外记法为十六进制；标号含义见 4.11.3 |
| `ExceptionCategory` | 非负整数 | **必须**精确为五档之一：`0x00` / `0x01` / `0x02` / `0x03` / `0x04`（见 4.11.2） |
| `ExceptionSummary` | 字符串 | 码点长度 L 满足 0 ≤ L 且 L 严格小于 256 |
| `ExceptionChain` | object | **必须**为非 `null` 的 object；存储形态见 §4.11.5；**禁止** `null` / 数组 / 原始类型 |

**禁止**增删改上述四属性的规范名；**可以**在对象上附加其它实现私有属性，但主机侧互操作**只保证**识别上述四属性。

#### 4.11.2 异常类别（仅五档 · 自 `0x00` 递增至强制终止）

`ExceptionCategory` **必须**取下表之一；**禁止**其它取值。档位按严重度自低到高排列：

| 取值 | 规范档名 | 语义 |
|------|----------|------|
| `0x00` | `Ignorable` | 可忽略异常：可记录后继续，不要求中断当前内存操作语义 |
| `0x01` | `Advisory` | 提示异常：应提示，默认不强制中断 |
| `0x02` | `Recoverable` | 可恢复异常：出现故障但允许按实现策略恢复后继续 |
| `0x03` | `Severe` | 严重异常：当前操作应视为失败；是否终止进程由宿主策略决定，但不得当作可忽略 |
| `0x04` | `Abort` | 强制终止异常：必须终止相关内存操作路径；不得静默忽略 |

#### 4.11.3 异常标号空间与已登记标号

- 标号空间自 **`0x0000`** 起，上限 **`0xFFFF`**。
- 新标号**必须**在协议修订中登记后方可被「符合 ZMP1」的实现作为稳定对外标号使用；未登记标号**禁止**冒充本文已定义含义。
- 分配规则：在 `0x0000`–`0xFFFF` 内按升序占用；本文已占用的号段不得挪作他义。

**ZMP1 已登记标号：**

权威完整登记以独立文档为准（本文仅摘要）：

- 编码登记：[ExceptionCodeRegistry.md](./ExceptionCodeRegistry.md)
- 检索索引：[ExceptionIndex.md](./ExceptionIndex.md)

| 标号 | 规范短名 | 说明 |
|------|----------|------|
| `0x0000` | `Unspecified` | 未细分的通用内存异常占位；在尚未登记更具体标号前，允许使用本标号，但仍必须带合法的 `ExceptionCategory`、`ExceptionSummary`、`ExceptionChain` |
| `0x0001` | `IllegalUnitSizeBytes` | 非法颗粒大小（`UnitSizeBytes` 不在 1..536870911，或展开后的 `CellCount` 超出 Uint32） |
| `0x0002` | `IllegalUnitCount` | 非法颗粒数量（`UnitCount` 不在 1..4294967296，或关联表大小与之不一致） |
| `0x0003` | `CryptoUnavailable` | 宿主缺少可用的 `crypto.getRandomValues`（实现层索引 ID 生成失败） |
| `0x0004` | `UnitIndexAlphabetInvalid` | 颗粒索引 ID 字符表非法（实现层） |
| `0x0005` | `IllegalShallowDimension` | 非法浅维度（不是 1..4294967295 的整数，或浅切块数与 `ShallowDimension` 不一致） |
| `0x0006` | `IllegalDeepDimension` | 非法深维度（不是 1..4294967295 的整数，或 `NestingDepth` 不在 `1 .. DeepDimension`） |
| `0x0007` | `UnitNotActive` | 存储端口拒绝：`InitState` 不是 `0x4` |
| `0x0008` | `BitIndexOutOfRange` | 位元端口拒绝：`CellIndex` 不满足 `0 ≤ CellIndex < CellCount` |
| `0x0009` | `IllegalBitValue` | 位元端口拒绝：`WriteBit` 的 `BitValue` 不是 `0` 或 `1` |
| `0x000A` | `OctetIndexOutOfRange` | 八位组端口拒绝：`OctetIndex` 不满足 `0 ≤ OctetIndex < 八位组个数` |
| `0x000B` | `IllegalOctetValue` | 八位组端口拒绝：`WriteOctet` 的 `OctetValue` 不是整数 `0`–`255` |
| `0x000C` | `UnitOrdinalOutOfRange` | 跨颗粒端口拒绝：`UnitOrdinal` 不满足 `0 ≤ UnitOrdinal < UnitCount` |
| `0x000D` | `BlockSpanExceedsUint32` | 块的位元跨度大于 `4294967295` |
| `0x000E` | `BlockBitOffsetOutOfRange` | 块内位元端口拒绝：`BlockBitOffset` 不满足 `0 ≤ BlockBitOffset < BitLength` |
| `0x000F` | `NestingAtCeiling` | `Deepen` 拒绝：深度已达到 `DeepDimension` |
| `0x0010` | `AlreadyDeepened` | `Deepen` 拒绝：`Children` 已经非空 |
| `0x0011` | `TestsNotPassed` | `Initialize` 拒绝：总控尚未发布，且 `TestVerdict` 不是 `0x1`。类别必须为 Abort |
| `0x0012` | `NoUsableStorage` | 八位组之和小于 1，禁止发布。类别必须为 Abort |
| `0x0013` | `LinearBitIndexOutOfRange` | 线性位元地址越界。类别必须为 Abort |
| `0x0014` | `IllegalIntegerWidth` | 整数宽度不是 `2`、`4` 或 `8`。类别必须为 Abort |
| `0x0015` | `IntegerSpanOutOfRange` | 整数跨度越界。类别必须为 Abort |
| `0x0016` | `IllegalIntegerValue` | 整数值超出该宽度。类别必须为 Abort |
| `0x0017` | `BlockOctetIndexOutOfRange` | 块内八位组下标越界。类别必须为 Abort |
| `0x0018` | `BlockIndexOutOfRange` | 浅切根下标越界。类别必须为 Abort |
| `0x0019` | `AlreadyClaimed` | 浅切根已经有主人。类别必须为 Abort |
| `0x001A` | `NotClaimed` | 浅切根没有可归还的主人。类别必须为 Abort |
| `0x001B` | `OwnerMismatch` | 主人参数非法，或与当前主人不一致。类别必须为 Abort |

下一未占用异常标号是 `0x001C`。追加时**必须**同步写入登记表与索引。

#### 4.11.4 异常概述长度

- 设上限常量语义：`ExceptionSummaryMaxLength = 256`（协议固定语义常量；**不是**配置面必选字段）。
- `ExceptionSummary` 的 Unicode 码点长度 **必须**满足 `length < 256`。
- **禁止**长度为 256 或更大的概述。

#### 4.11.5 异常链

存入 `Exceptions` 的 `ExceptionChain` **必须**是 object，且**必须**含键 `Cause`。规范性键只有这一个。

- `Cause` **必须**为 `null`，或为另一条四属性齐全的 `MemoryException`。
- 准备写入时，若对象没有 `Cause` 键，**必须**按 `{ Cause: null }` 存储。空对象 `{}` 属于这种情况。
- 值为数组，或 `Cause` 既不是 `null` 也不是四属性异常时，该对象**不得**作为合规 `MemoryException` 对外报告。
- **禁止**把堆栈字符串当作 `ExceptionChain`。构造参数里的其它键**可以**存在于调用现场，但存入数组的链**必须**只保留 `Cause`。

### 4.12 内存单元初始化状态（必选字段 · `InitState`）

凡符合本协议的实现，其**内存单元（MemoryUnit）**在初始化相关生命周期中**必须**维护规范字段 `InitState`。

#### 4.12.1 字段约束（摘要）

| 规范字段名 | 类型要求 | 操作前初值 | 值域 |
|------------|----------|------------|------|
| `InitState` | 非负整数 | **必须**为 `0x0` | **必须**为已登记六档之一 |

**禁止**使用其它数值、布尔或字符串冒充 `InitState`。

#### 4.12.2 专一登记与索引（权威表）

六档取值、规范短名、语义及**主路径生命周期**以独立文档为准（本文不重复展开全文）：

- 编码登记：[InitStateRegistry.md](./InitStateRegistry.md)
- 专一索引：[InitStateIndex.md](./InitStateIndex.md)

| 取值 | 规范短名（摘要） |
|------|------------------|
| `0x0` | `InvalidPending` |
| `0x1` | `Preparing` |
| `0x2` | `InitFault` |
| `0x3` | `InitComplete` |
| `0x4` | `Active` |
| `0x5` | `Unrecoverable` |

#### 4.12.3 主路径生命周期（规范性 · MUST）

符合本协议的实现，对内存颗粒单元 **必须**遵守：

1. **未执行任何操作前**：`InitState` **必须**为 `0x0`；
2. **颗粒被实例化期间**：`InitState` **必须**为 `0x1`；
3. **实例化完成**：成功 **必须**为 `0x3`，失败 **必须**为 `0x2`（若进入无法恢复终局则 **必须**为 `0x5`）；
4. **全部初始化操作完成**（含实现自有逻辑完成后）：成功路径 **必须**将 `0x3` 更新为 `0x4`；
5. **正式可用判定**：**仅当** `InitState === 0x4` 时，该单元在 ZMP1 中算作正式可用；**禁止**对其它取值宣称正式可用；
6. **阶段 D 只晋升状态**：将 `0x3` 更新为 `0x4` 时，**禁止**改写该单元的 `Cells` 与 `CellCount`（存储体见 §4.15）。

权威细节、禁止项与核对清单见登记表 / 索引。由谁写入字段见 §2.2（不规定）。

**禁止**将 `0x5` 再恢复为可用并宣称正式启用。

### 4.13 侧信道数组（必选 · `Events` / `Signals` / `Exceptions`）

内存单元**必须**维护 `Events`、`Signals`、`Exceptions`。内存总控**必须**维护 `Events`、`Signals`，以及存放总控级 `MemoryException` 的 `Exceptions`。名称逐字固定。

事件与信号的完整标号在专一登记：

- 事件：[EventCodeRegistry.md](./EventCodeRegistry.md)、[EventCodeIndex.md](./EventCodeIndex.md)
- 信号：[SignalCodeRegistry.md](./SignalCodeRegistry.md)、[SignalCodeIndex.md](./SignalCodeIndex.md)

#### 4.13.1 元素形态

| 数组 | 元素必须含有的键 | 追加规则 |
|------|------------------|----------|
| `Events` | `EventCode`、`Subject`、`Detail`，三者都是 Uint32。`EventCode` 必须已登记 | 只追加。禁止按标号覆盖旧条目 |
| `Signals` | `SignalCode`、`Level`、`Subject`。`SignalCode` 与 `Subject` 是 Uint32。`Level` 只能是整数 `0` 或 `1` | 同一 `SignalCode` 与同一 `Subject` 只保留一条，后写的 `Level` 覆盖先前的 |
| `Exceptions` | §4.11 的四属性 | 只追加合规 `MemoryException` |

进入 `0x1` 之前，颗粒的三个数组**必须**为空。`InitState` 进入 `0x2`、`0x3`、`0x4` 或 `0x5` 时，**必须**按登记表追加对应事件，并刷新该颗粒的 `Usable` 与 `Fault`。`0x0` 与 `0x1` **禁止**追加生命周期事件。

总控构造开始时 `Events` 与 `Signals` **必须**为空。浅切完成且阶段 D 处理完各颗状态之后，**必须**追加 `ShallowCutCompleted`，并刷新 `Ready`。`Deepen`、`Claim`、`Release` 成功时**必须**追加登记表中的对应事件。

#### 4.13.2 与异常对象的关系

- 端口、加深、发布与所有权各节已经要求写入的异常，**必须**写入，类别**必须**为 `0x04`。
- 这些节没有点名的其它情况是否写入 `Exceptions`，见 §2.2。
- 一旦某元素出现在 `Exceptions` 中，该元素**必须**为合规 `MemoryException`。

#### 4.13.3 不符合示例（本条）

- 缺失 `Events` / `Signals` / `Exceptions` 任一数组；
- `Events` 中推入字符串，或缺少 `EventCode` / `Subject` / `Detail`；
- 用布尔值充当 `Level`；
- 同一 `SignalCode` 与同一 `Subject` 在 `Signals` 里出现两条；
- `InitState` 仍为 `0x0` 时已经追加了 `Instantiated`。

### 4.14 引导与对外暴露字段（必选规范名）

凡符合本协议的实现，**必须**按下列规范名提供引导与对外挂载字段，供坐座主机与第三方用**相同字段名**完成引导与后续调用。本协议不命名该主机角色。大小写敏感，**禁止**用语义近似名替代。

#### 4.14.1 字段总表

| 规范名 | 挂载位置 | 角色约束 | 本修订要求 |
|--------|----------|----------|------------|
| `MachineMemory` | 实现提供的内存引导门面（对象或等价命名空间） | 整机内存侧对外引导入口 | **必须**存在 |
| `MemoryInit` | **必须**为 `MachineMemory` 上的字段 | 内存初始化入口。调用角色不在本协议内。内存实现**禁止**把发布结果写入其它子系统 | **必须**存在；**必须**提供方法 `Test` 与 `Initialize`，以及字段 `TestVerdict`、`TestReport`、`Exceptions`（见 §4.14.3、§4.22） |
| `MemoryController` | **必须**为 `MachineMemory` 上的字段 | 内存总控完成初始化后，将**自身**挂到该字段。**禁止**改挂到其它子系统后仍声称已按本条发布 | 字段名**必须**为 `MemoryController`；初始化前为空 |

#### 4.14.2 引导关系（规范性链路）

符合本协议的实现**必须**支持下列逻辑链路（名称与方向固定）：

1. 坐座主机经 `MachineMemory.MemoryInit` 取得入口。`MachineMemory.MemoryController` 仍为空时，**必须**先调用 `Test`，仅当该次 `TestVerdict` 为 `0x1` 之后再调用 `Initialize`；
2. `MemoryInit.Initialize` 在 §4.22 允许发布时**引导并初始化**内存总控；
3. 内存总控初始化完成后，将自身暴露为 `MachineMemory.MemoryController`。**禁止**把总控写入其它子系统来代替这一字段。

**禁止**将初始化入口挂在其它规范名（如 `Init`、`MemoryBootstrap`、`machine_memory`）后仍声称兼容 ZMP1。  
**禁止**宣称「只有名为 Boot 的角色才能调用 `MemoryInit`」为 ZMP1 要求（本文不命名调用角色）。

#### 4.14.3 最小规范方法 `Initialize`（必选）

挂在 `MemoryInit` 上的下列方法为 ZMP1 **最小必选**（名称逐字固定）：

| 规范方法名 | 参数 | 返回值 | 语义 |
|------------|------|--------|------|
| `Test` | **无** | **无**（`void` / 等价「无返回值」） | 执行 §4.22 的全部已登记用例。**禁止**发布 `MemoryController` |
| `Initialize` | **无** | **无**（`void` / 等价「无返回值」） | 在 §4.22 允许时创建内存总控，写入 `TotalSizeBytes` 与已启用的 `MemoryId`，再把总控写入 `MachineMemory.MemoryController` |

附加约束：

- **幂等**：若 `MemoryController` 已非空（已初始化），再次调用 `Initialize` **必须**安全返回，**禁止**要求调用方先查状态才能调用，也**不必**再次检查 `TestVerdict`。
- `MachineMemory.MemoryController` 仍为空时，`Initialize` 的放行条件见 §4.22.3。
- **禁止**以 `init` / `Run` / `Bootstrap` 等非规范名替代 `Initialize`，或以 `RunTests` / `SelfTest` 替代 `Test` 后仍声称兼容 ZMP1。
- `MemoryInit` 上除 `Test` 与 `Initialize` 以外没有别的必选方法。内存总控与内存块上已经写死的方法见 §4.19–§4.27，**禁止**把那些方法宣称为本条尚未锁定。

### 4.15 内存颗粒存储体（必选 · `Cells` / `CellCount`）

凡符合本协议的实现，其**内存单元**在实例化时**必须**建立存储体，并维护规范字段 `Cells` 与 `CellCount`。名称逐字固定、大小写敏感。

本存储体是逻辑硬件：位元与八位组。**禁止**把电荷刷新、泄漏、时序窗口、热、磨损，或其它仅因物理载体才存在的效应写成 ZMP1 要求。**禁止**把未经值域裁剪的宿主浮点数当作位元或八位组的规范值。

#### 4.15.1 字段

| 规范字段名 | 类型要求 | 实例化成功（进入 `0x3` 之前必须已经满足；升为 `0x4` 时保持） | 实例化未成功（`0x2` 或 `0x5`） |
|------------|----------|----------------------------------------------------------------|--------------------------------|
| `Cells` | 八位组序列 | 长度（八位组个数）**必须**等于 `UnitSizeBytes`；每个八位组**必须**为整数 `0` | 长度**必须**为 `0` |
| `CellCount` | Uint32 | **必须**等于精确乘积 `UnitSizeBytes × BitsPerByte` | **必须**为 `0` |

- 成功实例化时，每个八位组为 `0`，**等价于**该八位组内 8 个位元均为 `0`。
- **禁止**在成功实例化结束时留下非零八位组，或把未初始化的宿主内存当作已清零。
- **禁止**在失败实例化时仍保留非空 `Cells` 或非零 `CellCount`。
- 阶段 D 将 `0x3` 更新为 `0x4` 时，**禁止**改写 `Cells` 或 `CellCount`。

#### 4.15.2 位元取值（封闭二值）

位元的规范取值**仅**为下表。**禁止**其它取值。

| 取值 | 含义 |
|------|------|
| `0` | 位元为零 |
| `1` | 位元为一 |

该二值是封闭集合，**不是**可追加编码表，因此**不**单列 Registry / Index。若存储元需要第三个取值，**必须**发布新的协议修订，**禁止**在仍标识为 `ZMP1` 时扩展位元值域。互操作必选的是取值 `0` / `1`，以及字段 `Cells`、`CellCount`。

#### 4.15.3 位序与颗粒内下标（规范性映射）

设某位元的颗粒内下标为 `CellIndex`（Uint32）。

当 `0 ≤ CellIndex < CellCount` 时，该位元在 `Cells` 中的位置**必须**按下列精确整数运算确定。除法是非负整数的向下取整：

1. `OctetIndex = floor(CellIndex / BitsPerByte)`；
2. `BitOffset = CellIndex − OctetIndex × BitsPerByte`，因此 `0 ≤ BitOffset ≤ 7`；
3. 位元位于 `Cells` 的第 `OctetIndex` 个八位组（下标从 `0` 起，`0` 是首八位组）；
4. `BitOffset = 0` **必须**是该八位组的最低有效位；`BitOffset = k` 的权重**必须**为 `2^k`；
5. 该位元的取值**必须**等于：把八位组整数除以 `2^BitOffset` 的整数商，再对 `2` 取余。

因此，八位组整数 `0` 表示其中 8 个位元全为 `0`；八位组整数 `1` 表示仅最低有效位为 `1`。

**禁止**把最高有效位当作 `BitOffset = 0` 后仍声称符合本映射。  
**禁止**把八位组整数 `0`–`255` 本身宣称为一个位元的规范取值。  
存储原子是位元，紧凑载体是单个八位组。跨八位组整数的宽度与小端见 §4.24，不在本节另设一种整数对象。

#### 4.15.4 本节不单独规定

下列事项不由本节定义，分别见后文：

- 跨八位组整数及其端序见 §4.24；
- 浅切根所有权见 §4.26。

八位组端口见 §4.18，跨颗粒端口见 §4.19，块的位元跨度见 §4.20。**禁止**把这些节宣称为未规定。

#### 4.15.5 不符合示例（本条）

- 配置面缺失 `BitsPerByte`，或 `BitsPerByte ≠ 8`；
- 成功实例化后 `Cells` 的长度不等于 `UnitSizeBytes`，或任一八位组不为 `0`；
- 成功实例化后 `CellCount ≠ UnitSizeBytes × 8`；
- 失败实例化后 `Cells` 长度不为 `0`，或 `CellCount ≠ 0`；
- 将 `0x3` 升为 `0x4` 时改写了 `Cells` 或 `CellCount`；
- 把八位组值 `2`–`255` 当作单个位元的合法取值；
- 声称位偏移 `0` 是最高有效位，且该约定属于 ZMP1。

### 4.16 浅切内存块（必选 · `Blocks` / `BlockIndex` / `NestingDepth`）

凡符合本协议的实现，在内存初始化完成、且成功路径上的颗粒进入 `0x4` 之前，**必须**完成一次浅切，并在内存总控上维护规范字段 `Blocks`。

浅切是逻辑划分，不是物理分页。**禁止**把刷新、行缓冲或时序写成浅切的组成部分。

#### 4.16.1 字段

| 规范字段名 | 挂载 | 类型要求 | 浅切完成时 |
|------------|------|----------|------------|
| `Blocks` | 内存总控 | 内存块序列 | 长度**必须**等于 `ShallowDimension` |
| `BlockIndex` | 序列中的每一块 | Uint32 | 序列**必须**恰好包含 `0`、`1`、…、`ShallowDimension − 1` 各一次，并按升序排列 |
| `NestingDepth` | 序列中的每一块 | Uint32 | **必须**为 `1`，且 **必须**满足 `1 ≤ NestingDepth ≤ DeepDimension` |

- 块与块之间在浅切这一层是平的。`NestingDepth = 1` 表示这块占住第一层。子块不在浅切这一步出现，见 §4.21。
- **禁止**缺失 `Blocks`，或用颗粒关联表代替 `Blocks`。
- **禁止**让两块共用同一个 `BlockIndex`，或跳号，或从 `1` 而不是 `0` 起编后仍声称符合本节。
- 进入阶段 D、将 `0x3` 更新为 `0x4` 时，浅切**必须**已经完成。该晋升**禁止**改写 `Blocks` 中已建立的 `BlockIndex`、`NestingDepth`、`BitLength` 与 `Children`，也**禁止**改写任一单元的 `UnitOrdinal`。

#### 4.16.2 与颗粒的关系

- 浅切块数**只**由 `ShallowDimension` 决定。
- **禁止**要求块数等于 `UnitCount`，或要求 `ShallowDimension × DeepDimension = UnitCount`。
- 某一块覆盖位元线上的哪一段，见 §4.20。本节**不**把某一块规定成某一颗。

#### 4.16.3 本修订不规定

- 按内存块读写八位组见 §4.25（块的起点不必对齐到颗粒的八位组边界；位元端口见 §4.20）；
- 一次调用就把嵌套加深多层（一次 `Deepen` 只加一层，见 §4.21）。

#### 4.16.4 不符合示例（本条）

- `ShallowDimension = 0`，或浅切所得块数不等于 `ShallowDimension`；
- `Blocks` 未按 `BlockIndex` 升序，或下标集合不是 `0 .. ShallowDimension-1`；
- 浅切完成后某块 `NestingDepth ≠ 1`，或 `NestingDepth > DeepDimension`；
- 尚未浅切就把颗粒标成 `0x4`；
- 声称「第 i 块对应第 i 颗颗粒」，或使用不同于 §4.20 的跨度公式后仍声称符合 ZMP1。

### 4.17 颗粒内位元端口（必选方法 · `ReadBit` / `WriteBit`）

凡符合本协议的实现，其**内存单元**必须提供下列两个方法。名称逐字固定、大小写敏感。端口只作用于**该单元自己的**存储体。一次调用只读或只写**一个**位元。

#### 4.17.1 方法

| 规范方法名 | 参数 | 成功时的返回值 | 成功语义 |
|------------|------|----------------|----------|
| `ReadBit` | `CellIndex`：Uint32 | 整数 `0` 或 `1` | 按 §4.15.3 返回该位元的当前取值 |
| `WriteBit` | `CellIndex`：Uint32；`BitValue`：整数 `0` 或 `1` | 无 | 只把该位元改为 `BitValue`。同一八位组内其它位元，以及其它八位组，必须保持不变 |

**禁止**用 `readBit` / `Read` / `WriteCell` 等名字替代后仍声称兼容 ZMP1。

#### 4.17.2 允许条件与检查顺序

调用可以成功，仅当同时满足：

1. 该单元 `InitState === 0x4`；
2. `CellIndex` 是 Uint32，且 `0 ≤ CellIndex < CellCount`；
3. 对 `WriteBit`，`BitValue` 是整数 `0` 或 `1`。

多项不满足时，**必须**按上列顺序取第一个失败项报告，禁止改报后面的项。因此尚未正式可用时，即使下标也越界，标号仍必须是 `UnitNotActive`。

位元位置**必须**使用 §4.15.3：`OctetIndex = floor(CellIndex / BitsPerByte)`，`BitOffset = CellIndex − OctetIndex × BitsPerByte`，`BitOffset = 0` 为最低有效位，权重为 `2^BitOffset`。

#### 4.17.3 失败

失败时：

- **禁止**改写 `Cells` 中任何一个八位组；
- **必须**向该单元的 `Exceptions` 追加一条 `MemoryException`；
- 该条的 `ExceptionCategory` **必须**为 `0x04`（`Abort`）；
- `ExceptionCode` **必须**为下表之一：

| 第一个失败项 | 标号 | 规范短名 |
|--------------|------|----------|
| `InitState` 不是 `0x4` | `0x0007` | `UnitNotActive` |
| 下标不是合法 `CellIndex` | `0x0008` | `BitIndexOutOfRange` |
| `WriteBit` 的 `BitValue` 不是 `0` 或 `1` | `0x0009` | `IllegalBitValue` |

`ReadBit` 失败时**禁止**返回 `0` 或 `1` 来表示失败。`WriteBit` 失败时**禁止**让调用方将其视为已经写入。

宿主语言用 `throw` 还是别的方式表达「没有正常返回」，**不在**本节。官方实现的宿主映射见该实现的 API 文档，不是本协议的一部分。

#### 4.17.4 本修订不规定

- 一次 `ReadBit` / `WriteBit` 改动多个位元。

按八位组读写见 §4.18。跨八位组整数见 §4.24。经总控跨颗粒见 §4.19。经内存块见 §4.20。**禁止**把这些节宣称为未规定。

#### 4.17.5 不符合示例（本条）

- 内存单元缺少 `ReadBit` 或 `WriteBit`，或以其它名字代替；
- `InitState` 不是 `0x4` 时仍返回或写入位元；
- `WriteBit` 改动了目标位以外的位元；
- 失败时没有向该单元 `Exceptions` 追加规定标号，或追加时类别不是 `0x04`；
- 尚未正式可用且下标越界，却报告 `BitIndexOutOfRange` 而不是 `UnitNotActive`；
- `ReadBit` 失败时返回 `0`。

### 4.18 颗粒内八位组端口（必选方法 · `ReadOctet` / `WriteOctet`）

凡符合本协议的实现，其**内存单元**必须提供下列两个方法。名称逐字固定、大小写敏感。一次调用只读或只写**一个**八位组，也就是该组里的全部 8 个位元。

#### 4.18.1 方法

| 规范方法名 | 参数 | 成功时的返回值 | 成功语义 |
|------------|------|----------------|----------|
| `ReadOctet` | `OctetIndex`：Uint32 | 整数 `0`–`255` | 返回 `Cells` 中第 `OctetIndex` 个八位组的当前整数 |
| `WriteOctet` | `OctetIndex`：Uint32；`OctetValue`：整数 `0`–`255` | 无 | 把该八位组整组改为 `OctetValue`。其它八位组必须保持不变 |

**禁止**用 `readOctet` / `ReadByte` / `WriteCell` 等名字替代后仍声称兼容 ZMP1。

八位组个数：实例化成功时**必须**等于 `UnitSizeBytes`；实例化未成功时 `Cells` 的长度**必须**为 `0`。合法下标当且仅当 `OctetIndex` 是 Uint32，且 `0 ≤ OctetIndex < 八位组个数`。

#### 4.18.2 允许条件与检查顺序

调用可以成功，仅当同时满足：

1. 该单元 `InitState === 0x4`；
2. `OctetIndex` 是合法下标；
3. 对 `WriteOctet`，`OctetValue` 是整数 `0`–`255`。

多项不满足时，**必须**按上列顺序取第一个失败项报告。因此尚未正式可用时，即使下标也越界，标号仍必须是 `UnitNotActive`。

#### 4.18.3 失败

失败时：

- **禁止**改写 `Cells` 中任何一个八位组；
- **必须**向该单元的 `Exceptions` 追加一条 `MemoryException`；
- 该条的 `ExceptionCategory` **必须**为 `0x04`（`Abort`）；
- `ExceptionCode` **必须**为下表之一：

| 第一个失败项 | 标号 | 规范短名 |
|--------------|------|----------|
| `InitState` 不是 `0x4` | `0x0007` | `UnitNotActive` |
| 下标不是合法 `OctetIndex` | `0x000A` | `OctetIndexOutOfRange` |
| `WriteOctet` 的 `OctetValue` 不是 `0`–`255` 的整数 | `0x000B` | `IllegalOctetValue` |

`ReadOctet` 失败时**禁止**返回 `0`–`255` 来表示失败。宿主语言如何表达「没有正常返回」，**不在**本节。

#### 4.18.4 本修订不规定

- 一次 `ReadOctet` / `WriteOctet` 改动多个八位组。跨八位组整数见 §4.24。经内存块按八位组读写见 §4.25。

#### 4.18.5 不符合示例（本条）

- 内存单元缺少 `ReadOctet` 或 `WriteOctet`；
- `WriteOctet` 改动了目标八位组以外的八位组；
- 尚未正式可用且下标越界，却报告 `OctetIndexOutOfRange`。

### 4.19 颗粒序号与跨颗粒端口（必选 · `UnitOrdinal`）

#### 4.19.1 字段 `UnitOrdinal`

凡符合本协议的实现，其**每一颗内存单元**必须维护规范字段 `UnitOrdinal`，类型 Uint32。

- 按创建顺序赋值：第一颗为 `0`，此后每颗比上一颗大 `1`；
- 全部序号**必须**恰好是 `0`、`1`、…、`UnitCount − 1` 各一次；
- 阶段 D 将 `0x3` 更新为 `0x4` 时，**禁止**改写 `UnitOrdinal`；
- `UnitOrdinal` **不是** `MemoryId`，也**不是**实现用来做关联表键的索引字符串。

`UnitCount` 的上界见 §4.4。超出该上界时，**禁止**仍然分配序号。

#### 4.19.2 总控方法

内存总控必须提供下列方法。名称与内存单元上的方法同名，大小写敏感。区别是挂载处，以及第一个参数为 `UnitOrdinal`。

| 规范方法名 | 参数 | 成功时的返回值 | 成功语义 |
|------------|------|----------------|----------|
| `ReadBit` | `UnitOrdinal`：Uint32；`CellIndex`：Uint32 | 整数 `0` 或 `1` | 转交该序号上内存单元的 `ReadBit` |
| `WriteBit` | `UnitOrdinal`：Uint32；`CellIndex`：Uint32；`BitValue`：整数 `0` 或 `1` | 无 | 转交该序号上内存单元的 `WriteBit` |
| `ReadOctet` | `UnitOrdinal`：Uint32；`OctetIndex`：Uint32 | 整数 `0`–`255` | 转交该序号上内存单元的 `ReadOctet` |
| `WriteOctet` | `UnitOrdinal`：Uint32；`OctetIndex`：Uint32；`OctetValue`：整数 `0`–`255` | 无 | 转交该序号上内存单元的 `WriteOctet` |

**禁止**把这四个名字改成 `ReadBitAt` 等其它拼写后仍声称兼容 ZMP1。

#### 4.19.3 检查顺序与失败落点

1. 先检查 `UnitOrdinal`：它必须是 Uint32，且 `0 ≤ UnitOrdinal < UnitCount`，并且该序号上确有一颗内存单元；
2. 序号合法时，其余检查、成功语义与失败标号**完全**按被转交的那一节（§4.17 或 §4.18）。

序号非法时：

- **禁止**改写任何单元的 `Cells`；
- **必须**向**内存总控**的 `Exceptions` 追加一条 `MemoryException`；
- 该条的 `ExceptionCategory` **必须**为 `0x04`，`ExceptionCode` **必须**为 `0x000C`（`UnitOrdinalOutOfRange`）；
- **禁止**把该失败记成 `BitIndexOutOfRange` 或 `OctetIndexOutOfRange`；
- **禁止**为同一次失败再向某一颗的 `Exceptions` 追加第二条。

序号合法、而颗粒端口失败时：异常**只**记在那一颗上。总控**禁止**再追加第二条。

本协议**不**把 `(UnitOrdinal, CellIndex)` 定义为一个扁平整数地址。跨颗粒地址就是这一对字段。

#### 4.19.4 不符合示例（本条）

- 内存单元缺少 `UnitOrdinal`，或序号有重复、有空洞；
- 总控缺少上述四个方法，或用别的名字代替；
- `UnitCount = 8` 时 `UnitOrdinal = 8` 仍读写成功；
- 序号越界的异常出现在颗粒的 `Exceptions` 里，而不是总控的 `Exceptions` 里。

### 4.20 块的位元跨度（必选 · `BitLength`）

浅切在建立 `Blocks` 时，**必须**同时确定每一块覆盖的位元区间。这是逻辑上的连续分段，不是物理分页。

#### 4.20.1 位元线

把内存单元按 `UnitOrdinal` 从 `0` 升序拼接。

- 第 `i` 颗贡献它**自己的** `CellCount` 个位元。实例化未成功的颗粒 `CellCount` 为 `0`，因此不占位元；
- `TotalBitCount` 是这些 `CellCount` 的精确整数和。该和**可以**大于 Uint32；
- **禁止**用浮点舍入截断这个和之后仍声称符合本节。

线性下标 `L` 满足 `0 ≤ L < TotalBitCount` 时，落点**必须**这样确定：从序号 `0` 起，依次减去该颗的 `CellCount`；第一颗使剩余值严格小于其 `CellCount` 的，其序号就是 `UnitOrdinal`，剩余值就是 `CellIndex`。

#### 4.20.2 均分

设浅切块数为 `N = ShallowDimension`（`N ≥ 1`）。第 `i` 块（`BlockIndex = i`）的半开区间**必须**为：

1. `Start(i) = floor(i × TotalBitCount / N)`；
2. `End(i) = floor((i + 1) × TotalBitCount / N)`；
3. `BitLength(i) = End(i) − Start(i)`。

因此：

- 各块区间互不重叠，并且并起来正好是 `[0, TotalBitCount)`；
- 任意两块的 `BitLength` 相差至多 `1`；
- 每一块**必须**有规范字段 `BitLength`，类型 Uint32；
- 若任何一块的长度大于 `4294967295`，浅切**必须**失败：向总控 `Exceptions` 追加 `0x000D`（`BlockSpanExceedsUint32`），类别**必须**为 `0x04`；**禁止**进入阶段 D（**禁止**把 `0x3` 升为 `0x4`）；**禁止**把这次浅切当作已完成。

**禁止**把「第 `i` 块等于第 `i` 颗」或「块数等于 `UnitCount`」写成这一公式的代替品后仍声称符合 ZMP1。块数仍**只**等于 `ShallowDimension`。

#### 4.20.3 块上的位元端口

每一块必须提供 `ReadBit` 与 `WriteBit`。参数里的偏移名是 `BlockBitOffset`。

| 规范方法名 | 参数 | 成功时的返回值 | 成功语义 |
|------------|------|----------------|----------|
| `ReadBit` | `BlockBitOffset`：Uint32 | 整数 `0` 或 `1` | 读线性下标 `Start + BlockBitOffset` 上的那一个位元 |
| `WriteBit` | `BlockBitOffset`：Uint32；`BitValue`：整数 `0` 或 `1` | 无 | 只写那一个位元 |

`BlockBitOffset` 合法，当且仅当它是 Uint32 且 `0 ≤ BlockBitOffset < BitLength`。合法时**必须**按 §4.20.1 落到某一颗，再调用该颗的 `ReadBit` / `WriteBit`。一次仍只动一个位元。

偏移非法时：

- **禁止**改写任何 `Cells`；
- **必须**向**总控** `Exceptions` 追加 `0x000E`（`BlockBitOffsetOutOfRange`），类别**必须**为 `0x04`；
- **禁止**正常返回成功值。

偏移合法之后的失败，按 §4.17 记在那一颗上。总控**禁止**再追加第二条。

#### 4.20.4 本修订不规定

- 块的线性起点不必是 `BitsPerByte` 的整数倍。块内八位组仍按 §4.25 用连续 8 个位元定义，不要求对齐颗粒的八位组边界。

#### 4.20.5 不符合示例（本条）

- 块缺少 `BitLength`，或长度不按本节的 `floor` 公式；
- 跨度大于 Uint32 仍把颗粒标成 `0x4`；
- 块上的 `WriteBit` 改动了目标位以外的位元。

### 4.21 加深（必选方法 · `Deepen`）

每一块必须维护规范字段 `Children`（内存块序列）。浅切完成时，每一块的 `Children` 长度**必须**为 `0`。

每一块必须提供无参数、无返回值的方法 `Deepen`。

#### 4.21.1 检查顺序

1. 若 `NestingDepth ≥ DeepDimension`，失败标号**必须**为 `0x000F`（`NestingAtCeiling`）；
2. 否则若 `Children` 的长度不是 `0`，失败标号**必须**为 `0x0010`（`AlreadyDeepened`）。

失败时：`Children`、`NestingDepth`、`BitLength` 与任何 `Cells` 都**必须**保持调用前的值。**必须**向**总控** `Exceptions` 追加一条类别为 `0x04` 的上述标号。**禁止**正常返回成功。

#### 4.21.2 成功

成功时：

- 父块的 `NestingDepth` **不变**；
- 父块的 `BitLength` **不变**；
- 任何 `Cells` **不变**；
- 总控 `Blocks` 的长度**仍**等于 `ShallowDimension`。子块**不**另占 `Blocks` 中的一项；
- `Children` 的长度**必须**等于 `ShallowDimension`，并按 `ChildIndex` 升序；
- 第 `i` 个子块**必须**同时满足：
  - `ChildIndex = i`（`0 .. ShallowDimension − 1` 各一次）；
  - `NestingDepth = 父块 NestingDepth + 1`，且该值 `≤ DeepDimension`；
  - `BlockIndex` 等于父块的 `BlockIndex`（所属浅切根的下标）；
  - 自己的 `Children` 长度为 `0`；
  - 位元跨度把父块的 `BitLength` 当作 §4.20.2 里的 `TotalBitCount`，把 `ShallowDimension` 当作块数，用同一套 `floor` 公式切出。子块在整机位元线上的起点 = 父块起点 + 该子区间的起点。

子块可以再被 `Deepen`，直到其 `NestingDepth` 达到 `DeepDimension`。一次 `Deepen` **只**加一层。

浅切根**不得**把 `ChildIndex` 当作 `0 .. ShallowDimension − 1` 中的子块下标。子块**必须**提供 `ChildIndex`，类型 Uint32，且恰好取该区间中的一个值。根块可以不提供该属性；若提供，其值**必须**不是该区间中的下标。

#### 4.21.3 不符合示例（本条）

- 浅切完成后某块 `Children` 非空；
- 深度已经等于 `DeepDimension` 时 `Deepen` 仍然成功；
- `Deepen` 改写了父块的 `NestingDepth` 或 `BitLength`；
- 子块个数不等于 `ShallowDimension`；
- `Deepen` 复制了一份存储体。

---

### 4.22 初始化前测试（必选 · `Test`）

凡符合本协议的实现，其 `MemoryInit` **必须**提供方法 `Test`，并维护字段 `TestVerdict`、`TestReport`、`Exceptions`。名称逐字固定、大小写敏感。

用例的规范名、顺序与通过条件以专一登记为准：

- 编码登记：[TestCaseRegistry.md](./TestCaseRegistry.md)
- 检索索引：[TestCaseIndex.md](./TestCaseIndex.md)

**禁止**用官方函数名、文件名或某一版标定数字代替登记表中的用例。

#### 4.22.1 裁定与报告

`TestVerdict` 是封闭的三档，**不是**可追加编码表，因此**不**单列 Registry / Index。

| 取值 | 规范短名 | 含义 |
|------|----------|------|
| `0x0` | `NotRun` | 还没有完成过一次 `Test` |
| `0x1` | `Passed` | 最近一次 `Test` 的每一个已登记用例都通过 |
| `0x2` | `Failed` | 最近一次 `Test` 至少有一个已登记用例未通过 |

尚未调用过 `Test` 时，`TestVerdict` **必须**为 `0x0`，`TestReport.Cases` 的长度**必须**为 `0`，`TestReport.AllPassed` **必须**为 `0`。

一次 `Test` 返回之后：

- `TestReport.Cases` 的长度**必须**等于登记表中已登记用例的个数；
- 顺序与 `CaseName` **必须**与登记表逐字一致；
- 每一条 `Passed` **必须**为整数 `0` 或 `1`。**禁止**使用布尔值。值为 `1` 时，该条 `Summary` **必须**为空字符串；值为 `0` 时，`Summary` 的 Unicode 码点长度**必须**严格小于 256；
- `AllPassed` **必须**为整数 `0` 或 `1`，并且为 `1` 当且仅当每一条 `Passed` 都是 `1`；
- `TestVerdict` **必须**为 `0x1` 当且仅当 `AllPassed` 为 `1`，否则**必须**为 `0x2`。

用例未通过**不得**因此向 `MemoryInit.Exceptions` 追加记录。那些失败只出现在 `TestReport`。

#### 4.22.2 方法 `Test`

| 规范方法名 | 参数 | 返回值 | 语义 |
|------------|------|--------|------|
| `Test` | **无** | **无** | 按登记表顺序执行每一个已登记用例 |

附加约束：

- **禁止**用参数、配置开关或调用次数选择用例子集。
- 某一条未通过，或该条在宿主中抛出错误时，该条记为未通过，**必须**继续执行后面的每一个已登记用例。**禁止**提前结束并留下较短的 `Cases`。
- `Test` **必须**在 `MachineMemory.MemoryController` 仍为空时允许调用。
- `Test` **禁止**把 `MachineMemory.MemoryController` 写成非空，也**禁止**改写或清空已经发布的总控，并**禁止**改写 `TotalSizeBytes` 与 `MemoryId`。
- 一次 `Test` 尚未结束时再次调用 `Test`，内层调用**禁止**把 `TestVerdict` 写成 `0x1`，也**禁止**改写外层尚未完成的报告。
- 后一次 `Test` 若未全部通过，`TestVerdict` **必须**成为 `0x2`。在总控尚未发布时，这撤销此前的放行。

#### 4.22.3 `Initialize` 的放行

- `MachineMemory.MemoryController` 已经非空时，`Initialize` **必须**安全返回，**不必**再次检查 `TestVerdict`，**禁止**因此再造一台总控。
- `MachineMemory.MemoryController` 仍为空，且 `TestVerdict` 不是 `0x1` 时，`Initialize` **禁止**创建内存总控，**禁止**发布 `MemoryController`。此时**必须**向 `MemoryInit.Exceptions` 追加一条 `MemoryException`：`ExceptionCode` 为 `0x0011`（`TestsNotPassed`），`ExceptionCategory` **必须**为 `0x04`。
- `TestVerdict` 为 `0x1` 且总控尚未发布时，`Initialize` **必须**先造出内存总控，但先不要发布。然后计算各颗 `Cells.length` 之和：
  - 和小于 `1` 时，**禁止**发布，**禁止**改写 `TotalSizeBytes` 与 `MemoryId`，并**必须**向 `MemoryInit.Exceptions` 追加 `0x0012`，类别为 `0x04`；
  - 和 ≥ `1` 时，按 §4.7.3 抽取 `MemoryId`。抽不出时按该节追加 `0x0003`，同样不发布、不改写配置面；
  - 抽出已启用的 `MemoryId` 之后，**必须**先把 `TotalSizeBytes` 写成这个和、把 `MemoryId` 写成这条串，再把总控写入 `MachineMemory.MemoryController`。
- `Initialize` **禁止**用一次不完整的内部检查代替 `Test`。放行只认最近一次完整 `Test` 的裁定。`Initialize` **不必**在内部再次调用 `Test`。
- 已经发布之后再次 `Initialize` **禁止**重新抽取 `MemoryId`。
- 宿主是否把这次拒绝映射为 `throw`，**不在**本协议规定。官方实现会抛出；其它实现只要不发布总控，并留下上述异常记录，即符合本条。

#### 4.22.4 不符合示例（本条）

- `MemoryInit` 缺少方法 `Test`，或以 `RunTests` / `SelfTest` 等名字冒充；
- `Test` 接受用例名参数，或在第一条失败后不再执行后续用例；
- `Test` 把临时总控写进 `MachineMemory.MemoryController`；
- 尚未出现 `TestVerdict = 0x1` 时，`Initialize` 仍然发布了总控；
- 放行失败时没有追加 `0x0011`，或该条类别不是 `0x04`；
- 八位组之和小于 `1` 时仍然发布，或没有追加 `0x0012`；
- 抽不出 `MemoryId` 时仍然发布，或发布后的 `MemoryId` 仍等于 `ZeroId`；
- 把官方标定中的颗粒数或块数写成用例通过条件。



### 4.23 线性位元地址（必选方法 · `ReadLinearBit` / `WriteLinearBit`）

整机位元线按 `UnitOrdinal` 升序拼接各颗 `CellCount`。`CellCount` 为 `0` 的颗粒不占位置。

`LinearBitIndex` 的类型是非负整数，值域 `0 .. 18446744073709551615`。落在某一颗、位元下标为 `CellIndex` 的线性地址，等于所有更小序号颗粒的 `CellCount` 之和，再加上 `CellIndex`。

该地址合法，当且仅当它落在上述值域内，且严格小于全部 `CellCount` 之和。

内存总控**必须**提供：

| 规范方法名 | 参数 | 返回值 |
|------------|------|--------|
| `ReadLinearBit` | `LinearBitIndex` | 位元 `0` 或 `1` |
| `WriteLinearBit` | `LinearBitIndex`、`BitValue` | 无 |

检查顺序：先检查线性地址。不是上述值域中的整数，或越出位元线时，向总控 `Exceptions` 追加 `0x0013`，类别**必须**为 `0x04`，存储体不变。地址合法之后转交该颗的 `ReadBit` / `WriteBit`。颗粒失败只记在颗粒上，总控**禁止**为同一次失败再追加一条。

### 4.24 小端整数（必选方法）

`OctetWidth` 的封闭集合是 `2`、`4`、`8`。宽度 `1` 由八位组端口表达，**禁止**放进本集合。本集合不是可追加登记表。

端序只有小端：下标最小的八位组是最低有效字节。八位组内位偏移 `0` 仍是最低有效位。

`IntegerValue` 是该宽度的补码整数，范围 `−2^(8×OctetWidth−1) .. 2^(8×OctetWidth−1)−1`。最高位是符号位。读出时必须交回这个数学值，禁止把符号位为 1 的位型当成更大的非负整数。八位组端口仍然是 `0 .. 255`，不因本节变成补码。

#### 4.24.1 颗粒与总控

颗粒**必须**提供 `ReadInteger(OctetIndex, OctetWidth)` 与 `WriteInteger(OctetIndex, OctetWidth, IntegerValue)`。跨度**必须**整段落在该颗的八位组里。

颗粒上的检查顺序**必须**为：正式可用、宽度、跨度、值。失败标号依次为 `0x0007`、`0x0014`、`0x0015`、`0x0016`，类别**必须**为 `0x04`，记在该颗粒。失败时**禁止**改写跨度内的任何八位组。

总控上的同名方法第一个参数是 `UnitOrdinal`。先按 §4.19 检查序号。序号合法之后由颗粒记录自己的失败，总控**禁止**追加第二条。

#### 4.24.2 线性整数

总控**必须**提供 `ReadLinearInteger(LinearOctetIndex, OctetWidth)` 与 `WriteLinearInteger(LinearOctetIndex, OctetWidth, IntegerValue)`。跨度**可以**跨过颗粒边界，沿线性八位组流连续取值。

线性八位组 `i` 对应线性位元 `i×8`。每个落点的 `CellIndex` **必须**能被 `8` 整除。

线性读取的检查顺序是宽度，然后跨度。线性写入的检查顺序是宽度，然后值，然后跨度。宽度非法记 `0x0014`，值非法记 `0x0016`，跨度越出整机八位组或地址不是 §4.23 的值域时记 `0x0015`。这些记在总控，类别**必须**为 `0x04`。失败时存储体不变。跨度合法之后，按小端逐个八位组转交颗粒的 `ReadOctet` / `WriteOctet`。

### 4.25 块内八位组与块内整数（必选方法）

块内八位组 `BlockOctetIndex` 覆盖从位元偏移 `BlockOctetIndex×8` 起的连续 `8` 个位元。它存在，当且仅当 `(BlockOctetIndex+1)×8 ≤ BitLength`。窗口内偏移 `0` 是最低有效位，即使这段没有对齐颗粒的八位组边界。

内存块**必须**提供 `ReadOctet(BlockOctetIndex)` 与 `WriteOctet(BlockOctetIndex, OctetValue)`。

下标不能覆盖完整的 `8` 个位元时，向总控追加 `0x0017`，类别**必须**为 `0x04`，存储体不变。下标合法而值不是 `0`–`255` 的整数时，追加 `0x000B`，同样记在总控。检查顺序是下标，然后值。

块上的 `ReadInteger(BlockOctetIndex, OctetWidth)` 与 `WriteInteger(BlockOctetIndex, OctetWidth, IntegerValue)` 以块内八位组为步长，宽度与端序同 §4.24。检查顺序**必须**为：宽度、跨度、值。跨度越出完整八位组时记 `0x0015`，**禁止**改记成 `0x0017`。失败记在总控，存储体不变。写入前**必须**先确认跨度内每一个八位组都存在，禁止写到一半再失败。

### 4.26 浅切根所有权（必选 · `Owner` / `Claim` / `Release`）

所有权是硬件标记，**不是**端口锁。位元、八位组与整数端口**禁止**因为 `Owner` 而拒绝。

只有浅切根可以领取。内存块**必须**有字段 `Owner`，类型为 Uint32 或 `null`，初值为 `null`。子块的 `Owner` **必须**保持 `null`。

总控**必须**提供 `Claim(BlockIndex, Owner)` 与 `Release(BlockIndex, Owner)`。失败都记在总控，类别**必须**为 `0x04`。

- `BlockIndex` 不是浅切根下标时，追加 `0x0018`。存储体与 `Owner` 都不变。
- `Claim` 的主人参数不是 Uint32 时，追加 `0x001B`。
- `Claim` 时该根的 `Owner` 已经不是 `null` 时，追加 `0x0019`。存储体不变。
- `Claim` 成功时写入 `Owner`，**禁止**改存储体，并追加事件 `0x0007`。`Subject` 为 `BlockIndex`，`Detail` 为该主人。
- `Release` 的主人参数不是 Uint32，或该根的 `Owner` 为 `null` 时，追加 `0x001A`。
- `Release` 的主人与当前 `Owner` 不一致时，追加 `0x001B`。存储体与 `Owner` 都不变。
- `Release` 成功时，**必须**先把该浅切根位元跨度内的每一个位元写成 `0`，再把 `Owner` 写成 `null`，然后追加事件 `0x0008`。`Detail` 为归还时的主人。清零**禁止**走会追加端口异常的 `WriteBit` / `WriteOctet`。`Deepen` 得到的子块结构保留。

#### 4.26.1 不符合示例（本条）

- 子块的 `Owner` 被写成非 `null`；
- 已经领取的根，端口拒绝写入；
- 主人不一致时仍然把位元清零；
- `Release` 成功后 `Owner` 仍不是 `null`。

### 4.27 频率

每个实现有一个当前 Hz，以及已完成访问条数。发布时 Hz 由该实现自己选定，必须落在 `1` 至 `1000000000`。条数从 `0` 起。失败的访问不增加条数，也不推进时间。

`SetHertz(Hertz)` 把 Hz 改成新值，并重新记下时间起点。超出范围时必须失败，且不得改写已记下的 Hz。

`Metric(Kind)` 在 `Kind` 为 `0` 时返回当前 Hz，为 `1` 时返回已完成条数。别的 `Kind` 必须失败。

一次成功访问推进的拍数：字宽 `1` 或 `8` 是 `1` 拍，字宽 `16`、`32`、`64` 分别是 `2`、`4`、`8` 拍。`SetHertz` 与 `Metric` 各推进 `1` 拍。

到期时刻是本次频率起点 + 累计拍数 × 1000 / Hz 毫秒。一次访问只等待一次。已经错过的时间不补做。这不是处理器的 Hz，也不是面板刷新率。

#### 4.27.1 不符合示例（本条）

- 失败的访问仍然增加已完成条数；
- `SetHertz` 超出 `1` 至 `1000000000` 后仍然改写了已记下的 Hz；
- 把面板刷新率或处理器 Hz 当成内存 Hz。

### 4.28 有限浮点

总控必须提供 `ReadLinearFloat(LinearOctetIndex, OctetWidth)` 与 `WriteLinearFloat(LinearOctetIndex, OctetWidth, Value)`。`OctetWidth` 的封闭集合是 `4` 与 `8`。`4` 是二进制 32，`8` 是二进制 64。这不是可追加登记表。

位的安排：最高位是符号，`0` 为正、`1` 为负。二进制 32 接着 8 位指数，偏置 `127`，其余 23 位是尾数。二进制 64 接着 11 位指数，偏置 `1023`，其余 52 位是尾数。八位组顺序与 §4.24 相同。指数全 0 且尾数为 0 是有限数 0。指数全 1 不是有限数。

`Value` 必须是有限数，并且落在该格式能表示的有限范围内。超出或不是有限数时，失败标号用 `0x0016`，存储体不变。写入时先收成该宽度的补码位型，再按 §4.24 写入。读出时先按 §4.24 读出补码位型，再交回对应的有限数。同一位型用整数端口读出时，必须是这个补码整数。

## 5. 不符合示例（非穷尽）

下列情形**一律不符合 ZMP1**（示例用于消除常见钻空子说法）：

1. 使用字段名 `memory_id` / `MemId` / `MemoryID` 替代 `MemoryId`；
2. `ActiveProtocol = "zmp1"` 或 `"ZMP-1"`；
3. `MemoryIdByteLength = 128` 或未提供该常量；
4. `MemoryId` 长度为 256 但含有 `U+0021`–`U+007E` 以外的字符；
5. 以 256 个 NUL（`U+0000`）表示禁用；
6. `ShallowDimension = 0`、`UnitCount = -1`、`UnitSizeBytes = 1.5`；
7. 缺失 `TotalSizeBytes`，或使用 `TotalSize` / `total_size_bytes` 等非规范名冒充；
8. `TotalSizeBytes` 单位按 KiB/MiB 计数却仍用字段名 `TotalSizeBytes`；
9. 声明「初始化已完成且总容量有效」但 `TotalSizeBytes === 0`；
10. `MemoryVendor = ""` 或含空格 / 中文 / 表情符号；
11. 另设 `MemoryIdEnabled: false` 且 `MemoryId` 为非全零，却宣称「以布尔为准」；
12. 把 `TotalSizeBytes` 规定成 `UnitCount × UnitSizeBytes`，而不是各颗 `Cells.length` 之和；或在和小于 `1` 时仍然发布总控；
13. 声称「浅维度 × 深维度必须等于颗粒数」并把它当作 ZMP1 要求（本文未规定该公式）；
14. 报告内存异常时仅抛出字符串 / 原生 `Error`，或不含完整四属性的对象；
15. 使用属性名 `code` / `Category` / `message` 等替代 `ExceptionCode` / `ExceptionCategory` / `ExceptionSummary` / `ExceptionChain`；
16. `ExceptionCategory = 0x05` 或其它非五档取值；
17. `ExceptionSummary` 码点长度 ≥ 256；
18. `ExceptionChain = null` 或 `ExceptionChain = "trace"`；
19. 使用未登记标号并宣称其具有本文已定义的稳定业务含义（除 `0x0000 Unspecified` 外）；
20. 内存单元缺少 `InitState`，或 `InitState = 0x6` / 其它非六档取值；
21. 对单元执行任何操作前 `InitState !== 0x0`；或实例化期间 `InitState !== 0x1`；或实例化成功结束却非 `0x3`、失败结束却非 `0x2`（且非 `0x5`）；
22. 全部初始化完成后成功路径仍非 `0x4`，却宣称单元已正式可用；或在 `0x0` / `0x1` / `0x2` / `0x3` / `0x5` 时宣称正式可用；或将 `0x5` 宣称已恢复可用；
23. 内存单元缺失 `Events` / `Signals` / `Exceptions` 任一数组，或 `Exceptions` 中出现非合规 `MemoryException`，或 `Events` / `Signals` 中出现非 object 元素；
24. 缺失 `MachineMemory`，或初始化入口未以字段名 `MemoryInit` 挂在 `MachineMemory` 上；
25. 使用 `memoryInit` / `InitMemory` / `Bootstrap` 等非规范名冒充 §4.14 字段后声称兼容 ZMP1；
26. `MemoryController` 未挂在 `MachineMemory` 上，或使用 `MemCtrl` / `Controller` 等字段名却声称兼容 ZMP1；
27. `MemoryInit` 缺失方法 `Initialize`，或以 `init` / `Run` / `Bootstrap` 冒充后声称兼容 ZMP1；
28. 配置面缺失 `BitsPerByte`，或 `BitsPerByte = 16` / `1` 等非 `8` 取值后仍声称兼容 ZMP1；
29. `UnitSizeBytes = 0` 或 `UnitSizeBytes = 536870912`（展开后的位元数不能落入 Uint32）却声称颗粒大小合法；
30. 内存单元缺失 `Cells` 或 `CellCount`，或成功实例化后八位组未全为 `0`，或 `CellCount` 不等于 `UnitSizeBytes × 8`；
31. 把八位组的整数值当作位元取值，或把位偏移 `0` 定义为最高有效位后仍声称符合 §4.15；
32. 将 `InitState` 从 `0x3` 升为 `0x4` 时改写 `Cells` / `CellCount` / `UnitOrdinal`，或改写已建立的 `BitLength` / `Children`；
33. 把多八位组整数做成大端，把块内八位组的位偏移 `0` 当成最高有效位，或使用不同于 §4.20 的块跨度公式；
34. `Blocks` 的长度不等于 `ShallowDimension`，或 `BlockIndex` 不是从 `0` 起的连续升序；
35. 浅切完成后 `NestingDepth` 不是 `1`，或 `DeepDimension = 0` 仍声称浅切已完成；
36. 声称块数必须等于 `UnitCount` 或 `ShallowDimension × DeepDimension`，并把该公式当作 ZMP1 要求；
37. 内存单元缺少 `ReadBit` 或 `WriteBit`，或在 `InitState` 不是 `0x4` 时仍让端口成功；
38. `WriteBit` 改写了目标位以外的位元，或失败时没有把 `0x04` 类别的规定标号写入该单元 `Exceptions`；
39. `ReadBit` 失败时返回 `0` 或 `1` 表示失败；
40. 内存单元缺少 `ReadOctet` 或 `WriteOctet`，或 `WriteOctet` 改写了其它八位组；
41. 颗粒缺少 `UnitOrdinal`，或序号不是 `0 .. UnitCount-1` 各一次；
42. `UnitCount = 4294967297` 仍声称颗粒数量合法；
43. 总控缺少带 `UnitOrdinal` 的 `ReadBit` / `WriteBit` / `ReadOctet` / `WriteOctet`，或把这些方法改名后仍声称兼容；
44. `UnitOrdinal` 越界时仍改写存储体，或把 `0x000C` 记在颗粒上而不是总控上；
45. 序号合法且颗粒端口失败时，总控再为同一次失败追加第二条；
46. 块缺少 `BitLength`，跨度不按 §4.20 的 `floor` 公式，或长度大于 Uint32 仍完成浅切并把颗粒标成 `0x4`；
47. 声称「第 i 块等于第 i 颗颗粒」并把它当作 ZMP1 要求；
48. 浅切完成后 `Children` 非空，或 `NestingDepth` 已达 `DeepDimension` 时 `Deepen` 仍然成功；
49. `Deepen` 改变父块的 `NestingDepth` 或 `BitLength`，或子块数不等于 `ShallowDimension`；
50. 线性位元地址不按「更小序号的 `CellCount` 之和 + `CellIndex`」计算，或总控缺少 `ReadLinearBit` / `WriteLinearBit`；
51. `MemoryInit` 缺少 `Test`，或 `Test` 可以选择用例子集，或第一条失败后不再执行后续用例；
52. `Test` 把总控写入 `MachineMemory.MemoryController`；
53. `TestVerdict` 不是 `0x1` 时，`Initialize` 仍然发布了总控；
54. 放行失败时没有向 `MemoryInit.Exceptions` 追加 `0x0011`，或该条类别不是 `0x04`；
55. 总控已经发布之后再次 `Initialize` 又造出第二台总控；
56. 把官方标定的颗粒数、浅维度或深维度写成 §4.22 用例的通过条件；
57. `ExceptionChain` 存成数组，或 `Cause` 既不是 `null` 也不是四属性异常，仍当作合规异常报告；
58. `Events` 按标号覆盖旧条目，或 `Signals` 的 `Level` 使用布尔值；
59. 整数宽度接受 `1` 或 `3`，或 `WriteInteger` 失败时改写了跨度里的部分八位组；
60. 块内整数跨度越界时记成 `0x0017`，而不是 `0x0015`；
61. 端口因为 `Owner` 不是 `null` 而拒绝读写；
62. `Release` 成功后该浅切根的位元没有全部为 `0`，或 `Owner` 仍不是 `null`；
63. `Test` 改写了 `TotalSizeBytes` 或 `MemoryId`；
64. 发布之后再次 `Initialize` 又抽出另一条 `MemoryId`。
65. 失败的访问仍然增加已完成条数，或 `SetHertz` 超出范围后改写了已记下的 Hz；
66. `Metric` 的 `Kind` 不是 `0` 或 `1` 时仍返回一个数；
67. 把处理器 Hz 或面板刷新率当作内存 Hz。

---

## 6. 修订记录

| 版本 | 说明 |
|------|------|
| ZMP1 | 配置 / 异常对象形态 / 单元状态 / 侧信道数组 / §4.14 引导字段与最小方法 `Initialize`；专一文档见 README.md |
| ZMP1（修订） | `InitState` 追加 `0x5 Unrecoverable`；值域升为六档 `0x0`–`0x5`（见 InitStateRegistry） |
| ZMP1（修订） | 固化 `InitState` 主路径：操作前 `0x0` → 实例化中 `0x1` → 完成 `0x3`/`0x2` → 全部初始化完成 `0x4`；仅 `0x4` 正式可用 |
| ZMP1（修订） | 颗粒存储体：`BitsPerByte = 8`、`Cells` / `CellCount`、位元二值、位偏移 0 为最低有效位、成功则全 0；`UnitSizeBytes` 上界 `536870911`；阶段 D 禁止改写存储体。不规定读写方法 |
| ZMP1（修订） | 浅切：块数 = `ShallowDimension`；`Blocks` / `BlockIndex` / `NestingDepth`；初值深度 `1`，上限 `DeepDimension`。不规定块与颗粒或位元的对应，也不规定加深嵌套 |
| ZMP1（修订） | 颗粒内位元端口：`ReadBit` / `WriteBit`；仅 `0x4` 可成功；一次一个位元。失败标号 `0x0007`–`0x0009`，类别必须为 Abort，且不得改存储体 |
| ZMP1（修订） | 八位组端口 `ReadOctet` / `WriteOctet`；`UnitOrdinal` 与总控跨颗粒端口；块按 `floor` 均分位元线，`BitLength` 必须落入 Uint32；`Deepen` 一次加一层。失败标号 `0x000A`–`0x0010`。`UnitCount` 上界 `4294967296` |
| ZMP1（修订） | 初始化前测试：`MemoryInit.Test` 必须一次执行全部已登记用例；仅 `TestVerdict = 0x1` 才允许尚未发布的 `Initialize` 继续。失败标号 `0x0011`。用例见 TestCaseRegistry |
| ZMP1（修订） | 发布时 `TotalSizeBytes` 等于各颗 `Cells.length` 之和；`MemoryId` 从可打印 ASCII 拒绝采样抽出。线性位元地址、小端整数、块内八位组、浅切根 `Owner`。`ExceptionChain.Cause`。事件 `0x0001`–`0x0008`，信号 `0x0001`–`0x0003`。失败标号 `0x0012`–`0x001B`。用例顺序 13–18 |
| ZMP1（修订） | `MemoryController` 挂在 `MachineMemory` 上。调用 `MemoryInit` 的主机角色不在本协议内。内存实现禁止把总控写入其它子系统 |
| ZMP1（修订） | 内存有自己的 Hz。一次成功访问按字宽推进时间。`SetHertz` 改频率，`Metric` 读出 Hz 或已完成条数 |
| ZMP1（修订） | 宽度 2、4、8 的整数是补码。最高位为 1 时读出负数。增加二进制 32 与二进制 64 的有限浮点端口 |
