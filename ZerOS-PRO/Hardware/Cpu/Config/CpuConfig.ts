/**
 * @module ZerOS.Hardware.Cpu.Config
 * @description ZCP1 固定边界与官方核心数标定
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * CoreCountMin / CoreCountMax 是协议固定常量。
 * OfficialCoreCount 只是这一份官方实现的声明，不是协议常量。
 * 单核社区实现把 CoreCount 标成 1 仍然符合 ZCP1。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 协议边界
 *   2. 官方标定
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      export namespace Config {
        /** 领域协议标识。必须与 ZCP1 逐字一致。 */
        export const ActiveProtocol = "ZCP1";

        /** ZCP1 核心数下限。 */
        export const CoreCountMin = 1;

        /** ZCP1 核心数上限。超过这个数的声明不符合协议。 */
        export const CoreCountMax = 256;

        /** ZCP1 每个核心的寄存器个数。编号是 0 至 7。 */
        export const RegisterCount = 8;

        /** 核心频率下限，含端点。单位是 Hz。 */
        export const HertzMin = 1;

        /** 核心频率上限，含端点。超过这个数的设定不符合协议。 */
        export const HertzMax = 1000000000;

        /**
         * 官方实现挂上核心时的 Hz。
         * 这是标定，不是协议要求的唯一频率。
         */
        export const OfficialHertz = 100000000;

        /**
         * 官方实现声明的核心数。
         * 主板只会挂载 0 .. 3 这四个核心。这不是协议要求的个数。
         */
        export const OfficialCoreCount = 4;
      }
    }
  }
}
