/**
 * @module ZerOS.Hardware.Memory.Signal
 * @description 内存信号对象（MemorySignal）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 定义 Signals 数组元素的三个规范字段。电平可以被后来的观察覆盖。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. MemorySignal
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import type { ZerOS as SignalCodeRoot } from "../Enum/SignalCode";
import type { ZerOS as Uint32Root } from "./Uint32";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      /**
       * 一条内存信号（ZMP1 §4.13）。
       * 同一 SignalCode 与 Subject 在数组里只留一条。
       */
      export interface MemorySignal {
        readonly SignalCode: SignalCodeRoot.Hardware.Memory.SignalCode;
        readonly Level: SignalCodeRoot.Hardware.Memory.SignalLevel;
        readonly Subject: Uint32Root.Hardware.Memory.Uint32;
      }
    }
  }
}
