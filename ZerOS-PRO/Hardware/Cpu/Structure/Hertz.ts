/**
 * @module ZerOS.Hardware.Cpu.Hertz
 * @description 核心频率门闩
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只判断一个数是不是 ZCP1 允许的 Hz。
 * 不推进时间，也不保存某个核心的当前频率。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. isHertz
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as ConfigRoot } from "../Config/CpuConfig";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      const HertzMin = ConfigRoot.Hardware.Cpu.Config.HertzMin;
      const HertzMax = ConfigRoot.Hardware.Cpu.Config.HertzMax;

      /** 闭区间 1 .. 1000000000 内的整数。 */
      export function isHertz(value: number): boolean {
        return Number.isInteger(value) && value >= HertzMin && value <= HertzMax;
      }
    }
  }
}
