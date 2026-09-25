/**
 * @module ZerOS.Hardware.Memory.MemoryClock
 * @description 内存频率
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 一次通道访问按字宽推进绝对时间，并且只等待一次。
 * 等待短于 1 毫秒时不挂起，单次 8 字节访问不会把引导切碎。
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

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      const HertzMin = 1;
      const HertzMax = 1000000000;

      /** 官方标定 100 MHz。不是协议规定的唯一频率。 */
      const OfficialHertz = 100000000;

      const clockPrefix = "[ZerOS.Hardware.Memory.MemoryClock]";
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

      /** 超出 1 到 1000000000 时失败，已记下的 Hz 不动。 */
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
       * 成功的访问走这里。拍数至少 1。
       * 到期时刻 = 起点 + 累计拍数 × 1000 / Hz 毫秒。
       */
      export function spend(cycles: number): Promise<void> {
        const count = cycles < 1 ? 1 : cycles;
        executed += 1;
        cycleIndex += count;
        const deadline = origin + (cycleIndex * 1000) / hertz;
        const delay = deadline - performance.now();
        return waitSpan(delay);
      }

      /** 给信箱文本用的两行：当前 Hz，已完成条数。 */
      export function paceText(): string {
        return `${String(hertz)}\n${String(executed)}`;
      }
    }
  }
}
