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

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      const provider = ActiveRoot.Hardware.Cpu.ActiveCpuProvider;
      const CpuSlot = CpuSlotRoot.Hardware.Motherboard.Slot.CpuSlot;
      const acceptMountedCore = RuntimeRoot.Hardware.Cpu.acceptMountedCore;
      const adoptHostClock = RuntimeRoot.Hardware.Cpu.adoptHostClock;
      const noteCpuIdentity = RuntimeRoot.Hardware.Cpu.noteCpuIdentity;
      const dropCore = RuntimeRoot.Hardware.Cpu.dropCore;
      const runCpuSelfCheck = CpuSelfCheckRoot.Hardware.Cpu.runCpuSelfCheck;
      const runCpuRegisterCheck = CpuSelfCheckRoot.Hardware.Cpu.runCpuRegisterCheck;
      const parseCpuInstruction = InstructionRoot.Hardware.Cpu.parseCpuInstruction;
      const runSequence = RuntimeRoot.Hardware.Cpu.runSequence;
      const runGuest = RuntimeRoot.Hardware.Cpu.runGuest;
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
          postFault(`${seatPrefix} 主板不支持 CPU 协议 ${provider.ActiveProtocol}`);
          return;
        }
        CpuSlot.Bind(provider);
        if (CpuSlot.GetActive() !== provider) {
          postFault(`${seatPrefix} CPU 插头没有坐上插座`);
          return;
        }
        noteCpuIdentity(provider.ProviderId, provider.ProviderVendor, provider.ActiveProtocol);
        const origin = record["clockOrigin"];
        if (typeof origin === "number") {
          adoptHostClock(origin);
        }
        globalThis.postMessage({ kind: "seated", coreCount: provider.CoreCount });
      }

      function onMount(record: Record<string, unknown>): void {
        const ordinal = record["ordinal"];
        const port = record["port"];
        if (typeof ordinal !== "number" || !(port instanceof MessagePort)) {
          postFault(`${seatPrefix} 挂载消息缺少核心编号或端口`);
          return;
        }
        try {
          acceptMountedCore(ordinal, port);
          port.start();
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : `${seatPrefix} 挂载失败`;
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
          const message = error instanceof Error ? error.message : `${seatPrefix} CPU 自检失败`;
          postFault(message);
        }
      }

      /** 内存已经坐稳之后，核对寄存器和一次八位组往返。 */
      function onProbe(): void {
        void runCpuRegisterCheck().then(
          (): void => {
            globalThis.postMessage({ kind: "ok" });
          },
          (error: unknown): void => {
            const message = error instanceof Error ? error.message : `${seatPrefix} 核心试执行失败`;
            postFault(message);
          },
        );
      }

      function onRun(record: Record<string, unknown>): void {
        const lines = record["lines"];
        if (!Array.isArray(lines)) {
          postFault(`${seatPrefix} 指令序列不完整`);
          return;
        }
        const steps: InstructionRoot.Hardware.Cpu.CpuInstruction[] = [];
        for (const line of lines) {
          if (typeof line !== "string") {
            postFault(`${seatPrefix} 指令序列不完整`);
            return;
          }
          try {
            const step = parseCpuInstruction(line);
            if (step !== null) {
              steps.push(step);
            }
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : `${seatPrefix} 指令无法解析`;
            postFault(message);
            return;
          }
        }
        void runSequence(0, steps).then(
          (): void => {
            globalThis.postMessage({ kind: "ok" });
          },
          (error: unknown): void => {
            const message = error instanceof Error ? error.message : `${seatPrefix} 指令序列失败`;
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
        if (kind === "guest") {
          onGuest(record);
        }
      }

      /**
       * 在另一颗核心上跑一段指令。
       * 成功或失败都用 guest-done 送回，不用引导故障那条消息，避免客程序把固件循环打崩。
       */
      function onGuest(record: Record<string, unknown>): void {
        const ordinal = record["ordinal"];
        const lines = record["lines"];
        const ticket = record["ticket"];
        if (typeof ordinal !== "number" || typeof ticket !== "number" || !Array.isArray(lines)) {
          postGuest(ticketOf(record), false, `${seatPrefix} 客程序不完整`, []);
          return;
        }
        const steps: InstructionRoot.Hardware.Cpu.CpuInstruction[] = [];
        for (const line of lines) {
          if (typeof line !== "string") {
            postGuest(ticket, false, `${seatPrefix} 客程序不完整`, []);
            return;
          }
          try {
            const step = parseCpuInstruction(line);
            if (step !== null) {
              steps.push(step);
            }
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : `${seatPrefix} 指令无法解析`;
            postGuest(ticket, false, message, []);
            return;
          }
        }
        void runGuest(ordinal, steps).then(
          (result): void => {
            postGuest(ticket, result.Ok, result.Message, result.Registers);
          },
          (error: unknown): void => {
            const message = error instanceof Error ? error.message : `${seatPrefix} 客程序失败`;
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
