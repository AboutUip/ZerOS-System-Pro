/**
 * @module ZerOS.Hardware.Cpu.NativeFetchCheck
 * @description 核对原生指令按位地址取指
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 用 §4.12 的真实编码跑 16 个寄存器、五种标志、SIB 与相对指令指针、
 * call/ret、压栈，以及未登记前缀和窗口边缘的失败。
 * 0F 3E、REX.W 0x83、32 位异或与传送、movsxd、0F 3F 0x14 到 0x1D 的长度，以及 ZNB1 文件头也在这里核对。
 * 不经过 ZAP 指令数组。16 字节对齐和被调用方保存是约定，CPU 不检查。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. runNativeFetchCheck
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as NativeHeaderRoot } from "../Native/NativeHeader";
import { ZerOS as NativeRoot } from "../Native/NativeRun";
import { ZerOS as StateRoot } from "../Structure/NativeState";
import { ZerOS as CompatRoot } from "../Structure/CompatFrame";
import { ZerOS as RegisterRoot } from "../Enum/NativeRegister";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      const runNative = NativeRoot.Hardware.Cpu.runNative;
      const nativeCodeBytes = NativeHeaderRoot.Hardware.Cpu.nativeCodeBytes;
      const freshNativeState = StateRoot.Hardware.Cpu.freshNativeState;
      const CompatTailOrigin = CompatRoot.Hardware.Cpu.CompatTailOrigin;
      const NativeRax = RegisterRoot.Hardware.Cpu.NativeRax;
      const NativeRcx = RegisterRoot.Hardware.Cpu.NativeRcx;
      const NativeRdx = RegisterRoot.Hardware.Cpu.NativeRdx;
      const NativeRbx = RegisterRoot.Hardware.Cpu.NativeRbx;
      const NativeRsp = RegisterRoot.Hardware.Cpu.NativeRsp;
      const NativeRbp = RegisterRoot.Hardware.Cpu.NativeRbp;
      const NativeRsi = RegisterRoot.Hardware.Cpu.NativeRsi;
      const NativeRdi = RegisterRoot.Hardware.Cpu.NativeRdi;
      const NativeR8 = RegisterRoot.Hardware.Cpu.NativeR8;
      const NativeR9 = RegisterRoot.Hardware.Cpu.NativeR9;
      const NativeR14 = RegisterRoot.Hardware.Cpu.NativeR14;
      const NativeR15 = RegisterRoot.Hardware.Cpu.NativeR15;
      const checkPrefix = "[ZerOS.Hardware.Cpu.NativeFetchCheck]";

      function fail(message: string): never {
        throw new Error(`${checkPrefix} ${message}`);
      }

      function octetsFrom(bytes: number[]): Uint8Array {
        const image = new Uint8Array(1024);
        image.set(bytes, 0);
        return image;
      }

      function execute(bytes: readonly number[], state: ReturnType<typeof freshNativeState>, limit: number): {
        kind: string;
        state: ReturnType<typeof freshNativeState>;
        image: Uint8Array;
      } {
        const image = octetsFrom([...bytes]);
        const stopped = runNative(state, portOf(image), limit);
        return { kind: stopped.kind, state: stopped.state, image };
      }

      function fresh(rsp: bigint): ReturnType<typeof freshNativeState> {
        const state = freshNativeState(0n);
        state.reg[NativeRsp] = rsp;
        return state;
      }

      function reg(state: ReturnType<typeof freshNativeState>, index: number): bigint {
        return state.reg[index] ?? 0n;
      }

      function portOf(image: Uint8Array): StateRoot.Hardware.Cpu.NativeOctetPort {
        return {
          limitBit: BigInt(image.length) * 8n,
          load(bit: bigint): number {
            return image[Number(bit / 8n)] ?? 0;
          },
          store(bit: bigint, value: number): void {
            image[Number(bit / 8n)] = value;
          },
        };
      }

      /**
       * 在核心调度之前调用。这里只使用自己的八位组数组，不碰已挂载核心。
       */
      export function runNativeFetchCheck(): void {
        checkCall();
        checkAddress();
        checkJump();
        checkStack();
        checkFlags();
        checkReject();
        checkRegisters();
        checkFlagSet();
        checkModes();
        checkMemory();
        checkCallEdges();
        checkWide();
        checkImm8();
        checkWord32();
        checkCompatLea();
        checkStos();
        checkStep();
        checkByte();
        checkHeader();
      }

      function movImm(reg: number, value: bigint): number[] {
        const rex = reg < 8 ? 0x48 : 0x49;
        const bytes = [rex, 0xb8 + (reg & 7)];
        let rest = value & ((1n << 64n) - 1n);
        for (let index = 0; index < 8; index += 1) {
          bytes.push(Number(rest & 0xffn));
          rest >>= 8n;
        }
        return bytes;
      }

      function wide(opcode: number, dest: number, left: number, right: number): number[] {
        return [0x0f, 0x3e, opcode, dest, left, right];
      }

      /**
       * 0F 3E 是六字节。比较只写 0 或 1，不改标志。除零和移位越界不写目的寄存器。
       * 没有核心时，0F 3F 即使操作数已经齐，也不改寄存器和指令指针。
       */
      function checkWide(): void {
        const byte = execute([
          ...movImm(0, 2048n),
          ...movImm(1, 0x80n),
          ...wide(0x23, 1, 0, 0),
          ...wide(0x22, 2, 0, 0),
          0xf4,
        ], freshNativeState(0n), 8);
        if (byte.kind !== "halt" || reg(byte.state, NativeRdx) !== (1n << 64n) - 128n || byte.image[256] !== 0x80) {
          fail("a byte load did not sign-extend");
        }
        const word = execute([
          ...movImm(0, 2048n),
          ...movImm(1, 42n),
          ...wide(0x21, 1, 0, 0),
          ...wide(0x20, 8, 0, 0),
          0xf4,
        ], freshNativeState(0n), 8);
        if (word.kind !== "halt" || reg(word.state, NativeR8) !== 42n || word.image[256] !== 42) {
          fail("a 64-bit store and load did not round-trip");
        }
        const skewed = execute([
          ...movImm(0, 2052n),
          ...movImm(1, 7n),
          ...wide(0x21, 1, 0, 0),
          0xf4,
        ], freshNativeState(0n), 8);
        if (skewed.kind !== "fault" || skewed.state.rip !== 160n || reg(skewed.state, NativeRcx) !== 7n || skewed.image[256] !== 0) {
          fail("an unaligned bit address still wrote");
        }
        const cutState = freshNativeState(0n);
        cutState.reg[NativeRax] = 9n;
        const cut = runNative(cutState, portOf(new Uint8Array([0x0f, 0x3e, 0x01, 0x00])), 4);
        if (cut.kind !== "fault" || cut.state.rip !== 0n || reg(cut.state, NativeRax) !== 9n) {
          fail("a truncated 0F 3E still wrote rax");
        }
        const divided = execute([
          ...movImm(0, 10n),
          ...movImm(1, 0n),
          ...movImm(2, 9n),
          ...wide(0x07, 2, 0, 1),
        ], freshNativeState(0n), 8);
        if (divided.kind !== "fault" || divided.state.rip !== 240n || reg(divided.state, NativeRdx) !== 9n) {
          fail("division by zero still wrote the destination");
        }
        const shifted = execute([
          ...movImm(0, 1n),
          ...movImm(1, 64n),
          ...movImm(2, 9n),
          ...wide(0x0b, 2, 0, 1),
        ], freshNativeState(0n), 8);
        if (shifted.kind !== "fault" || reg(shifted.state, NativeRdx) !== 9n || shifted.state.rip !== 240n) {
          fail("a shift of 64 still wrote the destination");
        }
        const moved = execute([
          ...movImm(0, 1n),
          ...movImm(1, 3n),
          ...wide(0x0b, 0, 0, 1),
          0xf4,
        ], freshNativeState(0n), 8);
        if (moved.kind !== "halt" || reg(moved.state, NativeRax) !== 8n || moved.state.cf || moved.state.of || moved.state.zf) {
          fail("shl did not shift by the count and clear carry");
        }
        const same = execute([
          0x48, 0x31, 0xc0,
          ...movImm(1, 1n),
          ...movImm(2, 1n),
          ...wide(0x0d, 0, 1, 2),
          0xf4,
        ], freshNativeState(0n), 8);
        if (same.kind !== "halt" || reg(same.state, NativeRax) !== 1n || !same.state.zf) {
          fail("eq wrote a flag or the wrong bit");
        }
        const product = execute([
          0x48, 0x31, 0xc0,
          ...movImm(0, 2n),
          ...movImm(1, 3n),
          ...wide(0x06, 0, 0, 1),
          0xf4,
        ], freshNativeState(0n), 8);
        if (product.kind !== "halt" || reg(product.state, NativeRax) !== 6n || !product.state.zf) {
          fail("mul updated flags");
        }
        const inverted = execute([
          ...movImm(0, 0n),
          ...wide(0x12, 0, 0, 1),
          0xf4,
        ], freshNativeState(0n), 4);
        if (inverted.kind !== "halt" || reg(inverted.state, NativeRax) !== (1n << 64n) - 1n) {
          fail("not did not invert every bit");
        }
        const floated = execute([
          ...movImm(0, 42n),
          ...wide(0x13, 1, 0, 0),
          0xf4,
        ], freshNativeState(0n), 4);
        if (floated.kind !== "halt" || reg(floated.state, NativeRcx) !== 0x4045000000000000n) {
          fail("itof did not convert 42");
        }
        const added = execute([
          ...movImm(0, 0x3ff0000000000000n),
          ...movImm(1, 0x4000000000000000n),
          ...wide(0x14, 2, 0, 1),
          0xf4,
        ], freshNativeState(0n), 8);
        if (added.kind !== "halt" || reg(added.state, NativeRdx) !== 0x4008000000000000n) {
          fail("fadd did not add 1 and 2");
        }
        const zero = freshNativeState(0n);
        zero.reg[NativeRdx] = 4n;
        const split = execute([
          ...movImm(0, 0x3ff0000000000000n),
          ...movImm(1, 0n),
          ...wide(0x17, 2, 0, 1),
        ], zero, 8);
        if (split.kind !== "fault" || split.state.rip !== 160n || reg(split.state, NativeRdx) !== 4n) {
          fail("fdiv by zero still wrote the destination");
        }
        const nan = 0x7ff8000000000000n;
        const unordered = execute([
          ...movImm(0, 1n),
          0x48, 0x01, 0xc0,
          ...movImm(0, nan),
          ...movImm(1, nan),
          ...wide(0x1a, 2, 0, 1),
          0xf4,
        ], freshNativeState(0n), 8);
        if (unordered.kind !== "halt" || reg(unordered.state, NativeRdx) !== 0n || unordered.state.zf) {
          fail("feq treated NaN as equal or updated ZF");
        }
        const unsigned = execute([
          ...movImm(0, (1n << 64n) - 1n),
          ...movImm(1, 1n),
          ...movImm(2, 9n),
          ...wide(0x09, 2, 0, 1),
        ], freshNativeState(0n), 8);
        if (unsigned.kind !== "fault" || reg(unsigned.state, NativeRdx) !== 9n) {
          fail("udiv of a negative value still wrote the destination");
        }
        const escapeState = freshNativeState(0n);
        escapeState.reg[NativeRax] = 9n;
        const shortEscape = runNative(escapeState, portOf(new Uint8Array([0x0f, 0x3f, 0x14, 0x00])), 4);
        if (shortEscape.kind !== "fault" || shortEscape.state.rip !== 0n || reg(shortEscape.state, NativeRax) !== 9n) {
          fail("a truncated xchg escape still changed a register");
        }
        const fullEscape = runNative(escapeState, portOf(new Uint8Array([0x0f, 0x3f, 0x14, 0x00, 0x01, 0x02])), 4);
        if (fullEscape.kind !== "fault" || fullEscape.state.rip !== 0n || reg(fullEscape.state, NativeRax) !== 9n) {
          fail("xchg ran without a core");
        }
        const dwell = runNative(escapeState, portOf(new Uint8Array([0x0f, 0x3f, 0x1b, 0x00])), 4);
        if (dwell.kind !== "fault" || dwell.state.rip !== 0n || reg(dwell.state, NativeRax) !== 9n) {
          fail("dwell ran without a core");
        }
        const unknownEscape = runNative(escapeState, portOf(new Uint8Array([0x0f, 0x3f, 0x1e])), 4);
        if (unknownEscape.kind !== "fault" || unknownEscape.state.rip !== 0n || reg(unknownEscape.state, NativeRax) !== 9n) {
          fail("an unknown escape still changed a register");
        }
      }

      /** REX.W 0x83 的寄存器形式：加、或、与、减、异或、比较。立即数按八位符号扩展。 */
      function checkImm8(): void {
        const adjusted = execute([
          ...movImm(0, 20n),
          0x48, 0x83, 0xc0, 0xf8,
          0x48, 0x83, 0xe8, 0x01,
          0x48, 0x83, 0xf8, 0x0b,
          0xf4,
        ], freshNativeState(0n), 8);
        if (adjusted.kind !== "halt" || reg(adjusted.state, NativeRax) !== 11n || !adjusted.state.zf || adjusted.state.cf) {
          fail("opcode 83 did not add, subtract, and compare an imm8");
        }
        const bare = freshNativeState(0n);
        bare.reg[NativeRax] = (1n << 40n) | 5n;
        const withoutRex = execute([0x83, 0xc0, 0x01, 0xf4], bare, 4);
        if (withoutRex.kind !== "halt" || reg(withoutRex.state, NativeRax) !== 6n) {
          fail("32-bit add eax, 1 kept the high half");
        }
        const compared = freshNativeState(0n);
        compared.reg[NativeRsi] = (1n << 40n) | 1n;
        const cmpEsi = execute([0x83, 0xfe, 0x06, 0xf4], compared, 4);
        if (cmpEsi.kind !== "halt" || reg(cmpEsi.state, NativeRsi) !== ((1n << 40n) | 1n) || !cmpEsi.state.cf || cmpEsi.state.zf) {
          fail("cmp esi, 6 wrote rsi or missed CF");
        }
        const other = freshNativeState(0n);
        other.reg[NativeRax] = 5n;
        const rejected = runNative(other, portOf(new Uint8Array([0x48, 0x83, 0xd0, 0x01])), 4);
        if (rejected.kind !== "fault" || rejected.state.rip !== 0n || reg(rejected.state, NativeRax) !== 5n) {
          fail("opcode 83 with /2 still wrote rax");
        }
        const memory = freshNativeState(0n);
        memory.reg[NativeRax] = 5n;
        const indirect = runNative(memory, portOf(new Uint8Array([0x48, 0x83, 0x00, 0x01])), 4);
        if (indirect.kind !== "fault" || indirect.state.rip !== 0n || reg(indirect.state, NativeRax) !== 5n) {
          fail("opcode 83 wrote past the end of memory");
        }
        const slot = new Uint8Array(32);
        slot[0] = 0x48;
        slot[1] = 0x83;
        slot[2] = 0x00;
        slot[3] = 0x01;
        slot[4] = 0xf4;
        const added = freshNativeState(0n);
        added.reg[NativeRax] = 16n;
        const memoryAdd = runNative(added, portOf(slot), 4);
        if (memoryAdd.kind !== "halt" || slot[16] !== 1 || slot[17] !== 0 || reg(memoryAdd.state, NativeRax) !== 16n || memoryAdd.state.zf) {
          fail("add qword [rax], 1 did not store one byte");
        }
        const comparedMem = freshNativeState(0n);
        comparedMem.reg[NativeRsp] = 16n;
        const stackCmp = execute([0x48, 0x83, 0x7c, 0x24, 0x08, 0x00, 0xf4], comparedMem, 4);
        if (stackCmp.kind !== "halt" || !stackCmp.state.zf || stackCmp.state.cf || reg(stackCmp.state, NativeRsp) !== 16n) {
          fail("cmp qword [rsp+8], 0 missed ZF");
        }
        const aligned = freshNativeState(0n);
        aligned.reg[NativeRsp] = 16772097n;
        const masked = execute([0x48, 0x83, 0xe4, 0xf0, 0xf4], aligned, 4);
        if (masked.kind !== "halt" || reg(masked.state, NativeRsp) !== 16772096n || masked.state.zf || masked.state.cf || masked.state.of) {
          fail("and rsp, -16 did not clear the low bits");
        }
        const logic = execute([
          ...movImm(0, 0xf0n),
          0x48, 0x83, 0xc8, 0x0f,
          0x48, 0x83, 0xf0, 0x01,
          0xf4,
        ], freshNativeState(0n), 8);
        if (logic.kind !== "halt" || reg(logic.state, NativeRax) !== 0xfen || logic.state.zf || logic.state.cf || logic.state.of) {
          fail("opcode 83 did not or and xor an imm8");
        }
      }

      /**
       * 没有 REX.W 的异或和传送按 32 位做，结果零扩展。
       * movsxd 把低 32 位按符号扩到 64 位，不改标志。
       */
      function checkWord32(): void {
        const high = freshNativeState(0n);
        high.reg[NativeRax] = 0x100000001n;
        high.reg[NativeRbx] = 1n;
        const wideXor = execute([0x48, 0x31, 0xd8, 0xf4], high, 4);
        if (wideXor.kind !== "halt" || reg(wideXor.state, NativeRax) !== 0x100000000n || wideXor.state.zf || wideXor.state.sf) {
          fail("64-bit xor dropped the high half");
        }
        const low = freshNativeState(0n);
        low.reg[NativeRax] = 0x100000001n;
        low.reg[NativeRbx] = 1n;
        const narrowXor = execute([0x31, 0xd8, 0xf4], low, 4);
        if (narrowXor.kind !== "halt" || reg(narrowXor.state, NativeRax) !== 0n || !narrowXor.state.zf || narrowXor.state.sf || narrowXor.state.cf) {
          fail("32-bit xor left the high half or the wrong flags");
        }
        const sign = freshNativeState(0n);
        sign.reg[NativeRax] = (1n << 40n) | 0xffffffffn;
        sign.reg[NativeRbx] = 0x7fffffffn;
        const signed = execute([0x31, 0xd8, 0xf4], sign, 4);
        if (signed.kind !== "halt" || reg(signed.state, NativeRax) !== 0x80000000n || !signed.state.sf || signed.state.zf) {
          fail("32-bit xor did not take SF from bit 31");
        }
        const ninth = freshNativeState(0n);
        ninth.reg[NativeR9] = (1n << 40n) | 1n;
        const cleared = execute([0x45, 0x31, 0xc9, 0xf4], ninth, 4);
        if (cleared.kind !== "halt" || reg(cleared.state, NativeR9) !== 0n || !cleared.state.zf) {
          fail("xor r9d, r9d did not clear r9");
        }
        const moved = freshNativeState(0n);
        moved.reg[NativeR8] = (1n << 40n) | 9n;
        moved.zf = true;
        moved.sf = true;
        const imm = execute([0x41, 0xb8, 0x56, 0x98, 0x4d, 0x00, 0xf4], moved, 4);
        if (imm.kind !== "halt" || reg(imm.state, NativeR8) !== 0x4d9856n || !imm.state.zf || !imm.state.sf) {
          fail("mov r8d, imm32 changed the high half or the flags");
        }
        const ecx = freshNativeState(0n);
        ecx.reg[NativeRcx] = 1n << 40n;
        const loaded = execute([0xb9, 0x20, 0x01, 0x40, 0x00, 0xf4], ecx, 4);
        if (loaded.kind !== "halt" || reg(loaded.state, NativeRcx) !== 0x400120n || loaded.state.zf) {
          fail("mov ecx, imm32 did not zero-extend");
        }
        const copy = freshNativeState(0n);
        const frame = (1n << 40n) | 0xffffffffn;
        copy.reg[NativeRbp] = frame;
        copy.reg[NativeRsi] = 7n;
        copy.zf = true;
        const copied = execute([0x89, 0xee, 0xf4], copy, 4);
        if (copied.kind !== "halt" || reg(copied.state, NativeRsi) !== 0xffffffffn || reg(copied.state, NativeRbp) !== frame || !copied.state.zf) {
          fail("mov esi, ebp did not zero-extend");
        }
        const back = freshNativeState(0n);
        back.reg[NativeRbx] = (1n << 33n) | 0x11n;
        back.reg[NativeRax] = (1n << 64n) - 1n;
        const backed = execute([0x8b, 0xc3, 0xf4], back, 4);
        if (backed.kind !== "halt" || reg(backed.state, NativeRax) !== 0x11n) {
          fail("mov eax, ebx did not zero-extend");
        }
        const extend = freshNativeState(0n);
        const source = (1n << 40n) | 0xffffffffn;
        extend.reg[NativeRsi] = source;
        extend.zf = true;
        const extended = execute([0x48, 0x63, 0xc6, 0xf4], extend, 4);
        if (extended.kind !== "halt" || reg(extended.state, NativeRax) !== (1n << 64n) - 1n || !extended.state.zf || reg(extended.state, NativeRsi) !== source) {
          fail("movsxd did not sign-extend or it changed flags");
        }
        const positive = freshNativeState(0n);
        positive.reg[NativeRsi] = 0x7fffffffn;
        const plain = execute([0x48, 0x63, 0xc6, 0xf4], positive, 4);
        if (plain.kind !== "halt" || reg(plain.state, NativeRax) !== 0x7fffffffn || plain.state.sf) {
          fail("movsxd sign-extended a positive value");
        }
        const bare = freshNativeState(0n);
        bare.reg[NativeRax] = 9n;
        const without = runNative(bare, portOf(new Uint8Array([0x63, 0xc6])), 4);
        if (without.kind !== "fault" || without.state.rip !== 0n || reg(without.state, NativeRax) !== 9n) {
          fail("movsxd without REX.W still wrote rax");
        }
        const memory = freshNativeState(0n);
        memory.reg[NativeRax] = 9n;
        const indirect = runNative(memory, portOf(new Uint8Array([0x48, 0x63, 0x00])), 4);
        if (indirect.kind !== "fault" || indirect.state.rip !== 0n || reg(indirect.state, NativeRax) !== 9n) {
          fail("movsxd from memory still wrote rax");
        }
        const image = new Uint8Array(16);
        image[0] = 0x31;
        image[1] = 0x00;
        image[9] = 0x5a;
        const stored = freshNativeState(0n);
        stored.reg[NativeRax] = 9n;
        const memoryXor = runNative(stored, portOf(image), 4);
        if (memoryXor.kind !== "fault" || memoryXor.state.rip !== 0n || reg(memoryXor.state, NativeRax) !== 9n || image[9] !== 0x5a) {
          fail("32-bit xor to memory still ran");
        }
        const moveImage = new Uint8Array(16);
        moveImage[0] = 0x89;
        moveImage[1] = 0x00;
        moveImage[14] = 0x5a;
        moveImage[15] = 0x5a;
        const moveStored = freshNativeState(0n);
        moveStored.reg[NativeRax] = 14n;
        const memoryMove = runNative(moveStored, portOf(moveImage), 4);
        if (memoryMove.kind !== "fault" || memoryMove.state.rip !== 0n || reg(memoryMove.state, NativeRax) !== 14n || moveImage[14] !== 0x5a || moveImage[15] !== 0x5a) {
          fail("a short 32-bit store wrote a partial dword");
        }
        const prefix = freshNativeState(0n);
        prefix.reg[NativeRax] = (1n << 32n) | 1n;
        const operand = runNative(prefix, portOf(new Uint8Array([0x66, 0x31, 0xc0])), 4);
        if (operand.kind !== "fault" || operand.state.rip !== 0n || reg(operand.state, NativeRax) !== ((1n << 32n) | 1n)) {
          fail("a 0x66 prefix still ran as 32-bit xor");
        }
        const slot = new Uint8Array(32);
        slot[0] = 0x8b;
        slot[1] = 0x08;
        slot[2] = 0xf4;
        slot[16] = 0x78;
        slot[17] = 0x56;
        slot[18] = 0x34;
        slot[19] = 0x12;
        slot[20] = 0xff;
        const read = freshNativeState(0n);
        read.reg[NativeRax] = 16n;
        read.reg[NativeRcx] = (1n << 40n) | 1n;
        const narrowLoad = runNative(read, portOf(slot), 4);
        if (narrowLoad.kind !== "halt" || reg(narrowLoad.state, NativeRcx) !== 0x12345678n || reg(narrowLoad.state, NativeRax) !== 16n) {
          fail("mov ecx, [rax] did not zero-extend the dword");
        }
        const out = new Uint8Array(32);
        out[0] = 0x89;
        out[1] = 0x08;
        out[2] = 0xf4;
        out[20] = 0xaa;
        const write = freshNativeState(0n);
        write.reg[NativeRax] = 16n;
        write.reg[NativeRcx] = 0x1122334455667788n;
        const narrowStore = runNative(write, portOf(out), 4);
        if (narrowStore.kind !== "halt" || out[16] !== 0x88 || out[19] !== 0x55 || out[20] !== 0xaa || reg(narrowStore.state, NativeRcx) !== 0x1122334455667788n) {
          fail("mov [rax], ecx wrote more than four bytes");
        }
      }

      /**
       * 相对指令指针的 lea 可以算出 0。那是静态程序里的空动态段，不是访存。
       * 真正从 0 读取仍然失败。
       */
      function checkCompatLea(): void {
        const origin = CompatTailOrigin;
        const at = 0x2000;
        const program = [
          0x48, 0x8d, 0x35, 0xf9, 0xdf, 0xff, 0xff,
          0x48, 0x8d, 0x43, 0x64,
          0xf4,
        ];
        const port = {
          limitBit: origin + 0x3000n * 8n,
          load(bit: bigint): number {
            const index = Number((bit - origin) / 8n) - at;
            return program[index] ?? 0;
          },
          store(_bit: bigint, _value: number): void {
            fail("lea wrote memory");
          },
        };
        const state = freshNativeState(origin + BigInt(at) * 8n);
        state.compat = true;
        const stopped = runNative(state, port, 4);
        if (stopped.kind !== "halt" || reg(stopped.state, NativeRsi) !== 0n || reg(stopped.state, NativeRax) !== 100n) {
          fail("compat lea rejected an address below 4096");
        }
        const wide = freshNativeState(0n);
        wide.reg[NativeRsp] = 16772096n;
        const frame = execute([
          0x48, 0x81, 0xec, 0x50, 0x01, 0x00, 0x00,
          0x48, 0x81, 0xe8, 0xff, 0xff, 0xff, 0xff,
          0xf4,
        ], wide, 4);
        if (frame.kind !== "halt" || reg(frame.state, NativeRsp) !== 16771760n || reg(frame.state, NativeRax) !== 1n || !frame.state.cf || frame.state.of) {
          fail("opcode 81 did not subtract a sign-extended imm32");
        }
        const bareImm = freshNativeState(0n);
        bareImm.reg[NativeRax] = (1n << 40n) | 5n;
        const withoutWide = execute([0x81, 0xe8, 0x01, 0x00, 0x00, 0x00, 0xf4], bareImm, 4);
        if (withoutWide.kind !== "halt" || reg(withoutWide.state, NativeRax) !== 4n) {
          fail("32-bit sub eax, 1 kept the high half");
        }
        const header = freshNativeState(0n);
        header.reg[NativeRsi] = (1n << 40n) | 1n;
        const kind = execute([0x81, 0xfe, 0x51, 0xe5, 0x74, 0x64, 0xf4], header, 4);
        if (kind.kind !== "halt" || reg(kind.state, NativeRsi) !== ((1n << 40n) | 1n) || !kind.state.cf || kind.state.zf) {
          fail("cmp esi, imm32 wrote rsi or missed CF");
        }
        const memoryImm = new Uint8Array(16);
        memoryImm[0] = 0x48;
        memoryImm[1] = 0x81;
        memoryImm[2] = 0x00;
        memoryImm[9] = 0x5a;
        const held = freshNativeState(0n);
        held.reg[NativeRax] = 5n;
        const indirectImm = runNative(held, portOf(memoryImm), 4);
        if (indirectImm.kind !== "fault" || indirectImm.state.rip !== 0n || reg(indirectImm.state, NativeRax) !== 5n || memoryImm[9] !== 0x5a) {
          fail("opcode 81 with a memory operand still wrote rax");
        }
        const load = [0x48, 0x8b, 0x06];
        const reading = freshNativeState(origin + BigInt(at) * 8n);
        reading.compat = true;
        reading.reg[NativeRsi] = 0n;
        reading.reg[NativeRax] = 9n;
        const start = reading.rip;
        const denied = runNative(reading, {
          limitBit: origin + 0x3000n * 8n,
          load(bit: bigint): number {
            const index = Number((bit - origin) / 8n) - at;
            return load[index] ?? 0;
          },
          store(_bit: bigint, _value: number): void {
            fail("a faulting load wrote memory");
          },
        }, 4);
        if (denied.kind !== "fault" || denied.state.rip !== start || reg(denied.state, NativeRax) !== 9n) {
          fail("a load from address 0 still ran");
        }
      }

      /** F3 AB 按 dword 向前重复写。rcx 为 0 时不写。第一次失败不改 rdi。 */
      function checkStos(): void {
        const state = freshNativeState(0n);
        state.reg[NativeRax] = 0x1122334455667788n;
        state.reg[NativeRcx] = 2n;
        state.reg[NativeRdi] = 32n;
        state.zf = true;
        const filled = execute([0xf3, 0xab, 0xf4], state, 4);
        const image = filled.image;
        if (filled.kind !== "halt" || reg(filled.state, NativeRdi) !== 40n || reg(filled.state, NativeRcx) !== 0n || !filled.state.zf) {
          fail("rep stosd did not finish");
        }
        if (image[32] !== 0x88 || image[33] !== 0x77 || image[34] !== 0x66 || image[35] !== 0x55 || image[36] !== 0x88 || image[39] !== 0x55) {
          fail("rep stosd did not store the low 32 bits");
        }
        const idle = freshNativeState(0n);
        idle.reg[NativeRax] = 0xffn;
        idle.reg[NativeRcx] = 0n;
        idle.reg[NativeRdi] = 32n;
        const skipped = execute([0xf3, 0xab, 0xf4], idle, 4);
        if (skipped.kind !== "halt" || reg(skipped.state, NativeRdi) !== 32n || skipped.image[32] !== 0) {
          fail("rep stosd wrote when rcx was zero");
        }
        const once = freshNativeState(0n);
        once.reg[NativeRax] = 0x55667788n;
        once.reg[NativeRcx] = 4n;
        once.reg[NativeRdi] = 32n;
        const single = execute([0xab, 0xf4], once, 4);
        if (single.kind !== "halt" || reg(single.state, NativeRdi) !== 36n || reg(single.state, NativeRcx) !== 4n || single.image[32] !== 0x88 || single.image[36] !== 0) {
          fail("stosd repeated or skipped the one store");
        }
        const paused = freshNativeState(0n);
        paused.reg[NativeRax] = 9n;
        const other = runNative(paused, portOf(new Uint8Array([0xf3, 0x90])), 4);
        if (other.kind !== "fault" || other.state.rip !== 0n || reg(other.state, NativeRax) !== 9n) {
          fail("F3 before an unregistered opcode still ran");
        }
        const tight = new Uint8Array(38);
        tight[0] = 0xf3;
        tight[1] = 0xab;
        const partial = freshNativeState(0n);
        partial.reg[NativeRax] = 0x55667788n;
        partial.reg[NativeRcx] = 2n;
        partial.reg[NativeRdi] = 32n;
        const torn = runNative(partial, portOf(tight), 4);
        if (torn.kind !== "fault" || torn.state.rip !== 0n || reg(torn.state, NativeRdi) !== 36n || reg(torn.state, NativeRcx) !== 1n || tight[32] !== 0x88 || tight[36] !== 0) {
          fail("rep stosd did not keep the completed iteration");
        }
      }

      /** 加一不改 CF。测试不写寄存器。8 位条件跳转不成立时停在下一条。 */
      function checkStep(): void {
        const wrapped = freshNativeState(0n);
        wrapped.reg[NativeRax] = (1n << 64n) - 1n;
        wrapped.cf = true;
        const inc = execute([0x48, 0xff, 0xc0, 0xf4], wrapped, 4);
        if (inc.kind !== "halt" || reg(inc.state, NativeRax) !== 0n || !inc.state.zf || !inc.state.cf || inc.state.of) {
          fail("inc did not wrap or it cleared CF");
        }
        const edge = freshNativeState(0n);
        edge.reg[NativeRax] = (1n << 63n) - 1n;
        const overflowed = execute([0x48, 0xff, 0xc0, 0xf4], edge, 4);
        if (overflowed.kind !== "halt" || reg(overflowed.state, NativeRax) !== (1n << 63n) || !overflowed.state.of || !overflowed.state.sf) {
          fail("inc did not set OF at the sign edge");
        }
        const narrow = freshNativeState(0n);
        narrow.reg[NativeRax] = (1n << 40n) | 0xffffffffn;
        narrow.cf = true;
        const eax = execute([0xff, 0xc0, 0xf4], narrow, 4);
        if (eax.kind !== "halt" || reg(eax.state, NativeRax) !== 0n || !eax.state.zf || !eax.state.cf) {
          fail("32-bit inc left the high half");
        }
        const kept = freshNativeState(0n);
        kept.reg[NativeRax] = 1n << 40n;
        const tested = execute([0x85, 0xc0, 0xf4], kept, 4);
        if (tested.kind !== "halt" || reg(tested.state, NativeRax) !== (1n << 40n) || !tested.state.zf || tested.state.cf) {
          fail("32-bit test wrote rax or used the high half");
        }
        const landed = freshNativeState(0n);
        landed.reg[NativeRax] = 24n;
        const via = execute([0xff, 0xe0, 0x90, 0xf4], landed, 4);
        if (via.kind !== "halt" || via.state.rip !== 32n || reg(via.state, NativeRax) !== 24n) {
          fail("jmp rax did not land on halt");
        }
        const shifted = freshNativeState(0n);
        shifted.reg[NativeRsi] = 1n << 63n;
        const shr = execute([0x48, 0xd1, 0xee, 0xf4], shifted, 4);
        if (shr.kind !== "halt" || reg(shr.state, NativeRsi) !== (1n << 62n) || shr.state.cf || !shr.state.of) {
          fail("shr rsi, 1 dropped the sign into OF");
        }
        const arithmetic = freshNativeState(0n);
        arithmetic.reg[NativeRax] = (1n << 64n) - 1n;
        const sar = execute([0x48, 0xc1, 0xf8, 0x03, 0xf4], arithmetic, 4);
        if (sar.kind !== "halt" || reg(sar.state, NativeRax) !== ((1n << 64n) - 1n) || !sar.state.cf || !sar.state.sf) {
          fail("sar rax, 3 did not keep the sign");
        }
        const idle = freshNativeState(0n);
        idle.reg[NativeRax] = 1n;
        idle.zf = false;
        const zeroCount = execute([0x48, 0xc1, 0xe8, 0x40, 0xf4], idle, 4);
        if (zeroCount.kind !== "halt" || reg(zeroCount.state, NativeRax) !== 1n || zeroCount.state.zf) {
          fail("shl by a masked count of 0 changed rax");
        }
        const rotate = freshNativeState(0n);
        rotate.reg[NativeRax] = 3n;
        const rol = runNative(rotate, portOf(new Uint8Array([0x48, 0xc1, 0xc0, 0x01])), 4);
        if (rol.kind !== "fault" || reg(rol.state, NativeRax) !== 3n) {
          fail("rol still wrote rax");
        }
        const call = freshNativeState(0n);
        call.reg[NativeRax] = 5n;
        const indirect = runNative(call, portOf(new Uint8Array([0x48, 0xff, 0xd0])), 4);
        if (indirect.kind !== "fault" || indirect.state.rip !== 0n || reg(indirect.state, NativeRax) !== 5n) {
          fail("call rax with an empty stack still ran");
        }
        const body = new Uint8Array(0x200);
        body[0] = 0xff;
        body[1] = 0xd0;
        body[2] = 0xf4;
        body[3] = 0xc3;
        const caller = freshNativeState(0n);
        caller.reg[NativeRax] = 24n;
        caller.reg[NativeRsp] = 0x200n;
        const called = runNative(caller, portOf(body), 8);
        if (called.kind !== "halt" || called.state.reg[NativeRsp] !== 0x200n || body[0x1f8] !== 16) {
          fail("call rax did not return to halt");
        }
        const dilState = freshNativeState(0n);
        dilState.reg[NativeRdi] = 0xffe3d0n;
        const dil = execute([0x40, 0xf6, 0xc7, 0x07, 0xf4], dilState, 4);
        if (dil.kind !== "halt" || reg(dil.state, NativeRdi) !== 0xffe3d0n || !dil.state.zf || dil.state.cf || dil.state.of) {
          fail("test dil, 7 wrote rdi or missed ZF");
        }
        const high = freshNativeState(0n);
        high.reg[NativeRbx] = 0x8000n;
        const bh = execute([0xf6, 0xc7, 0x80, 0xf4], high, 4);
        if (bh.kind !== "halt" || reg(bh.state, NativeRbx) !== 0x8000n || bh.state.zf || !bh.state.sf) {
          fail("test bh, 0x80 used DIL or cleared SF");
        }
        const notByte = freshNativeState(0n);
        notByte.reg[NativeRax] = 1n;
        const rejectedNot = runNative(notByte, portOf(new Uint8Array([0xf6, 0xd0])), 4);
        if (rejectedNot.kind !== "fault" || reg(rejectedNot.state, NativeRax) !== 1n) {
          fail("F6 /2 still wrote al");
        }
        const widened = freshNativeState(0n);
        widened.reg[NativeRsi] = 0x1122332fn;
        widened.zf = true;
        const movzx = execute([0x40, 0x0f, 0xb6, 0xf6, 0xf4], widened, 4);
        if (movzx.kind !== "halt" || reg(movzx.state, NativeRsi) !== 0x2fn || !movzx.state.zf) {
          fail("movzx esi, sil kept the high half or changed ZF");
        }
        const fromAh = freshNativeState(0n);
        fromAh.reg[NativeRax] = (1n << 40n) | 0x8000n;
        const ah = execute([0x0f, 0xb6, 0xc4, 0xf4], fromAh, 4);
        if (ah.kind !== "halt" || reg(ah.state, NativeRax) !== 0x80n) {
          fail("movzx eax, ah did not read AH");
        }
        const compared32 = freshNativeState(0n);
        compared32.reg[NativeRdx] = 1n << 40n;
        compared32.reg[NativeRsi] = 0x2fn;
        const cmpEdx = execute([0x39, 0xf2, 0xf4], compared32, 4);
        if (cmpEdx.kind !== "halt" || reg(cmpEdx.state, NativeRdx) !== (1n << 40n) || reg(cmpEdx.state, NativeRsi) !== 0x2fn || !cmpEdx.state.cf || cmpEdx.state.zf) {
          fail("cmp edx, esi wrote a register or missed CF");
        }
        const bytes = new Uint8Array(16);
        bytes[0] = 0x38;
        bytes[1] = 0x10;
        bytes[2] = 0xf4;
        bytes[8] = 0x2f;
        const byteCmp = freshNativeState(0n);
        byteCmp.reg[NativeRax] = 8n;
        byteCmp.reg[NativeRdx] = 0x2fn;
        const matched = runNative(byteCmp, portOf(bytes), 4);
        if (matched.kind !== "halt" || !matched.state.zf || bytes[8] !== 0x2f || reg(matched.state, NativeRdx) !== 0x2fn) {
          fail("cmp byte [rax], dl wrote the byte or missed ZF");
        }
        const wordImage = new Uint8Array(32);
        wordImage[0] = 0x66;
        wordImage[1] = 0x83;
        wordImage[2] = 0x7c;
        wordImage[3] = 0x24;
        wordImage[4] = 0x08;
        wordImage[5] = 0x00;
        wordImage[6] = 0xf4;
        const wordCmp = freshNativeState(0n);
        wordCmp.reg[NativeRsp] = 16n;
        const wordZero = runNative(wordCmp, portOf(wordImage), 4);
        if (wordZero.kind !== "halt" || !wordZero.state.zf || wordZero.state.cf || reg(wordZero.state, NativeRsp) !== 16n) {
          fail("cmp word [rsp+8], 0 missed ZF");
        }
        const setByte = freshNativeState(0n);
        setByte.zf = true;
        setByte.reg[NativeR14] = 0xff00n;
        const sete = execute([0x41, 0x0f, 0x94, 0xc6, 0xf4], setByte, 4);
        if (sete.kind !== "halt" || reg(sete.state, NativeR14) !== 0xff01n || !sete.state.zf) {
          fail("sete r14b did not write 1 into the low byte");
        }
        const half = new Uint8Array(16);
        half[0] = 0x66;
        half[1] = 0x8b;
        half[2] = 0x08;
        half[3] = 0xf4;
        half[8] = 0x34;
        half[9] = 0x12;
        const moved = freshNativeState(0n);
        moved.reg[NativeRax] = 8n;
        moved.reg[NativeRcx] = 0x10000n;
        const wordMov = runNative(moved, portOf(half), 4);
        if (wordMov.kind !== "halt" || reg(wordMov.state, NativeRcx) !== 0x11234n || half[8] !== 0x34) {
          fail("mov cx, [rax] did not keep the high half");
        }
        const product = freshNativeState(0n);
        product.reg[NativeRax] = 6n;
        product.reg[NativeRsi] = 7n;
        const imul = execute([0x48, 0x0f, 0xaf, 0xc6, 0xf4], product, 4);
        if (imul.kind !== "halt" || reg(imul.state, NativeRax) !== 42n || imul.state.cf || imul.state.of) {
          fail("imul rax, rsi did not produce 42");
        }
        const wideProduct = freshNativeState(0n);
        wideProduct.reg[NativeRax] = 1n << 62n;
        wideProduct.reg[NativeRsi] = 4n;
        const imulOverflow = execute([0x48, 0x0f, 0xaf, 0xc6, 0xf4], wideProduct, 4);
        if (imulOverflow.kind !== "halt" || reg(imulOverflow.state, NativeRax) !== 0n || !imulOverflow.state.cf || !imulOverflow.state.of) {
          fail("imul of 2^62 by 4 did not set CF");
        }
        const zx = freshNativeState(0n);
        zx.reg[NativeRbp] = (1n << 40n) | 0x50n;
        zx.zf = true;
        const movzxWord = execute([0x0f, 0xb7, 0xc5, 0xf4], zx, 4);
        if (movzxWord.kind !== "halt" || reg(movzxWord.state, NativeRax) !== 0x50n || reg(movzxWord.state, NativeRbp) !== ((1n << 40n) | 0x50n) || !movzxWord.state.zf) {
          fail("movzx eax, bp kept the high half or changed ZF");
        }
        const lea32 = freshNativeState(0n);
        lea32.reg[NativeRax] = 0x50n;
        lea32.reg[NativeRdx] = 1n << 40n;
        lea32.zf = true;
        const effective = execute([0x8d, 0x50, 0xfe, 0xf4], lea32, 4);
        if (effective.kind !== "halt" || reg(effective.state, NativeRdx) !== 0x4en || !effective.state.zf) {
          fail("lea edx, [rax-2] kept the high half");
        }
        const skipped = freshNativeState(0n);
        skipped.zf = true;
        skipped.reg[NativeRax] = 5n;
        const stay = execute([0x75, 0x01, 0x90, 0xf4], skipped, 4);
        if (stay.kind !== "fault" || reg(stay.state, NativeRax) !== 5n) {
          fail("jnz was taken while ZF was set");
        }
        const jumped = freshNativeState(0n);
        jumped.reg[NativeRax] = 5n;
        const gone = execute([0x75, 0x01, 0x90, 0xf4], jumped, 4);
        if (gone.kind !== "halt" || reg(gone.state, NativeRax) !== 5n) {
          fail("jnz was not taken");
        }
        const negated = freshNativeState(0n);
        negated.reg[NativeRax] = 5n;
        const minus = execute([0x48, 0xf7, 0xd8, 0xf4], negated, 4);
        if (minus.kind !== "halt" || reg(minus.state, NativeRax) !== ((1n << 64n) - 5n) || !minus.state.cf || minus.state.of) {
          fail("neg rax did not subtract from zero");
        }
        const zeroed = freshNativeState(0n);
        const still = execute([0x48, 0xf7, 0xd8, 0xf4], zeroed, 4);
        if (still.kind !== "halt" || reg(still.state, NativeRax) !== 0n || still.state.cf || !still.state.zf) {
          fail("neg of zero set CF");
        }
        const flipped = freshNativeState(0n);
        flipped.reg[NativeRax] = 0n;
        flipped.zf = true;
        const not = execute([0x48, 0xf7, 0xd0, 0xf4], flipped, 4);
        if (not.kind !== "halt" || reg(not.state, NativeRax) !== ((1n << 64n) - 1n) || !not.state.zf) {
          fail("not changed flags or left a zero bit");
        }
        const divided = freshNativeState(0n);
        divided.reg[NativeRax] = 8n;
        const div = runNative(divided, portOf(new Uint8Array([0x48, 0xf7, 0xf1])), 4);
        if (div.kind !== "fault" || div.state.rip !== 0n || reg(div.state, NativeRax) !== 8n) {
          fail("div still ran");
        }
        const masked = freshNativeState(0n);
        masked.reg[NativeRax] = 0xfn;
        masked.reg[NativeRsi] = 0xf0n;
        const both = execute([0x48, 0x21, 0xf0, 0xf4], masked, 4);
        if (both.kind !== "halt" || reg(both.state, NativeRax) !== 0n || !both.state.zf || both.state.cf || both.state.of) {
          fail("and rax, rsi kept a bit or set CF");
        }
        const joined = freshNativeState(0n);
        joined.reg[NativeRax] = 0xf0n;
        joined.reg[NativeRcx] = 0x0fn;
        const either = execute([0x48, 0x09, 0xc8, 0xf4], joined, 4);
        if (either.kind !== "halt" || reg(either.state, NativeRax) !== 0xffn || either.state.zf) {
          fail("or rax, rcx dropped a bit");
        }
        const above = freshNativeState(0n);
        const taken = execute([0x77, 0x01, 0x90, 0xf4], above, 4);
        if (taken.kind !== "halt") {
          fail("ja was not taken when CF and ZF were clear");
        }
        const blocked = freshNativeState(0n);
        blocked.zf = true;
        const stayed = execute([0x77, 0x01, 0x90, 0xf4], blocked, 4);
        if (stayed.kind !== "fault") {
          fail("ja was taken while ZF was set");
        }
        const signed = freshNativeState(0n);
        signed.reg[NativeRax] = 3n;
        const wide = execute([0x48, 0xc7, 0xc0, 0xff, 0xff, 0xff, 0xff, 0xf4], signed, 4);
        if (wide.kind !== "halt" || reg(wide.state, NativeRax) !== ((1n << 64n) - 1n) || wide.state.zf) {
          fail("mov rax, imm32 did not sign-extend");
        }
        const narrowImm = freshNativeState(0n);
        narrowImm.reg[NativeRax] = 3n;
        const low = execute([0xc7, 0xc0, 0xff, 0xff, 0xff, 0xff, 0xf4], narrowImm, 4);
        if (low.kind !== "halt" || reg(low.state, NativeRax) !== 0xffffffffn) {
          fail("mov eax, imm32 sign-extended into the high half");
        }
        const placed = execute([
          0x48, 0xc7, 0x05, 0x01, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0xf4,
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ], freshNativeState(0n), 4);
        if (placed.kind !== "halt" || placed.image[12] !== 8 || placed.image[8] !== 0 || placed.image[11] !== 0xf4) {
          fail("rip-relative mov stored the immediate on top of itself");
        }
        const bytePlaced = execute([
          0xc6, 0x05, 0x01, 0x00, 0x00, 0x00, 0x2f, 0xf4,
          0, 0, 0, 0, 0, 0, 0, 0,
        ], freshNativeState(0n), 4);
        if (bytePlaced.kind !== "halt" || bytePlaced.image[8] !== 0x2f || bytePlaced.image[7] !== 0xf4) {
          fail("rip-relative byte store included the immediate in the address");
        }
        const fsImage = new Uint8Array(32);
        fsImage[0] = 0x64;
        fsImage[1] = 0x8b;
        fsImage[2] = 0x00;
        fsImage[3] = 0xf4;
        fsImage[16] = 0x78;
        fsImage[17] = 0x56;
        fsImage[18] = 0x34;
        fsImage[19] = 0x12;
        const fsState = freshNativeState(0n);
        fsState.fsbase = 16n;
        const fsRead = runNative(fsState, portOf(fsImage), 4);
        if (fsRead.kind !== "halt" || reg(fsRead.state, NativeRax) !== 0x12345678n) {
          fail("fs override did not add fsbase");
        }
        const compared = freshNativeState(0n);
        compared.reg[NativeRax] = 0xd8n;
        const cmp = execute([0x48, 0x3d, 0x50, 0x01, 0x00, 0x00, 0xf4], compared, 4);
        if (cmp.kind !== "halt" || reg(cmp.state, NativeRax) !== 0xd8n || !cmp.state.cf || cmp.state.zf) {
          fail("cmp rax, 0x150 did not leave rax or the flags");
        }
        const word = freshNativeState(0n);
        word.reg[NativeRax] = (1n << 40n) | 0xffffffffn;
        const equal = execute([0x3d, 0xff, 0xff, 0xff, 0xff, 0xf4], word, 4);
        if (equal.kind !== "halt" || reg(equal.state, NativeRax) !== ((1n << 40n) | 0xffffffffn) || !equal.state.zf) {
          fail("cmp eax, -1 used the high half");
        }
      }

      /** 8 位写入只改一个字节。没有 REX 时目的可以是 AH。短跳转跳过下一条。 */
      function checkByte(): void {
        const image = new Uint8Array(64);
        image[0] = 0x8a;
        image[1] = 0x06;
        image[2] = 0xf4;
        image[40] = 0x2f;
        const loaded = freshNativeState(0n);
        loaded.reg[NativeRax] = 0x1122334455667788n;
        loaded.reg[NativeRsi] = 40n;
        const moved = runNative(loaded, portOf(image), 4);
        if (moved.kind !== "halt" || reg(moved.state, NativeRax) !== 0x112233445566772fn) {
          fail("mov al, [rsi] cleared the rest of rax");
        }
        const high = new Uint8Array(64);
        high[0] = 0x8a;
        high[1] = 0x26;
        high[2] = 0xf4;
        high[40] = 0xab;
        const ah = freshNativeState(0n);
        ah.reg[NativeRax] = 0x1100n;
        ah.reg[NativeRsi] = 40n;
        const merged = runNative(ah, portOf(high), 4);
        if (merged.kind !== "halt" || reg(merged.state, NativeRax) !== 0xab00n) {
          fail("mov ah, [rsi] did not write bits 8 to 15");
        }
        const stack = new Uint8Array(64);
        stack[0] = 0x40;
        stack[1] = 0x8a;
        stack[2] = 0x26;
        stack[3] = 0xf4;
        stack[40] = 0xab;
        const spl = freshNativeState(0n);
        spl.reg[NativeRax] = 0x1100n;
        spl.reg[NativeRsp] = 0x1000n;
        spl.reg[NativeRsi] = 40n;
        const lowStack = runNative(spl, portOf(stack), 4);
        if (lowStack.kind !== "halt" || reg(lowStack.state, NativeRsp) !== 0x10abn || reg(lowStack.state, NativeRax) !== 0x1100n) {
          fail("REX changed AH instead of SPL");
        }
        const compared = freshNativeState(0n);
        compared.reg[NativeRax] = 0x1100n;
        const same = execute([0x3c, 0x00, 0xf4], compared, 4);
        if (same.kind !== "halt" || reg(same.state, NativeRax) !== 0x1100n || !same.state.zf || same.state.cf) {
          fail("cmp al, imm8 wrote rax or the wrong flags");
        }
        const added = freshNativeState(0n);
        added.reg[NativeRax] = 0x11ffn;
        const wrapped = execute([0x80, 0xc0, 0x01, 0xf4], added, 4);
        if (wrapped.kind !== "halt" || reg(wrapped.state, NativeRax) !== 0x1100n || !wrapped.state.zf || !wrapped.state.cf) {
          fail("add al, 1 did not wrap inside the low byte");
        }
        const bumped = freshNativeState(0n);
        bumped.reg[NativeRax] = 0x117fn;
        bumped.cf = true;
        const edged = execute([0xfe, 0xc0, 0xf4], bumped, 4);
        if (edged.kind !== "halt" || reg(edged.state, NativeRax) !== 0x1180n || !edged.state.cf || !edged.state.of || !edged.state.sf) {
          fail("inc al cleared CF or missed the sign edge");
        }
        const skipped = execute([0xeb, 0x01, 0x90, 0xf4], freshNativeState(0n), 4);
        if (skipped.kind !== "halt") {
          fail("jmp rel8 did not skip the unimplemented byte");
        }
        const stored = new Uint8Array(64);
        stored[0] = 0x88;
        stored[1] = 0x06;
        stored[2] = 0xf4;
        const writer = freshNativeState(0n);
        writer.reg[NativeRax] = 0x112fn;
        writer.reg[NativeRsi] = 40n;
        const wrote = runNative(writer, portOf(stored), 4);
        if (wrote.kind !== "halt" || stored[40] !== 0x2f || reg(wrote.state, NativeRax) !== 0x112fn) {
          fail("mov [rsi], al did not store only the low byte");
        }
      }

      /** 头不对时不取出代码。长度后面的导出表留在文件里。 */
      function checkHeader(): void {
        const octets = new Uint8Array(14);
        octets[0] = 0x5a;
        octets[1] = 0x4e;
        octets[2] = 0x42;
        octets[3] = 0x31;
        octets[4] = 1;
        octets[8] = 1;
        octets[12] = 0x90;
        octets[13] = 0xab;
        const code = nativeCodeBytes(octets);
        if (code?.length !== 1 || code[0] !== 0x90) {
          fail("a ZNB1 header did not return only the code");
        }
        if (nativeCodeBytes(new Uint8Array(11)) !== null) {
          fail("a short header was accepted");
        }
        const magic = octets.slice();
        magic[0] = 0;
        if (nativeCodeBytes(magic) !== null) {
          fail("a header with the wrong magic was accepted");
        }
        const version = octets.slice();
        version[4] = 2;
        if (nativeCodeBytes(version) !== null) {
          fail("a header with the wrong version was accepted");
        }
        const flags = octets.slice();
        flags[6] = 1;
        if (nativeCodeBytes(flags) !== null) {
          fail("a header with flags was accepted");
        }
        const empty = octets.slice();
        empty[8] = 0;
        if (nativeCodeBytes(empty) !== null) {
          fail("a header with no code was accepted");
        }
        const over = octets.slice(0, 13);
        over[8] = 2;
        if (nativeCodeBytes(over) !== null) {
          fail("a header whose code runs past the file was accepted");
        }
      }

      function checkCall(): void {
        const image = octetsFrom([
          0x48, 0xb8, 0x28, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0xe8, 0x01, 0x00, 0x00, 0x00,
          0xf4,
          0x48, 0xb9, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x48, 0x01, 0xc8,
          0xc3,
        ]);
        const state = freshNativeState(0n);
        state.reg[NativeRsp] = 0x200n;
        const stopped = runNative(state, portOf(image), 16);
        if (stopped.kind !== "halt") {
          fail("call did not halt");
        }
        if (stopped.state.reg[NativeRax] !== 42n) {
          fail("call did not add through the return");
        }
        if (stopped.state.reg[NativeRsp] !== 0x200n) {
          fail("call left the stack pointer moved");
        }
        if (image[0x1f8] !== 120) {
          fail("call did not store the bit address of the next instruction");
        }
      }

      function checkAddress(): void {
        const image = octetsFrom([
          0x48, 0xb8, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x48, 0xb9, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x48, 0x89, 0x01,
          0x48, 0x8b, 0x11,
          0x4c, 0x8d, 0x44, 0x11, 0x01,
          0x48, 0x8d, 0x44, 0x91, 0x10,
          0xf4,
        ]);
        const stopped = runNative(freshNativeState(0n), portOf(image), 16);
        if (stopped.kind !== "halt") {
          fail("addressing did not halt");
        }
        if (stopped.state.reg[NativeRdx] !== 7n || image[256] !== 7) {
          fail("the store and load did not use an octet address times 8");
        }
        if (stopped.state.reg[NativeR8] !== 264n) {
          fail("lea did not add index times scale 1");
        }
        if (stopped.state.reg[NativeRax] !== 300n) {
          fail("lea did not add index times scale 4");
        }
      }

      function checkJump(): void {
        const image = octetsFrom([
          0x48, 0x31, 0xc0,
          0x0f, 0x84, 0x0a, 0x00, 0x00, 0x00,
          0x48, 0xb8, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0xf4,
        ]);
        const stopped = runNative(freshNativeState(0n), portOf(image), 8);
        if (stopped.kind !== "halt" || stopped.state.reg[NativeRax] !== 0n || !stopped.state.zf) {
          fail("jz did not skip the move after xor");
        }
        const fall = octetsFrom([
          0x48, 0x31, 0xc0,
          0x0f, 0x85, 0x0a, 0x00, 0x00, 0x00,
          0x48, 0xb8, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0xf4,
        ]);
        const stayed = runNative(freshNativeState(0n), portOf(fall), 8);
        if (stayed.kind !== "halt" || stayed.state.reg[NativeRax] !== 3n) {
          fail("jnz took the branch while ZF was set");
        }
      }

      function checkStack(): void {
        const image = octetsFrom([
          0x48, 0xb8, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x50,
          0x48, 0x31, 0xc0,
          0x58,
          0xf4,
        ]);
        const state = freshNativeState(0n);
        state.reg[NativeRsp] = 0x200n;
        const stopped = runNative(state, portOf(image), 8);
        if (stopped.kind !== "halt" || stopped.state.reg[NativeRax] !== 5n || stopped.state.reg[NativeRsp] !== 0x200n) {
          fail("push and pop did not round-trip rax");
        }
      }

      function checkFlags(): void {
        const image = octetsFrom([
          0x48, 0xb8, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x48, 0xb9, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
          0x48, 0x01, 0xc8,
          0xf4,
        ]);
        const stopped = runNative(freshNativeState(0n), portOf(image), 8);
        if (stopped.kind !== "halt" || stopped.state.reg[NativeRax] !== 0n) {
          fail("add did not wrap to zero");
        }
        if (!stopped.state.zf || !stopped.state.cf || stopped.state.of) {
          fail("add flags were not carry and zero");
        }
      }

      function checkReject(): void {
        const image = octetsFrom([0x90]);
        const state = freshNativeState(0n);
        state.reg[NativeRax] = 9n;
        state.reg[NativeRcx] = 4n;
        const stopped = runNative(state, portOf(image), 4);
        if (stopped.kind !== "fault") {
          fail("an unimplemented opcode still ran");
        }
        if (stopped.state.reg[NativeRax] !== 9n || stopped.state.reg[NativeRcx] !== 4n || stopped.state.rip !== 0n) {
          fail("the failed opcode changed registers");
        }
        const narrow = octetsFrom([0x01, 0xc8]);
        const narrowState = freshNativeState(0n);
        narrowState.reg[NativeRax] = 3n;
        narrowState.reg[NativeRcx] = 4n;
        const rejected = runNative(narrowState, portOf(narrow), 4);
        if (rejected.kind !== "fault" || rejected.state.reg[NativeRax] !== 3n) {
          fail("an add without REX.W still wrote a register");
        }
        const escape = octetsFrom([0x0f, 0x3f, 0x7f]);
        const escapeState = freshNativeState(0n);
        escapeState.reg[NativeRax] = 9n;
        const unknown = runNative(escapeState, portOf(escape), 4);
        if (unknown.kind !== "fault" || unknown.state.reg[NativeRax] !== 9n || unknown.state.rip !== 0n) {
          fail("an unknown 0F 3F opcode still changed a register");
        }
        const gate = octetsFrom([0x0f, 0x3f, 0x02]);
        const gateState = freshNativeState(0n);
        gateState.reg[NativeRax] = 9n;
        const parked = runNative(gateState, portOf(gate), 4);
        if (parked.kind !== "fault" || parked.state.reg[NativeRax] !== 9n || parked.state.rip !== 0n) {
          fail("0F 3F ran without a core");
        }
        const wide = execute([0x66], freshNativeState(0n), 4);
        if (wide.kind !== "fault" || wide.state.rip !== 0n || reg(wide.state, NativeRax) !== 0n) {
          fail("operand size 0x66 still ran");
        }
        const addr = execute([0x67], freshNativeState(0n), 4);
        if (addr.kind !== "fault" || addr.state.rip !== 0n) {
          fail("address size 0x67 still ran");
        }
        const cutImage = new Uint8Array([0x48, 0xb8, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06]);
        const cut = freshNativeState(0n);
        cut.reg[NativeRax] = 9n;
        const short = runNative(cut, portOf(cutImage), 4);
        if (short.kind !== "fault" || short.state.rip !== 0n || reg(short.state, NativeRax) !== 9n) {
          fail("a truncated immediate still wrote rax");
        }
      }

      /** 立即数要能写进 rax 到 r15，失败时不能改指针。 */
      function checkRegisters(): void {
        for (let index = 0; index < 16; index += 1) {
          const rex = index < 8 ? 0x48 : 0x49;
          const ran = execute([rex, 0xb8 + (index & 7), 0x11, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf4], freshNativeState(0n), 4);
          if (ran.kind !== "halt" || reg(ran.state, index) !== 0x11n) {
            fail("mov did not write every register");
          }
        }
      }

      /**
       * 加法、减法、比较和异或都要留下协议点名的标志。
       * 比较不得改目的寄存器。异或清掉 CF 和 OF。
       */
      function checkFlagSet(): void {
        const overflow = execute([
          0x48, 0xb8, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f,
          0x48, 0xb9, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x48, 0x01, 0xc8,
          0xf4,
        ], freshNativeState(0n), 8);
        if (overflow.kind !== "halt" || reg(overflow.state, NativeRax) !== 0x8000000000000000n) {
          fail("signed add did not wrap");
        }
        if (!overflow.state.of || !overflow.state.sf || overflow.state.cf || overflow.state.zf || !overflow.state.pf) {
          fail("signed add flags were not overflow");
        }
        const borrow = execute([
          0x48, 0x31, 0xc0,
          0x48, 0xb9, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x48, 0x29, 0xc8,
          0xf4,
        ], freshNativeState(0n), 8);
        if (borrow.kind !== "halt" || reg(borrow.state, NativeRax) !== 0xffffffffffffffffn) {
          fail("sub did not borrow");
        }
        if (!borrow.state.cf || !borrow.state.sf || borrow.state.of || borrow.state.zf || !borrow.state.pf) {
          fail("sub flags were not borrow");
        }
        const cleared = execute([
          0x48, 0xb8, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x48, 0xb9, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
          0x48, 0x01, 0xc8,
          0x48, 0x31, 0xc0,
          0xf4,
        ], freshNativeState(0n), 8);
        if (cleared.kind !== "halt" || !cleared.state.zf || cleared.state.cf || cleared.state.of || !cleared.state.pf) {
          fail("xor did not clear carry and overflow");
        }
        const compared = execute([
          0x48, 0xb8, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x48, 0xb9, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x48, 0x39, 0xc8,
          0xf4,
        ], freshNativeState(0n), 8);
        if (compared.kind !== "halt" || reg(compared.state, NativeRax) !== 5n || !compared.state.zf || compared.state.cf) {
          fail("cmp wrote the destination or missed ZF");
        }
      }

      /**
       * 比例 2 和 8、缺基址、缺变址、负位移、r8 作基址或变址、相对指令指针。
       * 位移从本条的下一个八位组算起。
       */
      function checkModes(): void {
        const scaled = execute([
          0x48, 0xb9, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x48, 0xba, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x48, 0x8d, 0x04, 0x4d, 0x04, 0x00, 0x00, 0x00,
          0x48, 0x8d, 0x04, 0xd1,
          0xf4,
        ], freshNativeState(0n), 8);
        if (scaled.kind !== "halt" || reg(scaled.state, NativeRax) !== 43n) {
          fail("lea did not add index times scale 8");
        }
        const noBase = execute([
          0x48, 0xb9, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x48, 0x8d, 0x04, 0x4d, 0x04, 0x00, 0x00, 0x00,
          0xf4,
        ], freshNativeState(0n), 8);
        if (noBase.kind !== "halt" || reg(noBase.state, NativeRax) !== 10n) {
          fail("lea kept a base when the SIB base was absent");
        }
        const noIndex = execute([
          0x48, 0xba, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x48, 0x8d, 0x42, 0x08,
          0xf4,
        ], freshNativeState(0n), 8);
        if (noIndex.kind !== "halt" || reg(noIndex.state, NativeRax) !== 18n) {
          fail("lea did not sign-extend a missing-index disp8");
        }
        const negative = execute([
          0x48, 0xb9, 0xe8, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x48, 0x8d, 0x81, 0x18, 0xfc, 0xff, 0xff,
          0xf4,
        ], freshNativeState(0n), 8);
        if (negative.kind !== "halt" || reg(negative.state, NativeRax) !== 0n) {
          fail("lea did not sign-extend disp32");
        }
        const fromR8 = execute([
          0x49, 0xb8, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x49, 0x8d, 0x40, 0x01,
          0x4a, 0x8d, 0x14, 0x01,
          0xf4,
        ], freshNativeState(0n), 8);
        if (fromR8.kind !== "halt" || reg(fromR8.state, NativeRax) !== 5n || reg(fromR8.state, NativeRdx) !== 4n) {
          fail("lea did not use r8 as both base and index");
        }
        const disp8 = execute([
          0x48, 0xb9, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x48, 0x8d, 0x41, 0xff,
          0xf4,
        ], freshNativeState(0n), 8);
        if (disp8.kind !== "halt" || reg(disp8.state, NativeRax) !== 9n) {
          fail("lea did not sign-extend disp8");
        }
        const ripLoad = [
          0x48, 0x8b, 0x05, 0x19, 0x00, 0x00, 0x00,
          0xf4,
        ];
        while (ripLoad.length < 32) {
          ripLoad.push(0x00);
        }
        ripLoad.push(0x2a);
        const relative = execute(ripLoad, freshNativeState(0n), 4);
        if (relative.kind !== "halt" || reg(relative.state, NativeRax) !== 0x2an) {
          fail("RIP-relative load did not start at the next octet");
        }
        const backward = execute([
          0x48, 0x8b, 0x05, 0xf9, 0xff, 0xff, 0xff,
          0xf4,
        ], freshNativeState(0n), 4);
        if (backward.kind !== "halt" || reg(backward.state, NativeRax) !== 0xf4fffffff9058b48n) {
          fail("RIP-relative load did not accept a negative displacement");
        }
        const register = execute([0x48, 0x8d, 0xc0], freshNativeState(0n), 4);
        if (register.kind !== "fault" || register.state.rip !== 0n) {
          fail("lea with mod 3 still wrote a register");
        }
      }

      /** 访存形式的加、异或和比较。读不齐 8 个八位组时不得改标志，也不得写下前面几个。 */
      function checkMemory(): void {
        const added = execute([
          0x48, 0xb9, 0x80, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x48, 0xb8, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x48, 0x89, 0x01,
          0x48, 0xb8, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x48, 0x01, 0x01,
          0x48, 0xb8, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x48, 0x31, 0x01,
          0x48, 0x8b, 0x11,
          0xf4,
        ], freshNativeState(0n), 16);
        if (added.kind !== "halt" || reg(added.state, NativeRdx) !== 0n || added.image[0x180] !== 0 || !added.state.zf) {
          fail("memory xor did not clear the stored word");
        }
        const compared = execute([
          0x48, 0xb9, 0x80, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x48, 0xb8, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x48, 0x89, 0x01,
          0x48, 0x39, 0x01,
          0xf4,
        ], freshNativeState(0n), 8);
        if (compared.kind !== "halt" || reg(compared.state, NativeRax) !== 5n || !compared.state.zf || compared.image[0x180] !== 5) {
          fail("memory cmp wrote the destination");
        }
        const edge = freshNativeState(0n);
        edge.reg[NativeRax] = 1n;
        const torn = execute([
          0x48, 0xb9, 0xfc, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x48, 0x03, 0x01,
        ], edge, 4);
        if (torn.kind !== "fault" || torn.state.rip !== 80n || reg(torn.state, NativeRax) !== 1n || torn.state.cf || torn.image[1020] !== 0) {
          fail("a short memory operand updated flags or a partial word");
        }
      }

      /**
       * call 在 rsp 不够时不得改指针。栈不必 16 字节对齐。
       * 被调用方用 push/pop 保住 rbx。rsp 下面的写入不会被 call 收走。
       */
      function checkCallEdges(): void {
        const low = fresh(4n);
        low.reg[NativeRax] = 9n;
        const refused = execute([0xe8, 0x00, 0x00, 0x00, 0x00], low, 4);
        if (refused.kind !== "fault" || reg(refused.state, NativeRsp) !== 4n || reg(refused.state, NativeRax) !== 9n || refused.state.rip !== 0n) {
          fail("call changed rsp when the stack had no room");
        }
        const pushed = fresh(4n);
        pushed.reg[NativeRax] = 9n;
        const stuck = execute([0x50], pushed, 4);
        if (stuck.kind !== "fault" || reg(stuck.state, NativeRsp) !== 4n || reg(stuck.state, NativeRax) !== 9n) {
          fail("push changed rsp when the stack had no room");
        }
        const odd = execute([
          0x48, 0xb8, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0xe8, 0x01, 0x00, 0x00, 0x00,
          0xf4,
          0xc3,
        ], fresh(0x208n), 8);
        if (odd.kind !== "halt" || reg(odd.state, NativeRax) !== 1n || reg(odd.state, NativeRsp) !== 0x208n) {
          fail("call rejected a stack that is not 16-byte aligned");
        }
        const saved = execute([
          0x48, 0xbb, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x48, 0xb8, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0xe8, 0x01, 0x00, 0x00, 0x00,
          0xf4,
          0x53,
          0x48, 0xbb, 0x09, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x5b,
          0x48, 0xb8, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0xc3,
        ], fresh(0x200n), 16);
        if (saved.kind !== "halt" || reg(saved.state, NativeRax) !== 3n || reg(saved.state, NativeRbx) !== 7n || reg(saved.state, NativeRsp) !== 0x200n) {
          fail("the callee did not restore rbx");
        }
        const high = execute([
          0x49, 0xb8, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x41, 0x50,
          0x4d, 0x31, 0xc0,
          0x41, 0x58,
          0xf4,
        ], fresh(0x200n), 8);
        if (high.kind !== "halt" || reg(high.state, NativeR8) !== 5n || reg(high.state, NativeRsp) !== 0x200n) {
          fail("push and pop did not round-trip r8");
        }
        const below = execute([
          0x48, 0xb8, 0x11, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x48, 0xb9, 0xf0, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0xe8, 0x01, 0x00, 0x00, 0x00,
          0xf4,
          0x48, 0x89, 0x01,
          0xc3,
        ], fresh(0x200n), 8);
        if (below.kind !== "halt" || below.image[0x1f0] !== 0x11 || reg(below.state, NativeRsp) !== 0x200n) {
          fail("a store below rsp was absorbed by call");
        }
        const empty = fresh(1024n);
        empty.reg[NativeR15] = 4n;
        const missed = execute([0xc3], empty, 4);
        if (missed.kind !== "fault" || reg(missed.state, NativeRsp) !== 1024n || reg(missed.state, NativeR15) !== 4n || missed.state.rip !== 0n) {
          fail("ret changed rsp when the return address was unmapped");
        }
        const jump = execute([
          0xe9, 0x0a, 0x00, 0x00, 0x00,
          0x48, 0xb8, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0xf4,
        ], freshNativeState(0n), 4);
        if (jump.kind !== "halt" || reg(jump.state, NativeRax) !== 0n) {
          fail("jmp did not skip the move");
        }
      }
    }
  }
}
