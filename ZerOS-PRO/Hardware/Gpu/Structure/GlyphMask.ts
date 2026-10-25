/**
 * @module ZerOS.Hardware.Gpu.GlyphMask
 * @description 一个字形的像素中心掩码
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只描述光栅结果的形状。协议用中文规定宽、高、进宽、左边、上边和覆盖，
 * 这里的英文字段是这一份实现的称呼，不是线上编码。
 * 不读 TrueType，也不往颜色目标里写。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. GlyphMask
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Gpu {
      /**
       * 一次光栅的掩码。
       * `coverage` 行优先，第 0 行是包围盒最上边。255 是着墨，0 是不着墨。
       */
      export interface GlyphMask {
        /** 掩码宽，像素。没有轮廓时为 0。 */
        readonly width: number;

        /** 掩码高，像素。 */
        readonly height: number;

        /** 进宽，像素。向 0 截断，小于 0 时为 0。 */
        readonly advance: number;

        /** 包围盒左边落到的像素列。可以是负数。 */
        readonly left: number;

        /** 包围盒上边相对基线向上的像素数。字体 y 向上。 */
        readonly top: number;

        /** 长度必须是 `width * height`。 */
        readonly coverage: Uint8Array;
      }
    }
  }
}
