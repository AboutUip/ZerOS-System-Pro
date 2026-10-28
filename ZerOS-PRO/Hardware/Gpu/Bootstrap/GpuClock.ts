/**
 * @module ZerOS.Hardware.Gpu.GpuClock
 * @description 显卡频率
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 按命令触及的字数推进频率账。账还在，画图的线程不再为这段账睡觉。
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

      /**
       * 改频率。
       * 超出 1 到 1000000000 时失败，已记下的 Hz 不动。
       */
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
       * 成功的命令走这里。记一条已完成。
       * 不再按到期时刻睡觉，一帧像素不该把线程按住半秒。
       */
      export function spend(_cycles: number): Promise<void> {
        executed += 1;
        return Promise.resolve();
      }
    }
  }
}
