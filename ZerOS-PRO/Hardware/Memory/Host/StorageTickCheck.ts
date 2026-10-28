/**
 * @module ZerOS.Hardware.Memory.StorageTickCheck
 * @description 存储 Tick 的自检
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只检查调度入口：一颗一条通道、一拍内多条通道一起搬、200 毫秒到点就停、
 * 提前搬完的下一份马上开始、没有任务不空等、只剩一份时下一拍还搬它。
 * 不碰颗粒，也不启动页面。失败时抛出英文句子，方便在节点里直接看。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 自检
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as TickRoot } from "./StorageTick";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      const TickWorkMs = TickRoot.Hardware.Memory.TickWorkMs;
      const runStorageTick = TickRoot.Hardware.Memory.runStorageTick;
      const drainStorage = TickRoot.Hardware.Memory.drainStorage;
      type StorageWork = TickRoot.Hardware.Memory.StorageWork;

      function fail(message: string): never {
        throw new Error(`[ZerOS.Hardware.Memory.StorageTickCheck] ${message}`);
      }

      function piece(channel: number, octets: number, step: (work: StorageWork) => void): StorageWork {
        const work: StorageWork = {
          channel,
          octets,
          moved: 0,
          run(): void {
            step(work);
          },
        };
        return work;
      }

      function expectDone(work: StorageWork, label: string): void {
        if (work.moved !== work.octets) {
          fail(`${label} moved ${String(work.moved)} of ${String(work.octets)}`);
        }
      }

      /**
       * 跑完调度入口的约定。通过时返回空串。
       * 钟是测试自己的数，不使用墙钟，所以这里不会真的睡 200 毫秒。
       */
      export function runStorageTickCheck(): string {
        const idleNow = { value: 0 };
        runStorageTick([], { now: (): number => idleNow.value });
        if (idleNow.value !== 0) {
          fail("an empty tick advanced the clock");
        }

        const parallelNow = { value: 0 };
        const parallel: StorageWork[] = [];
        let channel = 0;
        while (channel < 5) {
          const current = channel;
          parallel.push(piece(current, 100, (work): void => {
            work.moved = work.octets;
          }));
          channel += 1;
        }
        runStorageTick(parallel, { now: (): number => parallelNow.value });
        for (const work of parallel) {
          expectDone(work, `channel ${String(work.channel)}`);
        }

        const sliceNow = { value: 0 };
        const first = piece(3, 10, (work): void => {
          work.moved = work.octets;
          sliceNow.value += TickWorkMs;
        });
        const second = piece(3, 10, (work): void => {
          work.moved = work.octets;
        });
        runStorageTick([first, second], { now: (): number => sliceNow.value });
        expectDone(first, "first slice");
        if (second.moved !== 0) {
          fail("the next piece on the same channel started after the tick was full");
        }
        drainStorage([first, second], { now: (): number => sliceNow.value });
        expectDone(second, "early next tick");

        const keepNow = { value: 0 };
        const only = piece(1, 10, (work): void => {
          const room = work.octets - work.moved;
          const step = room > 4 ? 4 : room;
          work.moved += step;
          keepNow.value += TickWorkMs;
        });
        drainStorage([only], { now: (): number => keepNow.value });
        expectDone(only, "same task across ticks");

        const earlyNow = { value: 0 };
        const earlyA = piece(2, 8, (work): void => {
          work.moved = work.octets;
          earlyNow.value += 1;
        });
        const earlyB = piece(2, 8, (work): void => {
          work.moved = work.octets;
          earlyNow.value += 1;
        });
        runStorageTick([earlyA, earlyB], { now: (): number => earlyNow.value });
        expectDone(earlyA, "early first");
        expectDone(earlyB, "early second");
        if (earlyNow.value >= TickWorkMs) {
          fail("an early finish waited out the tick");
        }
        return "";
      }
    }
  }
}
