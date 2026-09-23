/**
 * @module ZerOS.Hardware.Memory.Test.InactiveReportsUnitNotActive
 * @description 用例 InactiveReportsUnitNotActive
 *
 * 尚未晋升到 0x4 的颗粒，即使下标也越界，失败标号仍必须是 UnitNotActive。
 * 这一颗不进入总控，所以不会被阶段 D 改成 0x4。
 */

import { ZerOS as MemoryUnitRoot } from "../../Unit/MemoryUnit";
import { ZerOS as Uint32Root } from "../../Structure/Uint32";
import { ZerOS as UnitInitStateRoot } from "../../Enum/UnitInitState";
import { ZerOS as ExceptionCodeRoot } from "../../Enum/ExceptionCode";
import { ZerOS as ResultRoot } from "../../Structure/MemoryTestCaseResult";
import { ZerOS as ExpectRoot } from "../TestExpect";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      export function runInactiveReportsUnitNotActive(): ResultRoot.Hardware.Memory.MemoryTestCaseResult {
        const name = "InactiveReportsUnitNotActive" as const;
        try {
          const ordinal = Uint32Root.Hardware.Memory.uint32OrThrow(
            0,
            "ZerOS.Hardware.Memory.Test.InactiveReportsUnitNotActive",
          );
          const unit = new MemoryUnitRoot.Hardware.Memory.MemoryUnit(ordinal);
          const complete = UnitInitStateRoot.Hardware.Memory.UnitInitStateCode.InitComplete;
          if (unit.InitState !== complete) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(
              name,
              0,
              `单颗构造结束时期望 0x3，实际 ${String(unit.InitState)}`,
            );
          }
          const beforeLength = unit.Cells.length;
          const beforeExceptions = unit.Exceptions.length;
          let threw = false;
          try {
            unit.ReadBit(Uint32Root.Hardware.Memory.Uint32Max);
          } catch {
            threw = true;
          }
          if (
            !threw ||
            unit.Cells.length !== beforeLength ||
            unit.Exceptions.length !== beforeExceptions + 1 ||
            !ExpectRoot.Hardware.Memory.lastIsAbort(
              unit.Exceptions,
              ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.UnitNotActive,
            )
          ) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(
              name,
              0,
              "未正式可用且下标越界时，没有按 UnitNotActive 拒绝",
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
