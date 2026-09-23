/**
 * @module ZerOS.Hardware.Memory.Test.DeepenOneLevel
 * @description 用例 DeepenOneLevel
 *
 * DeepDimension 大于 1 时，Deepen 只加一层，父块跨度不变，再调用一次必须是 AlreadyDeepened。
 * DeepDimension 等于 1 时，第一次就必须是 NestingAtCeiling，子块保持为空。
 * 两种路径都不得改写存储体。
 */

import { ZerOS as MemoryConfigRoot } from "../../Config/MemoryConfig";
import { ZerOS as Uint32Root } from "../../Structure/Uint32";
import { ZerOS as ExceptionCodeRoot } from "../../Enum/ExceptionCode";
import { ZerOS as EventCodeRoot } from "../../Enum/EventCode";
import { ZerOS as ResultRoot } from "../../Structure/MemoryTestCaseResult";
import { ZerOS as TemporaryRoot } from "../TemporaryMemory";
import { ZerOS as ExpectRoot } from "../TestExpect";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      export function runDeepenOneLevel(): ResultRoot.Hardware.Memory.MemoryTestCaseResult {
        const name = "DeepenOneLevel" as const;
        try {
          const controller = TemporaryRoot.Hardware.Memory.openTemporaryController();
          const block = controller.Blocks[0];
          const unit = TemporaryRoot.Hardware.Memory.activeFirstUnit(controller);
          if (block === undefined) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(name, 0, "没有第 0 块");
          }
          const zero = Uint32Root.Hardware.Memory.uint32OrThrow(0, name);
          const beforeOctet = unit === null ? null : unit.ReadOctet(zero);
          const parentLength = block.BitLength;
          const deep = MemoryConfigRoot.Hardware.Memory.Config.DeepDimension;
          const shallow = MemoryConfigRoot.Hardware.Memory.Config.ShallowDimension;

          if (deep < 2) {
            const before = controller.Exceptions.length;
            let threw = false;
            try {
              block.Deepen();
            } catch {
              threw = true;
            }
            const afterOctet = unit === null ? null : unit.ReadOctet(zero);
            if (
              !threw ||
              block.Children.length !== 0 ||
              block.BitLength !== parentLength ||
              afterOctet !== beforeOctet ||
              controller.Exceptions.length !== before + 1 ||
              !ExpectRoot.Hardware.Memory.lastIsAbort(
                controller.Exceptions,
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.NestingAtCeiling,
              )
            ) {
              return ResultRoot.Hardware.Memory.memoryTestCaseResult(
                name,
                0,
                "深度上限为 1 时没有停在顶上",
              );
            }
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(name, 1, "");
          }

          block.Deepen();
          const deepened = controller.Events[controller.Events.length - 1];
          if (
            block.NestingDepth !== 1 ||
            block.BitLength !== parentLength ||
            block.Children.length !== shallow ||
            deepened?.EventCode !== EventCodeRoot.Hardware.Memory.EventCodeValue.Deepened ||
            deepened.Subject !== 0 ||
            deepened.Detail !== 2
          ) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(
              name,
              0,
              "加深改变了父块，或子块数量不对",
            );
          }
          const child = block.Children[0];
          let childSum = 0n;
          for (const item of block.Children) {
            childSum += BigInt(item.BitLength);
          }
          if (
            child?.NestingDepth !== 2 ||
            child.ChildIndex !== 0 ||
            child.Children.length !== 0 ||
            childSum !== BigInt(parentLength)
          ) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(
              name,
              0,
              "第一层子块的深度、下标或跨度不对",
            );
          }
          const beforeSecond = controller.Exceptions.length;
          const childCount = block.Children.length;
          let secondThrew = false;
          try {
            block.Deepen();
          } catch {
            secondThrew = true;
          }
          const afterOctet = unit === null ? null : unit.ReadOctet(zero);
          if (
            !secondThrew ||
            block.Children.length !== childCount ||
            afterOctet !== beforeOctet ||
            controller.Exceptions.length !== beforeSecond + 1 ||
            !ExpectRoot.Hardware.Memory.lastIsAbort(
              controller.Exceptions,
              ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.AlreadyDeepened,
            )
          ) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(
              name,
              0,
              "第二次加深没有被拒绝，或存储体被改写",
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
