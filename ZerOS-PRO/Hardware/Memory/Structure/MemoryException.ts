/**
 * @module ZerOS.Hardware.Memory.Exception
 * @description 内存异常对象结构与工厂（MemoryException）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 单独定义 ZMP1 §4.11 MemoryException 四属性结构、概述长度常量，
 * 以及校验构造工厂 createMemoryException。不包含单元/总控类。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. ExceptionCategory 导入
 *   2. ExceptionSummaryMaxLength 常量
 *   3. MemoryException 接口
 *   4. 码点长度辅助与 createMemoryException 工厂
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import type { ZerOS as ExceptionCategoryRoot } from "../Enum/ExceptionCategory";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      /* -------------------------------------------------------------------- */
      /* 2. 概述长度常量                                                       */
      /* -------------------------------------------------------------------- */

      /**
       * 异常概述最大长度语义常量（ZMP1 §4.11.4）：码点长度必须严格小于本值。
       * 非配置面必选字段；实现侧用于校验。
       */
      export const ExceptionSummaryMaxLength = 256;

      /* -------------------------------------------------------------------- */
      /* 3. MemoryException 结构                                               */
      /* -------------------------------------------------------------------- */

      /**
       * 内存异常对象（ZMP1 §4.11）：四属性名称逐字固定、大小写敏感。
       *
       * 主机侧互操作只保证识别下列四属性；可以附加实现私有属性，但不得替代规范名。
       */
      export interface MemoryException {
        /**
         * 异常标号：非负整数，必须落在 0x0000–0xFFFF；
         * 稳定含义以 ExceptionCodeRegistry 为准。
         */
        ExceptionCode: number;

        /**
         * 异常类别：必须精确为五档之一（0x00–0x04）。
         */
        ExceptionCategory: ExceptionCategoryRoot.Hardware.Memory.ExceptionCategory;

        /**
         * 异常概述：人类可读；Unicode 码点长度必须严格小于 256。
         */
        ExceptionSummary: string;

        /**
         * 异常链：必须为非 null 的 object；内部 schema 由实现自定义（可用 {}）。
         */
        ExceptionChain: object;
      }

      /* -------------------------------------------------------------------- */
      /* 4. 工厂：先检查形态，再构造可写入数组的对象                           */
      /* -------------------------------------------------------------------- */

      /**
       * 计算字符串 Unicode 码点长度（ZMP1 概述计量方式）。
       * 使用 for...of，避免对 string 使用扩展运算触发误用告警。
       */
      function exceptionSummaryCodePointLength(summary: string): number {
        let length = 0;
        for (const _codePoint of summary) {
          length += 1;
        }
        return length;
      }

      /**
       * 校验并构造 MemoryException（检查优先，拒绝非法形态）。
       *
       * @returns 合法四属性对象；若入参不合法则返回 null（由调用方自行处理或记链）
       */
      export function createMemoryException(params: {
        readonly ExceptionCode: number;
        readonly ExceptionCategory: ExceptionCategoryRoot.Hardware.Memory.ExceptionCategory;
        readonly ExceptionSummary: string;
        readonly ExceptionChain: object;
      }): MemoryException | null {
        const code: number = params.ExceptionCode;
        // 检查：标号空间 0x0000–0xFFFF，且为有限非负整数
        if (!Number.isInteger(code) || code < 0x0000 || code > 0xffff) {
          return null;
        }

        // 类别由 ExceptionCategory 类型收窄为五档；此处信任类型边界
        const category: ExceptionCategoryRoot.Hardware.Memory.ExceptionCategory =
          params.ExceptionCategory;

        const summary: string = params.ExceptionSummary;
        // 检查：概述码点长度严格小于 256（ZMP1 §4.11.4）
        if (
          typeof summary !== "string" ||
          exceptionSummaryCodePointLength(summary) >= ExceptionSummaryMaxLength
        ) {
          return null;
        }

        // ExceptionChain 在类型上已是 object（不含 null）
        const chain: { readonly Cause: MemoryException | null } | null =
          storedExceptionChain(params.ExceptionChain);
        if (chain === null) {
          return null;
        }

        return {
          ExceptionCode: code,
          ExceptionCategory: category,
          ExceptionSummary: summary,
          ExceptionChain: chain,
        };
      }

      /**
       * 写入数组的异常链只保留 Cause。
       * 没有 Cause 键时记为 null。Cause 不是 null 也不是四属性异常时，整条拒绝。
       */
      function storedExceptionChain(
        chain: object,
      ): { readonly Cause: MemoryException | null } | null {
        if (Array.isArray(chain)) {
          return null;
        }
        if (!("Cause" in chain)) {
          return { Cause: null };
        }
        const cause: unknown = chain.Cause;
        if (cause === null) {
          return { Cause: null };
        }
        if (!isStoredException(cause)) {
          return null;
        }
        return { Cause: cause };
      }

      function isStoredException(value: unknown): value is MemoryException {
        if (value === null || typeof value !== "object" || Array.isArray(value)) {
          return false;
        }
        if (!("ExceptionCode" in value) || !("ExceptionCategory" in value)) {
          return false;
        }
        if (!("ExceptionSummary" in value) || !("ExceptionChain" in value)) {
          return false;
        }
        return (
          typeof value.ExceptionSummary === "string" &&
          typeof value.ExceptionChain === "object" &&
          value.ExceptionChain !== null
        );
      }
    }
  }
}
