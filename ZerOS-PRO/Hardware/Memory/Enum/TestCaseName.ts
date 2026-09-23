/**
 * @module ZerOS.Hardware.Memory.TestCaseName
 * @description 初始化前必选用例的顺序（TestCaseName）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只列出 TestCaseRegistry 里的规范名，并固定执行顺序。
 * 与登记表双向对齐。不包含用例正文。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. TestCaseOrder
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      /**
       * 必选用例名，顺序就是 `Test` 必须执行的顺序（ZMP1 §4.22）。
       * 禁止增删或换序后仍声称这是同一次完整测试。
       */
      export const TestCaseOrder = [
        "StorageCleared",
        "UnitOrdinalDense",
        "InactiveReportsUnitNotActive",
        "BitRoundTrip",
        "IllegalBitRejected",
        "OctetRoundTrip",
        "IllegalOctetRejected",
        "CrossUnitMatches",
        "UnitOrdinalOutOfRange",
        "ShallowCutShape",
        "BlockPortAgrees",
        "DeepenOneLevel",
        "CapacityIsOctetSum",
        "MemoryIdDraw",
        "LinearBitRoundTrip",
        "IntegerLittleEndian",
        "BlockOctetRoundTrip",
        "ClaimReleaseZeros",
      ] as const;

      /**
       * 登记表中的一个用例名。
       */
      export type TestCaseName = (typeof TestCaseOrder)[number];
    }
  }
}
