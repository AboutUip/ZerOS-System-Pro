/**
 * @module ZerOS.Hardware.Motherboard.GpuSeat
 * @description 主板上的显卡座
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 坐上显卡线程，等它做完 Clear / Plot 自检。
 * Present 时把副本原样交回主板调度。这里不读像素，也不写面板。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 坐座与 Present
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as BoardSupportRoot } from "../Config/BoardSupport";
import { ZerOS as ClockRoot } from "../../Clock/Bootstrap/HostClock";
import { ZerOS as QueuedRoot } from "../Host/QueuedWorker";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      const seatPrefix = "[ZerOS.Hardware.Motherboard.GpuSeat]";

      let gpuWorker: Worker | null = null;
      let gpuWidth = 0;
      let gpuHeight = 0;
      let gpuMemoryBytes = 0;
      let gpuHertz = 0;
      let gpuExecuted = 0;
      let gpuId = "";
      let gpuVendor = "";
      let gpuProtocol = "";

      /** 坐稳之后留给查询指令读。频率和已完成条数随每次回答更新。 */
      export function gpuInfo(): {
        readonly width: number;
        readonly height: number;
        readonly memoryBytes: number;
        readonly hertz: number;
        readonly executed: number;
        readonly id: string;
        readonly vendor: string;
        readonly protocol: string;
      } {
        return {
          width: gpuWidth,
          height: gpuHeight,
          memoryBytes: gpuMemoryBytes,
          hertz: gpuHertz,
          executed: gpuExecuted,
          id: gpuId,
          vendor: gpuVendor,
          protocol: gpuProtocol,
        };
      }

      function notePace(record: Record<string, unknown>): void {
        const hertz = record["hertz"];
        const executed = record["executed"];
        if (typeof hertz === "number") {
          gpuHertz = hertz;
        }
        if (typeof executed === "number") {
          gpuExecuted = executed;
        }
      }

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
       * 坐上显卡并完成它自己的 Clear / Plot 自检。
       * 这一步不 Present。帧要等面板自检之后再交出。
       */
      export async function seatGpu(): Promise<void> {
        const supported = BoardSupportRoot.Hardware.Motherboard.SupportedGpuProtocols;
        const worker = QueuedRoot.Hardware.Motherboard.openGpuWorker();
        gpuWorker = worker;
        await waitMessage(
          worker,
          (record): boolean => record["kind"] === "ready",
          `${seatPrefix} 显卡线程没有就绪`,
        );
        worker.postMessage({
          kind: "bind",
          supported,
          clockOrigin: ClockRoot.Hardware.Clock.clockOrigin(),
        });
        const seated = await waitMessage(
          worker,
          (record): boolean => record["kind"] === "seated",
          `${seatPrefix} 显卡没有坐上`,
        );
        const frameWidth = seated["frameWidth"];
        const frameHeight = seated["frameHeight"];
        if (typeof frameWidth !== "number" || typeof frameHeight !== "number") {
          throw new Error(`${seatPrefix} 显卡没有声明帧尺寸`);
        }
        const providerId = seated["providerId"];
        const providerVendor = seated["providerVendor"];
        const protocol = seated["protocol"];
        if (typeof providerId !== "string" || typeof providerVendor !== "string" || typeof protocol !== "string") {
          throw new Error(`${seatPrefix} 显卡没有声明标识`);
        }
        gpuWidth = frameWidth;
        gpuHeight = frameHeight;
        const memoryBytes = seated["memoryBytes"];
        gpuMemoryBytes = typeof memoryBytes === "number" ? memoryBytes : 0;
        notePace(seated);
        gpuId = providerId;
        gpuVendor = providerVendor;
        gpuProtocol = protocol;
        worker.postMessage({ kind: "exercise" });
        const exercised = await waitMessage(
          worker,
          (record): boolean => record["kind"] === "ok",
          `${seatPrefix} 显卡自检没有完成`,
        );
        notePace(exercised);
      }

      /**
       * 向显卡要一份 Present 副本。
       * 不检查像素值。尺寸和像素数组原样返回给页面侧。
       */
      export async function presentFrame(): Promise<{
        readonly frameWidth: number;
        readonly frameHeight: number;
        readonly pixels: Uint32Array;
      }> {
        const worker = gpuWorker;
        if (worker === null) {
          throw new Error(`${seatPrefix} 显卡还没有坐上`);
        }
        worker.postMessage({ kind: "present" });
        const frame = await waitMessage(
          worker,
          (record): boolean => record["kind"] === "frame",
          `${seatPrefix} 显卡没有交出帧`,
        );
        const frameWidth = frame["frameWidth"];
        const frameHeight = frame["frameHeight"];
        const pixels = frame["pixels"];
        if (typeof frameWidth !== "number" || typeof frameHeight !== "number" || !(pixels instanceof Uint32Array)) {
          throw new Error(`${seatPrefix} 帧副本不完整`);
        }
        notePace(frame);
        return { frameWidth, frameHeight, pixels };
      }

      /**
       * 把一条显卡命令原样送进显卡线程。
       * clear / plot / character 成功时只等 ok，不读像素。
       */
      export async function applyGpuCommand(record: Record<string, unknown>): Promise<number | null> {
        const worker = gpuWorker;
        const gpuOp = record["gpuOp"];
        if (worker === null || typeof gpuOp !== "string") {
          throw new Error(`${seatPrefix} 显卡命令不完整`);
        }
        if (gpuOp === "clear") {
          worker.postMessage({ kind: "clear", pixel: record["pixel"] });
        } else if (gpuOp === "plot") {
          worker.postMessage({ kind: "plot", x: record["x"], y: record["y"], pixel: record["pixel"] });
        } else if (gpuOp === "character") {
          worker.postMessage({
            kind: "character",
            x: record["x"],
            y: record["y"],
            code: record["code"],
            foreground: record["foreground"],
            background: record["background"],
          });
        } else if (
          gpuOp === "box"
          || gpuOp === "text"
          || gpuOp === "align"
          || gpuOp === "paint"
          || gpuOp === "glyph"
          || gpuOp === "drop"
          || gpuOp === "compose"
          || gpuOp === "hertz"
          || gpuOp === "metric"
          || gpuOp === "load"
          || gpuOp === "store"
          || gpuOp === "accel"
        ) {
          worker.postMessage({ ...record, kind: gpuOp });
        } else {
          throw new Error(`${seatPrefix} 显卡命令无法识别`);
        }
        const reply = await waitMessage(
          worker,
          (message): boolean => message["kind"] === "ok",
          `${seatPrefix} 显卡命令没有完成`,
        );
        const id = reply["id"];
        notePace(reply);
        if (typeof id === "number") {
          return id;
        }
        const value = reply["value"];
        if (typeof value === "number") {
          return value;
        }
        return null;
      }

      /**
       * 把一队已经填好整数的显卡命令一次送进显卡线程。
       * 显卡按原顺序做完，只回答一次。命令本身仍是一条一条的，像素和现在相同。
       */
      export async function applyGpuBatch(commands: readonly Record<string, unknown>[]): Promise<void> {
        const worker = gpuWorker;
        if (worker === null) {
          throw new Error(`${seatPrefix} 显卡还没有坐上`);
        }
        worker.postMessage({ kind: "batch", commands });
        const reply = await waitMessage(
          worker,
          (message): boolean => message["kind"] === "ok",
          `${seatPrefix} 显卡队列没有完成`,
        );
        notePace(reply);
      }
    }
  }
}
