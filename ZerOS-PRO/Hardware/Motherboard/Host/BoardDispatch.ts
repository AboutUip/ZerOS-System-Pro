/**
 * @module ZerOS.Hardware.Motherboard.BoardDispatch
 * @description 主板线程上的消息调度
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 页面只送来上电。这里调用主板运行时，失败时把原句送回页面。
 * 运行时、内存座和通道仍是独立文件。本文件不导入内存实现，也不导入显示器。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 消息
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as ErrorPictureRoot } from "../../../Boot/ErrorPicture";
import { ZerOS as BoardRuntimeRoot } from "../Bootstrap/BoardRuntime";
import { ZerOS as CpuSeatRoot } from "../Seat/CpuSeat";
import { ZerOS as GpuSeatRoot } from "../Seat/GpuSeat";
import { ZerOS as InboxRoot } from "./Inbox";
import { ZerOS as MailboxRoot } from "./Mailbox";
import { ZerOS as PortRoot } from "../Slot/Expansion/ExpansionPort";
import { ZerOS as QueryRoot } from "./HardwareQuery";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      const MailMessage = MailboxRoot.Hardware.Motherboard.MailMessage;
      const powerBoard = BoardRuntimeRoot.Hardware.Motherboard.powerBoard;
      const presentFrame = GpuSeatRoot.Hardware.Motherboard.presentFrame;
      const runInstructionLines = CpuSeatRoot.Hardware.Motherboard.runInstructionLines;
      const runInstructionBinary = CpuSeatRoot.Hardware.Motherboard.runInstructionBinary;
      const startResidentLines = CpuSeatRoot.Hardware.Motherboard.startResidentLines;
      const startResidentBinary = CpuSeatRoot.Hardware.Motherboard.startResidentBinary;
      const pushInbox = InboxRoot.Hardware.Motherboard.pushInbox;
      const notePanel = QueryRoot.Hardware.Motherboard.notePanel;
      const exchangePort = PortRoot.Hardware.Motherboard.Slot.Exchange;
      const describeFault = ErrorPictureRoot.Boot.describeFault;
      const errorPicture = ErrorPictureRoot.Boot.errorPicture;
      let errorShown = false;

      /** 指令失败后只画一次。画面写出错误码、来源和能显示的说明。 */
      function showError(message: string): void {
        if (errorShown) {
          return;
        }
        errorShown = true;
        const fault = describeFault(message);
        const lines = errorPicture(fault.code, fault.source, fault.text);
        void runInstructionLines(lines).catch((error: unknown): void => {
          const text = error instanceof Error ? error.message : "异常画面没有画成";
          reportFault(text);
        });
      }

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

      /** 把失败原句送回页面。成功时另发一条 checked，让页面接着做显示器自检。 */
      function reportFault(text: string): void {
        globalThis.postMessage({
          kind: MailMessage.Fault,
          message: text,
        });
      }

      /** ZAP 行或程序二进制。二进制原样交给 CPU，文本仍走助记符解析。 */
      function readProgram(value: unknown): readonly string[] | Uint8Array | null {
        if (value instanceof Uint8Array) {
          return value;
        }
        if (!Array.isArray(value)) {
          return null;
        }
        const text: string[] = [];
        for (const line of value) {
          if (typeof line !== "string") {
            return null;
          }
          text.push(line);
        }
        return text;
      }

      function runProgram(program: readonly string[] | Uint8Array): Promise<void> {
        if (program instanceof Uint8Array) {
          return runInstructionBinary(program);
        }
        return runInstructionLines(program);
      }

      function onRun(record: Record<string, unknown>): void {
        const program = readProgram(record["binary"] ?? record["lines"]);
        if (program === null) {
          reportFault("指令序列不完整");
          return;
        }
        void runProgram(program).catch((error: unknown): void => {
          const message = error instanceof Error ? error.message : "指令序列失败";
          reportFault(message);
        });
      }
      let powering = false;

      /** 显卡已经坐上之后才接受 Present。副本原样送回页面。 */
      function onPresent(): void {
        void presentFrame().then(
          (frame): void => {
            const pixels = frame.pixels;
            const buffer = pixels.buffer;
            if (!(buffer instanceof ArrayBuffer)) {
              reportFault("显卡帧副本无法转交");
              return;
            }
            globalThis.postMessage(
              {
                kind: MailMessage.Frame,
                frameWidth: frame.frameWidth,
                frameHeight: frame.frameHeight,
                pixels,
              },
              { transfer: [buffer] },
            );
          },
          (error: unknown): void => {
            const text = error instanceof Error ? error.message : "显卡没有交出帧";
            reportFault(text);
          },
        );
      }

      /** 把一个 64 位字按小端交给扩展口，再把返回的 8 个八位组拼回一个字。 */
      function onExchange(record: Record<string, unknown>): void {
        const index = record["index"];
        const direction = record["direction"];
        const word = record["word"];
        if (typeof index !== "number" || typeof direction !== "number" || typeof word !== "bigint") {
          globalThis.postMessage({
            kind: MailMessage.ExchangeResult,
            word: 0n,
            message: "扩展口交换不完整",
          });
          return;
        }
        const payload = new Uint8Array(8);
        let rest = word;
        for (let octet = 0; octet < 8; octet += 1) {
          payload[octet] = Number(rest & 0xffn);
          rest >>= 8n;
        }
        try {
          const result = exchangePort(index, direction, payload);
          let packed = 0n;
          for (let octet = 0; octet < result.length && octet < 8; octet += 1) {
            packed += BigInt(result[octet] ?? 0) << BigInt(octet * 8);
          }
          globalThis.postMessage({
            kind: MailMessage.ExchangeResult,
            word: packed,
            message: "",
          });
        } catch (error: unknown) {
          const text = error instanceof Error ? error.message : "扩展口交换失败";
          globalThis.postMessage({
            kind: MailMessage.ExchangeResult,
            word: 0n,
            message: text,
          });
        }
      }

      /**
       * 接收一条上电消息。
       * 上电在这条线程里等到内存坐稳。失败只回报，不让这条线程退出。
       * 等待就绪的那一段会把事件循环交出去，所以不能在收到消息的同一瞬间 Atomics.wait。
       */
      export function acceptBoardMessage(data: unknown): void {
        const record = asRecord(data);
        if (record === null) {
          return;
        }
        if (readKind(record) === MailMessage.Run) {
          onRun(record);
          return;
        }
        if (readKind(record) === MailMessage.Present) {
          onPresent();
          return;
        }
        if (readKind(record) === MailMessage.Inbox) {
          const incoming = record["words"];
          if (!Array.isArray(incoming)) {
            return;
          }
          const words: bigint[] = [];
          for (const word of incoming) {
            if (typeof word !== "bigint") {
              return;
            }
            words.push(word);
          }
          pushInbox(words);
          return;
        }
        if (readKind(record) === MailMessage.Exchange) {
          onExchange(record);
          return;
        }
        if (readKind(record) === MailMessage.Panel) {
          const width = record["width"];
          const height = record["height"];
          const hertz = record["hertz"];
          if (typeof width === "number" && typeof height === "number" && typeof hertz === "number") {
            notePanel(width, height, hertz);
          }
          return;
        }
        if (readKind(record) !== MailMessage.Power) {
          return;
        }
        if (powering) {
          return;
        }
        const logo = readProgram(record["logo"]);
        const drive = readProgram(record["drive"]);
        if (logo === null || drive === null) {
          reportFault("引导指令不完整");
          return;
        }
        powering = true;
        void powerBoard(logo).then(
          (): void => {
            powering = false;
            globalThis.postMessage({ kind: MailMessage.Checked });
            try {
              const onFault = (message: string): void => {
                reportFault(message);
                showError(message);
              };
              if (drive instanceof Uint8Array) {
                startResidentBinary(drive, onFault);
              } else {
                startResidentLines(drive, onFault);
              }
            } catch (error: unknown) {
              const message = error instanceof Error ? error.message : "指令序列失败";
              reportFault(message);
              showError(message);
            }
          },
          (error: unknown): void => {
            powering = false;
            const text = error instanceof Error ? error.message : "主板线程失败";
            reportFault(text);
            showError(text);
          },
        );
      }
    }
  }
}
