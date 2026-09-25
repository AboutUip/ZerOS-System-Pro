/**
 * @module ZerOS.Hardware.Motherboard.Mailbox
 * @description 主板和内存线程之间的共享信箱
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只定义信箱布局和文本读写。不创建 Worker，也不调用内存端口。
 * 这是官方宿主的线程传输，不是一份新的硬件协议。ZMP1 和通道字宽都不在这里改。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 槽位、操作、状态
 *   2. 分配与视图
 *   3. 文本
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      /* ------------------------------------------------------------------ */
      /* 1. 槽位                                                             */
      /* ------------------------------------------------------------------ */

      /** 整块信箱的字节数。前 32 字节是控制字，接着三个 64 位整数，后面是文本。 */
      export const MailboxBytes = 320;

      /** 文本区起点。必须 8 字节对齐，好让前面的 bigint 视图合法。 */
      export const MailboxTextOffset = 64;

      /** 文本区长度。错误句子写在这里，通知对方之前必须先写完。 */
      export const MailboxTextBytes = 256;

      /**
       * Int32 控制字下标。
       * Seq 最后写。对方看见新的 Seq 时，操作码和参数已经写好。
       */
      export const MailSlot = {
        Wake: 0,
        Seq: 1,
        Op: 2,
        Status: 3,
        Width: 4,
        Count: 8,
      } as const;

      /** 信箱操作。数值只在两条硬件线程之间使用。 */
      export const MailOp = {
        None: 0,
        Power: 1,
        Read: 2,
        Write: 3,
        Hertz: 4,
        Metric: 5,
      } as const;

      /**
       * 信箱状态。
       * Bound 只表示内存线程已经拿住这块共享内存。
       * Ok / Failed 才是一次操作的结果。
       */
      export const MailStatus = {
        Idle: 0,
        Busy: 1,
        Ok: 2,
        Failed: 3,
        Bound: 4,
      } as const;

      /** 线程消息的 kind。页面、主板线程、内存线程都认这些字符串。 */
      export const MailMessage = {
        Power: "power",
        Fault: "fault",
        Bind: "bind",
        Go: "go",
        Ready: "ready",
        Checked: "checked",
        Present: "present",
        Frame: "frame",
        Run: "run",
        Trace: "trace",
        Inbox: "inbox",
        Panel: "panel",
        Exchange: "exchange",
        ExchangeResult: "exchange-result",
      } as const;

      /* ------------------------------------------------------------------ */
      /* 2. 视图                                                             */
      /* ------------------------------------------------------------------ */

      /** 一块新的信箱。调用方必须已经处在跨源隔离的线程里。 */
      export function createMailbox(): SharedArrayBuffer {
        return new SharedArrayBuffer(MailboxBytes);
      }

      /** 控制字视图。Atomics.wait 只用这一块。 */
      export function mailboxControl(buffer: SharedArrayBuffer): Int32Array {
        return new Int32Array(buffer, 0, MailSlot.Count);
      }

      /**
       * 三个 64 位整数：地址、数据、结果。
       * 下标 0 是地址，1 是写入数据，2 是读出的结果。
       */
      export function mailboxWords(buffer: SharedArrayBuffer): BigInt64Array {
        return new BigInt64Array(buffer, 32, 3);
      }

      /* ------------------------------------------------------------------ */
      /* 3. 文本                                                             */
      /* ------------------------------------------------------------------ */

      /** 把一句宿主错误写进文本区。超长部分丢掉，避免盖住后面的内存。 */
      export function writeMailboxText(buffer: SharedArrayBuffer, text: string): void {
        const bytes = new Uint8Array(buffer, MailboxTextOffset, MailboxTextBytes);
        bytes.fill(0);
        const encoded = new TextEncoder().encode(text);
        const length = encoded.length < 255 ? encoded.length : 255;
        bytes.set(encoded.subarray(0, length));
      }

      /** 读出文本区。空串表示这次操作没有宿主错误句。 */
      export function readMailboxText(buffer: SharedArrayBuffer): string {
        const bytes = new Uint8Array(buffer, MailboxTextOffset, MailboxTextBytes);
        let end = bytes.indexOf(0);
        if (end < 0) {
          end = bytes.length;
        }
        /* TextDecoder 拒绝共享内存上的视图，先抄到普通数组再解码。 */
        const copy = new Uint8Array(end);
        copy.set(bytes.subarray(0, end));
        return new TextDecoder().decode(copy);
      }
    }
  }
}
