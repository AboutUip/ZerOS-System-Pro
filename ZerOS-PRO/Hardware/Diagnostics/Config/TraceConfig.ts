/**
 * @module ZerOS.Hardware.Diagnostics.TraceConfig
 * @description 诊断页的形状
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只放 trace 页的固定布局。记录是定长的，写入不加锁，靠每格的序号判断写完没有。
 * 这不是协议。容量和记录宽度只在这份实现和报告器之间约定。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 形状
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Diagnostics {
      /* ------------------------------------------------------------------ */
      /* 1. 形状                                                             */
      /* ------------------------------------------------------------------ */

      /** 诊断页的固定布局。头部 64 字节，随后是定长记录。 */
      export const TraceConfig = {
        Magic: 0x5a545243,
        Version: 1,
        Capacity: 65536,
        RecordBytes: 32,
        HeaderBytes: 64,
        HeadSlot: 0,
        DroppedSlot: 1,
        EnabledSlot: 2,
        CapacitySlot: 3,
        VersionSlot: 4,
        MagicSlot: 5,
        SeqSlot: 6,
        PendingSlot: 7,
        PromptSlot: 8,
        SpanSlot: 9,
        /* 10、11 两个字留给起始时刻；它不能和 Prompt/Span 计数重叠。 */
        OriginOffset: 40,
        MemCountSlot: 12,
        MemTotalSlot: 13,
        MemMaxSlot: 14,
        PageBytes: 64 + 65536 * 32,
      } as const;
    }
  }
}
