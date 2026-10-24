/**
 * @module ZerOS.Hardware.Cpu.PageCoreStop
 * @description 页面上保留的最近停机记录
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只在页面线程使用。CPU 线程和主板线程不导入它，所以两边不会各有一份表。
 * 记下主板转来的记录，并按核心号读出最近一次。不写客程序能读的内存，也不画引导画面。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 记录表
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { type ZerOS as CoreStopRoot } from "../Structure/CoreStop";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      type CoreStop = CoreStopRoot.Hardware.Cpu.CoreStop;

      /* ------------------------------------------------------------------ */
      /* 2. 记录表                                                           */
      /* ------------------------------------------------------------------ */

      /** 每颗核心只留当前这一条。新的一次停下盖住上一次。 */
      const latest = new Map<number, CoreStop>();

      /** 收下一条已经核对过形状的记录。非法编号直接丢掉，避免盖住上一份好记录。 */
      export function noteCoreStop(record: CoreStop): void {
        if (!Number.isInteger(record.Core) || record.Core < 0) {
          return;
        }
        if (!Number.isInteger(record.Reason) || !Number.isInteger(record.Index) || record.Index < 0) {
          return;
        }
        latest.set(record.Core, {
          Core: record.Core,
          Reason: record.Reason,
          Index: record.Index,
          Op: record.Op,
          Detail: record.Detail,
        });
      }

      /**
       * 读一颗核心最近一次停机。
       * 这颗核心还没有停过，或编号不是整数，则是 null。
       */
      export function readCoreStop(ordinal: number): CoreStop | null {
        if (!Number.isInteger(ordinal)) {
          return null;
        }
        const found = latest.get(ordinal);
        if (found === undefined) {
          return null;
        }
        return {
          Core: found.Core,
          Reason: found.Reason,
          Index: found.Index,
          Op: found.Op,
          Detail: found.Detail,
        };
      }
    }
  }
}
