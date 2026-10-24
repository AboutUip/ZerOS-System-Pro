/**
 * @module ZerOS.Hardware.Debug.DebugLog
 * @description 本线程里最近的失败记录
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只在导入它的那条线程里留一份环形记录。CPU 线程和页面各有各的一份，不会串。
 * 不画面板，也不写控制台。页面上的调试入口打开时才来读它。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 记录
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { type ZerOS as FaultRoot } from "../../Cpu/Structure/FaultRecord";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Debug {
      type FaultRecord = FaultRoot.Hardware.Cpu.FaultRecord;

      /* ------------------------------------------------------------------ */
      /* 2. 记录                                                             */
      /* ------------------------------------------------------------------ */

      /** 只留最近 32 条。再早的失败已经要么上了面板，要么写进了控制台。 */
      const kept: FaultRecord[] = [];
      const cap = 32;

      /** 收下一条记录。满了就丢掉最旧的。 */
      export function rememberFault(record: FaultRecord): void {
        kept.push(record);
        if (kept.length > cap) {
          kept.shift();
        }
      }

      /** 按发生顺序的副本。调用方改这份数组不会改到这里。 */
      export function readFaults(): readonly FaultRecord[] {
        return kept.slice();
      }

      /** 最近一条。还没有失败时是 null。 */
      export function lastFault(): FaultRecord | null {
        const found = kept[kept.length - 1];
        if (found === undefined) {
          return null;
        }
        return found;
      }
    }
  }
}
