/**
 * @module ZerOS.Hardware.Motherboard.ChannelDirection
 * @description 内存通道的方向
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 通道上的方向只有读和写。数值是这块主板的底层口，不是 ZMP1 字段。
 * CPU 协议出现以后，访问存储的指令按这两个方向落到通道上。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 方向取值
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      /**
       * 从内存通道读出数据。
       * `Read` 使用这个方向。
       */
      export const ChannelDirectionRead = 0;

      /**
       * 向内存通道写入数据。
       * `Write` 使用这个方向。
       */
      export const ChannelDirectionWrite = 1;

      /**
       * 通道方向。封闭二值，不是可追加编码表。
       */
      export type ChannelDirection = 0 | 1;
    }
  }
}
