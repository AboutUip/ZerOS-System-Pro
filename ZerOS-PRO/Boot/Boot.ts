/**
 * @module ZerOS.Boot
 * @description Boot：绑定 ActiveProvider 目录中的内存插头并初始化
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 固定从 `Machine/Memory/ActiveProvider/Provider` 读取 ActiveMemoryProvider。
 * 替换内存实现 = 替换 ActiveProvider 文件夹；本文件导入路径不变。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. Slot / ActiveProvider / MachineMemory 导入
 *   2. Boot 命名空间
 *   3. 模块加载执行 Run
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入：ActiveProvider 路径固定，禁止改为厂商私有路径                       */
/* -------------------------------------------------------------------------- */

import { ZerOS as MemorySlotRoot } from "../Machine/Slots/Memory/MemorySlot";
import { ZerOS as ActiveProviderRoot } from "../Machine/Memory/ActiveProvider/Provider";
import { ZerOS as MachineMemoryRoot } from "../Machine/Memory/Bootstrap/MachineMemory";

export namespace ZerOS {
  /* ------------------------------------------------------------------------ */
  /* 2. Boot                                                                   */
  /* ------------------------------------------------------------------------ */

  export namespace Boot {
    /**
     * ZVHP1 内存插座。
     */
    export const MemorySlot: typeof MemorySlotRoot.Machine.Slots.MemorySlot =
      MemorySlotRoot.Machine.Slots.MemorySlot;

    /**
     * ZMP1 内存引导门面（转发 Active Provider）。
     */
    export const MachineMemory: typeof MachineMemoryRoot.Machine.Memory.MachineMemory =
      MachineMemoryRoot.Machine.Memory.MachineMemory;

    /**
     * 执行最小启动引导。
     *
     * 流水线：
     *   (1) Bind(ActiveProvider 目录导出的 ActiveMemoryProvider)
     *   (2) MachineMemory.MemoryInit.Initialize()
     */
    export function Run(): void {
      // —— (1) 始终从固定目录绑定；换实现只换文件夹 ——
      MemorySlot.Bind(
        ActiveProviderRoot.Machine.Memory.ActiveMemoryProvider,
      );

      // —— (2) 领域初始化 ——
      MachineMemory.MemoryInit.Initialize();
    }
  }
}

/* -------------------------------------------------------------------------- */
/* 3. 入口副作用                                                               */
/* -------------------------------------------------------------------------- */

ZerOS.Boot.Run();
