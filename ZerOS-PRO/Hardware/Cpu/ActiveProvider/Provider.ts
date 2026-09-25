/**
 * @module ZerOS.Hardware.Cpu.ActiveProvider
 * @description 当前生效的 CPU 插头入口
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 本文件是 CPU 线程唯一静态导入的插头入口。
 * 替换实现 = 替换整个 ActiveProvider 目录，导出名保持 ActiveCpuProvider。
 * 主板不导入这个文件。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. ActiveCpuProvider
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as ReferenceRoot } from "../Provider/ReferenceCpuProvider";
import type { ZerOS as CpuProviderRoot } from "../../Motherboard/Slot/Cpu/CpuProvider";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      /**
       * 当前生效的 CPU Provider。
       * 导出名必须为 ActiveCpuProvider。
       */
      export const ActiveCpuProvider: CpuProviderRoot.Hardware.Motherboard.Slot.CpuProvider =
        ReferenceRoot.Hardware.Cpu.ReferenceCpuProvider;
    }
  }
}
