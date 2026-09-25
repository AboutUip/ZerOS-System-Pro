/**
 * @module ZerOS.Hardware.Cpu.CoreRunState
 * @description 核心运行状态
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * ZCP1 的封闭二值：0 停止，1 执行中。
 * 不是可追加状态表。停止中的核心不执行访存命令。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 状态取值
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      /** 已挂载但未在执行。 */
      export const CoreStateHalted = 0;

      /** 正在执行。才可以接受 Place、Add、Load、Store。 */
      export const CoreStateRunning = 1;

      /** 核心运行状态。 */
      export type CoreRunState = 0 | 1;
    }
  }
}
