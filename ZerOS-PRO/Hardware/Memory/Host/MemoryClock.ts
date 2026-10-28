/**
 * @module ZerOS.Hardware.Memory.MemoryClock
 * @description 内存频率
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 一次通道访问按字宽推进频率账。账还在，线程不再为这段账睡觉。
 * 访问本身该等多久，由通道把结果送回来决定。
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

      let hertz = OfficialHertz;
      let executed = 0;

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
      }

      /** 改用主板上电记下的起点。 */
      export function adoptOrigin(value: number): void {
        adoptClock(value);
      }

      /**
       * 成功的访问走这里。记一条已完成。
       * metric 读到的频率和条数不变。
       * 不再按到期时刻睡觉。睡觉时没有指令在跑，调用方只是被定时器按住。
       */
      export function spend(_cycles: number): Promise<void> {
        executed += 1;
        return Promise.resolve();
      }

      /**
       * 一段连续访问记一次账。
       * accesses 记入已完成条数。同样不挂起。
       */
      export function spendBulk(accesses: number, _cycles: number): Promise<void> {
        const steps = accesses < 1 ? 1 : accesses;
        executed += steps;
        return Promise.resolve();
      }

      /** 给信箱文本用的两行：当前 Hz，已完成条数。 */
      export function paceText(): string {
        return `${String(hertz)}\n${String(executed)}`;
      }
    }
  }
}
