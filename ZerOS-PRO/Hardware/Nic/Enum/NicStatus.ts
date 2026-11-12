/**
 * @module ZerOS.Hardware.Nic.NicStatus
 * @description ZNC1 状态码
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只定义宿主桥、内核驱动和 Rust 网卡共用的状态。
 * 状态不是网络错误码；TCP/IP 的错误码由驱动自己定义。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. NicStatus
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Nic {
      /** 成功。 */
      export const NicStatusOk = 0;
      /** 接收队列是空的。 */
      export const NicStatusEmpty = 1;
      /** Rust 服务没有启动，或握手超时。 */
      export const NicStatusNotReady = 2;
      /** 操作码不认识。 */
      export const NicStatusBadOpcode = 3;
      /** 一帧超过参考实现的上界。 */
      export const NicStatusTooLong = 4;
      /** 线或服务发生 I/O 错误。 */
      export const NicStatusIo = 5;
      /** 端口还有一次交换没结束。 */
      export const NicStatusBusy = 6;
      /** 参数不合法。 */
      export const NicStatusBadArgument = 7;
    }
  }
}
