/**
 * @module ZerOS.Hardware.Memory.Test.MemoryIdDraw
 * @description 用例 MemoryIdDraw
 *
 * 抽出的 MemoryId 长度为 256，每位都在可打印 ASCII 里，并且不是全 0。
 * 抽签本身不写配置面。
 */

import { ZerOS as MemoryConfigRoot } from "../../Config/MemoryConfig";
import { ZerOS as MemoryIdDrawRoot } from "../../Structure/MemoryIdDraw";
import { ZerOS as ResultRoot } from "../../Structure/MemoryTestCaseResult";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      export function runMemoryIdDraw(): ResultRoot.Hardware.Memory.MemoryTestCaseResult {
        const name = "MemoryIdDraw" as const;
        try {
          const before = MemoryConfigRoot.Hardware.Memory.Config.MemoryId;
          const drawn = MemoryIdDrawRoot.Hardware.Memory.drawMemoryId(
            MemoryConfigRoot.Hardware.Memory.Config.MemoryIdByteLength,
          );
          const alphabet = MemoryIdDrawRoot.Hardware.Memory.MemoryIdAlphabet;
          if (drawn?.length !== 256 || drawn === "0".repeat(256)) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(name, 0, "没有抽出已启用的 MemoryId");
          }
          for (const character of drawn) {
            if (!alphabet.includes(character)) {
              return ResultRoot.Hardware.Memory.memoryTestCaseResult(
                name,
                0,
                "MemoryId 含有字符表以外的字符",
              );
            }
          }
          if (MemoryConfigRoot.Hardware.Memory.Config.MemoryId !== before) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(name, 0, "抽签改写了配置面");
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
