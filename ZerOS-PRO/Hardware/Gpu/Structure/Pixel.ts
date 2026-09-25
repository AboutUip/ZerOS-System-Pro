/**
 * @module ZerOS.Hardware.Gpu.Pixel
 * @description 帧存储里的像素门闩
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只判断一个数是不是 ZGP1 像素整数。
 * 不拆红绿蓝，也不认识面板。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. isPixel
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as ConfigRoot } from "../Config/GpuConfig";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Gpu {
      const PixelMax = ConfigRoot.Hardware.Gpu.Config.PixelMax;

      /** 闭区间 0 .. 16777215 内的整数。 */
      export function isPixel(value: number): boolean {
        return Number.isInteger(value) && value >= 0 && value <= PixelMax;
      }
    }
  }
}
