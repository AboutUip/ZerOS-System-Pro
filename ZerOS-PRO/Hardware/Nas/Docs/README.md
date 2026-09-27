# NAS 官方实现

设备协议是 [ZNP1](../../../../Documents/Protocol/PhysicalHardware/Nas/ZNP1.md)。本文只描述这一份参考实现。

插头坐在扩展口 `2`。`ActiveProtocol` 是 `ZXD1`，`DeviceProtocol` 是 `ZNP1`。口编号不是协议的一部分。换插头时替换 `ActiveProvider/`，导出名保持 `ActiveNasProvider`。

## 单独启动

页面和 `npm run dev` 都不会拉起这个进程。在仓库根目录另开一个终端：

```bash
node ZerOS-PRO/Hardware/Nas/Server/serve.mjs
```

它只使用 Node 自带模块，监听 `ws://127.0.0.1:8765/fs`。这个地址写在 `NasConfig.ServiceUrl` 里，两边必须一致。每条文本帧是一笔 JSON，服务按收到的顺序答复。进程没启动时，引导仍然成功，第一次交换返回状态 `1`（未就绪）。

客路径 `/` 是 `ZerOS-PRO/Hardware/Nas/Root`。目录不存在时，进程会创建它。这不是宿主操作系统的根目录。

核对文件树：

```bash
node ZerOS-PRO/Hardware/Nas/Server/check.mjs
```

## Obr

`import obr.nas;` 的函数头在 `Compiler/Obr/lib/obr.nas.mr`，函数体在旁边的 `obr.nas.obr`。编译时要把这个 `.obr` 和程序放在一起，并让 `board.mr`、`memory.mr` 处在搜索路径里。库内部通过 `xchg` 组 ZNP1 的字，再由插头经 WebSocket 询问参考服务。`Exec` 之后的拉回缓冲用 `fill` 一次写到位元线。客程序看不见 URL。

官方库使用扩展口 `2`。路径是 `string`。读写缓冲区是线性位地址，相邻八位组相隔 8 位，没有字符串那种 64 位长度头。一次读取从 262144 个八位组起，搬满则加倍，最多 268435456。对象更短就一次读完。返回值是 ZNP1 状态，`0` 是成功。
