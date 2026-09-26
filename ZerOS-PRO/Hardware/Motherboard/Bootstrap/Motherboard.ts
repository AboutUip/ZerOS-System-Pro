/**
 * @module ZerOS.Hardware.Motherboard.Motherboard
 * @description 主板在页面上的入口
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 页面只负责把主板线程拉起来并交给它上电。
 * 不导入内存实现，不等待内存测试。显示器因此不会被测试堵住。
 * 坐座、通道和协议名单都在主板线程里。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. Motherboard.Power
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as MailboxRoot } from "../Host/Mailbox";
import { ZerOS as QueuedWorkerRoot } from "../Host/QueuedWorker";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      const MailMessage = MailboxRoot.Hardware.Motherboard.MailMessage;

      /** 主板线程。第一次上电时创建。 */
      let boardWorker: Worker | null = null;

      /** 页面已经把一次上电交出去。失败回报会把它清掉，以便再次通电。 */
      let powerAccepted = false;

      /** 主板、内存、CPU 和显卡都自检通过后，页面用来启动显示器自检。 */
      let checkedListener: (() => void) | null = null;

      /** 显卡 Present 副本到达页面时调用。主板不在这里解释像素。 */
      let frameListener: ((frameWidth: number, frameHeight: number, pixels: Uint32Array) => void) | null = null;

      /** 一次扩展口交换的成功回调。同时只允许一路，避免两段结果对错号。 */
      let exchangeWait: ((word: bigint) => void) | null = null;

      /** 同一次交换失败时调用。 */
      let exchangeFail: ((error: Error) => void) | null = null;

      /** 引导开始时画出 logo 的指令。 */
      let logoLines: readonly string[] | Uint8Array | null = null;

      /** 收尾之后交给 CPU 的指令。用来把入站整数转给扩展口，并在 F12 时进入设置画面。 */
      let driveLines: readonly string[] | Uint8Array | null = null;

      function messageData(event: MessageEvent): unknown {
        return event.data as unknown;
      }

      function asRecord(data: unknown): Record<string, unknown> | null {
        if (typeof data !== "object" || data === null || Array.isArray(data)) {
          return null;
        }
        return data as Record<string, unknown>;
      }

      /** 主板线程报回来的失败。页面不把它变成同步异常，因为 Power 已经返回。 */
      function onBoardMessage(event: MessageEvent): void {
        const record = asRecord(messageData(event));
        if (record === null) {
          return;
        }
        const kind = record["kind"];
        const message = record["message"];
        if (kind === MailMessage.Trace) {
          return;
        }
        if (kind === MailMessage.Frame) {
          const frameWidth = record["frameWidth"];
          const frameHeight = record["frameHeight"];
          const pixels = record["pixels"];
          const listener = frameListener;
          if (
            listener === null
            || typeof frameWidth !== "number"
            || typeof frameHeight !== "number"
            || !(pixels instanceof Uint32Array)
          ) {
            return;
          }
          listener(frameWidth, frameHeight, pixels);
          return;
        }
        if (kind === MailMessage.ExchangeResult) {
          const word = record["word"];
          const failure = record["message"];
          const resolve = exchangeWait;
          const reject = exchangeFail;
          exchangeWait = null;
          exchangeFail = null;
          if (typeof failure === "string" && failure.length > 0) {
            reject?.(new Error(failure));
            return;
          }
          if (typeof word === "bigint") {
            resolve?.(word);
          }
          return;
        }
        if (kind === MailMessage.Checked) {
          const listener = checkedListener;
          checkedListener = null;
          listener?.();
          return;
        }
        if (kind !== MailMessage.Fault || typeof message !== "string") {
          return;
        }
        powerAccepted = false;
      }

      function ensureBoard(): Worker {
        if (boardWorker === null) {
          boardWorker = QueuedWorkerRoot.Hardware.Motherboard.openBoardWorker();
          boardWorker.onerror = (): void => {
            powerAccepted = false;
          };
          boardWorker.onmessage = (event: MessageEvent): void => {
            onBoardMessage(event);
          };
        }
        return boardWorker;
      }

      /**
       * 这块主板。
       * 页面上的 `Power` 只启动主板线程。Boot 只调用它。
       */
      export const Motherboard = {
        /**
         * 给主板通电。
         * 调用立即返回。内存测试在内存线程里继续。已经交出去的一次上电不会重复提交。
         */
        Power(): void {
          if (powerAccepted) {
            return;
          }
          if (logoLines === null || driveLines === null) {
            return;
          }
          powerAccepted = true;
          ensureBoard().postMessage({
            kind: MailMessage.Power,
            logo: logoLines,
            drive: driveLines,
          });
        },

        /**
         * 把一段整数交给主板线程的入站队列。
         * 主板不解释这些数。放不下时由主板整段丢掉。
         */
        Publish(words: readonly bigint[]): void {
          ensureBoard().postMessage({
            kind: MailMessage.Inbox,
            words,
          });
        },

        /** 报上当前面板的宽、高和刷新率。主板只记下这三个整数。 */
        PublishPanel(width: number, height: number, hertz: number): void {
          ensureBoard().postMessage({
            kind: MailMessage.Panel,
            width,
            height,
            hertz,
          });
        },

        /**
         * 主板线程完成自身、内存和 CPU 的自检后调用。
         * 必须在 Power 之前登记。显示器不由主板导入。
         */
        WhenChecked(listener: () => void): void {
          checkedListener = listener;
        },

        /**
         * 向主板要显卡的 Present 副本。
         * 必须在面板自检之后调用。副本由 WhenFrame 接收。
         */
        Present(): void {
          ensureBoard().postMessage({ kind: MailMessage.Present });
        },

        /** 登记帧副本的接收者。显示器模块不由主板导入。 */
        WhenFrame(listener: (frameWidth: number, frameHeight: number, pixels: Uint32Array) => void): void {
          frameListener = listener;
        },

        /**
         * 登记引导开始时的程序。必须在 Power 之前调用。
         * 字符串数组是 ZAP。Uint8Array 是无扩展名二进制，CPU 不再解析助记符。
         */
        SetLogo(lines: readonly string[] | Uint8Array): void {
          logoLines = lines;
        },

        /**
         * 登记收尾之后继续执行的程序。必须在 Power 之前调用。
         * 两种形态和 SetLogo 相同。
         */
        SetDrive(lines: readonly string[] | Uint8Array): void {
          driveLines = lines;
        },

        /**
         * 向已经引导的扩展口交换一个 64 位字。
         * 页面不解释字节。沙盒测试用它把程序文本送进去，并读回状态和寄存器。
         */
        Exchange(index: number, direction: number, word: bigint): Promise<bigint> {
          return new Promise((resolve, reject) => {
            if (exchangeWait !== null) {
              reject(new Error("[ZerOS.Hardware.Motherboard.Motherboard] 上一次扩展口交换还没回来"));
              return;
            }
            exchangeWait = resolve;
            exchangeFail = reject;
            ensureBoard().postMessage({
              kind: MailMessage.Exchange,
              index,
              direction,
              word,
            });
          });
        },
      };
    }
  }
}
