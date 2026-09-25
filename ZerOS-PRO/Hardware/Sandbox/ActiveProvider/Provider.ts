/**
 * @module ZerOS.Hardware.Sandbox.ActiveProvider
 * @description 当前生效的沙盒插头入口
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 主板扩展引导只导入这个文件。
 * 替换实现 = 替换整个 ActiveProvider 目录，导出名保持 ActiveSandboxProvider。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. ActiveSandboxProvider
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import type { ZerOS as ExpansionProviderRoot } from "../../Motherboard/Slot/Expansion/ExpansionProvider";
import { ZerOS as ReferenceRoot } from "../Provider/ReferenceSandboxProvider";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Sandbox {
      /**
       * 当前生效的沙盒 Provider。
       * 导出名必须为 ActiveSandboxProvider。
       */
      export const ActiveSandboxProvider: ExpansionProviderRoot.Hardware.Motherboard.Slot.ExpansionProvider =
        ReferenceRoot.Hardware.Sandbox.ReferenceSandboxProvider;
    }
  }
}
