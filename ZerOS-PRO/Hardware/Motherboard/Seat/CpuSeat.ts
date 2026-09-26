/**
 * @module ZerOS.Hardware.Motherboard.CpuSeat
 * @description 主板上的 CPU 座
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 按实现声明的 CoreCount 挂载核心，每个核心一条 Worker。
 * 主板只挂载和强制卸载。调度、传递由 CPU 线程负责。
 * 核心发出的访存命令在这里进入已经有的内存指令。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 坐座与卸载
 *   3. 访存命令
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as BoardSupportRoot } from "../Config/BoardSupport";
import { ZerOS as ClockRoot } from "../../Clock/Bootstrap/HostClock";
import { ZerOS as ExecuteRoot } from "../Channel/ExecuteMemoryInstruction";
import { ZerOS as GpuSeatRoot } from "./GpuSeat";
import { ZerOS as InboxRoot } from "../Host/Inbox";
import { ZerOS as InstructionRoot } from "../Structure/MemoryInstruction";
import { ZerOS as MailboxRoot } from "../Host/Mailbox";
import { ZerOS as MemoryLinkRoot } from "../Host/MemoryLink";
import { ZerOS as OpcodeRoot } from "../Enum/MemoryOpcode";
import { ZerOS as PortRoot } from "../Slot/Expansion/ExpansionPort";
import { ZerOS as QueryRoot } from "../Host/HardwareQuery";
import { ZerOS as SandboxRuntimeRoot } from "../../Sandbox/Bootstrap/SandboxRuntime";
import { ZerOS as QueuedRoot } from "../Host/QueuedWorker";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      const seatPrefix = "[ZerOS.Hardware.Motherboard.CpuSeat]";
      const createMemoryInstruction = InstructionRoot.Hardware.Motherboard.createMemoryInstruction;
      const ExecuteLoad = ExecuteRoot.Hardware.Motherboard.ExecuteLoad;
      const ExecuteStore = ExecuteRoot.Hardware.Motherboard.ExecuteStore;
      const presentFrame = GpuSeatRoot.Hardware.Motherboard.presentFrame;
      const applyGpuCommand = GpuSeatRoot.Hardware.Motherboard.applyGpuCommand;
      const applyGpuBatch = GpuSeatRoot.Hardware.Motherboard.applyGpuBatch;
      const pullInbox = InboxRoot.Hardware.Motherboard.pullInbox;
      const Exchange = PortRoot.Hardware.Motherboard.Slot.Exchange;
      const Identity = PortRoot.Hardware.Motherboard.Slot.Identity;
      const FieldChar = PortRoot.Hardware.Motherboard.Slot.FieldChar;
      const State = PortRoot.Hardware.Motherboard.Slot.State;
      const queryHardware = QueryRoot.Hardware.Motherboard.queryHardware;
      const sharedMemoryLink = MemoryLinkRoot.Hardware.Motherboard.sharedMemoryLink;
      const MailMessage = MailboxRoot.Hardware.Motherboard.MailMessage;
      const memoryOpcodeDirection = OpcodeRoot.Hardware.Motherboard.memoryOpcodeDirection;
      const ChannelDirectionRead = 0;

      interface LiveCore {
        readonly worker: Worker;
        readonly boardPort: MessagePort;
      }

      let cpuWorker: Worker | null = null;
      let declared = 0;
      const live = new Map<number, LiveCore>();

      function asRecord(data: unknown): Record<string, unknown> | null {
        if (typeof data !== "object" || data === null || Array.isArray(data)) {
          return null;
        }
        return data as Record<string, unknown>;
      }

      function waitMessage(
        worker: Worker,
        accept: (record: Record<string, unknown>) => boolean,
        timeoutMessage: string,
        side?: (record: Record<string, unknown>) => void,
      ): Promise<Record<string, unknown>> {
        return new Promise((resolve, reject): void => {
          const timer = setTimeout((): void => {
            reject(new Error(timeoutMessage));
          }, 30000);
          worker.onmessage = (event: MessageEvent): void => {
            const record = asRecord(event.data as unknown);
            if (record === null) {
              return;
            }
            if (record["kind"] === "trace") {
              side?.(record);
              return;
            }
            if (record["kind"] === "fault" && typeof record["message"] === "string") {
              clearTimeout(timer);
              reject(new Error(record["message"]));
              return;
            }
            if (!accept(record)) {
              return;
            }
            clearTimeout(timer);
            resolve(record);
          };
        });
      }

      function replyCore(port: MessagePort, ok: boolean, isStore: boolean, value: bigint, message: string): void {
        port.postMessage({ kind: "exec-result", ok, isStore, value, message });
      }

      function onCoreGpu(port: MessagePort, record: Record<string, unknown>): void {
        const gpuOp = record["gpuOp"];
        if (typeof gpuOp !== "string") {
          replyCore(port, false, true, 0n, `${seatPrefix} 显卡命令不完整`);
          return;
        }
        void (async (): Promise<void> => {
          try {
            if (gpuOp === "present") {
              const frame = await presentFrame();
              const buffer = frame.pixels.buffer;
              if (!(buffer instanceof ArrayBuffer)) {
                replyCore(port, false, true, 0n, `${seatPrefix} 帧副本无法转交`);
                return;
              }
              globalThis.postMessage(
                {
                  kind: MailMessage.Frame,
                  frameWidth: frame.frameWidth,
                  frameHeight: frame.frameHeight,
                  pixels: frame.pixels,
                },
                { transfer: [buffer] },
              );
              replyCore(port, true, true, 0n, "");
              return;
            }
            const id = await applyGpuCommand(record);
            if (id === null) {
              replyCore(port, true, true, 0n, "");
              return;
            }
            replyCore(port, true, false, BigInt(id), "");
            return;
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : `${seatPrefix} 显卡命令失败`;
            replyCore(port, false, true, 0n, message);
          }
        })();
      }

      function onCoreGpuBatch(port: MessagePort, record: Record<string, unknown>): void {
        const commands = record["commands"];
        /* 核心已经按指令顺序抄好整数。这里只负责一次送进显卡，再一次把成败交回核心。 */
        if (!Array.isArray(commands)) {
          port.postMessage({ kind: "gpu-batch-result", ok: false, message: `${seatPrefix} 显卡队列不完整` });
          return;
        }
        const batch: Record<string, unknown>[] = [];
        for (const item of commands) {
          if (typeof item !== "object" || item === null || Array.isArray(item)) {
            port.postMessage({ kind: "gpu-batch-result", ok: false, message: `${seatPrefix} 显卡队列里有一条不完整` });
            return;
          }
          batch.push(item as Record<string, unknown>);
        }
        void (async (): Promise<void> => {
          try {
            await applyGpuBatch(batch);
            port.postMessage({ kind: "gpu-batch-result", ok: true, message: "" });
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : `${seatPrefix} 显卡队列失败`;
            port.postMessage({ kind: "gpu-batch-result", ok: false, message });
          }
        })();
      }

      function onCorePort(port: MessagePort, record: Record<string, unknown>): void {
        const kind = record["kind"];
        try {
          if (kind === "port-state") {
            const index = record["port"];
            if (typeof index !== "number") {
              throw new Error(`${seatPrefix} 扩展口编号不完整`);
            }
            port.postMessage({ kind: "port-result", ok: true, value: BigInt(State(index)), message: "" });
            return;
          }
          if (kind === "port-char") {
            const index = record["port"];
            const offset = record["offset"];
            if (typeof index !== "number" || typeof offset !== "number") {
              throw new Error(`${seatPrefix} 设备标识读取不完整`);
            }
            port.postMessage({ kind: "port-result", ok: true, value: BigInt(Identity(index, offset)), message: "" });
            return;
          }
          if (kind === "port-byte") {
            const index = record["port"];
            const field = record["field"];
            const offset = record["offset"];
            if (typeof index !== "number" || typeof field !== "number" || typeof offset !== "number") {
              throw new Error(`${seatPrefix} 设备字段读取不完整`);
            }
            port.postMessage({ kind: "port-result", ok: true, value: BigInt(FieldChar(index, field, offset)), message: "" });
            return;
          }
          if (kind === "query") {
            const seat = record["seat"];
            const field = record["field"];
            const index = record["index"];
            if (typeof seat !== "number" || typeof field !== "number" || typeof index !== "number") {
              throw new Error(`${seatPrefix} 查询命令不完整`);
            }
            port.postMessage({ kind: "port-result", ok: true, value: queryHardware(seat, field, index), message: "" });
            return;
          }
          if (kind === "query-span") {
            const seat = record["seat"];
            const field = record["field"];
            const index = record["index"];
            const count = record["count"];
            if (typeof seat !== "number" || typeof field !== "number" || typeof index !== "number" || typeof count !== "number") {
              throw new Error(`${seatPrefix} 查询命令不完整`);
            }
            if (!Number.isInteger(count) || count < 1 || count > 32) {
              throw new Error(`${seatPrefix} 查询跨度不在 1 到 32`);
            }
            const values: bigint[] = [];
            for (let step = 0; step < count; step += 1) {
              values.push(queryHardware(seat, field, index + step));
            }
            const first = values[0] ?? 0n;
            port.postMessage({ kind: "port-result", ok: true, value: first, values, message: "" });
            return;
          }
          const index = record["port"];
          const direction = record["direction"];
          const data = record["data"];
          if (typeof index !== "number" || typeof direction !== "number" || typeof data !== "bigint") {
            throw new Error(`${seatPrefix} 交换命令不完整`);
          }
          if (data < 0n || data > 0xffffffffffffffffn) {
            throw new Error(`${seatPrefix} 交换的整数超出 64 位`);
          }
          const payload = new Uint8Array(8);
          let rest = data;
          for (let octet = 0; octet < 8; octet += 1) {
            payload[octet] = Number(rest & 0xffn);
            rest >>= 8n;
          }
          const result = Exchange(index, direction, payload);
          if (result.length !== 8) {
            throw new Error(`${seatPrefix} 交换结果不是 8 个八位组`);
          }
          let value = 0n;
          for (let octet = 0; octet < 8; octet += 1) {
            value += BigInt(result[octet] ?? 0) << BigInt(octet * 8);
          }
          port.postMessage({ kind: "port-result", ok: true, value, message: "" });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : `${seatPrefix} 扩展口访问失败`;
          port.postMessage({ kind: "port-result", ok: false, value: 0n, message });
        }
      }

      function onCoreMemoryClock(port: MessagePort, record: Record<string, unknown>): void {
        const link = sharedMemoryLink();
        try {
          if (record["kind"] === "mem-hertz") {
            const hertz = record["hertz"];
            if (typeof hertz !== "number") {
              replyCore(port, false, true, 0n, `${seatPrefix} 内存频率不完整`);
              return;
            }
            link.setHertz(BigInt(hertz));
            replyCore(port, true, true, 0n, "");
            return;
          }
          const metric = record["metric"];
          if (typeof metric !== "number") {
            replyCore(port, false, false, 0n, `${seatPrefix} 内存指标不完整`);
            return;
          }
          const value = link.metric(BigInt(metric));
          replyCore(port, true, false, value, "");
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : `${seatPrefix} 内存频率失败`;
          replyCore(port, false, true, 0n, message);
        }
      }

      function onCoreExec(port: MessagePort, data: unknown): void {
        const record = asRecord(data);
        if (record?.["kind"] === "inbox") {
          const word = pullInbox();
          port.postMessage({
            kind: "inbox-result",
            found: word === null ? 0n : 1n,
            value: word ?? 0n,
          });
          return;
        }
        if (record?.["kind"] === "mem-hertz" || record?.["kind"] === "mem-metric") {
          onCoreMemoryClock(port, record);
          return;
        }
        if (record?.["kind"] === "xchg" || record?.["kind"] === "port-state" || record?.["kind"] === "port-char" || record?.["kind"] === "port-byte" || record?.["kind"] === "query" || record?.["kind"] === "query-span") {
          onCorePort(port, record);
          return;
        }
        if (record?.["kind"] === "gpu") {
          onCoreGpu(port, record);
          return;
        }
        if (record?.["kind"] === "gpu-batch") {
          onCoreGpuBatch(port, record);
          return;
        }
        if (record?.["kind"] !== "exec") {
          return;
        }
        const opcode = record["opcode"];
        const address = record["address"];
        const word = record["data"];
        if (typeof opcode !== "number" || typeof address !== "bigint" || typeof word !== "bigint") {
          port.postMessage({
            kind: "exec-result",
            ok: false,
            isStore: false,
            value: 0n,
            message: `${seatPrefix} 访存命令不完整`,
          });
          return;
        }
        try {
          const instruction = createMemoryInstruction(opcode, address, word);
          const direction = memoryOpcodeDirection(instruction.Opcode);
          if (direction === ChannelDirectionRead) {
            const value = ExecuteLoad(instruction);
            port.postMessage({ kind: "exec-result", ok: true, isStore: false, value, message: "" });
            return;
          }
          ExecuteStore(instruction);
          port.postMessage({ kind: "exec-result", ok: true, isStore: true, value: 0n, message: "" });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : `${seatPrefix} 访存失败`;
          port.postMessage({ kind: "exec-result", ok: false, isStore: false, value: 0n, message });
        }
      }

      function mountOne(ordinal: number): void {
        const worker = QueuedRoot.Hardware.Motherboard.openCoreWorker();
        const boardChannel = new MessageChannel();
        const cpuChannel = new MessageChannel();
        const cpu = cpuWorker;
        if (cpu === null) {
          throw new Error(`${seatPrefix} CPU 线程还没有起来`);
        }
        boardChannel.port1.onmessage = (event: MessageEvent): void => {
          onCoreExec(boardChannel.port1, event.data as unknown);
        };
        boardChannel.port1.start();
        worker.postMessage(
          {
            kind: "core",
            ordinal,
            boardPort: boardChannel.port2,
            cpuPort: cpuChannel.port2,
          },
          [boardChannel.port2, cpuChannel.port2],
        );
        cpu.postMessage({ kind: "mount", ordinal, port: cpuChannel.port1 }, [cpuChannel.port1]);
        live.set(ordinal, { worker, boardPort: boardChannel.port1 });
      }

      /**
       * 坐上 CPU，并按它声明的核心数逐个挂载。
       * 挂载完成后由 CPU 自己调度 0 号核心做一次读位元。
       */
      export async function seatCpu(): Promise<void> {
        const supported = BoardSupportRoot.Hardware.Motherboard.SupportedCpuProtocols;
        const worker = QueuedRoot.Hardware.Motherboard.openCpuWorker();
        cpuWorker = worker;
        const ready = waitMessage(
          worker,
          (record): boolean => record["kind"] === "ready",
          `${seatPrefix} CPU 线程没有就绪`,
        );
        await ready;
        worker.postMessage({
          kind: "bind",
          supported,
          clockOrigin: ClockRoot.Hardware.Clock.clockOrigin(),
        });
        const seated = await waitMessage(
          worker,
          (record): boolean => record["kind"] === "seated",
          `${seatPrefix} CPU 没有坐上`,
        );
        const coreCount = seated["coreCount"];
        if (typeof coreCount !== "number" || !Number.isInteger(coreCount) || coreCount < 1) {
          throw new Error(`${seatPrefix} CPU 没有声明合法的核心数`);
        }
        declared = coreCount;
        for (let ordinal = 0; ordinal < coreCount; ordinal += 1) {
          mountOne(ordinal);
        }
        worker.postMessage({ kind: "exercise" });
        await waitMessage(
          worker,
          (record): boolean => record["kind"] === "ok",
          `${seatPrefix} CPU 试执行没有完成`,
        );
      }

      /**
       * 内存坐稳并且引导 logo 已经送上面板之后，补做寄存器和访存核对。
       */
      export async function probeCpu(): Promise<void> {
        const worker = cpuWorker;
        if (worker === null) {
          throw new Error(`${seatPrefix} CPU 还没有坐上`);
        }
        worker.postMessage({ kind: "probe" });
        await waitMessage(
          worker,
          (record): boolean => record["kind"] === "ok",
          `${seatPrefix} CPU 访存核对没有完成`,
        );
      }

      /**
       * 把一段指令文本交给 CPU。CPU 自己从第一条执行到 halt。
       * 主板不解释 ZAP。CPU 不再逐条把指令文本送出来。
       */
      /**
       * 把无扩展名程序二进制交给 CPU。CPU 按记录解码，不再解析助记符。
       * 字节必须已经展开标号。主板不解释这些字节。
       */
      export async function runInstructionBinary(binary: Uint8Array): Promise<void> {
        const worker = cpuWorker;
        if (worker === null) {
          throw new Error(`${seatPrefix} CPU 还没有坐上`);
        }
        worker.postMessage({ kind: "run", binary });
        await waitMessage(
          worker,
          (record): boolean => record["kind"] === "ok",
          `${seatPrefix} 指令序列没有完成`,
          (record): void => {
            const text = record["text"];
            if (typeof text === "string") {
              globalThis.postMessage({ kind: "trace", text });
            }
          },
        );
      }

      export async function runInstructionLines(lines: readonly string[]): Promise<void> {
        const worker = cpuWorker;
        if (worker === null) {
          throw new Error(`${seatPrefix} CPU 还没有坐上`);
        }
        worker.postMessage({ kind: "run", lines });
        await waitMessage(
          worker,
          (record): boolean => record["kind"] === "ok",
          `${seatPrefix} 指令序列没有完成`,
          (record): void => {
            const text = record["text"];
            if (typeof text === "string") {
              globalThis.postMessage({ kind: "trace", text });
            }
          },
        );
      }

      /** 交给 CPU 一段不主动 halt 的二进制固件。不等待结束。失败时调用 onFault。 */
      export function startResidentBinary(binary: Uint8Array, onFault: (message: string) => void): void {
        const worker = cpuWorker;
        if (worker === null) {
          throw new Error(`${seatPrefix} CPU 还没有坐上`);
        }
        worker.onmessage = (event: MessageEvent): void => {
          const record = asRecord(event.data as unknown);
          if (record === null) {
            return;
          }
          if (record["kind"] === "guest-done") {
            noteGuest(record);
            return;
          }
          if (record["kind"] === "fault" && typeof record["message"] === "string") {
            onFault(record["message"]);
          }
        };
        worker.postMessage({ kind: "run", binary });
      }

      /**
       * 交给 CPU 一段不主动 halt 的固件。
       * 不等待结束。失败时调用 onFault，由调用方决定要不要再画异常画面。
       */
      export function startResidentLines(lines: readonly string[], onFault: (message: string) => void): void {
        const worker = cpuWorker;
        if (worker === null) {
          throw new Error(`${seatPrefix} CPU 还没有坐上`);
        }
        worker.onmessage = (event: MessageEvent): void => {
          const record = asRecord(event.data as unknown);
          if (record === null) {
            return;
          }
          if (record["kind"] === "guest-done") {
            noteGuest(record);
            return;
          }
          if (record["kind"] === "fault" && typeof record["message"] === "string") {
            onFault(record["message"]);
          }
        };
        worker.postMessage({ kind: "run", lines });
      }

      /**
       * 让一颗不在跑固件的核心执行一段 ZAP。
       * 结果稍后以 guest-done 回来，写进沙盒。这里不等待，也不把失败画成引导故障。
       */
      export function startGuest(ordinal: number, lines: readonly string[], ticket: number): void {
        const worker = cpuWorker;
        if (worker === null) {
          throw new Error(`${seatPrefix} CPU 还没有坐上`);
        }
        worker.postMessage({ kind: "guest", ordinal, lines, ticket });
      }

      function noteGuest(record: Record<string, unknown>): void {
        const ticket = record["ticket"];
        const ok = record["ok"] === true;
        const message = record["message"];
        const incoming = record["registers"];
        if (typeof ticket !== "number" || typeof message !== "string" || !Array.isArray(incoming)) {
          return;
        }
        const registers: bigint[] = [];
        for (const item of incoming) {
          if (typeof item !== "bigint") {
            return;
          }
          registers.push(item);
        }
        SandboxRuntimeRoot.Hardware.Sandbox.noteGuestResult(ticket, ok, message, registers);
      }

      /**
       * 强制卸载一个已挂载核心。
       * 编号超出该实现声明的范围时拒绝。卸载通知 CPU，主板不转交它的保持位。
       */
      export function ForceUnload(ordinal: number): void {
        if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= declared) {
          throw new Error(`${seatPrefix} 不能卸载声明范围外的核心`);
        }
        const core = live.get(ordinal);
        if (core === undefined) {
          throw new Error(`${seatPrefix} 这个核心不在座上`);
        }
        core.worker.terminate();
        live.delete(ordinal);
        const cpu = cpuWorker;
        if (cpu !== null) {
          cpu.postMessage({ kind: "unload", ordinal });
        }
      }
    }
  }
}
