/**
 * @module ZerOS.Hardware.Memory.StorageTick
 * @description 存储 Tick 的唯一调度入口
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 一颗内存颗粒是一条 Tick 通道。本文件只决定这一拍哪些通道搬、搬到哪一份为止。
 * 真正写入颗粒的拷贝由调用方放进 `run`。这里不创建 Worker，也不改 ZMP1 的端口。
 * 名义上 1 Tick 约 0.25 秒、一秒 4 Tick。这一拍真正搬运最长 200 毫秒，不限速。
 * 这一份提前搬完，同一条通道的下一份马上开始，不等满 0.25 秒。
 * 没有别的任务时，后面的拍继续搬同一份。没有任务时直接返回，不空转等待。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 节拍
 *   2. 入口
 */

/* -------------------------------------------------------------------------- */
/* 1. 节拍                                                                     */
/* -------------------------------------------------------------------------- */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      /** 名义节拍。调度不等这一拍走完。 */
      export const TickNominalMs = 250;

      /** 一拍里真正搬运的上限。到点就停，没到就继续下一份。 */
      export const TickWorkMs = 200;

      /**
       * 一份落在某一颗上的搬运。
       * `channel` 是颗粒序号。`moved` 已搬八位组，`octets` 是这一份的总量。
       * `run` 按当时的真实速度尽量多搬，并把自己搬过的数量写回 `moved`。
       */
      export interface StorageWork {
        readonly channel: number;
        readonly octets: number;
        moved: number;
        run(): void;
      }

      /** 调用方提供的时间。生产路径用 `performance.now`，测试可以换成自己的钟。 */
      export interface StorageClock {
        now(): number;
      }

      function stillPending(work: StorageWork): boolean {
        return work.moved < work.octets;
      }

      function channelsOf(queue: readonly StorageWork[]): number[] {
        const seen = new Set<number>();
        const channels: number[] = [];
        for (const work of queue) {
          if (!stillPending(work) || seen.has(work.channel)) {
            continue;
          }
          seen.add(work.channel);
          channels.push(work.channel);
        }
        channels.sort((left, right): number => left - right);
        return channels;
      }

      function nextOn(queue: readonly StorageWork[], channel: number): StorageWork | null {
        for (const work of queue) {
          if (work.channel === channel && stillPending(work)) {
            return work;
          }
        }
        return null;
      }

      function movedTotal(queue: readonly StorageWork[]): number {
        let total = 0;
        for (const work of queue) {
          total += work.moved;
        }
        return total;
      }

      /* -------------------------------------------------------------------- */
      /* 2. 入口                                                               */
      /* -------------------------------------------------------------------- */

      /**
       * 唯一的存储调度入口。跑一拍。
       *
       * (1) 没有未完成的份，立刻返回。
       * (2) 这一拍开始时，每条还有活的通道都先搬当前这一份。五颗就是五条通道一起进这一拍。
       * (3) 还没到 200 毫秒，并且这一份已经搬完，同一条通道的下一份马上开始。
       * (4) 到了 200 毫秒就停。没搬完的留在队列里，下一拍再调度它。
       */
      export function runStorageTick(queue: readonly StorageWork[], clock: StorageClock): void {
        const channels = channelsOf(queue);
        if (channels.length === 0) {
          return;
        }
        const deadline = clock.now() + TickWorkMs;
        const opened = new Set<number>();
        let guard = 0;
        while (guard < 100000) {
          guard += 1;
          let progressed = false;
          for (const channel of channels) {
            const work = nextOn(queue, channel);
            if (work === null) {
              continue;
            }
            if (clock.now() >= deadline && opened.has(channel)) {
              continue;
            }
            const before = work.moved;
            work.run();
            opened.add(channel);
            if (work.moved !== before) {
              progressed = true;
            }
          }
          if (!progressed) {
            return;
          }
          if (clock.now() >= deadline) {
            return;
          }
        }
      }

      /**
       * 把队列里能搬的都搬完。
       * 一拍结束还有剩余时，下一拍立刻开始，中间不睡。
       * 只有一份时，后面每一拍还是这一份。
       */
      export function drainStorage(queue: readonly StorageWork[], clock: StorageClock): void {
        let guard = 0;
        while (guard < 100000) {
          guard += 1;
          if (channelsOf(queue).length === 0) {
            return;
          }
          const before = movedTotal(queue);
          runStorageTick(queue, clock);
          if (movedTotal(queue) === before) {
            return;
          }
        }
      }
    }
  }
}
