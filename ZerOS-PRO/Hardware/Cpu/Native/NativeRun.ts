/**
 * @module ZerOS.Hardware.Cpu.NativeRun
 * @description 按线性位地址执行原生指令字节
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 直接解码 §4.12 列出的编码。不把字节收成 ZAP 下标。
 * 存储由调用方按「八位组地址 × 8 = 位地址」提供。
 * 帧的形状在 Structure/NativeState.ts。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 执行
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as EscapeRoot } from "../Enum/NativeEscape";
import { ZerOS as RegisterRoot } from "../Enum/NativeRegister";
import { ZerOS as CompatRoot } from "../Structure/CompatFrame";
import type { ZerOS as StateRoot } from "../Structure/NativeState";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      const NativeRsp = RegisterRoot.Hardware.Cpu.NativeRsp;
      const NativeRax = RegisterRoot.Hardware.Cpu.NativeRax;
      const NativeRcx = RegisterRoot.Hardware.Cpu.NativeRcx;
      const NativeRdi = RegisterRoot.Hardware.Cpu.NativeRdi;
      const NativeR11 = RegisterRoot.Hardware.Cpu.NativeR11;
      const nativeEscapeArity = EscapeRoot.Hardware.Cpu.nativeEscapeArity;
      const compatUserBit = CompatRoot.Hardware.Cpu.compatUserBit;
      const compatUserOfBit = CompatRoot.Hardware.Cpu.compatUserOfBit;
      const compatFlags = CompatRoot.Hardware.Cpu.compatFlags;
      const compatOrigin = CompatRoot.Hardware.Cpu.CompatTailOrigin;
      type NativeStep = StateRoot.Hardware.Cpu.NativeStep;
      const wordMask = (1n << 64n) - 1n;
      const signBit = 1n << 63n;
      const floatBytes = new ArrayBuffer(8);
      const floatView = new DataView(floatBytes);

      /** 这一拍的存储还不在调用方的缓冲里。调用方补上之后必须重试同一条。 */
      export class NativeMiss extends Error {
        readonly miss = true;
        readonly bit: bigint;

        constructor(bit: bigint) {
          super("native memory is not cached");
          this.bit = bit;
        }
      }

      export function nativeMiss(bit: bigint): NativeMiss {
        return new NativeMiss(bit);
      }

      export function isNativeMiss(value: unknown): value is NativeMiss {
        return value instanceof NativeMiss;
      }
      type NativeState = StateRoot.Hardware.Cpu.NativeState;
      type NativeOctetPort = StateRoot.Hardware.Cpu.NativeOctetPort;
      export type NativeStop = StateRoot.Hardware.Cpu.NativeStop;

      /**
       * 从 state.rip 取指令，直到 0xF4 或失败。
       * stepLimit 防止一条跳回自己的指令占住宿主。
       * 失败时不推进指令指针，已经成功的指令留下的寄存器保持新值。
       */
      export function runNative(state: NativeState, port: NativeOctetPort, stepLimit: number): NativeStop {
        let steps = 0;
        while (steps < stepLimit) {
          steps += 1;
          const outcome = stepNative(state, port);
          if (outcome === "halt") {
            return { kind: "halt", state };
          }
          if (outcome === "syscall") {
            return { kind: "wait", state };
          }
          if (outcome !== "cont") {
            return { kind: "fault", state };
          }
        }
        return { kind: "fault", state };
      }

      /* -------------------------------------------------------------------- */
      /* 2. 执行                                                               */
      /* -------------------------------------------------------------------- */

      function wrap(value: bigint): bigint {
        return value & wordMask;
      }

      function signed(value: bigint): bigint {
        const bits = wrap(value);
        return bits >= signBit ? bits - (wordMask + 1n) : bits;
      }

      function parity(value: bigint): boolean {
        let bits = Number(value & 0xffn);
        let ones = 0;
        while (bits !== 0) {
          ones += bits & 1;
          bits >>= 1;
        }
        return ones % 2 === 0;
      }

      function markLogic(state: NativeState, result: bigint): void {
        markLogicWidth(state, result, 64);
      }

      /** 逻辑运算的标志。width 是 32 或 64，SF 取这一宽的最高位，不是总看第 63 位。 */
      function markLogicWidth(state: NativeState, result: bigint, width: 8 | 16 | 32 | 64): void {
        const mask = width === 64 ? wordMask : (1n << BigInt(width)) - 1n;
        const bits = wrap(result) & mask;
        state.cf = false;
        state.of = false;
        state.zf = bits === 0n;
        state.sf = (bits & (1n << BigInt(width - 1))) !== 0n;
        state.pf = parity(bits);
      }

      /** inc 与 dec 不改 CF。OF 只在跨过该宽度的符号边界时置位。 */
      function markInc(state: NativeState, before: bigint, after: bigint, width: 8 | 32 | 64, increment: boolean): void {
        const mask = width === 32 ? 0xffffffffn : wordMask;
        const bits = after & mask;
        const sign = 1n << BigInt(width - 1);
        state.zf = bits === 0n;
        state.sf = (bits & sign) !== 0n;
        state.pf = parity(bits);
        const edge = increment ? sign - 1n : sign;
        state.of = (before & mask) === edge;
      }

      function markAdd(state: NativeState, left: bigint, right: bigint, result: bigint): void {
        const sum = left + right;
        const bits = wrap(result);
        state.cf = sum > wordMask;
        state.zf = bits === 0n;
        state.sf = bits >= signBit;
        state.pf = parity(bits);
        const leftSign = left >= signBit;
        const rightSign = right >= signBit;
        const resultSign = bits >= signBit;
        state.of = leftSign === rightSign && resultSign !== leftSign;
      }

      function markSub(state: NativeState, left: bigint, right: bigint, result: bigint): void {
        const bits = wrap(result);
        state.cf = left < right;
        state.zf = bits === 0n;
        state.sf = bits >= signBit;
        state.pf = parity(bits);
        const leftSign = left >= signBit;
        const rightSign = right >= signBit;
        const resultSign = bits >= signBit;
        state.of = leftSign !== rightSign && resultSign !== leftSign;
      }

      /** 8 位或 32 位加减的标志。操作数先按宽度截断，SF 取这一宽的最高位。 */
      function markAddWidth(state: NativeState, left: bigint, right: bigint, width: 8 | 16 | 32 | 64): void {
        const mask = (1n << BigInt(width)) - 1n;
        const low = left & mask;
        const high = right & mask;
        const sum = low + high;
        const bits = sum & mask;
        const sign = 1n << BigInt(width - 1);
        state.cf = sum > mask;
        state.zf = bits === 0n;
        state.sf = (bits & sign) !== 0n;
        state.pf = parity(bits);
        const leftSign = (low & sign) !== 0n;
        const rightSign = (high & sign) !== 0n;
        const resultSign = (bits & sign) !== 0n;
        state.of = leftSign === rightSign && resultSign !== leftSign;
      }

      function markSubWidth(state: NativeState, left: bigint, right: bigint, width: 8 | 16 | 32 | 64): void {
        const mask = (1n << BigInt(width)) - 1n;
        const low = left & mask;
        const high = right & mask;
        const bits = (low - high) & mask;
        const sign = 1n << BigInt(width - 1);
        state.cf = low < high;
        state.zf = bits === 0n;
        state.sf = (bits & sign) !== 0n;
        state.pf = parity(bits);
        const leftSign = (low & sign) !== 0n;
        const rightSign = (high & sign) !== 0n;
        const resultSign = (bits & sign) !== 0n;
        state.of = leftSign !== rightSign && resultSign !== leftSign;
      }

      function readOctet(port: NativeOctetPort, bit: bigint): number | null {
        if (bit < 0n || bit + 8n > port.limitBit || bit % 8n !== 0n) {
          return null;
        }
        const value = port.load(bit);
        if (!Number.isInteger(value) || value < 0 || value > 255) {
          return null;
        }
        return value;
      }

      function readOctetNumber(port: NativeOctetPort, bit: number): number | null {
        if (port.loadNumber === undefined) {
          return readOctet(port, BigInt(bit));
        }
        if (bit < 0 || (bit & 7) !== 0 || bit + 8 > Number(port.limitBit)) {
          return null;
        }
        const value = port.loadNumber(bit);
        if (!Number.isInteger(value) || value < 0 || value > 255) {
          return null;
        }
        return value;
      }

      function readImm(port: NativeOctetPort, bit: bigint, count: number): bigint | null {
        if (port.loadNumber !== undefined) {
          let cursor = Number(bit);
          let value = 0n;
          for (let index = 0; index < count; index += 1) {
            const octet = readOctetNumber(port, cursor);
            if (octet === null) {
              return null;
            }
            cursor += 8;
            value += BigInt(octet) << BigInt(index * 8);
          }
          return value;
        }
        let value = 0n;
        for (let index = 0; index < count; index += 1) {
          const octet = readOctet(port, bit + BigInt(index) * 8n);
          if (octet === null) {
            return null;
          }
          value += BigInt(octet) << BigInt(index * 8);
        }
        return value;
      }

      function writeImm(port: NativeOctetPort, bit: bigint, value: bigint): boolean {
        const bits = wrap(value);
        for (let index = 0; index < 8; index += 1) {
          const at = bit + BigInt(index) * 8n;
          if (readOctet(port, at) === null) {
            return false;
          }
        }
        for (let index = 0; index < 8; index += 1) {
          port.store(bit + BigInt(index) * 8n, Number((bits >> BigInt(index * 8)) & 0xffn));
        }
        return true;
      }

      /**
       * rep stos。方向固定向前，因为 0xFC 与 0xFD 还没登记。
       * 第一次就写不进时，rdi 和 rcx 保持原值。写进几轮之后失败，则留下已经完成的轮。
       */
      function applyStos(
        state: NativeState,
        port: NativeOctetPort,
        source: Reader,
        repeated: boolean,
        rexWide: boolean,
        rexBeforePrefix: boolean,
      ): NativeStep {
        let wide = rexWide;
        let op = 0xab;
        if (repeated) {
          if (rexBeforePrefix) {
            return "fault";
          }
          const next = source.take();
          if (next === null) {
            return "fault";
          }
          op = next;
          if (op >= 0x40 && op <= 0x4f) {
            wide = (op & 0x08) !== 0;
            const after = source.take();
            if (after === null) {
              return "fault";
            }
            op = after;
          }
        }
        if (op !== 0xab) {
          return "fault";
        }
        const width = wide ? 8 : 4;
        const step = BigInt(width);
        let ptr = state.reg[NativeRdi] ?? 0n;
        let count = repeated ? (state.reg[NativeRcx] ?? 0n) : 1n;
        const data = (state.reg[NativeRax] ?? 0n) & (wide ? wordMask : 0xffffffffn);
        let progressed = false;
        while (count !== 0n) {
          const bit = state.compat ? compatUserBit(ptr) : ptr < 0n ? null : ptr * 8n;
          if (bit === null || !writeCount(port, bit, data, width)) {
            if (progressed) {
              state.reg[NativeRdi] = ptr;
              if (repeated) {
                state.reg[NativeRcx] = count;
              }
            }
            return "fault";
          }
          ptr += step;
          count -= 1n;
          progressed = true;
        }
        state.reg[NativeRdi] = ptr;
        if (repeated) {
          state.reg[NativeRcx] = 0n;
        }
        state.rip = source.at;
        return "cont";
      }

      interface Mem {
        base: number | null;
        index: number | null;
        scale: number;
        disp: bigint;
        ripRelative: boolean;
      }

      interface Reader {
        at: bigint;
        take(): number | null;
      }

      /**
       * 一条指令做完才会做下一条，取指不会嵌套。
       * 复用这一只读取器，避免每条指令都新建一个对象。
       */
      let readerPort: NativeOctetPort | null = null;
      /**
       * 游标是位地址的安全整数。取每个八位组只加 8，不再做大整数加法。
       * at 仍是位地址，指令算下一条时才物化一次。
       */
      const reusedReader = {
        cursor: 0,
        get at(): bigint {
          return BigInt(this.cursor);
        },
        set at(value: bigint) {
          this.cursor = Number(value);
        },
        take(): number | null {
          const port = readerPort;
          if (port === null) {
            return null;
          }
          const value = port.loadNumber !== undefined
            ? readOctetNumber(port, this.cursor)
            : readOctet(port, BigInt(this.cursor));
          if (value === null) {
            return null;
          }
          this.cursor += 8;
          return value;
        },
      };

      function reader(port: NativeOctetPort, rip: bigint): Reader {
        readerPort = port;
        reusedReader.at = rip;
        return reusedReader;
      }

      /** 条件码低 4 位。0 是 OF，2 是 CF，4 是 ZF，6 是 CF 或 ZF，7 是两者都没有，12 是 SF 与 OF 不同。 */
      function condition(state: NativeState, code: number): boolean {
        const less = state.sf !== state.of;
        if (code === 0) {
          return state.of;
        }
        if (code === 1) {
          return !state.of;
        }
        if (code === 2) {
          return state.cf;
        }
        if (code === 3) {
          return !state.cf;
        }
        if (code === 4) {
          return state.zf;
        }
        if (code === 5) {
          return !state.zf;
        }
        if (code === 6) {
          return state.cf || state.zf;
        }
        if (code === 7) {
          return !state.cf && !state.zf;
        }
        if (code === 8) {
          return state.sf;
        }
        if (code === 9) {
          return !state.sf;
        }
        if (code === 10) {
          return state.pf;
        }
        if (code === 11) {
          return !state.pf;
        }
        if (code === 12) {
          return less;
        }
        if (code === 13) {
          return !less;
        }
        if (code === 14) {
          return state.zf || less;
        }
        return !state.zf && !less;
      }

      function disp8(source: Reader): bigint | null {
        const raw = source.take();
        if (raw === null) {
          return null;
        }
        return BigInt(raw < 128 ? raw : raw - 256);
      }

      function disp32(source: Reader): bigint | null {
        let value = 0n;
        for (let index = 0; index < 4; index += 1) {
          const octet = source.take();
          if (octet === null) {
            return null;
          }
          value += BigInt(octet) << BigInt(index * 8);
        }
        if (value >= 0x80000000n) {
          value -= 0x100000000n;
        }
        return value;
      }

      function parseMem(source: Reader, mod: number, rmLow: number, rexB: boolean, rexX: boolean): Mem | null {
        if (rmLow === 4) {
          const sib = source.take();
          if (sib === null) {
            return null;
          }
          const scale = 1 << (sib >> 6);
          const indexLow = (sib >> 3) & 7;
          const baseLow = sib & 7;
          const index = indexLow === 4 && !rexX ? null : indexLow + (rexX ? 8 : 0);
          if (baseLow === 5 && mod === 0) {
            const disp = disp32(source);
            if (disp === null) {
              return null;
            }
            return { base: null, index, scale, disp, ripRelative: false };
          }
          let disp = 0n;
          if (mod === 1) {
            const next = disp8(source);
            if (next === null) {
              return null;
            }
            disp = next;
          }
          if (mod === 2) {
            const next = disp32(source);
            if (next === null) {
              return null;
            }
            disp = next;
          }
          if (mod === 3) {
            return null;
          }
          return { base: baseLow + (rexB ? 8 : 0), index, scale, disp, ripRelative: false };
        }
        if (mod === 0 && rmLow === 5) {
          const disp = disp32(source);
          if (disp === null) {
            return null;
          }
          return { base: null, index: null, scale: 1, disp, ripRelative: true };
        }
        let disp = 0n;
        if (mod === 1) {
          const next = disp8(source);
          if (next === null) {
            return null;
          }
          disp = next;
        }
        if (mod === 2) {
          const next = disp32(source);
          if (next === null) {
            return null;
          }
          disp = next;
        }
        return { base: rmLow + (rexB ? 8 : 0), index: null, scale: 1, disp, ripRelative: false };
      }

      /** 本条的 FS 基址。0x64 把它加到非相对内存地址上，相对指令指针不加。 */
      let segmentBase = 0n;

      function octetAddress(state: NativeState, mem: Mem, nextBit: bigint): bigint | null {
        if (mem.ripRelative) {
          if (nextBit % 8n !== 0n) {
            return null;
          }
          return nextBit / 8n + mem.disp;
        }
        let address = mem.disp;
        if (mem.base !== null) {
          address += signed(state.reg[mem.base] ?? 0n);
        }
        if (mem.index !== null) {
          address += signed(state.reg[mem.index] ?? 0n) * BigInt(mem.scale);
        }
        return address;
      }

      /** 栈槽的线性位地址。兼容任务用用户八位组地址，原生任务用 rsp 乘 8。 */
      function stackBit(state: NativeState, rsp: bigint): bigint | null {
        if (state.compat) {
          return compatUserBit(rsp);
        }
        if (rsp < 0n) {
          return null;
        }
        return rsp * 8n;
      }

      function pushValue(state: NativeState, port: NativeOctetPort, value: bigint): boolean {
        const rsp = state.reg[NativeRsp] ?? 0n;
        if (rsp < 8n) {
          return false;
        }
        const next = rsp - 8n;
        const bit = stackBit(state, next);
        if (bit === null || !writeImm(port, bit, value)) {
          return false;
        }
        state.reg[NativeRsp] = next;
        return true;
      }

      function popValue(state: NativeState, port: NativeOctetPort): bigint | null {
        const rsp = state.reg[NativeRsp] ?? 0n;
        const bit = stackBit(state, rsp);
        if (bit === null) {
          return null;
        }
        const value = readImm(port, bit, 8);
        if (value === null) {
          return null;
        }
        state.reg[NativeRsp] = rsp + 8n;
        return value;
      }

      /** 内存操作数的线性位地址。兼容任务的寄存器地址先加上尾区起点。 */
      function operandBit(state: NativeState, mem: Mem, address: bigint): bigint | null {
        const adjusted = mem.ripRelative ? address : address + segmentBase;
        if (!state.compat) {
          return adjusted * 8n;
        }
        if (mem.ripRelative) {
          const bit = address * 8n;
          if (compatUserOfBit(bit) === null) {
            return null;
          }
          return bit;
        }
        return compatUserBit(adjusted);
      }

      function regAt(state: NativeState, index: number): bigint | null {
        if (!Number.isInteger(index) || index < 0 || index > 15) {
          return null;
        }
        return state.reg[index] ?? 0n;
      }

      function writeCount(port: NativeOctetPort, bit: bigint, value: bigint, count: number): boolean {
        for (let index = 0; index < count; index += 1) {
          if (readOctet(port, bit + BigInt(index) * 8n) === null) {
            return false;
          }
        }
        const bits = value & ((1n << BigInt(count * 8)) - 1n);
        for (let index = 0; index < count; index += 1) {
          port.store(bit + BigInt(index) * 8n, Number((bits >> BigInt(index * 8)) & 0xffn));
        }
        return true;
      }

      function signExtend(value: bigint, bits: number): bigint {
        const width = 1n << BigInt(bits);
        const masked = value & (width - 1n);
        const sign = width >> 1n;
        if (masked >= sign) {
          return wrap(masked - width);
        }
        return masked;
      }

      function floatFrom(bits: bigint): number | null {
        const signedBits = signed(bits);
        if (signedBits < -9223372036854775808n || signedBits > 9223372036854775807n) {
          return null;
        }
        floatView.setBigInt64(0, signedBits, true);
        const number = floatView.getFloat64(0, true);
        if (!Number.isFinite(number)) {
          return null;
        }
        return number;
      }

      function floatTo(number: number): bigint | null {
        if (!Number.isFinite(number)) {
          return null;
        }
        floatView.setFloat64(0, number, true);
        if (!Number.isFinite(floatView.getFloat64(0, true))) {
          return null;
        }
        return wrap(floatView.getBigInt64(0, true));
      }

      /**
       * 0F 3E 是三条寄存器的整数、浮点和按位地址的访存。
       * 位地址在寄存器里，必须能被 8 整除。失败时不写目的寄存器。
       */
      function applyWide(state: NativeState, port: NativeOctetPort, source: Reader): boolean {
        const opcode = source.take();
        const dest = source.take();
        const left = source.take();
        const right = source.take();
        if (opcode === null || dest === null || left === null || right === null) {
          return false;
        }
        if (dest > 15 || left > 15 || right > 15) {
          return false;
        }
        const lhs = regAt(state, left);
        const rhs = regAt(state, right);
        if (lhs === null || rhs === null) {
          return false;
        }
        const write = (value: bigint): void => {
          state.reg[dest] = wrap(value);
        };
        if (opcode === 0x01 || opcode === 0x02 || opcode === 0x03 || opcode === 0x04 || opcode === 0x05) {
          let result = 0n;
          if (opcode === 0x01) {
            result = wrap(lhs + rhs);
            markAdd(state, lhs, rhs, result);
          } else if (opcode === 0x02) {
            result = wrap(lhs - rhs);
            markSub(state, lhs, rhs, result);
          } else if (opcode === 0x03) {
            result = wrap(lhs & rhs);
            markLogic(state, result);
          } else if (opcode === 0x04) {
            result = wrap(lhs | rhs);
            markLogic(state, result);
          } else {
            result = wrap(lhs ^ rhs);
            markLogic(state, result);
          }
          write(result);
          state.rip = source.at;
          return true;
        }
        if (opcode === 0x06) {
          write(signed(lhs) * signed(rhs));
          state.rip = source.at;
          return true;
        }
        if (opcode === 0x07 || opcode === 0x08) {
          const divisor = signed(rhs);
          if (divisor === 0n) {
            return false;
          }
          const dividend = signed(lhs);
          write(opcode === 0x07 ? dividend / divisor : dividend % divisor);
          state.rip = source.at;
          return true;
        }
        if (opcode === 0x09 || opcode === 0x0a) {
          const dividend = signed(lhs);
          const divisor = signed(rhs);
          if (dividend < 0n || divisor <= 0n) {
            return false;
          }
          write(opcode === 0x09 ? dividend / divisor : dividend % divisor);
          state.rip = source.at;
          return true;
        }
        if (opcode === 0x0b || opcode === 0x0c) {
          const count = signed(rhs);
          if (count < 0n || count > 63n) {
            return false;
          }
          const value = signed(lhs);
          const shifted = opcode === 0x0b ? value << count : value >> count;
          const result = wrap(shifted);
          markLogic(state, result);
          write(result);
          state.rip = source.at;
          return true;
        }
        if (opcode >= 0x0d && opcode <= 0x11) {
          const leftSigned = signed(lhs);
          const rightSigned = signed(rhs);
          let bit = false;
          if (opcode === 0x0d) {
            bit = leftSigned === rightSigned;
          } else if (opcode === 0x0e) {
            bit = leftSigned < rightSigned;
          } else if (opcode === 0x0f) {
            bit = leftSigned <= rightSigned;
          } else if (opcode === 0x10) {
            bit = leftSigned > rightSigned;
          } else {
            bit = leftSigned >= rightSigned;
          }
          write(bit ? 1n : 0n);
          state.rip = source.at;
          return true;
        }
        if (opcode === 0x12) {
          write(~signed(lhs));
          state.rip = source.at;
          return true;
        }
        if (opcode === 0x13) {
          const bits = floatTo(Number(signed(lhs)));
          if (bits === null) {
            return false;
          }
          write(bits);
          state.rip = source.at;
          return true;
        }
        if (opcode >= 0x14 && opcode <= 0x1a) {
          const lhsNumber = floatFrom(lhs);
          const rhsNumber = floatFrom(rhs);
          if (opcode === 0x1a) {
            floatView.setBigInt64(0, signed(lhs), true);
            const leftRaw = floatView.getFloat64(0, true);
            floatView.setBigInt64(0, signed(rhs), true);
            const rightRaw = floatView.getFloat64(0, true);
            write(leftRaw === rightRaw ? 1n : 0n);
            state.rip = source.at;
            return true;
          }
          if (lhsNumber === null || rhsNumber === null) {
            return false;
          }
          let number = 0;
          if (opcode === 0x14) {
            number = lhsNumber + rhsNumber;
          } else if (opcode === 0x15) {
            number = lhsNumber - rhsNumber;
          } else if (opcode === 0x16) {
            number = lhsNumber * rhsNumber;
          } else if (opcode === 0x18) {
            number = lhsNumber ** rhsNumber;
          } else if (rhsNumber === 0) {
            return false;
          } else if (opcode === 0x19) {
            number = lhsNumber % rhsNumber;
          } else {
            number = lhsNumber / rhsNumber;
          }
          const bits = floatTo(number);
          if (bits === null) {
            return false;
          }
          write(bits);
          state.rip = source.at;
          return true;
        }
        if (opcode >= 0x20 && opcode <= 0x2b) {
          const address = lhs;
          if (address < 0n || address % 8n !== 0n) {
            return false;
          }
          const storing = opcode === 0x21 || opcode === 0x23 || opcode === 0x25 || opcode === 0x27 || opcode === 0x29 || opcode === 0x2b;
          const value = regAt(state, dest);
          if (value === null) {
            return false;
          }
          let count = 8;
          if (opcode === 0x22 || opcode === 0x23) {
            count = 1;
          } else if (opcode === 0x24 || opcode === 0x25) {
            count = 2;
          } else if (opcode === 0x26 || opcode === 0x27 || opcode === 0x2a || opcode === 0x2b) {
            count = 4;
          }
          if (opcode === 0x2b) {
            const number = floatFrom(value);
            if (number === null) {
              return false;
            }
            floatView.setFloat32(0, number, true);
            if (!writeCount(port, address, BigInt(floatView.getUint32(0, true)), 4)) {
              return false;
            }
            state.rip = source.at;
            return true;
          }
          if (storing) {
            if (!writeCount(port, address, value, count)) {
              return false;
            }
            state.rip = source.at;
            return true;
          }
          const loaded = readImm(port, address, count);
          if (loaded === null) {
            return false;
          }
          if (opcode === 0x28) {
            write(loaded);
          } else if (opcode === 0x2a) {
            floatView.setUint32(0, Number(loaded & 0xffffffffn), true);
            const number = floatView.getFloat32(0, true);
            const bits = floatTo(number);
            if (bits === null) {
              return false;
            }
            write(bits);
          } else {
            write(signExtend(loaded, count * 8));
          }
          state.rip = source.at;
          return true;
        }
        return false;
      }

      /**
       * 8 位读写只动那一个字节。没有 REX 时 4 至 7 是 AH/CH/DH/BH，有 REX 时是低 8 位。
       * 写完不把寄存器其余位清掉。
       */
      function byteSlot(low3: number, extended: boolean, rexOn: boolean): { index: number; shift: number } {
        if (rexOn) {
          return { index: low3 + (extended ? 8 : 0), shift: 0 };
        }
        if (low3 >= 4) {
          return { index: low3 - 4, shift: 8 };
        }
        return { index: low3, shift: 0 };
      }

      function readByte(state: NativeState, index: number, shift: number): number {
        return Number(((state.reg[index] ?? 0n) >> BigInt(shift)) & 0xffn);
      }

      function writeByte(state: NativeState, index: number, shift: number, value: number): void {
        const placed = BigInt(value & 255) << BigInt(shift);
        const mask = 0xffn << BigInt(shift);
        state.reg[index] = ((state.reg[index] ?? 0n) & (wordMask ^ mask)) | placed;
      }

      function applyByte(
        state: NativeState,
        port: NativeOctetPort,
        source: Reader,
        opcode: number,
        rex: number,
        rexR: boolean,
        rexX: boolean,
        rexB: boolean,
      ): NativeStep {
        if (opcode === 0xeb) {
          const rel = disp8(source);
          if (rel === null) {
            return "fault";
          }
          const target = source.at + rel * 8n;
          if (state.compat && compatUserOfBit(target) === null) {
            return "fault";
          }
          state.rip = target;
          return "cont";
        }
        if (opcode === 0x3c) {
          const imm = source.take();
          if (imm === null) {
            return "fault";
          }
          markSubWidth(state, (state.reg[NativeRax] ?? 0n) & 0xffn, BigInt(imm), 8);
          state.rip = source.at;
          return "cont";
        }
        const modrm = source.take();
        if (modrm === null) {
          return "fault";
        }
        const mod = modrm >> 6;
        const reg3 = (modrm >> 3) & 7;
        const rm3 = modrm & 7;
        const rexOn = rex !== 0;
        const regSlot = byteSlot(reg3, rexR, rexOn);
        const rmSlot = byteSlot(rm3, rexB, rexOn);
        let mem: Mem | null = null;
        let address: bigint | null = null;
        if (mod !== 3) {
          mem = parseMem(source, mod, rm3, rexB, rexX);
          if (mem === null) {
            return "fault";
          }
          address = octetAddress(state, mem, source.at + ((opcode === 0x80 || opcode === 0xc6 || opcode === 0xf6) && mem.ripRelative ? 8n : 0n));
          if (address === null) {
            return "fault";
          }
        }
        let imm: number | null = null;
        if (opcode === 0x80 || opcode === 0xc6 || opcode === 0xf6) {
          imm = source.take();
          if (imm === null) {
            return "fault";
          }
        }
        const rmBit = (): bigint | null => {
          if (mem === null || address === null) {
            return null;
          }
          return operandBit(state, mem, address);
        };
        const readRm = (): number | null => {
          if (mod === 3) {
            return readByte(state, rmSlot.index, rmSlot.shift);
          }
          const bit = rmBit();
          if (bit === null) {
            return null;
          }
          return readOctet(port, bit);
        };
        const writeRm = (value: number): boolean => {
          if (mod === 3) {
            writeByte(state, rmSlot.index, rmSlot.shift, value);
            return true;
          }
          const bit = rmBit();
          if (bit === null || readOctet(port, bit) === null) {
            return false;
          }
          port.store(bit, value & 255);
          return true;
        };
        if (opcode === 0x8a || opcode === 0x88) {
          const fromReg = opcode === 0x88;
          const loaded = fromReg ? readByte(state, regSlot.index, regSlot.shift) : readRm();
          if (loaded === null) {
            return "fault";
          }
          if (fromReg) {
            if (!writeRm(loaded)) {
              return "fault";
            }
          } else {
            writeByte(state, regSlot.index, regSlot.shift, loaded);
          }
          state.rip = source.at;
          return "cont";
        }
        if (opcode === 0xf6) {
          if (reg3 !== 0 || rexR || imm === null) {
            return "fault";
          }
          const left = readRm();
          if (left === null) {
            return "fault";
          }
          markLogicWidth(state, BigInt(left & imm), 8);
          state.rip = source.at;
          return "cont";
        }
        if (opcode === 0x38 || opcode === 0x3a) {
          const memoryByte = readRm();
          if (memoryByte === null) {
            return "fault";
          }
          const registerByte = readByte(state, regSlot.index, regSlot.shift);
          if (opcode === 0x38) {
            markSubWidth(state, BigInt(memoryByte), BigInt(registerByte), 8);
          } else {
            markSubWidth(state, BigInt(registerByte), BigInt(memoryByte), 8);
          }
          state.rip = source.at;
          return "cont";
        }
        if (opcode === 0x84) {
          const left = readRm();
          if (left === null) {
            return "fault";
          }
          const right = readByte(state, regSlot.index, regSlot.shift);
          markLogicWidth(state, BigInt(left & right), 8);
          state.rip = source.at;
          return "cont";
        }
        if (opcode === 0xc6) {
          if (reg3 !== 0 || rexR || imm === null) {
            return "fault";
          }
          if (!writeRm(imm)) {
            return "fault";
          }
          state.rip = source.at;
          return "cont";
        }
        if (opcode === 0xfe) {
          if (reg3 > 1 || rexR) {
            return "fault";
          }
          const left = readRm();
          if (left === null) {
            return "fault";
          }
          const increment = reg3 === 0;
          const changed = (increment ? left + 1 : left - 1) & 255;
          if (!writeRm(changed)) {
            return "fault";
          }
          markInc(state, BigInt(left), BigInt(changed), 8, increment);
          state.rip = source.at;
          return "cont";
        }
        if (opcode !== 0x80 || rexR || imm === null || reg3 === 2 || reg3 === 3) {
          return "fault";
        }
        const left = readRm();
        if (left === null) {
          return "fault";
        }
        const right = imm;
        if (reg3 === 7) {
          markSubWidth(state, BigInt(left), BigInt(right), 8);
          state.rip = source.at;
          return "cont";
        }
        let changed = left;
        if (reg3 === 0) {
          changed = (left + right) & 255;
        } else if (reg3 === 5) {
          changed = (left - right) & 255;
        } else if (reg3 === 1) {
          changed = left | right;
        } else if (reg3 === 4) {
          changed = left & right;
        } else {
          changed = left ^ right;
        }
        if (!writeRm(changed)) {
          return "fault";
        }
        if (reg3 === 0) {
          markAddWidth(state, BigInt(left), BigInt(right), 8);
        } else if (reg3 === 5) {
          markSubWidth(state, BigInt(left), BigInt(right), 8);
        } else {
          markLogicWidth(state, BigInt(changed), 8);
        }
        state.rip = source.at;
        return "cont";
      }

      /**
       * 做一条。0F 3F 不在这里产生副作用，调用方拿到 escape 后再做。
       * 失败和 escape 都不改指令指针。
       */
      export function stepNative(state: NativeState, port: NativeOctetPort): NativeStep {
        if (state.compat && compatUserOfBit(state.rip) === null) {
          return "fault";
        }
        const source = reader(port, state.rip);
        const first = source.take();
        if (first === null) {
          return "fault";
        }
        segmentBase = 0n;
        let operand16 = false;
        let opcode = first;
        if (opcode === 0x66) {
          operand16 = true;
          const prefixed = source.take();
          if (prefixed === null) {
            return "fault";
          }
          opcode = prefixed;
        }
        if (opcode === 0x64) {
          segmentBase = state.fsbase;
          const prefixed = source.take();
          if (prefixed === null) {
            return "fault";
          }
          opcode = prefixed;
        }
        let rex = 0;
        if (opcode >= 0x40 && opcode <= 0x4f) {
          rex = opcode;
          const next = source.take();
          if (next === null) {
            return "fault";
          }
          opcode = next;
        }
        const rexW = (rex & 0x08) !== 0;
        if (rexW) {
          operand16 = false;
        }
        const rexR = (rex & 0x04) !== 0;
        const rexX = (rex & 0x02) !== 0;
        const rexB = (rex & 0x01) !== 0;
        if (operand16 && opcode !== 0x83 && opcode !== 0x89 && opcode !== 0x8b) {
          return "fault";
        }
        if (opcode === 0xf3 || opcode === 0xab) {
          return applyStos(state, port, source, opcode === 0xf3, rexW, rex !== 0);
        }
        if (opcode === 0xf4) {
          state.rip = source.at;
          return "halt";
        }
        if (opcode === 0xc3) {
          const back = popValue(state, port);
          if (back === null) {
            return "fault";
          }
          if (state.compat) {
            const bit = compatUserBit(back);
            if (bit === null) {
              state.reg[NativeRsp] = (state.reg[NativeRsp] ?? 0n) - 8n;
              return "fault";
            }
            state.rip = bit;
            return "cont";
          }
          state.rip = back;
          return "cont";
        }
        if (opcode === 0xe8 || opcode === 0xe9) {
          const rel = disp32(source);
          if (rel === null) {
            return "fault";
          }
          const next = source.at;
          const target = next + rel * 8n;
          if (state.compat && compatUserOfBit(target) === null) {
            return "fault";
          }
          if (opcode === 0xe8) {
            const pushed = state.compat ? compatUserOfBit(next) : next;
            if (pushed === null || !pushValue(state, port, pushed)) {
              return "fault";
            }
          }
          state.rip = target;
          return "cont";
        }
        if (opcode >= 0x70 && opcode <= 0x7f) {
          const rel = disp8(source);
          if (rel === null) {
            return "fault";
          }
          const take = condition(state, opcode & 15);
          const target = source.at + rel * 8n;
          if (take && state.compat && compatUserOfBit(target) === null) {
            return "fault";
          }
          state.rip = take ? target : source.at;
          return "cont";
        }
        if (opcode === 0xeb || opcode === 0x3c || opcode === 0x38 || opcode === 0x3a || opcode === 0x88 || opcode === 0x8a
          || opcode === 0x84 || opcode === 0x80 || opcode === 0xc6 || opcode === 0xfe || opcode === 0xf6) {
          return applyByte(state, port, source, opcode, rex, rexR, rexX, rexB);
        }
        if (opcode >= 0x50 && opcode <= 0x57) {
          const index = (opcode & 7) + (rexB ? 8 : 0);
          if (!pushValue(state, port, state.reg[index] ?? 0n)) {
            return "fault";
          }
          state.rip = source.at;
          return "cont";
        }
        if (opcode >= 0x58 && opcode <= 0x5f) {
          const index = (opcode & 7) + (rexB ? 8 : 0);
          const value = popValue(state, port);
          if (value === null) {
            return "fault";
          }
          state.reg[index] = value;
          state.rip = source.at;
          return "cont";
        }
        if (opcode === 0x0f) {
          const second = source.take();
          if (second === null) {
            return "fault";
          }
          if (second === 0x05) {
            if (!state.compat) {
              return "fault";
            }
            const next = source.at;
            const virtual = compatUserOfBit(next);
            if (virtual === null) {
              return "fault";
            }
            state.reg[NativeRcx] = virtual;
            state.reg[NativeR11] = compatFlags(state);
            state.rip = next;
            return "syscall";
          }
          if (second === 0x3e) {
            if (!applyWide(state, port, source)) {
              return "fault";
            }
            return "cont";
          }
          if (second === 0x3f) {
            const esc = source.take();
            if (esc === null) {
              return "fault";
            }
            const arity = nativeEscapeArity(esc);
            if (arity === null) {
              return "fault";
            }
            const regs: number[] = [];
            for (let index = 0; index < arity; index += 1) {
              const reg = source.take();
              if (reg === null || reg > 15) {
                return "fault";
              }
              regs.push(reg);
            }
            /* 先不改指令指针。核心做完效果之后才走到 next。 */
            return { kind: "escape", opcode: esc, regs, next: source.at };
          }
          if (second === 0xb6) {
            const modrm = source.take();
            if (modrm === null) {
              return "fault";
            }
            const mod = modrm >> 6;
            const dest = ((modrm >> 3) & 7) + (rexR ? 8 : 0);
            const rm3 = modrm & 7;
            let value: number | null;
            if (mod === 3) {
              const slot = byteSlot(rm3, rexB, rex !== 0);
              value = readByte(state, slot.index, slot.shift);
            } else {
              const mem = parseMem(source, mod, rm3, rexB, rexX);
              if (mem === null) {
                return "fault";
              }
              const address = octetAddress(state, mem, source.at);
              if (address === null) {
                return "fault";
              }
              const bit = operandBit(state, mem, address);
              if (bit === null) {
                return "fault";
              }
              value = readOctet(port, bit);
            }
            if (value === null) {
              return "fault";
            }
            state.reg[dest] = BigInt(value & 255);
            state.rip = source.at;
            return "cont";
          }
          if (second === 0xb7) {
            const modrm = source.take();
            if (modrm === null) {
              return "fault";
            }
            const mod = modrm >> 6;
            const dest = ((modrm >> 3) & 7) + (rexR ? 8 : 0);
            let value: bigint | null;
            if (mod === 3) {
              const src = (modrm & 7) + (rexB ? 8 : 0);
              value = (state.reg[src] ?? 0n) & 0xffffn;
            } else {
              const mem = parseMem(source, mod, modrm & 7, rexB, rexX);
              if (mem === null) {
                return "fault";
              }
              const address = octetAddress(state, mem, source.at);
              if (address === null) {
                return "fault";
              }
              const bit = operandBit(state, mem, address);
              if (bit === null) {
                return "fault";
              }
              value = readImm(port, bit, 2);
            }
            if (value === null) {
              return "fault";
            }
            state.reg[dest] = value & 0xffffn;
            state.rip = source.at;
            return "cont";
          }
          if (second === 0xaf) {
            const modrm = source.take();
            if (modrm === null || (modrm >> 6) !== 3) {
              return "fault";
            }
            const dest = ((modrm >> 3) & 7) + (rexR ? 8 : 0);
            const src = (modrm & 7) + (rexB ? 8 : 0);
            const mask = rexW ? wordMask : 0xffffffffn;
            const sign = rexW ? signBit : 0x80000000n;
            const toSigned = (value: bigint): bigint => {
              const bits = value & mask;
              return bits >= sign ? bits - (mask + 1n) : bits;
            };
            const product = toSigned(state.reg[dest] ?? 0n) * toSigned(state.reg[src] ?? 0n);
            const low = product & mask;
            const overflow = product !== toSigned(low);
            state.reg[dest] = low;
            if (rexW) {
              markLogic(state, low);
            } else {
              markLogicWidth(state, low, 32);
            }
            state.cf = overflow;
            state.of = overflow;
            state.rip = source.at;
            return "cont";
          }
          if (second >= 0x90 && second <= 0x9f) {
            const modrm = source.take();
            if (modrm === null || (modrm >> 6) !== 3 || ((modrm >> 3) & 7) !== 0 || rexR) {
              return "fault";
            }
            const slot = byteSlot(modrm & 7, rexB, rex !== 0);
            writeByte(state, slot.index, slot.shift, condition(state, second & 15) ? 1 : 0);
            state.rip = source.at;
            return "cont";
          }
          const rel = disp32(source);
          if (rel === null || second < 0x80 || second > 0x8f) {
            return "fault";
          }
          const take = condition(state, second & 15);
          const target = source.at + rel * 8n;
          if (take && state.compat && compatUserOfBit(target) === null) {
            return "fault";
          }
          state.rip = take ? target : source.at;
          return "cont";
        }
        if (opcode >= 0xb8 && opcode <= 0xbf) {
          const dest = (opcode & 7) + (rexB ? 8 : 0);
          /* 没有 W 时立即数只有 4 个八位组，写入后高 32 位是 0。有 W 时仍是 8 个。两种都不改标志。 */
          const count = rexW ? 8 : 4;
          const imm = readImm(port, source.at, count);
          if (imm === null) {
            return "fault";
          }
          state.reg[dest] = rexW ? imm : imm & 0xffffffffn;
          state.rip = source.at + BigInt(count) * 8n;
          return "cont";
        }
        if (opcode === 0x83) {
          const modrm = source.take();
          if (modrm === null) {
            return "fault";
          }
          const mod = modrm >> 6;
          const operation = (modrm >> 3) & 7;
          if (operation === 2 || operation === 3) {
            return "fault";
          }
          const rmLow = modrm & 7;
          let regIndex = -1;
          let bit: bigint | null = null;
          let left: bigint;
          if (mod === 3) {
            regIndex = rmLow + (rexB ? 8 : 0);
            const full = state.reg[regIndex] ?? 0n;
            left = rexW ? full : full & (operand16 ? 0xffffn : 0xffffffffn);
          } else {
            const mem = parseMem(source, mod, rmLow, rexB, rexX);
            if (mem === null) {
              return "fault";
            }
            const address = octetAddress(state, mem, mem.ripRelative ? source.at + 8n : source.at);
            if (address === null) {
              return "fault";
            }
            bit = operandBit(state, mem, address);
            if (bit === null) {
              return "fault";
            }
            const loaded = readImm(port, bit, operand16 ? 2 : rexW ? 8 : 4);
            if (loaded === null) {
              return "fault";
            }
            left = loaded;
          }
          const immRaw = source.take();
          if (immRaw === null) {
            return "fault";
          }
          const imm = BigInt(immRaw < 128 ? immRaw : immRaw - 256);
          const narrow = operand16 ? 16 : 32;
          const narrowMask = operand16 ? 0xffffn : 0xffffffffn;
          const writeBack = (result: bigint): boolean => {
            if (regIndex >= 0) {
              if (operand16) {
                const full = state.reg[regIndex] ?? 0n;
                state.reg[regIndex] = (full & ~0xffffn) | (result & 0xffffn);
              } else {
                state.reg[regIndex] = result;
              }
              return true;
            }
            if (bit === null) {
              return false;
            }
            if (operand16) {
              return writeCount(port, bit, result, 2);
            }
            return rexW ? writeImm(port, bit, result) : writeCount(port, bit, result, 4);
          };
          if (operation === 7) {
            if (rexW) {
              markSub(state, left, wrap(imm), wrap(left - imm));
            } else {
              markSubWidth(state, left, imm, narrow);
            }
          } else if (operation === 0 || operation === 5) {
            const adding = operation === 0;
            const result = rexW
              ? wrap(adding ? left + imm : left - imm)
              : ((adding ? left + imm : left - imm) & narrowMask);
            if (!writeBack(result)) {
              return "fault";
            }
            if (rexW) {
              if (adding) {
                markAdd(state, left, wrap(imm), result);
              } else {
                markSub(state, left, wrap(imm), result);
              }
            } else if (adding) {
              markAddWidth(state, left, imm, narrow);
            } else {
              markSubWidth(state, left, imm, narrow);
            }
          } else if (operation === 1 || operation === 4 || operation === 6) {
            const wide = rexW ? wrap(imm) : imm & narrowMask;
            const result = operation === 1 ? left | wide : operation === 4 ? left & wide : left ^ wide;
            const stored = rexW ? wrap(result) : result & narrowMask;
            if (!writeBack(stored)) {
              return "fault";
            }
            if (rexW) {
              markLogic(state, stored);
            } else {
              markLogicWidth(state, stored, narrow);
            }
          } else {
            return "fault";
          }
          state.rip = source.at;
          return "cont";
        }
        /* 81 与 83 是同一组运算。立即数是 4 个八位组。有 W 时按符号扩成 64 位。没有 W 时按 32 位并零扩展。 */
        if (opcode === 0x81) {
          const modrm = source.take();
          if (modrm === null || (modrm >> 6) !== 3) {
            return "fault";
          }
          const raw = readImm(port, source.at, 4);
          if (raw === null) {
            return "fault";
          }
          const operation = (modrm >> 3) & 7;
          const rm = (modrm & 7) + (rexB ? 8 : 0);
          const full = state.reg[rm] ?? 0n;
          const left = rexW ? full : full & 0xffffffffn;
          const imm = rexW ? wrap(raw >= 0x80000000n ? raw - 0x100000000n : raw) : raw;
          if (operation === 7) {
            if (rexW) {
              markSub(state, left, imm, wrap(left - imm));
            } else {
              markSubWidth(state, left, imm, 32);
            }
          } else if (operation === 0 || operation === 5) {
            const adding = operation === 0;
            const result = rexW
              ? wrap(adding ? left + imm : left - imm)
              : ((adding ? left + imm : left - imm) & 0xffffffffn);
            if (rexW) {
              if (adding) {
                markAdd(state, left, imm, result);
              } else {
                markSub(state, left, imm, result);
              }
            } else if (adding) {
              markAddWidth(state, left, imm, 32);
            } else {
              markSubWidth(state, left, imm, 32);
            }
            state.reg[rm] = result;
          } else if (operation === 1 || operation === 4 || operation === 6) {
            const result = operation === 1 ? left | imm : operation === 4 ? left & imm : left ^ imm;
            const stored = rexW ? wrap(result) : result & 0xffffffffn;
            if (rexW) {
              markLogic(state, stored);
            } else {
              markLogicWidth(state, stored, 32);
            }
            state.reg[rm] = stored;
          } else {
            return "fault";
          }
          state.rip = source.at + 32n;
          return "cont";
        }
        /* C1 按立即数移位，D1 移 1 位。只登记 /4 左移、/5 逻辑右移、/7 算术右移。 */
        if (opcode === 0xc1 || opcode === 0xd1) {
          const modrm = source.take();
          if (modrm === null || (modrm >> 6) !== 3) {
            return "fault";
          }
          const operation = (modrm >> 3) & 7;
          if (operation !== 4 && operation !== 5 && operation !== 7) {
            return "fault";
          }
          const rm = (modrm & 7) + (rexB ? 8 : 0);
          const width = rexW ? 64 : 32;
          const countMask = width === 64 ? 63 : 31;
          let count = 1;
          if (opcode === 0xc1) {
            const raw = source.take();
            if (raw === null) {
              return "fault";
            }
            count = raw & countMask;
          }
          const full = state.reg[rm] ?? 0n;
          const value = width === 64 ? full : full & 0xffffffffn;
          if (count !== 0) {
            const bitAt = (sourceValue: bigint, index: number): boolean => ((sourceValue >> BigInt(index)) & 1n) === 1n;
            const span = (1n << BigInt(width)) - 1n;
            const sign = width - 1;
            let result: bigint;
            let carry: boolean;
            let overflow = false;
            if (operation === 4) {
              carry = bitAt(value, width - count);
              result = (value << BigInt(count)) & span;
              if (count === 1) {
                overflow = bitAt(result, sign) !== carry;
              }
            } else if (operation === 5) {
              carry = bitAt(value, count - 1);
              result = value >> BigInt(count);
              if (count === 1) {
                overflow = bitAt(value, sign);
              }
            } else {
              carry = bitAt(value, count - 1);
              result = value >> BigInt(count);
              if (bitAt(value, sign)) {
                const fill = ((1n << BigInt(count)) - 1n) << BigInt(width - count);
                result = (result | fill) & span;
              }
            }
            state.reg[rm] = width === 64 ? wrap(result) : result;
            const bits = result & span;
            state.cf = carry;
            state.of = overflow;
            state.zf = bits === 0n;
            state.sf = bitAt(bits, sign);
            state.pf = parity(bits);
          }
          state.rip = source.at;
          return "cont";
        }
        if (opcode === 0xff) {
          const modrm = source.take();
          if (modrm === null || (modrm >> 6) !== 3) {
            return "fault";
          }
          const operation = (modrm >> 3) & 7;
          const rm = (modrm & 7) + (rexB ? 8 : 0);
          /* /2 是 call r/m，/4 是 jmp r/m。64 位模式里目标是整个寄存器，不要求 REX.W。 */
          if (operation === 2 || operation === 4) {
            const target = state.reg[rm] ?? 0n;
            const next = source.at;
            let bit: bigint;
            if (state.compat) {
              const landed = compatUserBit(target);
              if (landed === null) {
                return "fault";
              }
              bit = landed;
            } else {
              bit = target;
            }
            if (operation === 2) {
              const pushed = state.compat ? compatUserOfBit(next) : next;
              if (pushed === null || !pushValue(state, port, pushed)) {
                return "fault";
              }
            }
            state.rip = bit;
            return "cont";
          }
          if (operation !== 0 && operation !== 1) {
            return "fault";
          }
          const left = state.reg[rm] ?? 0n;
          const increment = operation === 0;
          if (rexW) {
            const changed = wrap(increment ? left + 1n : left - 1n);
            state.reg[rm] = changed;
            markInc(state, left, changed, 64, increment);
          } else {
            const low = left & 0xffffffffn;
            const changed = (increment ? low + 1n : low - 1n) & 0xffffffffn;
            state.reg[rm] = changed;
            markInc(state, low, changed, 32, increment);
          }
          state.rip = source.at;
          return "cont";
        }
        if (opcode === 0x85) {
          const modrm = source.take();
          if (modrm === null || (modrm >> 6) !== 3) {
            return "fault";
          }
          const reg = ((modrm >> 3) & 7) + (rexR ? 8 : 0);
          const rm = (modrm & 7) + (rexB ? 8 : 0);
          const left = state.reg[rm] ?? 0n;
          const right = state.reg[reg] ?? 0n;
          if (rexW) {
            markLogic(state, left & right);
          } else {
            markLogicWidth(state, left & right, 32);
          }
          state.rip = source.at;
          return "cont";
        }
        /* F7 /2 是按位取反，不改标志。/3 是取负，标志按从 0 减去原值。其它 reg 和内存形式失败。 */
        if (opcode === 0xf7) {
          const modrm = source.take();
          if (modrm === null || (modrm >> 6) !== 3 || rexR) {
            return "fault";
          }
          const operation = (modrm >> 3) & 7;
          const rm = (modrm & 7) + (rexB ? 8 : 0);
          const left = state.reg[rm] ?? 0n;
          if (operation === 2) {
            state.reg[rm] = rexW ? wrap(~left) : (~(left & 0xffffffffn)) & 0xffffffffn;
            state.rip = source.at;
            return "cont";
          }
          if (operation === 3) {
            if (rexW) {
              const result = wrap(0n - left);
              markSub(state, 0n, left, result);
              state.reg[rm] = result;
            } else {
              const low = left & 0xffffffffn;
              const result = (0n - low) & 0xffffffffn;
              markSubWidth(state, 0n, low, 32);
              state.reg[rm] = result;
            }
            state.rip = source.at;
            return "cont";
          }
          return "fault";
        }
        /* C7 /0 把 32 位立即数写入 r/m。有 W 时按符号扩成 64 位。没有 W 时只写 32 位并零扩展。不改标志。 */
        if (opcode === 0xc7) {
          const modrm = source.take();
          if (modrm === null || rexR || ((modrm >> 3) & 7) !== 0) {
            return "fault";
          }
          const mod = modrm >> 6;
          const rmLow = modrm & 7;
          let bit: bigint | null = null;
          let regIndex = -1;
          if (mod === 3) {
            regIndex = rmLow + (rexB ? 8 : 0);
          } else {
            const mem = parseMem(source, mod, rmLow, rexB, rexX);
            if (mem === null) {
              return "fault";
            }
            const address = octetAddress(state, mem, mem.ripRelative ? source.at + 32n : source.at);
            if (address === null) {
              return "fault";
            }
            bit = operandBit(state, mem, address);
            if (bit === null) {
              return "fault";
            }
          }
          const raw = readImm(port, source.at, 4);
          if (raw === null) {
            return "fault";
          }
          const extended = raw >= 0x80000000n ? raw - 0x100000000n : raw;
          const value = rexW ? wrap(extended) : raw;
          if (regIndex >= 0) {
            state.reg[regIndex] = value;
          } else if (bit === null || !(rexW ? writeImm(port, bit, value) : writeCount(port, bit, value, 4))) {
            return "fault";
          }
          state.rip = source.at + 32n;
          return "cont";
        }
        /* 63 是 movsxd。只登记带 W 的寄存器形式：源的低 32 位按符号扩到目的寄存器。 */
        if (opcode === 0x63) {
          if (!rexW) {
            return "fault";
          }
          const modrm = source.take();
          if (modrm === null || (modrm >> 6) !== 3) {
            return "fault";
          }
          const dest = ((modrm >> 3) & 7) + (rexR ? 8 : 0);
          const src = (modrm & 7) + (rexB ? 8 : 0);
          const low = (state.reg[src] ?? 0n) & 0xffffffffn;
          const extended = low >= 0x80000000n ? low - 0x100000000n : low;
          state.reg[dest] = wrap(extended);
          state.rip = source.at;
          return "cont";
        }
        const alu = opcode === 0x01 || opcode === 0x03 || opcode === 0x29 || opcode === 0x2b
          || opcode === 0x09 || opcode === 0x0b || opcode === 0x21 || opcode === 0x23
          || opcode === 0x31 || opcode === 0x33 || opcode === 0x39 || opcode === 0x3b
          || opcode === 0x89 || opcode === 0x8b || opcode === 0x8d;
        if (opcode === 0x05 || opcode === 0x0d || opcode === 0x25 || opcode === 0x2d || opcode === 0x35 || opcode === 0x3d) {
          const raw = readImm(port, source.at, 4);
          if (raw === null) {
            return "fault";
          }
          const imm = rexW ? wrap(raw >= 0x80000000n ? raw - 0x100000000n : raw) : raw;
          const full = state.reg[NativeRax] ?? 0n;
          const left = rexW ? full : full & 0xffffffffn;
          if (opcode === 0x3d) {
            if (rexW) {
              markSub(state, left, imm, wrap(left - imm));
            } else {
              markSubWidth(state, left, imm, 32);
            }
          } else if (opcode === 0x05 || opcode === 0x2d) {
            const adding = opcode === 0x05;
            const result = rexW
              ? wrap(adding ? left + imm : left - imm)
              : ((adding ? left + imm : left - imm) & 0xffffffffn);
            if (rexW) {
              if (adding) {
                markAdd(state, left, imm, result);
              } else {
                markSub(state, left, imm, result);
              }
            } else if (adding) {
              markAddWidth(state, left, imm, 32);
            } else {
              markSubWidth(state, left, imm, 32);
            }
            state.reg[NativeRax] = result;
          } else {
            const result = opcode === 0x0d ? left | imm : opcode === 0x25 ? left & imm : left ^ imm;
            const stored = rexW ? wrap(result) : result & 0xffffffffn;
            if (rexW) {
              markLogic(state, stored);
            } else {
              markLogicWidth(state, stored, 32);
            }
            state.reg[NativeRax] = stored;
          }
          state.rip = source.at + 32n;
          return "cont";
        }
        if (!alu) {
          return "fault";
        }
        const modrm = source.take();
        if (modrm === null) {
          return "fault";
        }
        const mod = modrm >> 6;
        const reg = ((modrm >> 3) & 7) + (rexR ? 8 : 0);
        const rmLow = modrm & 7;
        if (operand16 && (opcode === 0x89 || opcode === 0x8b)) {
          const merge16 = (index: number, value: bigint): void => {
            const full = state.reg[index] ?? 0n;
            state.reg[index] = (full & ~0xffffn) | (value & 0xffffn);
          };
          if (mod === 3) {
            const rm = rmLow + (rexB ? 8 : 0);
            const sourceReg = opcode === 0x89 ? reg : rm;
            const destReg = opcode === 0x89 ? rm : reg;
            merge16(destReg, state.reg[sourceReg] ?? 0n);
            state.rip = source.at;
            return "cont";
          }
          const narrow = parseMem(source, mod, rmLow, rexB, rexX);
          if (narrow === null) {
            return "fault";
          }
          const narrowAddress = octetAddress(state, narrow, source.at);
          if (narrowAddress === null) {
            return "fault";
          }
          const narrowBit = operandBit(state, narrow, narrowAddress);
          if (narrowBit === null) {
            return "fault";
          }
          if (opcode === 0x8b) {
            const loaded = readImm(port, narrowBit, 2);
            if (loaded === null) {
              return "fault";
            }
            merge16(reg, loaded);
          } else if (!writeCount(port, narrowBit, (state.reg[reg] ?? 0n) & 0xffffn, 2)) {
            return "fault";
          }
          state.rip = source.at;
          return "cont";
        }
        const word32 = opcode === 0x09 || opcode === 0x0b || opcode === 0x21 || opcode === 0x23
          || opcode === 0x31 || opcode === 0x33 || opcode === 0x39 || opcode === 0x3b
          || opcode === 0x89 || opcode === 0x8b;
        if (mod === 3) {
          const rm = rmLow + (rexB ? 8 : 0);
          if (opcode === 0x8d) {
            return "fault";
          }
          if (!rexW) {
            if (!word32 || !applyWord32(state, opcode, reg, rm)) {
              return "fault";
            }
            state.rip = source.at;
            return "cont";
          }
          if (!applyReg(state, opcode, reg, rm)) {
            return "fault";
          }
          state.rip = source.at;
          return "cont";
        }
        if (!rexW && opcode !== 0x8d) {
          if (opcode !== 0x89 && opcode !== 0x8b) {
            return "fault";
          }
          const narrow = parseMem(source, mod, rmLow, rexB, rexX);
          if (narrow === null) {
            return "fault";
          }
          const narrowAddress = octetAddress(state, narrow, source.at);
          if (narrowAddress === null) {
            return "fault";
          }
          const narrowBit = operandBit(state, narrow, narrowAddress);
          if (narrowBit === null) {
            return "fault";
          }
          if (opcode === 0x8b) {
            const loaded = readImm(port, narrowBit, 4);
            if (loaded === null) {
              return "fault";
            }
            state.reg[reg] = loaded & 0xffffffffn;
          } else if (!writeCount(port, narrowBit, (state.reg[reg] ?? 0n) & 0xffffffffn, 4)) {
            return "fault";
          }
          state.rip = source.at;
          return "cont";
        }
        const mem = parseMem(source, mod, rmLow, rexB, rexX);
        if (mem === null) {
          return "fault";
        }
        const address = octetAddress(state, mem, source.at);
        if (address === null) {
          return "fault";
        }
        if (opcode === 0x8d) {
          /* lea 只算地址。0 和页 0 是合法的指针值，访存时才检查下界。 */
          const value = state.compat && mem.ripRelative ? address - compatOrigin / 8n : address;
          const stored = wrap(value);
          state.reg[reg] = rexW ? stored : stored & 0xffffffffn;
          state.rip = source.at;
          return "cont";
        }
        const bit = operandBit(state, mem, address);
        if (bit === null || !applyMem(state, port, opcode, reg, bit)) {
          return "fault";
        }
        state.rip = source.at;
        return "cont";
      }

      /**
       * 没有 REX.W 的 32 位寄存器异或和传送。
       * 只取两边的低 32 位，结果零扩展。传送不改标志。异或的 SF 看第 31 位。
       */
      function applyWord32(state: NativeState, opcode: number, reg: number, rm: number): boolean {
        const mask = 0xffffffffn;
        const left = (state.reg[rm] ?? 0n) & mask;
        const right = (state.reg[reg] ?? 0n) & mask;
        if (opcode === 0x09 || opcode === 0x0b || opcode === 0x21 || opcode === 0x23) {
          const both = opcode === 0x21 || opcode === 0x23 ? left & right : left | right;
          const dest = opcode === 0x09 || opcode === 0x21 ? rm : reg;
          state.reg[dest] = both;
          markLogicWidth(state, both, 32);
          return true;
        }
        if (opcode === 0x31 || opcode === 0x33) {
          const result = left ^ right;
          const dest = opcode === 0x31 ? rm : reg;
          state.reg[dest] = result;
          markLogicWidth(state, result, 32);
          return true;
        }
        if (opcode === 0x39 || opcode === 0x3b) {
          if (opcode === 0x39) {
            markSubWidth(state, left, right, 32);
          } else {
            markSubWidth(state, right, left, 32);
          }
          return true;
        }
        if (opcode === 0x89 || opcode === 0x8b) {
          const dest = opcode === 0x89 ? rm : reg;
          state.reg[dest] = opcode === 0x89 ? right : left;
          return true;
        }
        return false;
      }

      function applyReg(state: NativeState, opcode: number, reg: number, rm: number): boolean {
        const left = state.reg[rm] ?? 0n;
        const right = state.reg[reg] ?? 0n;
        if (opcode === 0x01) {
          const result = wrap(left + right);
          markAdd(state, left, right, result);
          state.reg[rm] = result;
          return true;
        }
        if (opcode === 0x03) {
          const result = wrap(right + left);
          markAdd(state, right, left, result);
          state.reg[reg] = result;
          return true;
        }
        if (opcode === 0x29) {
          const result = wrap(left - right);
          markSub(state, left, right, result);
          state.reg[rm] = result;
          return true;
        }
        if (opcode === 0x2b) {
          const result = wrap(right - left);
          markSub(state, right, left, result);
          state.reg[reg] = result;
          return true;
        }
        if (opcode === 0x21) {
          const result = wrap(left & right);
          markLogic(state, result);
          state.reg[rm] = result;
          return true;
        }
        if (opcode === 0x23) {
          const result = wrap(right & left);
          markLogic(state, result);
          state.reg[reg] = result;
          return true;
        }
        if (opcode === 0x09) {
          const result = wrap(left | right);
          markLogic(state, result);
          state.reg[rm] = result;
          return true;
        }
        if (opcode === 0x0b) {
          const result = wrap(right | left);
          markLogic(state, result);
          state.reg[reg] = result;
          return true;
        }
        if (opcode === 0x31) {
          const result = wrap(left ^ right);
          markLogic(state, result);
          state.reg[rm] = result;
          return true;
        }
        if (opcode === 0x33) {
          const result = wrap(right ^ left);
          markLogic(state, result);
          state.reg[reg] = result;
          return true;
        }
        if (opcode === 0x39) {
          markSub(state, left, right, wrap(left - right));
          return true;
        }
        if (opcode === 0x3b) {
          markSub(state, right, left, wrap(right - left));
          return true;
        }
        if (opcode === 0x89) {
          state.reg[rm] = right;
          return true;
        }
        if (opcode === 0x8b) {
          state.reg[reg] = left;
          return true;
        }
        return false;
      }

      function applyMem(state: NativeState, port: NativeOctetPort, opcode: number, reg: number, bit: bigint): boolean {
        const fromReg = state.reg[reg] ?? 0n;
        const writing = opcode === 0x01 || opcode === 0x09 || opcode === 0x21 || opcode === 0x29 || opcode === 0x31 || opcode === 0x89;
        if (writing) {
          const current = readImm(port, bit, 8);
          if (current === null) {
            return false;
          }
          if (opcode === 0x89) {
            return writeImm(port, bit, fromReg);
          }
          const result = opcode === 0x01
            ? wrap(current + fromReg)
            : opcode === 0x29
              ? wrap(current - fromReg)
              : opcode === 0x21
                ? wrap(current & fromReg)
                : opcode === 0x09
                  ? wrap(current | fromReg)
                  : wrap(current ^ fromReg);
          if (!writeImm(port, bit, result)) {
            return false;
          }
          if (opcode === 0x01) {
            markAdd(state, current, fromReg, result);
          } else if (opcode === 0x29) {
            markSub(state, current, fromReg, result);
          } else {
            markLogic(state, result);
          }
          return true;
        }
        const current = readImm(port, bit, 8);
        if (current === null) {
          return false;
        }
        if (opcode === 0x03) {
          const result = wrap(fromReg + current);
          markAdd(state, fromReg, current, result);
          state.reg[reg] = result;
          return true;
        }
        if (opcode === 0x2b) {
          const result = wrap(fromReg - current);
          markSub(state, fromReg, current, result);
          state.reg[reg] = result;
          return true;
        }
        if (opcode === 0x0b || opcode === 0x23 || opcode === 0x33) {
          const result = opcode === 0x23
            ? wrap(fromReg & current)
            : opcode === 0x0b
              ? wrap(fromReg | current)
              : wrap(fromReg ^ current);
          markLogic(state, result);
          state.reg[reg] = result;
          return true;
        }
        if (opcode === 0x3b) {
          markSub(state, fromReg, current, wrap(fromReg - current));
          return true;
        }
        if (opcode === 0x8b) {
          state.reg[reg] = current;
          return true;
        }
        if (opcode === 0x39) {
          markSub(state, current, fromReg, wrap(current - fromReg));
          return true;
        }
        return false;
      }
    }
  }
}
