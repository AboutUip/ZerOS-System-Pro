/**
 * @module ZerOS.Hardware.Cpu.StopReason
 * @description 宿主停机记录里的原因
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只放页面上那条停机记录使用的四个整数。
 * 0、1、2 与核心自己的 stopKind 相同。3 只出现在宿主记录里。
 * 不写进 ZCP1 查询表，也不放进客程序能读的内存。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 原因常量
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      /** 序列走到头，或执行了 halt。与 stopKind 0 相同。 */
      export const StopReasonHalted = 0;

      /** 让出、时间片用尽，或监督核在指令边界上抢占。与 stopKind 1 相同。 */
      export const StopReasonYielded = 1;

      /** 停在系统调用，等监督核回复。与 stopKind 2 相同。 */
      export const StopReasonWaiting = 2;

      /**
       * 这次执行失败。
       * 核心查询字段 11 不会变成 3。页面靠这个数把失败和正常停下分开。
       */
      export const StopReasonFailed = 3;
    }
  }
}
