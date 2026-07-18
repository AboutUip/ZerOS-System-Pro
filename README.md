# ZerOS-System-Pro

浏览器里的**教学向虚拟操作系统**：模拟更深、分层更清晰，强调可观察的底层与协议契约。

与 [ZerOS-System](https://github.com/AboutUip/ZerOS-System) 并存：ZerOS 侧重桌面体验；本仓库侧重 Boot → Machine → Kernel 的可拆解教学内核。

许可证：[GNU Affero GPL v3](./LICENSE)（AGPLv3）。

## 仓库结构

```
ZerOS-System-Pro/
├── ZerOS-PRO/          # 产品源码（严格 TypeScript）
│   ├── Boot/           # 引导：绑定 ActiveProvider → 初始化
│   ├── Kernel/         # 内核挂载点
│   └── Machine/        # 虚拟硬件
│       ├── Memory/     # 内存子系统（ZMP1 参考实现）
│       └── Slots/      # 可插拔插座（ZVHP1）
├── Toolchain/          # Vite / TypeScript / ESLint（与产品树分离）
├── Documents/          # 协议与 Agent Skills（权威文档）
└── LICENSE
```

## 快速开始

需要 Node.js（建议 LTS）。

```bash
cd Toolchain
npm install
npm run dev
```

其它脚本：

| 命令 | 作用 |
|------|------|
| `npm run check` | 类型检查 + Lint |
| `npm run build` | 校验后产出到 `Toolchain/Dist/` |

入口：`Toolchain/index.html` → `@ZerOS-PRO/Boot/Boot`。

## 协议文档

兼容性以 `Documents/Protocol/` 为准，实现代码不是规范来源。

| 协议 | 说明 | 索引 |
|------|------|------|
| **ZMP1** | 内存配置、单元、异常、引导门面 | [PhysicalHardware/Memory](./Documents/Protocol/PhysicalHardware/Memory/README.md) |
| **ZVHP1** | 虚拟硬件可插拔（Slot / Provider） | [PluggableVirtualHardware](./Documents/Protocol/PhysicalHardware/PluggableVirtualHardware/README.md) |

## 替换内存实现（无需改 Boot）

1. 准备符合 ZVHP1 + ZMP1 的实现，导出 `ZerOS.Machine.Memory.ActiveMemoryProvider`。
2. **整体替换**目录 `ZerOS-PRO/Machine/Memory/ActiveProvider/`（保留 `Provider.ts` 文件名与导出名）。
3. 重新构建 / 刷新即可。

详见该目录 [README](./ZerOS-PRO/Machine/Memory/ActiveProvider/README.md) 与 ZVHP1 §4.7。

## Agent Skills

项目级 Skills 权威源在 [`Documents/SKILLS/`](./Documents/SKILLS/README.md)（协议文档写作、ZerOS-PRO 编码规范）。Cursor 通过本地 `.cursor/skills/` junction 挂载，该目录不入库。

## 当前进度

- 已落地：ZMP1 内存参考实现、ZVHP1 Memory Slot、`ActiveProvider` 文件夹替换约定、Boot 最小引导。
- 规划中：更多 Machine 子系统（如 CPU）、可观察教学面、内核与用户态教学子集。

## 相关链接

- 本仓库：https://github.com/AboutUip/ZerOS-System-Pro
- 前作 ZerOS-System：https://github.com/AboutUip/ZerOS-System
