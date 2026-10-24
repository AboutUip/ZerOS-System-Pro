/**
 * @module ZerOS.Hardware.Pointer.ActiveProvider
 * @description 当前生效的鼠标插头入口
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 主板扩展引导只导入这个文件。
 * 替换实现 = 替换整个 ActiveProvider 目录，导出名保持 ActivePointerProvider。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. ActivePointerProvider
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import type { ZerOS as ExpansionProviderRoot } from "../../Motherboard/Slot/Expansion/ExpansionProvider";
import { ZerOS as ReferenceRoot } from "../Provider/ReferencePointerProvider";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Pointer {
      /**
       * 当前生效的鼠标 Provider。
       * 导出名必须为 ActivePointerProvider。
       */
      export const ActivePointerProvider: ExpansionProviderRoot.Hardware.Motherboard.Slot.ExpansionProvider =
        ReferenceRoot.Hardware.Pointer.ReferencePointerProvider;
    }
  }
}
