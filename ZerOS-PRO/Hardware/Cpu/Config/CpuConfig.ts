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
         * 0 固件，1 沙盒，2 内核，3 起给内核自己的服务和驱动。这不是协议要求的个数。
         */
        export const OfficialCoreCount = 8;

        /**
         * 版本 1 装入不改立即数，编译器用 -slot 把栈和堆写死在目标核心。
         * 版本 2 种类 1 的数据重定位，以及动态库的 attach，都加上目标核心相对 0 号的这份位移。
         * 槽距和数据下限与沙盒、内核窗口相同，是标定，不是协议。
         */
        export const RelocateSlotBits = 8388608;

        /** 小于这个地址的立即数属于固件格子，-slot 不加。 */
        export const RelocateDataFloor = 1048576;

        /** 位元线长度。8 颗 2MiB。bound 未设置时查询返回这个长度。 */
        export const LineBits = 134217728;
      }
    }
  }
}
