/**
 * @module ZerOS.Hardware.Motherboard.MemoryLink
 * @description 主板线程通往内存线程的信箱客户端
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 在主板线程里创建内存 Worker，并把一次上电或一次通道访问做成同步调用。
 * 等待用 Atomics.wait。这个调用只能发生在主板线程上，页面线程不能用。
 * 不导入内存实现。内存源码由内存 Worker 自己加载。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 链接
 *   3. 单例
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as ClockRoot } from "../../Clock/Bootstrap/HostClock";
import { ZerOS as MailboxRoot } from "./Mailbox";
import { ZerOS as QueryRoot } from "./HardwareQuery";
import { ZerOS as QueuedWorkerRoot } from "./QueuedWorker";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      const MailSlot = MailboxRoot.Hardware.Motherboard.MailSlot;
      const MailOp = MailboxRoot.Hardware.Motherboard.MailOp;
      const MailStatus = MailboxRoot.Hardware.Motherboard.MailStatus;
      const MailMessage = MailboxRoot.Hardware.Motherboard.MailMessage;
      const createMailbox = MailboxRoot.Hardware.Motherboard.createMailbox;
      const mailboxControl = MailboxRoot.Hardware.Motherboard.mailboxControl;
      const mailboxWords = MailboxRoot.Hardware.Motherboard.mailboxWords;
      const writeMailboxText = MailboxRoot.Hardware.Motherboard.writeMailboxText;
      const readMailboxText = MailboxRoot.Hardware.Motherboard.readMailboxText;
      const noteMemoryPace = QueryRoot.Hardware.Motherboard.noteMemoryPace;

      const linkPrefix = "[ZerOS.Hardware.Motherboard.MemoryLink]";

      /**
       * 主板线程持有的那一条内存链接。
       * 上电会堵住这条线程，直到内存线程把测试和初始化做完。页面线程不在这里等。
       */
      export class MemoryLink {
        private readonly buffer: SharedArrayBuffer;

        private readonly control: Int32Array;

        private readonly words: BigInt64Array;

        private readonly worker: Worker;

        private seq = 0;

        private failed = false;

        /** 内存线程异常事件上的原句。没有时用统一的停机说明。 */
        private failText = "";

        /** 调度模块已经装完并声明可以接收信箱。 */
        private readonly whenReady: Promise<void>;

        /** 信箱已经交给内存线程。重复上电不再绑定。 */
        private bound = false;

        /**
         * 创建信箱和内存线程。
         * 不在这里发送信箱。要等对方声明就绪，否则这条消息会在监听装上之前丢掉。
         */
        public constructor() {
          if (!crossOriginIsolated) {
            throw new Error(`${linkPrefix} 硬件线程需要跨源隔离的共享内存`);
          }
          this.buffer = createMailbox();
          this.control = mailboxControl(this.buffer);
          this.words = mailboxWords(this.buffer);
          this.worker = QueuedWorkerRoot.Hardware.Motherboard.openMemoryWorker();
          this.whenReady = this.listenForReady();
        }

        /**
         * 让内存线程按主板给的协议名单坐上插头并完成测试和初始化。
         * 先等就绪，再交出信箱，然后才等测试。返回时总控已经在内存线程里发布，或者抛出对方带回来的原句。
         */
        public async power(supported: readonly string[]): Promise<void> {
          await this.whenReady;
          if (!this.bound) {
            this.worker.postMessage({
              kind: MailMessage.Bind,
              mailbox: this.buffer,
              clockOrigin: ClockRoot.Hardware.Clock.clockOrigin(),
            });
            this.waitUntil(MailStatus.Bound, 0, 10000, `${linkPrefix} 内存线程没有接上信箱`);
            this.bound = true;
          }
          this.transact(MailOp.Power, (): void => undefined, supported, 120000);
        }

        /** 上电成功后，内存线程留在文本区的观测行。 */
        public readText(): string {
          return readMailboxText(this.buffer);
        }

        /**
         * 等内存线程装完调度。
         * 这段用消息，不用 Atomics.wait，这样主板线程还能接收「就绪」。
         * 就绪之后的通道等待才进入 Atomics.wait。
         */
        private listenForReady(): Promise<void> {
          return new Promise((resolve, reject): void => {
            let settled = false;
            const timer = setTimeout((): void => {
              if (settled) {
                return;
              }
              settled = true;
              reject(new Error(`${linkPrefix} 内存线程没有就绪`));
            }, 60000);
            this.worker.onmessage = (event: MessageEvent): void => {
              if (settled) {
                return;
              }
              const data: unknown = event.data as unknown;
              const fault = readFault(data);
              if (fault !== null) {
                settled = true;
                clearTimeout(timer);
                reject(new Error(fault));
                return;
              }
              if (!isReady(data)) {
                return;
              }
              settled = true;
              clearTimeout(timer);
              resolve();
            };
            this.worker.onerror = (event: ErrorEvent): void => {
              this.failed = true;
              this.failText = event.message;
              Atomics.add(this.control, MailSlot.Wake, 1);
              Atomics.notify(this.control, MailSlot.Wake);
              if (settled) {
                return;
              }
              settled = true;
              clearTimeout(timer);
              const detail = this.failText.length > 0 ? this.failText : "内存线程停了";
              reject(new Error(detail.startsWith("[") ? detail : `${linkPrefix} ${detail}`));
            };
          });
        }

        /** 通道读。地址和字宽先写入信箱，结果在返回值里。 */
        public read(address: bigint, width: number): bigint {
          this.transact(MailOp.Read, (): void => {
            this.storeWord(0, address);
            Atomics.store(this.control, MailSlot.Width, width);
          }, null, 5000);
          noteMemoryPace(readMailboxText(this.buffer));
          return this.loadWord(2);
        }

        /** 通道写。数据进信箱，内存线程在改存储体之前做自己的拒绝。 */
        public write(address: bigint, width: number, data: bigint): void {
          this.transact(MailOp.Write, (): void => {
            this.storeWord(0, address);
            this.storeWord(1, data);
            Atomics.store(this.control, MailSlot.Width, width);
          }, null, 5000);
          noteMemoryPace(readMailboxText(this.buffer));
        }

        /** 改内存 Hz。非法值由内存线程拒绝，已记下的频率不动。 */
        public setHertz(hertz: bigint): void {
          this.transact(MailOp.Hertz, (): void => {
            this.storeWord(0, hertz);
          }, null, 5000);
          noteMemoryPace(readMailboxText(this.buffer));
        }

        /** 读内存指标。0 是 Hz，1 是已完成条数。 */
        public metric(kind: bigint): bigint {
          this.transact(MailOp.Metric, (): void => {
            this.storeWord(0, kind);
          }, null, 5000);
          noteMemoryPace(readMailboxText(this.buffer));
          return this.loadWord(2);
        }

        /**
         * 把一次操作交给内存线程并等到它写回状态。
         * 先写参数，最后写 Seq，再发消息。内存线程即使还没开始等，完成后也会把状态留在信箱里。
         */
        private transact(
          op: number,
          fill: () => void,
          supported: readonly string[] | null,
          timeout: number,
        ): void {
          const seq = this.seq + 1;
          this.seq = seq;
          fill();
          writeMailboxText(this.buffer, "");
          Atomics.store(this.control, MailSlot.Op, op);
          Atomics.store(this.control, MailSlot.Status, MailStatus.Busy);
          Atomics.store(this.control, MailSlot.Seq, seq);
          if (supported === null) {
            this.worker.postMessage({ kind: MailMessage.Go });
          } else {
            this.worker.postMessage({ kind: MailMessage.Go, supported });
          }
          this.waitUntil(MailStatus.Ok, seq, timeout, `${linkPrefix} 内存线程没有在时限内完成`);
        }

        /** 等到这次 Seq 的状态不再是 Busy。失败状态把内存线程写来的原句抛出去。 */
        private waitUntil(expected: number, seq: number, timeout: number, timeoutMessage: string): void {
          const start = performance.now();
          for (;;) {
            if (this.failed) {
              const detail = this.failText.length > 0 ? this.failText : "内存线程停了";
              throw new Error(detail.startsWith("[") ? detail : `${linkPrefix} ${detail}`);
            }
            const seen = Atomics.load(this.control, MailSlot.Seq);
            const status = Atomics.load(this.control, MailSlot.Status);
            if (seen === seq && status === expected) {
              return;
            }
            if (seen === seq && status === MailStatus.Failed) {
              const message = readMailboxText(this.buffer);
              throw new Error(message.length > 0 ? message : `${linkPrefix} 内存线程拒绝了这次操作`);
            }
            if (performance.now() - start > timeout) {
              throw new Error(timeoutMessage);
            }
            const token = Atomics.load(this.control, MailSlot.Wake);
            Atomics.wait(this.control, MailSlot.Wake, token, 50);
          }
        }

        /** 写入地址或数据槽。0 是地址，1 是数据。 */
        private storeWord(index: 0 | 1, value: bigint): void {
          this.words[index] = value;
        }

        /** 读出结果槽。 */
        private loadWord(index: 2): bigint {
          const value = this.words[index];
          if (value === undefined) {
            throw new Error(`${linkPrefix} 信箱整数槽不存在`);
          }
          return value;
        }
      }

      /** 内存线程已经装完调度。kind 与信箱里的 Ready 相同。 */
      function isReady(data: unknown): boolean {
        const record = asRecord(data);
        if (record === null) {
          return false;
        }
        return record["kind"] === MailMessage.Ready;
      }

      /** 引导脚本装调度失败时带回来的原句。没有这句时返回 null。 */
      function readFault(data: unknown): string | null {
        const record = asRecord(data);
        if (record?.["kind"] !== MailMessage.Fault) {
          return null;
        }
        const message = record["message"];
        if (typeof message !== "string" || message.length === 0) {
          return `${linkPrefix} 内存线程没有装上调度`;
        }
        return message;
      }

      function asRecord(data: unknown): Record<string, unknown> | null {
        if (typeof data !== "object" || data === null || Array.isArray(data)) {
          return null;
        }
        return data as Record<string, unknown>;
      }

      /** 这条主板线程上的唯一内存链接。 */
      let activeLink: MemoryLink | null = null;

      /** 取得或创建内存链接。重复上电不另开一条内存线程。 */
      export function sharedMemoryLink(): MemoryLink {
        return (activeLink ??= new MemoryLink());
      }
    }
  }
}
