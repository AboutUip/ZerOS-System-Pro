# ZerOS-System-Pro

浏览器里的教学向虚拟机。分层可以拆开看，兼容性以协议为准，实现代码不是规范。

与 [ZerOS-System](https://github.com/AboutUip/ZerOS-System) 并存：前作侧重桌面；本仓库从引导走到硬件，内核和系统层还是空的挂载点。

许可证：[GNU Affero GPL v3](./LICENSE)（AGPLv3）。

## 仓库地图

```
ZerOS-System-Pro/
├── ZerOS-PRO/
│   ├── Boot/                 # 通电、启动画面、F12 进入设置
│   ├── Kernel/               # 空命名空间
│   ├── System/               # 空命名空间
│   └── Hardware/             # 参考实现
│       ├── Motherboard/      # 主板与插座
│       ├── Cpu/  Gpu/  Memory/
│       ├── Display/  Keyboard/  Sandbox/
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

开发服的根是 `ZerOS-PRO/Hardware/Display`。引导在页面里给主板通电，再把启动画面和固件交给 CPU。`Kernel` 与 `System` 不参与这一段。

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

## 参考实现现在在哪

| 层 | 位置 | 现在 |
|----|------|------|
| 引导 | `ZerOS-PRO/Boot/` | 启动画面，F12 进入三栏设置 |
| 主板 | `Hardware/Motherboard/` | 插座、查询、扩展口 |
| CPU / GPU / 内存 | 同名目录 | 官方插头在各自的 `ActiveProvider/` |
| 显示器 / 键盘 / 沙盒 | 同名目录 | 显示器不经插座；键盘和沙盒坐在扩展口上 |
| 驱动 | `Driver/Gpu/` | 固件调用的 OpenGL 切片 |
| 语言 | `Compiler/Obr/` | 默认交出无扩展名二进制。同一次编译另写 `.zap` 供对照。语法见 [编译器说明](./Compiler/Obr/README.md) |
| 内核 / 系统 | `Kernel/`、`System/` | 空命名空间，还没有进程和用户态 |

设置画面只展示查询得到的状态，不改配置，也不进入内核。

## 换插头

内存的步骤写在 [ActiveProvider/README](./ZerOS-PRO/Hardware/Memory/ActiveProvider/README.md)：整体替换该目录，保留 `Provider.ts` 和导出名。主板从固定路径导入，不要改 `Boot/Boot.ts`。

CPU、GPU、键盘、沙盒同样各有一个 `ActiveProvider/`。换哪一块就换哪一个目录。

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
