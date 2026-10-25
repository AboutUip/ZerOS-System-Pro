/**
 * @module ZerOS.Hardware.Gpu.TtfFace
 * @description 已经接受的 TrueType 子集
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只保存打开之后光栅还要用的表。字段名是这一份实现的称呼，不是协议线上的名字。
 * 不读字节，也不着墨。`glyf` 在打开时复制，之后与调用方的数组无关。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 字符映射
 *   2. 字体面
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Gpu {
      /* ------------------------------------------------------------------ */
      /* 1. 字符映射                                                         */
      /* ------------------------------------------------------------------ */

      /** format 12 的一组连续标量。`glyph` 是这段第一个标量的字形号。 */
      export interface CmapGroup {
        readonly start: number;
        readonly end: number;
        readonly glyph: number;
      }

      /**
       * format 4。
       * `words` 是 `idRangeOffset` 后面紧接 `glyphIdArray` 的 16 位字，
       * 下标 0 就是第 0 段的 `idRangeOffset`。非零偏移要按这个数组取字形号。
       */
      export interface Format4 {
        readonly endCount: readonly number[];
        readonly startCount: readonly number[];
        readonly idDelta: readonly number[];
        readonly idRangeOffset: readonly number[];
        readonly words: readonly number[];
      }

      /* ------------------------------------------------------------------ */
      /* 2. 字体面                                                           */
      /* ------------------------------------------------------------------ */

      /**
       * 打开成功后的字体面。
       * 失败的文件不会留下这个对象。
       */
      export interface TtfFace {
        /** `head.unitsPerEm`，已确认在 16 .. 16384。 */
        readonly unitsPerEm: number;

        /** `maxp.numGlyphs`，至少是 1，字形 0 是 `.notdef`。 */
        readonly numGlyphs: number;

        /** 每个字形的前进宽度，字体单位。下标就是字形号。 */
        readonly advances: readonly number[];

        /** `loca` 解开后的字节偏移。长度是 `numGlyphs + 1`，单调不减。 */
        readonly loca: readonly number[];

        /** `glyf` 的副本。 */
        readonly glyf: Uint8Array;

        /** format 12 的组。没有这张子表时是空数组。 */
        readonly groups: readonly CmapGroup[];

        /** format 4。没有这张子表时是 null。 */
        readonly format4: Format4 | null;
      }

      /**
       * 打开结果。
       * 失败不附带原因字符串：FontFace 失败时只是不分配编号。
       */
      export type TtfOpen =
        | { readonly ok: true; readonly face: TtfFace }
        | { readonly ok: false };
    }
  }
}
