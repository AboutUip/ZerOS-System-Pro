/**
 * @module ZerOS.Hardware.Memory.TestExpect
 * @description 用例里核对最后一条 Abort 异常
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只判断异常数组末尾是不是指定标号、并且类别为 Abort。
 * 不构造硬件。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. lastIsAbort
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import type { ZerOS as MemoryExceptionRoot } from "../Structure/MemoryException";
import { ZerOS as ExceptionCategoryRoot } from "../Enum/ExceptionCategory";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      /**
       * 数组最后一条必须是 Abort，且标号等于预期。
       * 空数组算不成立。
       */
      export function lastIsAbort(
        exceptions: readonly MemoryExceptionRoot.Hardware.Memory.MemoryException[],
        exceptionCode: number,
      ): boolean {
        const last: MemoryExceptionRoot.Hardware.Memory.MemoryException | undefined =
          exceptions[exceptions.length - 1];
        return (
          last?.ExceptionCode === exceptionCode &&
          last.ExceptionCategory ===
            ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort
        );
      }
    }
  }
}
