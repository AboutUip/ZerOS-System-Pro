/**
 * @module ZerOS.Hardware.Memory.ExceptionCategory
 * @description 异常类别五档枚举量（ExceptionCategory）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 单独承载 ZMP1 §4.11.2 ExceptionCategory 取值与规范档名常量。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. ExceptionCategory 类型
 *   2. ExceptionCategoryCode 常量
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      /**
       * 异常类别五档（ZMP1 §4.11.2）：仅 0x00–0x04。
       */
      export type ExceptionCategory = 0x00 | 0x01 | 0x02 | 0x03 | 0x04;

      /**
       * ExceptionCategory 规范档名常量（与 ZMP1 §4.11.2 一致）。
       */
      export const ExceptionCategoryCode = {
        /** 0x00：可忽略 */
        Ignorable: 0x00 as const,
        /** 0x01：提示 */
        Advisory: 0x01 as const,
        /** 0x02：可恢复 */
        Recoverable: 0x02 as const,
        /** 0x03：严重 */
        Severe: 0x03 as const,
        /** 0x04：强制终止 */
        Abort: 0x04 as const,
      } as const;
    }
  }
}
