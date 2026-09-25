/**
 * @module ZerOS.Hardware.Motherboard.MemorySeat
 * @description 主板上的内存座
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只坐主板点名支持的内存协议。当前是 ZMP1。
 * 真正的 Bind、Test、Initialize 在内存线程里做。这里把名单交过去，并等到那条线程做完。
 * 坐上之后总控留在内存线程自己的 MachineMemory 上。
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

import { ZerOS as BoardSupportRoot } from "../Config/BoardSupport";
import { ZerOS as ExecuteMemoryInstructionRoot } from "../Channel/ExecuteMemoryInstruction";
import { ZerOS as MemoryLinkRoot } from "../Host/MemoryLink";
import { ZerOS as MemoryOpcodeRoot } from "../Enum/MemoryOpcode";
import { ZerOS as MemoryInstructionRoot } from "../Structure/MemoryInstruction";
import { ZerOS as QueryRoot } from "../Host/HardwareQuery";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      /**
       * 让内存线程坐上 ActiveProvider。
       * 协议名单来自这块主板。不在名单里时，内存线程不 Bind。
       * 坐上之后执行一条读位元指令，确认指令能经通道到达内存线程。
       */
      export async function seatMemory(): Promise<void> {
        const supported = BoardSupportRoot.Hardware.Motherboard.SupportedMemoryProtocols;
        const link = MemoryLinkRoot.Hardware.Motherboard.sharedMemoryLink();
        await link.power(supported);
        QueryRoot.Hardware.Motherboard.noteMemory(link.readText());
        const probe = MemoryInstructionRoot.Hardware.Motherboard.createMemoryInstruction(
          MemoryOpcodeRoot.Hardware.Motherboard.MemoryOpcodeLoadBit,
          0n,
          0n,
        );
        ExecuteMemoryInstructionRoot.Hardware.Motherboard.ExecuteLoad(probe);
      }
    }
  }
}
