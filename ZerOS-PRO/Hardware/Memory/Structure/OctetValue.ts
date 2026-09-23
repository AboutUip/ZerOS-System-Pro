/**
 * @module ZerOS.Hardware.Memory.OctetValue
 * @description 八位组整数门闩（0–255）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只提供 ZMP1 八位组取值的值域门闩。
 * 不是位元（位元只有 0 或 1），也不包含读写方法。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. OctetValue 类型与上界
 *   2. toOctetValue
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      /* -------------------------------------------------------------------- */
      /* 1. 八位组：0–255 的整数                                               */
      /* -------------------------------------------------------------------- */

      /**
       * 八位组规范取值（ZMP1 §4.15 / §4.18）。
       * 品牌只在类型层。运行时仍是已经落入 0–255 的整数。
       */
      export type OctetValue = number & {
        readonly __OctetValue: "ZerOS.Hardware.Memory.OctetValue";
      };

      /**
       * 八位组上界。一个八位组装下 BitsPerByte（8）个位元时，整数范围是 0–255。
       */
      export const OctetValueMax: OctetValue = 255 as OctetValue;

      /* -------------------------------------------------------------------- */
      /* 2. 门闩                                                               */
      /* -------------------------------------------------------------------- */

      /**
       * 把宿主 number 收成八位组。
       * 非整数、负数、大于 255、NaN、Infinity 一律返回 null。
       * WriteOctet 用它拒绝非法写入；通过之后才允许进入 Cells。
       */
      export function toOctetValue(value: number): OctetValue | null {
        if (
          !Number.isInteger(value) ||
          value < 0 ||
          value > ZerOS.Hardware.Memory.OctetValueMax
        ) {
          return null;
        }
        return value as OctetValue;
      }
    }
  }
}
