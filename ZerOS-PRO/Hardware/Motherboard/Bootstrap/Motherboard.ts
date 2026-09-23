/**
 * @module ZerOS.Hardware.Motherboard.Motherboard
 * @description 主板：固定的虚拟硬件，不是可插拔插头
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 上电时坐上它支持的设备。当前只有内存。
 * 主板自己不能被换掉。可插拔的是插在它插座上的内存实现。
 * 不解释指令，也不做进程调度。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. Motherboard.Power
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as MachineMemoryRoot } from "../../Memory/Bootstrap/MachineMemory";
import { ZerOS as MemorySeatRoot } from "../Seat/MemorySeat";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      /* ------------------------------------------------------------------ */
      /* 2. 上电                                                             */
      /* ------------------------------------------------------------------ */

      /**
       * 这块主板。
       * `Power` 是上电入口。Boot 只调用它，不认识内存插头。
       */
      export const Motherboard = {
        /**
         * 给主板通电。
         * 内存总控已经发布时直接返回，不重新测试，也不重新抽 MemoryId。
         * 当前没有 CPU 协议可坐，所以上电只处理内存座。
         */
        Power(): void {
          // 已经发布说明这一台内存还在座上。再通一次电不换插头。
          if (MachineMemoryRoot.Hardware.Memory.MachineMemory.MemoryController !== null) {
            return;
          }
          MemorySeatRoot.Hardware.Motherboard.seatMemory();
        },
      };
    }
  }
}
