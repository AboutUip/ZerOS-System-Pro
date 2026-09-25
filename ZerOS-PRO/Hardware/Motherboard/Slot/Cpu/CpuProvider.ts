/**
 * @module ZerOS.Hardware.Motherboard.Slot.Cpu.Provider
 * @description Cpu Provider 形态（ZVHP1 + ZCP1）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 定义可绑定到 CpuSlot 的插头：元数据、声明的核心数、调度与执行方法。
 * 不含某一份 CPU 的内部表。主板坐座代码不导入具体实现。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. CpuProvider
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import type { ZerOS as ProviderMetaRoot } from "../Structure/ProviderMeta";
import type { ZerOS as CommandResultRoot } from "../../../Cpu/Structure/CpuCommandResult";
import type { ZerOS as CoreRunStateRoot } from "../../../Cpu/Enum/CoreRunState";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      export namespace Slot {
        type CpuCommandResult = CommandResultRoot.Hardware.Cpu.CpuCommandResult;
        type CoreRunState = CoreRunStateRoot.Hardware.Cpu.CoreRunState;

        /**
         * Cpu Provider。
         * CoreCount 是这份实现的核心数上限。方法名与 ZCP1 逐字一致。
         */
        export interface CpuProvider {
          readonly ProviderId: ProviderMetaRoot.Hardware.Motherboard.Slot.ProviderId;
          readonly ProviderVendor: ProviderMetaRoot.Hardware.Motherboard.Slot.ProviderVendor;
          readonly ActiveProtocol: ProviderMetaRoot.Hardware.Motherboard.Slot.ActiveProtocol;
          readonly CoreCount: number;
          Schedule(ordinal: number): void;
          Halt(ordinal: number): void;
          CoreState(ordinal: number): CoreRunState;
          Place(ordinal: number, register: number, data: bigint): Promise<CpuCommandResult>;
          Add(ordinal: number, destination: number, left: number, right: number): Promise<CpuCommandResult>;
          Load(ordinal: number, opcode: number, address: bigint, register: number): Promise<CpuCommandResult>;
          Store(ordinal: number, opcode: number, address: bigint, register: number): Promise<CpuCommandResult>;
          Pass(fromOrdinal: number, toOrdinal: number, data: bigint): void;
          Take(ordinal: number): bigint;
          SetHertz(ordinal: number, hertz: number): void;
          Metric(ordinal: number, kind: number): bigint;
        }
      }
    }
  }
}
