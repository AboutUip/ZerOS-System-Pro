/**
 * @module ZerOS.Hardware.Memory.Test.CapacityIsOctetSum
 * @description 用例 CapacityIsOctetSum
 *
 * 临时总控上各颗 Cells.length 之和就是总容量公式。
 * 这次调用不得改写配置面上的 TotalSizeBytes 或 MemoryId。
 */

import { ZerOS as MemoryConfigRoot } from "../../Config/MemoryConfig";
import { ZerOS as CapacityRoot } from "../../Structure/Capacity";
import { ZerOS as ResultRoot } from "../../Structure/MemoryTestCaseResult";
import { ZerOS as TemporaryRoot } from "../TemporaryMemory";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      export function runCapacityIsOctetSum(): ResultRoot.Hardware.Memory.MemoryTestCaseResult {
        const name = "CapacityIsOctetSum" as const;
        try {
          const beforeTotal = MemoryConfigRoot.Hardware.Memory.Config.TotalSizeBytes;
          const beforeId = MemoryConfigRoot.Hardware.Memory.Config.MemoryId;
          const controller = TemporaryRoot.Hardware.Memory.openTemporaryController();
          const lengths: number[] = [];
          for (const unit of controller.Units.values()) {
            lengths.push(unit.Cells.length);
          }
          const total = CapacityRoot.Hardware.Memory.totalOctetCount(lengths);
          let manual = 0n;
          for (const length of lengths) {
            manual += BigInt(length);
          }
          if (
            total !== manual ||
            total < 1n ||
            beforeTotal !== 0n ||
            MemoryConfigRoot.Hardware.Memory.Config.TotalSizeBytes !== beforeTotal ||
            MemoryConfigRoot.Hardware.Memory.Config.MemoryId !== beforeId
          ) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(
              name,
              0,
              "总容量公式没有等于八位组之和，或临时总控改写了配置面",
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
