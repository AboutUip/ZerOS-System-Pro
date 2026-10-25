/**
 * @module ZerOS.Hardware.Gpu.FontLimit
 * @description TrueType 子集的数值边界
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只放 Font.md 写明的上下界，以及这一份实现的掩码单边上限。
 * 不解析字体，也不着墨。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 协议边界
 *   2. 实现上限
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Gpu {
      export namespace Config {
        /* ------------------------------------------------------------------ */
        /* 1. 协议边界                                                         */
        /* ------------------------------------------------------------------ */

        /** `head.unitsPerEm` 下界，含。Font.md 第 2 节。 */
        export const FontUnitsPerEmMin = 16;

        /** `head.unitsPerEm` 上界，含。 */
        export const FontUnitsPerEmMax = 16384;

        /** 像素字号下界，含。Font.md 第 1 节。 */
        export const FontPpemMin = 1;

        /** 像素字号上界，含。 */
        export const FontPpemMax = 256;

        /** FontFace 文件长度上界，含。单位是八位组。32 MiB，映射区放得下一份。 */
        export const FontFileOctets = 33554432;

        /** FontDraw 标量个数上界，含。0 也成功。 */
        export const FontDrawMax = 4096;

        /** 简单字形轮廓点上限，含。超过则该字形改画 `.notdef`。 */
        export const FontPointLimit = 4096;

        /** 复合字形嵌套层数上限，含。超过则该字形改画 `.notdef`。 */
        export const FontCompoundDepth = 16;

        /* ------------------------------------------------------------------ */
        /* 2. 实现上限                                                         */
        /* ------------------------------------------------------------------ */

        /**
         * 掩码单边像素上限。
         * 非协议。正常字号远小于它。超过时这一份实现放弃该字形，避免一次分配吃掉宿主内存。
         */
        export const FontBitmapSideMax = 4096;
      }
    }
  }
}
