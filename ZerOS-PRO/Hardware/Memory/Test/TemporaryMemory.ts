/**
 * @module ZerOS.Hardware.Memory.TemporaryMemory
 * @description 测试用的临时总控（不发布到 MachineMemory）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 为初始化前用例提供一台临时 MemoryController，并按 UnitOrdinal 找到颗粒。
 * 不写入 MachineMemory.MemoryController，也不调用 Initialize。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 打开临时总控 / 按序号取颗粒
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as MemoryControllerRoot } from "../Controller/MemoryController";
import type { ZerOS as MemoryUnitRoot } from "../Unit/MemoryUnit";
import { ZerOS as Uint32Root } from "../Structure/Uint32";
import { ZerOS as UnitInitStateRoot } from "../Enum/UnitInitState";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      /**
       * 造一台只活在这次用例里的总控。
       * 构造本身会把成功颗粒升到 0x4，但这不是引导发布。
       */
      export function openTemporaryController(): MemoryControllerRoot.Hardware.Memory.MemoryController {
        return new MemoryControllerRoot.Hardware.Memory.MemoryController();
      }

      /**
       * 在临时总控里按协议序号找颗粒。找不到返回 null。
       */
      export function unitAtOrdinal(
        controller: MemoryControllerRoot.Hardware.Memory.MemoryController,
        unitOrdinal: Uint32Root.Hardware.Memory.Uint32,
      ): MemoryUnitRoot.Hardware.Memory.MemoryUnit | null {
        for (const unit of controller.Units.values()) {
          if (unit.UnitOrdinal === unitOrdinal) {
            return unit;
          }
        }
        return null;
      }

      /**
       * 序号 0 上、已经正式可用、并且至少有一个八位组的颗粒。
       * 端口用例用它做读写。没有这样的颗粒就返回 null，由用例记失败。
       */
      export function activeFirstUnit(
        controller: MemoryControllerRoot.Hardware.Memory.MemoryController,
      ): MemoryUnitRoot.Hardware.Memory.MemoryUnit | null {
        const ordinal: Uint32Root.Hardware.Memory.Uint32 | null =
          Uint32Root.Hardware.Memory.toUint32(0);
        if (ordinal === null) {
          return null;
        }
        const unit: MemoryUnitRoot.Hardware.Memory.MemoryUnit | null =
          ZerOS.Hardware.Memory.unitAtOrdinal(controller, ordinal);
        const active: UnitInitStateRoot.Hardware.Memory.UnitInitState =
          UnitInitStateRoot.Hardware.Memory.UnitInitStateCode.Active;
        if (unit?.InitState !== active || unit.CellCount < 8) {
          return null;
        }
        return unit;
      }
    }
  }
}
