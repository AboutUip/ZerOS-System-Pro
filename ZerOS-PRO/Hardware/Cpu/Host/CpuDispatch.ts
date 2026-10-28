/**
 * @module ZerOS.Hardware.Cpu.CpuDispatch
 * @description CPU 线程的消息调度
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 坐上 ActiveCpuProvider，接收主板的挂载和强制卸载。
 * 核心之间的传递留在本线程。访存仍由核心送给主板。
 * 不导入内存实现。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 消息
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as ActiveRoot } from "../ActiveProvider/Provider";
import { ZerOS as RuntimeRoot } from "../Bootstrap/CpuRuntime";
import { ZerOS as CpuSlotRoot } from "../../Motherboard/Slot/Cpu/CpuSlot";
import { ZerOS as CpuSelfCheckRoot } from "../Test/CpuSelfCheck";
import { ZerOS as InstructionRoot } from "../Structure/CpuInstruction";
import { ZerOS as BinaryRoot } from "../Structure/ProgramBinary";
import { ZerOS as DebugRunRoot } from "../../Debug/Host/DebugRun";
import { ZerOS as MailboxRoot } from "../../Motherboard/Host/Mailbox";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      const provider = ActiveRoot.Hardware.Cpu.ActiveCpuProvider;
      const CpuSlot = CpuSlotRoot.Hardware.Motherboard.Slot.CpuSlot;
      const acceptMountedCore = RuntimeRoot.Hardware.Cpu.acceptMountedCore;
      const adoptHostClock = RuntimeRoot.Hardware.Cpu.adoptHostClock;
      const noteCpuIdentity = RuntimeRoot.Hardware.Cpu.noteCpuIdentity;
      const adoptMetricPage = RuntimeRoot.Hardware.Cpu.adoptMetricPage;
      const dropCore = RuntimeRoot.Hardware.Cpu.dropCore;
      const runCpuSelfCheck = CpuSelfCheckRoot.Hardware.Cpu.runCpuSelfCheck;
      const runCpuRegisterCheck = CpuSelfCheckRoot.Hardware.Cpu.runCpuRegisterCheck;
      const parseCpuInstruction = InstructionRoot.Hardware.Cpu.parseCpuInstruction;
      const decodeProgramBinary = BinaryRoot.Hardware.Cpu.decodeProgramBinary;
      const isProgramBinary = BinaryRoot.Hardware.Cpu.isProgramBinary;
      const runSequence = RuntimeRoot.Hardware.Cpu.runSequence;
      const parkInstalledFaults = RuntimeRoot.Hardware.Cpu.parkInstalledFaults;
      const presentFaultFrame = RuntimeRoot.Hardware.Cpu.presentFaultFrame;
      const runBorrowed = RuntimeRoot.Hardware.Cpu.runBorrowed;
      const runGuest = RuntimeRoot.Hardware.Cpu.runGuest;
      const coreIsHalted = RuntimeRoot.Hardware.Cpu.coreIsHalted;
      const seatImage = RuntimeRoot.Hardware.Cpu.seatImage;
      const seatNativeImage = RuntimeRoot.Hardware.Cpu.seatNativeImage;
      const debugRunDecision = DebugRunRoot.Hardware.Debug.debugRunDecision;
      const DebugRunMessage = MailboxRoot.Hardware.Motherboard.MailMessage.DebugRun;
      const DebugResultMessage = MailboxRoot.Hardware.Motherboard.MailMessage.DebugResult;
      const seatPrefix = "[ZerOS.Hardware.Motherboard.CpuSeat]";

      function asRecord(data: unknown): Record<string, unknown> | null {
        if (typeof data !== "object" || data === null || Array.isArray(data)) {
          return null;
        }
        return data as Record<string, unknown>;
      }

      function postFault(message: string): void {
        globalThis.postMessage({ kind: "fault", message });
      }

      function readSupported(record: Record<string, unknown>): string[] | null {
        const value = record["supported"];
        if (!Array.isArray(value)) {
          return null;
        }
        const supported: string[] = [];
        for (const item of value) {
          if (typeof item !== "string") {
            return null;
          }
          supported.push(item);
        }
        return supported;
      }

      function onBind(record: Record<string, unknown>): void {
        const supported = readSupported(record);
        if (supported?.includes(provider.ActiveProtocol) !== true) {
          postFault(`${seatPrefix} board does not support CPU protocol ${provider.ActiveProtocol}`);
          return;
        }
        CpuSlot.Bind(provider);
        if (CpuSlot.GetActive() !== provider) {
          postFault(`${seatPrefix} the CPU provider is not seated`);
          return;
        }
        noteCpuIdentity(provider.ProviderId, provider.ProviderVendor, provider.ActiveProtocol);
        const origin = record["clockOrigin"];
        if (typeof origin === "number") {
          adoptHostClock(origin);
        }
        const metrics = record["metrics"];
        if (metrics instanceof SharedArrayBuffer) {
          adoptMetricPage(metrics);
        }
        globalThis.postMessage({ kind: "seated", coreCount: provider.CoreCount });
      }

      function onMount(record: Record<string, unknown>): void {
        const ordinal = record["ordinal"];
        const port = record["port"];
        if (typeof ordinal !== "number" || !(port instanceof MessagePort)) {
          postFault(`${seatPrefix} a mount message is missing the core or the port`);
          return;
        }
        try {
          acceptMountedCore(ordinal, port);
          port.start();
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : `${seatPrefix} mount failed`;
          postFault(message);
        }
      }

      function onUnload(record: Record<string, unknown>): void {
        const ordinal = record["ordinal"];
        if (typeof ordinal !== "number") {
          return;
        }
        dropCore(ordinal);
      }

      /** 挂载完成后核对调度和保持位。访存留到内存坐稳之后。 */
      function onExercise(): void {
        try {
          runCpuSelfCheck();
          globalThis.postMessage({ kind: "ok" });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : `${seatPrefix} CPU self-check failed`;
          postFault(message);
        }
      }

      /** 内存已经坐稳之后，核对寄存器和一次八位组往返。 */
      function onProbe(): void {
        void runCpuRegisterCheck().then(
          (): void => {
            /* 自检里故意的失败到此为止，不再补发。接下来固件的失败才送主板。 */
            parkInstalledFaults(false);
            globalThis.postMessage({ kind: "ok" });
          },
          (error: unknown): void => {
            parkInstalledFaults(false);
            const message = error instanceof Error ? error.message : `${seatPrefix} the core trial did not finish`;
            postFault(message);
          },
        );
      }

      /**
       * 两种交付进同一条执行路径。
       * `binary` 是无扩展名程序文件的字节，直接解码。
       * `lines` 仍是 ZAP 文本，先做助记符解析。两者都缺才算不完整。
       */
      function stepsOf(record: Record<string, unknown>): InstructionRoot.Hardware.Cpu.CpuInstruction[] | null {
        const binary = record["binary"];
        if (binary instanceof Uint8Array) {
          if (!isProgramBinary(binary)) {
            return null;
          }
          return decodeProgramBinary(binary);
        }
        const lines = record["lines"];
        if (!Array.isArray(lines)) {
          return null;
        }
        const steps: InstructionRoot.Hardware.Cpu.CpuInstruction[] = [];
        for (const line of lines) {
          if (typeof line !== "string") {
            return null;
          }
          const step = parseCpuInstruction(line);
          if (step !== null) {
            steps.push(step);
          }
        }
        return steps;
      }

      /**
       * 把程序装进一颗已停止的核心，不从第一条开始跑。
       * 成功回 ok。核心编号或映像不合格时回 fault，不改那颗核心。
       */
      function onSeat(record: Record<string, unknown>): void {
        const ordinal = record["ordinal"];
        if (typeof ordinal !== "number") {
          postFault(`${seatPrefix} the install target is incomplete`);
          return;
        }
        const binary = record["binary"];
        if (binary instanceof Uint8Array && binary.length >= 4 && binary[0] === 0x5a && binary[1] === 0x4e && binary[2] === 0x42 && binary[3] === 0x31) {
          try {
            seatNativeImage(ordinal, binary);
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : `${seatPrefix} install failed`;
            postFault(message);
            return;
          }
          globalThis.postMessage({ kind: "ok" });
          return;
        }
        let steps: InstructionRoot.Hardware.Cpu.CpuInstruction[];
        try {
          const parsed = stepsOf(record);
          if (parsed === null) {
            postFault(`${seatPrefix} the program image is incomplete`);
            return;
          }
          steps = parsed;
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : `${seatPrefix} the program image could not be decoded`;
          postFault(message);
          return;
        }
        try {
          seatImage(ordinal, steps);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : `${seatPrefix} install failed`;
          postFault(message);
          return;
        }
        globalThis.postMessage({ kind: "ok" });
      }

      /**
       * 失败帧走单独的完成消息。
       * 不发 kind 为 fault 的整机失败，否则主板会再画一次，两帧叠在一起。
       */
      function postFaultFrame(ok: boolean, message: string): void {
        globalThis.postMessage({ kind: "fault-frame-done", ok, message });
      }

      /**
       * 主板要求把失败帧画到面板上。
       * 0 号核心正跑固件时，由运行时在下一条指令边界接替，这里只等它画完。
       */
      function onFaultFrame(record: Record<string, unknown>): void {
        let steps: InstructionRoot.Hardware.Cpu.CpuInstruction[];
        try {
          const parsed = stepsOf(record);
          if (parsed === null || parsed.length < 1) {
            postFaultFrame(false, "fault picture was not drawn");
            return;
          }
          steps = parsed;
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "fault picture was not drawn";
          postFaultFrame(false, message);
          return;
        }
        void presentFaultFrame(steps).then(
          (): void => {
            postFaultFrame(true, "");
          },
          (error: unknown): void => {
            const message = error instanceof Error ? error.message : "fault picture was not drawn";
            postFaultFrame(false, message);
          },
        );
      }

      function onRun(record: Record<string, unknown>): void {
        let steps: InstructionRoot.Hardware.Cpu.CpuInstruction[];
        try {
          const parsed = stepsOf(record);
          if (parsed === null) {
            postFault(`${seatPrefix} the instruction sequence is incomplete`);
            return;
          }
          steps = parsed;
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : `${seatPrefix} the instructions could not be decoded`;
          postFault(message);
          return;
        }
        void runSequence(0, steps).then(
          (): void => {
            globalThis.postMessage({ kind: "ok" });
          },
          (error: unknown): void => {
            const message = error instanceof Error ? error.message : `${seatPrefix} the instruction sequence failed`;
            postFault(message);
          },
        );
      }
      export function acceptCpuMessage(data: unknown): void {
        const record = asRecord(data);
        if (record === null) {
          return;
        }
        const kind = record["kind"];
        if (typeof kind === "string") {
        }
        if (kind === "bind") {
          onBind(record);
          return;
        }
        if (kind === "mount") {
          onMount(record);
          return;
        }
        if (kind === "unload") {
          onUnload(record);
          return;
        }
        if (kind === "exercise") {
          onExercise();
          return;
        }
        if (kind === "probe") {
          onProbe();
          return;
        }
        if (kind === "run") {
          onRun(record);
          return;
        }
        if (kind === "fault-frame") {
          onFaultFrame(record);
          return;
        }
        if (kind === "seat") {
          onSeat(record);
          return;
        }
        if (kind === "guest") {
          onGuest(record);
          return;
        }
        if (kind === DebugRunMessage) {
          onDebug(record);
        }
      }

      /**
       * 调试开关打开、文本合法、并且 0 号核心已经停止时，才借用它跑这段 ZAP。
       * 用客程序那条返回，不把这段的失败画成整机停机。开关关闭时只回拒绝原因。
       */
      function onDebug(record: Record<string, unknown>): void {
        const lines = readDebugLines(record["lines"]);
        if (lines === null) {
          postDebug("debug run was refused");
          return;
        }
        /* 页面把固件开关放在消息里。这里的模块副本不是那一档。 */
        const enabled = record["enabled"] === true;
        const decision = debugRunDecision(enabled, lines, coreIsHalted(0));
        if (decision !== "") {
          postDebug(decision);
          return;
        }
        let steps: InstructionRoot.Hardware.Cpu.CpuInstruction[];
        try {
          const parsed = stepsOf({ lines });
          if (parsed === null || parsed.length < 1) {
            postDebug("debug run was refused");
            return;
          }
          steps = parsed;
        } catch (error: unknown) {
          postDebug(error instanceof Error ? error.message : "debug run was refused");
          return;
        }
        void runGuest(0, steps).then(
          (result): void => {
            postDebug(result.Ok ? "ok" : result.Message);
          },
          (error: unknown): void => {
            postDebug(error instanceof Error ? error.message : "debug run was refused");
          },
        );
      }

      function readDebugLines(value: unknown): string[] | null {
        if (!Array.isArray(value)) {
          return null;
        }
        const lines: string[] = [];
        for (const item of value) {
          if (typeof item !== "string") {
            return null;
          }
          lines.push(item);
        }
        return lines;
      }

      function postDebug(message: string): void {
        globalThis.postMessage({
          kind: DebugResultMessage,
          ok: message === "ok",
          message,
        });
      }

      /**
       * 在另一颗核心上跑一段指令。
       * 成功或失败都用 guest-done 送回，不用引导故障那条消息，避免客程序把固件循环打崩。
       */
      function onGuest(record: Record<string, unknown>): void {
        const ordinal = record["ordinal"];
        const ticket = record["ticket"];
        if (typeof ordinal !== "number" || typeof ticket !== "number") {
          postGuest(ticketOf(record), false, `${seatPrefix} the guest program is incomplete`, []);
          return;
        }
        let steps: InstructionRoot.Hardware.Cpu.CpuInstruction[];
        try {
          const parsed = stepsOf(record);
          if (parsed === null) {
            postGuest(ticket, false, `${seatPrefix} the guest program is incomplete`, []);
            return;
          }
          steps = parsed;
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : `${seatPrefix} the instructions could not be decoded`;
          postGuest(ticket, false, message, []);
          return;
        }
        void runBorrowed(ordinal, steps).then(
          (result): void => {
            postGuest(ticket, result.Ok, result.Message, result.Registers);
          },
          (error: unknown): void => {
            const message = error instanceof Error ? error.message : `${seatPrefix} the guest program failed`;
            postGuest(ticket, false, message, []);
          },
        );
      }

      function ticketOf(record: Record<string, unknown>): number {
        const ticket = record["ticket"];
        return typeof ticket === "number" ? ticket : 0;
      }

      function postGuest(ticket: number, ok: boolean, message: string, registers: readonly bigint[]): void {
        globalThis.postMessage({
          kind: "guest-done",
          ticket,
          ok,
          message,
          registers,
        });
      }
    }
  }
}
