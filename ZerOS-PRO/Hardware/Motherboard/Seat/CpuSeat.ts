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
 * 一批出核心的访存、查询和端口也在这里按原顺序做完，中间失败就停下。这不是客机能看见的新指令。
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
      const presentSurface = GpuSeatRoot.Hardware.Motherboard.presentSurface;
      /**
       * 第一份客程序画面按像素读回。
       * 那一帧是启动 logo，页面靠像素认出六个点并换色。之后的 BIOS 和加载画面改交位图。
       */
      let splashReadback = true;
      const applyGpuCommand = GpuSeatRoot.Hardware.Motherboard.applyGpuCommand;
      const applyGpuBatch = GpuSeatRoot.Hardware.Motherboard.applyGpuBatch;
      const pullInbox = InboxRoot.Hardware.Motherboard.pullInbox;
      const Exchange = PortRoot.Hardware.Motherboard.Slot.Exchange;
      const Drain = PortRoot.Hardware.Motherboard.Slot.Drain;
      const Carry = PortRoot.Hardware.Motherboard.Slot.Carry;
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

      /**
       * 把 CPU 线程的停机记录转到页面。
       * 用 addEventListener，不用 onmessage。waitMessage 和常驻固件都会换掉 onmessage，
       * 换掉之后这条监听还在，固件跑起来以后的停机也不会被吃掉。
       */
      function forwardCoreStop(data: unknown): void {
        const record = asRecord(data);
        if (record?.["kind"] !== MailMessage.CoreStop) {
          return;
        }
        const ordinal = record["ordinal"];
        const reason = record["reason"];
        const index = record["index"];
        const op = record["op"];
        const detail = record["detail"];
        if (typeof ordinal !== "number" || typeof reason !== "number" || typeof index !== "number" || typeof op !== "string" || typeof detail !== "string") {
          return;
        }
        globalThis.postMessage({
          kind: MailMessage.CoreStop,
          ordinal,
          reason,
          index,
          op,
          detail,
        });
      }

      /**
       * 客核心的失败日志和调试运行的结果也从这条监听转出。
       * 常驻固件会换掉 onmessage，换掉之后这两种消息仍要到页面。
       */
      function forwardHostNote(data: unknown): void {
        const record = asRecord(data);
        const kind = record?.["kind"];
        if (kind !== MailMessage.FaultLog && kind !== MailMessage.DebugResult) {
          return;
        }
        globalThis.postMessage(record);
      }

      function postExchangeResult(port: MessagePort, result: Uint8Array): void {
        if (result.length !== 8) {
          port.postMessage({ kind: "port-result", ok: false, value: 0n, message: `${seatPrefix} exchange result is not 8 octets` });
          return;
        }
        let value = 0n;
        for (let octet = 0; octet < 8; octet += 1) {
          value += BigInt(result[octet] ?? 0) << BigInt(octet * 8);
        }
        port.postMessage({ kind: "port-result", ok: true, value, message: "" });
      }

      function replyCore(port: MessagePort, ok: boolean, isStore: boolean, value: bigint, message: string): void {
        port.postMessage({ kind: "exec-result", ok, isStore, value, message });
      }

      /**
       * 把一帧送到页面。
       * 位图和像素缓冲都是转交：送出之后这里不能再读。两边都没有就失败。
       */
      function publishFrame(frameWidth: number, frameHeight: number, pixels: Uint32Array | null, bitmap: ImageBitmap | null): boolean {
        if (bitmap !== null) {
          globalThis.postMessage(
            {
              kind: MailMessage.Frame,
              frameWidth,
              frameHeight,
              bitmap,
            },
            { transfer: [bitmap] },
          );
          return true;
        }
        if (pixels === null) {
          return false;
        }
        const buffer = pixels.buffer;
        if (!(buffer instanceof ArrayBuffer)) {
          return false;
        }
        globalThis.postMessage(
          {
            kind: MailMessage.Frame,
            frameWidth,
            frameHeight,
            pixels,
          },
          { transfer: [buffer] },
        );
        return true;
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
              if (splashReadback) {
                splashReadback = false;
                const frame = await presentFrame();
                if (!publishFrame(frame.frameWidth, frame.frameHeight, frame.pixels, null)) {
                  replyCore(port, false, true, 0n, `${seatPrefix} 帧副本无法转交`);
                  return;
                }
                replyCore(port, true, true, 0n, "");
                return;
              }
              const frame = await presentSurface();
              if (!publishFrame(frame.frameWidth, frame.frameHeight, frame.pixels, frame.bitmap)) {
                replyCore(port, false, true, 0n, `${seatPrefix} 帧副本无法转交`);
                return;
              }
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
          if (kind === "carry") {
            const index = record["port"];
            const handle = record["handle"];
            const offset = record["offset"];
            const address = record["address"];
            const count = record["count"];
            if (typeof index !== "number" || typeof handle !== "number" || typeof offset !== "number" || typeof address !== "bigint" || typeof count !== "number") {
              throw new Error(`${seatPrefix} fill command is incomplete`);
            }
            void Carry(index, handle, offset, count).then((carried) => {
              if (carried === null) {
                port.postMessage({ kind: "port-result", ok: false, value: 0n, message: `${seatPrefix} this port cannot fill` });
                return;
              }
              if (carried.status !== 0) {
                port.postMessage({ kind: "port-result", ok: true, value: BigInt(-carried.status), message: "" });
                return;
              }
              try {
                sharedMemoryLink().writeSpan(address, carried.bytes);
                port.postMessage({ kind: "port-result", ok: true, value: BigInt(carried.bytes.length), message: "" });
              } catch (error: unknown) {
                const message = error instanceof Error ? error.message : `${seatPrefix} 按句柄读取失败`;
                port.postMessage({ kind: "port-result", ok: false, value: 0n, message });
              }
            }).catch((error: unknown) => {
              const message = error instanceof Error ? error.message : `${seatPrefix} 按句柄读取失败`;
              port.postMessage({ kind: "port-result", ok: false, value: 0n, message });
            });
            return;
          }
          if (kind === "fill") {
            const index = record["port"];
            const address = record["address"];
            const count = record["count"];
            if (typeof index !== "number" || typeof address !== "bigint" || typeof count !== "number") {
              throw new Error(`${seatPrefix} carry command is incomplete`);
            }
            const drained = Drain(index, count);
            if (drained === null) {
              throw new Error(`${seatPrefix} this port cannot carry`);
            }
            if (drained.status !== 0) {
              port.postMessage({ kind: "port-result", ok: true, value: BigInt(-drained.status), message: "" });
              return;
            }
            sharedMemoryLink().writeSpan(address, drained.bytes);
            port.postMessage({ kind: "port-result", ok: true, value: BigInt(drained.bytes.length), message: "" });
            return;
          }
          if (kind === "port-state") {
            const index = record["port"];
            if (typeof index !== "number") {
              throw new Error(`${seatPrefix} port ordinal is incomplete`);
            }
            port.postMessage({ kind: "port-result", ok: true, value: BigInt(State(index)), message: "" });
            return;
          }
          if (kind === "port-char") {
            const index = record["port"];
            const offset = record["offset"];
            if (typeof index !== "number" || typeof offset !== "number") {
              throw new Error(`${seatPrefix} device id read is incomplete`);
            }
            port.postMessage({ kind: "port-result", ok: true, value: BigInt(Identity(index, offset)), message: "" });
            return;
          }
          if (kind === "port-byte") {
            const index = record["port"];
            const field = record["field"];
            const offset = record["offset"];
            if (typeof index !== "number" || typeof field !== "number" || typeof offset !== "number") {
              throw new Error(`${seatPrefix} device field read is incomplete`);
            }
            port.postMessage({ kind: "port-result", ok: true, value: BigInt(FieldChar(index, field, offset)), message: "" });
            return;
          }
          if (kind === "query") {
            const seat = record["seat"];
            const field = record["field"];
            const index = record["index"];
            if (typeof seat !== "number" || typeof field !== "number" || typeof index !== "number") {
              throw new Error(`${seatPrefix} query command is incomplete`);
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
              throw new Error(`${seatPrefix} query command is incomplete`);
            }
            if (!Number.isInteger(count) || count < 1 || count > 32) {
              throw new Error(`${seatPrefix} query span is outside 1 to 32`);
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
            throw new Error(`${seatPrefix} exchange command is incomplete`);
          }
          if (data < 0n || data > 0xffffffffffffffffn) {
            throw new Error(`${seatPrefix} exchange integer does not fit in 64 bits`);
          }
          const payload = new Uint8Array(8);
          let rest = data;
          for (let octet = 0; octet < 8; octet += 1) {
            payload[octet] = Number(rest & 0xffn);
            rest >>= 8n;
          }
          const result = Exchange(index, direction, payload);
          if (result instanceof Promise) {
            void result.then((value: Uint8Array) => {
              postExchangeResult(port, value);
            }).catch((error: unknown) => {
              const message = error instanceof Error ? error.message : `${seatPrefix} 扩展口访问失败`;
              port.postMessage({ kind: "port-result", ok: false, value: 0n, message });
            });
            return;
          }
          postExchangeResult(port, result);
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

      interface SettledAccess {
        readonly value: bigint;
        readonly found: number;
        readonly span: bigint[] | null;
      }

      function batchBytes(value: unknown, length: number): Uint8Array | null {
        if (!(value instanceof Uint8Array) || value.length !== length) {
          return null;
        }
        return value;
      }

      function batchNumbers(value: unknown, length: number): number[] | null {
        if (!Array.isArray(value) || value.length !== length) {
          return null;
        }
        const numbers: number[] = [];
        for (let index = 0; index < length; index += 1) {
          const item: unknown = value[index];
          if (typeof item !== "number" || !Number.isInteger(item)) {
            return null;
          }
          numbers.push(item);
        }
        return numbers;
      }

      function batchBigints(value: unknown, length: number): bigint[] | null {
        if (!Array.isArray(value) || value.length !== length) {
          return null;
        }
        const words: bigint[] = [];
        for (const item of value) {
          if (typeof item !== "bigint") {
            return null;
          }
          words.push(item);
        }
        return words;
      }

      /**
       * 做批里的一条。失败抛出原来的语句，调用方停在这一条，不继续后面的。
       * 种类编号与核心里的 AccessExec 起一组相同，只在这条内部消息上使用。
       */
      async function settleOne(
        tag: number,
        opcode: number,
        address: bigint,
        data: bigint,
        a: number,
        b: number,
        c: number,
        d: number,
      ): Promise<SettledAccess> {
        if (tag === 1) {
          const instruction = createMemoryInstruction(opcode, address, data);
          const direction = memoryOpcodeDirection(instruction.Opcode);
          if (direction === ChannelDirectionRead) {
            return { value: ExecuteLoad(instruction), found: 0, span: null };
          }
          ExecuteStore(instruction);
          return { value: 0n, found: 0, span: null };
        }
        if (tag === 2) {
          if (d > 1) {
            if (!Number.isInteger(d) || d > 32) {
              throw new Error(`${seatPrefix} query span is outside 1 to 32`);
            }
            const span: bigint[] = [];
            for (let step = 0; step < d; step += 1) {
              span.push(queryHardware(a, b, c + step));
            }
            return { value: span[0] ?? 0n, found: 0, span };
          }
          return { value: queryHardware(a, b, c), found: 0, span: null };
        }
        if (tag === 3) {
          const word = pullInbox();
          return { value: word ?? 0n, found: word === null ? 0 : 1, span: null };
        }
        if (tag === 4) {
          if (data < 0n || data > 0xffffffffffffffffn) {
            throw new Error(`${seatPrefix} exchange integer does not fit in 64 bits`);
          }
          const payload = new Uint8Array(8);
          let rest = data;
          for (let octet = 0; octet < 8; octet += 1) {
            payload[octet] = Number(rest & 0xffn);
            rest >>= 8n;
          }
          const exchanged = Exchange(a, b, payload);
          const bytes = exchanged instanceof Promise ? await exchanged : exchanged;
          if (bytes.length !== 8) {
            throw new Error(`${seatPrefix} exchange result is not 8 octets`);
          }
          let value = 0n;
          for (let octet = 0; octet < 8; octet += 1) {
            value += BigInt(bytes[octet] ?? 0) << BigInt(octet * 8);
          }
          return { value, found: 0, span: null };
        }
        if (tag === 5) {
          const drained = Drain(a, c);
          if (drained === null) {
            throw new Error(`${seatPrefix} this port cannot carry`);
          }
          if (drained.status !== 0) {
            return { value: BigInt(-drained.status), found: 0, span: null };
          }
          sharedMemoryLink().writeSpan(address, drained.bytes);
          return { value: BigInt(drained.bytes.length), found: 0, span: null };
        }
        if (tag === 6) {
          const carried = await Carry(a, b, c, d);
          if (carried === null) {
            throw new Error(`${seatPrefix} this port cannot fill`);
          }
          if (carried.status !== 0) {
            return { value: BigInt(-carried.status), found: 0, span: null };
          }
          sharedMemoryLink().writeSpan(address, carried.bytes);
          return { value: BigInt(carried.bytes.length), found: 0, span: null };
        }
        if (tag === 7) {
          return { value: BigInt(State(a)), found: 0, span: null };
        }
        if (tag === 8) {
          return { value: BigInt(Identity(a, c)), found: 0, span: null };
        }
        if (tag === 9) {
          return { value: BigInt(FieldChar(a, b, c)), found: 0, span: null };
        }
        throw new Error(`${seatPrefix} memory command is incomplete`);
      }

      function postAccessBatch(
        port: MessagePort,
        ok: boolean,
        done: number,
        attempted: boolean,
        message: string,
        value: readonly bigint[],
        found: Uint8Array,
        spanAt: readonly number[],
        spanList: readonly bigint[][],
      ): void {
        port.postMessage({
          kind: "access-batch-result",
          ok,
          done,
          attempted,
          message,
          value,
          found,
          spanAt,
          spanList,
        });
      }

      /**
       * 按客程序顺序做完一批已经离开核心的访问。
       * 某一条失败时，它前面的结果留下，这一条和后面的不再做。
       */
      async function runAccessBatch(port: MessagePort, record: Record<string, unknown>): Promise<void> {
        const tag = record["tag"];
        if (!(tag instanceof Uint8Array) || tag.length < 1 || tag.length > 100000) {
          postAccessBatch(port, false, 0, false, `${seatPrefix} memory command is incomplete`, [], new Uint8Array(0), [], []);
          return;
        }
        const length = tag.length;
        const opcode = batchBytes(record["opcode"], length);
        const address = batchBigints(record["address"], length);
        const data = batchBigints(record["data"], length);
        const a = batchNumbers(record["a"], length);
        const b = batchNumbers(record["b"], length);
        const c = batchNumbers(record["c"], length);
        const d = batchNumbers(record["d"], length);
        if (opcode === null || address === null || data === null || a === null || b === null || c === null || d === null) {
          postAccessBatch(port, false, 0, false, `${seatPrefix} memory command is incomplete`, [], new Uint8Array(0), [], []);
          return;
        }
        const value: bigint[] = [];
        const found = new Uint8Array(length);
        const spanAt: number[] = [];
        const spanList: bigint[][] = [];
        for (let index = 0; index < length; index += 1) {
          try {
            const one = await settleOne(
              tag[index] ?? 0,
              opcode[index] ?? 0,
              address[index] ?? 0n,
              data[index] ?? 0n,
              a[index] ?? 0,
              b[index] ?? 0,
              c[index] ?? 0,
              d[index] ?? 0,
            );
            value.push(one.value);
            found[index] = one.found;
            if (one.span !== null) {
              spanAt.push(index);
              spanList.push(one.span);
            }
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : `${seatPrefix} 访存失败`;
            postAccessBatch(port, false, index, true, message, value, found.slice(0, index), spanAt, spanList);
            return;
          }
        }
        postAccessBatch(port, true, length, false, "", value, found, spanAt, spanList);
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
        if (record?.["kind"] === "xchg" || record?.["kind"] === "fill" || record?.["kind"] === "carry" || record?.["kind"] === "port-state" || record?.["kind"] === "port-char" || record?.["kind"] === "port-byte" || record?.["kind"] === "query" || record?.["kind"] === "query-span") {
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
        if (record?.["kind"] === "access-batch") {
          void runAccessBatch(port, record);
          return;
        }
        if (record?.["kind"] === "load-span") {
          const address = record["address"];
          const length = record["length"];
          if (typeof address !== "bigint" || typeof length !== "number" || !Number.isInteger(length) || length < 1 || length > 262144 || address < 0n || address % 8n !== 0n) {
            port.postMessage({ kind: "load-span-result", ok: false, bytes: null, message: `${seatPrefix} install 访存` });
            return;
          }
          try {
            const bytes = sharedMemoryLink().readSpan(address, length);
            port.postMessage({ kind: "load-span-result", ok: true, bytes, message: "" });
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : `${seatPrefix} install 访存`;
            port.postMessage({ kind: "load-span-result", ok: false, bytes: null, message });
          }
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
            message: `${seatPrefix} memory command is incomplete`,
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
          throw new Error(`${seatPrefix} CPU thread is not up`);
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
            metrics: QueryRoot.Hardware.Motherboard.openQueryPage(),
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
        worker.addEventListener("message", (event: MessageEvent): void => {
          forwardCoreStop(event.data as unknown);
          forwardHostNote(event.data as unknown);
        });
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
          metrics: QueryRoot.Hardware.Motherboard.openQueryPage(),
        });
        const seated = await waitMessage(
          worker,
          (record): boolean => record["kind"] === "seated",
          `${seatPrefix} CPU 没有坐上`,
        );
        const coreCount = seated["coreCount"];
        if (typeof coreCount !== "number" || !Number.isInteger(coreCount) || coreCount < 1) {
          throw new Error(`${seatPrefix} CPU did not declare a legal core count`);
        }
        declared = coreCount;
        for (let ordinal = 0; ordinal < coreCount; ordinal += 1) {
          mountOne(ordinal);
        }
        worker.postMessage({ kind: "exercise" });
        await waitMessage(
          worker,
          (record): boolean => record["kind"] === "ok",
          `${seatPrefix} CPU trial did not finish`,
        );
      }

      /**
       * 内存坐稳并且引导 logo 已经送上面板之后，补做寄存器和访存核对。
       */
      export async function probeCpu(): Promise<void> {
        const worker = cpuWorker;
        if (worker === null) {
          throw new Error(`${seatPrefix} CPU is not seated`);
        }
        worker.postMessage({ kind: "probe" });
        await waitMessage(
          worker,
          (record): boolean => record["kind"] === "ok",
          `${seatPrefix} CPU probe did not finish`,
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
          throw new Error(`${seatPrefix} CPU is not seated`);
        }
        worker.postMessage({ kind: "run", binary });
        await waitMessage(
          worker,
          (record): boolean => record["kind"] === "ok",
          `${seatPrefix} instruction sequence did not finish`,
          (record): void => {
            const text = record["text"];
            if (typeof text === "string") {
              globalThis.postMessage({ kind: "trace", text });
            }
          },
        );
      }

      /**
       * 把失败帧交给 CPU，并且不换掉常驻固件的 onmessage。
       * 用另一条监听等 fault-frame-done。这段期间别的失败仍进原来的处理函数，
       * 显卡故障因此还能写到控制台，不会被这次等待吃掉。
       */
      export function runFaultPicture(lines: readonly string[]): Promise<void> {
        const worker = cpuWorker;
        if (worker === null) {
          return Promise.reject(new Error(`${seatPrefix} CPU is not seated`));
        }
        return new Promise((resolve, reject): void => {
          let timer = 0;
          const onMessage = (event: MessageEvent): void => {
            const record = asRecord(event.data as unknown);
            const done = record?.["kind"] === "fault-frame-done" ? record : null;
            if (done === null) {
              return;
            }
            clearTimeout(timer);
            worker.removeEventListener("message", onMessage);
            if (done["ok"] === true) {
              resolve();
              return;
            }
            const message = done["message"];
            reject(new Error(typeof message === "string" ? message : `${seatPrefix} fault picture was not drawn`));
          };
          timer = setTimeout((): void => {
            worker.removeEventListener("message", onMessage);
            reject(new Error(`${seatPrefix} fault picture did not finish`));
          }, 30000);
          worker.addEventListener("message", onMessage);
          worker.postMessage({ kind: "fault-frame", lines });
        });
      }

      export async function runInstructionLines(lines: readonly string[]): Promise<void> {
        const worker = cpuWorker;
        if (worker === null) {
          throw new Error(`${seatPrefix} CPU is not seated`);
        }
        worker.postMessage({ kind: "run", lines });
        await waitMessage(
          worker,
          (record): boolean => record["kind"] === "ok",
          `${seatPrefix} instruction sequence did not finish`,
          (record): void => {
            const text = record["text"];
            if (typeof text === "string") {
              globalThis.postMessage({ kind: "trace", text });
            }
          },
        );
      }

      /**
       * 把二进制装进一颗已停止的核心，不启动。
       * 等 CPU 回 ok。固件循环再 schedule 这一核，读盘和换红点因此不绑在同一次循环上。
       */
      export async function seatBinary(ordinal: number, binary: Uint8Array): Promise<void> {
        const worker = cpuWorker;
        if (worker === null) {
          throw new Error(`${seatPrefix} CPU is not seated`);
        }
        /* 先接上回答，再把程序送过去。核心线程和这条线程并行，倒过来的话 ok 会被上一次等待的处理函数吃掉。 */
        const seated = waitMessage(
          worker,
          (record): boolean => record["kind"] === "ok",
          `${seatPrefix} installed program did not finish`,
        );
        worker.postMessage({ kind: "seat", ordinal, binary });
        await seated;
      }

      /** 交给 CPU 一段不主动 halt 的二进制固件。不等待结束。失败时把整条消息交给调用方。 */
      export function startResidentBinary(binary: Uint8Array, onFault: (data: Record<string, unknown>) => void): void {
        const worker = cpuWorker;
        if (worker === null) {
          throw new Error(`${seatPrefix} CPU is not seated`);
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
            onFault(record);
          }
        };
        worker.postMessage({ kind: "run", binary });
      }

      /**
       * 交给 CPU 一段不主动 halt 的固件。
       * 不等待结束。失败时调用 onFault，由调用方决定要不要再画异常画面。
       */
      export function startResidentLines(lines: readonly string[], onFault: (data: Record<string, unknown>) => void): void {
        const worker = cpuWorker;
        if (worker === null) {
          throw new Error(`${seatPrefix} CPU is not seated`);
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
            onFault(record);
          }
        };
        worker.postMessage({ kind: "run", lines });
      }

      /**
       * 把一段调试 ZAP 交给 CPU。不等待。
       * 结果由上面的监听转到页面。开关和核心状态由 CPU 自己拒绝。
       */
      export function requestDebugRun(lines: readonly string[]): void {
        const worker = cpuWorker;
        if (worker === null) {
          globalThis.postMessage({
            kind: MailMessage.DebugResult,
            ok: false,
            message: "debug run was refused",
          });
          return;
        }
        worker.postMessage({ kind: MailMessage.DebugRun, lines });
      }

      /**
       * 让一颗不在跑固件的核心执行一段 ZAP。
       * 结果稍后以 guest-done 回来，写进沙盒。这里不等待，也不把失败画成引导故障。
       */
      export function startGuest(ordinal: number, lines: readonly string[], ticket: number): void {
        const worker = cpuWorker;
        if (worker === null) {
          throw new Error(`${seatPrefix} CPU is not seated`);
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
          throw new Error(`${seatPrefix} cannot unmount a core outside the declaration`);
        }
        const core = live.get(ordinal);
        if (core === undefined) {
          throw new Error(`${seatPrefix} this core is not seated`);
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
