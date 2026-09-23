/**
 * @module ZerOS.Hardware.Memory.Test.BitRoundTrip
 * @description 用例 BitRoundTrip
 *
 * 在正式可用的第 0 颗上写一个位元，再读回来。相邻位必须保持 0。写完恢复。
 */

import { ZerOS as Uint32Root } from "../../Structure/Uint32";
import { ZerOS as ResultRoot } from "../../Structure/MemoryTestCaseResult";
import { ZerOS as TemporaryRoot } from "../TemporaryMemory";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      export function runBitRoundTrip(): ResultRoot.Hardware.Memory.MemoryTestCaseResult {
        const name = "BitRoundTrip" as const;
        try {
          const controller = TemporaryRoot.Hardware.Memory.openTemporaryController();
          const unit = TemporaryRoot.Hardware.Memory.activeFirstUnit(controller);
          if (unit === null) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(
              name,
              0,
              "没有可供位元往返的正式可用颗粒",
            );
          }
          const zero = Uint32Root.Hardware.Memory.uint32OrThrow(0, name);
          const one = Uint32Root.Hardware.Memory.uint32OrThrow(1, name);
          unit.WriteBit(zero, 1);
          const written = unit.ReadBit(zero);
          const neighbor = unit.ReadBit(one);
          unit.WriteBit(zero, 0);
          const restored = unit.ReadBit(zero);
          if (written !== 1 || neighbor !== 0 || restored !== 0) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(
              name,
              0,
              `写后 ${String(written)}，相邻位 ${String(neighbor)}，恢复后 ${String(restored)}`,
            );
          }
          return ResultRoot.Hardware.Memory.memoryTestCaseResult(name, 1, "");
        } catch (caught: unknown) {
          return ResultRoot.Hardware.Memory.memoryTestCaseResult(
            name,
            0,
            caught instanceof Error ? caught.message : String(caught),
          );
        }
      }
    }
  }
}
