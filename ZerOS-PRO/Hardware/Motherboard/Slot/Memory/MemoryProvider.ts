/**
 * @module ZerOS.Hardware.Motherboard.Slot.Memory.Provider
 * @description Memory Provider 形态（ZVHP1 §4.2 + §4.2.1）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 定义可绑定到 MemorySlot 的 Provider 接口：元数据 + ZMP1 MachineMemory 门面。
 * 不含具体实现、不含 Slot 状态。内存实现依赖这个形状，不依赖主板通道。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 元数据 / MemoryInit 类型导入
 *   2. MemoryProvider 接口
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import type { ZerOS as ProviderMetaRoot } from "../Structure/ProviderMeta";
import type { ZerOS as MemoryInitRoot } from "../../../Memory/Bootstrap/MemoryInit";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      export namespace Slot {
        /* ------------------------------------------------------------------ */
        /* 2. MemoryProvider                                                   */
        /* ------------------------------------------------------------------ */

        /**
         * Memory Provider（ZVHP1）：可经 MemorySlot.Bind 激活的内存实现插头。
         */
        export interface MemoryProvider {
          /** 实现标识（1–64 可打印 ASCII） */
          readonly ProviderId: ProviderMetaRoot.Hardware.Motherboard.Slot.ProviderId;

          /** 厂商标识（1–32 可打印 ASCII） */
          readonly ProviderVendor: ProviderMetaRoot.Hardware.Motherboard.Slot.ProviderVendor;

          /**
           * 领域协议标识；内存路径必须为 "ZMP1"。
           */
          readonly ActiveProtocol: ProviderMetaRoot.Hardware.Motherboard.Slot.ActiveProtocol;

          /**
           * ZMP1 §4.14 / §4.22 引导门面：含 MemoryInit.Test 与 Initialize。
           */
          readonly MachineMemory: {
            readonly MemoryInit: MemoryInitRoot.Hardware.Memory.MemoryInit;
          };
        }
      }
    }
  }
}
