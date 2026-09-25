/**
 * @module ZerOS.Hardware.Cpu.ReferenceCpuProvider
 * @description 官方 CPU 插头
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 把官方运行时包成可 Bind 的 CpuProvider。
 * CoreCount 使用官方标定 4。社区单核实现替换 ActiveProvider 即可，不必改主板。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. ReferenceCpuProvider
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as ConfigRoot } from "../Config/CpuConfig";
import { ZerOS as RuntimeRoot } from "../Bootstrap/CpuRuntime";
import type { ZerOS as CommandResultRoot } from "../Structure/CpuCommandResult";
import type { ZerOS as CpuProviderRoot } from "../../Motherboard/Slot/Cpu/CpuProvider";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      const OfficialCoreCount = ConfigRoot.Hardware.Cpu.Config.OfficialCoreCount;
      const declareCoreCount = RuntimeRoot.Hardware.Cpu.declareCoreCount;
      const schedule = RuntimeRoot.Hardware.Cpu.schedule;
      const halt = RuntimeRoot.Hardware.Cpu.halt;
      const coreState = RuntimeRoot.Hardware.Cpu.coreState;
      const place = RuntimeRoot.Hardware.Cpu.place;
      const add = RuntimeRoot.Hardware.Cpu.add;
      const load = RuntimeRoot.Hardware.Cpu.load;
      const store = RuntimeRoot.Hardware.Cpu.store;
      const pass = RuntimeRoot.Hardware.Cpu.pass;
      const take = RuntimeRoot.Hardware.Cpu.take;
      const setHertz = RuntimeRoot.Hardware.Cpu.setHertz;
      const metric = RuntimeRoot.Hardware.Cpu.metric;
      type CpuCommandResult = CommandResultRoot.Hardware.Cpu.CpuCommandResult;

      declareCoreCount(OfficialCoreCount);

      /**
       * 官方 CPU。
       * 声明 4 个核心。这是标定，不是协议规定的唯一合法个数。
       */
      export const ReferenceCpuProvider: CpuProviderRoot.Hardware.Motherboard.Slot.CpuProvider = {
        ProviderId: "ZerOS-Reference-Cpu",
        ProviderVendor: "ZerOS-Team",
        ActiveProtocol: "ZCP1",
        CoreCount: OfficialCoreCount,
        Schedule(ordinal: number): void {
          schedule(ordinal);
        },
        Halt(ordinal: number): void {
          halt(ordinal);
        },
        CoreState(ordinal: number): 0 | 1 {
          return coreState(ordinal);
        },
        Place(ordinal: number, register: number, data: bigint): Promise<CpuCommandResult> {
          return place(ordinal, register, data);
        },
        Add(
          ordinal: number,
          destination: number,
          left: number,
          right: number,
        ): Promise<CpuCommandResult> {
          return add(ordinal, destination, left, right);
        },
        Load(
          ordinal: number,
          opcode: number,
          address: bigint,
          register: number,
        ): Promise<CpuCommandResult> {
          return load(ordinal, opcode, address, register);
        },
        Store(
          ordinal: number,
          opcode: number,
          address: bigint,
          register: number,
        ): Promise<CpuCommandResult> {
          return store(ordinal, opcode, address, register);
        },
        Pass(fromOrdinal: number, toOrdinal: number, data: bigint): void {
          pass(fromOrdinal, toOrdinal, data);
        },
        Take(ordinal: number): bigint {
          return take(ordinal);
        },
        SetHertz(ordinal: number, hertz: number): void {
          setHertz(ordinal, hertz);
        },
        Metric(ordinal: number, kind: number): bigint {
          return metric(ordinal, kind);
        },
      };
    }
  }
}
