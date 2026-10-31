# 浏览器功能验证记录

本页保留早期有限功能冒烟。当前严格复核发现O1/O2管道路径新增native fault，阻断合并；最新39例、信号/设备证据及失败统计以 [Benchmark.md](Benchmark.md) 和 [Integration.md](Integration.md) 为准。本页不能作为最终验收完成依据。

日期：2026-10-30。Codex 内置浏览器；功能冒烟，非计时基准。生产构建使用未修改的 CPU、主板、GPU、内核、NAS 和协议。NAS 端口 8765，临时测试预览 O1 为 5274、O2 为 5282；O2 完成后恢复默认 O1。测试页刷新会销毁并重建虚拟机，不是重启 NAS。

## 最终产物与步骤

先用最终候选默认参数执行 `build-guest.mjs`、NAS `check.mjs`、`skills:sync`、`npm test` 与 `npm run build`。59 个生成程序逐字节等于 benchmark O1，见 [O1 哈希清单](measurements/artifacts-O1.json)。

为验证 O2，在忽略的临时目录保存 O1 NAS/Dist，临时用宿主编译器包装器追加 `-O2` 和原 lib 搜索路径，再用完全相同的生产脚本重建。保存独立 O2 NAS/Dist 后恢复原编译器，最终重新构建 O1 前端并核对 59 个 NAS 程序。两个级别的产品源码没有差异；[O2 哈希清单](measurements/artifacts-O2.json)逐字节对应 benchmark O2。

| 路径 | 操作 | 观察结果 | 证据 |
|---|---|---|---|
| O1 完整启动 | 新打开生产预览 | 到 `root@zeros:/#` | [pwd](measurements/screenshots/final-O1-pwd.png) |
| O1 pwd | 冷启动后输入 `pwd` | `/`，返回提示符 | [截图](measurements/screenshots/final-O1-pwd.png) |
| O1 ls | 重新冷启动，输入 `ls` | bin/boot/font/kernel/os，返回提示符 | [截图](measurements/screenshots/final-O1-ls.png) |
| O1 NAS 写 | 冷启动，`echo compiler-ok > /boot/optimizer-check` | 返回提示符，宿主实际文件为 12 B `compiler-ok` + LF | [截图](measurements/screenshots/final-O1-write.png) |
| O1 NAS 读 | 冷启动，`cat /boot/optimizer-check` | `compiler-ok` | [截图](measurements/screenshots/final-O1-cat.png) |
| O1 grep | 冷启动，`grep compiler /boot/optimizer-check` | `compiler-ok`，返回提示符 | [截图](measurements/screenshots/final-O1-grep.png) |
| O2 完整启动和 NAS 读 | 新打开 O2 生产预览，输入同一 cat | `compiler-ok`，返回提示符 | [截图](measurements/screenshots/final-O2-cat.png) |
| O2 BIOS 键盘入口 | 刷新，在启动期按 F12 | OVERVIEW 显示 CPU/Memory/GPU 数据 | 随后同一实例的 BIOS 截图 |
| O2 BIOS 鼠标 | 点击左侧 CPU | CPU 页，8 核、8 寄存器、核心状态 | [截图](measurements/screenshots/final-O2-bios-cpu.png) |
| O2 BIOS 方向键 | CPU 左侧焦点按 Down | GPU 页，640×480、ZGP1、命令数 | [截图](measurements/screenshots/final-O2-bios-gpu.png) |
| O2 BIOS 显示设备 | 点击 Display | 640×480、60 Hz 配置、Native 比例 | [截图](measurements/screenshots/final-O2-bios-display.png) |
| O2 退出 BIOS | 按 Escape | 继续启动到 shell 提示符 | [截图](measurements/screenshots/final-O2-after-bios.png) |

截图保留实际浏览器视口，部分窄视口的命令右半边被截断；输入的完整命令列在表内。O1 cat 截图末尾还出现后续 ls/cd 输出，这些未计入通过项。Display 的 60 Hz 是配置值，不能证明实际达到 60 FPS；此次没有输入到显示延迟或帧率统计。

## 原始基线也存在的连续命令问题

以完全冻结的原始 NAS 与 Dist 启动，依次 `echo alpha`、`echo beta`，第二条仍输出 alpha。候选一致的固件/内核/NAS 也如此。该异常在原始程序已存在，不能作为本次编译器变更引入回归的证据，也不能写成已修复。

| 原始基线 | 候选 |
|---|---|
| [frozen-baseline-stale-argv.png](measurements/screenshots/frozen-baseline-stale-argv.png) | [consistent-candidate-stale-argv.png](measurements/screenshots/consistent-candidate-stale-argv.png) |

因此表内各文件命令分别冷启动验证。连续命令参数更新、其唯一根因及系统层修复仍是独立问题，本交付未修改它。浏览器冒烟不能替代真实工作负载动态计数、NAS 请求全序列差分、像素黄金或 boot-to-shell 五次中位数。
