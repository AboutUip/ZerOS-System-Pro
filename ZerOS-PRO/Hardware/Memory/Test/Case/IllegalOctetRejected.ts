/**
 * @module ZerOS.Hardware.Memory.Test.IllegalOctetRejected
 * @description 用例 IllegalOctetRejected
 *
 * 写入 256。八位组必须保持原值，标号必须是 IllegalOctetValue。
 */

import { ZerOS as Uint32Root } from "../../Structure/Uint32";
import { ZerOS as ExceptionCodeRoot } from "../../Enum/ExceptionCode";
import { ZerOS as ResultRoot } from "../../Structure/MemoryTestCaseResult";
import { ZerOS as TemporaryRoot } from "../TemporaryMemory";
import { ZerOS as ExpectRoot } from "../TestExpect";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      export function runIllegalOctetRejected(): ResultRoot.Hardware.Memory.MemoryTestCaseResult {
        const name = "IllegalOctetRejected" as const;
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
            unit.WriteOctet(zero, 256);
          } catch {
            threw = true;
          }
          if (
            !threw ||
            unit.ReadOctet(zero) !== before ||
            unit.Exceptions.length !== beforeCount + 1 ||
            !ExpectRoot.Hardware.Memory.lastIsAbort(
              unit.Exceptions,
              ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.IllegalOctetValue,
            )
          ) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(
              name,
              0,
              "非法八位组值没有被拒绝，或存储体被改写",
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
