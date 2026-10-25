/**
 * @module ZerOS.Hardware.Gpu.GpuDispatch
 * @description 显卡线程的消息调度
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 坐上 ActiveGpuProvider。Clear / Plot / Present 都在这条线程里完成。
 * Present 把副本交给主板。view 为真时优先交位图，否则交像素。
 * 一队不返回编号的命令在这里按顺序做完，只回答一次。
 * 本文件不导入显示器，也不导入内存实现。
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
import { ZerOS as FontBytesRoot } from "../Font/FontBytes";
import { ZerOS as ClockRoot } from "../Bootstrap/GpuClock";
import { ZerOS as GpuSlotRoot } from "../../Motherboard/Slot/Gpu/GpuSlot";
import { ZerOS as GpuSelfCheckRoot } from "../Test/GpuSelfCheck";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Gpu {
      const provider = ActiveRoot.Hardware.Gpu.ActiveGpuProvider;
      const stageFontBytes = FontBytesRoot.Hardware.Gpu.stageFontBytes;
      const adoptOrigin = ClockRoot.Hardware.Gpu.adoptOrigin;
      const GpuSlot = GpuSlotRoot.Hardware.Motherboard.Slot.GpuSlot;
      const runGpuSelfCheck = GpuSelfCheckRoot.Hardware.Gpu.runGpuSelfCheck;
      const seatPrefix = "[ZerOS.Hardware.Motherboard.GpuSeat]";

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
          postFault(`${seatPrefix} board does not support the GPU protocol ${provider.ActiveProtocol}`);
          return;
        }
        GpuSlot.Bind(provider);
        if (GpuSlot.GetActive() !== provider) {
          postFault(`${seatPrefix} the GPU provider is not seated`);
          return;
        }
        const origin = record["clockOrigin"];
        if (typeof origin === "number") {
          adoptOrigin(origin);
        }
        globalThis.postMessage({
          kind: "seated",
          frameWidth: provider.FrameWidth,
          frameHeight: provider.FrameHeight,
          providerId: provider.ProviderId,
          providerVendor: provider.ProviderVendor,
          protocol: provider.ActiveProtocol,
          memoryBytes: provider.MemoryBytes,
          hertz: provider.Hertz(),
          executed: provider.Executed(),
        });
      }

      function postOk(extra?: { readonly id?: number; readonly value?: number; readonly frameWidth?: number; readonly frameHeight?: number }): void {
        const message: Record<string, unknown> = {
          kind: "ok",
          hertz: provider.Hertz(),
          executed: provider.Executed(),
        };
        if (extra?.id !== undefined) {
          message["id"] = extra.id;
        }
        if (extra?.value !== undefined) {
          message["value"] = extra.value;
        }
        if (extra?.frameWidth !== undefined) {
          message["frameWidth"] = extra.frameWidth;
        }
        if (extra?.frameHeight !== undefined) {
          message["frameHeight"] = extra.frameHeight;
        }
        globalThis.postMessage(message);
      }

      async function onExercise(): Promise<void> {
        try {
          await runGpuSelfCheck();
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : `${seatPrefix} GPU self-check failed`;
          postFault(message);
          return;
        }
        postOk();
      }

      /** 像素副本或位图，连同节拍一起交回主板。位图和像素缓冲都只转交一次。 */
      function postFrame(view: ImageBitmap | Uint32Array): void {
        const frameWidth = provider.FrameWidth;
        const frameHeight = provider.FrameHeight;
        const hertz = provider.Hertz();
        const executed = provider.Executed();
        if (view instanceof ImageBitmap) {
          globalThis.postMessage(
            { kind: "frame", frameWidth, frameHeight, hertz, executed, bitmap: view },
            { transfer: [view] },
          );
          return;
        }
        const buffer = view.buffer;
        if (!(buffer instanceof ArrayBuffer)) {
          postFault(`${seatPrefix} the present copy could not be transferred`);
          return;
        }
        globalThis.postMessage(
          { kind: "frame", frameWidth, frameHeight, hertz, executed, pixels: view },
          { transfer: [buffer] },
        );
      }

      /**
       * 页面主动要的 Present 仍是像素。
       * 客程序带 view 时优先要位图。启动画面那一次由主板不带 view，好让页面认出六个点。
       */
      async function onPresent(record: Record<string, unknown>): Promise<void> {
        try {
          if (record["view"] === true) {
            postFrame(await provider.PresentView());
            return;
          }
          postFrame(await provider.Present());
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : `${seatPrefix} present failed`;
          postFault(message);
        }
      }

      function readNumber(record: Record<string, unknown>, key: string): number | null {
        const value = record[key];
        if (typeof value !== "number" || !Number.isInteger(value)) {
          return null;
        }
        return value;
      }

      async function onClear(record: Record<string, unknown>): Promise<void> {
        const pixel = readNumber(record, "pixel");
        if (pixel === null) {
          postFault(`${seatPrefix} clear is missing a pixel`);
          return;
        }
        try {
          await provider.Clear(pixel);
          postOk();
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : `${seatPrefix} clear failed`;
          postFault(message);
        }
      }

      async function onPlot(record: Record<string, unknown>): Promise<void> {
        const x = readNumber(record, "x");
        const y = readNumber(record, "y");
        const pixel = readNumber(record, "pixel");
        if (x === null || y === null || pixel === null) {
          postFault(`${seatPrefix} plot is missing a coordinate or a pixel`);
          return;
        }
        try {
          await provider.Plot(x, y, pixel);
          postOk();
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : `${seatPrefix} plot failed`;
          postFault(message);
        }
      }

      async function onScene(record: Record<string, unknown>, kind: string): Promise<void> {
        try {
          if (kind === "box") {
            const parent = readNumber(record, "parent");
            const x = readNumber(record, "x");
            const y = readNumber(record, "y");
            const width = readNumber(record, "width");
            const height = readNumber(record, "height");
            const fill = readNumber(record, "fill");
            if (parent === null || x === null || y === null || width === null || height === null || fill === null) {
              postFault(`${seatPrefix} a box is missing arguments`);
              return;
            }
            const id = await provider.SpawnBox(parent, x, y, width, height, fill);
            postOk({ id });
            return;
          }
          if (kind === "text") {
            const parent = readNumber(record, "parent");
            const x = readNumber(record, "x");
            const y = readNumber(record, "y");
            const width = readNumber(record, "width");
            const height = readNumber(record, "height");
            if (parent === null || x === null || y === null || width === null || height === null) {
              postFault(`${seatPrefix} a text node is missing arguments`);
              return;
            }
            const id = await provider.SpawnText(parent, x, y, width, height);
            postOk({ id });
            return;
          }
          if (kind === "align") {
            const node = readNumber(record, "node");
            const alignX = readNumber(record, "alignX");
            const alignY = readNumber(record, "alignY");
            if (node === null || alignX === null || alignY === null) {
              postFault(`${seatPrefix} align is missing arguments`);
              return;
            }
            await provider.Align(node, alignX, alignY);
          } else if (kind === "paint") {
            const node = readNumber(record, "node");
            const foreground = readNumber(record, "foreground");
            const background = readNumber(record, "background");
            if (node === null || foreground === null || background === null) {
              postFault(`${seatPrefix} paint is missing arguments`);
              return;
            }
            await provider.Paint(node, foreground, background);
          } else if (kind === "glyph") {
            const node = readNumber(record, "node");
            const code = readNumber(record, "code");
            if (node === null || code === null) {
              postFault(`${seatPrefix} a glyph is missing arguments`);
              return;
            }
            await provider.Glyph(node, code);
          } else if (kind === "drop") {
            const node = readNumber(record, "node");
            if (node === null) {
              postFault(`${seatPrefix} drop is missing a node`);
              return;
            }
            await provider.Drop(node);
          } else {
            await provider.Compose();
          }
          postOk();
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : `${seatPrefix} a node command failed`;
          postFault(message);
        }
      }

      async function onCharacter(record: Record<string, unknown>): Promise<void> {
        const x = readNumber(record, "x");
        const y = readNumber(record, "y");
        const code = readNumber(record, "code");
        const foreground = readNumber(record, "foreground");
        const background = readNumber(record, "background");
        if (x === null || y === null || code === null || foreground === null || background === null) {
          postFault(`${seatPrefix} character is missing arguments`);
          return;
        }
        try {
          await provider.Character(x, y, code, foreground, background);
          postOk();
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : `${seatPrefix} character failed`;
          postFault(message);
        }
      }
      async function onHertz(record: Record<string, unknown>): Promise<void> {
        const hertz = readNumber(record, "hertz");
        if (hertz === null) {
          postFault(`${seatPrefix} GPU hertz is missing an integer`);
          return;
        }
        try {
          await provider.SetHertz(hertz);
          postOk();
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : `${seatPrefix} GPU hertz failed`;
          postFault(message);
        }
      }

      async function onMetric(record: Record<string, unknown>): Promise<void> {
        const metricKind = readNumber(record, "metric");
        if (metricKind === null) {
          postFault(`${seatPrefix} a GPU metric is missing its kind`);
          return;
        }
        try {
          postOk({ value: await provider.Metric(metricKind) });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : `${seatPrefix} a GPU metric failed`;
          postFault(message);
        }
      }

      async function onLoadByte(record: Record<string, unknown>): Promise<void> {
        const address = readNumber(record, "address");
        if (address === null) {
          postFault(`${seatPrefix} a video read is missing an address`);
          return;
        }
        try {
          postOk({ value: await provider.ReadByte(address) });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : `${seatPrefix} a video read failed`;
          postFault(message);
        }
      }

      async function onStoreByte(record: Record<string, unknown>): Promise<void> {
        const address = readNumber(record, "address");
        const value = readNumber(record, "value");
        if (address === null || value === null) {
          postFault(`${seatPrefix} a video write is missing arguments`);
          return;
        }
        try {
          await provider.WriteByte(address, value);
          postOk();
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : `${seatPrefix} a video write failed`;
          postFault(message);
        }
      }

      function readBits(record: Record<string, unknown>, key: string): bigint | null {
        const value = record[key];
        if (typeof value !== "bigint") {
          return null;
        }
        return value;
      }

      /** 一条 WebGPU 加速命令。结果编号通过 ok 的 id 交回核心。 */
      async function onAccel(record: Record<string, unknown>): Promise<void> {
        const op = readNumber(record, "operation");
        const a = readBits(record, "a");
        const b = readBits(record, "b");
        const c = readBits(record, "c");
        const d = readBits(record, "d");
        if (op === null || a === null || b === null || c === null || d === null) {
          postFault(`${seatPrefix} an accel command is missing arguments`);
          return;
        }
        try {
          const raw = record["bytes"];
          stageFontBytes(raw instanceof Uint8Array ? raw : null);
          const id = await provider.Accel(op, a, b, c, d);
          if (op === 39) {
            postOk({ id, frameWidth: provider.FrameWidth, frameHeight: provider.FrameHeight });
          } else {
            postOk({ id });
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : `${seatPrefix} an accel command failed`;
          postFault(message);
        }
      }

      /**
       * 一队不返回编号的命令在这条线程里按顺序做完，只回答一次。
       * 中途失败就停，后面的命令不再画，和一条一条送时停在失败那条一样。
       */
      async function onBatch(record: Record<string, unknown>): Promise<void> {
        const commands = record["commands"];
        if (!Array.isArray(commands)) {
          postFault(`${seatPrefix} the GPU batch is incomplete`);
          return;
        }
        let resized = false;
        try {
          for (const item of commands) {
            const command = asRecord(item);
            if (command === null) {
              postFault(`${seatPrefix} one GPU batch command is incomplete`);
              return;
            }
            const gpuOp = command["gpuOp"];
            if (gpuOp === "clear") {
              const pixel = readNumber(command, "pixel");
              if (pixel === null) {
                postFault(`${seatPrefix} clear is missing a pixel`);
                return;
              }
              await provider.Clear(pixel);
            } else if (gpuOp === "plot") {
              const x = readNumber(command, "x");
              const y = readNumber(command, "y");
              const pixel = readNumber(command, "pixel");
              if (x === null || y === null || pixel === null) {
                postFault(`${seatPrefix} plot is missing a coordinate or a pixel`);
                return;
              }
              await provider.Plot(x, y, pixel);
            } else if (gpuOp === "character") {
              const x = readNumber(command, "x");
              const y = readNumber(command, "y");
              const code = readNumber(command, "code");
              const foreground = readNumber(command, "foreground");
              const background = readNumber(command, "background");
              if (x === null || y === null || code === null || foreground === null || background === null) {
                postFault(`${seatPrefix} character is missing arguments`);
                return;
              }
              await provider.Character(x, y, code, foreground, background);
            } else if (gpuOp === "align") {
              const node = readNumber(command, "node");
              const alignX = readNumber(command, "alignX");
              const alignY = readNumber(command, "alignY");
              if (node === null || alignX === null || alignY === null) {
                postFault(`${seatPrefix} align is missing arguments`);
                return;
              }
              await provider.Align(node, alignX, alignY);
            } else if (gpuOp === "paint") {
              const node = readNumber(command, "node");
              const foreground = readNumber(command, "foreground");
              const background = readNumber(command, "background");
              if (node === null || foreground === null || background === null) {
                postFault(`${seatPrefix} paint is missing arguments`);
                return;
              }
              await provider.Paint(node, foreground, background);
            } else if (gpuOp === "glyph") {
              const node = readNumber(command, "node");
              const code = readNumber(command, "code");
              if (node === null || code === null) {
                postFault(`${seatPrefix} a glyph is missing arguments`);
                return;
              }
              await provider.Glyph(node, code);
            } else if (gpuOp === "drop") {
              const node = readNumber(command, "node");
              if (node === null) {
                postFault(`${seatPrefix} drop is missing a node`);
                return;
              }
              await provider.Drop(node);
            } else if (gpuOp === "compose") {
              await provider.Compose();
            } else if (gpuOp === "hertz") {
              const hertz = readNumber(command, "hertz");
              if (hertz === null) {
                postFault(`${seatPrefix} GPU hertz is missing an integer`);
                return;
              }
              await provider.SetHertz(hertz);
            } else if (gpuOp === "accel") {
              const op = readNumber(command, "operation");
              const a = readBits(command, "a");
              const b = readBits(command, "b");
              const c = readBits(command, "c");
              const d = readBits(command, "d");
              if (op === null || a === null || b === null || c === null || d === null) {
                postFault(`${seatPrefix} an accel command is missing arguments`);
                return;
              }
              const raw = command["bytes"];
              stageFontBytes(raw instanceof Uint8Array ? raw : null);
              /* 字形和进度条只往列表里追加。当场做完，避免一帧里几百次让出。 */
              const immediate = provider.AccelImmediate(op, a, b, c, d);
              if (immediate === null) {
                await provider.Accel(op, a, b, c, d);
              }
              if (op === 39) {
                resized = true;
              }
            } else if (gpuOp === "store") {
              const address = readNumber(command, "address");
              const value = readNumber(command, "value");
              if (address === null || value === null) {
                postFault(`${seatPrefix} a video write is missing arguments`);
                return;
              }
              await provider.WriteByte(address, value);
            } else {
              postFault(`${seatPrefix} one GPU batch command was not recognized`);
              return;
            }
          }
          if (resized) {
            postOk({ frameWidth: provider.FrameWidth, frameHeight: provider.FrameHeight });
          } else {
            postOk();
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : `${seatPrefix} the GPU batch failed`;
          postFault(message);
        }
      }

      export function acceptGpuMessage(data: unknown): void {
        const record = asRecord(data);
        if (record === null) {
          return;
        }
        const kind = record["kind"];
        if (kind === "bind") {
          onBind(record);
          return;
        }
        if (kind === "exercise") {
          void onExercise();
          return;
        }
        if (kind === "present") {
          void onPresent(record);
          return;
        }
        if (kind === "clear") {
          void onClear(record);
          return;
        }
        if (kind === "plot") {
          void onPlot(record);
          return;
        }
        if (kind === "character") {
          void onCharacter(record);
          return;
        }
        if (kind === "hertz") {
          void onHertz(record);
          return;
        }
        if (kind === "metric") {
          void onMetric(record);
          return;
        }
        if (kind === "load") {
          void onLoadByte(record);
          return;
        }
        if (kind === "store") {
          void onStoreByte(record);
          return;
        }
        if (kind === "accel") {
          void onAccel(record);
          return;
        }
        if (kind === "batch") {
          void onBatch(record);
          return;
        }
        if (kind === "box" || kind === "text" || kind === "align" || kind === "paint" || kind === "glyph" || kind === "drop" || kind === "compose") {
          void onScene(record, kind);
        }
      }
    }
  }
}
