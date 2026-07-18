/**
 * @module ZerOS.Machine.Slots.Memory.Provider
 * @description Memory Provider 形态（ZVHP1 §4.2 + §4.2.1）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 定义可绑定到 MemorySlot 的 Provider 接口：元数据 + ZMP1 MachineMemory 门面。
 * 不含具体实现、不含 Slot 状态。
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
import type { ZerOS as MemoryInitRoot } from "../../Memory/Bootstrap/MemoryInit";

export namespace ZerOS {
  export namespace Machine {
    export namespace Slots {
      /* -------------------------------------------------------------------- */
      /* 2. MemoryProvider                                                     */
      /* -------------------------------------------------------------------- */

      /**
       * Memory Provider（ZVHP1）：可经 MemorySlot.Bind 激活的内存实现插头。
       */
      export interface MemoryProvider {
        /** 实现标识（1–64 可打印 ASCII） */
        readonly ProviderId: ProviderMetaRoot.Machine.Slots.ProviderId;

        /** 厂商标识（1–32 可打印 ASCII） */
        readonly ProviderVendor: ProviderMetaRoot.Machine.Slots.ProviderVendor;

        /**
         * 领域协议标识；内存路径必须为 "ZMP1"。
         */
        readonly ActiveProtocol: ProviderMetaRoot.Machine.Slots.ActiveProtocol;

        /**
         * ZMP1 §4.14 引导门面：含 MemoryInit.Initialize。
         */
        readonly MachineMemory: {
          readonly MemoryInit: MemoryInitRoot.Machine.Memory.MemoryInit;
        };
      }
    }
  }
}
