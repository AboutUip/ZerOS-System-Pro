/**
 * @module ZerOS.Hardware.Gpu.ReferenceGpuProvider
 * @description 官方显卡插头
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 把官方帧存储包成可 Bind 的 GpuProvider。
 * 帧尺寸使用官方标定 640×480。社区实现替换 ActiveProvider 即可。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. ReferenceGpuProvider
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as ConfigRoot } from "../Config/GpuConfig";
import { ZerOS as RuntimeRoot } from "../Bootstrap/GpuRuntime";
import { ZerOS as AccelRoot } from "../Bootstrap/WebGpuAccel";
import type { ZerOS as GpuProviderRoot } from "../../Motherboard/Slot/Gpu/GpuProvider";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Gpu {
      const OfficialFrameWidth = ConfigRoot.Hardware.Gpu.Config.OfficialFrameWidth;
      const OfficialFrameHeight = ConfigRoot.Hardware.Gpu.Config.OfficialFrameHeight;
      const OfficialMemoryBytes = ConfigRoot.Hardware.Gpu.Config.OfficialMemoryBytes;
      const declareFrame = RuntimeRoot.Hardware.Gpu.declareFrame;
      const clear = RuntimeRoot.Hardware.Gpu.clear;
      const plot = RuntimeRoot.Hardware.Gpu.plot;
      const image = RuntimeRoot.Hardware.Gpu.image;
      const character = RuntimeRoot.Hardware.Gpu.character;
      const spawnBox = RuntimeRoot.Hardware.Gpu.spawnBox;
      const spawnText = RuntimeRoot.Hardware.Gpu.spawnText;
      const align = RuntimeRoot.Hardware.Gpu.align;
      const paint = RuntimeRoot.Hardware.Gpu.paint;
      const glyph = RuntimeRoot.Hardware.Gpu.glyph;
      const drop = RuntimeRoot.Hardware.Gpu.drop;
      const compose = RuntimeRoot.Hardware.Gpu.compose;
      const present = RuntimeRoot.Hardware.Gpu.present;
      const accel = AccelRoot.Hardware.Gpu.accel;
      const setGpuHertz = RuntimeRoot.Hardware.Gpu.setGpuHertz;
      const metric = RuntimeRoot.Hardware.Gpu.metric;
      const readByte = RuntimeRoot.Hardware.Gpu.readByte;
      const writeByte = RuntimeRoot.Hardware.Gpu.writeByte;
      const gpuHertz = RuntimeRoot.Hardware.Gpu.gpuHertz;
      const gpuExecuted = RuntimeRoot.Hardware.Gpu.gpuExecuted;

      declareFrame(OfficialFrameWidth, OfficialFrameHeight, OfficialMemoryBytes);

      /**
       * 官方显卡。
       * 声明 640×480。这是标定，不是协议规定的唯一合法尺寸。
       */
      export const ReferenceGpuProvider: GpuProviderRoot.Hardware.Motherboard.Slot.GpuProvider = {
        ProviderId: "ZerOS-Reference-Gpu",
        ProviderVendor: "ZerOS-Team",
        ActiveProtocol: "ZGP1",
        FrameWidth: OfficialFrameWidth,
        FrameHeight: OfficialFrameHeight,
        MemoryBytes: OfficialMemoryBytes,
        Hertz(): number {
          return gpuHertz();
        },
        Executed(): number {
          return gpuExecuted();
        },
        Clear(pixel: number): Promise<void> {
          return clear(pixel);
        },
        Plot(x: number, y: number, pixel: number): Promise<void> {
          return plot(x, y, pixel);
        },
        Image(x: number, y: number, width: number, height: number, pixels: Uint32Array): Promise<void> {
          return image(x, y, width, height, pixels);
        },
        Character(x: number, y: number, code: number, foreground: number, background: number): Promise<void> {
          return character(x, y, code, foreground, background);
        },
        SpawnBox(parent: number, x: number, y: number, width: number, height: number, fill: number): Promise<number> {
          return spawnBox(parent, x, y, width, height, fill);
        },
        SpawnText(parent: number, x: number, y: number, width: number, height: number): Promise<number> {
          return spawnText(parent, x, y, width, height);
        },
        Align(node: number, alignX: number, alignY: number): Promise<void> {
          return align(node, alignX, alignY);
        },
        Paint(node: number, foreground: number, background: number): Promise<void> {
          return paint(node, foreground, background);
        },
        Glyph(node: number, code: number): Promise<void> {
          return glyph(node, code);
        },
        Drop(node: number): Promise<void> {
          return drop(node);
        },
        Compose(): Promise<void> {
          return compose();
        },
        Present(): Promise<Uint32Array> {
          return present();
        },
        Accel(op: number, a: bigint, b: bigint, c: bigint, d: bigint): Promise<number> {
          return accel(op, a, b, c, d);
        },
        SetHertz(hertz: number): Promise<void> {
          return setGpuHertz(hertz);
        },
        Metric(kind: number): Promise<number> {
          return metric(kind);
        },
        ReadByte(address: number): Promise<number> {
          return readByte(address);
        },
        WriteByte(address: number, value: number): Promise<void> {
          return writeByte(address, value);
        },
      };
    }
  }
}
