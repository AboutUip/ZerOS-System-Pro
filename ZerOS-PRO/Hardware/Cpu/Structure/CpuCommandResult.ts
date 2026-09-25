/**
 * @module ZerOS.Hardware.Cpu.CpuCommandResult
 * @description 一次执行命令的结果
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 读命令带有读出的整数。写命令只有完成，没有读出值。
 * 不表示进程或系统调用的返回码。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 结果
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      /**
       * Load 把读出的整数写入寄存器。Store 不改寄存器，IsStore 为 true，Value 固定为 0n。
       */
      export interface CpuCommandResult {
        readonly IsStore: boolean;
        readonly Value: bigint;
      }
    }
  }
}
