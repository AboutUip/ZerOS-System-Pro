---
name: coding-standards
description: >-
  Enforce ZerOS-System-Pro strict TypeScript coding standards: namespaces,
  PascalCase, subsystem subdirectory layout (Config/Enum/Structure/…),
  one-concern-per-file, deep Chinese comments, no invented APIs, Toolchain
  isolation, protocol-aligned types. Use when writing or reviewing ZerOS-PRO
  source; when the user mentions 规范编码, 目录整理, 独立文件, 枚举, 结构,
  注释不足, Hardware/Boot/Kernel, or Memory layout.
---

# ZerOS-PRO 规范编码

## 何时启用

- 在 `ZerOS-PRO/**` 新增或修改 TypeScript
- 用户提到规范编码、严格类型、命名空间、中文注释、目录整理、独立文件、未约定不实现
- 实现 Hardware / Boot / Kernel 等与 ZMP 协议对齐的模块
- 审查「文件是否散乱平铺、枚举/结构是否未剥离」

## 核心原则（不可妥协）

1. **未约定不实现**：用户未明确要求的 API（方法、参数、行为）禁止自行添加；宁可只留构造与字段。
2. **协议优先**：行为与字段名以 `Documents/Protocol/**` 为准；冲突时改代码对齐协议，禁止静默发明协议外语义。
3. **超严 TypeScript**：禁止 `any`、禁止非空断言滥用、禁止隐式不安全；提交前 `Toolchain` 下 `npm run check` 必须通过。
4. **注释必须中文且深入**：不仅文件头与成员说明；**必须**对模块分段、函数/方法内部关键步骤作教学级解释（见「注释与可教学性」）。
5. **命名空间分层**：产品代码挂在 `ZerOS.*` 命名空间；子系统根路径与命名空间对应（如 `ZerOS.Hardware.Memory` ↔ `Hardware/Memory/`）。子目录是**物理整理**，不强制加深命名空间层数（除非协议另有挂载面要求）。
6. **工具链隔离**：`package.json` / `node_modules` / `Dist` / Vite 仅在 `Toolchain/`；禁止污染 `ZerOS-PRO/`。
7. **一责一文件 + 按职责分目录**：**禁止**把枚举量、对象结构、工厂、类全部堆在同一文件或子系统根目录平铺；必须拆文件并落入对应子目录（见「目录与命名」）。
8. **虚拟硬件可插拔**：插座在主板上。内存经 ZVHP1 `MemorySlot` + 固定 `Hardware/Memory/ActiveProvider/` 目录替换；主板只导入该目录入口。Boot 只给主板通电，禁止为换内存实现而改 Boot 或主板源码路径。

## 目录与命名

| 对象 | 约定 |
|------|------|
| 产品源码根 | `ZerOS-PRO/` |
| 顶层分层 | `Boot/`、`Hardware/`、`Kernel/`、`System/`；文件夹 / 源文件 **PascalCase** |
| 子系统内部 | **必须**按职责分子目录；禁止在子系统根下散落十余个平级 `.ts` |
| 规范字段 / 对外属性 | PascalCase，与协议规范名逐字一致（如 `InitState`、`UnitSizeBytes`） |
| 协议标识字符串 | 精确匹配（如 `"ZMP1"`） |
| 编译产物与依赖 | 仅 `Toolchain/` |

### 子系统子目录通例（以 Memory 为权威范例 · 必须遵守）

路径：`ZerOS-PRO/Hardware/Memory/`  
命名空间：`ZerOS.Hardware.Memory`（协议字段名 `MachineMemory` 不变）。

| 子目录 | 职责 | 放什么 | 禁止放入 |
|--------|------|--------|----------|
| `Config/` | 配置面 | 协议配置常量与配置形状 | 运行时类、异常工厂 |
| `Enum/` | 枚举量 / 取值常量 | `BitValue`、`UnitInitState`、`ExceptionCategory`、`ExceptionCode` 等 | 接口结构体、业务类 |
| `Structure/` | 对象结构与纯工厂 | `MemoryEvent`、`MemorySignal`、`MemoryException`、`UnitIndexId`、`createMemoryException` | 总控/单元类 |
| `Unit/` | 颗粒单元 | `MemoryUnit` 类 | 总控、配置面 |
| `Block/` | 内存块 | `MemoryBlock`：浅切块、子块、`BitLength`、`Deepen`、块内位元端口 | 颗粒 `Cells`、总控、线性跨度公式（公式在 `Structure/BlockSpan`） |
| `Test/` | 初始化前测试 | 临时总控、各必选用例、`MemoryTestSuite` | 协议登记表正文、把总控发布到 `MachineMemory.MemoryController` |
| `Controller/` | 总控及其专用工具 | `MemoryController`、`FreezeUnitMap` | Init 门面、配置面 |
| `Bootstrap/` | 引导与对外门面 | `MachineMemory`、`MemoryInit` | 颗粒存储实现 |
| `Provider/` | 可插拔 Provider 包装 | `ReferenceMemoryProvider` | Slot 本体（在 `Hardware/Motherboard/Slot/`） |
| `ActiveProvider/` | **当前生效插头目录**（换实现只换此夹） | `Provider.ts` 导出 `ActiveMemoryProvider`、`ProviderManifest.json` | 禁止改导出名；主板只认此路径 |
| `Docs/` | **这一份实现的 API 文档** | 官方虚拟内存的调用说明（Markdown） | 协议正文、登记表、可执行代码。禁止把 `Docs/` 写成第二份 ZMP1 |

内存插座在主板上：`ZerOS-PRO/Hardware/Motherboard/Slot/`（ZVHP1：`MemorySlot.Bind` / `GetActive`）。主板固定，不可插拔。内核与系统不持有内存总控。

**规则：**

- 新增枚举 → **必须**进 `Enum/`（独立文件，一枚举或一组紧密常量一个文件）。
- 新增结构 / 接口 / 结构工厂 → **必须**进 `Structure/`。
- 新增类按角色进 `Unit/` / `Block/` / `Test/` / `Controller/` / `Bootstrap/` / `Config/` / `Provider/`，**禁止**回退到 `Memory/` 根目录。
- **替换社区内存实现（推荐）**：整体替换 `ActiveProvider/` 文件夹，保持 `Provider.ts` 与导出名 `ActiveMemoryProvider`；**禁止**为换实现而改主板或 `Boot.ts` 导入路径。
- 协议只有一份，放在 `Documents/Protocol/`。`Hardware/Memory/Docs/` 只描述本仓库这份官方虚拟内存实现的 API；其它实现不必沿用同名方法或同目录文档。主板说明在 `Hardware/Motherboard/Docs/`，那不是协议。
- 跨子目录引用使用相对路径（如 `../Enum/ExceptionCode`）。
- 其它硬件子系统（日后 CPU 等）**应**套用同构：`Config` / `Enum` / `Structure` / 主体角色目录。CPU 自己的协议出现后，由主板决定是否支持，并在主板文档里如实写下协议标识。

### 文件粒度

| 好 | 坏 |
|----|----|
| `Enum/ExceptionCode.ts` 只含标号常量 | 在 `MemoryUnit.ts` 内夹带 ExceptionCode + Event + Signal + 工厂 |
| `Structure/MemoryException.ts` 只含结构 + create 工厂 | 在 `MemoryController.ts` 内再定义一遍异常类型 |
| `Controller/MemoryController.ts` 只含总控类 | `Memory/` 根下十几份平级文件无子目录 |

## 文件头与代码组织

每个 `.ts` 文件顶部必须有中文文件头，至少包含：

- `@module` / `@description`
- **文件职责**（做什么、不做什么；可写明「枚举/结构已拆至某子目录」）
- **代码组织（严格优先级，自上而下，禁止打乱）** 编号列表

组织顺序推荐（按文件类型裁剪，不得无序堆放）：

1. 导入 / 依赖  
2. 协议相关类型与常量（若本文件仍需内联极少量子集）  
3. 配置或数据结构  
4. 类 / 主导出（仅约定成员）

单一职责文件（如纯 Enum）可只有：导入（若有）→ 类型/常量。

## TypeScript 与质量门禁

- 以 `Toolchain/tsconfig.json` 的 strict 全家桶为准（含 `noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`verbatimModuleSyntax` 等）。
- 以仓库根 `eslint.config.js` 为准：禁 `any`、禁 unsafe、禁 `@ts-ignore` / `@ts-nocheck`、要求显式返回类型等。
- **允许** `namespace`；ESLint 已对 `no-namespace` 关闭。
- 纯类型模块用 `import type`。结构文件只导出类型时，不要再加运行时锚点常量。
- 改完产品代码后在 `Toolchain` 执行：

```bash
npm run check
```

`build` 会先跑 `check`；禁止跳过检查提交。

## 实现边界（与用户协作）

| 情况 | 做法 |
|------|------|
| 用户只定数据结构 | 只实现字段 + 构造；不写 Read/Write 等方法；结构进 `Structure/` |
| 用户要求对齐 ZMP | 先读协议 / Registry，再写代码；字段名不得「近似」 |
| 需要报错形态 | `MemoryException` 四属性（见协议）；处理流程若协议未规定则勿写成协议强制 |
| 不确定 | 先复述边界并询问；禁止猜测实现 |

## 注释与可教学性

注释面向**教学与审查**：读者应能不靠作者口述理解「这段在整机中的位置、为何这样写、边界在哪」。

### 必须覆盖的三层

| 层级 | 要求 |
|------|------|
| **文件头** | `@module` / `@description`；文件职责（做什么 / 不做什么）；概念分层（若存在易混概念须写清）；代码组织编号列表 |
| **模块分段** | 按组织顺序用中文分隔注释标出片段；类内可再标 `4.1 字段` / `4.2 构造` / `4.3 私有方法` |
| **函数 / 方法内部** | 对关键步骤写**为何**；复杂流水线用 `(1)(2)(3)` 标明固定顺序 |

### 成员与类型

- `export type` / `const` / 字段 / 公开方法：均有中文说明（用途、值域、是否协议字段）。
- 辅助函数：说明不变性边界、参数语义、返回值约定。
- 与协议相关时：可引用 `ZMP1 §x.y` 或 Registry / Index 路径；**实现约定**须标明「非协议」。

### 禁止

- 空洞注释（如「给变量赋值」「返回结果」）。
- 仅文件头有注释、函数体内部「一片空白」却含多步逻辑。
- 英文-only 职责说明（标识符可英文，解释必须中文）。

### 错误信息

若约定可抛：前缀可定位模块，形如 `[ZerOS.Hardware.Memory.…]`。

### 参考范例

- 目录整理：`ZerOS-PRO/Hardware/Memory/{Config,Enum,Structure,Unit,Controller,Bootstrap}/`
- 深入注释：`ZerOS-PRO/Hardware/Memory/Controller/MemoryController.ts`

## 反例（禁止）

- 在 `ZerOS-PRO` 安装 npm 依赖或放入 `Dist`
- 使用 `memory_id` 替代协议字段 `MemoryId`
- 为「方便」导出一堆未约定 helper
- 英文-only 文件头、无组织顺序说明
- 函数/方法内部无步骤注释（逻辑非平凡时）
- **在 `Hardware/Memory/` 根目录平铺枚举/结构/类**，或不按 `Config|Enum|Structure|…` 归类
- **单文件塞满**枚举 + 多结构 + 类 + 工厂
- `as any`、`!` 非空断言连环、空 catch

## 交付自检

复制并勾选 [checklist.md](checklist.md)。未全部通过 → 禁止视为完成。

## 附加资源

- 自检清单：[checklist.md](checklist.md)
- 协议编写 Skill：[`../ProtocolDocumentAuthoring/SKILL.md`](../ProtocolDocumentAuthoring/SKILL.md)
- 内存协议范例：[`../../Protocol/PhysicalHardware/Memory/`](../../Protocol/PhysicalHardware/Memory/)
- 可插拔虚拟硬件协议：[`../../Protocol/PhysicalHardware/PluggableVirtualHardware/`](../../Protocol/PhysicalHardware/PluggableVirtualHardware/)
