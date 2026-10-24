/**
 * @module ZerOS.Hardware.Cpu.ContextSlotCheck
 * @description 把停下的核心抄进槽再放回来
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 3 号核心让出后，寄存器和下一条被抄进 0 号槽。换上另一段程序再放回，应从让出的下一条继续。
 * 空槽不能放回，也不能改掉核心上已经留下的结果。
 * 不保存可访问范围和 Hz。核对结束时卸下 3 号核心并交还监督核。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. runContextSlotCheck
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
      const declaredCount = RuntimeRoot.Hardware.Cpu.declaredCount;
      const coreState = RuntimeRoot.Hardware.Cpu.coreState;
      const schedule = RuntimeRoot.Hardware.Cpu.schedule;
      const startedRun = RuntimeRoot.Hardware.Cpu.startedRun;
      const seatImage = RuntimeRoot.Hardware.Cpu.seatImage;
      const runGuest = RuntimeRoot.Hardware.Cpu.runGuest;
      const readRegisters = RuntimeRoot.Hardware.Cpu.readRegisters;
      const clearGate = RuntimeRoot.Hardware.Cpu.clearGate;
      const guestLines = LinesRoot.Hardware.Cpu.guestLines;
      const checkPrefix = "[ZerOS.Hardware.Cpu.ContextSlotCheck]";

      function fail(message: string): never {
        throw new Error(`${checkPrefix} ${message}`);
      }

      function at(registers: readonly bigint[], index: number): bigint {
        const value = registers[index];
        if (value === undefined) {
          fail(`did not read r${String(index)}`);
        }
        return value;
      }

      async function queryField(index: number, field: number): Promise<bigint> {
        const guest = await runGuest(0, guestLines([
          "place r1, 1",
          `place r2, ${String(field)}`,
          `place r3, ${String(index)}`,
          "query r0, r1, r2, r3",
          "halt",
        ]));
        if (!guest.Ok) {
          fail(`query failed ${guest.Message}`);
        }
        return at(guest.Registers, 0);
      }

      /** 让出留下下一条。放回之后应执行那一条，而不是从第一条重来。 */
      export async function runContextSlotCheck(): Promise<void> {
        if (declaredCount() < 8) {
          fail("the official machine should have 8 cores");
        }
        let opened = false;
        try {
          seatImage(3, guestLines([
            "place r2, 42",
            "yield",
            "place r2, 99",
            "halt",
          ]));
          schedule(3);
          await startedRun(3);
          const yielded = await readRegisters(3);
          if (at(yielded, 2) !== 42n || coreState(3) !== CoreStateHalted) {
            fail("yield did not stop before the next instruction");
          }
          if (await queryField(3, 11) !== 1n) {
            fail("field 11 was not 1 after yield");
          }
          const gated = await runGuest(0, guestLines([
            "gate",
            "place r1, 3",
            "place r2, 0",
            "capture r1, r2",
            "halt",
          ]));
          /* 第一条已经是 gate。抄槽失败时监督核标记也已经留下，结束时必须交还。 */
          opened = true;
          if (!gated.Ok) {
            fail(`was not captured into the slot ${gated.Message}`);
          }
          /* (1) 换上另一段，证明放回不是原核心自己还留着旧寄存器。 */
          seatImage(3, guestLines(["place r2, 7", "halt"]));
          schedule(3);
          await startedRun(3);
          const replaced = await readRegisters(3);
          if (at(replaced, 2) !== 7n) {
            fail("the replacement program did not write its own register");
          }
          const restored = await runGuest(0, guestLines([
            "place r1, 3",
            "place r2, 0",
            "restore r1, r2",
            "halt",
          ]));
          if (!restored.Ok) {
            fail(`was not restored from the slot ${restored.Message}`);
          }
          const brought = await readRegisters(3);
          if (at(brought, 2) !== 42n || await queryField(3, 11) !== 1n) {
            fail("restore did not bring back the yielded registers and reason");
          }
          /* (2) 再次调度从让出的下一条继续，r2 变成 99，而不是重新执行第一条。 */
          schedule(3);
          await startedRun(3);
          const continued = await readRegisters(3);
          if (at(continued, 2) !== 99n || coreState(3) !== CoreStateHalted || await queryField(3, 11) !== 0n) {
            fail("execution did not continue at the instruction after yield");
          }
          const empty = await runGuest(0, guestLines([
            "place r1, 3",
            "place r2, 1",
            "restore r1, r2",
            "halt",
          ]));
          if (empty.Ok || !empty.Message.includes("slot is empty")) {
            fail(`an empty slot was still restored ${empty.Message}`);
          }
          const kept = await readRegisters(3);
          if (at(kept, 2) !== 99n || coreState(3) !== CoreStateHalted) {
            fail("a failed restore changed the core");
          }
        } finally {
          if (opened) {
            try {
              await runGuest(0, guestLines([
                "place r1, 3",
                "release r1",
                "halt",
              ]));
            } finally {
              clearGate();
            }
          }
        }
      }
    }
  }
}
