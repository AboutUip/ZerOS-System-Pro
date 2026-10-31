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

import { ZerOS as ErrorPictureRoot } from "./ErrorPicture";
import { ZerOS as FaultDeliveryRoot } from "./FaultDelivery";
import { ZerOS as FaultRecordRoot } from "../../Cpu/Structure/FaultRecord";
import { ZerOS as DebugMapRoot } from "../../Debug/Host/DebugMap";
import { ZerOS as DebugRunRoot } from "../../Debug/Host/DebugRun";
import { ZerOS as BoardRuntimeRoot } from "../Bootstrap/BoardRuntime";
import { ZerOS as CpuSeatRoot } from "../Seat/CpuSeat";
import { ZerOS as GpuSeatRoot } from "../Seat/GpuSeat";
import { ZerOS as InboxRoot } from "./Inbox";
import { ZerOS as MailboxRoot } from "./Mailbox";
import { ZerOS as PortRoot } from "../Slot/Expansion/ExpansionPort";
import { ZerOS as PointerConfigRoot } from "../../Pointer/Config/PointerConfig";
import { ZerOS as QueryRoot } from "./HardwareQuery";
import { ZerOS as BootTraceRoot } from "../../Debug/Host/BootTrace";
import { ZerOS as TracePageRoot } from "../../Diagnostics/Host/TracePage";
import { ZerOS as TraceOpRoot } from "../../Diagnostics/Enum/TraceOp";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      const MailMessage = MailboxRoot.Hardware.Motherboard.MailMessage;
      const powerBoard = BoardRuntimeRoot.Hardware.Motherboard.powerBoard;
      const presentFrame = GpuSeatRoot.Hardware.Motherboard.presentFrame;
      const runInstructionLines = CpuSeatRoot.Hardware.Motherboard.runInstructionLines;
      const runFaultPicture = CpuSeatRoot.Hardware.Motherboard.runFaultPicture;
      const runInstructionBinary = CpuSeatRoot.Hardware.Motherboard.runInstructionBinary;
      const startResidentLines = CpuSeatRoot.Hardware.Motherboard.startResidentLines;
      const startResidentBinary = CpuSeatRoot.Hardware.Motherboard.startResidentBinary;
      const requestDebugRun = CpuSeatRoot.Hardware.Motherboard.requestDebugRun;
      const seatBinary = CpuSeatRoot.Hardware.Motherboard.seatBinary;
      const pushInbox = InboxRoot.Hardware.Motherboard.pushInbox;
      const notePanel = QueryRoot.Hardware.Motherboard.notePanel;
      const exchangePort = PortRoot.Hardware.Motherboard.Slot.Exchange;
      const PointerPort = PointerConfigRoot.Hardware.Pointer.PointerConfig.OfficialPort;
      const errorPicture = ErrorPictureRoot.Hardware.Motherboard.errorPicture;
      const gpuInfo = GpuSeatRoot.Hardware.Motherboard.gpuInfo;
      const faultChannel = FaultDeliveryRoot.Hardware.Motherboard.faultChannel;
      const faultFromText = FaultRecordRoot.Hardware.Cpu.faultFromText;
      const faultFromWire = FaultRecordRoot.Hardware.Cpu.faultFromWire;
      const formatSevere = FaultRecordRoot.Hardware.Cpu.formatSevere;
      const readDebugSites = DebugMapRoot.Hardware.Debug.readDebugSites;
      const applySite = DebugMapRoot.Hardware.Debug.applySite;
      const debugRunDecision = DebugRunRoot.Hardware.Debug.debugRunDecision;
      const attachTracePage = TracePageRoot.Hardware.Diagnostics.attachTracePage;
      const detachTracePage = TracePageRoot.Hardware.Diagnostics.detachTracePage;
      const traceInstant = TracePageRoot.Hardware.Diagnostics.traceInstant;
      const traceSpanBegin = TracePageRoot.Hardware.Diagnostics.traceSpanBegin;
      const traceSpanEnd = TracePageRoot.Hardware.Diagnostics.traceSpanEnd;
      const TraceOp = TraceOpRoot.Hardware.Diagnostics.TraceOp;
      const TraceLayer = TraceOpRoot.Hardware.Diagnostics.TraceLayer;
      const TraceHostEvent = TraceOpRoot.Hardware.Diagnostics.TraceHostEvent;
      const TraceBoardKind = TraceOpRoot.Hardware.Diagnostics.TraceBoardKind;
      const TraceRejectSource = TraceOpRoot.Hardware.Diagnostics.TraceRejectSource;
      const TraceRejectReason = TraceOpRoot.Hardware.Diagnostics.TraceRejectReason;
      type DebugSiteRun = DebugMapRoot.Hardware.Debug.DebugSiteRun;
      type FaultRecord = FaultRecordRoot.Hardware.Cpu.FaultRecord;
      let errorShown = false;
      /** 各核心当前程序的源位置。0 号先是 logo，固件循环换上之后改成固件表。 */
      const siteMaps = new Map<number, readonly DebugSiteRun[]>();
      let driveSites: readonly DebugSiteRun[] = [];

      /**
       * 能画就画一帧。显卡来源或这一帧自己失败，只写控制台，不再求显卡画第二次。
       * 控制台这一行带错误码、来源、核心、指令编号和源位置。普通失败不走这里。
       */
      function showFault(record: FaultRecord): void {
        const placed = applySite(record, siteMaps);
        const channel = faultChannel(placed, errorShown);
        if (channel === "drop") {
          return;
        }
        if (channel === "console") {
          const line = formatSevere(placed);
          console.error(line);
          reportFault(line, false);
          return;
        }
        /* 只在真的去画的时候记住。显卡故障走控制台，不能因此挡住后面还能画的失败。 */
        errorShown = true;
        /* 帧宽高跟 BIOS 已经发布的那一档。写死 640 时，字会切在旧边界上，右边是空的。 */
        const gpu = gpuInfo();
        const lines = errorPicture(placed, gpu.width, gpu.height);
        void runFaultPicture(lines).then(
          (): void => {
            reportFault(placed.Text, true);
          },
          (error: unknown): void => {
            const text = error instanceof Error ? error.message : "fault picture was not drawn";
            const line = `${formatSevere(placed)} draw=${text}`;
            console.error(line);
            reportFault(line, false);
          },
        );
      }

      function showError(message: string): void {
        showFault(faultFromText(message, -1, 0, "", ""));
      }

      /**
       * 调试运行先在这条线程上拒绝非法文本和关闭的开关。
       * 核心是否停着由 CPU 再判一次。这里把 halted 传真，只是还没问到那颗核心。
       */
      function onDebugRun(record: Record<string, unknown>): void {
        const incoming = record["lines"];
        const lines: string[] = [];
        if (!Array.isArray(incoming)) {
          traceInstant(TraceOp.HostReject, TraceLayer.Host, -1, TraceRejectSource.Debug, TraceRejectReason.Shape);
          globalThis.postMessage({ kind: MailMessage.DebugResult, ok: false, message: "debug run was refused" });
          return;
        }
        for (const line of incoming) {
          if (typeof line !== "string") {
            globalThis.postMessage({ kind: MailMessage.DebugResult, ok: false, message: "debug run was refused" });
            return;
          }
          lines.push(line);
        }
        /* 只认页面放进消息的那一档。这条线程自己的模块副本不会跟着固件变。 */
        const enabled = record["enabled"] === true;
        const decision = debugRunDecision(enabled, lines, true);
        if (decision !== "") {
          globalThis.postMessage({ kind: MailMessage.DebugResult, ok: false, message: decision });
          return;
        }
        traceInstant(TraceOp.HostEvent, TraceLayer.Host, -1, TraceHostEvent.Debug, lines.length);
        requestDebugRun(lines, enabled);
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

      /** 板级生命周期消息编号；普通帧/输入/交换已有专门点，不在这里重复。 */
      function boardEventCode(kind: string): number {
        if (kind === MailMessage.Power) {
          return TraceBoardKind.Power;
        }
        if (kind === MailMessage.Fault) {
          return TraceBoardKind.Fault;
        }
        if (kind === MailMessage.Bind) {
          return TraceBoardKind.Bind;
        }
        if (kind === MailMessage.Go) {
          return TraceBoardKind.Go;
        }
        if (kind === MailMessage.Ready) {
          return TraceBoardKind.Ready;
        }
        if (kind === MailMessage.Checked) {
          return TraceBoardKind.Checked;
        }
        if (kind === MailMessage.Trace) {
          return TraceBoardKind.Trace;
        }
        if (kind === MailMessage.TracePage) {
          return TraceBoardKind.TracePage;
        }
        if (kind === MailMessage.Panel) {
          return TraceBoardKind.Panel;
        }
        if (kind === MailMessage.DebugRun) {
          return TraceBoardKind.DebugRun;
        }
        if (kind === MailMessage.DebugSwitch) {
          return TraceBoardKind.DebugSwitch;
        }
        if (kind === MailMessage.DebugResult) {
          return TraceBoardKind.DebugResult;
        }
        if (kind === MailMessage.FaultLog) {
          return TraceBoardKind.FaultLog;
        }
        if (kind === MailMessage.BootMark) {
          return TraceBoardKind.BootMark;
        }
        return 0;
      }

      /**
       * 把失败送回页面。
       * window 为假时页面只能写控制台：错误帧没有画出来，或者这一次本来就不能画。
       */
      function reportFault(text: string, window: boolean): void {
        globalThis.postMessage({
          kind: MailMessage.Fault,
          message: text,
          window,
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
          showError("instruction sequence is incomplete");
          return;
        }
        void runProgram(program).catch((error: unknown): void => {
          const message = error instanceof Error ? error.message : "instruction sequence failed";
          showError(message);
        });
      }
      let powering = false;

      /** 显卡已经坐上之后才接受 Present。副本原样送回页面。 */
      function onPresent(): void {
        const span = traceSpanBegin(TraceOp.Frame, TraceLayer.Host, -1, 0, 0, 0);
        void presentFrame().then(
          (frame): void => {
            const pixels = frame.pixels;
            const buffer = pixels.buffer;
            if (!(buffer instanceof ArrayBuffer)) {
              traceSpanEnd(TraceOp.FrameEnd, TraceLayer.Host, -1, span, 0, 0);
              showError("gpu frame could not be transferred");
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
            traceSpanEnd(TraceOp.FrameEnd, TraceLayer.Host, -1, span, 0, 0);
          },
          (error: unknown): void => {
            traceSpanEnd(TraceOp.FrameEnd, TraceLayer.Host, -1, span, 0, 0);
            const text = error instanceof Error ? error.message : "gpu did not present a frame";
            showError(text);
          },
        );
      }

      /**
       * 把一次鼠标事件的六个字写进官方鼠标口。
       * 不进键盘的入站队列，免得固件把坐标当成按键。
       * 口还没引导或某一字不合法时整段停下，设备会丢掉没写完的事件。
       */
      function deliverPointer(record: Record<string, unknown>): void {
        const incoming = record["words"];
        if (!Array.isArray(incoming) || incoming.length !== 6) {
          traceInstant(TraceOp.HostReject, TraceLayer.Host, -1, TraceRejectSource.Pointer, TraceRejectReason.Shape);
          return;
        }
        const words: bigint[] = [];
        for (const word of incoming) {
          if (typeof word !== "bigint") {
            traceInstant(TraceOp.HostReject, TraceLayer.Host, -1, TraceRejectSource.Pointer, TraceRejectReason.Invalid);
            return;
          }
          words.push(word);
        }
        traceInstant(TraceOp.HostEvent, TraceLayer.Host, -1, TraceHostEvent.Pointer, words.length);
        try {
          for (const word of words) {
            const payload = new Uint8Array(8);
            let rest = word;
            for (let octet = 0; octet < 8; octet += 1) {
              payload[octet] = Number(rest & 0xffn);
              rest >>= 8n;
            }
            /* 官方鼠标的交换当场返回。若实现改成异步，这一字还没落地，后面的字不能接着写。 */
            const result = exchangePort(PointerPort, 0, payload);
            if (result instanceof Promise) {
              void result.then(
                (): void => undefined,
                (): void => undefined,
              );
              return;
            }
          }
        } catch {
          /* 这一段没有写完。设备里未收满的字已经丢掉。 */
        }
      }

      /** 把一个 64 位字按小端交给扩展口，再把返回的 8 个八位组拼回一个字。 */
      function onExchange(record: Record<string, unknown>): void {
        const index = record["index"];
        const direction = record["direction"];
        const word = record["word"];
        if (typeof index !== "number" || typeof direction !== "number" || typeof word !== "bigint") {
          traceInstant(TraceOp.HostReject, TraceLayer.Host, -1, TraceRejectSource.Exchange, TraceRejectReason.Shape);
          globalThis.postMessage({
            kind: MailMessage.ExchangeResult,
            word: 0n,
            message: "the expansion exchange is incomplete",
          });
          return;
        }
        const payload = new Uint8Array(8);
        let rest = word;
        for (let octet = 0; octet < 8; octet += 1) {
          payload[octet] = Number(rest & 0xffn);
          rest >>= 8n;
        }
        const span = traceSpanBegin(TraceOp.Exchange, TraceLayer.Protocol, -1, 0, index, direction);
        const deliver = (packed: bigint, message: string): void => {
          traceSpanEnd(TraceOp.ExchangeReply, TraceLayer.Protocol, -1, span, index, direction);
          globalThis.postMessage({
            kind: MailMessage.ExchangeResult,
            word: packed,
            message,
          });
        };
        const packOctets = (result: Uint8Array): bigint => {
          let packed = 0n;
          for (let octet = 0; octet < result.length && octet < 8; octet += 1) {
            packed += BigInt(result[octet] ?? 0) << BigInt(octet * 8);
          }
          return packed;
        };
        try {
          const result = exchangePort(index, direction, payload);
          if (result instanceof Promise) {
            void result.then((value: Uint8Array) => {
              deliver(packOctets(value), "");
            }).catch((error: unknown) => {
              const text = error instanceof Error ? error.message : "the expansion exchange failed";
              deliver(0n, text);
            });
            return;
          }
          deliver(packOctets(result), "");
        } catch (error: unknown) {
          const text = error instanceof Error ? error.message : "the expansion exchange failed";
          deliver(0n, text);
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
        const incomingKind = readKind(record);
        if (incomingKind !== null) {
          const code = boardEventCode(incomingKind);
          if (code !== 0) {
            traceInstant(TraceOp.HostMessage, TraceLayer.Host, -1, code, 0);
          }
        }
        if (readKind(record) === MailMessage.Run) {
          onRun(record);
          return;
        }
        if (readKind(record) === MailMessage.Present) {
          onPresent();
          return;
        }
        if (readKind(record) === MailMessage.Pointer) {
          deliverPointer(record);
          return;
        }
        if (readKind(record) === MailMessage.Inbox) {
          const incoming = record["words"];
          if (!Array.isArray(incoming)) {
            traceInstant(TraceOp.HostReject, TraceLayer.Host, -1, TraceRejectSource.Inbox, TraceRejectReason.Shape);
            return;
          }
          const words: bigint[] = [];
          for (const word of incoming) {
            if (typeof word !== "bigint") {
              traceInstant(TraceOp.HostReject, TraceLayer.Host, -1, TraceRejectSource.Inbox, TraceRejectReason.Invalid);
              return;
            }
            words.push(word);
          }
          const pushed = pushInbox(words);
          if (pushed === "ok") {
            traceInstant(TraceOp.HostEvent, TraceLayer.Host, -1, TraceHostEvent.Inbox, words.length);
          } else {
            traceInstant(TraceOp.HostReject, TraceLayer.Host, -1, TraceRejectSource.Inbox, pushed === "overflow" ? TraceRejectReason.Overflow : TraceRejectReason.Invalid);
          }
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
            traceInstant(TraceOp.HostEvent, TraceLayer.Host, -1, TraceHostEvent.Panel, width);
            notePanel(width, height, hertz);
          }
          return;
        }
        if (readKind(record) === MailMessage.DebugRun) {
          onDebugRun(record);
          return;
        }
        if (readKind(record) === MailMessage.TracePage) {
          const buffer = record["buffer"];
          if (buffer instanceof SharedArrayBuffer) {
            attachTracePage(buffer);
            CpuSeatRoot.Hardware.Motherboard.attachTrace(buffer);
          } else {
            detachTracePage();
            CpuSeatRoot.Hardware.Motherboard.attachTrace(null);
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
        const loader = record["loader"];
        if (logo === null || drive === null || !(loader instanceof Uint8Array)) {
          showError("boot program is incomplete");
          return;
        }
        siteMaps.set(0, readDebugSites(record["logoSites"]));
        driveSites = readDebugSites(record["driveSites"]);
        siteMaps.set(3, readDebugSites(record["loaderSites"]));
        powering = true;
        void powerBoard(logo).then(
          async (): Promise<void> => {
            powering = false;
            globalThis.postMessage({ kind: MailMessage.Checked });
            try {
              const onFault = (data: Record<string, unknown>): void => {
                showFault(faultFromWire(data));
              };
              /* 核心 3 与 Load.obr 的 -slot、固件的 schedule(3) 是同一个编号。先装上，等固件自己启动。 */
              await seatBinary(3, loader);
              BootTraceRoot.Hardware.Debug.markBoot("loader");
              /* 引导画面已经结束。0 号核心接下来跑的是固件循环，源位置改对这份程序。 */
              siteMaps.set(0, driveSites);
              BootTraceRoot.Hardware.Debug.markBoot("bios");
              if (drive instanceof Uint8Array) {
                startResidentBinary(drive, onFault);
              } else {
                startResidentLines(drive, onFault);
              }
            } catch (error: unknown) {
              const message = error instanceof Error ? error.message : "instruction sequence failed";
              showError(message);
            }
          },
          (error: unknown): void => {
            powering = false;
            const text = error instanceof Error ? error.message : "board thread failed";
            showError(text);
          },
        );
      }
    }
  }
}
