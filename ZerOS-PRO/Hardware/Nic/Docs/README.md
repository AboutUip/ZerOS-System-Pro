# 网卡官方实现

设备协议是 [ZNC1](../../../../Documents/Protocol/PhysicalHardware/Nic/ZNC1.md)。本文只描述这一份参考实现。

插头坐在扩展口 `1`。`ActiveProtocol` 是 `ZXD1`，`DeviceProtocol` 是 `ZNC1`。口编号不是协议的一部分。换插头时替换 `ActiveProvider/`，导出名保持 `ActiveNicProvider`。

## 组成

| 路径 | 作用 |
|------|------|
| `Server/` | Rust 网卡进程，零外部依赖。监听本地 WebSocket，只搬原始以太网帧 |
| `Bootstrap/NicRuntime.ts` | 宿主桥。一条 WebSocket，一条串行 request/reply，不解析帧 |
| `Provider/ReferenceNicProvider.ts` | 扩展口插头。`Exchange` 读能力，`Offer` 发帧，`Carry` 收帧 |
| `Test/NicSelfCheck.ts` | 引导时的本地自检。不访问 Rust |
| `../../../Driver/Nic/` | Obr 侧：进内核的 `niccore` 和给用户程序导入的 `nic.zdll` |

## 单独启动 Rust

页面和 `npm run dev` 都不会拉起这个进程。在仓库根目录另开一个终端：

```bash
node ZerOS-PRO/Hardware/Nic/Server/build.mjs
```

或者在 `Server/` 里用 C++20 之外的工具链直接编：

```bash
cd ZerOS-PRO/Hardware/Nic/Server
cargo build --release --target x86_64-pc-windows-gnu
target/x86_64-pc-windows-gnu/release/zeros-nic.exe
```

它只使用 Rust 标准库，监听 `ws://127.0.0.1:8766/nic`。这个地址写在 `NicConfig.ServiceUrl` 里，两边必须一致。每一条二进制帧是一笔请求，每一条二进制帧是一笔答复，串行进行。进程没启动时，引导仍然成功，第一次交换返回状态 `1`（未就绪）。

## 线

参考实现有两条线：

- `loopback`：发出的帧回到接收队列，自检用；
- `udp:HOST:PORT`：一帧放进一个 UDP 数据报，零依赖的虚拟以太网段。

驱动通过控制字 `CONFIG` 选线：回环，或 IPv4 + 端口。Rust 不替驱动选线，也不因为某条线不可用而改走另一条。启动参数 `--wire` 只给不经过驱动的调试和自检使用。

Rust 不解析以太网帧，也不实现 IP、TCP、UDP、ARP、DNS 或 HTTP。驱动拥有完整网络栈，负责连接、重传、校验、调度和缓冲。

## 能力上界

参考实现报告：

- 一帧上界 `262144` 个八位组；
- 接收队列深度 `256` 帧。

这是能力上限，不是协议上限。驱动可以按控制字报告的值决定每次交多少。超过上界时网卡返回状态 `4`，不交半帧。

## 自检

引导时 `ReferenceNicProvider.Boot()` 只跑 `Test/NicSelfCheck.ts`，核对协议标识、能力字编解码和短答复规则，不打开 WebSocket。Rust 没启动不算引导失败。

内核侧的 `niccore::selfCheck` 通过服务 `44` 暴露：先探测控制字，再核对帧上界。它同样不要求 Rust 在线。

客人树里还有 `/app/nic`：先通过服务 `45` 把线配成 loopback，再发一帧 18 个八位组的原始以太网报文，用 `carry` 收回并逐字节比较。通过时打印 `nic self-check ok` 并退出 0，否则打印失败并以 1 退出。源在 `ZerOS-PRO/Resource/App/nic/`。
