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
      /** 最近一次成功 SetHertz 记下的时间起点。失败的设置不会改它。 */
      let hertzOrigin = Number.NaN;

      function noteAccess(): void {
        executed += 1;
      }

      function rememberOrigin(): void {
        hertzOrigin = performance.now();
        if (!Number.isFinite(hertzOrigin)) {
          hertzOrigin = 0;
        }
      }

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
       * ZMP1 §4.27 `SetHertz`。
       * 超出 1 到 1000000000 时失败，已记下的 Hz 和时间起点都不动。
       * 成功时换上新值，重新记下这条频率自己的时间起点，并记一次已完成访问。
       */
      export function setHertz(value: number): void {
        if (!Number.isInteger(value) || value < HertzMin || value > HertzMax) {
          fail("Hz 不在 1 到 1000000000");
        }
        hertz = value;
        rememberOrigin();
        noteAccess();
      }

      /**
       * ZMP1 §4.27 `Metric`。
       * Kind 0 返回当前 Hz，Kind 1 返回已完成条数。其它 Kind 失败，条数不加。
       * 成功时先记一次已完成访问，再返回，所以条数包含这一次。
       */
      export function metric(kind: number): number {
        if (!Number.isInteger(kind) || (kind !== 0 && kind !== 1)) {
          fail("没有这种内存指标");
        }
        noteAccess();
        return kind === 0 ? hertz : executed;
      }

      /** 改用主板上电记下的起点。 */
      export function adoptOrigin(value: number): void {
        adoptClock(value);
      }

      /**
       * 成功的访问走这里。记一条已完成。
       * Metric 的种类 1 会把这一条算进去。
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
