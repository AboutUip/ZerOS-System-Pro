# Compiler BuildSystem

`Compiler/Obr` 的宿主编译器构建入口，以及 ISO 安装盘构建。构建相关的东西都收在这里；语言编译器源码仍在 `../Obr`，不在这里改。

## 边界

- `../Obr` 的源码和 `CMakeLists.txt` 保持原样。
- CMake 生成物只在 `build/<preset>/`。
- `obrc` 仍按仓库既有约定写到 `../Obr/obrc.exe`（Linux 是 `../Obr/obrc`），因为 `vite.config.ts` 固定从这个位置取编译器。
- `native-encode-check` 和冒烟测试产物留在 `build/<preset>/`。
- ISO 安装盘在 `Installer/`：构建脚本、preseed、目标安装脚本；`Installer/work/` 和 `Installer/out/` 是生成物。

## 要求

- CMake 3.25 或更高（`CMakePresets.json` 版本 6）。
- Ninja。
- Windows：MinGW-w64 的 `c++.exe` 在 `PATH` 中（当前用 Strawberry GCC 13 验证）。
- Linux / WSL：`c++` 在 `PATH` 中（Debian 的 `g++` 即可）。
- C++20。

## 一条命令

Windows：

```powershell
.\build.ps1
```

如果执行策略拦截：

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1
```

Linux / WSL：

```bash
./build.sh
```

如果检出目录没有执行位，用 `bash build.sh`。

两者都会依次执行 configure、build、ctest，成功后打印：

```text
Preset:  windows-mingw
Build:   build/windows-mingw
obrc:    ../Obr/obrc.exe
```

## 选项

| 用途 | Windows | Linux / WSL |
|------|---------|-------------|
| 指定预设 | `-Preset windows-mingw` | `--preset linux-gcc` |
| 清掉该预设的 build 目录再构建 | `-Clean` | `--clean` |
| 丢弃 CMake 缓存后重新配置 | `-Fresh` | `--fresh` |
| 只构建，不跑测试 | `-NoTest` | `--no-test` |

`-Clean` / `--clean` 只删除 `build/<preset>/`，不会碰 `../Obr` 源码。

## 预设

| 预设 | 平台 | 状态 |
|------|------|------|
| `windows-mingw` | Windows + Ninja + `c++.exe` | 已验证（Strawberry GCC 13.2） |
| `linux-gcc` | Linux / WSL + Ninja + `c++` | 已验证（WSL Debian 13 / GCC 14.2） |

当前没有 `windows-msvc` 预设：本机的 Visual Studio 2022 安装注册状态异常，`vswhere` 返回空，CMake 找不到实例。Windows 支持路径先固定为 MinGW。

## 测试

- `native-encode-check`：原生编码样例自检。
- `obrc-smoke`：实际编译 `../Obr/examples/arith.obr`，确认能产出程序映像。

## 不使用绝对路径

- 脚本用 `$PSScriptRoot` / `dirname` 定位自己。
- CMake 用 `../Obr` 和 `${sourceDir}` 宏。
- 编译器从 `PATH` 找 `c++.exe` / `c++`。
- `windows-mingw` 把 `TMP` / `TEMP` 指向 `build/`，避开中文用户名路径导致的 MinGW 汇编临时文件失败。
