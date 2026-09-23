/**
 * @module ZerOS.Hardware.Memory.MemoryTestCaseResult
 * @description 单个初始化前用例的结果（MemoryTestCaseResult）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只构造一条用例结果：规范名、0/1、概述。
 * 不运行硬件，也不决定能否 Initialize。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 用例名导入
 *   2. 结构与工厂
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import type { ZerOS as TestCaseNameRoot } from "../Enum/TestCaseName";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      /* -------------------------------------------------------------------- */
      /* 2. 一条用例结果                                                       */
      /* -------------------------------------------------------------------- */

      /**
       * 一个必选用例的观察结果（ZMP1 §4.22）。
       * Passed 只用整数 0 或 1。通过时 Summary 必须是空字符串。
       */
      export interface MemoryTestCaseResult {
        readonly CaseName: TestCaseNameRoot.Hardware.Memory.TestCaseName;
        readonly Passed: 0 | 1;
        readonly Summary: string;
      }

      /**
       * 概述按码点截到 255，留在异常概述的上限之内。
       * 通过时丢掉概述，避免用一句说明冒充失败。
       */
      export function memoryTestCaseResult(
        caseName: TestCaseNameRoot.Hardware.Memory.TestCaseName,
        passed: 0 | 1,
        summary: string,
      ): MemoryTestCaseResult {
        return {
          CaseName: caseName,
          Passed: passed,
          Summary: passed === 1 ? "" : clipSummary(summary),
        };
      }

      function clipSummary(summary: string): string {
        let clipped = "";
        let count = 0;
        for (const character of summary) {
          if (count >= 255) {
            break;
          }
          clipped += character;
          count += 1;
        }
        return clipped;
      }
    }
  }
}
