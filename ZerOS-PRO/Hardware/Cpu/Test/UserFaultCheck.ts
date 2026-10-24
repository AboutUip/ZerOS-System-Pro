/**
 * @module ZerOS.Hardware.Cpu.UserFaultCheck
 * @description 用户核失败不拖垮监督核
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 核心 3 到 7 是用户核。指令失败只让这颗核停止，查询字段 11 仍是 0，不上报主板。
 * 核心 2 是监督核。同样的失败要上报主板。查询字段 11 也不会变成 3，3 只留在宿主记录里。
 * 上报在这次核对里被拦住，避免上电探针把这句预期失败画成整机错误。
 * 核对结束时两颗核都卸下，监督核标记交还，0 号核心回到停止。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. runUserFaultCheck
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
      const checkPrefix = "[ZerOS.Hardware.Cpu.UserFaultCheck]";

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

      /** 座位 1 的字段。自检期间 0 号核心不是客核心，可以直接问。 */
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

      function faultText(message: unknown): string | null {
        if (typeof message !== "object" || message === null) {
          return null;
        }
        const record = message as Record<string, unknown>;
        if (record["kind"] !== "fault") {
          return null;
        }
        const text = record["message"];
        return typeof text === "string" ? text : "";
      }

      /**
       * 除零序列。连续两条，失败发生在直循环里。
       * r0 先是 9，r3 先是 8。后面那条赋值不该执行。
       */
      function divZero(): ReturnType<typeof guestLines> {
        return guestLines([
          "place r0, 9",
          "place r3, 8",
          "place r1, 1",
          "place r2, 0",
          "div r0, r1, r2",
          "div r0, r1, r2",
          "place r3, 4",
          "halt",
        ]);
      }

      /** 装上并调度。失败时这次执行的 Promise 拒绝，寄存器停在失败前。 */
      async function runImage(ordinal: number, steps: ReturnType<typeof guestLines>): Promise<void> {
        if (coreState(ordinal) !== CoreStateHalted) {
          fail(`core ${String(ordinal)} is not halted, so the sample cannot be seated`);
        }
        seatImage(ordinal, steps);
        schedule(ordinal);
        try {
          await startedRun(ordinal);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "";
          if (!message.includes("divisor is 0")) {
            fail(`core ${String(ordinal)} failed, but not on division by zero ${message}`);
          }
          if (coreState(ordinal) !== CoreStateHalted) {
            fail(`core ${String(ordinal)} was still running after the fault`);
          }
          const registers = await readRegisters(ordinal);
          if (at(registers, 0) !== 9n || at(registers, 3) !== 8n) {
            fail(`core ${String(ordinal)} changed registers after the fault`);
          }
          return;
        }
        fail(`core ${String(ordinal)} finished even though it divided by zero`);
      }

      /**
       * 官方八核都已经挂上。
       * 用户核先跑，确认没有主板故障；监督核再跑，确认正好上报一条。
       */
      export async function runUserFaultCheck(): Promise<void> {
        if (declaredCount() < 8) {
          fail("the official machine should have 8 cores");
        }
        const faults: string[] = [];
        const previous = globalThis.postMessage;
        const relay = (message: unknown): void => {
          const text = faultText(message);
          if (text !== null) {
            faults.push(text);
            return;
          }
          previous.call(globalThis, message);
        };
        globalThis.postMessage = relay as typeof globalThis.postMessage;
        /* 条数从函数读出。直接比较数组长度会被收成字面量，后面的上报条数就对不上了。 */
        const faultCount = (): number => faults.length;
        let opened = false;
        try {
          /* (1) 用户核失败只停自己。字段 11 保持 0，这样内核会按正常结束收掉任务。 */
          await runImage(3, divZero());
          if (faultCount() !== 0) {
            fail("a user-core fault was still reported to the board");
          }
          if (await queryField(3, 11) !== 0n) {
            fail("user-core query field 11 was not 0");
          }
          /* (2) 忙标志必须已经放开，否则这颗核再也不能装入。 */
          seatImage(3, guestLines(["place r2, 5", "halt"]));
          schedule(3);
          await startedRun(3);
          const resumed = await readRegisters(3);
          if (at(resumed, 2) !== 5n || coreState(3) !== CoreStateHalted) {
            fail("the user core could not run again after the fault");
          }
          /* (3) 监督核同样的除零要让主板看见。字段 11 仍不是 3。 */
          await runImage(2, divZero());
          const reported = faults[0];
          if (faultCount() !== 1 || reported?.includes("divisor is 0") !== true) {
            fail("the supervisor fault was not reported to the board");
          }
          if (await queryField(2, 11) !== 0n) {
            fail("supervisor query field 11 was not 0");
          }
          const gated = await runGuest(0, guestLines(["gate", "halt"]));
          /* gate 已经执行过。即使后面的核对失败，也要卸下并交还监督核。 */
          opened = true;
          if (!gated.Ok) {
            fail(`did not become the supervisor before release ${gated.Message}`);
          }
        } finally {
          globalThis.postMessage = previous;
          if (opened) {
            try {
              await runGuest(0, guestLines([
                "place r1, 2",
                "release r1",
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
