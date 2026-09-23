/**
 * @module ZerOS.Hardware.Memory.TestVerdict
 * @description 初始化前测试的裁定（TestVerdict）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只承载 ZMP1 §4.22 的三档裁定。封闭集合，不单列登记表。
 * 不运行用例，也不发布内存总控。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. TestVerdict 类型与常量
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      /**
       * 最近一次 `Test` 的裁定（ZMP1 §4.22）。
       * 0x0 尚未调用；0x1 全部通过；0x2 有用例未通过。
       */
      export type TestVerdict = 0x0 | 0x1 | 0x2;

      /**
       * 裁定短名。数值与 §4.22 逐字对应。
       */
      export const TestVerdictCode = {
        /** 0x0：还没有完成过一次 Test */
        NotRun: 0x0 as const,
        /** 0x1：最近一次 Test 的每一个用例都通过 */
        Passed: 0x1 as const,
        /** 0x2：最近一次 Test 至少有一个用例未通过 */
        Failed: 0x2 as const,
      } as const;
    }
  }
}
