/**
 * @module ZerOS.Hardware.Gpu.GpuClock
 * @description 显卡频率
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 按命令触及的字数推进绝对时间。一次命令只等待一次。
 * 等待短于 1 毫秒时不挂起，避免单像素把线程切碎。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 时钟
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as ClockRoot } from "../../Clock/Bootstrap/HostClock";
import { ZerOS as ConfigRoot } from "../Config/GpuConfig";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Gpu {
      const HertzMin = ConfigRoot.Hardware.Gpu.Config.HertzMin;
      const HertzMax = ConfigRoot.Hardware.Gpu.Config.HertzMax;
      const OfficialHertz = ConfigRoot.Hardware.Gpu.Config.OfficialHertz;
      const clockPrefix = "[ZerOS.Hardware.Gpu.GpuClock]";
      const adoptClock = ClockRoot.Hardware.Clock.adoptClock;
      const clockOrigin = ClockRoot.Hardware.Clock.clockOrigin;
      const waitSpan = ClockRoot.Hardware.Clock.waitSpan;

      let hertz = OfficialHertz;
      let executed = 0;
      let cycleIndex = 0;
      let origin = clockOrigin();

      function fail(message: string): never {
        throw new Error(`${clockPrefix} ${message}`);
      }

      export function currentHertz(): number {
        return hertz;
      }

      export function currentExecuted(): number {
        return executed;
      }

      /**
       * 改频率并重新记下起点。
       * 超出 1 到 1000000000 时失败，已记下的 Hz 不动。
       */
      export function setHertz(value: number): void {
        if (!Number.isInteger(value) || value < HertzMin || value > HertzMax) {
          fail("Hz 不在 1 到 1000000000");
        }
        hertz = value;
        cycleIndex = 0;
        origin = performance.now();
      }

      /** 改用主板上电记下的起点，并重新从第 0 拍计。 */
      export function adoptOrigin(value: number): void {
        adoptClock(value);
        origin = clockOrigin();
        cycleIndex = 0;
      }

      /**
       * 成功的命令走这里。拍数是这次触及的字数，至少 1。
       * 到期时刻 = 起点 + 累计字数 × 1000 / Hz 毫秒。
       */
      export function spend(cycles: number): Promise<void> {
        const count = cycles < 1 ? 1 : cycles;
        executed += 1;
        cycleIndex += count;
        const deadline = origin + (cycleIndex * 1000) / hertz;
        const delay = deadline - performance.now();
        return waitSpan(delay);
      }
    }
  }
}
