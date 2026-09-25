/**
 * @module ZerOS.Hardware.Memory.IntegerWidth
 * @description 多八位组整数的宽度（IntegerWidth）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只承载 ZMP1 小端整数允许的八位组个数：2、4、8。
 * 宽度 1 已经由八位组端口表达，不放进本集合。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. IntegerWidth 类型
 *   2. toIntegerWidth
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      /**
       * 一次 ReadInteger / WriteInteger 覆盖的八位组个数。
       * 封闭三档，不是可追加登记表。
       */
      export type IntegerWidth = 2 | 4 | 8;

      /**
       * 运行时收下宽度。2、4、8 以外返回 null，由端口记成非法宽度。
       */
      export function toIntegerWidth(value: number): IntegerWidth | null {
        if (value === 2 || value === 4 || value === 8) {
          return value;
        }
        return null;
      }

      /**
       * 该宽度的全部位型个数：2^(8×宽度)。
       * 补码把高于一半的位型读成负数，这个模数用来在位型和数学值之间折返。
       */
      export function integerModulus(width: IntegerWidth): bigint {
        return 1n << (BigInt(width) * 8n);
      }

      /** 该宽度补码的最小整数：−2^(8×宽度−1)。 */
      export function integerSignedMin(width: IntegerWidth): bigint {
        return -(integerModulus(width) / 2n);
      }

      /** 该宽度补码的最大整数：2^(8×宽度−1) − 1。 */
      export function integerSignedMax(width: IntegerWidth): bigint {
        return integerModulus(width) / 2n - 1n;
      }
    }
  }
}
