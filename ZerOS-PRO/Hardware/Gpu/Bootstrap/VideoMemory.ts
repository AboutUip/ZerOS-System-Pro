/**
 * @module ZerOS.Hardware.Gpu.VideoMemory
 * @description 显卡显存
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 一块按 32 位字存放的显存。帧是最前面的若干字，其余字初始为 0。
 * 字节地址按小端解释：地址 0 是字的最低 8 位。不依赖宿主的内存字节序。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 显存
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as ConfigRoot } from "../Config/GpuConfig";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Gpu {
      const MemoryByteMin = ConfigRoot.Hardware.Gpu.Config.MemoryByteMin;
      const MemoryByteMax = ConfigRoot.Hardware.Gpu.Config.MemoryByteMax;
      const MemoryByteAlign = ConfigRoot.Hardware.Gpu.Config.MemoryByteAlign;
      const memoryPrefix = "[ZerOS.Hardware.Gpu.VideoMemory]";

      let words = new Uint32Array(0);
      let framePixels = 0;

      function fail(message: string): never {
        throw new Error(`${memoryPrefix} ${message}`);
      }

      /**
       * 建立全 0 的显存，并交出帧所在的那一段视图。
       * 视图和后面的空闲字共用同一块缓冲，改帧就是改显存。
       */
      export function declareMemory(memoryBytes: number, pixels: number): Uint32Array {
        if (!Number.isInteger(memoryBytes) || memoryBytes < MemoryByteMin || memoryBytes > MemoryByteMax) {
          fail("显存字节数不在 4 到 268435456");
        }
        if (memoryBytes % MemoryByteAlign !== 0) {
          fail("显存字节数不是 4 的倍数");
        }
        const wordCount = memoryBytes / MemoryByteAlign;
        if (!Number.isInteger(pixels) || pixels < 1 || pixels > wordCount) {
          fail("帧放不进显存");
        }
        words = new Uint32Array(wordCount);
        framePixels = pixels;
        return words.subarray(0, pixels);
      }

      export function memoryBytes(): number {
        return words.length * MemoryByteAlign;
      }

      /** 读一个字节。地址按小端落在某一个字上。 */
      export function readByte(address: number): number {
        if (!Number.isInteger(address) || address < 0 || address >= words.length * MemoryByteAlign) {
          fail("显存地址不在范围内");
        }
        const word = words[Math.floor(address / MemoryByteAlign)] ?? 0;
        const shift = (address % MemoryByteAlign) * 8;
        return (word >> shift) & 0xff;
      }

      /** 写一个字节。只改这 8 位，同一个字的其余位保持不动。 */
      export function writeByte(address: number, value: number): void {
        if (!Number.isInteger(address) || address < 0 || address >= words.length * MemoryByteAlign) {
          fail("显存地址不在范围内");
        }
        if (!Number.isInteger(value) || value < 0 || value > 255) {
          fail("显存字节不是 0 到 255 的整数");
        }
        const index = Math.floor(address / MemoryByteAlign);
        const shift = (address % MemoryByteAlign) * 8;
        const current = words[index] ?? 0;
        const mask = 0xff << shift;
        words[index] = (current & ~mask) | (value << shift);
      }

      /** 帧占了多少个字。供频率计算整帧的拍数。 */
      export function frameWordCount(): number {
        return framePixels;
      }
    }
  }
}
