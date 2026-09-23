/**
 * @module ZerOS.Hardware.Memory.ExceptionCode
 * @description 异常标号枚举量（ExceptionCode）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 单独承载已登记 ExceptionCode 短名常量，与 ExceptionCodeRegistry 双向对齐。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. ExceptionCodeValue 常量
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      /**
       * 已登记异常标号短名常量（与 ExceptionCodeRegistry 双向对齐）。
       */
      export const ExceptionCodeValue = {
        /** 0x0000：未细分通用占位 */
        Unspecified: 0x0000,
        /** 0x0001：非法颗粒大小（非正整数，或 CellCount 超出 Uint32） */
        IllegalUnitSizeBytes: 0x0001,
        /** 0x0002：非法颗粒数量 UnitCount */
        IllegalUnitCount: 0x0002,
        /** 0x0003：宿主缺少可用的 crypto.getRandomValues */
        CryptoUnavailable: 0x0003,
        /** 0x0004：颗粒索引 ID 字符表非法 */
        UnitIndexAlphabetInvalid: 0x0004,
        /** 0x0005：非法浅维度（浅切块数） */
        IllegalShallowDimension: 0x0005,
        /** 0x0006：非法深维度（嵌套深度上限） */
        IllegalDeepDimension: 0x0006,
        /** 0x0007：存储端口时颗粒尚未正式可用 */
        UnitNotActive: 0x0007,
        /** 0x0008：CellIndex 越出该颗粒的位元范围 */
        BitIndexOutOfRange: 0x0008,
        /** 0x0009：WriteBit 的位元值不是 0 或 1 */
        IllegalBitValue: 0x0009,
        /** 0x000A：OctetIndex 越出该颗粒的八位组范围 */
        OctetIndexOutOfRange: 0x000a,
        /** 0x000B：WriteOctet 的八位组值不是 0–255 的整数 */
        IllegalOctetValue: 0x000b,
        /** 0x000C：UnitOrdinal 越出 0 .. UnitCount-1 */
        UnitOrdinalOutOfRange: 0x000c,
        /** 0x000D：某一块的位元跨度长于 Uint32，浅切不能完成 */
        BlockSpanExceedsUint32: 0x000d,
        /** 0x000E：块内位元偏移越出该块 BitLength */
        BlockBitOffsetOutOfRange: 0x000e,
        /** 0x000F：NestingDepth 已到 DeepDimension，不能再加深 */
        NestingAtCeiling: 0x000f,
        /** 0x0010：这块已经有子块，不能再次加深 */
        AlreadyDeepened: 0x0010,
        /** 0x0011：初始化前测试尚未全部通过，禁止发布总控 */
        TestsNotPassed: 0x0011,
        /** 0x0012：发布时没有任何已存在的八位组 */
        NoUsableStorage: 0x0012,
        /** 0x0013：线性位元地址越出整机位元线 */
        LinearBitIndexOutOfRange: 0x0013,
        /** 0x0014：整数宽度不是 2、4 或 8 */
        IllegalIntegerWidth: 0x0014,
        /** 0x0015：整数跨度越出八位组范围 */
        IntegerSpanOutOfRange: 0x0015,
        /** 0x0016：整数值超出该宽度 */
        IllegalIntegerValue: 0x0016,
        /** 0x0017：块内八位组下标越出该块能容纳的完整八位组 */
        BlockOctetIndexOutOfRange: 0x0017,
        /** 0x0018：浅切根下标越界 */
        BlockIndexOutOfRange: 0x0018,
        /** 0x0019：浅切根已经有主人 */
        AlreadyClaimed: 0x0019,
        /** 0x001A：浅切根还没有主人 */
        NotClaimed: 0x001a,
        /** 0x001B：归还时的主人与领取时不一致 */
        OwnerMismatch: 0x001b,
      } as const;
    }
  }
}
