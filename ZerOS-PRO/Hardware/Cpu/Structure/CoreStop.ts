/**
 * @module ZerOS.Hardware.Cpu.CoreStop
 * @description 一颗核心最近一次停机的宿主记录
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只描述页面上保留的那一条记录。没有调用栈。
 * 这不是客程序指令，也不是 ZCP1 查询字段。CPU 线程发出，主板转到页面。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 记录
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      /**
       * 一颗核心当前这一次停下。
       * Core 是核心号。Reason 见 StopReason：0 结束或 halt，1 让出、时间片或抢占，2 等系统调用，3 执行失败。
       * Index 是指令编号，和 `obrc -debug` 对照表里的编号相同。序列走到头时它等于指令条数。
       * Op 是这一条的操作名。走到头时是空串。Detail 是失败原文，没有失败时是空串。
       */
      export interface CoreSnapshot {
        readonly Registers: readonly string[];
        readonly Pc: string;
        readonly StackPointer: string;
        readonly StackStart: string;
        readonly StackEnd: string;
      }

      export interface CoreStop {
        readonly Core: number;
        readonly Reason: number;
        readonly Index: number;
        readonly Op: string;
        readonly Detail: string;
        readonly Snapshot: CoreSnapshot | null;
      }
    }
  }
}
