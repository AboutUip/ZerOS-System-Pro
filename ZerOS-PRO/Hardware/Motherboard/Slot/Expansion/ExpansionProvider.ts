/**
 * @module ZerOS.Hardware.Motherboard.Slot.Expansion.Provider
 * @description 扩展口上的设备插头（ZXP1 + ZXD1）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 定义可以 Bind 到某一个扩展口的插头。
 * 不含 4 个口的表。主板引导代码按这个形态调用 Load、Boot 和 Exchange。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. ExpansionProvider
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import type { ZerOS as ProviderMetaRoot } from "../Structure/ProviderMeta";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      export namespace Slot {
        /**
         * 扩展设备插头。
         * ActiveProtocol 必须是 ZXD1。DeviceProtocol 是设备自己的协议，主板不分支。
         */
        export interface ExpansionProvider {
          readonly ProviderId: ProviderMetaRoot.Hardware.Motherboard.Slot.ProviderId;
          readonly ProviderVendor: ProviderMetaRoot.Hardware.Motherboard.Slot.ProviderVendor;
          readonly ActiveProtocol: ProviderMetaRoot.Hardware.Motherboard.Slot.ActiveProtocol;
          readonly DeviceProtocol: string;
          Load(): void;
          Boot(): void;
          /**
           * 交换一块八位组。
           * 可以立刻返回，也可以返回 Promise。同一口上一次交换没结束前，下一次必须失败。
           */
          Exchange(direction: number, payload: Uint8Array): Uint8Array | Promise<Uint8Array>;
          /**
           * 一次取走已经准备好的应答，最长 4096 个八位组。
           * 这不是 ZXP1 的必选方法。没有它时，fill 在这块主板上失败。
           * status 为 0 时 bytes 是取走的字节；否则不取走，bytes 为空。
           */
          Drain?(max: number): { readonly status: number; readonly bytes: Uint8Array };
          /**
           * 按句柄一次读出至多 268435456 个八位组。这不是 ZXP1 的必选方法。
           * 没有它时，carry 在这块主板上失败。
           */
          Carry?(handle: number, offset: number, count: number): Promise<{ readonly status: number; readonly bytes: Uint8Array }>;
        }
      }
    }
  }
}
