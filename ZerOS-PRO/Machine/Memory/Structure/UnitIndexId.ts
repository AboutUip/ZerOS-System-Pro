/**
 * @module ZerOS.Machine.Memory.UnitIndexId
 * @description 颗粒索引 ID（实现约定，非 ZMP1 MemoryId）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 单独定义总控关联表键类型、定长与字符表；与协议 MemoryId（256 ASCII）分离。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. UnitIndexId 类型
 *   2. UnitIndexIdLength / UnitIndexIdAlphabet 常量
 */

export namespace ZerOS {
  export namespace Machine {
    export namespace Memory {
      /**
       * 颗粒索引 ID：总控内部用于索引 MemoryUnit 的键。
       *
       * - 用途：在 Units 关联表中查找某一颗颗粒。
       * - 非协议：不得拿本类型冒充 ZMP1 §4.7 的 MemoryId（后者长度 256）。
       * - 形态：长度固定为 UnitIndexIdLength 的随机字符串。
       */
      export type UnitIndexId = string;

      /**
       * 颗粒索引 ID 的固定字符长度（实现约定 = 16，非协议写死值）。
       */
      export const UnitIndexIdLength = 16;

      /**
       * 索引 ID 可用字符表：大写 + 小写 + 数字，共 62 个可打印字符。
       *
       * 选取理由：便于日志辨认；避开控制字符；与 ZMP1 MemoryId 字符集无关。
       */
      export const UnitIndexIdAlphabet =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    }
  }
}
