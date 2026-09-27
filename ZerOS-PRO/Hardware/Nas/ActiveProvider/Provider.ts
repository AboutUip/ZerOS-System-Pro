/**
 * @module ZerOS.Hardware.Nas.ActiveProvider
 * @description 当前生效的 NAS 插头入口
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 主板扩展引导只导入这个文件。
 * 替换实现 = 替换整个 ActiveProvider 目录，导出名保持 ActiveNasProvider。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. ActiveNasProvider
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import type { ZerOS as ExpansionProviderRoot } from "../../Motherboard/Slot/Expansion/ExpansionProvider";
import { ZerOS as ReferenceRoot } from "../Provider/ReferenceNasProvider";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Nas {
      /**
       * 当前生效的 NAS Provider。
       * 导出名必须为 ActiveNasProvider。
       */
      export const ActiveNasProvider: ExpansionProviderRoot.Hardware.Motherboard.Slot.ExpansionProvider =
        ReferenceRoot.Hardware.Nas.ReferenceNasProvider;
    }
  }
}
