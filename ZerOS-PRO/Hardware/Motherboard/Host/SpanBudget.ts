/**
 * @module ZerOS.Hardware.Motherboard.SpanBudget
 * @description 主板和内存线程之间一次消息的当前上限
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 上限不是必须长度。本次要多少八位组，就送多少，只是不能超过当前上限。
 * 默认 16MB。一段已经送满、后面还有同一笔数据时，立刻把上限加一倍，最多 256MB。
 * 内核在监督核窗口写下这一轮允许的上限：没有前台任务时收回 16MB，有前台时允许加到 256MB。
 * 这块状态只活在主板线程。CPU 线程看见内核写下的字之后，用消息把数字交过来。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 当前上限
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as MailboxRoot } from "./Mailbox";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      const SpanDefaultBytes = MailboxRoot.Hardware.Motherboard.SpanDefaultBytes;
      const SpanCeilBytes = MailboxRoot.Hardware.Motherboard.SpanCeilBytes;

      /** 内核这一轮允许的上限。没有前台时是 16MB，有前台时可以到 256MB。 */
      let cap = SpanDefaultBytes;

      /**
       * 下一次消息实际使用的上限。
       * 从 16MB 起。一段送满并且后面还有数据时才加一倍，不会一上来就按 256MB 送。
       */
      let piece = SpanDefaultBytes;

      /**
       * 收下内核刚发布的上限。
       * 小于默认值的数（包括还没写过的 0）都按 16MB。大于绝对上限的数按 256MB。
       * 允许的上限变小，当前这一段也马上收回，不等下一次调度循环。
       */
      export function spanApply(limit: number): void {
        let next = SpanDefaultBytes;
        if (Number.isSafeInteger(limit) && limit >= SpanDefaultBytes) {
          next = limit > SpanCeilBytes ? SpanCeilBytes : limit;
        }
        cap = next;
        if (piece > cap) {
          piece = cap;
        }
      }

      /**
       * 这一段实际要送的八位组数。
       * 剩下的比当前上限短，就只送剩下的，不补齐。剩下的更长，这一段停在当前上限。
       */
      export function spanTake(remain: number): number {
        if (remain < piece) {
          return remain;
        }
        return piece;
      }

      /**
       * 这一段已经送满当前上限，同一笔数据后面还有。
       * 立刻加一倍，不超过内核刚给定的上限。加完之后的下一段就用新上限，不用再等下一次缺页。
       */
      export function spanFilled(sent: number): void {
        if (sent < piece || piece >= cap) {
          return;
        }
        const doubled = piece * 2;
        piece = doubled > cap ? cap : doubled;
      }
    }
  }
}
