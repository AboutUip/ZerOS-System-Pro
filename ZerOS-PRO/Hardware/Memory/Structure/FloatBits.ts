/**
 * @module ZerOS.Hardware.Memory.FloatBits
 * @description 二进制 32 与二进制 64 的位型
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 把一个有限数收成补码整数，或把补码整数交回有限数。
 * 位的安排是：最高位是符号，接着是偏置指数，其余是尾数。
 * 八位组仍由整数端口按小端写。这里不访问颗粒。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 编码与解码
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as IntegerWidthRoot } from "../Enum/IntegerWidth";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      /** 浮点只使用 4 或 8 个八位组。2 个八位组的整数端口不承担浮点。 */
      export type FloatWidth = 4 | 8;

      export function toFloatWidth(value: number): FloatWidth | null {
        if (value === 4 || value === 8) {
          return value;
        }
        return null;
      }

      /**
       * 有限数收成该宽度的补码位型。
       * 非有限数，或有限数超出该格式能表示的最大有限值时，返回 null。
       */
      export function floatToSignedBits(value: number, width: FloatWidth): bigint | null {
        if (!Number.isFinite(value)) {
          return null;
        }
        const buffer = new ArrayBuffer(width);
        const view = new DataView(buffer);
        if (width === 4) {
          view.setFloat32(0, value, true);
          const bits = view.getInt32(0, true);
          if (!Number.isFinite(view.getFloat32(0, true))) {
            return null;
          }
          return BigInt(bits);
        }
        view.setFloat64(0, value, true);
        if (!Number.isFinite(view.getFloat64(0, true))) {
          return null;
        }
        return view.getBigInt64(0, true);
      }

      /**
       * 补码位型交回有限数。
       * 位型不在该宽度里，或它表示的不是有限数时，返回 null。
       */
      export function signedBitsToFloat(bits: bigint, width: FloatWidth): number | null {
        const min = IntegerWidthRoot.Hardware.Memory.integerSignedMin(width);
        const max = IntegerWidthRoot.Hardware.Memory.integerSignedMax(width);
        if (bits < min || bits > max) {
          return null;
        }
        const buffer = new ArrayBuffer(width);
        const view = new DataView(buffer);
        if (width === 4) {
          view.setInt32(0, Number(bits), true);
          const value = view.getFloat32(0, true);
          return Number.isFinite(value) ? value : null;
        }
        view.setBigInt64(0, bits, true);
        const value = view.getFloat64(0, true);
        return Number.isFinite(value) ? value : null;
      }
    }
  }
}
