/**
 * @module ZerOS.Hardware.Memory.Test.ClaimReleaseZeros
 * @description 用例 ClaimReleaseZeros
 *
 * 领取后不能再领。主人不对时不能归还，存储体保持。
 * 主人归还之后，这块的位元为 0，Owner 回到 null。
 */

import { ZerOS as Uint32Root } from "../../Structure/Uint32";
import { ZerOS as ExceptionCodeRoot } from "../../Enum/ExceptionCode";
import { ZerOS as EventCodeRoot } from "../../Enum/EventCode";
import { ZerOS as SignalCodeRoot } from "../../Enum/SignalCode";
import { ZerOS as ResultRoot } from "../../Structure/MemoryTestCaseResult";
import { ZerOS as TemporaryRoot } from "../TemporaryMemory";
import { ZerOS as ExpectRoot } from "../TestExpect";
import type { ZerOS as MemoryEventRoot } from "../../Structure/MemoryEvent";
import type { ZerOS as MemorySignalRoot } from "../../Structure/MemorySignal";

function hasEvent(
  events: readonly MemoryEventRoot.Hardware.Memory.MemoryEvent[],
  code: number,
  subject: number,
  detail: number,
): boolean {
  for (const event of events) {
    if (event.EventCode === code && event.Subject === subject && event.Detail === detail) {
      return true;
    }
  }
  return false;
}

function signalIs(
  signals: readonly MemorySignalRoot.Hardware.Memory.MemorySignal[],
  code: number,
  subject: number,
  level: 0 | 1,
): boolean {
  for (const signal of signals) {
    if (signal.SignalCode === code && signal.Subject === subject) {
      return signal.Level === level;
    }
  }
  return false;
}

function ownerOf(
  block: { readonly Owner: Uint32Root.Hardware.Memory.Uint32 | null },
): Uint32Root.Hardware.Memory.Uint32 | null {
  return block.Owner;
}

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      export function runClaimReleaseZeros(): ResultRoot.Hardware.Memory.MemoryTestCaseResult {
        const name = "ClaimReleaseZeros" as const;
        try {
          const controller = TemporaryRoot.Hardware.Memory.openTemporaryController();
          const block = controller.Blocks[0];
          if (block?.BlockIndex !== 0 || block.Owner !== null) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(name, 0, "第 0 块不是未领取的浅切根");
          }
          const zero = Uint32Root.Hardware.Memory.uint32OrThrow(0, name);
          const owner = Uint32Root.Hardware.Memory.uint32OrThrow(1, name);
          const other = Uint32Root.Hardware.Memory.uint32OrThrow(2, name);
          const unit = TemporaryRoot.Hardware.Memory.activeFirstUnit(controller);
          const blockCount = Uint32Root.Hardware.Memory.toUint32(controller.Blocks.length);
          if (
            unit === null ||
            blockCount === null ||
            !hasEvent(
              controller.Events,
              EventCodeRoot.Hardware.Memory.EventCodeValue.ShallowCutCompleted,
              blockCount,
              0,
            ) ||
            !signalIs(controller.Signals, SignalCodeRoot.Hardware.Memory.SignalCodeValue.Ready, 0, 1) ||
            !hasEvent(unit.Events, EventCodeRoot.Hardware.Memory.EventCodeValue.BecameActive, 0, 0) ||
            !signalIs(unit.Signals, SignalCodeRoot.Hardware.Memory.SignalCodeValue.Usable, 0, 1) ||
            !signalIs(unit.Signals, SignalCodeRoot.Hardware.Memory.SignalCodeValue.Fault, 0, 0)
          ) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(name, 0, "浅切或颗粒生命周期的事件信号不对");
          }
          controller.Claim(zero, owner);
          if (
            !hasEvent(
              controller.Events,
              EventCodeRoot.Hardware.Memory.EventCodeValue.Claimed,
              0,
              owner,
            )
          ) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(name, 0, "领取没有记下 Claimed");
          }
          let second = false;
          try {
            controller.Claim(zero, other);
          } catch {
            second = true;
          }
          const claimedOwner = ownerOf(block);
          if (
            !second ||
            claimedOwner !== owner ||
            !ExpectRoot.Hardware.Memory.lastIsAbort(
              controller.Exceptions,
              ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.AlreadyClaimed,
            )
          ) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(name, 0, "重复领取没有被拒绝");
          }
          block.WriteBit(zero, 1);
          let mismatch = false;
          try {
            controller.Release(zero, other);
          } catch {
            mismatch = true;
          }
          if (!mismatch || block.ReadBit(zero) !== 1) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(name, 0, "主人不一致时存储体被改了");
          }
          controller.Release(zero, owner);
          if (
            ownerOf(block) !== null ||
            block.ReadBit(zero) !== 0 ||
            !hasEvent(
              controller.Events,
              EventCodeRoot.Hardware.Memory.EventCodeValue.Released,
              0,
              owner,
            )
          ) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(name, 0, "归还后没有清零或主人还在");
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
