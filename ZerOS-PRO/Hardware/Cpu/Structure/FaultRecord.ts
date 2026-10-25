/**
 * @module ZerOS.Hardware.Cpu.FaultRecord
 * @description 一次指令失败留下的七个字段
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 把一句宿主失败收成 ZCP1 §4.11 的记录：错误码、来源、说明、核心、指令编号、操作名、源位置。
 * 只做形状和归类。不画面板，也不决定监督核要不要停。
 * Window 和 Stack 是坐座宿主自己的，不是协议字段。Window 为假时禁止把这一帧送上显卡。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 记录
 *   3. 归类
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as CodeRoot } from "../Enum/FaultCode";
import { ZerOS as SourceRoot } from "../Enum/FaultSource";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      const FaultCodeLast = CodeRoot.Hardware.Cpu.FaultCodeLast;
      const FaultSourceGpu = SourceRoot.Hardware.Cpu.FaultSourceGpu;
      const FaultSourceLast = SourceRoot.Hardware.Cpu.FaultSourceLast;
      const FaultCodeUnspecified = CodeRoot.Hardware.Cpu.FaultCodeUnspecified;
      const FaultCodeJump = CodeRoot.Hardware.Cpu.FaultCodeJump;
      const FaultCodeRegister = CodeRoot.Hardware.Cpu.FaultCodeRegister;
      const FaultCodeNotRunning = CodeRoot.Hardware.Cpu.FaultCodeNotRunning;
      const FaultCodeBusy = CodeRoot.Hardware.Cpu.FaultCodeBusy;
      const FaultCodeHertz = CodeRoot.Hardware.Cpu.FaultCodeHertz;
      const FaultCodeOpcode = CodeRoot.Hardware.Cpu.FaultCodeOpcode;
      const FaultCodeMetric = CodeRoot.Hardware.Cpu.FaultCodeMetric;
      const FaultCodeExchange = CodeRoot.Hardware.Cpu.FaultCodeExchange;
      const FaultCodeQuery = CodeRoot.Hardware.Cpu.FaultCodeQuery;
      const FaultCodeGpu = CodeRoot.Hardware.Cpu.FaultCodeGpu;
      const FaultCodeMemory = CodeRoot.Hardware.Cpu.FaultCodeMemory;
      const FaultCodeInstall = CodeRoot.Hardware.Cpu.FaultCodeInstall;
      const FaultCodeBound = CodeRoot.Hardware.Cpu.FaultCodeBound;
      const FaultCodeSchedule = CodeRoot.Hardware.Cpu.FaultCodeSchedule;
      const FaultCodePass = CodeRoot.Hardware.Cpu.FaultCodePass;
      const FaultCodeSyscall = CodeRoot.Hardware.Cpu.FaultCodeSyscall;
      const FaultCodeGate = CodeRoot.Hardware.Cpu.FaultCodeGate;
      const FaultCodeRelease = CodeRoot.Hardware.Cpu.FaultCodeRelease;
      const FaultCodeSlice = CodeRoot.Hardware.Cpu.FaultCodeSlice;
      const FaultCodeDwell = CodeRoot.Hardware.Cpu.FaultCodeDwell;
      const FaultCodeMap = CodeRoot.Hardware.Cpu.FaultCodeMap;
      const FaultCodeContext = CodeRoot.Hardware.Cpu.FaultCodeContext;
      const FaultCodeAttach = CodeRoot.Hardware.Cpu.FaultCodeAttach;
      const FaultCodePrivilege = CodeRoot.Hardware.Cpu.FaultCodePrivilege;
      const FaultSourceBoard = SourceRoot.Hardware.Cpu.FaultSourceBoard;
      const FaultSourceCpu = SourceRoot.Hardware.Cpu.FaultSourceCpu;
      const FaultSourceMemory = SourceRoot.Hardware.Cpu.FaultSourceMemory;
      const FaultSourceDisplay = SourceRoot.Hardware.Cpu.FaultSourceDisplay;
      const FaultSourceExpansion = SourceRoot.Hardware.Cpu.FaultSourceExpansion;
      const FaultSourceKeyboard = SourceRoot.Hardware.Cpu.FaultSourceKeyboard;

      /* ------------------------------------------------------------------ */
      /* 2. 记录                                                             */
      /* ------------------------------------------------------------------ */

      /**
       * 一次失败。
       * Code、Source、Text、Core、Index、Op、Site 是协议字段。
       * Stack 是宿主调用栈里已经收成 ASCII 的几帧，至多 8 帧。没有就是空数组。
       * Window 为假表示这一次不能再交给显卡画。显卡来源一定为假。
       */
      export interface FaultRecord {
        readonly Code: number;
        readonly Source: number;
        readonly Text: string;
        readonly Core: number;
        readonly Index: number;
        readonly Op: string;
        readonly Site: string;
        readonly Stack: readonly string[];
        readonly Window: boolean;
      }

      interface Ruled {
        readonly code: number;
        readonly source: number;
      }

      /**
       * 先匹配更长、更具体的句子，避免「schedule 里提到 syscall」被收成系统调用失败。
       * 短语都是宿主已经抛出的英文或模块前缀，不在这里发明新的失败种类。
       */
      const rules: readonly RuledPhrase[] = [
        { phrase: "privileged instruction", code: FaultCodePrivilege, source: FaultSourceCpu },
        { phrase: "jump target is outside", code: FaultCodeJump, source: FaultSourceCpu },
        { phrase: "register integer is out of range", code: FaultCodeRegister, source: FaultSourceCpu },
        { phrase: "register is outside", code: FaultCodeRegister, source: FaultSourceCpu },
        { phrase: "indirect address register", code: FaultCodeRegister, source: FaultSourceCpu },
        { phrase: "core is not running", code: FaultCodeNotRunning, source: FaultSourceCpu },
        { phrase: "core still has a command in flight", code: FaultCodeBusy, source: FaultSourceCpu },
        { phrase: "already running another program", code: FaultCodeBusy, source: FaultSourceCpu },
        { phrase: "the previous command is still in flight", code: FaultCodeBusy, source: FaultSourceCpu },
        { phrase: "Hz is outside", code: FaultCodeHertz, source: FaultSourceCpu },
        { phrase: "only accepts a read opcode", code: FaultCodeOpcode, source: FaultSourceCpu },
        { phrase: "only accepts a write opcode", code: FaultCodeOpcode, source: FaultSourceCpu },
        { phrase: "unknown core metric", code: FaultCodeMetric, source: FaultSourceCpu },
        { phrase: "schedule ", code: FaultCodeSchedule, source: FaultSourceCpu },
        { phrase: "install ", code: FaultCodeInstall, source: FaultSourceCpu },
        { phrase: "release ", code: FaultCodeRelease, source: FaultSourceCpu },
        { phrase: "attach ", code: FaultCodeAttach, source: FaultSourceCpu },
        { phrase: "capture ", code: FaultCodeContext, source: FaultSourceCpu },
        { phrase: "restore ", code: FaultCodeContext, source: FaultSourceCpu },
        { phrase: "gate already", code: FaultCodeGate, source: FaultSourceCpu },
        { phrase: "syscall ", code: FaultCodeSyscall, source: FaultSourceCpu },
        { phrase: "slice is out of range", code: FaultCodeSlice, source: FaultSourceCpu },
        { phrase: "dwell is outside", code: FaultCodeDwell, source: FaultSourceCpu },
        { phrase: "map request was rejected", code: FaultCodeMap, source: FaultSourceCpu },
        { phrase: "pass target", code: FaultCodePass, source: FaultSourceCpu },
        { phrase: "latch is already full", code: FaultCodePass, source: FaultSourceCpu },
        { phrase: "bound ", code: FaultCodeBound, source: FaultSourceCpu },
        { phrase: "exchange", code: FaultCodeExchange, source: FaultSourceExpansion },
        { phrase: "Exchange", code: FaultCodeExchange, source: FaultSourceExpansion },
        { phrase: "unknown CPU field", code: FaultCodeQuery, source: FaultSourceCpu },
        { phrase: "query ", code: FaultCodeQuery, source: FaultSourceCpu },
        { phrase: "显卡", code: FaultCodeGpu, source: FaultSourceGpu },
        { phrase: "gpu", code: FaultCodeGpu, source: FaultSourceGpu },
        { phrase: "Gpu", code: FaultCodeGpu, source: FaultSourceGpu },
        { phrase: "GPU", code: FaultCodeGpu, source: FaultSourceGpu },
        { phrase: "内存", code: FaultCodeMemory, source: FaultSourceMemory },
        { phrase: "memory", code: FaultCodeMemory, source: FaultSourceMemory },
        { phrase: "Memory", code: FaultCodeMemory, source: FaultSourceMemory },
        { phrase: "fill ", code: FaultCodeUnspecified, source: FaultSourceExpansion },
        { phrase: "carry ", code: FaultCodeUnspecified, source: FaultSourceExpansion },
        { phrase: "divisor is 0", code: FaultCodeUnspecified, source: FaultSourceCpu },
      ];

      interface RuledPhrase extends Ruled {
        readonly phrase: string;
      }

      /**
       * 面板只能画 ASCII。内存通道那两句中文换成英文原因，模块前缀仍留着。
       * 其它写不出来的字仍换成问号，停机帧不会整句消失。
       */
      function panelText(message: string): string {
        const readable = ascii(message, 240, "unspecified fault");
        if (!readable.includes("?")) {
          return readable;
        }
        let reason = "";
        if (message.includes("对齐")) {
          reason = "an access wider than one bit was not aligned to an octet";
        } else if (message.includes("字宽")) {
          reason = "the channel width was not 1, 8, 16, 32, or 64";
        }
        if (reason.length < 1) {
          return readable;
        }
        const marked = /^\[ZerOS\.[A-Za-z0-9.]+\]/.exec(message);
        const head = marked?.[0] ?? "";
        const joined = head.length > 0 ? `${head} ${reason}` : reason;
        return ascii(joined, 240, "unspecified fault");
      }

      /** 只留下面板和协议允许的字符。超长裁掉。空了就用调用方给的替身。 */
      function ascii(text: string, limit: number, empty: string): string {
        let out = "";
        for (let index = 0; index < text.length && out.length < limit; index += 1) {
          const code = text.charCodeAt(index);
          if (code >= 0x20 && code <= 0x7e) {
            out += text.charAt(index);
          } else if (code !== 0x0a && code !== 0x0d && code !== 0x09) {
            out += "?";
          }
        }
        if (out.length < 1) {
          return empty;
        }
        return out;
      }

      /** 宿主栈按行切开。空行和收不出 ASCII 的行丢掉，最多留 8 帧。 */
      function stackFrames(stack: string): readonly string[] {
        const frames: string[] = [];
        const lines = stack.split("\n");
        for (const line of lines) {
          if (frames.length >= 8) {
            break;
          }
          const trimmed = line.trim();
          if (trimmed.length < 1) {
            continue;
          }
          const frame = ascii(trimmed, 160, "");
          if (frame.length > 0 && frame !== "?") {
            frames.push(frame);
          }
        }
        return frames;
      }

      function clampCode(code: number): number {
        if (!Number.isInteger(code) || code < 0 || code > FaultCodeLast) {
          return FaultCodeUnspecified;
        }
        return code;
      }

      function clampSource(source: number): number {
        if (!Number.isInteger(source) || source < 0 || source > FaultSourceLast) {
          return FaultSourceBoard;
        }
        return source;
      }

      function clampCore(core: number): number {
        if (!Number.isInteger(core) || core < -1 || core > 255) {
          return -1;
        }
        return core;
      }

      function clampIndex(index: number): number {
        if (!Number.isInteger(index) || index < 0 || index > 4294967295) {
          return 0;
        }
        return index;
      }

      /** 模块前缀优先于句子里偶然出现的硬件单词。没有前缀时返回 -1，交给短语规则。 */
      function sourceFromPrefix(message: string): number {
        const marked = /\[ZerOS\.(?:Hardware|Boot)\.([A-Za-z]+)/.exec(message);
        const head = marked?.[1] ?? "";
        if (head === "Keyboard") {
          return FaultSourceKeyboard;
        }
        if (head === "Display") {
          return FaultSourceDisplay;
        }
        if (head === "Gpu") {
          return FaultSourceGpu;
        }
        if (head === "Memory") {
          return FaultSourceMemory;
        }
        if (head === "Cpu") {
          return FaultSourceCpu;
        }
        if (head === "Pointer" || head === "Expansion") {
          return FaultSourceExpansion;
        }
        if (head.length > 0) {
          return FaultSourceBoard;
        }
        return -1;
      }

      function ruleOf(message: string): Ruled | null {
        for (const rule of rules) {
          if (message.includes(rule.phrase)) {
            return rule;
          }
        }
        return null;
      }

      function windowOf(source: number, message: string): boolean {
        if (source === FaultSourceGpu) {
          return false;
        }
        if (message.includes("was not drawn")) {
          return false;
        }
        return true;
      }

      /**
       * 由一句失败和调用方已知的核心、编号、操作名组成记录。
       * 源位置先写成 `-`。坐座有对照表时再补上文件名和行号。
       */
      export function faultFromText(
        message: string,
        core: number,
        index: number,
        op: string,
        stack: string,
      ): FaultRecord {
        const ruled = ruleOf(message);
        const prefixed = sourceFromPrefix(message);
        const code = ruled?.code ?? FaultCodeUnspecified;
        let source = FaultSourceBoard;
        if (ruled !== null) {
          source = ruled.source;
        } else if (prefixed >= 0) {
          source = prefixed;
        }
        const safeSource = clampSource(source);
        return {
          Code: clampCode(code),
          Source: safeSource,
          Text: panelText(message),
          Core: clampCore(core),
          Index: clampIndex(index),
          Op: ascii(op, 32, ""),
          Site: "-",
          Stack: stackFrames(stack),
          Window: windowOf(safeSource, message),
        };
      }

      function readStack(value: unknown): readonly string[] {
        if (!Array.isArray(value)) {
          return [];
        }
        const frames: string[] = [];
        for (const item of value) {
          if (frames.length >= 8 || typeof item !== "string") {
            continue;
          }
          const frame = ascii(item, 160, "");
          if (frame.length > 0) {
            frames.push(frame);
          }
        }
        return frames;
      }

      /**
       * 从线程消息还原记录。
       * 已经带了错误码就保持调用方的归类，只收紧值域。没有错误码时按原句再归一次。
       */
      export function faultFromWire(data: Record<string, unknown>): FaultRecord {
        const message = typeof data["message"] === "string" ? data["message"] : "";
        const core = typeof data["core"] === "number" ? data["core"] : -1;
        const index = typeof data["index"] === "number" ? data["index"] : 0;
        const op = typeof data["op"] === "string" ? data["op"] : "";
        const stackText = typeof data["stackText"] === "string" ? data["stackText"] : "";
        if (typeof data["code"] !== "number") {
          const hinted = faultFromText(message, core, index, op, stackText);
          const listed = readStack(data["stack"]);
          if (listed.length < 1) {
            return hinted;
          }
          return { ...hinted, Stack: listed };
        }
        const source = clampSource(typeof data["source"] === "number" ? data["source"] : FaultSourceBoard);
        const site = typeof data["site"] === "string" ? ascii(data["site"], 80, "-") : "-";
        const windowBit = typeof data["window"] === "boolean" ? data["window"] : source !== FaultSourceGpu;
        return {
          Code: clampCode(data["code"]),
          Source: source,
          Text: panelText(message),
          Core: clampCore(core),
          Index: clampIndex(index),
          Op: ascii(op, 32, ""),
          Site: site,
          Stack: readStack(data["stack"]),
          Window: windowBit && source !== FaultSourceGpu,
        };
      }

      /**
       * 显卡画不出来时写给控制台的一行。
       * 七个字段都在这一行里。超长只裁这一行，不改记录本身。
       */
      export function formatSevere(record: FaultRecord): string {
        const stack = record.Stack.length > 0 ? ` stack=${record.Stack.join(" | ")}` : "";
        const line = `ERROR code=${String(record.Code)} source=${String(record.Source)} core=${String(record.Core)} at=${String(record.Index)} op=${record.Op} site=${record.Site} text=${record.Text}${stack}`;
        if (line.length > 1000) {
          return line.slice(0, 1000);
        }
        return line;
      }
    }
  }
}
