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
import { ZerOS as PageCoreStopRoot } from "../../Cpu/Host/PageCoreStop";
import { ZerOS as QueuedWorkerRoot } from "../Host/QueuedWorker";
import { ZerOS as DebugLogRoot } from "../../Debug/Host/DebugLog";
import { ZerOS as DebugRunRoot } from "../../Debug/Host/DebugRun";
import { ZerOS as FlagRoot } from "../../Debug/Config/DebugFlag";
import { ZerOS as FaultRecordRoot } from "../../Cpu/Structure/FaultRecord";
import { ZerOS as SevereRoot } from "../../Debug/Host/SevereConsole";
import { ZerOS as BootTraceRoot } from "../../Debug/Host/BootTrace";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      const MailMessage = MailboxRoot.Hardware.Motherboard.MailMessage;
      const noteCoreStop = PageCoreStopRoot.Hardware.Cpu.noteCoreStop;
      const rememberFault = DebugLogRoot.Hardware.Debug.rememberFault;
      const readFaults = DebugLogRoot.Hardware.Debug.readFaults;
      const lastFault = DebugLogRoot.Hardware.Debug.lastFault;
      const faultFromWire = FaultRecordRoot.Hardware.Cpu.faultFromWire;
      const debugRunDecision = DebugRunRoot.Hardware.Debug.debugRunDecision;
      const debugEnabled = FlagRoot.Hardware.Debug.debugEnabled;
      const reportSevere = SevereRoot.Hardware.Debug.reportSevere;
      const acceptBootMark = BootTraceRoot.Hardware.Debug.acceptBootMark;
      type FaultRecord = FaultRecordRoot.Hardware.Cpu.FaultRecord;

      /** 主板线程。第一次上电时创建。 */
      let boardWorker: Worker | null = null;

      /** 页面已经把一次上电交出去。失败回报会把它清掉，以便再次通电。 */
      let powerAccepted = false;

      /** 主板、内存、CPU 和显卡都自检通过后，页面用来启动显示器自检。 */
      let checkedListener: (() => void) | null = null;

      /**
       * 显卡 Present 到达页面时调用。主板不在这里解释像素。
       * 像素和位图最多有一个。位图是稳态画面，像素是启动画面和页面主动要的那一帧。
       */
      let frameListener: ((
        frameWidth: number,
        frameHeight: number,
        pixels: Uint32Array | null,
        bitmap: ImageBitmap | null,
        originX?: number,
        originY?: number,
        scroll?: readonly number[],
      ) => void) | null = null;

      /** 显卡换成新的帧尺寸时调用。页面再把同一组宽高交给显示器。 */
      let panelListener: ((width: number, height: number) => void) | null = null;

      /** 固件写下调试开关时调用。页面挂上或摘掉入口，并把这一位写入 /boot/debug。 */
      let debugSwitchListener: ((on: boolean) => void) | null = null;

      /** 一次扩展口交换的成功回调。同时只允许一路，避免两段结果对错号。 */
      let exchangeWait: ((word: bigint) => void) | null = null;

      /** 同一次交换失败时调用。 */
      let exchangeFail: ((error: Error) => void) | null = null;

      /** 引导开始时画出 logo 的指令。 */
      let logoLines: readonly string[] | Uint8Array | null = null;

      /** 收尾之后交给 CPU 的指令。用来把入站整数转给扩展口，并在 F12 时进入设置画面。 */
      let driveLines: readonly string[] | Uint8Array | null = null;
      /** 核心 3 的装入程序。上电时只装入，不启动。 */
      let loaderLines: Uint8Array | null = null;
      /** 三份程序的源位置。没有对照表时是空数组，失败帧上的源位置就是 `-`。 */
      let logoSites: readonly (readonly [number, number, string, number, string])[] = [];
      let driveSites: readonly (readonly [number, number, string, number, string])[] = [];
      let loaderSites: readonly (readonly [number, number, string, number, string])[] = [];
      /** 一次调试运行的结果。同时只允许一路。 */
      let debugWait: ((text: string) => void) | null = null;

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
        if (kind === MailMessage.BootMark) {
          const name = record["name"];
          const at = record["at"];
          /* 主板线程打的点送到这里才进表。页面自己打的点不走这条消息。 */
          if (typeof name === "string" && typeof at === "number") {
            acceptBootMark(name, at);
          }
          return;
        }
        if (kind === MailMessage.CoreStop) {
          const ordinal = record["ordinal"];
          const reason = record["reason"];
          const index = record["index"];
          const op = record["op"];
          const detail = record["detail"];
          /* 只留在页面上。不写客程序能读的内存，也不交给引导画面。 */
          if (typeof ordinal === "number" && typeof reason === "number" && typeof index === "number" && typeof op === "string" && typeof detail === "string") {
            noteCoreStop({
              Core: ordinal,
              Reason: reason,
              Index: index,
              Op: op,
              Detail: detail,
            });
          }
          return;
        }
        if (kind === MailMessage.PanelSize) {
          const width = record["width"];
          const height = record["height"];
          if (typeof width === "number" && typeof height === "number") {
            panelListener?.(width, height);
          }
          return;
        }
        if (kind === MailMessage.DebugSwitch) {
          const on = record["on"];
          if (typeof on === "boolean") {
            debugSwitchListener?.(on);
          }
          return;
        }
        if (kind === MailMessage.Frame) {
          const frameWidth = record["frameWidth"];
          const frameHeight = record["frameHeight"];
          const pixels = record["pixels"];
          const bitmap = record["bitmap"];
          const originX = record["originX"];
          const originY = record["originY"];
          const scroll = record["scroll"];
          const listener = frameListener;
          if (typeof frameWidth !== "number" || typeof frameHeight !== "number" || listener === null) {
            if (bitmap instanceof ImageBitmap) {
              bitmap.close();
            }
            return;
          }
          if (bitmap instanceof ImageBitmap) {
            listener(
              frameWidth,
              frameHeight,
              null,
              bitmap,
              typeof originX === "number" ? originX : 0,
              typeof originY === "number" ? originY : 0,
              Array.isArray(scroll) ? scroll.filter((item): item is number => typeof item === "number") : [],
            );
            return;
          }
          if (pixels instanceof Uint32Array) {
            listener(frameWidth, frameHeight, pixels, null);
          }
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
        if (kind === MailMessage.FaultLog && typeof message === "string") {
          rememberFault(faultFromWire(record));
          return;
        }
        if (kind === MailMessage.DebugResult && typeof message === "string") {
          const wait = debugWait;
          debugWait = null;
          wait?.(message);
          return;
        }
        if (kind !== MailMessage.Fault || typeof message !== "string") {
          return;
        }
        rememberFault(faultFromWire(record));
        powerAccepted = false;
        if (record["window"] === false) {
          reportSevere(message);
        }
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
          if (logoLines === null || driveLines === null || loaderLines === null) {
            return;
          }
          powerAccepted = true;
          ensureBoard().postMessage({
            kind: MailMessage.Power,
            logo: logoLines,
            drive: driveLines,
            loader: loaderLines,
            logoSites,
            driveSites,
            loaderSites,
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

        /**
         * 把一次鼠标事件的六个字交给主板线程。
         * 主板写进鼠标扩展口，不放进键盘用的入站队列。
         */
        PublishPointer(words: readonly bigint[]): void {
          ensureBoard().postMessage({
            kind: MailMessage.Pointer,
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

        /** 登记帧的接收者。显示器模块不由主板导入。像素和位图最多有一个。 */
        WhenFrame(listener: (
          frameWidth: number,
          frameHeight: number,
          pixels: Uint32Array | null,
          bitmap: ImageBitmap | null,
          originX?: number,
          originY?: number,
          scroll?: readonly number[],
        ) => void): void {
          frameListener = listener;
        },

        /** 登记帧尺寸变化。必须在 Power 之前调用，免得第一次换尺寸没人接。 */
        WhenPanel(listener: (width: number, height: number) => void): void {
          panelListener = listener;
        },

        /** 登记固件调试开关。必须在 Power 之前调用，免得启动时写下的那一档没人接。 */
        WhenDebugSwitch(listener: (on: boolean) => void): void {
          debugSwitchListener = listener;
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
         * 登记核心 3 的装入程序。必须在 Power 之前调用。
         * 只接受二进制。上电把它装进已停止的核心 3，固件稍后自己调度。
         */
        SetLoader(binary: Uint8Array): void {
          loaderLines = binary;
        },

        /**
         * 登记三份引导程序的源位置。必须在 Power 之前调用。
         * 对照表只用于失败帧上的文件名和行号，不参与执行。
         */
        SetDebugSites(
          logo: readonly (readonly [number, number, string, number, string])[],
          drive: readonly (readonly [number, number, string, number, string])[],
          loader: readonly (readonly [number, number, string, number, string])[],
        ): void {
          logoSites = logo;
          driveSites = drive;
          loaderSites = loader;
        },

        /** 最近的失败记录。调试入口打开时由它读出。平时页面自己不展示。 */
        Faults(): readonly FaultRecord[] {
          return readFaults();
        },

        /** 最近一条失败。还没有时是 null。 */
        LastFault(): FaultRecord | null {
          return lastFault();
        },

        /**
         * 在已经停止的 0 号核心上跑一段短 ZAP。
         * 开关关闭、文本不合法时立刻拒绝，不把消息送进机器。
         */
        DebugRun(lines: readonly string[]): Promise<string> {
          const on = debugEnabled();
          const decision = debugRunDecision(on, lines, true);
          if (decision !== "") {
            return Promise.resolve(decision);
          }
          return new Promise((resolve): void => {
            if (debugWait !== null) {
              resolve("debug run was refused");
              return;
            }
            debugWait = resolve;
            ensureBoard().postMessage({
              kind: MailMessage.DebugRun,
              lines,
              enabled: on,
            });
          });
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
