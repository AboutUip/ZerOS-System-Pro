# 网卡驱动

网卡硬件在 `ZerOS-PRO/Hardware/Nic/`，设备协议是 [ZNC1](../../Documents/Protocol/PhysicalHardware/Nic/ZNC1.md)。

扩展口只能由监督核访问，所以核心驱动不能做成 `/kernel/drv` 里的客核心任务。这里分成两份产物：

| 源 | 产物 | 作用 |
|----|------|------|
| `niccore.obr` | 链接进 `/kernel/start` | 在监督核上执行 `xchg` / `offer` / `carry`，把原始帧搬给扩展口 |
| `niclib.obr` | `/lib/nic.zdll` | 用户程序导入 `nic` 时装入；只填窗口并发系统调用 |
| `nic.mr` | 编译器头 | `nic::probe`、`send`、`recv`、`selfCheck`、`info`、`configure` |

## 系统调用

| 号 | 作用 |
|----|------|
| 41 | 探测网卡。`+128` 状态，`+192` 帧上界，`+256` 队列深度，`+320` 线的种类 |
| 42 | 发送一帧。`+192` 地址，`+128` 长度。成功回复 0，失败回复负数状态 |
| 43 | 接收一帧。`+192` 地址，`+128` 容量。成功回复帧长，失败回复负数状态；`-1` 是空 |
| 44 | 本地自检。不访问网络 |
| 45 | 配置线。`+128` 是控制字。第一个八位组 0 读能力，1 配置线；配置线时第二个八位组 0 是回环、1 是 UDP，接着 4 个八位组 IPv4，再接着 2 个八位组端口。返回状态 |

`nic::recv` 返回负数时是状态的相反数，不是帧长。`-1` 是空，`-2` 是未就绪，`-5` 是 I/O，`-7` 是参数不合法。

`nic::configure(mode, address, port)` 是驱动选线：`mode` 0 回环，1 UDP；`address` 是 IPv4 的 32 位值，`port` 是 16 位端口。回环忽略后两项。Rust 不替驱动选线，也不因为某条线不可用而改走另一条。

## 现在有什么

这一版是占位核心驱动：它只验证控制字、帧上界和扩展口通路。TCP/IP、ARP、路由、重传、拥塞控制和 socket 表都还没有写，之后全部由这里的 Obr 驱动从零搭建。Rust 侧不替驱动做任何网络决策。

客人侧自检程序在 `ZerOS-PRO/Resource/App/nic/nic.obr`，编成客路径 `/app/nic`。在 shell 里运行 `/app/nic`：它先把线配成 loopback，再发一帧原始以太网报文并收回来逐字节比较。

## 热驱动 `.zo`

`Driver/Nic/niczo.obr` 编成 `/drivers/nic-v1.zo` 和 `/drivers/nic-v2.zo`。`.zo` 是**标准的 `-flat` Obr PIE**：栈、静态区、堆都在 512KiB 任务窗口内；版本放在文件名里。装入走内核服务 46（`spawnFlat`），不再直接用 `spawn`：

- 内核从客核 3–7 的低 8MiB / 高 17–32MiB 空洞里分配 512KiB 窗口；
- 先 `bound` 再 `install`，数据按 `windowOrigin - DataFloor` 重定位；
- `niczo.obr` 是**自包含**驱动，直接发服务 45/41，不挂 zdll；
- 需要库 API 的 flat 程序用 `/lib/nicflat.zdll`；旧 `/lib/nic.zdll` 仍是旧布局，给 `/app/nic` 用。

驱动通过内核驱动 ABI 使用网卡（服务 45 配线、41 探测），不直接执行特权指令。热替换的 restart 路径是“停旧实例 → 新实例”；状态交接（handover）和带元数据的清单留给下一版。

实测：`/app/flatnic`（服务 46 装 `/drivers/nic-v1.zo`）进入 `main` 后出现 `svc 41` 与 `port 1 xchg`；旧 `/app/nic` 在同一页面仍 `port 1 xchg/offer/carry`。

管理器不要做成一个长期占核的用户进程：实测它占掉最后一个空闲核后，驱动只能共享管理器的核，父进程恢复不了。管理器应做成 shell 内建命令或内核服务，由它调用服务 46。

## 编译

`node ZerOS-PRO/Hardware/Nas/Server/build-guest.mjs` 会把 `niccore.obr` 链接进 `/kernel/start`，并把 `niclib.obr` 编成 `/lib/nic.zdll`。用户程序写 `import nic;`，并写 `#DYN`，由操作系统在进入 `main` 之前装入 `/lib/nic.zdll`。
