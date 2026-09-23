/**
 * @module ZerOS.Hardware.Memory.Test.UnitOrdinalOutOfRange
 * @description 用例 UnitOrdinalOutOfRange
 *
 * UnitCount 本身能放进 Uint32 时，用它当序号必须得到 0x000C，并且记在总控上。
 * 存储体保持调用前的值。颗粒自己的异常条数不增加。
 */

import { ZerOS as MemoryConfigRoot } from "../../Config/MemoryConfig";
import { ZerOS as Uint32Root } from "../../Structure/Uint32";
import { ZerOS as ExceptionCodeRoot } from "../../Enum/ExceptionCode";
import { ZerOS as ResultRoot } from "../../Structure/MemoryTestCaseResult";
import { ZerOS as TemporaryRoot } from "../TemporaryMemory";
import { ZerOS as ExpectRoot } from "../TestExpect";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      export function runUnitOrdinalOutOfRange(): ResultRoot.Hardware.Memory.MemoryTestCaseResult {
        const name = "UnitOrdinalOutOfRange" as const;
        try {
          const controller = TemporaryRoot.Hardware.Memory.openTemporaryController();
          const count = MemoryConfigRoot.Hardware.Memory.Config.UnitCount;
          const zero = Uint32Root.Hardware.Memory.uint32OrThrow(0, name);
          if (count > Uint32Root.Hardware.Memory.Uint32Max) {
            const top = Uint32Root.Hardware.Memory.Uint32Max;
            const before = controller.Exceptions.length;
            try {
              controller.ReadBit(top, zero);
            } catch {
              // 序号在界内时，失败应来自颗粒，而不是 0x000C。
            }
            const added = controller.Exceptions.slice(before);
            for (const item of added) {
              if (
                item.ExceptionCode ===
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.UnitOrdinalOutOfRange
              ) {
                return ResultRoot.Hardware.Memory.memoryTestCaseResult(
                  name,
                  0,
                  "Uint32 上界序号被误报为越界",
                );
              }
            }
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(name, 1, "");
          }

          const unit = TemporaryRoot.Hardware.Memory.activeFirstUnit(controller);
          if (unit === null) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(name, 0, "没有正式可用颗粒");
          }
          const ordinal = Uint32Root.Hardware.Memory.uint32OrThrow(count, name);
          const beforeOctet = unit.ReadOctet(zero);
          const beforeUnit = unit.Exceptions.length;
          const beforeController = controller.Exceptions.length;
          let threw = false;
          try {
            controller.ReadBit(ordinal, zero);
          } catch {
            threw = true;
          }
          if (
            !threw ||
            unit.ReadOctet(zero) !== beforeOctet ||
            unit.Exceptions.length !== beforeUnit ||
            controller.Exceptions.length !== beforeController + 1 ||
            !ExpectRoot.Hardware.Memory.lastIsAbort(
              controller.Exceptions,
              ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.UnitOrdinalOutOfRange,
            )
          ) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(
              name,
              0,
              "越界序号没有记在总控上，或存储体被改写",
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
