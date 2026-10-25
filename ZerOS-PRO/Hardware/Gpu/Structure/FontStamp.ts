/**
 * @module ZerOS.Hardware.Gpu.FontStamp
 * @description 一次 FontDraw 要画上的掩码
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只描述已经光栅好、可以按当前颜色盖到颜色目标上的矩形。
 * 不读 TrueType，也不提交绘制。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 图章
 *   2. 命令结果
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Gpu {
      /**
       * 一个字形里要盖上的像素。
       * `coverage` 行优先，255 着墨，0 不着墨。坐标是颜色目标的像素，原点在左上，y 向下。
       */
      export interface FontStamp {
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
        readonly coverage: Uint8Array;
      }

      /**
       * 一条字体命令的结果。
       * 失败时没有编号，也没有图章，调用方不得改颜色目标。
       */
      export type FontAnswer =
        | { readonly ok: true; readonly id: number; readonly ink: readonly FontStamp[] }
        | { readonly ok: false };
    }
  }
}
