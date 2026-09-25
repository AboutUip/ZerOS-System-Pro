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
          Exchange(direction: number, payload: Uint8Array): Uint8Array;
        }
      }
    }
  }
}
