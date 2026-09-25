/**
 * @module ZerOS.Hardware.Motherboard.BoardSelfCheck
 * @description 主板上电后的第一段自检
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 在坐内存、坐 CPU 之前核对这块板自己的名单和指令表。
 * 不访问内存，不创建核心，也不认识显示器。
 * 失败就停，后面的设备不再自检。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. runBoardSelfCheck
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as SupportRoot } from "../Config/BoardSupport";
import { ZerOS as DirectionRoot } from "../Enum/ChannelDirection";
import { ZerOS as WidthRoot } from "../Enum/ChannelWidth";
import { ZerOS as OpcodeRoot } from "../Enum/MemoryOpcode";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      const SupportedMemoryProtocols = SupportRoot.Hardware.Motherboard.SupportedMemoryProtocols;
      const SupportedCpuProtocols = SupportRoot.Hardware.Motherboard.SupportedCpuProtocols;
      const SupportedGpuProtocols = SupportRoot.Hardware.Motherboard.SupportedGpuProtocols;
      const SupportedExpansionProtocols = SupportRoot.Hardware.Motherboard.SupportedExpansionProtocols;
      const SupportedExchangeProtocols = SupportRoot.Hardware.Motherboard.SupportedExchangeProtocols;
      const ChannelDirectionRead = DirectionRoot.Hardware.Motherboard.ChannelDirectionRead;
      const ChannelDirectionWrite = DirectionRoot.Hardware.Motherboard.ChannelDirectionWrite;
      const ChannelWidthBit = WidthRoot.Hardware.Motherboard.ChannelWidthBit;
      const ChannelWidthOctet = WidthRoot.Hardware.Motherboard.ChannelWidthOctet;
      const ChannelWidth16 = WidthRoot.Hardware.Motherboard.ChannelWidth16;
      const ChannelWidth32 = WidthRoot.Hardware.Motherboard.ChannelWidth32;
      const ChannelWidth64 = WidthRoot.Hardware.Motherboard.ChannelWidth64;
      const toMemoryOpcode = OpcodeRoot.Hardware.Motherboard.toMemoryOpcode;
      const memoryOpcodeWidth = OpcodeRoot.Hardware.Motherboard.memoryOpcodeWidth;
      const memoryOpcodeDirection = OpcodeRoot.Hardware.Motherboard.memoryOpcodeDirection;
      const checkPrefix = "[ZerOS.Hardware.Motherboard.BoardSelfCheck]";

      function fail(message: string): never {
        throw new Error(`${checkPrefix} ${message}`);
      }

      function includes(list: readonly string[], protocol: string): boolean {
        for (const item of list) {
          if (item === protocol) {
            return true;
          }
        }
        return false;
      }

      /**
       * 核对主板在接入任何设备之前必须成立的事实。
       * 协议名单和指令操作码都属于这块板，不向内存或 CPU 借结果。
       */
      export function runBoardSelfCheck(): void {
        if (!includes(SupportedMemoryProtocols, "ZMP1")) {
          fail("内存协议名单里没有 ZMP1");
        }
        if (!includes(SupportedCpuProtocols, "ZCP1")) {
          fail("CPU 协议名单里没有 ZCP1");
        }
        if (!includes(SupportedGpuProtocols, "ZGP1")) {
          fail("显卡协议名单里没有 ZGP1");
        }
        if (!includes(SupportedExpansionProtocols, "ZXP1")) {
          fail("扩展口协议名单里没有 ZXP1");
        }
        if (!includes(SupportedExchangeProtocols, "ZXD1")) {
          fail("扩展交换协议名单里没有 ZXD1");
        }
        const expected: readonly (readonly [number, number, number])[] = [
          [1, ChannelWidthBit, ChannelDirectionRead],
          [2, ChannelWidthBit, ChannelDirectionWrite],
          [3, ChannelWidthOctet, ChannelDirectionRead],
          [4, ChannelWidthOctet, ChannelDirectionWrite],
          [5, ChannelWidth16, ChannelDirectionRead],
          [6, ChannelWidth16, ChannelDirectionWrite],
          [7, ChannelWidth32, ChannelDirectionRead],
          [8, ChannelWidth32, ChannelDirectionWrite],
          [9, ChannelWidth64, ChannelDirectionRead],
          [10, ChannelWidth64, ChannelDirectionWrite],
          [11, ChannelWidth32, ChannelDirectionRead],
          [12, ChannelWidth32, ChannelDirectionWrite],
          [13, ChannelWidth64, ChannelDirectionRead],
          [14, ChannelWidth64, ChannelDirectionWrite],
        ];
        for (const row of expected) {
          const opcode = toMemoryOpcode(row[0]);
          if (opcode === null) {
            fail("指令表缺了操作码");
          }
          if (memoryOpcodeWidth(opcode) !== row[1] || memoryOpcodeDirection(opcode) !== row[2]) {
            fail("指令操作码和通道字宽或方向对不上");
          }
        }
        if (toMemoryOpcode(0) !== null || toMemoryOpcode(15) !== null) {
          fail("指令表收进了封闭集合以外的操作码");
        }
      }
    }
  }
}
