/**
 * @module ZerOS.Boot.FaultDelivery
 * @description 失败是送上面板还是只能写控制台
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 能画的失败只画一次。显卡来源，或错误帧自己没画成，改走控制台，不再求显卡画第二帧。
 * 显卡来源即使已经呈过一帧，仍然写控制台。
 * 不归类失败，也不执行指令。调用方把画和写控制台两件事交进来。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 去向
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import type { ZerOS as FaultRoot } from "../Hardware/Cpu/Structure/FaultRecord";
import { ZerOS as SourceRoot } from "../Hardware/Cpu/Enum/FaultSource";

export namespace ZerOS {
  export namespace Boot {
    type FaultRecord = FaultRoot.Hardware.Cpu.FaultRecord;
    const FaultSourceGpu = SourceRoot.Hardware.Cpu.FaultSourceGpu;

    /* ------------------------------------------------------------------ */
    /* 2. 去向                                                             */
    /* ------------------------------------------------------------------ */

    /** draw 送面板。console 只写控制台。drop 是已经呈过一帧，后来的失败不再呈。 */
    export type FaultChannel = "draw" | "console" | "drop";

    /**
     * 这一条失败该往哪送。
     * 显卡来源和画不出来的失败每次都写控制台，即使面板上已经有一帧。
     * alreadyShown 只挡住再画第二帧。控制台不看这个标记。
     */
    export function faultChannel(record: FaultRecord, alreadyShown: boolean): FaultChannel {
      if (!record.Window || record.Source === FaultSourceGpu) {
        return "console";
      }
      if (alreadyShown) {
        return "drop";
      }
      return "draw";
    }
  }
}
