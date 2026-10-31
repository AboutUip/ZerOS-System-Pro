# ZerOS-System-Pro

浏览器里的教学向虚拟机。分层可以拆开看，兼容性以协议为准，实现代码不是规范。

与 [ZerOS-System](https://github.com/AboutUip/ZerOS-System) 并存：前作侧重桌面；本仓库从引导走到硬件。1 号任务在 `ZerOS-PRO/System/`，shell 在 `ZerOS-PRO/Resource/App/sh/`，命令源码在 `ZerOS-PRO/Resource/Bin/`，客路径是 `/bin`。内核映像放在 NAS 的 `/kernel/`，由固件在倒计时结束时装到核心 2。

许可证：[GNU Affero GPL v3](./LICENSE)（AGPLv3）。

## 仓库地图

```
ZerOS-System-Pro/
├── ZerOS-PRO/
│   ├── Boot/                 # 固件源码：Logo、Bios、Load。上电在主板
│   ├── Kernel/               # 内核 .obr，编译进 NAS 的 /kernel/
│   ├── System/               # 用户态。Init 是 1 号，客路径 /kernel/init
│   ├── Resource/Font/        # 字体源。编译时拷到 NAS 的 /font，副本只读
│   ├── Resource/Bin/         # 命令源。编译时写成 NAS 的 /bin
│   ├── Resource/App/         # 应用程序源。sh 编成客路径 /os/sh
│   └── Hardware/             # 参考实现
│       ├── Motherboard/      # 主板、插座、上电入口
│       ├── Cpu/  Gpu/  Memory/
│       ├── Display/  Keyboard/  Pointer/  Sandbox/  Nas/
├── Driver/                   # Display、Gpu、Pointer。默认宽高在 Display/panel
├── Compiler/ObrCompiler/     # 宿主编译器，.obr → ZAP
├── Compiler/ObrExtension/    # 编辑器扩展，.obr / .mr / .zap
├── Toolchain/                # Vite、TypeScript、ESLint；不放产品源码
└── Documents/
    ├── Debug/                # 标准调试、观测设施与记录
    ├── Protocol/             # 对外协议，兼容性权威
    ├── Rules/                # 预览、内核语言、引导失败说明
    └── Skills/               # 协议写作、编码规范与 Obr 语法
```

各硬件目录里的 `Docs/` 只描述这一份官方实现。`ActiveProvider/` 是当前插头，换实现只换这个目录。

## 预览

需要 Node.js（建议 LTS）。在 `Toolchain` 里：

```bash
npm install
npm run dev
```

页面只开 [http://localhost:5173/](http://localhost:5173/)。Vite 锁死这个端口；端口被占用时先结束占用进程，再启动，不要改到别的端口。

开发服会调用本机的宿主编译器。需要 C++20。Windows 上是 `Compiler/ObrCompiler/obrc.exe`，其它系统是 `Compiler/ObrCompiler/obrc`。CMake 把这个可执行文件直接写到 `Compiler/ObrCompiler/`，不写进 `build/` 子目录。先编出这个文件，再启动预览。

```bash
cmake -S Compiler/ObrCompiler -B Compiler/ObrCompiler/build
cmake --build Compiler/ObrCompiler/build
```

| 命令 | 作用 |
|------|------|
| `npm test` | 协议页眉、目录索引、技能副本、本机路径、编译器输出路径 |
| `npm run check` | 类型检查 + Lint |
| `npm run build` | 校验后产出到 `Toolchain/Dist/` |

开发服的根是 `ZerOS-PRO/Hardware/Display`。引导在页面里给主板通电，再把启动画面和固件交给 CPU。浏览器包里没有内核映像，也没有 `System/` 里的用户态映像。这两份都在 NAS 上。

`ZerOS-PRO/Hardware/Nas/Root` 是客路径 `/`，整目录不进版本库。`node ZerOS-PRO/Hardware/Nas/Server/build-guest.mjs` 编译并写出 `/kernel`、`/os` 和 `/bin`，再调用 `provision.mjs` 把 `Resource/Font` 拷到 `/font` 并标成只读。`/boot/display` 和 `/boot/debug` 只在缺文件时写下驱动默认值，之后保持可写：BIOS 和驱动可以改，重编不覆盖。

`Toolchain/Zap` 是上电固件，不进版本库，也不进 NAS。`Logo` 在探针之前跑完并停机。`Bios` 留在核心 0。`Load` 按核心 3 的槽编译，倒计时结束后才读 `/kernel/start`。三份要同时在，不能合成一个文件。旁边只留 `.debug` 给失败帧，不写 `.zap`。

## 协议

第三方从 [Documents/Protocol](./Documents/Protocol/README.md) 进入，只读协议文本即可判定是否兼容。登记表优先于索引，索引优先于正文里的摘要。封闭数值留在正文里。

| 协议 | 管什么 | 索引 |
|------|--------|------|
| **ZMP1** | 内存 | [Memory](./Documents/Protocol/PhysicalHardware/Memory/README.md) |
| **ZVHP1** | 可插拔插座 | [PluggableVirtualHardware](./Documents/Protocol/PhysicalHardware/PluggableVirtualHardware/README.md) |
| **ZCP1** | CPU 与 ZAP | [Cpu](./Documents/Protocol/PhysicalHardware/Cpu/README.md) |
| **ZGP1** | 显卡 | [Gpu](./Documents/Protocol/PhysicalHardware/Gpu/README.md) |
| **ZDP1** | 显示器 | [Display](./Documents/Protocol/PhysicalHardware/Display/README.md) |
| **ZKP1** | 键盘（7 字 + 关联号） | [Keyboard](./Documents/Protocol/PhysicalHardware/Keyboard/README.md) |
| **ZPP1** | 鼠标（7 字 + 关联号） | [Pointer](./Documents/Protocol/PhysicalHardware/Pointer/README.md) |
| **ZXP1 / ZXD1** | 扩展口与交换 | [Expansion](./Documents/Protocol/PhysicalHardware/Expansion/README.md) |
| **ZSP1** | 沙盒 | [Sandbox](./Documents/Protocol/PhysicalHardware/Sandbox/README.md) |
| **ZNP1** | NAS | [Nas](./Documents/Protocol/PhysicalHardware/Nas/README.md) |

## 参考实现现在在哪

| 层 | 位置 | 现在 |
|----|------|------|
| 引导 | `ZerOS-PRO/Boot/` | 固件源码。启动画面、设置和装入程序。页面从主板 `FirmwarePower.ts` 通电 |
| 主板 | `Hardware/Motherboard/` | 插座、查询、扩展口 |
| CPU / GPU / 内存 | 同名目录 | 官方插头在各自的 `ActiveProvider/` |
| 显示器 / 键盘 / 鼠标 / 沙盒 / NAS | 同名目录 | 显示器不经插座；键盘、鼠标、沙盒和 NAS 坐在扩展口上。NAS 进程要单独启动 |
| 驱动 | `Driver/` | 显示器默认宽高在 `Display/panel`。`Gpu/` 是固件调用的 OpenGL 切片 |
| 语言 | `Compiler/ObrCompiler/` | 默认只写无扩展名二进制。`-zap` 才另写文本对照。语法见 [编译器说明](./Compiler/ObrCompiler/README.md) |
| 编辑器 | `Compiler/ObrExtension/` | `.obr`、`.mr`、`.zap` 的着色和诊断。诊断调用旁边的 `obrc` |
| 内核 | `Kernel/` | 入口 `/kernel/start`，常驻核心 2。文件在内核里。`/kernel/drv` 里的驱动从核心 4 起装入 |
| 系统 | `System/`、`Resource/App/`、`Resource/Bin/` | `Init/init.obr` 是 pid 1，客路径 `/kernel/init`。`App/sh` 编成 `/os/sh`。`Bin/` 编成 `/bin`，第一条是 `pwd` |

设置画面可以改显示器宽高和调试开关，分别写进 `/boot/display` 和 `/boot/debug`。其余行只展示查询得到的状态。内核由固件在倒计时结束时装入，不从设置画面进入。

## 换插头

内存的步骤写在 [ActiveProvider/README](./ZerOS-PRO/Hardware/Memory/ActiveProvider/README.md)：整体替换该目录，保留 `Provider.ts` 和导出名。主板从固定路径导入，不要改上电入口 `Hardware/Motherboard/Bootstrap/FirmwarePower.ts`。

CPU、GPU、键盘、鼠标、沙盒、NAS 同样各有一个 `ActiveProvider/`。换哪一块就换哪一个目录。

NAS 的参考服务不随页面启动。在仓库根目录执行 `node ZerOS-PRO/Hardware/Nas/Server/serve.mjs`。客路径 `/` 是 `ZerOS-PRO/Hardware/Nas/Root`，这棵树不进版本库。进程没起来时，引导仍然成功，交换返回未就绪。

## 技能

| 技能 | 权威源 | 用来 |
|------|--------|------|
| 协议文档 | [Documents/Skills](./Documents/Skills/README.md) | 写和审 `Documents/Protocol/` |
| 编码规范 | 同上 | 写 `ZerOS-PRO/` |
| Obr 语法 | [Documents/Skills/ObrLanguage](./Documents/Skills/ObrLanguage/SKILL.md) | 改编译器表面，或写 `.obr` / `.mr` |
| 项目规则 | [Documents/Rules](./Documents/Rules/) | 预览端口、内核语言、引导失败说明 |
| 标准调试 | [Documents/Debug](./Documents/Debug/README.md) | 性能复现、观测、回归与记录 |

Cursor 从 `.cursor/skills/` 和 `.cursor/rules/` 加载。这两处是本地链接，正文只在 `Documents/Skills/` 和 `Documents/Rules/`。克隆后在 `Toolchain` 执行 `npm run skills:sync` 接上链接。`npm test` 确认链接指向这两处。

## 相关链接

- 本仓库：https://github.com/AboutUip/ZerOS-System-Pro
- 前作 ZerOS-System：https://github.com/AboutUip/ZerOS-System
