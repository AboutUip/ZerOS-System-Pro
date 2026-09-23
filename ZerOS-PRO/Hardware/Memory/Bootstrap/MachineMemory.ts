/**
 * @module ZerOS.Hardware.Memory.MachineMemory
 * @description 内存引导门面（MachineMemory）— 读取主板上的内存插座
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 提供 ZMP1 §4.14 规范名 `MachineMemory`、`MemoryInit`、`MemoryController`。
 * `MemoryController` 挂在本门面上。初始化完成前为 null。
 * 成功发布后是总控自身。内存不把总控写进 Kernel，也不自己 Bind 插头。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 插座与总控类型导入
 *   2. 已发布总控
 *   3. MachineMemory 门面
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as MemorySlotRoot } from "../../Motherboard/Slot/Memory/MemorySlot";
import type { ZerOS as MemoryInitRoot } from "./MemoryInit";
import type { ZerOS as MemoryControllerRoot } from "../Controller/MemoryController";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      /* -------------------------------------------------------------------- */
      /* 2. 已发布总控：只由 Initialize 写入                                   */
      /* -------------------------------------------------------------------- */

      /**
       * 用对象保住这一格，避免导出 let。
       * 临时测试造出的总控不得放进这里。
       */
      const seatedController: {
        current: MemoryControllerRoot.Hardware.Memory.MemoryController | null;
      } = {
        current: null,
      };

      /**
       * 把已经通过放行的总控挂到 `MachineMemory.MemoryController`。
       * 只有 `MemoryInit.Initialize` 可以调用。这不是 ZMP1 方法名。
       */
      export function publishMemoryController(
        controller: MemoryControllerRoot.Hardware.Memory.MemoryController,
      ): void {
        seatedController.current = controller;
      }

      /* -------------------------------------------------------------------- */
      /* 3. MachineMemory                                                      */
      /* -------------------------------------------------------------------- */

      /**
       * MachineMemory：ZMP1 引导门面。
       * `MemoryInit` 来自当前插在主板上的 Provider。没人 Bind 时不能取到入口。
       */
      export const MachineMemory: {
        readonly MemoryInit: MemoryInitRoot.Hardware.Memory.MemoryInit;
        readonly MemoryController: MemoryControllerRoot.Hardware.Memory.MemoryController | null;
      } = {
        get MemoryInit(): MemoryInitRoot.Hardware.Memory.MemoryInit {
          const active = MemorySlotRoot.Hardware.Motherboard.Slot.MemorySlot.GetActive();
          if (active === null) {
            throw new Error(
              `[ZerOS.Hardware.Memory.MachineMemory] MemorySlot 无 Active Provider，无法取得 MemoryInit`,
            );
          }
          return active.MachineMemory.MemoryInit;
        },

        /**
         * 已发布的内存总控。
         * 发布前为 null。`Test` 禁止把它写成非空。
         */
        get MemoryController(): MemoryControllerRoot.Hardware.Memory.MemoryController | null {
          return seatedController.current;
        },
      };
    }
  }
}
