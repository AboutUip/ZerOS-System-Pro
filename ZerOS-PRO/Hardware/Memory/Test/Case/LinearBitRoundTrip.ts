/**
 * @module ZerOS.Hardware.Memory.Test.LinearBitRoundTrip
 * @description 用例 LinearBitRoundTrip
 *
 * 线性地址 0 就是第 0 颗的位元 0。写 1 再写回 0。
 */

import { ZerOS as Uint32Root } from "../../Structure/Uint32";
import { ZerOS as ResultRoot } from "../../Structure/MemoryTestCaseResult";
import { ZerOS as TemporaryRoot } from "../TemporaryMemory";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      export function runLinearBitRoundTrip(): ResultRoot.Hardware.Memory.MemoryTestCaseResult {
        const name = "LinearBitRoundTrip" as const;
        try {
          const controller = TemporaryRoot.Hardware.Memory.openTemporaryController();
          const unit = TemporaryRoot.Hardware.Memory.activeFirstUnit(controller);
          if (unit === null) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(name, 0, "没有正式可用颗粒");
          }
          const zero = Uint32Root.Hardware.Memory.uint32OrThrow(0, name);
          controller.WriteLinearBit(0n, 1);
          const viaUnit = unit.ReadBit(zero);
          const viaLinear = controller.ReadLinearBit(0n);
          controller.WriteLinearBit(0n, 0);
          if (viaUnit !== 1 || viaLinear !== 1 || unit.ReadBit(zero) !== 0) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(name, 0, "线性地址 0 没有对上第 0 颗的位元 0");
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
