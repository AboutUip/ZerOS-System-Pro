/**
 * @module ZerOS.Hardware.Memory.Test.IllegalBitRejected
 * @description 用例 IllegalBitRejected
 *
 * 向正式可用颗粒写入 2。存储体必须不变，标号必须是 IllegalBitValue。
 */

import { ZerOS as Uint32Root } from "../../Structure/Uint32";
import { ZerOS as ExceptionCodeRoot } from "../../Enum/ExceptionCode";
import { ZerOS as ResultRoot } from "../../Structure/MemoryTestCaseResult";
import { ZerOS as TemporaryRoot } from "../TemporaryMemory";
import { ZerOS as ExpectRoot } from "../TestExpect";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      export function runIllegalBitRejected(): ResultRoot.Hardware.Memory.MemoryTestCaseResult {
        const name = "IllegalBitRejected" as const;
        try {
          const controller = TemporaryRoot.Hardware.Memory.openTemporaryController();
          const unit = TemporaryRoot.Hardware.Memory.activeFirstUnit(controller);
          if (unit === null) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(name, 0, "没有正式可用颗粒");
          }
          const zero = Uint32Root.Hardware.Memory.uint32OrThrow(0, name);
          const before = unit.ReadOctet(zero);
          const beforeCount = unit.Exceptions.length;
          let threw = false;
          try {
            unit.WriteBit(zero, 2);
          } catch {
            threw = true;
          }
          const after = unit.ReadOctet(zero);
          if (
            !threw ||
            after !== before ||
            unit.Exceptions.length !== beforeCount + 1 ||
            !ExpectRoot.Hardware.Memory.lastIsAbort(
              unit.Exceptions,
              ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.IllegalBitValue,
            )
          ) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(
              name,
              0,
              "非法位元值没有被拒绝，或存储体被改写",
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
