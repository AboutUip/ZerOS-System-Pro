/**
 * @module ZerOS.Hardware.Pointer.EventKind
 * @description 鼠标事件种类
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 封闭集合：移动、按下、松开、滚轮。数值与 ZPP1 逐字一致。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 种类
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Pointer {
      /** 移动。槽 0 的合法取值之一。 */
      export const EventKindMove = 0;

      /** 按下。 */
      export const EventKindDown = 1;

      /** 松开。 */
      export const EventKindUp = 2;

      /** 滚轮。 */
      export const EventKindWheel = 3;
    }
  }
}
