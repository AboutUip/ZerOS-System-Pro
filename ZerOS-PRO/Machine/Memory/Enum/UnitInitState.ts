/**
 * @module ZerOS.Machine.Memory.UnitInitState
 * @description 内存单元初始化状态枚举量（InitState）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 单独承载 ZMP1 §4.12 InitState 取值类型与规范短名常量；
 * 权威语义见 InitStateRegistry / InitStateIndex。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. UnitInitState 类型
 *   2. UnitInitStateCode 常量
 */

export namespace ZerOS {
  export namespace Machine {
    export namespace Memory {
      /**
       * 内存单元初始化状态取值（ZMP1 §4.12）：仅 0x0–0x4。
       */
      export type UnitInitState = 0x0 | 0x1 | 0x2 | 0x3 | 0x4;

      /**
       * InitState 规范短名对应的数值常量（与 ZMP1 §4.12.2 一致）。
       */
      export const UnitInitStateCode = {
        /** 0x0：无效待初始化 */
        InvalidPending: 0x0 as const,
        /** 0x1：准备初始化 / 初始化中 */
        Preparing: 0x1 as const,
        /** 0x2：初始化异常 */
        InitFault: 0x2 as const,
        /** 0x3：初始化完成 */
        InitComplete: 0x3 as const,
        /** 0x4：正式启用 */
        Active: 0x4 as const,
      } as const;
    }
  }
}
