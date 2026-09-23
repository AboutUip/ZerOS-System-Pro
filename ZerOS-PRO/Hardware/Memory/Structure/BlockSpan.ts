/**
 * @module ZerOS.Hardware.Memory.BlockSpan
 * @description 内存块位元跨度的精确整数运算（ZMP1 §4.20）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只计算「按 UnitOrdinal 把各颗 CellCount 拼成一条位元线，再按块数均分」。
 * 使用 bigint，避免宿主 number 在超过 2^53 时把商截成浮点。
 * 不持有颗粒，不读写存储体，也不加深嵌套。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. Uint32 导入
 *   2. 线性位置
 *   3. 求和、分块、落点
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as Uint32Root } from "./Uint32";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      /* -------------------------------------------------------------------- */
      /* 2. 线性下标落在哪一颗、哪一个位元                                     */
      /* -------------------------------------------------------------------- */

      /**
       * 位元线上的一个落点。两个字段都已经过 Uint32 门闩。
       * 这是运算结果，不是协议里的另一个地址类型名。
       */
      export interface LinearPlace {
        readonly UnitOrdinal: Uint32Root.Hardware.Memory.Uint32;
        readonly CellIndex: Uint32Root.Hardware.Memory.Uint32;
      }

      /* -------------------------------------------------------------------- */
      /* 3. 精确整数：总和、半开区间、落点                                     */
      /* -------------------------------------------------------------------- */

      /**
       * 按 UnitOrdinal 从 0 起，把每一颗的 CellCount 加总。
       * 失败颗粒的 CellCount 为 0，加进去也不占位元。
       * 和可以大于 Uint32，所以结果是 bigint，不是 number。
       */
      export function totalBitCount(
        cellCounts: readonly Uint32Root.Hardware.Memory.Uint32[],
      ): bigint {
        let total = 0n;
        for (const count of cellCounts) {
          total += BigInt(count);
        }
        return total;
      }

      /**
       * 第 blockIndex 块的半开线性区间 [Start, Start+Length)。
       *
       * Start = floor(blockIndex × total / blockCount)
       * End   = floor((blockIndex+1) × total / blockCount)
       * bigint 除法对非负整数就是向下取整，不经过浮点。
       * blockCount 必须 ≥ 1；0 会在这里抛出除零，调用方应先拒绝非法浅维度。
       */
      export function rangeOfBlock(
        blockIndex: Uint32Root.Hardware.Memory.Uint32,
        blockCount: Uint32Root.Hardware.Memory.Uint32,
        totalBitCount: bigint,
      ): { readonly Start: bigint; readonly Length: bigint } {
        const index = BigInt(blockIndex);
        const count = BigInt(blockCount);
        const start: bigint = (index * totalBitCount) / count;
        const end: bigint = ((index + 1n) * totalBitCount) / count;
        return {
          Start: start,
          Length: end - start,
        };
      }

      /**
       * 把块的位元长度收成 Uint32。
       * 长于 4294967295 的跨度不能用一个 Uint32 偏移命名，调用方必须让浅切失败。
       */
      export function bitLengthAsUint32(
        length: bigint,
      ): Uint32Root.Hardware.Memory.Uint32 | null {
        if (length < 0n || length > BigInt(Uint32Root.Hardware.Memory.Uint32Max)) {
          return null;
        }
        return Uint32Root.Hardware.Memory.toUint32(Number(length));
      }

      /**
       * 把线性下标走回某一颗上的 CellIndex。
       * 从 UnitOrdinal 0 起减掉该颗的 CellCount；第一颗装得下 rest 的就是落点。
       * 线性下标不在总长度内时返回 null。
       */
      export function locateLinear(
        linear: bigint,
        cellCounts: readonly Uint32Root.Hardware.Memory.Uint32[],
      ): LinearPlace | null {
        if (linear < 0n) {
          return null;
        }

        let rest: bigint = linear;
        let ordinal = 0;
        while (ordinal < cellCounts.length) {
          const count: Uint32Root.Hardware.Memory.Uint32 | undefined =
            cellCounts[ordinal];
          if (count === undefined) {
            return null;
          }
          const width = BigInt(count);
          if (rest < width) {
            const unitOrdinal: Uint32Root.Hardware.Memory.Uint32 | null =
              Uint32Root.Hardware.Memory.toUint32(ordinal);
            // rest 小于该颗 CellCount，而 CellCount 本身是 Uint32，故 Number(rest) 精确。
            const cellIndex: Uint32Root.Hardware.Memory.Uint32 | null =
              Uint32Root.Hardware.Memory.toUint32(Number(rest));
            if (unitOrdinal === null || cellIndex === null) {
              return null;
            }
            return {
              UnitOrdinal: unitOrdinal,
              CellIndex: cellIndex,
            };
          }
          rest -= width;
          ordinal += 1;
        }
        return null;
      }
    }
  }
}
