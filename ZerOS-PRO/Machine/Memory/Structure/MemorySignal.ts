/**
 * @module ZerOS.Machine.Memory.Signal
 * @description 内存信号对象结构（MemorySignal）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 单独定义 Signals 数组元素结构壳；字段尚未约定，禁止自行发明业务字段。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. MemorySignal 接口
 */

export namespace ZerOS {
  export namespace Machine {
    export namespace Memory {
      /**
       * 内存信号对象（实现壳，ZMP1 §4.13）。
       * 数组元素必须是 object；本类型仅作占位。
       */
      export interface MemorySignal {
        /** 留空占位：禁止当作已约定字段使用 */
        readonly _SignalShell?: never;
      }

      /**
       * 结构模块运行时锚点：保证本文件参与命名空间值合并（非协议字段）。
       */
      export const MemorySignalModule = "MemorySignal" as const;
    }
  }
}
