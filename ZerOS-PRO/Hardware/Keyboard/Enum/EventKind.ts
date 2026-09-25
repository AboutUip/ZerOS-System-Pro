/**
 * @module ZerOS.Hardware.Keyboard.EventKind
 * @description 键盘事件种类
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 封闭集合：按下、松开、连按。数值与 ZKP1 逐字一致。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 种类
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Keyboard {
      /** 按下。槽 0 的合法取值之一。 */
      export const EventKindDown = 0;

      /** 松开。 */
      export const EventKindUp = 1;

      /** 连按。浏览器里的 keypress 收成这一种。 */
      export const EventKindPress = 2;
    }
  }
}
