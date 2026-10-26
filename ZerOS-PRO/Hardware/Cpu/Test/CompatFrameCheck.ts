/**
 * @module ZerOS.Hardware.Cpu.CompatFrameCheck
 * @description 用手写的 write 和 exit 核对兼容帧
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 不启动主板。字节放在尾区的用户页里，逐步执行到两次 0F 05。
 * 第一次必须是 write 的四个参数。第二次必须是 exit 0。
 * 原生状态下的 0F 05，以及对用户地址 0 的读，都必须失败。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 核对
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as CompatRoot } from "../Structure/CompatFrame";
import { ZerOS as RegisterRoot } from "../Enum/NativeRegister";
import { ZerOS as RunRoot } from "../Native/NativeRun";
import { ZerOS as StateRoot } from "../Structure/NativeState";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      const CompatTailOrigin = CompatRoot.Hardware.Cpu.CompatTailOrigin;
      const compatDescriptor = CompatRoot.Hardware.Cpu.compatDescriptor;
      const encodeCompatFrame = CompatRoot.Hardware.Cpu.encodeCompatFrame;
      const applyCompatFrame = CompatRoot.Hardware.Cpu.applyCompatFrame;
      const NativeRax = RegisterRoot.Hardware.Cpu.NativeRax;
      const NativeRcx = RegisterRoot.Hardware.Cpu.NativeRcx;
      const NativeRdi = RegisterRoot.Hardware.Cpu.NativeRdi;
      const NativeRsp = RegisterRoot.Hardware.Cpu.NativeRsp;
      const stepNative = RunRoot.Hardware.Cpu.stepNative;
      const freshNativeState = StateRoot.Hardware.Cpu.freshNativeState;
      const spaceBytes = 16777216;
      const entry = 4096;
      const message = 0x2000;
      const stack = 16773120;

      function fail(text: string): never {
        throw new Error(`[ZerOS.Hardware.Cpu.CompatFrameCheck] ${text}`);
      }

      function portFor(memory: Uint8Array): StateRoot.Hardware.Cpu.NativeOctetPort {
        return {
          limitBit: CompatTailOrigin + BigInt(memory.length) * 8n,
          load(bit: bigint): number {
            if (bit < CompatTailOrigin || (bit - CompatTailOrigin) % 8n !== 0n) {
              return -1;
            }
            const index = Number((bit - CompatTailOrigin) / 8n);
            if (!Number.isInteger(index) || index < 0 || index >= memory.length) {
              return -1;
            }
            return memory[index] ?? 0;
          },
          store(bit: bigint, value: number): void {
            if (bit < CompatTailOrigin || (bit - CompatTailOrigin) % 8n !== 0n) {
              return;
            }
            const index = Number((bit - CompatTailOrigin) / 8n);
            if (!Number.isInteger(index) || index < 0 || index >= memory.length) {
              return;
            }
            memory[index] = value & 0xff;
          },
        };
      }

      function word(bytes: Uint8Array, index: number): bigint {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        return view.getBigUint64(index * 8, true);
      }

      /** 手写 write 两个字节，再 exit 0。返回地址按用户八位组计算。 */
      export function runCompatFrameCheck(): void {
        const memory = new Uint8Array(spaceBytes);
        const program = [
          0x48, 0xb8, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x48, 0xbf, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x48, 0xbe, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x48, 0xba, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x0f, 0x05,
          0x48, 0xb8, 0x3c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x48, 0xbf, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x0f, 0x05,
        ];
        memory.set(program, entry);
        memory[message] = 0x6f;
        memory[message + 1] = 0x6b;
        const state = freshNativeState(CompatTailOrigin + BigInt(entry) * 8n);
        state.compat = true;
        state.reg[NativeRsp] = BigInt(stack);
        const port = portFor(memory);
        let steps = 0;
        while (steps < 16) {
          steps += 1;
          const outcome = stepNative(state, port);
          if (outcome === "syscall") {
            break;
          }
          if (outcome !== "cont") {
            fail("write did not trap");
          }
        }
        if (steps >= 16) {
          fail("write did not trap");
        }
        const frame = encodeCompatFrame(state);
        if (word(frame, 0) !== 1n || word(frame, 7) !== 1n || word(frame, 6) !== BigInt(message) || word(frame, 2) !== 2n) {
          fail("write frame is wrong");
        }
        if (word(frame, 1) !== 4138n || word(frame, 16) !== 4138n) {
          fail("write return address is wrong");
        }
        if (memory[message] !== 0x6f || memory[message + 1] !== 0x6b) {
          fail("write buffer changed");
        }
        const continued = new Uint8Array(frame);
        const view = new DataView(continued.buffer);
        view.setBigUint64(0, 2n, true);
        if (!applyCompatFrame(state, continued)) {
          fail("resume frame was rejected");
        }
        steps = 0;
        while (steps < 8) {
          steps += 1;
          const outcome = stepNative(state, port);
          if (outcome === "syscall") {
            break;
          }
          if (outcome !== "cont") {
            fail("exit did not trap");
          }
        }
        if (state.reg[NativeRax] !== 60n || state.reg[NativeRdi] !== 0n) {
          fail("exit registers are wrong");
        }
        if (state.reg[NativeRcx] !== 4160n) {
          fail("exit return address is wrong");
        }

        const native = freshNativeState(0n);
        const nativeMemory = new Uint8Array([0x0f, 0x05]);
        const nativePort = {
          limitBit: 16n,
          load(bit: bigint): number {
            const index = Number(bit / 8n);
            if (bit % 8n !== 0n || index < 0 || index >= nativeMemory.length) {
              return -1;
            }
            return nativeMemory[index] ?? 0;
          },
          store(): void {
            fail("native syscall stored");
          },
        };
        if (stepNative(native, nativePort) !== "fault" || native.rip !== 0n) {
          fail("native syscall was accepted");
        }

        const loadAt = 12288;
        memory[loadAt] = 0x48;
        memory[loadAt + 1] = 0x8b;
        memory[loadAt + 2] = 0x07;
        const reader = freshNativeState(CompatTailOrigin + BigInt(loadAt) * 8n);
        reader.compat = true;
        reader.reg[NativeRdi] = BigInt(message);
        if (stepNative(reader, port) !== "cont" || reader.reg[NativeRax] !== 0x6b6fn) {
          fail("a user load did not read the buffer");
        }
        reader.rip = CompatTailOrigin + BigInt(loadAt) * 8n;
        reader.reg[NativeRdi] = 0n;
        reader.reg[NativeRax] = 0n;
        if (stepNative(reader, port) !== "fault" || reader.reg[NativeRax] !== 0n) {
          fail("page zero was readable");
        }

        const good = new Uint8Array(32);
        const described = new DataView(good.buffer);
        described.setBigUint64(0, BigInt(entry), true);
        described.setBigUint64(8, BigInt(stack), true);
        described.setBigUint64(16, BigInt(spaceBytes), true);
        if (compatDescriptor(good) === null) {
          fail("a zero-flag descriptor was rejected");
        }
        described.setBigUint64(24, 1n, true);
        if (compatDescriptor(good) !== null) {
          fail("a flagged descriptor was accepted");
        }
        console.log("compat-frame-ok");
      }
    }
  }
}

ZerOS.Hardware.Cpu.runCompatFrameCheck();
