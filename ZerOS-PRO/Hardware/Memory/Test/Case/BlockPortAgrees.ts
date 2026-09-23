/**
 * @module ZerOS.Hardware.Memory.Test.BlockPortAgrees
 * @description 用例 BlockPortAgrees
 *
 * 第 0 块有位元时，块内偏移 0 的写入必须出现在线性落点那一颗上。
 * 第 0 块长度为 0 时，偏移 0 必须记成 BlockBitOffsetOutOfRange。
 */

import { ZerOS as Uint32Root } from "../../Structure/Uint32";
import { ZerOS as BlockSpanRoot } from "../../Structure/BlockSpan";
import { ZerOS as ExceptionCodeRoot } from "../../Enum/ExceptionCode";
import { ZerOS as ResultRoot } from "../../Structure/MemoryTestCaseResult";
import { ZerOS as TemporaryRoot } from "../TemporaryMemory";
import { ZerOS as ExpectRoot } from "../TestExpect";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      export function runBlockPortAgrees(): ResultRoot.Hardware.Memory.MemoryTestCaseResult {
        const name = "BlockPortAgrees" as const;
        try {
          const controller = TemporaryRoot.Hardware.Memory.openTemporaryController();
          const block = controller.Blocks[0];
          if (block?.BlockIndex !== 0) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(name, 0, "没有第 0 块");
          }
          const zero = Uint32Root.Hardware.Memory.uint32OrThrow(0, name);
          if (block.BitLength === 0) {
            const before = controller.Exceptions.length;
            let threw = false;
            try {
              block.ReadBit(zero);
            } catch {
              threw = true;
            }
            if (
              !threw ||
              controller.Exceptions.length !== before + 1 ||
              !ExpectRoot.Hardware.Memory.lastIsAbort(
                controller.Exceptions,
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.BlockBitOffsetOutOfRange,
              )
            ) {
              return ResultRoot.Hardware.Memory.memoryTestCaseResult(
                name,
                0,
                "空块没有拒绝偏移 0",
              );
            }
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(name, 1, "");
          }

          const counts: Uint32Root.Hardware.Memory.Uint32[] = [];
          const ordered: (Uint32Root.Hardware.Memory.Uint32 | undefined)[] = [];
          for (const unit of controller.Units.values()) {
            ordered[unit.UnitOrdinal] = unit.CellCount;
          }
          for (const count of ordered) {
            if (count === undefined) {
              return ResultRoot.Hardware.Memory.memoryTestCaseResult(name, 0, "序号不连续");
            }
            counts.push(count);
          }
          const place = BlockSpanRoot.Hardware.Memory.locateLinear(0n, counts);
          if (place === null) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(name, 0, "线性下标 0 没有落点");
          }
          const unit = TemporaryRoot.Hardware.Memory.unitAtOrdinal(controller, place.UnitOrdinal);
          if (unit === null) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(name, 0, "落点序号上没有颗粒");
          }
          block.WriteBit(zero, 1);
          const seen = unit.ReadBit(place.CellIndex);
          block.WriteBit(zero, 0);
          if (seen !== 1 || unit.ReadBit(place.CellIndex) !== 0) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(
              name,
              0,
              "块内偏移 0 没有写到线性落点",
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
