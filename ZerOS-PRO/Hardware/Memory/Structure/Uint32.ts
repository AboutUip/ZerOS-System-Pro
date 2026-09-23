/**
 * @module ZerOS.Hardware.Memory.Uint32
 * @description 协议无符号 32 位整数门闩（Uint32）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只提供 ZMP1 术语 Uint32 的值域门闩、上界与零。
 * 不是配置面字段；不包含颗粒、位元布局或总控。
 *
 * 概念分层：
 *   - 协议值：闭区间 0 .. 2^32-1 上的整数
 *   - 宿主 number：只有通过本门闩之后，才允许充当 Uint32 的载体
 *   - 未通过门闩的 number（非整数、负数、大于上界、NaN、Infinity）不是 Uint32
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. Uint32 类型与端点常量
 *   2. toUint32 / uint32OrThrow
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      /* -------------------------------------------------------------------- */
      /* 1. Uint32：协议整数的参考实现载体                                     */
      /* -------------------------------------------------------------------- */

      /**
       * 无符号 32 位整数（ZMP1 术语 Uint32）。
       *
       * 品牌标记只存在于类型层，运行时仍是通过值域检查的 number。
       * 禁止把任意 number 直接写进需要 Uint32 的协议字段。
       */
      export type Uint32 = number & {
        readonly __Uint32: "ZerOS.Hardware.Memory.Uint32";
      };

      /**
       * Uint32 上界：2^32 − 1 = 4294967295。
       * 字面量已落在闭区间内，断言只贴品牌，不再做第二次裁剪。
       */
      export const Uint32Max: Uint32 = 0xffffffff as Uint32;

      /**
       * Uint32 零。失败实例化时 CellCount 必须用本值，禁止留空。
       */
      export const Uint32Zero: Uint32 = 0 as Uint32;

      /* -------------------------------------------------------------------- */
      /* 2. 门闩                                                               */
      /* -------------------------------------------------------------------- */

      /**
       * 把宿主 number 收成 Uint32。
       * 非整数、负数、大于 Uint32Max、NaN、Infinity 一律返回 null。
       */
      export function toUint32(value: number): Uint32 | null {
        if (!Number.isInteger(value) || value < 0 || value > Uint32Max) {
          return null;
        }
        return value as Uint32;
      }

      /**
       * 标定常量专用：非法值说明配置写错，直接中止加载。
       * 硬件运行期的非法颗粒大小不走这里，而走 MemoryException。
       */
      export function uint32OrThrow(value: number, source: string): Uint32 {
        const parsed: Uint32 | null = toUint32(value);
        if (parsed === null) {
          throw new Error(
            `[ZerOS.Hardware.Memory.Uint32] ${source} 不是 Uint32`,
          );
        }
        return parsed;
      }
    }
  }
}
