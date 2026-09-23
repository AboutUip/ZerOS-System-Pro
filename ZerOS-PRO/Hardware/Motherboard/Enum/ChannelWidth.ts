/**
 * @module ZerOS.Hardware.Motherboard.ChannelWidth
 * @description 内存通道的字宽（位）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 字宽用位计数：1、8、16、32、64。
 * 1 位走内存的线性位元端口；8 位走八位组端口；16/32/64 走小端整数端口。
 * 这是主板把内存导出端口收成一条通道时用的宽度，不是新的内存协议宽度。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 字宽取值
 *   2. 门闩
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      /** 一个位元。 */
      export const ChannelWidthBit = 1;

      /** 一个八位组。 */
      export const ChannelWidthOctet = 8;

      /** 两个八位组，16 位。 */
      export const ChannelWidth16 = 16;

      /** 四个八位组，32 位。 */
      export const ChannelWidth32 = 32;

      /** 八个八位组，64 位。 */
      export const ChannelWidth64 = 64;

      /**
       * 通道字宽。单位是位。封闭集合。
       */
      export type ChannelWidth = 1 | 8 | 16 | 32 | 64;

      /**
       * 把调用方给的数字收成通道字宽。
       * 其它宽度返回 null，调用方不得据此去改存储体。
       */
      export function toChannelWidth(value: number): ChannelWidth | null {
        if (
          value === ChannelWidthBit
          || value === ChannelWidthOctet
          || value === ChannelWidth16
          || value === ChannelWidth32
          || value === ChannelWidth64
        ) {
          return value;
        }
        return null;
      }
    }
  }
}
