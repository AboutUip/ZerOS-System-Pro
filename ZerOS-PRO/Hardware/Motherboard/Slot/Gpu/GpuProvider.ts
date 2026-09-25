/**
 * @module ZerOS.Hardware.Motherboard.Slot.Gpu.Provider
 * @description Gpu Provider 形态（ZVHP1 + ZGP1）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 定义可绑定到 GpuSlot 的插头：元数据、声明的帧尺寸、三条绘图命令。
 * 不含某一份显卡的帧存储。主板坐座代码不导入具体实现。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. GpuProvider
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import type { ZerOS as ProviderMetaRoot } from "../Structure/ProviderMeta";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      export namespace Slot {
        /**
         * Gpu Provider。
         * FrameWidth / FrameHeight 是这份实现的帧尺寸。方法名与 ZGP1 逐字一致。
         */
        export interface GpuProvider {
          readonly ProviderId: ProviderMetaRoot.Hardware.Motherboard.Slot.ProviderId;
          readonly ProviderVendor: ProviderMetaRoot.Hardware.Motherboard.Slot.ProviderVendor;
          readonly ActiveProtocol: ProviderMetaRoot.Hardware.Motherboard.Slot.ActiveProtocol;
          readonly FrameWidth: number;
          readonly FrameHeight: number;
          readonly MemoryBytes: number;
          Hertz(): number;
          Executed(): number;
          Clear(pixel: number): Promise<void>;
          Plot(x: number, y: number, pixel: number): Promise<void>;
          Image(x: number, y: number, width: number, height: number, pixels: Uint32Array): Promise<void>;
          Character(x: number, y: number, code: number, foreground: number, background: number): Promise<void>;
          SpawnBox(parent: number, x: number, y: number, width: number, height: number, fill: number): Promise<number>;
          SpawnText(parent: number, x: number, y: number, width: number, height: number): Promise<number>;
          Align(node: number, alignX: number, alignY: number): Promise<void>;
          Paint(node: number, foreground: number, background: number): Promise<void>;
          Glyph(node: number, code: number): Promise<void>;
          Drop(node: number): Promise<void>;
          Compose(): Promise<void>;
          Present(): Promise<Uint32Array>;
          SetHertz(hertz: number): Promise<void>;
          Metric(kind: number): Promise<number>;
          ReadByte(address: number): Promise<number>;
          WriteByte(address: number, value: number): Promise<void>;
        }
      }
    }
  }
}
