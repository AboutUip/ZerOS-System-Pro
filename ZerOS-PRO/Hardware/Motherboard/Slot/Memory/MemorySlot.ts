/**
 * @module ZerOS.Hardware.Motherboard.Slot.Memory.Slot
 * @description MemorySlot：内存可插拔插座（ZVHP1 §4.1 / §4.3）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 提供规范对象 MemorySlot：Bind / GetActive。
 * 插座放在主板上。同一时刻至多一个 Active Memory Provider。
 * 本文件不调用 Test / Initialize，也不碰内存通道。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. MemoryProvider / 元数据导入
 *   2. 校验辅助
 *   3. MemorySlot（Bind / GetActive）
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import type { ZerOS as MemoryProviderRoot } from "./MemoryProvider";
import { ZerOS as ProviderMetaRoot } from "../Structure/ProviderMeta";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      export namespace Slot {
        type MemoryProvider = MemoryProviderRoot.Hardware.Motherboard.Slot.MemoryProvider;

        /* ------------------------------------------------------------------ */
        /* 2. 校验：拒绝非法 Provider，避免半绑定                              */
        /* ------------------------------------------------------------------ */

        /**
         * 检查字符串是否为可打印 ASCII 且长度落在 [min, max]。
         */
        function isPrintableAsciiInRange(
          value: string,
          min: number,
          max: number,
        ): boolean {
          if (typeof value !== "string") {
            return false;
          }
          const length: number = value.length;
          if (length < min || length > max) {
            return false;
          }
          for (let index = 0; index < length; index += 1) {
            const code: number = value.charCodeAt(index);
            if (code < 0x21 || code > 0x7e) {
              return false;
            }
          }
          return true;
        }

        /**
         * 校验 Memory Provider 是否满足 ZVHP1 §4.2 / §4.2.1。
         * 不合法则返回 false（调用方保持 Active 不变）。
         */
        function isValidMemoryProvider(provider: MemoryProvider): boolean {
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
          if (provider.ActiveProtocol !== "ZMP1") {
            return false;
          }
          // 领域门面：必须暴露可调用的 Test 与 Initialize（运行时形态校验）
          if (typeof provider.MachineMemory.MemoryInit.Test !== "function") {
            return false;
          }
          if (typeof provider.MachineMemory.MemoryInit.Initialize !== "function") {
            return false;
          }
          return true;
        }

        /* ------------------------------------------------------------------ */
        /* 3. MemorySlot                                                       */
        /* ------------------------------------------------------------------ */

        /**
         * 当前 Active Memory Provider；未绑定为 null。
         */
        let activeMemoryProvider: MemoryProvider | null = null;

        /**
         * MemorySlot：ZVHP1 规范插座对象名。
         * 谁来 Bind 由主板决定，不由内存自己决定。
         */
        export const MemorySlot = {
          /**
           * 绑定（替换）Active Memory Provider（ZVHP1 规范方法名 `Bind`）。
           * 非法 Provider：拒绝且 Active 保持不变。
           */
          Bind(provider: MemoryProvider): void {
            if (!isValidMemoryProvider(provider)) {
              return;
            }
            activeMemoryProvider = provider;
          },

          /**
           * 取得当前 Active Provider（ZVHP1 规范方法名 `GetActive`）。
           * 未绑定返回 null，不抛错。
           */
          GetActive(): MemoryProvider | null {
            return activeMemoryProvider;
          },
        };
      }
    }
  }
}
