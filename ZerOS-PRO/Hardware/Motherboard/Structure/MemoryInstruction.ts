/**
 * @module ZerOS.Hardware.Motherboard.MemoryInstruction
 * @description 一条内存通道指令
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 一条指令只描述一次访存：操作码、线性位元地址、写入数据。
 * 操作码已经包含方向和字宽。这里不执行，也不检查地址对齐，对齐由通道在执行时拒绝。
 * 不是汇编语句，没有寄存器、立即数布局或机器码字节。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 指令
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as MemoryOpcodeRoot } from "../Enum/MemoryOpcode";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      type MemoryOpcode = MemoryOpcodeRoot.Hardware.Motherboard.MemoryOpcode;

      const toMemoryOpcode = MemoryOpcodeRoot.Hardware.Motherboard.toMemoryOpcode;
      const instructionPrefix = "[ZerOS.Hardware.Motherboard.MemoryInstruction]";

      /**
       * 一条内存指令。
       * Load 的 Data 不参与读取，固定写 0n。Store 的 Data 是要写入通道的值。
       */
      export interface MemoryInstruction {
        /** 封闭操作码。方向和字宽都在这里。 */
        readonly Opcode: MemoryOpcode;

        /** 线性位元地址。字宽大于 1 时必须是八位组起点，否则执行时通道拒绝。 */
        readonly Address: bigint;

        /** 写入数据。Load 不使用它。 */
        readonly Data: bigint;
      }

      /**
       * 组一条指令。
       * 操作码不在封闭集合里就停，不产生一条半成品。地址和数据原样留下，值域交给通道和内存端口。
       */
      export function createMemoryInstruction(
        opcode: number,
        address: bigint,
        data: bigint,
      ): MemoryInstruction {
        const accepted = toMemoryOpcode(opcode);
        if (accepted === null) {
          throw new Error(`${instructionPrefix} 操作码不是内存指令`);
        }
        return {
          Opcode: accepted,
          Address: address,
          Data: data,
        };
      }
    }
  }
}
