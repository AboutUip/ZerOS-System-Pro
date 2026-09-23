/**
 * @module ZerOS.Hardware.Memory.EventCode
 * @description 内存事件标号（EventCode）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 与 EventCodeRegistry 双向对齐的短名常量。
 * 不追加事件，也不解释信号电平。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. EventCodeValue
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      /**
       * 已登记事件标号。数值与 EventCodeRegistry 逐字对应。
       */
      export const EventCodeValue = {
        /** 0x0001：颗粒进入正式可用 */
        BecameActive: 0x0001,
        /** 0x0002：颗粒实例化失败 */
        InitFailed: 0x0002,
        /** 0x0003：颗粒进入无法恢复终局 */
        BecameUnrecoverable: 0x0003,
        /** 0x0004：颗粒实例化成功，停在 0x3 */
        Instantiated: 0x0004,
        /** 0x0005：浅切完成 */
        ShallowCutCompleted: 0x0005,
        /** 0x0006：一块加深了一层 */
        Deepened: 0x0006,
        /** 0x0007：浅切根被领取 */
        Claimed: 0x0007,
        /** 0x0008：浅切根被归还并清零 */
        Released: 0x0008,
      } as const;

      /**
       * 一个已登记事件标号。
       */
      export type EventCode =
        (typeof EventCodeValue)[keyof typeof EventCodeValue];
    }
  }
}
