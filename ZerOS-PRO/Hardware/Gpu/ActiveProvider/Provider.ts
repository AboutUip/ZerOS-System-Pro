/**
 * @module ZerOS.Hardware.Gpu.ActiveProvider
 * @description 当前生效的显卡插头入口
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 本文件是显卡线程唯一静态导入的插头入口。
 * 替换实现 = 替换整个 ActiveProvider 目录，导出名保持 ActiveGpuProvider。
 * 主板不导入这个文件。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. ActiveGpuProvider
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as ReferenceRoot } from "../Provider/ReferenceGpuProvider";
import type { ZerOS as GpuProviderRoot } from "../../Motherboard/Slot/Gpu/GpuProvider";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Gpu {
      /**
       * 当前生效的 GPU Provider。
       * 导出名必须为 ActiveGpuProvider。
       */
      export const ActiveGpuProvider: GpuProviderRoot.Hardware.Motherboard.Slot.GpuProvider =
        ReferenceRoot.Hardware.Gpu.ReferenceGpuProvider;
    }
  }
}
