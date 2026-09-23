/**
 * @module ZerOS.Hardware.Memory.UnitOrdinal
 * @description 颗粒序号上界（UnitOrdinal 仍须是 Uint32）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只提供 UnitCount 的协议上界。
 * 序号本身是 Uint32，由总控在创建颗粒时写入 MemoryUnit.UnitOrdinal。
 * 不生成序号，也不做跨颗粒寻址。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. MaxUnitCount
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      /**
       * UnitCount 上界：2^32 = 4294967296（ZMP1 §4.4）。
       *
       * 最后一颗的 UnitOrdinal 是 UnitCount − 1，并且必须仍是 Uint32。
       * 因此颗粒张数可以等于 4294967296，但不能再大。
       * 本值本身不是 Uint32（它等于 2^32）。
       */
      export const MaxUnitCount = 4294967296;
    }
  }
}
