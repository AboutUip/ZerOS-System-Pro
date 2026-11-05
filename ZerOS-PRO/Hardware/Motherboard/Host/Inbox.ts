/**
 * @module ZerOS.Hardware.Motherboard.Inbox
 * @description 主板上的入站整数队列
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 页面把一串整数投到这里。CPU 可以用通用指令一次取走一个。
 * 一次交换也可以把当前队列连续取走，直到调用方停止。主板不解释这些整数是什么。
 * 队列满时整段丢掉，不留下半段。
 * 有字没取走时在指标页尾写一个标记。监督核看见就让出一次，固件才能来取。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 队列
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as MetricRoot } from "./MetricPage";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      /** 最多留下的整数个数。一次键盘事件是 6 个，这里能放下 16 次。 */
      const InboxCapacity = 96;

      const words: bigint[] = [];

      export type InboxResult = "ok" | "overflow" | "invalid";

      /**
       * 整段放入队列。
       * 放不下时这一段全部不进，已经在队列里的整数不动。
       */
      export function pushInbox(incoming: readonly bigint[]): InboxResult {
        if (incoming.length < 1 || words.length + incoming.length > InboxCapacity) {
          return "overflow";
        }
        for (const word of incoming) {
          if (word < 0n || word > 0xffffffffffffffffn) {
            return "invalid";
          }
        }
        for (const word of incoming) {
          words.push(word);
        }
        /* 第一个字是事件种类。1 是松开，不记成还没写进环的按下。 */
        const press = incoming.length > 0 && incoming[0] !== 1n;
        MetricRoot.Hardware.Motherboard.raiseKeyAttention(press);
        return "ok";
      }

      /** 队列里还有没有整数。不取出。 */
      export function inboxPending(): boolean {
        return words.length > 0;
      }

      function wordFromOctets(bytes: Uint8Array): bigint {
        let packed = 0n;
        for (let octet = 0; octet < bytes.length && octet < 8; octet += 1) {
          packed += BigInt(bytes[octet] ?? 0) << BigInt(octet * 8);
        }
        return packed;
      }

      /**
       * 把队列里的字交给这个口。
       * 空队列不调用交换，返回 -1。调用方自己保存上一次次数。
       * 完成一次事件就停，后面的字留在队列里。交换本身仍是方向 0 或 1。
       */
      export function drainInboxThrough(
        exchange: (direction: number, word: bigint) => Uint8Array,
      ): bigint {
        if (words.length < 1) {
          return -1n;
        }
        let count = wordFromOctets(exchange(1, 0n));
        for (;;) {
          const word = words.shift();
          if (word === undefined) {
            return count;
          }
          const next = wordFromOctets(exchange(0, word));
          if (next !== count) {
            return next;
          }
        }
      }

      /** 取出最早的一个整数。队列空时返回 null，不算失败。 */
      export function pullInbox(): bigint | null {
        const word = words.shift();
        if (word === undefined) {
          return null;
        }
        return word;
      }
    }
  }
}
