/**
 * @module ZerOS.Hardware.Motherboard.Slot.Cpu.Slot
 * @description CpuSlot：CPU 可插拔插座
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 规范对象 CpuSlot：Bind / GetActive。
 * 同一时刻至多一个 Active CPU Provider。
 * 不创建核心 Worker，也不转达核心之间的传递。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 校验
 *   3. CpuSlot
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import type { ZerOS as CpuProviderRoot } from "./CpuProvider";
import { ZerOS as ProviderMetaRoot } from "../Structure/ProviderMeta";
import { ZerOS as CpuConfigRoot } from "../../../Cpu/Config/CpuConfig";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      export namespace Slot {
        type CpuProvider = CpuProviderRoot.Hardware.Motherboard.Slot.CpuProvider;

        const CoreCountMin = CpuConfigRoot.Hardware.Cpu.Config.CoreCountMin;
        const CoreCountMax = CpuConfigRoot.Hardware.Cpu.Config.CoreCountMax;

        function isPrintableAsciiInRange(value: string, min: number, max: number): boolean {
          const length = value.length;
          if (length < min || length > max) {
            return false;
          }
          for (let index = 0; index < length; index += 1) {
            const code = value.charCodeAt(index);
            if (code < 0x21 || code > 0x7e) {
              return false;
            }
          }
          return true;
        }

        function isValidCpuProvider(provider: CpuProvider): boolean {
          if (
            !isPrintableAsciiInRange(
              provider.ProviderId,
              1,
              ProviderMetaRoot.Hardware.Motherboard.Slot.ProviderIdMaxLength,
            )
          ) {
            return false;
          }
          if (
            !isPrintableAsciiInRange(
              provider.ProviderVendor,
              1,
              ProviderMetaRoot.Hardware.Motherboard.Slot.ProviderVendorMaxLength,
            )
          ) {
            return false;
          }
          if (provider.ActiveProtocol !== "ZCP1") {
            return false;
          }
          if (
            !Number.isInteger(provider.CoreCount)
            || provider.CoreCount < CoreCountMin
            || provider.CoreCount > CoreCountMax
          ) {
            return false;
          }
          return typeof provider.Schedule === "function"
            && typeof provider.Halt === "function"
            && typeof provider.CoreState === "function"
            && typeof provider.Place === "function"
            && typeof provider.Add === "function"
            && typeof provider.Load === "function"
            && typeof provider.Store === "function"
            && typeof provider.Pass === "function"
            && typeof provider.Take === "function";
        }

        let activeCpuProvider: CpuProvider | null = null;

        /**
         * CpuSlot：ZVHP1 规范插座对象名。
         * 谁来 Bind 由主板决定。核心数以绑定成功的这份实现为准。
         */
        export const CpuSlot = {
          /**
           * 绑定 Active CPU Provider。
           * 核心数不在 1..256、或协议不是 ZCP1 时，保持原来的 Active 不变。
           */
          Bind(provider: CpuProvider): void {
            if (!isValidCpuProvider(provider)) {
              return;
            }
            activeCpuProvider = provider;
          },

          /** 取得当前 Active Provider。未绑定返回 null。 */
          GetActive(): CpuProvider | null {
            return activeCpuProvider;
          },
        };
      }
    }
  }
}
