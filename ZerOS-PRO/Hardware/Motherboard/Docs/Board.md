# 主板说明

命名空间：`ZerOS.Hardware.Motherboard`。  
源码：`ZerOS-PRO/Hardware/Motherboard/`。  
本文只说明这一块板实际支持什么、上电做了什么、内存通道的底层口是什么。

## 1. 支持的协议

主板按协议标识决定能不能坐。标识对上才 Bind。对不上就不进插座。

| 设备 | 支持的协议 | 当前情况 |
|------|------------|----------|
| 内存 | `ZMP1` | 上电时坐 `Hardware/Memory/ActiveProvider/` 导出的插头 |
| CPU | （无） | 还没有主板愿意坐的 CPU 协议。`SupportedCpuProtocols` 为空 |

以后 CPU 有了自己的协议，并且这块板决定支持它，就在这里加上那个协议标识，并增加对应的座。现在没有。

内存协议升级出新版本时，把新标识加进 `SupportedMemoryProtocols`，并用那一版的导出端口接到下面同一条通道上。旧标识仍然留在名单里，通道的方向、地址、字宽不改。

换内存实现：整体替换 `ZerOS-PRO/Hardware/Memory/ActiveProvider/`，保持 `Provider.ts` 与导出名 `ActiveMemoryProvider`。主板的导入路径不变。Boot 不导入这个目录。

## 2. 上电

`Motherboard.Power()`，Boot 只调用这一步。

1. `MachineMemory.MemoryController` 已经不是 `null` 时直接返回。不重新测试，不重新抽 `MemoryId`。
2. 读取插头的 `ActiveProtocol`。不在内存支持名单里就停，不 Bind。
3. `MemorySlot.Bind`。插座没有接受这块插头就停，不测试。
4. `MemoryInit.Test()`，然后 `MemoryInit.Initialize()`。
5. 总控留在 `MachineMemory.MemoryController`。内核没有这个字段。

内存自己的高级端口（位元、块、领取、加深）仍在内存实现上。主板不把那些方法再导出一遍。

## 3. 内存通道

通道是主板用内存已经导出的端口组出来的底层口。地址是线性位元下标（`bigint`）。数据是 `bigint`。方向与字宽如下。

| 方向 | 数值 | 方法 |
|------|------|------|
| 读 | `0` | `Read(Address, Width)` |
| 写 | `1` | `Write(Address, Width, Data)` |

| 字宽（位） | 落到内存的端口 |
|------------|----------------|
| `1` | `ReadLinearBit` / `WriteLinearBit` |
| `8` | `ReadOctet` / `WriteOctet`（按线性地址找到那一颗） |
| `16` | `ReadLinearInteger` / `WriteLinearInteger`，八位组宽度 `2` |
| `32` | 同上，八位组宽度 `4` |
| `64` | 同上，八位组宽度 `8` |

字宽大于 `1` 时，地址必须能被 `8` 整除。不对齐就停，一个位元都不写。字宽不在上表里同样停。

总控还没发布时，通道拒绝访问。内存端口拒绝时，异常记在内存自己的总控或颗粒上，通道不另造一套异常标号。

低位是窗口里的最低有效位，与 ZMP1 的小端一致。`16` / `32` / `64` 可以跨过颗粒边界，因为走的是内存的线性整数端口。
