/**
 * @module ZerOS.Hardware.Cpu.GuestLines
 * @description 自检用的指令文本
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 把几行 ZAP 收成指令数组，供上电自检交给核心执行。
 * 不执行，也不访问内存。解析失败直接抛出，调用方不再得到半截序列。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. guestLines
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as InstructionRoot } from "../Structure/CpuInstruction";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      const parseCpuInstruction = InstructionRoot.Hardware.Cpu.parseCpuInstruction;
      const checkPrefix = "[ZerOS.Hardware.Cpu.GuestLines]";

      /** 一行空文本或无法识别时失败。顺序与输入相同。 */
      export function guestLines(
        lines: readonly string[],
      ): InstructionRoot.Hardware.Cpu.CpuInstruction[] {
        const steps: InstructionRoot.Hardware.Cpu.CpuInstruction[] = [];
        for (const line of lines) {
          const step = parseCpuInstruction(line);
          if (step === null) {
            throw new Error(`${checkPrefix} sample did not parse ${line}`);
          }
          steps.push(step);
        }
        return steps;
      }
    }
  }
}
