/**
 * @module ZerOS.Hardware.Nic.NicOpcode
 * @description ZNC1 的 WebSocket 请求操作码
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只定义宿主桥和 Rust 网卡之间的请求类别。
 * 不定义以太网、IP、TCP 或任何上层协议。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. NicOpcode
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Nic {
      /** 读取能力，答复是 8 个八位组。 */
      export const NicOpcodeInfo = 0;
      /** 发送一帧原始以太网报文。 */
      export const NicOpcodeSend = 1;
      /** 取走一帧原始以太网报文。没有时状态是空。 */
      export const NicOpcodeReceive = 2;
      /** 配置网卡的线。载荷是 ASCII：loopback 或 udp:HOST:PORT。 */
      export const NicOpcodeConfig = 3;
      /** 探活。 */
      export const NicOpcodePing = 4;
    }
  }
}
