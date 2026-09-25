/**
 * @module ZerOS.Hardware.Memory.Test.IntegerLittleEndian
 * @description 用例 IntegerLittleEndian
 *
 * 宽度 2 的值 0x0181：低八位组是 0x81，高八位组是 0x01。然后恢复为 0。
 * 同一颗上再核对宽度 4 和 8。颗粒数不少于 2 时，再让宽度 2 跨过第 0 颗的末尾。
 */

import { ZerOS as Uint32Root } from "../../Structure/Uint32";
import { ZerOS as MemoryConfigRoot } from "../../Config/MemoryConfig";
import { ZerOS as UnitInitStateRoot } from "../../Enum/UnitInitState";
import { ZerOS as ResultRoot } from "../../Structure/MemoryTestCaseResult";
import { ZerOS as TemporaryRoot } from "../TemporaryMemory";
import type { ZerOS as MemoryUnitRoot } from "../../Unit/MemoryUnit";
import type { ZerOS as MemoryControllerRoot } from "../../Controller/MemoryController";

function roundTripWider(
  unit: MemoryUnitRoot.Hardware.Memory.MemoryUnit,
  name: string,
): string | null {
  const samples: readonly { readonly width: 4 | 8; readonly value: bigint }[] = [
    { width: 4, value: 0x04030201n },
    { width: 8, value: 0x0807060504030201n },
  ];
  for (const sample of samples) {
    const zero = Uint32Root.Hardware.Memory.uint32OrThrow(0, name);
    unit.WriteInteger(zero, sample.width, sample.value);
    let step = 0;
    let rest = sample.value;
    while (step < sample.width) {
      const index = Uint32Root.Hardware.Memory.uint32OrThrow(step, name);
      const expected = Number(rest & 0xffn);
      if (unit.ReadOctet(index) !== expected) {
        return `宽度 ${String(sample.width)} 的第 ${String(step)} 个八位组不是 ${String(expected)}`;
      }
      rest >>= 8n;
      step += 1;
    }
    if (unit.ReadInteger(zero, sample.width) !== sample.value) {
      return `宽度 ${String(sample.width)} 没有按小端读回`;
    }
    unit.WriteInteger(zero, sample.width, 0n);
    if (unit.ReadOctet(zero) !== 0) {
      return `宽度 ${String(sample.width)} 没有恢复成 0`;
    }
  }
  return null;
}

function roundTripAcrossUnits(
  controller: MemoryControllerRoot.Hardware.Memory.MemoryController,
  unit: MemoryUnitRoot.Hardware.Memory.MemoryUnit,
  name: string,
): string | null {
  const nextOrdinal = Uint32Root.Hardware.Memory.toUint32(1);
  const next =
    nextOrdinal === null
      ? null
      : TemporaryRoot.Hardware.Memory.unitAtOrdinal(controller, nextOrdinal);
  const active = UnitInitStateRoot.Hardware.Memory.UnitInitStateCode.Active;
  if (next?.InitState !== active || next.Cells.length < 1 || unit.Cells.length < 1) {
    return "第二颗不能承接跨颗粒整数";
  }
  const at = BigInt(unit.Cells.length) - 1n;
  const last = Uint32Root.Hardware.Memory.uint32OrThrow(unit.Cells.length - 1, name);
  const zero = Uint32Root.Hardware.Memory.uint32OrThrow(0, name);
  controller.WriteLinearInteger(at, 2, 0x0181n);
  const low = unit.ReadOctet(last);
  const high = next.ReadOctet(zero);
  const packed = controller.ReadLinearInteger(at, 2);
  controller.WriteLinearInteger(at, 2, 0n);
  if (
    low !== 0x81 ||
    high !== 0x01 ||
    packed !== 0x0181n ||
    unit.ReadOctet(last) !== 0 ||
    next.ReadOctet(zero) !== 0
  ) {
    return `跨颗粒低八位组 ${String(low)}，高八位组 ${String(high)}，拼回 ${packed.toString()}`;
  }
  return null;
}

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      export function runIntegerLittleEndian(): ResultRoot.Hardware.Memory.MemoryTestCaseResult {
        const name = "IntegerLittleEndian" as const;
        try {
          const controller = TemporaryRoot.Hardware.Memory.openTemporaryController();
          const unit = TemporaryRoot.Hardware.Memory.activeFirstUnit(controller);
          if (unit === null) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(name, 0, "没有正式可用颗粒");
          }
          const zero = Uint32Root.Hardware.Memory.uint32OrThrow(0, name);
          const one = Uint32Root.Hardware.Memory.uint32OrThrow(1, name);
          unit.WriteInteger(zero, 2, 0x0181n);
          const low = unit.ReadOctet(zero);
          const high = unit.ReadOctet(one);
          const packed = unit.ReadInteger(zero, 2);
          unit.WriteInteger(zero, 2, 0n);
          unit.WriteInteger(zero, 2, -1n);
          if (unit.ReadOctet(zero) !== 0xff || unit.ReadOctet(one) !== 0xff || unit.ReadInteger(zero, 2) !== -1n) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(name, 0, "宽度 2 的 -1 没有按补码往返");
          }
          unit.WriteInteger(zero, 2, 0n);
          controller.WriteLinearFloat(0n, 8, 1.5);
          if (controller.ReadLinearFloat(0n, 8) !== 1.5) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(name, 0, "二进制 64 的 1.5 没有读回");
          }
          controller.WriteLinearFloat(0n, 8, 0);
          if (low !== 0x81 || high !== 0x01 || packed !== 0x0181n || unit.ReadOctet(zero) !== 0) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(
              name,
              0,
              `低八位组 ${String(low)}，高八位组 ${String(high)}，拼回 ${packed.toString()}`,
            );
          }
          if (unit.Cells.length < 8) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(name, 0, "正式可用颗粒装不下宽度 8");
          }
          const wide = roundTripWider(unit, name);
          if (wide !== null) {
            return ResultRoot.Hardware.Memory.memoryTestCaseResult(name, 0, wide);
          }
          if (MemoryConfigRoot.Hardware.Memory.Config.UnitCount >= 2) {
            const crossed = roundTripAcrossUnits(controller, unit, name);
            if (crossed !== null) {
              return ResultRoot.Hardware.Memory.memoryTestCaseResult(name, 0, crossed);
            }
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
