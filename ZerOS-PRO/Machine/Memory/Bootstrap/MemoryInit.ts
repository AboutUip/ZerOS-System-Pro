/**
 * @module ZerOS.Machine.Memory.Init
 * @description 内存初始化入口（MemoryInit）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 提供 ZMP1 §4.14 规范名 `MemoryInit`：挂在 `MachineMemory.MemoryInit`，
 * **仅 Boot** 可调用。最小引导：`Initialize` 创建内存总控并挂到 Kernel。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 总控 / Kernel 导入
 *   2. MemoryInit 接口（含规范方法 Initialize）
 *   3. MemoryInitInstance 实现
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入：总控类 + Kernel 挂载面                                             */
/* -------------------------------------------------------------------------- */

import { ZerOS as MemoryControllerRoot } from "../Controller/MemoryController";
import { ZerOS as KernelRoot } from "../../../Kernel/Kernel";

export namespace ZerOS {
  export namespace Machine {
    export namespace Memory {
      /* -------------------------------------------------------------------- */
      /* 2. MemoryInit：入口形态 + 最小规范方法                                */
      /* -------------------------------------------------------------------- */

      /**
       * MemoryInit 入口（ZMP1 §4.14）。
       * 规范方法：`Initialize`（无参、无返回值）；其余 API 后续协议再定。
       */
      export interface MemoryInit {
        /**
         * 实现内品牌标记：标明此对象为 MemoryInit 入口。
         * 非 ZMP1 互操作必选字段。
         */
        readonly __MemoryInitBrand: "MemoryInit";

        /**
         * 执行内存初始化（ZMP1 §4.14 最小规范方法名 `Initialize`）。
         *
         * 语义：
         *   (1) 若 Kernel.MemoryController 已非 null → 直接返回（幂等）
         *   (2) new MemoryController（建关联表与颗粒）
         *   (3) 将总控自身写入 Kernel.MemoryController
         */
        Initialize(): void;
      }

      /* -------------------------------------------------------------------- */
      /* 3. 入口实例                                                           */
      /* -------------------------------------------------------------------- */

      /**
       * 内存初始化入口实例（供 MachineMemory.MemoryInit 挂载）。
       * 访问角色：仅 Boot。
       */
      export const MemoryInitInstance: MemoryInit = {
        __MemoryInitBrand: "MemoryInit",

        Initialize(): void {
          // —— (1) 幂等：已挂载则不再新建 ——
          if (KernelRoot.Kernel.MemoryController !== null) {
            return;
          }

          // —— (2) 引导并初始化内存总控 ——
          const controller: MemoryControllerRoot.Machine.Memory.MemoryController =
            new MemoryControllerRoot.Machine.Memory.MemoryController();

          // —— (3) 暴露给 Kernel（规范字段名 MemoryController） ——
          KernelRoot.Kernel.MemoryController = controller;
        },
      };
    }
  }
}
