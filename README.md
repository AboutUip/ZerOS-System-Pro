# ZerOS-System-Pro

浏览器里的教学向虚拟机。分层可以拆开看，兼容性以协议为准，实现代码不是规范。

与 [ZerOS-System](https://github.com/AboutUip/ZerOS-System) 并存：前作侧重桌面；本仓库从引导走到硬件。用户态在 `ZerOS-PRO/System/`：1 号任务和会话。内核映像放在 NAS 的 `/kernel/`，由固件在倒计时结束时装到核心 2。

许可证：[GNU Affero GPL v3](./LICENSE)（AGPLv3）。

## 仓库地图

```
ZerOS-System-Pro/
├── ZerOS-PRO/
│   ├── Boot/                 # 通电、启动画面、F12 进入设置
│   ├── Kernel/               # 内核 .obr，编译进 NAS 的 /kernel/
│   ├── System/               # 用户态。Init 是 1 号，Session 是 /os/session
│   └── Hardware/             # 参考实现
│       ├── Motherboard/      # 主板与插座
│       ├── Cpu/  Gpu/  Memory/
│       ├── Display/  Keyboard/  Sandbox/  Nas/
├── Driver/Gpu/               # OpenGL 切片驱动（.mr 头 + .obr 体）
├── Compiler/Obr/             # 宿主编译器，.obr → ZAP
├── Toolchain/                # Vite、TypeScript、ESLint；不放产品源码
└── Documents/
    ├── Protocol/             # 对外协议，兼容性权威
    └── SKILLS/               # 协议写作与编码规范的技能源
```

各硬件目录里的 `Docs/` 只描述这一份官方实现。`ActiveProvider/` 是当前插头，换实现只换这个目录。

## 预览

需要 Node.js（建议 LTS）。在 `Toolchain` 里：

```bash
npm install
npm run dev
```

页面只开 [http://localhost:5173/](http://localhost:5173/)。Vite 锁死这个端口；端口被占用时先结束占用进程，再启动，不要改到别的端口。

开发服会调用本机的宿主编译器。Windows 上是 `Compiler/Obr/obrc.exe`，其它系统是 `Compiler/Obr/obrc`。先在当前系统用 C++20 编出这个文件，再启动预览。

| 命令 | 作用 |
|------|------|
| `npm run check` | 类型检查 + Lint |
| `npm run build` | 校验后产出到 `Toolchain/Dist/` |

开发服的根是 `ZerOS-PRO/Hardware/Display`。引导在页面里给主板通电，再把启动画面和固件交给 CPU。浏览器包里没有内核映像，也没有 `System/` 里的用户态映像。这两份都在 NAS 上。

## 协议

第三方只读 `Documents/Protocol/`。登记表优先于索引，索引优先于正文里的摘要。封闭数值留在正文里。

| 协议 | 管什么 | 索引 |
|------|--------|------|
| **ZMP1** | 内存 | [Memory](./Documents/Protocol/PhysicalHardware/Memory/README.md) |
| **ZVHP1** | 可插拔插座 | [PluggableVirtualHardware](./Documents/Protocol/PhysicalHardware/PluggableVirtualHardware/README.md) |
| **ZCP1** | CPU 与 ZAP | [Cpu](./Documents/Protocol/PhysicalHardware/Cpu/README.md) |
| **ZGP1** | 显卡 | [Gpu](./Documents/Protocol/PhysicalHardware/Gpu/README.md) |
| **ZDP1** | 显示器 | [Display](./Documents/Protocol/PhysicalHardware/Display/README.md) |
| **ZKP1** | 键盘 | [Keyboard](./Documents/Protocol/PhysicalHardware/Keyboard/README.md) |
| **ZXP1 / ZXD1** | 扩展口与交换 | [Expansion](./Documents/Protocol/PhysicalHardware/Expansion/README.md) |
| **ZSP1** | 沙盒 | [Sandbox](./Documents/Protocol/PhysicalHardware/Sandbox/README.md) |
| **ZNP1** | NAS | [Nas](./Documents/Protocol/PhysicalHardware/Nas/README.md) |

## 参考实现现在在哪

| 层 | 位置 | 现在 |
|----|------|------|
| 引导 | `ZerOS-PRO/Boot/` | 启动画面，F12 进入三栏设置 |
| 主板 | `Hardware/Motherboard/` | 插座、查询、扩展口 |
| CPU / GPU / 内存 | 同名目录 | 官方插头在各自的 `ActiveProvider/` |
| 显示器 / 键盘 / 沙盒 / NAS | 同名目录 | 显示器不经插座；键盘、沙盒和 NAS 坐在扩展口上。NAS 进程要单独启动 |
| 驱动 | `Driver/Gpu/` | 固件调用的 OpenGL 切片 |
| 语言 | `Compiler/Obr/` | 默认交出无扩展名二进制。同一次编译另写 `.zap` 供对照。语法见 [编译器说明](./Compiler/Obr/README.md) |
| 内核 | `Kernel/` | 入口 `/kernel/start`，常驻核心 2。文件在内核里。`/kernel/drv` 里的驱动从核心 4 起装入 |
| 系统 | `System/` | `Init/init.obr` 是 pid 1，客路径 `/kernel/init`。`Session/session.obr` 客路径 `/os/session` |

设置画面只展示查询得到的状态，不改配置。内核由固件在倒计时结束时装入，不从设置画面进入。

## 换插头

内存的步骤写在 [ActiveProvider/README](./ZerOS-PRO/Hardware/Memory/ActiveProvider/README.md)：整体替换该目录，保留 `Provider.ts` 和导出名。主板从固定路径导入，不要改 `Boot/Boot.ts`。

CPU、GPU、键盘、沙盒、NAS 同样各有一个 `ActiveProvider/`。换哪一块就换哪一个目录。

NAS 的参考服务不随页面启动。在仓库根目录执行 `node ZerOS-PRO/Hardware/Nas/Server/serve.mjs`。客路径 `/` 是 `ZerOS-PRO/Hardware/Nas/Root`。进程没起来时，引导仍然成功，交换返回未就绪。

## 技能

| 技能 | 权威源 | 用来 |
|------|--------|------|
| 协议文档 | [Documents/SKILLS](./Documents/SKILLS/README.md) | 写和审 `Documents/Protocol/` |
| 编码规范 | 同上 | 写 `ZerOS-PRO/` |
| Obr 语法 | [`.cursor/skills/obr-language`](./.cursor/skills/obr-language/SKILL.md) | 改编译器表面，或写 `.obr` / `.mr` |

Cursor 从 `.cursor/skills/` 加载。协议与编码规范以 `Documents/SKILLS/` 为准；Obr 语法以仓库里的那份技能为准。

## 相关链接

- 本仓库：https://github.com/AboutUip/ZerOS-System-Pro
- 前作 ZerOS-System：https://github.com/AboutUip/ZerOS-System
