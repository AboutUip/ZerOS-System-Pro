/**
 * @module ZerOS.Hardware.Motherboard.Inbox
 * @description 主板上的入站整数队列
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 页面把一串整数投到这里。CPU 用通用指令一次取走一个。
 * 主板不解释这些整数是什么。队列满时整段丢掉，不留下半段。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 队列
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      /** 最多留下的整数个数。一次键盘事件是 6 个，这里能放下 16 次。 */
      const InboxCapacity = 96;

      const words: bigint[] = [];

      /**
       * 整段放入队列。
       * 放不下时这一段全部不进，已经在队列里的整数不动。
       */
      export function pushInbox(incoming: readonly bigint[]): void {
        if (incoming.length < 1 || words.length + incoming.length > InboxCapacity) {
          return;
        }
        for (const word of incoming) {
          if (word < 0n || word > 0xffffffffffffffffn) {
            return;
          }
        }
        for (const word of incoming) {
          words.push(word);
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
