/**
 * @module ZerOS.Hardware.Memory.Test.BlockOctetRoundTrip
 * @description 用例 BlockOctetRoundTrip
 *
 * 第 0 块的八位组 0 写入 0x81 后，最低位为 1，次低位为 0。然后恢复。
 */

import { ZerOS as Uint32Root } from "../../Structure/Uint32";
import { ZerOS as ResultRoot } from "../../Structure/MemoryTestCaseResult";
import { ZerOS as TemporaryRoot } from "../TemporaryMemory";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      export function runBlockOctetRoundTrip(): ResultRoot.Hardware.Memory.MemoryTestCaseResult {
        const name = "BlockOctetRoundTrip" as const;
        try {
          const controller = TemporaryRoot.Hardware.Memory.openTemporaryController();
          const block = controller.Blocks[0];
          if (block?.BlockIndex !== 0 || block.BitLength < 8) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(name, 0, "第 0 块容不下八位组");
          }
          const zero = Uint32Root.Hardware.Memory.uint32OrThrow(0, name);
          const one = Uint32Root.Hardware.Memory.uint32OrThrow(1, name);
          block.WriteOctet(zero, 0x81);
          const octet = block.ReadOctet(zero);
          const low = block.ReadBit(zero);
          const next = block.ReadBit(one);
          block.WriteOctet(zero, 0);
          if (octet !== 0x81 || low !== 1 || next !== 0 || block.ReadOctet(zero) !== 0) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(name, 0, "块内八位组没有按最低有效位对齐");
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
