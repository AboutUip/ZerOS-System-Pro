/**
 * @module ZerOS.Hardware.Cpu.FaultDeliveryCheck
 * @description 失败是否送到整机，以及每一种已登记失败的归类
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 上电探针的最后一步。归类表里每一种错误码都要出现，漏一个就失败。
 * 然后在真核上确认：自检结束后，固件和还没成为客核心的装入程序会上报；
 * 已经成为客核心的任务只留日志，不上报整机。
 * 不画错误帧。错误帧在引导核对里。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. runFaultDeliveryCheck
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as StateRoot } from "../Enum/CoreRunState";
import { ZerOS as CodeRoot } from "../Enum/FaultCode";
import { ZerOS as RuntimeRoot } from "../Bootstrap/CpuRuntime";
import { ZerOS as FaultRoot } from "../Structure/FaultRecord";
import { ZerOS as LogRoot } from "../../Debug/Host/DebugLog";
import { ZerOS as LinesRoot } from "./GuestLines";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      const CoreStateHalted = StateRoot.Hardware.Cpu.CoreStateHalted;
      const FaultCodeLast = CodeRoot.Hardware.Cpu.FaultCodeLast;
      const coreState = RuntimeRoot.Hardware.Cpu.coreState;
      const schedule = RuntimeRoot.Hardware.Cpu.schedule;
      const startedRun = RuntimeRoot.Hardware.Cpu.startedRun;
      const seatImage = RuntimeRoot.Hardware.Cpu.seatImage;
      const runGuest = RuntimeRoot.Hardware.Cpu.runGuest;
      const clearGate = RuntimeRoot.Hardware.Cpu.clearGate;
      const openFaultDelivery = RuntimeRoot.Hardware.Cpu.openFaultDelivery;
      const parkInstalledFaults = RuntimeRoot.Hardware.Cpu.parkInstalledFaults;
      const readParkedFaults = RuntimeRoot.Hardware.Cpu.readParkedFaults;
      const clearInstalled = RuntimeRoot.Hardware.Cpu.clearInstalled;
      const faultFromText = FaultRoot.Hardware.Cpu.faultFromText;
      const readFaults = LogRoot.Hardware.Debug.readFaults;
      const guestLines = LinesRoot.Hardware.Cpu.guestLines;
      const checkPrefix = "[ZerOS.Hardware.Cpu.FaultDeliveryCheck]";

      /** 短语和它必须归到的错误码、来源。顺序不重要，漏掉的码由后面的集合核对。 */
      const samples: readonly (readonly [string, number, number])[] = [
        ["jump target is outside this program", 1, 1],
        ["register is outside 0 to 7", 2, 1],
        ["register integer is out of range", 2, 1],
        ["indirect address register is outside 0 to 7", 2, 1],
        ["core is not running", 3, 1],
        ["core still has a command in flight", 4, 1],
        ["this core is already running another program", 4, 1],
        ["the previous command is still in flight", 4, 1],
        ["Hz is outside 1 to 1000000000", 5, 1],
        ["load only accepts a read opcode", 6, 1],
        ["store only accepts a write opcode", 6, 1],
        ["unknown core metric", 7, 1],
        ["exchange was refused", 8, 5],
        ["Exchange integer does not fit", 8, 5],
        ["unknown CPU field", 9, 1],
        ["query command is incomplete", 9, 1],
        ["gpu command failed", 10, 3],
        ["Gpu rejected the command", 10, 3],
        ["GPU rejected the command", 10, 3],
        ["显卡命令失败", 10, 3],
        ["memory access failed", 11, 2],
        ["Memory port rejected the access", 11, 2],
        ["内存端口拒绝", 11, 2],
        ["install target core is not halted", 12, 1],
        ["bound access is outside the window", 13, 1],
        ["schedule found no program", 14, 1],
        ["schedule found a syscall with no reply", 14, 1],
        ["pass target is not mounted", 15, 1],
        ["latch is already full", 15, 1],
        ["syscall has no supervisor", 16, 1],
        ["gate already has a supervisor", 17, 1],
        ["release target is not halted", 18, 1],
        ["slice is out of range", 19, 1],
        ["dwell is outside 0 to 1000", 23, 1],
        ["map request was rejected", 24, 1],
        ["capture target is not halted", 20, 1],
        ["restore slot is empty", 20, 1],
        ["attach is not a dynamic library", 21, 1],
        ["privileged instruction", 22, 1],
        ["divisor is 0", 0, 1],
        ["float divisor is 0", 0, 1],
        ["fill address is not aligned", 0, 5],
        ["carry length is out of range", 0, 5],
        ["[ZerOS.Hardware.Display.PageHost] canvas is missing", 0, 4],
        ["[ZerOS.Hardware.Keyboard.Host] key is missing", 0, 6],
        ["[ZerOS.Hardware.Pointer.Host] pointer is missing", 0, 5],
        ["[ZerOS.Boot.Run] boot program is incomplete", 0, 0],
        ["[ZerOS.Hardware.Cpu.CpuRuntime] register is outside 0 to 7", 2, 1],
      ];

      function fail(message: string): never {
        throw new Error(`${checkPrefix} ${message}`);
      }

      function divZero(): ReturnType<typeof guestLines> {
        return guestLines([
          "place r0, 9",
          "place r3, 8",
          "place r1, 1",
          "place r2, 0",
          "div r0, r1, r2",
          "halt",
        ]);
      }

      /** 先对完全部短语，再在核上核对三种上报。结束时 0 号和 3 号都回到停止，且 3 号不再是客核心。 */
      export async function runFaultDeliveryCheck(): Promise<void> {
        const seenCodes = new Set<number>();
        for (const sample of samples) {
          const phrase = sample[0];
          const code = sample[1];
          const source = sample[2];
          const record = faultFromText(phrase, 0, 0, "", "");
          if (record.Code !== code || record.Source !== source) {
            fail(`"${phrase}" became code ${String(record.Code)} source ${String(record.Source)}`);
          }
          seenCodes.add(record.Code);
          if (code === 10 && record.Window) {
            fail("a GPU failure stayed drawable");
          }
          if (code !== 10 && source !== 3 && !record.Window && !phrase.includes("was not drawn")) {
            fail(`"${phrase}" was kept off the window`);
          }
        }
        for (let code = 0; code <= FaultCodeLast; code += 1) {
          if (!seenCodes.has(code)) {
            fail(`fault code ${String(code)} has no sample`);
          }
        }
        if (coreState(0) !== CoreStateHalted || coreState(3) !== CoreStateHalted) {
          fail("a core was still running before the delivery samples");
        }
        /* 故意的失败留在本线程。探针还在等，送去主板就会把整机画成停机。 */
        parkInstalledFaults(true);
        openFaultDelivery();
        let opened = false;
        try {
          seatImage(0, divZero());
          schedule(0);
          let rejected = false;
          try {
            await startedRun(0);
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "";
            if (!message.includes("divisor is 0")) {
              fail(`core 0 failed for another reason ${message}`);
            }
            rejected = true;
          }
          if (!rejected) {
            fail("core 0 finished a division by zero");
          }
          const firmware = readParkedFaults()[0];
          if (firmware?.kind !== "fault" || firmware.core !== 0 || firmware.index !== 4 || firmware.op !== "div" || firmware.code !== 0) {
            fail("the firmware fault was not reported with its instruction");
          }
          const beforeLoader = readParkedFaults().length;
          seatImage(3, divZero());
          schedule(3);
          try {
            await startedRun(3);
            fail("the loader core finished a division by zero");
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "";
            if (!message.includes("divisor is 0")) {
              fail(`core 3 failed for another reason ${message}`);
            }
          }
          const loader = readParkedFaults()[beforeLoader];
          if (loader?.kind !== "fault" || loader.core !== 3 || loader.op !== "div") {
            fail("a host-seated loader fault was not reported");
          }
          const beforeGuest = readFaults().length;
          const faultCount = readParkedFaults().filter((item) => item.kind === "fault").length;
          const gated = await runGuest(0, guestLines(["gate", "halt"]));
          opened = true;
          if (!gated.Ok) {
            fail(`did not become the supervisor ${gated.Message}`);
          }
          const bounded = await runGuest(0, guestLines([
            "place r1, 3",
            "place r2, 0",
            "place r3, 64",
            "bound r1, r2, r3",
            "halt",
          ]));
          if (!bounded.Ok) {
            fail(`core 3 was not marked as a guest ${bounded.Message}`);
          }
          schedule(3);
          try {
            await startedRun(3);
            fail("the guest core finished a division by zero");
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "";
            if (!message.includes("divisor is 0")) {
              fail(`the guest core failed for another reason ${message}`);
            }
          }
          const faultsNow = readParkedFaults().filter((item) => item.kind === "fault").length;
          if (faultsNow !== faultCount) {
            fail("a guest-task fault was reported as a machine fault");
          }
          const logged = readFaults();
          const last = logged[logged.length - 1];
          if (logged.length !== beforeGuest + 1 || last?.Core !== 3) {
            fail("a guest-task fault was not kept in the log");
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
        if (coreState(0) !== CoreStateHalted || coreState(3) !== CoreStateHalted) {
          fail("a core was still running after the delivery samples");
        }
        /* 除零程序不能留着。0 号接下来要做寄存器核对，3 号稍后由固件装入装入程序。 */
        clearInstalled(0);
        clearInstalled(3);
      }
    }
  }
}
