/**
 * @module ZerOS.Hardware.Memory.MemoryTestReport
 * @description 一次完整 Test 的报告（MemoryTestReport）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 把已经跑完的用例结果收成一份报告。
 * 顺序或名字偏离 TestCaseOrder 时返回 null，调用方不得把它写成 Passed。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 报告结构与工厂
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as TestCaseNameRoot } from "../Enum/TestCaseName";
import { ZerOS as MemoryTestCaseResultRoot } from "./MemoryTestCaseResult";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      /* -------------------------------------------------------------------- */
      /* 2. 整次测试的报告                                                     */
      /* -------------------------------------------------------------------- */

      /**
       * `Test` 写到 MemoryInit 上的报告（ZMP1 §4.22）。
       * AllPassed 为 1 当且仅当每一条 Passed 都是 1。
       */
      export interface MemoryTestReport {
        readonly Cases: readonly MemoryTestCaseResultRoot.Hardware.Memory.MemoryTestCaseResult[];
        readonly AllPassed: 0 | 1;
      }

      /**
       * 尚未调用 Test 时的报告：没有用例，也还不能放行初始化。
       */
      export const MemoryTestReportNotRun: MemoryTestReport = {
        Cases: Object.freeze([]),
        AllPassed: 0,
      };

      /**
       * 验收一整份结果。
       * 条数、顺序、名字必须与 TestCaseOrder 一致，否则返回 null。
       */
      export function createMemoryTestReport(
        cases: readonly MemoryTestCaseResultRoot.Hardware.Memory.MemoryTestCaseResult[],
      ): MemoryTestReport | null {
        const order = TestCaseNameRoot.Hardware.Memory.TestCaseOrder;
        if (cases.length !== order.length) {
          return null;
        }

        let allPassed: 0 | 1 = 1;
        let index = 0;
        while (index < order.length) {
          const item = cases[index];
          const expected = order[index];
          if (item === undefined || expected === undefined) {
            return null;
          }
          if (item.CaseName !== expected) {
            return null;
          }
          if (item.Passed !== 1) {
            allPassed = 0;
          }
          index += 1;
        }

        return {
          Cases: Object.freeze(cases.slice()),
          AllPassed: allPassed,
        };
      }

      /**
       * Test 自己中途崩溃时的报告：每一条都未通过，条数仍等于登记表。
       * 这样一次没跑完的调用不能留下「全部通过」。
       */
      export function memoryTestReportAborted(summary: string): MemoryTestReport {
        const order = TestCaseNameRoot.Hardware.Memory.TestCaseOrder;
        const cases: MemoryTestCaseResultRoot.Hardware.Memory.MemoryTestCaseResult[] = [];
        let index = 0;
        while (index < order.length) {
          const caseName = order[index];
          if (caseName === undefined) {
            break;
          }
          cases.push(
            MemoryTestCaseResultRoot.Hardware.Memory.memoryTestCaseResult(
              caseName,
              0,
              summary,
            ),
          );
          index += 1;
        }
        const report = ZerOS.Hardware.Memory.createMemoryTestReport(cases);
        if (report !== null) {
          return report;
        }
        return {
          Cases: Object.freeze(cases),
          AllPassed: 0,
        };
      }
    }
  }
}
