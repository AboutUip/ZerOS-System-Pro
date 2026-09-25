/**
 * @file Resolution.ts
 * @desc 分辨率门闩。宽、高各自落在边上界内，且乘积不超过像素总数上界。
 *       任一条件失败时调用方不得提交新尺寸。
 */

import { ZerOS as ConfigRoot } from "../Config/DisplayConfig";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Display {
      const MinEdge = ConfigRoot.Hardware.Display.Config.MinEdge;
      const MaxEdge = ConfigRoot.Hardware.Display.Config.MaxEdge;
      const MaxPixelCount = ConfigRoot.Hardware.Display.Config.MaxPixelCount;

      /** 一对宽高是否可以成为当前分辨率。 */
      export function isResolution(width: number, height: number): boolean {
        if (!Number.isInteger(width) || !Number.isInteger(height)) {
          return false;
        }
        if (width < MinEdge || width > MaxEdge || height < MinEdge || height > MaxEdge) {
          return false;
        }
        const count = width * height;
        return Number.isSafeInteger(count) && count <= MaxPixelCount;
      }
    }
  }
}
