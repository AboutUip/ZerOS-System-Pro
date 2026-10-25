/**
 * @module ZerOS.Hardware.Cpu.NativeFetchCheck
 * @description 核对原生指令按位地址取指
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 用 §4.12 的真实编码跑 16 个寄存器、五种标志、SIB 与相对指令指针、
 * call/ret、压栈，以及未登记前缀和窗口边缘的失败。
 * 0F 3E、REX.W 0x83、0F 3F 0x14 到 0x1D 的长度，以及 ZNB1 文件头也在这里核对。
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
import { ZerOS as RegisterRoot } from "../Enum/NativeRegister";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      const runNative = NativeRoot.Hardware.Cpu.runNative;
      const nativeCodeBytes = NativeHeaderRoot.Hardware.Cpu.nativeCodeBytes;
      const freshNativeState = StateRoot.Hardware.Cpu.freshNativeState;
      const NativeRax = RegisterRoot.Hardware.Cpu.NativeRax;
      const NativeRcx = RegisterRoot.Hardware.Cpu.NativeRcx;
      const NativeRdx = RegisterRoot.Hardware.Cpu.NativeRdx;
      const NativeRbx = RegisterRoot.Hardware.Cpu.NativeRbx;
      const NativeRsp = RegisterRoot.Hardware.Cpu.NativeRsp;
      const NativeR8 = RegisterRoot.Hardware.Cpu.NativeR8;
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

      /** REX.W 0x83 只接受寄存器形式的加、减和比较。立即数按八位符号扩展。 */
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
        bare.reg[NativeRax] = 5n;
        const withoutRex = runNative(bare, portOf(new Uint8Array([0x83, 0xc0, 0x01])), 4);
        if (withoutRex.kind !== "fault" || withoutRex.state.rip !== 0n || reg(withoutRex.state, NativeRax) !== 5n) {
          fail("opcode 83 without REX.W still wrote rax");
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
          fail("opcode 83 with a memory operand still wrote rax");
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
