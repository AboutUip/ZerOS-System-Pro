/**
 * @module ZerOS.Hardware.Memory.Test.UnitOrdinalDense
 * @description 用例 UnitOrdinalDense
 *
 * 临时总控上的序号必须正好是 0 .. UnitCount-1 各一次。
 */

import { ZerOS as MemoryConfigRoot } from "../../Config/MemoryConfig";
import { ZerOS as ResultRoot } from "../../Structure/MemoryTestCaseResult";
import { ZerOS as TemporaryRoot } from "../TemporaryMemory";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      export function runUnitOrdinalDense(): ResultRoot.Hardware.Memory.MemoryTestCaseResult {
        const name = "UnitOrdinalDense" as const;
        try {
          const controller = TemporaryRoot.Hardware.Memory.openTemporaryController();
          const count = MemoryConfigRoot.Hardware.Memory.Config.UnitCount;
          const seen = new Set<number>();
          for (const unit of controller.Units.values()) {
            seen.add(unit.UnitOrdinal);
          }
          if (seen.size !== count) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(
              name,
              0,
              `序号个数 ${String(seen.size)} 不等于 UnitCount ${String(count)}`,
            );
          }
          let ordinal = 0;
          while (ordinal < count) {
            if (!seen.has(ordinal)) {
              return ResultRoot.Hardware.Memory.memoryTestCaseResult(
                name,
                0,
                `缺少序号 ${String(ordinal)}`,
              );
            }
            ordinal += 1;
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
