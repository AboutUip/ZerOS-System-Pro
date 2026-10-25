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
import type { ZerOS as StateRoot } from "../Structure/NativeState";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      const NativeRsp = RegisterRoot.Hardware.Cpu.NativeRsp;
      const nativeEscapeArity = EscapeRoot.Hardware.Cpu.nativeEscapeArity;
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
        const bits = wrap(result);
        state.cf = false;
        state.of = false;
        state.zf = bits === 0n;
        state.sf = bits >= signBit;
        state.pf = parity(bits);
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

      function readImm(port: NativeOctetPort, bit: bigint, count: number): bigint | null {
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
      const reusedReader: Reader = {
        at: 0n,
        take(): number | null {
          const port = readerPort;
          if (port === null) {
            return null;
          }
          const value = readOctet(port, this.at);
          if (value === null) {
            return null;
          }
          this.at += 8n;
          return value;
        },
      };

      function reader(port: NativeOctetPort, rip: bigint): Reader {
        readerPort = port;
        reusedReader.at = rip;
        return reusedReader;
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

      function pushValue(state: NativeState, port: NativeOctetPort, value: bigint): boolean {
        const rsp = state.reg[NativeRsp] ?? 0n;
        if (rsp < 8n) {
          return false;
        }
        const next = rsp - 8n;
        if (!writeImm(port, next * 8n, value)) {
          return false;
        }
        state.reg[NativeRsp] = next;
        return true;
      }

      function popValue(state: NativeState, port: NativeOctetPort): bigint | null {
        const rsp = state.reg[NativeRsp] ?? 0n;
        const value = readImm(port, rsp * 8n, 8);
        if (value === null) {
          return null;
        }
        state.reg[NativeRsp] = rsp + 8n;
        return value;
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
       * 做一条。0F 3F 不在这里产生副作用，调用方拿到 escape 后再做。
       * 失败和 escape 都不改指令指针。
       */
      export function stepNative(state: NativeState, port: NativeOctetPort): NativeStep {
        const source = reader(port, state.rip);
        const first = source.take();
        if (first === null) {
          return "fault";
        }
        let opcode = first;
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
        const rexR = (rex & 0x04) !== 0;
        const rexX = (rex & 0x02) !== 0;
        const rexB = (rex & 0x01) !== 0;
        if (opcode === 0xf4) {
          state.rip = source.at;
          return "halt";
        }
        if (opcode === 0xc3) {
          const back = popValue(state, port);
          if (back === null) {
            return "fault";
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
          if (opcode === 0xe8 && !pushValue(state, port, next)) {
            return "fault";
          }
          state.rip = next + rel * 8n;
          return "cont";
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
          const rel = disp32(source);
          if (rel === null || (second !== 0x84 && second !== 0x85)) {
            return "fault";
          }
          const take = second === 0x84 ? state.zf : !state.zf;
          state.rip = take ? source.at + rel * 8n : source.at;
          return "cont";
        }
        if (opcode >= 0xb8 && opcode <= 0xbf) {
          if (!rexW) {
            return "fault";
          }
          const dest = (opcode & 7) + (rexB ? 8 : 0);
          const imm = readImm(port, source.at, 8);
          if (imm === null) {
            return "fault";
          }
          state.reg[dest] = imm;
          state.rip = source.at + 64n;
          return "cont";
        }
        if (opcode === 0x83) {
          if (!rexW) {
            return "fault";
          }
          const modrm = source.take();
          const immRaw = source.take();
          if (modrm === null || immRaw === null || (modrm >> 6) !== 3) {
            return "fault";
          }
          const operation = (modrm >> 3) & 7;
          const rm = (modrm & 7) + (rexB ? 8 : 0);
          const left = state.reg[rm] ?? 0n;
          const imm = wrap(BigInt(immRaw < 128 ? immRaw : immRaw - 256));
          if (operation === 0) {
            const result = wrap(left + imm);
            markAdd(state, left, imm, result);
            state.reg[rm] = result;
          } else if (operation === 5) {
            const result = wrap(left - imm);
            markSub(state, left, imm, result);
            state.reg[rm] = result;
          } else if (operation === 7) {
            markSub(state, left, imm, wrap(left - imm));
          } else {
            return "fault";
          }
          state.rip = source.at;
          return "cont";
        }
        const alu = opcode === 0x01 || opcode === 0x03 || opcode === 0x29 || opcode === 0x2b
          || opcode === 0x31 || opcode === 0x33 || opcode === 0x39 || opcode === 0x3b
          || opcode === 0x89 || opcode === 0x8b || opcode === 0x8d;
        if (!alu) {
          return "fault";
        }
        if (!rexW) {
          return "fault";
        }
        const modrm = source.take();
        if (modrm === null) {
          return "fault";
        }
        const mod = modrm >> 6;
        const reg = ((modrm >> 3) & 7) + (rexR ? 8 : 0);
        const rmLow = modrm & 7;
        if (mod === 3) {
          const rm = rmLow + (rexB ? 8 : 0);
          if (opcode === 0x8d) {
            return "fault";
          }
          if (!applyReg(state, opcode, reg, rm)) {
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
          state.reg[reg] = wrap(address);
          state.rip = source.at;
          return "cont";
        }
        if (!applyMem(state, port, opcode, reg, address)) {
          return "fault";
        }
        state.rip = source.at;
        return "cont";
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

      function applyMem(state: NativeState, port: NativeOctetPort, opcode: number, reg: number, address: bigint): boolean {
        const fromReg = state.reg[reg] ?? 0n;
        const writing = opcode === 0x01 || opcode === 0x29 || opcode === 0x31 || opcode === 0x89;
        if (writing) {
          const current = readImm(port, address * 8n, 8);
          if (current === null) {
            return false;
          }
          if (opcode === 0x89) {
            return writeImm(port, address * 8n, fromReg);
          }
          const result = opcode === 0x01 ? wrap(current + fromReg) : opcode === 0x29 ? wrap(current - fromReg) : wrap(current ^ fromReg);
          if (!writeImm(port, address * 8n, result)) {
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
        const current = readImm(port, address * 8n, 8);
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
        if (opcode === 0x33) {
          const result = wrap(fromReg ^ current);
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
