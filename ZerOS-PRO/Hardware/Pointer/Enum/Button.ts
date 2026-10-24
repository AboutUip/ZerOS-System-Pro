/**
 * @module ZerOS.Hardware.Pointer.Button
 * @description 鼠标键
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 封闭集合。数值与 ZPP1 槽 1 逐字一致。
 * 按住掩码的位号是键号减 1：左键是位 0。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 键号
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Pointer {
      /** 移动和滚轮没有键。 */
      export const ButtonNone = 0;

      /** 左键。 */
      export const ButtonLeft = 1;

      /** 右键。 */
      export const ButtonRight = 2;

      /** 中键。 */
      export const ButtonMiddle = 3;

      /** 后退。 */
      export const ButtonBack = 4;

      /** 前进。 */
      export const ButtonForward = 5;
    }
  }
}
