/**
 * @module ZerOS.Hardware.Memory.Test.ShallowCutShape
 * @description 用例 ShallowCutShape
 *
 * 浅切根的块数、下标、深度和空子块必须符合浅切。
 * 各块 BitLength 之和等于按序号拼接的 CellCount 之和，任意两块相差至多 1。
 */

import { ZerOS as MemoryConfigRoot } from "../../Config/MemoryConfig";
import type { ZerOS as Uint32Root } from "../../Structure/Uint32";
import { ZerOS as BlockSpanRoot } from "../../Structure/BlockSpan";
import { ZerOS as ResultRoot } from "../../Structure/MemoryTestCaseResult";
import { ZerOS as TemporaryRoot } from "../TemporaryMemory";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      export function runShallowCutShape(): ResultRoot.Hardware.Memory.MemoryTestCaseResult {
        const name = "ShallowCutShape" as const;
        try {
          const controller = TemporaryRoot.Hardware.Memory.openTemporaryController();
          const shallow = MemoryConfigRoot.Hardware.Memory.Config.ShallowDimension;
          if (controller.Blocks.length !== shallow) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(
              name,
              0,
              `块数 ${String(controller.Blocks.length)} 不等于浅维度 ${String(shallow)}`,
            );
          }

          // 位元线按 UnitOrdinal 升序拼接，不能按容量大小重排。
          const ordered: (Uint32Root.Hardware.Memory.Uint32 | undefined)[] = [];
          for (const unit of controller.Units.values()) {
            ordered[unit.UnitOrdinal] = unit.CellCount;
          }
          const cellCounts: Uint32Root.Hardware.Memory.Uint32[] = [];
          for (const count of ordered) {
            if (count === undefined) {
              return ResultRoot.Hardware.Memory.memoryTestCaseResult(
                name,
                0,
                "序号不连续，无法拼接位元线",
              );
            }
            cellCounts.push(count);
          }
          const total = BlockSpanRoot.Hardware.Memory.totalBitCount(cellCounts);

          let lengthSum = 0n;
          let minLength: number | null = null;
          let maxLength: number | null = null;
          let index = 0;
          while (index < controller.Blocks.length) {
            const block = controller.Blocks[index];
            if (
              block?.BlockIndex !== index ||
              block.NestingDepth !== 1 ||
              block.Children.length !== 0
            ) {
              return ResultRoot.Hardware.Memory.memoryTestCaseResult(
                name,
                0,
                `第 ${String(index)} 块的下标、深度或子块不符合浅切`,
              );
            }
            if (block.ChildIndex !== null && block.ChildIndex < shallow) {
              return ResultRoot.Hardware.Memory.memoryTestCaseResult(
                name,
                0,
                "浅切根的 ChildIndex 落在子块下标区间里",
              );
            }
            lengthSum += BigInt(block.BitLength);
            if (minLength === null || block.BitLength < minLength) {
              minLength = block.BitLength;
            }
            if (maxLength === null || block.BitLength > maxLength) {
              maxLength = block.BitLength;
            }
            index += 1;
          }
          if (
            lengthSum !== total ||
            minLength === null ||
            maxLength === null ||
            maxLength - minLength > 1
          ) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(
              name,
              0,
              "位元跨度没有盖满位元线，或块长相差超过 1",
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
