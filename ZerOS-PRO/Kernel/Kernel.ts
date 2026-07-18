/**
 * @module ZerOS.Kernel
 * @description Kernel 层占位：承接 ZMP1 面向 Kernel 的内存总控暴露字段
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 提供规范字段名 `MemoryController`（ZMP1 §4.14）：内存总控初始化完成后
 * 将自身挂到本字段，供 Kernel 调用。后续 API 亦将挂在该实例上。
 *
 * 当前：字段默认 null；由 MemoryInit.Initialize 在引导成功后写入总控引用。
 * 不实现 Kernel 业务、不调用总控业务方法（业务 API 后续协议再定）。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 内存总控类型导入
 *   2. Kernel 命名空间与 MemoryController 字段
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入：总控类型（仅用于字段标注；不在此 new）                             */
/* -------------------------------------------------------------------------- */

import type { ZerOS as MemoryControllerRoot } from "../Machine/Memory/Controller/MemoryController";

export namespace ZerOS {
  /* ------------------------------------------------------------------------ */
  /* 2. Kernel：面向内核的挂载面                                               */
  /* ------------------------------------------------------------------------ */

  export namespace Kernel {
    /**
     * 内存总控对外实例（ZMP1 §4.14 规范字段名 `MemoryController`）。
     *
     * - 初始化完成前：必须为 null（未就绪）
     * - 初始化完成后：由 MemoryInit.Initialize 写入总控自身引用
     * - 业务方法 / 返回值：后续协议再定
     *
     * 使用 let：后续引导会赋值；当前为 null 属预期。
     */
    // eslint-disable-next-line prefer-const -- ZMP1 §4.14：MemoryInit 完成后写入本字段
    export let MemoryController: MemoryControllerRoot.Machine.Memory.MemoryController | null =
      null;
  }
}
