/**
 * @module ZerOS.Hardware.Diagnostics.TraceEntry
 * @description 从诊断页读回的一条记录
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只描述报告器看到的字段。写入方看的是 TraceConfig 里的偏移，两边不共享可变对象。
 * At 是从会话起点起的微秒，不是墙上时钟。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 记录
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Diagnostics {
      /* ------------------------------------------------------------------ */
      /* 1. 记录                                                             */
      /* ------------------------------------------------------------------ */

      export interface TraceEntry {
        /** TraceOp 里的一个值。 */
        readonly Op: number;
        /** TraceLayer 里的一个值。 */
        readonly Layer: number;
        /** 核号；宿主事件用 -1。 */
        readonly Core: number;
        /** 从会话起点起的微秒。 */
        readonly At: number;
        /** 第一个参数：服务号、扩展口号或停机原因。 */
        readonly A0: number;
        /** 第二个参数：方向、序号或下标。 */
        readonly A1: number;
        /** span 编号；0 表示这条不是 span。 */
        readonly Span: number;
        /** 父 span；0 表示没有父。 */
        readonly Parent: number;
      }
    }
  }
}
