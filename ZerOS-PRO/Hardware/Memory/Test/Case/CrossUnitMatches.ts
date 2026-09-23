/**
 * @module ZerOS.Hardware.Memory.Test.CrossUnitMatches
 * @description 用例 CrossUnitMatches
 *
 * 总控按序号读写，结果必须和那一颗自己的端口一致。
 */

import { ZerOS as Uint32Root } from "../../Structure/Uint32";
import { ZerOS as ResultRoot } from "../../Structure/MemoryTestCaseResult";
import { ZerOS as TemporaryRoot } from "../TemporaryMemory";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      export function runCrossUnitMatches(): ResultRoot.Hardware.Memory.MemoryTestCaseResult {
        const name = "CrossUnitMatches" as const;
        try {
          const controller = TemporaryRoot.Hardware.Memory.openTemporaryController();
          const unit = TemporaryRoot.Hardware.Memory.activeFirstUnit(controller);
          if (unit === null) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(name, 0, "没有正式可用颗粒");
          }
          const zero = Uint32Root.Hardware.Memory.uint32OrThrow(0, name);
          unit.WriteBit(zero, 1);
          const viaController = controller.ReadBit(unit.UnitOrdinal, zero);
          controller.WriteBit(unit.UnitOrdinal, zero, 0);
          const viaUnit = unit.ReadBit(zero);
          if (viaController !== 1 || viaUnit !== 0) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(
              name,
              0,
              `总控读到 ${String(viaController)}，颗粒恢复后 ${String(viaUnit)}`,
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
