/**
 * @module ZerOS.Hardware.Memory.Test.OctetRoundTrip
 * @description 用例 OctetRoundTrip
 *
 * 写入八位组 0x81，最低位和最高位必须为 1，中间位为 0。然后恢复为 0。
 */

import { ZerOS as Uint32Root } from "../../Structure/Uint32";
import { ZerOS as ResultRoot } from "../../Structure/MemoryTestCaseResult";
import { ZerOS as TemporaryRoot } from "../TemporaryMemory";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      export function runOctetRoundTrip(): ResultRoot.Hardware.Memory.MemoryTestCaseResult {
        const name = "OctetRoundTrip" as const;
        try {
          const controller = TemporaryRoot.Hardware.Memory.openTemporaryController();
          const unit = TemporaryRoot.Hardware.Memory.activeFirstUnit(controller);
          if (unit === null) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(name, 0, "没有正式可用颗粒");
          }
          const zero = Uint32Root.Hardware.Memory.uint32OrThrow(0, name);
          const one = Uint32Root.Hardware.Memory.uint32OrThrow(1, name);
          const seven = Uint32Root.Hardware.Memory.uint32OrThrow(7, name);
          unit.WriteOctet(zero, 0x81);
          const octet = unit.ReadOctet(zero);
          const low = unit.ReadBit(zero);
          const mid = unit.ReadBit(one);
          const high = unit.ReadBit(seven);
          unit.WriteOctet(zero, 0);
          const restored = unit.ReadOctet(zero);
          if (octet !== 0x81 || low !== 1 || mid !== 0 || high !== 1 || restored !== 0) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(
              name,
              0,
              `八位组 ${String(octet)}，位 0/1/7 = ${String(low)}/${String(mid)}/${String(high)}`,
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
