/**
 * @module ZerOS.Machine.Slots.Memory.Slot
 * @description MemorySlot：内存可插拔插座（ZVHP1 §4.1 / §4.3）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 提供规范对象 MemorySlot：Bind / GetActive。
 * 同一时刻至多一个 Active Memory Provider。
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
  export namespace Machine {
    export namespace Slots {
      type MemoryProvider = MemoryProviderRoot.Machine.Slots.MemoryProvider;

      /* -------------------------------------------------------------------- */
      /* 2. 校验：拒绝非法 Provider，避免半绑定                                */
      /* -------------------------------------------------------------------- */

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
            ProviderMetaRoot.Machine.Slots.ProviderIdMaxLength,
          )
        ) {
          return false;
        }
        if (
          !isPrintableAsciiInRange(
            provider.ProviderVendor,
            1,
            ProviderMetaRoot.Machine.Slots.ProviderVendorMaxLength,
          )
        ) {
          return false;
        }
        if (provider.ActiveProtocol !== "ZMP1") {
          return false;
        }
        // 领域门面：必须暴露可调用的 Initialize（运行时形态校验）
        if (typeof provider.MachineMemory.MemoryInit.Initialize !== "function") {
          return false;
        }
        return true;
      }

      /* -------------------------------------------------------------------- */
      /* 3. MemorySlot                                                         */
      /* -------------------------------------------------------------------- */

      /**
       * 当前 Active Memory Provider；未绑定为 null。
       */
      let activeMemoryProvider: MemoryProvider | null = null;

      /**
       * MemorySlot：ZVHP1 规范插座对象名。
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
