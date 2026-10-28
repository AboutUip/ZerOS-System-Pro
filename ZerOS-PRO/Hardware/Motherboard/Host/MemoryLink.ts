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
import { ZerOS as SpanBudgetRoot } from "./SpanBudget";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      const MailSlot = MailboxRoot.Hardware.Motherboard.MailSlot;
      const MailOp = MailboxRoot.Hardware.Motherboard.MailOp;
      const MailStatus = MailboxRoot.Hardware.Motherboard.MailStatus;
      const MailMessage = MailboxRoot.Hardware.Motherboard.MailMessage;
      const createMailbox = MailboxRoot.Hardware.Motherboard.createMailbox;
      const SpanCeilBytes = MailboxRoot.Hardware.Motherboard.SpanCeilBytes;
      const SpanLaneBytes = MailboxRoot.Hardware.Motherboard.SpanLaneBytes;
      const spanTake = SpanBudgetRoot.Hardware.Motherboard.spanTake;
      const spanFilled = SpanBudgetRoot.Hardware.Motherboard.spanFilled;
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

        /**
         * 和内存线程共用的搬运区。
         * 容量是这一块缓冲有多大，不是这一次必须送满的长度。不够本次那一段时再换一块更大的。
         */
        private span: Uint8Array;

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
          this.span = new Uint8Array(new SharedArrayBuffer(SpanLaneBytes));
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
              span: this.span.buffer,
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

        /**
         * 把一整段八位组写入连续的线性地址。相邻八位组相隔 8 个位元。
         * 每一段只送这一次用到的长度。送满当前上限并且后面还有时，立刻把上限加一倍再送下一段。
         */
        public writeSpan(address: bigint, bytes: Uint8Array): void {
          let offset = 0;
          while (offset < bytes.length) {
            const run = spanTake(bytes.length - offset);
            this.ensureSpan(run);
            this.span.set(bytes.subarray(offset, offset + run));
            const bit = address + BigInt(offset) * 8n;
            this.transact(MailOp.WriteSpan, (): void => {
              this.storeWord(0, bit);
              Atomics.store(this.control, MailSlot.Width, run);
            }, null, 30000);
            offset += run;
            if (offset < bytes.length) {
              spanFilled(run);
            }
          }
          if (bytes.length > 0) {
            noteMemoryPace(readMailboxText(this.buffer));
          }
        }

        /**
         * 从连续的线性地址读出一整段八位组。
         * 返回的是拷贝，搬运区可以立刻再给下一次用。
         * 调用方要的长度可以大于当前上限。这里按上限分段，段满了立刻加倍，一次调用里把要的字节读完。
         */
        public readSpan(address: bigint, length: number): Uint8Array {
          const out = new Uint8Array(length);
          let offset = 0;
          while (offset < length) {
            const run = spanTake(length - offset);
            this.ensureSpan(run);
            const bit = address + BigInt(offset) * 8n;
            this.transact(MailOp.ReadSpan, (): void => {
              this.storeWord(0, bit);
              Atomics.store(this.control, MailSlot.Width, run);
            }, null, 30000);
            out.set(this.span.subarray(0, run), offset);
            offset += run;
            if (offset < length) {
              spanFilled(run);
            }
          }
          if (length > 0) {
            noteMemoryPace(readMailboxText(this.buffer));
          }
          return out;
        }

        /**
         * 搬运区装不下这一段时，换成刚好够这一段的共享缓冲。
         * 按两倍往上长，停在绝对上限，不会为了短访问去占 256MB。
         * 新缓冲先交给内存线程，再开始这一段的握手。两条消息进同一条队列，内存线程会先换缓冲再搬字节。
         */
        private ensureSpan(need: number): void {
          if (need <= this.span.length) {
            return;
          }
          let size = this.span.length;
          while (size < need && size < SpanCeilBytes) {
            const grown = size * 2;
            size = grown > SpanCeilBytes ? SpanCeilBytes : grown;
          }
          if (size < need) {
            throw new Error(`${linkPrefix} span lane cannot hold this piece`);
          }
          const shared = new SharedArrayBuffer(size);
          this.span = new Uint8Array(shared);
          this.worker.postMessage({ kind: MailMessage.SpanBind, span: shared });
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
            /* 先记下叫醒计数，再看这次是不是已经写完。
               内存线程往往比主板进入等待更快：状态已经是完成，计数也已经加过。
               若这时仍按新计数去等下一次叫醒，没人会再通知，每次读写都要睡满 50 毫秒。
               计数没变而状态仍是忙，才睡。完成发生在这两次读取之间时，等的是旧计数，通知能立刻回来。 */
            const token = Atomics.load(this.control, MailSlot.Wake);
            const seenNow = Atomics.load(this.control, MailSlot.Seq);
            const statusNow = Atomics.load(this.control, MailSlot.Status);
            if (seenNow === seq && statusNow !== MailStatus.Busy) {
              continue;
            }
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
