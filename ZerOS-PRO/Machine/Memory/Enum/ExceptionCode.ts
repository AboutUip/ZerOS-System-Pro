/**
 * @module ZerOS.Machine.Memory.ExceptionCode
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
  export namespace Machine {
    export namespace Memory {
      /**
       * 已登记异常标号短名常量（与 ExceptionCodeRegistry 双向对齐）。
       */
      export const ExceptionCodeValue = {
        /** 0x0000：未细分通用占位 */
        Unspecified: 0x0000,
        /** 0x0001：非法颗粒大小 UnitSizeBytes */
        IllegalUnitSizeBytes: 0x0001,
        /** 0x0002：非法颗粒数量 UnitCount */
        IllegalUnitCount: 0x0002,
        /** 0x0003：宿主缺少可用的 crypto.getRandomValues */
        CryptoUnavailable: 0x0003,
        /** 0x0004：颗粒索引 ID 字符表非法 */
        UnitIndexAlphabetInvalid: 0x0004,
      } as const;
    }
  }
}
