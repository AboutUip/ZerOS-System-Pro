/**
 * @module ZerOS.Hardware.Memory.SideChannel
 * @description 事件追加与信号电平更新
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 事件只追加。同一信号标号加同一主体只保留一条，后写的电平覆盖先前的。
 * 不决定何时发生这些事。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. appendEvent / upsertSignal
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import type { ZerOS as EventCodeRoot } from "../Enum/EventCode";
import type { ZerOS as SignalCodeRoot } from "../Enum/SignalCode";
import type { ZerOS as MemoryEventRoot } from "./MemoryEvent";
import type { ZerOS as MemorySignalRoot } from "./MemorySignal";
import type { ZerOS as Uint32Root } from "./Uint32";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      /**
       * 在数组末尾记下一条事件。三个字段都已经是协议类型。
       */
      export function appendEvent(
        events: MemoryEventRoot.Hardware.Memory.MemoryEvent[],
        eventCode: EventCodeRoot.Hardware.Memory.EventCode,
        subject: Uint32Root.Hardware.Memory.Uint32,
        detail: Uint32Root.Hardware.Memory.Uint32,
      ): void {
        events.push({
          EventCode: eventCode,
          Subject: subject,
          Detail: detail,
        });
      }

      /**
       * 按标号和主体找到信号并改电平。没有则追加。
       * 数组里每种（标号，主体）至多一条。
       */
      export function upsertSignal(
        signals: MemorySignalRoot.Hardware.Memory.MemorySignal[],
        signalCode: SignalCodeRoot.Hardware.Memory.SignalCode,
        level: SignalCodeRoot.Hardware.Memory.SignalLevel,
        subject: Uint32Root.Hardware.Memory.Uint32,
      ): void {
        let index = 0;
        while (index < signals.length) {
          const current = signals[index];
          if (current?.SignalCode === signalCode && current.Subject === subject) {
            signals[index] = {
              SignalCode: signalCode,
              Level: level,
              Subject: subject,
            };
            return;
          }
          index += 1;
        }
        signals.push({
          SignalCode: signalCode,
          Level: level,
          Subject: subject,
        });
      }
    }
  }
}
