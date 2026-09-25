/**
 * @module ZerOS.Hardware.Memory.MemoryDispatch
 * @description 内存线程上的信箱调度
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 绑定信箱只碰共享内存布局，所以本文件静态导入的只有信箱。
 * 通道和坐座在第一条操作到来时再装。测试代码因此不会挡住「已经接上信箱」这句回复。
 * 不创建 Worker，也不决定主板何时上电。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 消息
 *   3. 执行
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as MailboxRoot } from "../../Motherboard/Host/Mailbox";
import { ZerOS as ClockRoot } from "./MemoryClock";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      const MailSlot = MailboxRoot.Hardware.Motherboard.MailSlot;
      const MailOp = MailboxRoot.Hardware.Motherboard.MailOp;
      const MailStatus = MailboxRoot.Hardware.Motherboard.MailStatus;
      const MailMessage = MailboxRoot.Hardware.Motherboard.MailMessage;
      const mailboxControl = MailboxRoot.Hardware.Motherboard.mailboxControl;
      const mailboxWords = MailboxRoot.Hardware.Motherboard.mailboxWords;
      const writeMailboxText = MailboxRoot.Hardware.Motherboard.writeMailboxText;
      const spend = ClockRoot.Hardware.Memory.spend;
      const setHertz = ClockRoot.Hardware.Memory.setHertz;
      const currentHertz = ClockRoot.Hardware.Memory.currentHertz;
      const currentExecuted = ClockRoot.Hardware.Memory.currentExecuted;
      const paceText = ClockRoot.Hardware.Memory.paceText;
      const adoptOrigin = ClockRoot.Hardware.Memory.adoptOrigin;

      /** 通道读、通道写、坐座。三者都在内存实现里，本文件不静态导入它们。 */
      interface MemoryCommands {
        executeChannelRead: (address: bigint, width: number) => bigint;
        executeChannelWrite: (address: bigint, width: number, data: bigint) => void;
        seatActiveMemory: (supported: readonly string[]) => void;
        memoryObserveText: () => string;
      }

      /** 主板交来的信箱。bind 之前为空。 */
      let mailbox: SharedArrayBuffer | null = null;

      /** 内存实现的装载结果。同一条线程只装一次。 */
      let commands: MemoryCommands | null = null;

      /** 正在装内存实现的那一次 Promise。 */
      let loading: Promise<void> | null = null;

      function asRecord(data: unknown): Record<string, unknown> | null {
        if (typeof data !== "object" || data === null || Array.isArray(data)) {
          return null;
        }
        return data as Record<string, unknown>;
      }

      function readKind(record: Record<string, unknown>): string | null {
        const value = record["kind"];
        if (typeof value !== "string") {
          return null;
        }
        return value;
      }

      function readSupported(record: Record<string, unknown>): string[] | null {
        const value = record["supported"];
        if (!Array.isArray(value)) {
          return null;
        }
        const supported: string[] = [];
        for (const item of value) {
          if (typeof item !== "string") {
            return null;
          }
          supported.push(item);
        }
        return supported;
      }

      function errorText(error: unknown, fallback: string): string {
        if (error instanceof Error && error.message.length > 0) {
          return error.message;
        }
        return fallback;
      }

      /**
       * 装上通道和坐座。
       * 这两份模块再去静态导入内存实现，所以整棵源码图仍按原文件分开，只是不挡在入口上。
       */
      function ensureCommands(): Promise<void> {
        loading ??= Promise.all([import("./ChannelServer"), import("./SeatCommand")]).then(
          ([channelMod, seatMod]): void => {
            commands = {
              executeChannelRead: channelMod.ZerOS.Hardware.Memory.executeChannelRead,
              executeChannelWrite: channelMod.ZerOS.Hardware.Memory.executeChannelWrite,
              seatActiveMemory: seatMod.ZerOS.Hardware.Memory.seatActiveMemory,
              memoryObserveText: seatMod.ZerOS.Hardware.Memory.memoryObserveText,
            };
          },
        );
        return loading;
      }

      /** 先写文本，最后写状态，再叫醒主板线程。 */
      function finish(status: number, text: string): void {
        const buffer = mailbox;
        if (buffer === null) {
          return;
        }
        writeMailboxText(buffer, text);
        Atomics.store(mailboxControl(buffer), MailSlot.Status, status);
        Atomics.add(mailboxControl(buffer), MailSlot.Wake, 1);
        Atomics.notify(mailboxControl(buffer), MailSlot.Wake);
      }

      function onBind(record: Record<string, unknown>): void {
        const value = record["mailbox"];
        if (!(value instanceof SharedArrayBuffer)) {
          throw new Error("[ZerOS.Hardware.Motherboard.MemoryLink] 主板没有交来共享信箱");
        }
        mailbox = value;
        const origin = record["clockOrigin"];
        if (typeof origin === "number") {
          adoptOrigin(origin);
        }
        finish(MailStatus.Bound, "");
      }

      /**
       * 执行信箱里已经写好的那一次操作。
       * 内存实现若还在装，就等它装完再做。上电会在这条线程上同步跑完整套测试。
       */
      function onGo(record: Record<string, unknown>): void {
        const buffer = mailbox;
        if (buffer === null) {
          return;
        }
        void ensureCommands().then(
          (): void => {
            runGo(record);
          },
          (error: unknown): void => {
            finish(MailStatus.Failed, errorText(error, "内存实现没有装上"));
          },
        );
      }

      function cyclesOf(width: number): number {
        if (width <= 8) {
          return 1;
        }
        return width / 8;
      }

      function runGo(record: Record<string, unknown>): void {
        void runAccess(record);
      }

      async function runAccess(record: Record<string, unknown>): Promise<void> {
        const buffer = mailbox;
        const ready = commands;
        if (buffer === null || ready === null) {
          finish(MailStatus.Failed, "[ZerOS.Hardware.Motherboard.MemoryLink] 内存实现没有装上");
          return;
        }
        const control = mailboxControl(buffer);
        const words = mailboxWords(buffer);
        const op = Atomics.load(control, MailSlot.Op);
        try {
          if (op === MailOp.Power) {
            const supported = readSupported(record);
            if (supported === null) {
              throw new Error("[ZerOS.Hardware.Motherboard.MemorySeat] 主板没有交来协议名单");
            }
            ready.seatActiveMemory(supported);
            finish(MailStatus.Ok, ready.memoryObserveText());
            return;
          }
          const address = words[0];
          const data = words[1];
          if (address === undefined || data === undefined) {
            throw new Error("[ZerOS.Hardware.Motherboard.MemoryChannel] 信箱里没有地址或数据");
          }
          const width = Atomics.load(control, MailSlot.Width);
          if (op === MailOp.Read) {
            const value = ready.executeChannelRead(address, width);
            await spend(cyclesOf(width));
            words[2] = value;
            finish(MailStatus.Ok, paceText());
            return;
          }
          if (op === MailOp.Write) {
            ready.executeChannelWrite(address, width, data);
            await spend(cyclesOf(width));
            finish(MailStatus.Ok, paceText());
            return;
          }
          if (op === MailOp.Hertz) {
            const hertz = Number(address);
            setHertz(hertz);
            await spend(1);
            finish(MailStatus.Ok, paceText());
            return;
          }
          if (op === MailOp.Metric) {
            const kind = Number(address);
            if (kind !== 0 && kind !== 1) {
              throw new Error("[ZerOS.Hardware.Memory.MemoryClock] 没有这种内存指标");
            }
            await spend(1);
            words[2] = BigInt(kind === 0 ? currentHertz() : currentExecuted());
            finish(MailStatus.Ok, paceText());
            return;
          }
          throw new Error("[ZerOS.Hardware.Motherboard.MemoryLink] 内存线程不认识这次操作");
        } catch (error: unknown) {
          finish(MailStatus.Failed, errorText(error, "内存线程失败"));
        }
      }

      /**
       * 接收一条已经排队或刚到达的消息。
       * 绑定立即回复。操作可以等内存实现装完。
       */
      export function acceptMemoryMessage(data: unknown): void {
        const record = asRecord(data);
        if (record === null) {
          return;
        }
        const kind = readKind(record);
        if (kind === MailMessage.Bind) {
          onBind(record);
          return;
        }
        if (kind === MailMessage.Go) {
          onGo(record);
        }
      }

      /** 入口把调度装上之后，内存实现就开始装，不必再等第一条操作。 */
      void ensureCommands();
    }
  }
}
