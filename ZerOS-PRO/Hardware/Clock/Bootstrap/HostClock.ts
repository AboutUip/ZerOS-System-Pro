/**
 * @module ZerOS.Hardware.Clock.HostClock
 * @description 公共时钟
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 上电时记下一个起点。处理器、内存和显卡的到期时刻都从这一点起算。
 * 各设备仍用自己的 Hz 记账。算出的等待短于 1 毫秒时不挂起。
 * 这个模块在每条线程里各有一份状态。同一起点靠上电消息把这个数送过去。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 时钟
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Clock {
      /** 宿主一次能分辨的节拍。短于它的等待不挂起。 */
      const HostTickMs = 1;

      const clockPrefix = "[ZerOS.Hardware.Clock.HostClock]";

      /** 尚未记下时是 NaN。上电或收到上电消息之后才是有限数。 */
      let origin = Number.NaN;

      function fail(message: string): never {
        throw new Error(`${clockPrefix} ${message}`);
      }

      /**
       * 主板线程上电时调用一次。
       * 重复调用仍返回第一次记下的起点，避免中途换时间轴。
       */
      export function startClock(): number {
        if (!Number.isFinite(origin)) {
          origin = performance.now();
        }
        return origin;
      }

      /** 已经记下的起点。还没上电时先记下当前时刻，避免设备在绑定前空转。 */
      export function clockOrigin(): number {
        if (!Number.isFinite(origin)) {
          origin = performance.now();
        }
        return origin;
      }

      /** 其它硬件线程收到主板送来的起点后改用它。 */
      export function adoptClock(value: number): void {
        if (!Number.isFinite(value)) {
          fail("时钟起点不是有限数");
        }
        origin = value;
      }

      /**
       * 到期还差这么多毫秒。
       * 不足一个宿主节拍就立刻返回，把多条命令留在同一次让出之前。
       */
      export function waitSpan(delay: number): Promise<void> {
        if (delay < HostTickMs) {
          return Promise.resolve();
        }
        return new Promise((resolve): void => {
          setTimeout(resolve, delay);
        });
      }
    }
  }
}
