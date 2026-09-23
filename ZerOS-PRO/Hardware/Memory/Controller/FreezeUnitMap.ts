/**
 * @module ZerOS.Hardware.Memory.FreezeUnitMap
 * @description 颗粒关联表只读视图构造
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 将构造期可变 Map 封为 ReadonlyMap 视图：禁止增删改绑，
 * 但允许改写 MemoryUnit 内部状态。供 MemoryController 使用。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. UnitIndexId / MemoryUnit 导入
 *   2. freezeUnitMap 函数
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import type { ZerOS as UnitIndexIdRoot } from "../Structure/UnitIndexId";
import type { ZerOS as MemoryUnitRoot } from "../Unit/MemoryUnit";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      /**
       * 将构造期使用的可变 Map 封为对外只读视图。
       *
       * 不变性边界：
       *   - 禁止：对关联表 add / 改绑 key→unit / delete / clear；
       *   - 允许：通过 get 拿到的 MemoryUnit 引用，改写其字段或调用其日后方法。
       *
       * @param source 构造期填好的工作 Map
       * @returns 冻结后的 ReadonlyMap；与 source 共享同一批 MemoryUnit 引用
       */
      export function freezeUnitMap(
        source: Map<
          UnitIndexIdRoot.Hardware.Memory.UnitIndexId,
          MemoryUnitRoot.Hardware.Memory.MemoryUnit
        >,
      ): ReadonlyMap<
        UnitIndexIdRoot.Hardware.Memory.UnitIndexId,
        MemoryUnitRoot.Hardware.Memory.MemoryUnit
      > {
        type Id = UnitIndexIdRoot.Hardware.Memory.UnitIndexId;
        type Unit = MemoryUnitRoot.Hardware.Memory.MemoryUnit;

        // view 只实现 ReadonlyMap 的查询面；不实现 set / delete / clear
        const view: ReadonlyMap<Id, Unit> = {
          /** 当前关联条目数；构造后应恒等于 Config.UnitCount */
          get size(): number {
            return source.size;
          },

          /** 按索引 ID 取颗粒；不存在则 undefined */
          get(key: Id): Unit | undefined {
            return source.get(key);
          },

          /** 判断某索引 ID 是否已绑定颗粒 */
          has(key: Id): boolean {
            return source.has(key);
          },

          /**
           * 遍历全部「索引 ID → 颗粒」。
           * 回调第三个参数传入本 view，避免调用方误拿可变 Map。
           */
          forEach(
            callbackfn: (
              value: Unit,
              key: Id,
              map: ReadonlyMap<Id, Unit>,
            ) => void,
            thisArg?: unknown,
          ): void {
            source.forEach((value, key) => {
              callbackfn.call(thisArg, value, key, view);
            });
          },

          /** 迭代 [索引 ID, 颗粒] 对 */
          entries(): MapIterator<[Id, Unit]> {
            return source.entries();
          },

          /** 仅迭代索引 ID */
          keys(): MapIterator<Id> {
            return source.keys();
          },

          /** 仅迭代颗粒实例 */
          values(): MapIterator<Unit> {
            return source.values();
          },

          /** for...of 默认走 entries */
          [Symbol.iterator](): MapIterator<[Id, Unit]> {
            return source[Symbol.iterator]();
          },
        };

        return Object.freeze(view);
      }
    }
  }
}
