/**
 * @module ZerOS.Hardware.Debug.BootTrace
 * @description 引导各阶段的宿主时刻
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 记下从页面进来到终端画出之间，每一段结束时的宿主时刻。
 * 页面自己调用 markBoot。主板线程里的调用改走消息，由页面收下。
 * 客程序只把阶段编号写到位地址 7296。CPU 座看见 store.64，或原生核送出的邮箱段，再记时刻。
 * 不改协议，也不把这些编号交给客程序读。优化做完后可以整份撤掉。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 记录
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as MailboxRoot } from "../../Motherboard/Host/Mailbox";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Debug {
      const MailMessage = MailboxRoot.Hardware.Motherboard.MailMessage;

      /* ------------------------------------------------------------------ */
      /* 2. 记录                                                             */
      /* ------------------------------------------------------------------ */

      /** 一个阶段的名字，以及它结束时的宿主绝对毫秒。 */
      export interface BootMark {
        readonly Name: string;
        /** performance.timeOrigin 加 performance.now()。页面和各条 Worker 可以相减。 */
        readonly At: number;
      }

      interface BootWindow {
        __zerosBoot?: BootMark[];
      }

      /** 只在页面这条线程里累积。主板线程不保留第二份。 */
      const marks: BootMark[] = [];

      /**
       * 客程序写进 7296 的编号。
       * 编号是这一轮测量的阶段，不是协议字段。
       */
      function guestStage(id: number): string {
        switch (id) {
          case 1:
            return "load-enter";
          case 2:
            return "load-open";
          case 3:
            return "load-read";
          case 4:
            return "load-go";
          case 5:
            return "bios-go";
          case 10:
            return "boot";
          case 11:
            return "mm";
          case 12:
            return "suite";
          case 13:
            return "vfs-enter";
          case 14:
            return "vfs-root";
          case 15:
            return "vfs-done";
          case 16:
            return "font";
          case 17:
            return "drivers";
          case 18:
            return "images";
          case 19:
            return "init-enter";
          case 20:
            return "init-go";
          case 21:
            return "idle-wait";
          case 22:
            return "idle-free";
          case 23:
            return "idle-done";
          case 24:
            return "armed";
          case 30:
            return "sh-enter";
          case 31:
            return "sh-ready";
          case 32:
            return "sh-image";
          case 33:
            return "sh-run";
          case 34:
            return "init-wait";
          case 35:
            return "map-begin";
          case 36:
            return "map-done";
          case 37:
            return "term-up";
          case 38:
            return "pen-ack";
          case 39:
            return "face";
          case 40:
            return "inode-sent";
          case 41:
            return "dent-sent";
          case 42:
            return "pipe-sent";
          case 43:
            return "drv-begin";
          case 45:
            return "font-a";
          case 46:
            return "font-b";
          case 47:
            return "init-read";
          default:
            return "guest-" + String(id);
        }
      }

      /** 页面上的表换成最新一份，测量脚本读 globalThis.__zerosBoot。 */
      function publish(): void {
        const host = globalThis as BootWindow;
        host.__zerosBoot = marks;
      }

      /** 页面收下一条。名字原样留下，时刻必须是有限数。 */
      export function acceptBootMark(name: string, at: number): void {
        if (!Number.isFinite(at)) {
          return;
        }
        marks.push({ Name: name, At: at });
        publish();
      }

      /**
       * 记下当前宿主时刻。
       * 没有 document 的是主板线程，消息送到页面后再入表。
       * 这样各条线程用的是同一条绝对时间，而不是各算各的 performance.now()。
       */
      export function markBoot(name: string): void {
        const at = performance.timeOrigin + performance.now();
        if (typeof document === "undefined") {
          globalThis.postMessage({ kind: MailMessage.BootMark, name, at });
          return;
        }
        acceptBootMark(name, at);
      }

      /** 7296 上的编号换成阶段名，再按当前时刻入表。 */
      export function markGuestStage(id: number): void {
        markBoot(guestStage(id));
      }
    }
  }
}
