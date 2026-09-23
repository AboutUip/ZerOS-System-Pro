/**
 * @module ZerOS.Hardware.Memory.MemoryTestSuite
 * @description 初始化前的完整用例套件
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 按 TestCaseOrder 逐个执行用例。某一个抛错只记下该条，后面的用例继续。
 * 不发布 MachineMemory.MemoryController。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. runMemoryTestSuite
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as TestCaseNameRoot } from "../Enum/TestCaseName";
import { ZerOS as ResultRoot } from "../Structure/MemoryTestCaseResult";
import { ZerOS as ReportRoot } from "../Structure/MemoryTestReport";
import { ZerOS as StorageClearedRoot } from "./Case/StorageCleared";
import { ZerOS as UnitOrdinalDenseRoot } from "./Case/UnitOrdinalDense";
import { ZerOS as InactiveRoot } from "./Case/InactiveReportsUnitNotActive";
import { ZerOS as BitRoundTripRoot } from "./Case/BitRoundTrip";
import { ZerOS as IllegalBitRoot } from "./Case/IllegalBitRejected";
import { ZerOS as OctetRoundTripRoot } from "./Case/OctetRoundTrip";
import { ZerOS as IllegalOctetRoot } from "./Case/IllegalOctetRejected";
import { ZerOS as CrossUnitRoot } from "./Case/CrossUnitMatches";
import { ZerOS as OrdinalRangeRoot } from "./Case/UnitOrdinalOutOfRange";
import { ZerOS as ShallowCutRoot } from "./Case/ShallowCutShape";
import { ZerOS as BlockPortRoot } from "./Case/BlockPortAgrees";
import { ZerOS as DeepenRoot } from "./Case/DeepenOneLevel";
import { ZerOS as CapacityRoot } from "./Case/CapacityIsOctetSum";
import { ZerOS as MemoryIdDrawRoot } from "./Case/MemoryIdDraw";
import { ZerOS as LinearBitRoot } from "./Case/LinearBitRoundTrip";
import { ZerOS as IntegerRoot } from "./Case/IntegerLittleEndian";
import { ZerOS as BlockOctetRoot } from "./Case/BlockOctetRoundTrip";
import { ZerOS as ClaimRoot } from "./Case/ClaimReleaseZeros";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      /**
       * 跑完登记表里的每一个用例，顺序固定。
       * 返回值已经过报告工厂；工厂拒绝时改成「全部未通过」的同序结果，避免漏跑被写成通过。
       */
      export function runMemoryTestSuite(): ReportRoot.Hardware.Memory.MemoryTestReport {
        type CaseResult = ResultRoot.Hardware.Memory.MemoryTestCaseResult;
        const runners: readonly (() => CaseResult)[] = [
          (): CaseResult => StorageClearedRoot.Hardware.Memory.runStorageCleared(),
          (): CaseResult => UnitOrdinalDenseRoot.Hardware.Memory.runUnitOrdinalDense(),
          (): CaseResult => InactiveRoot.Hardware.Memory.runInactiveReportsUnitNotActive(),
          (): CaseResult => BitRoundTripRoot.Hardware.Memory.runBitRoundTrip(),
          (): CaseResult => IllegalBitRoot.Hardware.Memory.runIllegalBitRejected(),
          (): CaseResult => OctetRoundTripRoot.Hardware.Memory.runOctetRoundTrip(),
          (): CaseResult => IllegalOctetRoot.Hardware.Memory.runIllegalOctetRejected(),
          (): CaseResult => CrossUnitRoot.Hardware.Memory.runCrossUnitMatches(),
          (): CaseResult => OrdinalRangeRoot.Hardware.Memory.runUnitOrdinalOutOfRange(),
          (): CaseResult => ShallowCutRoot.Hardware.Memory.runShallowCutShape(),
          (): CaseResult => BlockPortRoot.Hardware.Memory.runBlockPortAgrees(),
          (): CaseResult => DeepenRoot.Hardware.Memory.runDeepenOneLevel(),
          (): CaseResult => CapacityRoot.Hardware.Memory.runCapacityIsOctetSum(),
          (): CaseResult => MemoryIdDrawRoot.Hardware.Memory.runMemoryIdDraw(),
          (): CaseResult => LinearBitRoot.Hardware.Memory.runLinearBitRoundTrip(),
          (): CaseResult => IntegerRoot.Hardware.Memory.runIntegerLittleEndian(),
          (): CaseResult => BlockOctetRoot.Hardware.Memory.runBlockOctetRoundTrip(),
          (): CaseResult => ClaimRoot.Hardware.Memory.runClaimReleaseZeros(),
        ];
        const order = TestCaseNameRoot.Hardware.Memory.TestCaseOrder;
        const cases: ResultRoot.Hardware.Memory.MemoryTestCaseResult[] = [];
        let index = 0;
        while (index < order.length) {
          const expected = order[index];
          if (expected === undefined) {
            break;
          }
          const run = runners[index];
          let result: ResultRoot.Hardware.Memory.MemoryTestCaseResult;
          if (run === undefined) {
            result = ResultRoot.Hardware.Memory.memoryTestCaseResult(
              expected,
              0,
              "该用例没有执行体",
            );
          } else {
            try {
              result = run();
            } catch (caught: unknown) {
              result = ResultRoot.Hardware.Memory.memoryTestCaseResult(
                expected,
                0,
                caught instanceof Error ? caught.message : String(caught),
              );
            }
            if (result.CaseName !== expected) {
              result = ResultRoot.Hardware.Memory.memoryTestCaseResult(
                expected,
                0,
                `用例返回了名字 ${result.CaseName}`,
              );
            }
          }
          cases.push(result);
          index += 1;
        }

        const report = ReportRoot.Hardware.Memory.createMemoryTestReport(cases);
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
