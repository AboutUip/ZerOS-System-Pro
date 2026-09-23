/**
 * @module ZerOS.Hardware.Memory.Uint64
 * @description 协议无符号 64 位整数门闩（Uint64）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 线性位元地址和多八位组整数会超过 2^53，不能再用宿主 number 精确承载。
 * 本文件只提供 0 .. 2^64-1 的 bigint 门闩。不读写存储体。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. Uint64 类型与上界
 *   2. toUint64
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      /**
       * 无符号 64 位整数。
       * 运行时是 bigint。品牌只存在于类型层，避免把任意 bigint 当成已经裁剪过的地址。
       */
      export type Uint64 = bigint & {
        readonly __Uint64: "ZerOS.Hardware.Memory.Uint64";
      };

      /**
       * Uint64 上界：2^64 − 1。
       * 整机位元线的最大长度落在这个上界之内。
       */
      export const Uint64Max: Uint64 = 18446744073709551615n as Uint64;

      /**
       * 把 bigint 收成 Uint64。
       * 负数或大于上界的值返回 null。bigint 本身没有小数。
       */
      export function toUint64(value: bigint): Uint64 | null {
        if (value < 0n || value > Uint64Max) {
          return null;
        }
        return value as Uint64;
      }
    }
  }
}
