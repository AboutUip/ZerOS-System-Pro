/**
 * @module ZerOS.Hardware.Sandbox.SandboxRuntime
 * @description 沙盒里的程序文本与一次执行结果
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 按 ZSP1 收下文本、启动一次客程序、记下通过或失败。
 * 程序本身的异常只改状态。这一层不抛出那些异常。
 * 协议违规（方向、命令、超长追加）仍然抛出，那是交换本身不合法。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 状态
 *   3. 交换
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as AssembleRoot } from "../../../Boot/Assemble";
import { ZerOS as ConfigRoot } from "../Config/SandboxConfig";
import { ZerOS as StatusRoot } from "../Enum/SandboxStatus";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Sandbox {
      const WordOctets = ConfigRoot.Hardware.Sandbox.SandboxConfig.WordOctets;
      const TextMax = ConfigRoot.Hardware.Sandbox.SandboxConfig.TextMax;
      const FaultMax = ConfigRoot.Hardware.Sandbox.SandboxConfig.FaultMax;
      const CommandReset = ConfigRoot.Hardware.Sandbox.SandboxConfig.CommandReset;
      const CommandAppend = ConfigRoot.Hardware.Sandbox.SandboxConfig.CommandAppend;
      const CommandRun = ConfigRoot.Hardware.Sandbox.SandboxConfig.CommandRun;
      const QueryStatus = ConfigRoot.Hardware.Sandbox.SandboxConfig.QueryStatus;
      const QueryTextLength = ConfigRoot.Hardware.Sandbox.SandboxConfig.QueryTextLength;
      const QueryFaultLength = ConfigRoot.Hardware.Sandbox.SandboxConfig.QueryFaultLength;
      const QueryFault = ConfigRoot.Hardware.Sandbox.SandboxConfig.QueryFault;
      const QueryRegister = ConfigRoot.Hardware.Sandbox.SandboxConfig.QueryRegister;
      const SandboxStatusEmpty = StatusRoot.Hardware.Sandbox.SandboxStatusEmpty;
      const SandboxStatusArmed = StatusRoot.Hardware.Sandbox.SandboxStatusArmed;
      const SandboxStatusRunning = StatusRoot.Hardware.Sandbox.SandboxStatusRunning;
      const SandboxStatusPassed = StatusRoot.Hardware.Sandbox.SandboxStatusPassed;
      const SandboxStatusFailed = StatusRoot.Hardware.Sandbox.SandboxStatusFailed;
      const assemble = AssembleRoot.Boot.assemble;
      const GuestCore = ConfigRoot.Hardware.Sandbox.SandboxConfig.GuestCore;
      const CoreSlotBits = ConfigRoot.Hardware.Sandbox.SandboxConfig.CoreSlotBits;
      const DataFloor = ConfigRoot.Hardware.Sandbox.SandboxConfig.DataFloor;
      const runtimePrefix = "[ZerOS.Hardware.Sandbox.SandboxRuntime]";

      let status = SandboxStatusEmpty;
      let text = "";
      let fault = "";
      let ticket = 0;
      let launch: { readonly lines: readonly string[]; readonly ticket: number } | null = null;
      const registers = new Array<bigint>(8).fill(0n);

      function fail(message: string): never {
        throw new Error(`${runtimePrefix} ${message}`);
      }

      function decodeWord(payload: Uint8Array): bigint {
        if (payload.length !== WordOctets) {
          fail("沙盒交换的载荷不是 8 个八位组");
        }
        let word = 0n;
        for (let index = 0; index < WordOctets; index += 1) {
          const octet = payload[index] ?? 0;
          word += BigInt(octet) << BigInt(index * 8);
        }
        return word;
      }

      function encodeWord(word: bigint): Uint8Array {
        const octets = new Uint8Array(WordOctets);
        let rest = word;
        for (let index = 0; index < WordOctets; index += 1) {
          octets[index] = Number(rest & 0xffn);
          rest >>= 8n;
        }
        return octets;
      }

      function octetAt(word: bigint, index: number): number {
        return Number((word >> BigInt(index * 8)) & 0xffn);
      }

      /** 清空一次执行留下的文本和结果。正在跑的那次之后回来的结果会被票号丢掉。 */
      function reset(): void {
        ticket += 1;
        text = "";
        fault = "";
        launch = null;
        status = SandboxStatusEmpty;
        for (let index = 0; index < registers.length; index += 1) {
          registers[index] = 0n;
        }
      }

      /**
       * 追加可打印 ASCII 或换行。
       * 超长或出现别的字节时，这次追加整个不收。
       */
      function appendText(word: bigint): void {
        if (status === SandboxStatusRunning) {
          fail("程序还在执行，不能追加文本");
        }
        const count = octetAt(word, 1);
        if (count < 1 || count > WordOctets - 2) {
          fail("追加长度不在 1 到 6");
        }
        if (text.length + count > TextMax) {
          fail("程序文本超过 4096 个八位组");
        }
        let piece = "";
        for (let index = 0; index < count; index += 1) {
          const code = octetAt(word, index + 2);
          if (code !== 0x0a && (code < 0x20 || code > 0x7e)) {
            fail("程序文本不是可打印 ASCII 或换行");
          }
          piece += String.fromCharCode(code);
        }
        text += piece;
        fault = "";
        status = SandboxStatusArmed;
      }

      /**
       * 客核心和固件共用一块内存。
       * 编译器默认的栈、帧、堆地址留给核心 0。交给客核心之前，只把不小于数据下界的立即数加上核心槽距。
       * 收下的原文不动，读回的文本长度仍是调用方追加的长度。
       */
      function relocateGuestLine(line: string): string {
        const shift = GuestCore * CoreSlotBits;
        return line.replace(/\d+/g, (token) => {
          const value = Number(token);
          if (!Number.isSafeInteger(value) || value < DataFloor) {
            return token;
          }
          return String(value + shift);
        });
      }

      /**
       * 把文本展开成 CPU 能执行的行，并留下一次启动请求。
       * 展开失败时记成失败状态，不把异常抛出交换。
       */
      function armRun(): bigint {
        if (status === SandboxStatusRunning) {
          return BigInt(status);
        }
        if (text.length < 1) {
          fault = `${runtimePrefix} 没有程序`;
          status = SandboxStatusFailed;
          return BigInt(status);
        }
        let lines: string[];
        try {
          lines = assemble(text.split("\n").map(relocateGuestLine));
        } catch (error: unknown) {
          fault = error instanceof Error ? error.message : `${runtimePrefix} 程序文本无法展开`;
          if (fault.length > FaultMax) {
            fault = fault.slice(0, FaultMax);
          }
          status = SandboxStatusFailed;
          return BigInt(status);
        }
        ticket += 1;
        launch = { lines, ticket };
        status = SandboxStatusRunning;
        fault = "";
        return BigInt(status);
      }

      function query(word: bigint): bigint {
        const code = octetAt(word, 0);
        if (code === QueryStatus) {
          return BigInt(status);
        }
        if (code === QueryTextLength) {
          return BigInt(text.length);
        }
        if (code === QueryFaultLength) {
          return BigInt(fault.length);
        }
        if (code === QueryFault) {
          const start = octetAt(word, 1);
          let packed = 0n;
          for (let index = 0; index < WordOctets; index += 1) {
            const source = start + index;
            const charCode = source < fault.length ? fault.charCodeAt(source) : 0;
            packed += BigInt(charCode & 0xff) << BigInt(index * 8);
          }
          return packed;
        }
        if (code >= QueryRegister && code < QueryRegister + registers.length) {
          const value = registers[code - QueryRegister] ?? 0n;
          return value & 0xffffffffffffffffn;
        }
        fail("沙盒没有这种读回请求");
      }

      function accept(word: bigint): bigint {
        const command = octetAt(word, 0);
        if (command === CommandReset) {
          reset();
          return BigInt(status);
        }
        if (command === CommandAppend) {
          appendText(word);
          return BigInt(text.length);
        }
        if (command === CommandRun) {
          return armRun();
        }
        fail("沙盒没有这种命令");
      }

      /**
       * 一次交换。
       * 方向 0 改文本或启动。方向 1 只读状态、故障和寄存器。
       */
      export function exchangeWord(direction: number, payload: Uint8Array): Uint8Array {
        const word = decodeWord(payload);
        if (direction === 0) {
          return encodeWord(accept(word));
        }
        if (direction === 1) {
          return encodeWord(query(word));
        }
        fail("沙盒交换方向不是 0 或 1");
      }

      /**
       * 取走刚刚由运行命令留下的启动请求。
       * 没有新请求时返回空。调用方负责把它交给 CPU。
       */
      export function takeLaunch(): { readonly lines: readonly string[]; readonly ticket: number } | null {
        const pending = launch;
        launch = null;
        return pending;
      }

      /**
       * CPU 把客程序的结局送回来。
       * 票号对不上说明期间已经复位或开始了下一次，这次结果丢掉。
       */
      export function noteGuestResult(
        resultTicket: number,
        ok: boolean,
        message: string,
        values: readonly bigint[],
      ): void {
        if (resultTicket !== ticket || status !== SandboxStatusRunning) {
          return;
        }
        for (let index = 0; index < registers.length; index += 1) {
          registers[index] = values[index] ?? 0n;
        }
        if (ok) {
          fault = "";
          status = SandboxStatusPassed;
          return;
        }
        fault = message.length > 0 ? message : `${runtimePrefix} 客程序失败`;
        if (fault.length > FaultMax) {
          fault = fault.slice(0, FaultMax);
        }
        status = SandboxStatusFailed;
      }
    }
  }
}
