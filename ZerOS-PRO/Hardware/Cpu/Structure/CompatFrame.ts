/**
 * @module ZerOS.Hardware.Cpu.CompatFrame
 * @description 兼容任务的尾区换算和陷入帧
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 用户八位组地址换成尾区里的线性位地址，以及 19 个字的陷入帧。
 * 不取指，也不改别的核心。全机只有一份兼容任务的规则在 CPU 运行时。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 换算
 *   3. 帧
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as ConfigRoot } from "../Config/CpuConfig";
import type { ZerOS as StateRoot } from "./NativeState";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      const MapEndBits = ConfigRoot.Hardware.Cpu.Config.MapEndBits;
      const CompatSpaceBytes = ConfigRoot.Hardware.Cpu.Config.CompatSpaceBytes;
      const CompatUserFloor = ConfigRoot.Hardware.Cpu.Config.CompatUserFloor;
      type NativeState = StateRoot.Hardware.Cpu.NativeState;

      /** 尾区起点的线性位地址。映射区到这里为止，不包含这 16 MiB。 */
      export const CompatTailOrigin = BigInt(MapEndBits);
      const spaceBytes = BigInt(CompatSpaceBytes);
      const userFloor = BigInt(CompatUserFloor);
      const frameWords = 19;
      const frameOctets = frameWords * 8;
      const wordBits = 64n;
      const wordMask = (1n << wordBits) - 1n;

      function unsigned(value: bigint): bigint {
        return value & wordMask;
      }

      /**
       * 用户八位组地址换成尾区里的线性位地址。
       * 前 4096 个八位组只给陷入帧。任务自己的访存到不了。
       */
      export function compatUserBit(byte: bigint): bigint | null {
        if (byte < userFloor || byte >= spaceBytes) {
          return null;
        }
        return CompatTailOrigin + byte * 8n;
      }

      /** 尾区里的线性位地址换回用户八位组地址。页 0 和尾区外面都不是。 */
      export function compatUserOfBit(bit: bigint): bigint | null {
        if (bit < CompatTailOrigin || (bit - CompatTailOrigin) % 8n !== 0n) {
          return null;
        }
        return compatUserBit((bit - CompatTailOrigin) / 8n) === null
          ? null
          : (bit - CompatTailOrigin) / 8n;
      }

      /** CF、PF、ZF、SF、OF 收成 rflags。保留位 1 保持置位。 */
      export function compatFlags(state: NativeState): bigint {
        let flags = 0x2n;
        if (state.cf) {
          flags |= 1n;
        }
        if (state.pf) {
          flags |= 1n << 2n;
        }
        if (state.zf) {
          flags |= 1n << 6n;
        }
        if (state.sf) {
          flags |= 1n << 7n;
        }
        if (state.of) {
          flags |= 1n << 11n;
        }
        return flags;
      }

      /**
       * 32 个八位组的描述符。四个小端 64 位：入口、rsp、空间长度、标志。
       * 标志必须是 0，空间长度必须是这 16 MiB，rsp 按 16 个八位组对齐。
       */
      export function compatDescriptor(
        bytes: Uint8Array,
      ): { readonly entry: bigint; readonly rsp: bigint; readonly space: bigint; readonly flags: bigint } | null {
        if (bytes.length !== 32) {
          return null;
        }
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const entry = view.getBigUint64(0, true);
        const rsp = view.getBigUint64(8, true);
        const space = view.getBigUint64(16, true);
        const flags = view.getBigUint64(24, true);
        if (flags !== 0n || space !== spaceBytes || rsp % 16n !== 0n) {
          return null;
        }
        if (compatUserBit(entry) === null || compatUserBit(rsp) === null) {
          return null;
        }
        return { entry, rsp, space, flags };
      }

      /**
       * 把当前帧写成 152 个八位组。
       * 顺序是 16 个寄存器，然后用户八位组地址的 rip、rflags、fsbase。
       */
      export function encodeCompatFrame(state: NativeState): Uint8Array {
        const bytes = new Uint8Array(frameOctets);
        const view = new DataView(bytes.buffer);
        for (let index = 0; index < 16; index += 1) {
          view.setBigUint64(index * 8, unsigned(state.reg[index] ?? 0n), true);
        }
        const user = compatUserOfBit(state.rip) ?? 0n;
        view.setBigUint64(16 * 8, unsigned(user), true);
        view.setBigUint64(17 * 8, unsigned(compatFlags(state)), true);
        view.setBigUint64(18 * 8, unsigned(state.fsbase), true);
        return bytes;
      }

      /**
       * 从陷入帧写回寄存器。
       * 帧里的 rip 是用户八位组地址，这里换成尾区里的线性位地址。
       */
      export function applyCompatFrame(state: NativeState, bytes: Uint8Array): boolean {
        if (bytes.length !== frameOctets) {
          return false;
        }
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const user = view.getBigUint64(16 * 8, true);
        const bit = compatUserBit(user);
        if (bit === null) {
          return false;
        }
        for (let index = 0; index < 16; index += 1) {
          state.reg[index] = view.getBigUint64(index * 8, true);
        }
        const flags = view.getBigUint64(17 * 8, true);
        state.rip = bit;
        state.cf = (flags & 1n) !== 0n;
        state.pf = (flags & 4n) !== 0n;
        state.zf = (flags & 64n) !== 0n;
        state.sf = (flags & 128n) !== 0n;
        state.of = (flags & (1n << 11n)) !== 0n;
        state.fsbase = view.getBigUint64(18 * 8, true);
        state.compat = true;
        return true;
      }
    }
  }
}
