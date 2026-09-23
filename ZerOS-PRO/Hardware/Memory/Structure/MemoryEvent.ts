/**
 * @module ZerOS.Hardware.Memory.Event
 * @description 内存事件对象（MemoryEvent）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 定义 Events 数组元素的三个规范字段。不决定何时追加。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. MemoryEvent
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import type { ZerOS as EventCodeRoot } from "../Enum/EventCode";
import type { ZerOS as Uint32Root } from "./Uint32";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      /**
       * 一条内存事件（ZMP1 §4.13）。
       * EventCode 取自登记表。Subject 是颗粒序号或浅切根下标。Detail 没有额外含义时为 0。
       */
      export interface MemoryEvent {
        readonly EventCode: EventCodeRoot.Hardware.Memory.EventCode;
        readonly Subject: Uint32Root.Hardware.Memory.Uint32;
        readonly Detail: Uint32Root.Hardware.Memory.Uint32;
      }
    }
  }
}
