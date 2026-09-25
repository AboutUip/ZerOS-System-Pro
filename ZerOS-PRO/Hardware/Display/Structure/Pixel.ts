/**
 * @file Pixel.ts
 * @desc 24 位像素门闩。R 在 23..16，G 在 15..8，B 在 7..0。
 *       呈现时按这个布局拆开，禁止依赖宿主整数的字节序。
 */

import { ZerOS as ConfigRoot } from "../Config/DisplayConfig";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Display {
      const PixelMax = ConfigRoot.Hardware.Display.Config.PixelMax;

      /** 值是否为闭区间内的像素整数。 */
      export function isPixel(value: number): boolean {
        return Number.isInteger(value) && value >= 0 && value <= PixelMax;
      }
    }
  }
}
