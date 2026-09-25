/**
 * @module ZerOS.Hardware.Motherboard.MemoryChannel
 * @description 主板内存通道：地址、数据、方向、字宽
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 把内存线程上的端口收成一条底层通道。调用发生在主板线程。
 * 方向 0 是读，方向 1 是写。地址是线性位元下标。字宽是 1/8/16/32/64 位。
 * 数据是 bigint。存储体在内存线程里，这里只把一次访问送进信箱并等到完成。
 * 不调度。什么时候发起一次访问，留给以后的 CPU 线程。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 字宽门闩
 *   3. 读 / 写
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as ChannelWidthRoot } from "../Enum/ChannelWidth";
import { ZerOS as MemoryLinkRoot } from "../Host/MemoryLink";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      type ChannelWidth = ChannelWidthRoot.Hardware.Motherboard.ChannelWidth;

      const channelPrefix = "[ZerOS.Hardware.Motherboard.MemoryChannel]";

      /**
       * 字宽大于 1 时，地址必须是八位组起点。
       * 不对齐就停，请求不会送到内存线程。
       */
      function requireWidth(width: number, address: bigint): ChannelWidth {
        const accepted: ChannelWidth | null = ChannelWidthRoot.Hardware.Motherboard.toChannelWidth(width);
        if (accepted === null) {
          throw new Error(`${channelPrefix} 通道字宽不是 1、8、16、32、64`);
        }
        if (accepted !== ChannelWidthRoot.Hardware.Motherboard.ChannelWidthBit && address % 8n !== 0n) {
          throw new Error(`${channelPrefix} 宽度大于 1 时地址必须对齐到八位组`);
        }
        return accepted;
      }

      /**
       * 按方向 0 从通道读出。
       * 返回时内存线程已经完成这次读。低位是该窗口的最低有效位。
       */
      export function Read(Address: bigint, Width: number): bigint {
        requireWidth(Width, Address);
        return MemoryLinkRoot.Hardware.Motherboard.sharedMemoryLink().read(Address, Width);
      }

      /**
       * 按方向 1 写入通道。
       * 返回时内存线程已经接受或拒绝这次写。拒绝时存储体不变，异常句从内存线程原样抛出。
       */
      export function Write(Address: bigint, Width: number, Data: bigint): void {
        requireWidth(Width, Address);
        MemoryLinkRoot.Hardware.Motherboard.sharedMemoryLink().write(Address, Width, Data);
      }
    }
  }
}
