/**
 * @module ZerOS.Hardware.Cpu.MapConfig
 * @description mmap 的页长和长度边界
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只放 ZCP1 写明的页长和 rN 上下界。
 * 不分配地址，也不搬运。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 页与长度
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      export namespace Config {
        /** 一页的八位组数。ZCP1 固定是 4096。 */
        export const MapPageBytes = 4096;

        /** rN 下界，含。 */
        export const MapLengthMin = 1;

        /** rN 上界，含。 */
        export const MapLengthMax = 268435456;
      }
    }
  }
}
