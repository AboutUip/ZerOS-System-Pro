/**
 * @module ZerOS.Machine.Memory.MachineMemory
 * @description 内存引导门面（MachineMemory）— 转发至 Active Provider
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 提供 ZMP1 §4.14 规范名 `MachineMemory`。
 * 未绑定时自动 Bind `ActiveProvider/Provider` 中的 ActiveMemoryProvider。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. Slot / ActiveProvider 导入
 *   2. ensureBound 辅助
 *   3. MachineMemory 门面
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as MemorySlotRoot } from "../../Slots/Memory/MemorySlot";
import { ZerOS as ActiveProviderRoot } from "../ActiveProvider/Provider";

export namespace ZerOS {
  export namespace Machine {
    export namespace Memory {
      /* -------------------------------------------------------------------- */
      /* 2. 确保已绑定 ActiveProvider 目录中的插头                             */
      /* -------------------------------------------------------------------- */

      /**
       * 若尚无 Active，则 Bind ActiveProvider 文件夹导出的实现。
       */
      function ensureMemoryProviderBound(): void {
        const slot = MemorySlotRoot.Machine.Slots.MemorySlot;
        if (slot.GetActive() === null) {
          slot.Bind(
            ActiveProviderRoot.Machine.Memory.ActiveMemoryProvider,
          );
        }
      }

      /* -------------------------------------------------------------------- */
      /* 3. MachineMemory                                                      */
      /* -------------------------------------------------------------------- */

      /**
       * MachineMemory：ZMP1 引导门面；背后为可插拔 Active Provider。
       */
      export const MachineMemory: {
        readonly MemoryInit: {
          Initialize(): void;
        };
      } = {
        get MemoryInit(): {
          Initialize(): void;
        } {
          ensureMemoryProviderBound();
          const active = MemorySlotRoot.Machine.Slots.MemorySlot.GetActive();
          if (active === null) {
            throw new Error(
              `[ZerOS.Machine.Memory.MachineMemory] MemorySlot 无 Active Provider，无法取得 MemoryInit`,
            );
          }
          return active.MachineMemory.MemoryInit;
        },
      };
    }
  }
}
