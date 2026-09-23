/**
 * @module ZerOS.Hardware.Memory.SignalCode
 * @description 内存信号标号（SignalCode）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 与 SignalCodeRegistry 双向对齐。信号是电平，不是追加日志。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. SignalCodeValue
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      /**
       * 已登记信号标号。
       */
      export const SignalCodeValue = {
        /** 0x0001：颗粒是否正式可用 */
        Usable: 0x0001,
        /** 0x0002：颗粒是否处于失败终局 */
        Fault: 0x0002,
        /** 0x0003：总控是否至少有一颗正式可用颗粒 */
        Ready: 0x0003,
      } as const;

      /**
       * 一个已登记信号标号。
       */
      export type SignalCode =
        (typeof SignalCodeValue)[keyof typeof SignalCodeValue];

      /**
       * 信号电平。只用整数 0 或 1。
       */
      export type SignalLevel = 0 | 1;
    }
  }
}
