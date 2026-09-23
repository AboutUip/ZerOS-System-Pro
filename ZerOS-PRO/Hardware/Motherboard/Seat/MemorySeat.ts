/**
 * @module ZerOS.Hardware.Motherboard.MemorySeat
 * @description 主板上的内存座
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只坐主板点名支持的内存协议。当前是 ZMP1。
 * 顺序是 Bind，然后 Test，然后 Initialize。
 * 坐上之后总控留在内存自己的 MachineMemory 上。本文件不打开通道方法。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. seatMemory
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as ActiveProviderRoot } from "../../Memory/ActiveProvider/Provider";
import { ZerOS as MachineMemoryRoot } from "../../Memory/Bootstrap/MachineMemory";
import { ZerOS as MemorySlotRoot } from "../Slot/Memory/MemorySlot";
import { ZerOS as BoardSupportRoot } from "../Config/BoardSupport";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      /* ------------------------------------------------------------------ */
      /* 2. 坐内存                                                           */
      /* ------------------------------------------------------------------ */

      /**
       * 把当前 ActiveProvider 目录里的内存插头坐到主板插座上。
       * 协议不在支持名单里时，不 Bind。
       * 插座拒绝时，不调用 Test。
       */
      export function seatMemory(): void {
        const provider = ActiveProviderRoot.Hardware.Memory.ActiveMemoryProvider;
        // 主板先看自己的名单。不支持的版本不能进插座。
        if (!BoardSupportRoot.Hardware.Motherboard.supportsMemoryProtocol(provider.ActiveProtocol)) {
          throw new Error(
            `[ZerOS.Hardware.Motherboard.MemorySeat] 主板不支持内存协议 ${provider.ActiveProtocol}`,
          );
        }

        const slot = MemorySlotRoot.Hardware.Motherboard.Slot.MemorySlot;
        slot.Bind(provider);
        // Bind 对非法插头是静默拒绝。坐不上就停，不要接着测试。
        if (slot.GetActive() !== provider) {
          throw new Error(
            `[ZerOS.Hardware.Motherboard.MemorySeat] 内存插头没有坐上插座`,
          );
        }

        const memory = MachineMemoryRoot.Hardware.Memory.MachineMemory;
        // 先整套测试，再发布。测试不通过时 Initialize 自己拒绝，总控保持空。
        memory.MemoryInit.Test();
        memory.MemoryInit.Initialize();
        if (memory.MemoryController === null) {
          throw new Error(
            `[ZerOS.Hardware.Motherboard.MemorySeat] 内存总控没有发布到 MachineMemory`,
          );
        }
      }
    }
  }
}
