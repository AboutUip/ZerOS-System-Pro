/**
 * @module ZerOS.Hardware.Gpu.Config
 * @description ZGP1 固定边界与官方帧尺寸标定
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 边长、像素个数和像素上界是协议固定常量，取值与面板能接受的帧一致。
 * OfficialFrameWidth / OfficialFrameHeight 只是这一份官方实现的声明。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 协议边界
 *   2. 官方标定
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Gpu {
      export namespace Config {
        /** 领域协议标识。必须与 ZGP1 逐字一致。 */
        export const ActiveProtocol = "ZGP1";

        /** 帧边长下限。 */
        export const FrameEdgeMin = 1;

        /** 帧边长上限。 */
        export const FrameEdgeMax = 16384;

        /** 像素个数上限。宽乘高不得超过它。 */
        export const FramePixelMaxCount = 16777216;

        /** 像素整数上界。 */
        export const PixelMax = 16777215;

        /** 节点树最多同时存在的节点数，含根。 */
        export const NodeMaxCount = 4096;

        /** 一个文本节点最多保存的字形个数。 */
        export const GlyphRunMaxCount = 1024;

        /** 节点坐标与边长的绝对值上限，含端点。 */
        export const NodeSpanMax = 16777216;

        /**
         * 官方实现声明的帧宽。
         * 与官方面板宽度相同，便于整帧交接。这不是协议要求的宽度。
         */
        export const OfficialFrameWidth = 640;

        /** 官方实现声明的帧高。不是协议要求的高度。 */
        export const OfficialFrameHeight = 480;

        /** 显存字节数下限。至少放下一个像素的 4 个字节。 */
        export const MemoryByteMin = 4;

        /** 显存字节数上限。256 MiB。 */
        export const MemoryByteMax = 268435456;

        /** 显存长度必须是 4 的倍数，这样一个字正好是一个像素槽。 */
        export const MemoryByteAlign = 4;

        /** 频率下限。单位 Hz。 */
        export const HertzMin = 1;

        /** 频率上限。1 GHz。再高的话，整帧的等待会短到无法分辨。 */
        export const HertzMax = 1000000000;

        /**
         * 官方实现的显存字节数。8 MiB。
         * 帧只占前面 640×480×4 个字节，后面是可寻址的空闲显存。这不是协议常量。
         */
        export const OfficialMemoryBytes = 8388608;

        /** 官方实现的显卡 Hz。100 MHz。整帧大约 3 毫秒，单像素不到 1 毫秒。不是协议常量。 */
        export const OfficialHertz = 100000000;
      }
    }
  }
}
