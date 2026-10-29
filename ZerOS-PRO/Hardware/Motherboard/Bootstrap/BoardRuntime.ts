/**
 * @module ZerOS.Hardware.Motherboard.BoardRuntime
 * @description 主板线程里的上电过程
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只在主板 Worker 里调用。页面上的 Power 不进入这个文件。
 * 上电会等到内存线程完成测试。这段等待不占用页面线程。
 * 成功之后再次调用直接返回，不重新测试，也不重新抽 MemoryId。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. powerBoard
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as QueryRoot } from "../Host/HardwareQuery";
import { ZerOS as CpuSeatRoot } from "../Seat/CpuSeat";
import { ZerOS as ExpansionSeatRoot } from "../Seat/ExpansionSeat";
import { ZerOS as GpuSeatRoot } from "../Seat/GpuSeat";
import { ZerOS as MemorySeatRoot } from "../Seat/MemorySeat";
import { ZerOS as BoardSelfCheckRoot } from "../Test/BoardSelfCheck";
import { ZerOS as ClockRoot } from "../../Clock/Bootstrap/HostClock";
import { ZerOS as BootTraceRoot } from "../../Debug/Host/BootTrace";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      /** 这一条主板线程是否已经把内存坐稳。 */
      let seated = false;

      /**
       * 先坐显卡、CPU 和内存，再跑引导 logo。
       * logo 会写内存，所以必须在内存坐稳之后执行。
       * 画面留在面板上，访存核对和扩展口启动都不清它。
       */
      export async function powerBoard(logo: readonly string[] | Uint8Array): Promise<void> {
        if (seated) {
          return;
        }
        const markBoot = BootTraceRoot.Hardware.Debug.markBoot;
        /* 每一段结束再打点。差值就是这一段自己的耗时，不含下一段。 */
        markBoot("board");
        ClockRoot.Hardware.Clock.startClock();
        QueryRoot.Hardware.Motherboard.openQueryPage();
        BoardSelfCheckRoot.Hardware.Motherboard.runBoardSelfCheck();
        await GpuSeatRoot.Hardware.Motherboard.seatGpu();
        markBoot("gpu");
        await CpuSeatRoot.Hardware.Motherboard.seatCpu();
        markBoot("cpu");
        await MemorySeatRoot.Hardware.Motherboard.seatMemory();
        markBoot("memory");
        if (logo instanceof Uint8Array) {
          await CpuSeatRoot.Hardware.Motherboard.runInstructionBinary(logo);
        } else {
          await CpuSeatRoot.Hardware.Motherboard.runInstructionLines(logo);
        }
        markBoot("logo");
        await CpuSeatRoot.Hardware.Motherboard.probeCpu();
        markBoot("probe");
        ExpansionSeatRoot.Hardware.Motherboard.bootExpansionPorts();
        markBoot("ports");
        seated = true;
      }
    }
  }
}
