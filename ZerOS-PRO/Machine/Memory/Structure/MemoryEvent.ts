/**
 * @module ZerOS.Machine.Memory.Event
 * @description 内存事件对象结构（MemoryEvent）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 单独定义 Events 数组元素结构壳；字段尚未约定，禁止自行发明业务字段。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. MemoryEvent 接口
 */

export namespace ZerOS {
  export namespace Machine {
    export namespace Memory {
      /**
       * 内存事件对象（实现壳，ZMP1 §4.13）。
       * 数组元素必须是 object；本类型仅作占位。
       */
      export interface MemoryEvent {
        /** 留空占位：禁止当作已约定字段使用 */
        readonly _EventShell?: never;
      }

      /**
       * 结构模块运行时锚点：保证本文件参与命名空间值合并（非协议字段）。
       */
      export const MemoryEventModule = "MemoryEvent" as const;
    }
  }
}
