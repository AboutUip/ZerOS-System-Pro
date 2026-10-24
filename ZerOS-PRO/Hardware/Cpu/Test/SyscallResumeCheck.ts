/**
 * @module ZerOS.Hardware.Cpu.SyscallResumeCheck
 * @description 系统调用停下之后能从下一条继续
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 0 号核心先成为监督核。3 号核心执行 svc 后保持执行中，查询字段 11 是 2。
 * 服务号连同核心号放进监督核的保持位。回复写回目的寄存器后，从 svc 的下一条继续。
 * 不进入内核。这里只核对硬件上的停下和恢复。
 * 核对结束时卸下 3 号核心并交还监督核。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. runSyscallResumeCheck
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
      const CoreStateRunning = StateRoot.Hardware.Cpu.CoreStateRunning;
      const declaredCount = RuntimeRoot.Hardware.Cpu.declaredCount;
      const coreState = RuntimeRoot.Hardware.Cpu.coreState;
      const schedule = RuntimeRoot.Hardware.Cpu.schedule;
      const startedRun = RuntimeRoot.Hardware.Cpu.startedRun;
      const seatImage = RuntimeRoot.Hardware.Cpu.seatImage;
      const runGuest = RuntimeRoot.Hardware.Cpu.runGuest;
      const readRegisters = RuntimeRoot.Hardware.Cpu.readRegisters;
      const pass = RuntimeRoot.Hardware.Cpu.pass;
      const take = RuntimeRoot.Hardware.Cpu.take;
      const clearGate = RuntimeRoot.Hardware.Cpu.clearGate;
      const guestLines = LinesRoot.Hardware.Cpu.guestLines;
      const checkPrefix = "[ZerOS.Hardware.Cpu.SyscallResumeCheck]";

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

      /** 3 号核心发起 4 号服务，回复 42 后停在 halt。 */
      export async function runSyscallResumeCheck(): Promise<void> {
        if (declaredCount() < 8) {
          fail("the official machine should have 8 cores");
        }
        let opened = false;
        try {
          const gated = await runGuest(0, guestLines(["gate", "halt"]));
          /* gate 已经执行过。失败时也要卸下并交还，避免内核自己的 gate 被拒绝。 */
          opened = true;
          if (!gated.Ok) {
            fail(`did not become the supervisor ${gated.Message}`);
          }
          /* (1) 服务号在 r1。停下后核心仍算执行中，字段 11 是 2，内核才不会把它当成已经退出。 */
          seatImage(3, guestLines([
            "place r1, 4",
            "svc r0, r1",
            "halt",
          ]));
          schedule(3);
          await startedRun(3);
          if (coreState(3) !== CoreStateRunning) {
            fail("the core was not running while the syscall was parked");
          }
          if (await queryField(3, 11) !== 2n || await queryField(3, 5) !== BigInt(CoreStateRunning)) {
            fail("syscall query fields were not running with reason 2");
          }
          const packed = take(0);
          if (packed !== ((3n << 32n) | 4n)) {
            fail("the latch core or service is wrong");
          }
          /* (2) 回复放进调用核的保持位。再次调度从 svc 的下一条继续，r0 是回复。 */
          pass(0, 3, 42n);
          schedule(3);
          await startedRun(3);
          const registers = await readRegisters(3);
          if (at(registers, 0) !== 42n || at(registers, 1) !== 4n || coreState(3) !== CoreStateHalted) {
            fail("the reply was not written, or the core did not stop on the next instruction");
          }
          if (await queryField(3, 11) !== 0n) {
            fail("field 11 was still waiting after the syscall returned");
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
