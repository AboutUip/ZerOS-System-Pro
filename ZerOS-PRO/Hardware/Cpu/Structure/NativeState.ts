/**
 * @module ZerOS.Hardware.Cpu.NativeState
 * @description 原生取指用的寄存器帧和八位组口
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只放 §4.12 的帧和按位地址读写一个八位组的口。
 * 解码和执行在 Native/NativeRun.ts。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 帧
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as RegisterRoot } from "../Enum/NativeRegister";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      const NativeRegisterCount = RegisterRoot.Hardware.Cpu.NativeRegisterCount;

      /**
       * 16 个整数寄存器、线性位地址上的指令指针，以及五个条件码。
       * 寄存器里当作指针使用的值是八位组地址，不是位地址。
       * compat 为真时，寄存器里的地址是兼容任务的用户八位组地址。
       */
      export interface NativeState {
        reg: bigint[];
        rip: bigint;
        cf: boolean;
        zf: boolean;
        sf: boolean;
        of: boolean;
        pf: boolean;
        /** 这份帧属于兼容任务。原生程序保持假。 */
        compat: boolean;
        /** 兼容任务的 fs 基址。原生程序保持 0。 */
        fsbase: bigint;
      }

      /** 调用方按位地址提供存储。越界由执行循环判失败，不在这里抛错。 */
      export interface NativeOctetPort {
        readonly limitBit: bigint;
        load(bit: bigint): number;
        store(bit: bigint, value: number): void;
        /** 位地址已经落在安全整数里时走这里，取指不必为每个八位组再造一个大整数。 */
        loadNumber?(bit: number): number;
        storeNumber?(bit: number, value: number): void;
      }

      export type NativeStop =
        | { readonly kind: "halt"; readonly state: NativeState }
        | { readonly kind: "fault"; readonly state: NativeState }
        | { readonly kind: "wait"; readonly state: NativeState }
        | { readonly kind: "yield"; readonly state: NativeState };

      /**
       * 0F 3F 交给核心去完成。
       * next 是这条之后的位地址。指令指针还停在这条上，成功之后由调用方改过去。
       */
      export interface NativeEscape {
        readonly kind: "escape";
        readonly opcode: number;
        readonly regs: readonly number[];
        readonly next: bigint;
      }

      export type NativeStep = "cont" | "halt" | "fault" | "syscall" | NativeEscape;

      /** 寄存器和条件码清零。指令指针由调用方给定。 */
      export function freshNativeState(rip: bigint): NativeState {
        const reg: bigint[] = [];
        for (let index = 0; index < NativeRegisterCount; index += 1) {
          reg.push(0n);
        }
        return { reg, rip, cf: false, zf: false, sf: false, of: false, pf: false, compat: false, fsbase: 0n };
      }
    }
  }
}
