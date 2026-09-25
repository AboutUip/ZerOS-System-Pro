/**
 * @module ZerOS.Hardware.Motherboard.ExpansionConfig
 * @description ZXP1 / ZXD1 的固定边界
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 口的个数、状态和载荷上界与协议常量一致。
 * 不绑定设备，也不搬运八位组。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 协议常量
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      export namespace ExpansionConfig {
        /** 扩展口协议标识。 */
        export const PortProtocol = "ZXP1";

        /** 数据交换协议标识。 */
        export const ExchangeProtocol = "ZXD1";

        /** 口的个数。编号是 0 至 3。 */
        export const PortCount = 4;

        /** 空。 */
        export const PortStateEmpty = 0;

        /** 已加载。 */
        export const PortStateLoaded = 1;

        /** 已引导。 */
        export const PortStateBooted = 2;

        /** 宿主把载荷交给设备。 */
        export const DirectionHostToDevice = 0;

        /** 设备把载荷交给宿主。 */
        export const DirectionDeviceToHost = 1;

        /** 一次载荷的最长八位组数。 */
        export const PayloadMaxLength = 4096;

        /** DeviceProtocol 的最长字符数。 */
        export const DeviceProtocolMaxLength = 64;
      }
    }
  }
}
