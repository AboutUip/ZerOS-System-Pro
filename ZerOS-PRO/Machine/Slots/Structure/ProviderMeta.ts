/**
 * @module ZerOS.Machine.Slots.ProviderMeta
 * @description 可插拔 Provider 元数据（ZVHP1 §4.2）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 单独定义 ProviderId / ProviderVendor / ActiveProtocol 类型与长度常量。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 长度常量
 *   2. 元数据字段类型
 */

export namespace ZerOS {
  export namespace Machine {
    export namespace Slots {
      /** ProviderId 最大长度（ZVHP1：1–64） */
      export const ProviderIdMaxLength = 64;

      /** ProviderVendor 最大长度（ZVHP1：1–32） */
      export const ProviderVendorMaxLength = 32;

      /** Provider 标识字符串 */
      export type ProviderId = string;

      /** Provider 厂商标识字符串 */
      export type ProviderVendor = string;

      /**
       * 领域协议标识（内存 Provider 必须为 "ZMP1"）。
       */
      export type ActiveProtocol = string;
    }
  }
}
