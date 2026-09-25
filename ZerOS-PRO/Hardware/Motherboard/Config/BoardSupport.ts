/**
 * @module ZerOS.Hardware.Motherboard.BoardSupport
 * @description 主板当前点名支持的领域协议
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只列出这块主板认的协议标识。这不是协议正文。
 * 内存目前只有 ZMP1。CPU 目前是 ZCP1。显卡目前是 ZGP1。核心数和帧尺寸由各自的实现声明，不写在这份名单里。
 * 以后同一类协议多了一个版本，把标识加进对应名单即可。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 支持名单
 *   2. 核对函数
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      /* ------------------------------------------------------------------ */
      /* 1. 支持名单                                                         */
      /* ------------------------------------------------------------------ */

      /**
       * 主板愿意坐上的内存协议。
       * 当前只有 ZMP1。不在此列的内存插头不得 Bind。
       */
      export const SupportedMemoryProtocols: readonly string[] = ["ZMP1"];

      /**
       * 主板愿意坐上的 CPU 协议。
       * 当前是 ZCP1。核心数不在这里写，由那份 CPU 实现自己声明。
       */
      export const SupportedCpuProtocols: readonly string[] = ["ZCP1"];

      /**
       * 主板愿意坐上的显卡协议。
       * 当前是 ZGP1。帧宽高不在这里写，由那份显卡实现自己声明。
       */
      export const SupportedGpuProtocols: readonly string[] = ["ZGP1"];

      /** 主板扩展口协议。当前是 ZXP1。口的个数不在这里写。 */
      export const SupportedExpansionProtocols: readonly string[] = ["ZXP1"];

      /** 扩展口数据交换协议。当前是 ZXD1。 */
      export const SupportedExchangeProtocols: readonly string[] = ["ZXD1"];

      /* ------------------------------------------------------------------ */
      /* 2. 核对                                                             */
      /* ------------------------------------------------------------------ */

      /**
       * 内存插头声称的协议是否在主板名单里。
       * 比较的是协议标识字符串，不是实现厂商名。
       */
      export function supportsMemoryProtocol(protocol: string): boolean {
        for (const supported of SupportedMemoryProtocols) {
          if (supported === protocol) {
            return true;
          }
        }
        return false;
      }

      /**
       * CPU 插头声称的协议是否在主板名单里。
       * 核心数不在这里比较。
       */
      export function supportsCpuProtocol(protocol: string): boolean {
        for (const supported of SupportedCpuProtocols) {
          if (supported === protocol) {
            return true;
          }
        }
        return false;
      }
    }
  }
}
