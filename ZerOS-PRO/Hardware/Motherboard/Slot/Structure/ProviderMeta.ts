/**
 * @module ZerOS.Hardware.Motherboard.Slot.ProviderMeta
 * @description 可插拔 Provider 元数据（ZVHP1 §4.2）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 单独定义 ProviderId / ProviderVendor / ActiveProtocol 类型与长度常量。
 * 插座归主板所有。本文件不决定主板支持哪一版领域协议。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 长度常量
 *   2. 元数据字段类型
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      export namespace Slot {
        /** ProviderId 最大长度（ZVHP1：1–64） */
        export const ProviderIdMaxLength = 64;

        /** ProviderVendor 最大长度（ZVHP1：1–32） */
        export const ProviderVendorMaxLength = 32;

        /** Provider 标识字符串 */
        export type ProviderId = string;

        /** Provider 厂商标识字符串 */
        export type ProviderVendor = string;

        /**
         * 领域协议标识。
         * 内存插头当前必须为 "ZMP1"（ZVHP1 对内存 Provider 的要求）。
         */
        export type ActiveProtocol = string;
      }
    }
  }
}
