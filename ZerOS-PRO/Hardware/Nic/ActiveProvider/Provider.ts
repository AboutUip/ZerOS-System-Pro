/**
 * @module ZerOS.Hardware.Nic.ActiveProvider
 * @description 当前生效的网卡插头入口
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 主板扩展引导只导入这个文件。
 * 替换实现 = 替换整个 ActiveProvider 目录，导出名保持 ActiveNicProvider。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. ActiveNicProvider
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import type { ZerOS as ExpansionProviderRoot } from "../../Motherboard/Slot/Expansion/ExpansionProvider";
import { ZerOS as ReferenceRoot } from "../Provider/ReferenceNicProvider";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Nic {
      /**
       * 当前生效的网卡 Provider。
       * 导出名必须为 ActiveNicProvider。
       */
      export const ActiveNicProvider: ExpansionProviderRoot.Hardware.Motherboard.Slot.ExpansionProvider =
        ReferenceRoot.Hardware.Nic.ReferenceNicProvider;
    }
  }
}
