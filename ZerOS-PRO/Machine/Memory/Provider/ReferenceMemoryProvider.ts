/**
 * @module ZerOS.Machine.Memory.Provider.Reference
 * @description 参考内存 Provider（ZVHP1 + ZMP1）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 将本仓库 Memory 引导实现包装为可 Bind 的 MemoryProvider。
 * 社区替换时：另写 Provider，对 MemorySlot.Bind 传入即可。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. MemoryInit 导入
 *   2. ReferenceMemoryProvider 常量
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as MemoryInitRoot } from "../Bootstrap/MemoryInit";
import type { ZerOS as MemoryProviderRoot } from "../../Slots/Memory/MemoryProvider";

export namespace ZerOS {
  export namespace Machine {
    export namespace Memory {
      /* -------------------------------------------------------------------- */
      /* 2. 参考实现 Provider                                                  */
      /* -------------------------------------------------------------------- */

      /**
       * ZerOS 参考内存 Provider（非规范标定；可被社区实现替换）。
       */
      export const ReferenceMemoryProvider: MemoryProviderRoot.Machine.Slots.MemoryProvider =
        {
          ProviderId: "ZerOS-Reference-Memory",
          ProviderVendor: "ZerOS-Team",
          ActiveProtocol: "ZMP1",
          MachineMemory: {
            MemoryInit: MemoryInitRoot.Machine.Memory.MemoryInitInstance,
          },
        };
    }
  }
}
