/**
 * @module ZerOS.Hardware.Memory.Test.StorageCleared
 * @description 用例 StorageCleared
 *
 * 临时总控造完之后：不许留下 0x3；正式可用的颗粒必须全 0；
 * 失败颗粒的存储体必须是空的。
 */

import { ZerOS as CellCountRoot } from "../../Structure/CellCount";
import { ZerOS as MemoryConfigRoot } from "../../Config/MemoryConfig";
import { ZerOS as UnitInitStateRoot } from "../../Enum/UnitInitState";
import { ZerOS as ResultRoot } from "../../Structure/MemoryTestCaseResult";
import { ZerOS as TemporaryRoot } from "../TemporaryMemory";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      export function runStorageCleared(): ResultRoot.Hardware.Memory.MemoryTestCaseResult {
        const name = "StorageCleared" as const;
        try {
          const controller = TemporaryRoot.Hardware.Memory.openTemporaryController();
          const expected = CellCountRoot.Hardware.Memory.cellCountFromUnitSize(
            MemoryConfigRoot.Hardware.Memory.Config.UnitSizeBytes,
          );
          if (expected === null) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(
              name,
              0,
              "标定展开后的 CellCount 不是 Uint32",
            );
          }
          const active = UnitInitStateRoot.Hardware.Memory.UnitInitStateCode.Active;
          const fault = UnitInitStateRoot.Hardware.Memory.UnitInitStateCode.InitFault;
          const unrecoverable =
            UnitInitStateRoot.Hardware.Memory.UnitInitStateCode.Unrecoverable;
          const unitSize = MemoryConfigRoot.Hardware.Memory.Config.UnitSizeBytes;
          if (controller.Units.size < 1) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(name, 0, "临时总控没有颗粒");
          }
          for (const unit of controller.Units.values()) {
            if (unit.InitState === active) {
              if (unit.CellCount !== expected || unit.Cells.length !== unitSize) {
                return ResultRoot.Hardware.Memory.memoryTestCaseResult(
                  name,
                  0,
                  "正式可用颗粒的容量与标定不一致",
                );
              }
              let index = 0;
              while (index < unit.Cells.length) {
                const octet = unit.Cells[index];
                if (octet === undefined || octet !== 0) {
                  return ResultRoot.Hardware.Memory.memoryTestCaseResult(
                    name,
                    0,
                    `八位组 ${String(index)} 不是 0`,
                  );
                }
                index += 1;
              }
            } else if (unit.InitState === fault || unit.InitState === unrecoverable) {
              if (unit.CellCount !== 0 || unit.Cells.length !== 0) {
                return ResultRoot.Hardware.Memory.memoryTestCaseResult(
                  name,
                  0,
                  "失败颗粒仍保留了存储体",
                );
              }
            } else {
              return ResultRoot.Hardware.Memory.memoryTestCaseResult(
                name,
                0,
                `颗粒停在 ${String(unit.InitState)}，阶段 D 之后不应留下该状态`,
              );
            }
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
