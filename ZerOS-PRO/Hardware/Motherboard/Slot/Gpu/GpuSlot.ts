/**
 * @module ZerOS.Hardware.Motherboard.Slot.Gpu.Slot
 * @description GpuSlot：显卡可插拔插座
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 规范对象 GpuSlot：Bind / GetActive。
 * 同一时刻至多一个 Active GPU Provider。
 * 不建立帧存储，也不把帧送上面板。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 校验
 *   3. GpuSlot
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import type { ZerOS as GpuProviderRoot } from "./GpuProvider";
import { ZerOS as ProviderMetaRoot } from "../Structure/ProviderMeta";
import { ZerOS as GpuConfigRoot } from "../../../Gpu/Config/GpuConfig";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      export namespace Slot {
        type GpuProvider = GpuProviderRoot.Hardware.Motherboard.Slot.GpuProvider;

        const FrameEdgeMin = GpuConfigRoot.Hardware.Gpu.Config.FrameEdgeMin;
        const FrameEdgeMax = GpuConfigRoot.Hardware.Gpu.Config.FrameEdgeMax;
        const FramePixelMaxCount = GpuConfigRoot.Hardware.Gpu.Config.FramePixelMaxCount;

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

        function edgeOk(value: number): boolean {
          return Number.isInteger(value) && value >= FrameEdgeMin && value <= FrameEdgeMax;
        }

        function isValidGpuProvider(provider: GpuProvider): boolean {
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
          if (provider.ActiveProtocol !== "ZGP1") {
            return false;
          }
          if (!edgeOk(provider.FrameWidth) || !edgeOk(provider.FrameHeight)) {
            return false;
          }
          if (provider.FrameWidth * provider.FrameHeight > FramePixelMaxCount) {
            return false;
          }
          return typeof provider.Clear === "function"
            && typeof provider.Plot === "function"
            && typeof provider.Image === "function"
            && typeof provider.Character === "function"
            && typeof provider.Present === "function";
        }

        let activeGpuProvider: GpuProvider | null = null;

        /**
         * GpuSlot：ZVHP1 规范插座对象名。
         * 谁来 Bind 由主板决定。帧尺寸以绑定成功的这份实现为准。
         */
        export const GpuSlot = {
          /**
           * 绑定 Active GPU Provider。
           * 协议不是 ZGP1，或帧尺寸越界时，保持原来的 Active 不变。
           */
          Bind(provider: GpuProvider): void {
            if (!isValidGpuProvider(provider)) {
              return;
            }
            activeGpuProvider = provider;
          },

          /** 取得当前 Active Provider。未绑定返回 null。 */
          GetActive(): GpuProvider | null {
            return activeGpuProvider;
          },
        };
      }
    }
  }
}
