/**
 * @module ZerOS.Hardware.Motherboard.ExecuteMemoryInstruction
 * @description 把一条内存指令执行到通道上
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 执行发生在主板线程。操作码拆成方向和字宽，然后调用通道的 Read 或 Write。
 * 一次调用只做一条指令。不取下一条，也不把多条指令排成程序。
 * CPU 以后调用的是这里，不是内存自己的高级端口。
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

import { ZerOS as ChannelDirectionRoot } from "../Enum/ChannelDirection";
import { ZerOS as MemoryOpcodeRoot } from "../Enum/MemoryOpcode";
import { type ZerOS as MemoryInstructionRoot } from "../Structure/MemoryInstruction";
import { ZerOS as MemoryChannelRoot } from "./MemoryChannel";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      type MemoryInstruction = MemoryInstructionRoot.Hardware.Motherboard.MemoryInstruction;

      const ChannelDirectionRead = ChannelDirectionRoot.Hardware.Motherboard.ChannelDirectionRead;
      const memoryOpcodeDirection = MemoryOpcodeRoot.Hardware.Motherboard.memoryOpcodeDirection;
      const memoryOpcodeWidth = MemoryOpcodeRoot.Hardware.Motherboard.memoryOpcodeWidth;
      const Read = MemoryChannelRoot.Hardware.Motherboard.Read;
      const Write = MemoryChannelRoot.Hardware.Motherboard.Write;
      const executePrefix = "[ZerOS.Hardware.Motherboard.MemoryInstruction]";

      /**
       * 执行一条 Load。
       * 操作码若是 Store，通道一次都不访问。返回值是这次读出的数据。
       */
      export function ExecuteLoad(instruction: MemoryInstruction): bigint {
        const direction = memoryOpcodeDirection(instruction.Opcode);
        if (direction !== ChannelDirectionRead) {
          throw new Error(`${executePrefix} 这条指令不是读`);
        }
        const width = memoryOpcodeWidth(instruction.Opcode);
        return Read(instruction.Address, width);
      }

      /**
       * 执行一条 Store。
       * 操作码若是 Load，通道一次都不访问。Data 原样送进通道，非法值由内存端口拒绝。
       */
      export function ExecuteStore(instruction: MemoryInstruction): void {
        const direction = memoryOpcodeDirection(instruction.Opcode);
        if (direction === ChannelDirectionRead) {
          throw new Error(`${executePrefix} 这条指令不是写`);
        }
        const width = memoryOpcodeWidth(instruction.Opcode);
        Write(instruction.Address, width, instruction.Data);
      }
    }
  }
}
