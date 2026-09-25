/**
 * @module ZerOS.Hardware.Motherboard.MemoryOpcode
 * @description 内存通道上的指令操作码
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 操作码是这块主板自己的指令封装，不是汇编编码，也不是 ZMP1 字段。
 * 形状参考汇编里的访存：读和写分开，字宽写在操作码里。
 * 一条操作码只对应通道上的一次访问。不取指，不调度，不解释一段程序。
 * CPU 以后执行这些操作码，仍然只落到通道的方向和字宽上。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 操作码
 *   3. 门闩与通道含义
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as ChannelDirectionRoot } from "./ChannelDirection";
import { ZerOS as ChannelWidthRoot } from "./ChannelWidth";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      type ChannelDirection = ChannelDirectionRoot.Hardware.Motherboard.ChannelDirection;
      type ChannelWidth = ChannelWidthRoot.Hardware.Motherboard.ChannelWidth;

      const ChannelDirectionRead = ChannelDirectionRoot.Hardware.Motherboard.ChannelDirectionRead;
      const ChannelDirectionWrite = ChannelDirectionRoot.Hardware.Motherboard.ChannelDirectionWrite;
      const ChannelWidthBit = ChannelWidthRoot.Hardware.Motherboard.ChannelWidthBit;
      const ChannelWidthOctet = ChannelWidthRoot.Hardware.Motherboard.ChannelWidthOctet;
      const ChannelWidth16 = ChannelWidthRoot.Hardware.Motherboard.ChannelWidth16;
      const ChannelWidth32 = ChannelWidthRoot.Hardware.Motherboard.ChannelWidth32;
      const ChannelWidth64 = ChannelWidthRoot.Hardware.Motherboard.ChannelWidth64;

      /* ------------------------------------------------------------------ */
      /* 2. 操作码                                                           */
      /* ------------------------------------------------------------------ */

      /** 读 1 位。数据从通道返回，指令里的 Data 不参与这次读。 */
      export const MemoryOpcodeLoadBit = 1;

      /** 写 1 位。Data 只能是 0 或 1，超出时由内存端口拒绝。 */
      export const MemoryOpcodeStoreBit = 2;

      /** 读 8 位。 */
      export const MemoryOpcodeLoadOctet = 3;

      /** 写 8 位。 */
      export const MemoryOpcodeStoreOctet = 4;

      /** 读 16 位。地址必须是八位组起点。 */
      export const MemoryOpcodeLoad16 = 5;

      /** 写 16 位。地址必须是八位组起点。 */
      export const MemoryOpcodeStore16 = 6;

      /** 读 32 位。地址必须是八位组起点。 */
      export const MemoryOpcodeLoad32 = 7;

      /** 写 32 位。地址必须是八位组起点。 */
      export const MemoryOpcodeStore32 = 8;

      /** 读 64 位。地址必须是八位组起点。 */
      export const MemoryOpcodeLoad64 = 9;

      /** 写 64 位。地址必须是八位组起点。 */
      export const MemoryOpcodeStore64 = 10;

      /** 读二进制 32 的位型。通道上的整数是这 32 位的补码。 */
      export const MemoryOpcodeLoadFloat32 = 11;

      /** 写二进制 32 的位型。 */
      export const MemoryOpcodeStoreFloat32 = 12;

      /** 读二进制 64 的位型。通道上的整数是这 64 位的补码。 */
      export const MemoryOpcodeLoadFloat64 = 13;

      /** 写二进制 64 的位型。 */
      export const MemoryOpcodeStoreFloat64 = 14;

      /**
       * 内存指令操作码。封闭集合。
       * 数值只在主板的指令封装里使用，以后可以原样交给 CPU，不必改成某一种汇编。
       */
      export type MemoryOpcode =
        | 1
        | 2
        | 3
        | 4
        | 5
        | 6
        | 7
        | 8
        | 9
        | 10
        | 11
        | 12
        | 13
        | 14;

      /* ------------------------------------------------------------------ */
      /* 3. 门闩与通道含义                                                   */
      /* ------------------------------------------------------------------ */

      /**
       * 把数字收成操作码。
       * 集合外的值返回 null。调用方不得把它当成一次通道访问。
       */
      export function toMemoryOpcode(value: number): MemoryOpcode | null {
        if (
          value === MemoryOpcodeLoadBit
          || value === MemoryOpcodeStoreBit
          || value === MemoryOpcodeLoadOctet
          || value === MemoryOpcodeStoreOctet
          || value === MemoryOpcodeLoad16
          || value === MemoryOpcodeStore16
          || value === MemoryOpcodeLoad32
          || value === MemoryOpcodeStore32
          || value === MemoryOpcodeLoad64
          || value === MemoryOpcodeStore64
          || value === MemoryOpcodeLoadFloat32
          || value === MemoryOpcodeStoreFloat32
          || value === MemoryOpcodeLoadFloat64
          || value === MemoryOpcodeStoreFloat64
        ) {
          return value;
        }
        return null;
      }

      /**
       * 操作码里的字宽。
       * 读和写成对，同一对共用一个通道字宽。
       */
      export function memoryOpcodeWidth(opcode: MemoryOpcode): ChannelWidth {
        if (opcode === MemoryOpcodeLoadBit || opcode === MemoryOpcodeStoreBit) {
          return ChannelWidthBit;
        }
        if (opcode === MemoryOpcodeLoadOctet || opcode === MemoryOpcodeStoreOctet) {
          return ChannelWidthOctet;
        }
        if (opcode === MemoryOpcodeLoad16 || opcode === MemoryOpcodeStore16) {
          return ChannelWidth16;
        }
        if (opcode === MemoryOpcodeLoad32 || opcode === MemoryOpcodeStore32 || opcode === MemoryOpcodeLoadFloat32 || opcode === MemoryOpcodeStoreFloat32) {
          return ChannelWidth32;
        }
        return ChannelWidth64;
      }

      /**
       * 操作码里的方向。
       * 名字带 Load 的是读，带 Store 的是写。通道不再从别的字段猜测方向。
       */
      export function memoryOpcodeDirection(opcode: MemoryOpcode): ChannelDirection {
        if (
          opcode === MemoryOpcodeLoadBit
          || opcode === MemoryOpcodeLoadOctet
          || opcode === MemoryOpcodeLoad16
          || opcode === MemoryOpcodeLoad32
          || opcode === MemoryOpcodeLoad64
          || opcode === MemoryOpcodeLoadFloat32
          || opcode === MemoryOpcodeLoadFloat64
        ) {
          return ChannelDirectionRead;
        }
        return ChannelDirectionWrite;
      }
    }
  }
}
