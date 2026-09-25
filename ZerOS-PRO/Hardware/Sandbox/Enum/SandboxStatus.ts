/**
 * @module ZerOS.Hardware.Sandbox.SandboxStatus
 * @description 沙盒状态
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 封闭的五个状态。程序失败停在失败，不把异常抛给引导。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 状态值
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Sandbox {
      /** 还没有文本。 */
      export const SandboxStatusEmpty = 0;

      /** 已经收下文本，还没有开始。 */
      export const SandboxStatusArmed = 1;

      /** 客程序正在另一颗核心上执行。 */
      export const SandboxStatusRunning = 2;

      /** 最近一次执行走到了停止，没有故障。 */
      export const SandboxStatusPassed = 3;

      /** 最近一次执行失败。说明在故障文本里，引导循环仍继续。 */
      export const SandboxStatusFailed = 4;
    }
  }
}
