/**
 * @module ZerOS.Hardware.Memory.ActiveProvider
 * @description 当前生效的内存 Provider 入口（文件夹替换约定）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 本文件是主机**唯一**静态导入的内存插头入口。
 * 替换内存实现 = 替换整个 `ActiveProvider/` 目录（保持本文件导出名不变），
 * **不必**修改主板、Boot 或 Kernel 源码。
 *
 * 默认：转发本仓库 ReferenceMemoryProvider。
 * 社区包：在本目录提供自己的实现，并导出同名 `ActiveMemoryProvider`。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 参考 Provider 导入
 *   2. 导出 ActiveMemoryProvider（规范导出名，禁止改名）
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入：默认使用参考实现；替换目录后可改为本地实现                         */
/* -------------------------------------------------------------------------- */

import { ZerOS as ReferenceProviderRoot } from "../Provider/ReferenceMemoryProvider";
import type { ZerOS as MemoryProviderRoot } from "../../Motherboard/Slot/Memory/MemoryProvider";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      /* -------------------------------------------------------------------- */
      /* 2. ActiveMemoryProvider：导出名固定，供主板绑定                     */
      /* -------------------------------------------------------------------- */

      /**
       * 当前生效的 Memory Provider（ZVHP1）。
       * 导出名必须为 `ActiveMemoryProvider`；主板只认此名。
       */
      export const ActiveMemoryProvider: MemoryProviderRoot.Hardware.Motherboard.Slot.MemoryProvider =
        ReferenceProviderRoot.Hardware.Memory.ReferenceMemoryProvider;
    }
  }
}
