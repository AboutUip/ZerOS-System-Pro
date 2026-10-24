/**
 * @module ZerOS.Hardware.Cpu.FaultFrameCheck
 * @description 失败帧在固件核心正忙时仍能接替
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 0 号核心先跑一段不会自己停的跳转。失败帧必须在下一条指令边界上接替它，
 * 并且这次接替不能变成一次新的指令失败。核心空下来之后，再呈一帧也必须能跑完。
 * 同时再要一帧必须被拒绝。不画真正的字形，画面只是一条 halt。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. runFaultFrameCheck
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as StateRoot } from "../Enum/CoreRunState";
import { ZerOS as RuntimeRoot } from "../Bootstrap/CpuRuntime";
import { ZerOS as LinesRoot } from "./GuestLines";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      const CoreStateHalted = StateRoot.Hardware.Cpu.CoreStateHalted;
      const coreState = RuntimeRoot.Hardware.Cpu.coreState;
      const runSequence = RuntimeRoot.Hardware.Cpu.runSequence;
      const presentFaultFrame = RuntimeRoot.Hardware.Cpu.presentFaultFrame;
      const guestLines = LinesRoot.Hardware.Cpu.guestLines;
      const checkPrefix = "[ZerOS.Hardware.Cpu.FaultFrameCheck]";

      function fail(message: string): never {
        throw new Error(`${checkPrefix} ${message}`);
      }

      /**
       * 调用前 0 号核心必须已经停止。
       * 返回时它仍然停止。忙着的那段跳转被接替后正常结束，不会以失败拒绝。
       */
      export async function runFaultFrameCheck(): Promise<void> {
        if (coreState(0) !== CoreStateHalted) {
          fail("core 0 was not halted before the fault frame");
        }
        const spin = guestLines(["place r1, 0", "jmp r1"]);
        const picture = guestLines(["halt"]);
        const spinning = runSequence(0, spin);
        const framed = presentFaultFrame(picture);
        let refused = false;
        try {
          await presentFaultFrame(picture);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "";
          refused = message.includes("fault picture is already running");
        }
        if (!refused) {
          fail("a second fault frame was accepted while one was waiting");
        }
        try {
          await framed;
          await spinning;
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "the busy core did not yield";
          fail(message);
        }
        if (coreState(0) !== CoreStateHalted) {
          fail("the fault frame did not halt core 0");
        }
        await presentFaultFrame(picture);
        if (coreState(0) !== CoreStateHalted) {
          fail("a fault frame on an idle core did not halt");
        }
      }
    }
  }
}
