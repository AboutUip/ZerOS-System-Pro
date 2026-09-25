/**
 * @file DisplayConfig.ts
 * @desc 显示器的协议固定常量，以及官方标定的默认分辨率与刷新率。
 *       固定常量与 ZDP1 一致。默认 640×480、60 Hz 只属于这一份官方实现。
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Display {
      export namespace Config {
        /** 协议标识。 */
        export const ActiveProtocol = "ZDP1";

        /** 每个颜色通道的位数。 */
        export const BitsPerChannel = 8;

        /** 像素整数上界，2^24 − 1。 */
        export const PixelMax = 16777215;

        /** 宽与高的下界。 */
        export const MinEdge = 1;

        /** 宽与高的上界。 */
        export const MaxEdge = 16384;

        /** 像素总数上界。 */
        export const MaxPixelCount = 16777216;

        /** 刷新率下界，单位 Hz。 */
        export const MinHertz = 1;

        /** 刷新率上界，单位 Hz。 */
        export const MaxHertz = 1000;

        /** 官方默认宽度。不是协议强制值。 */
        export const DefaultWidth = 640;

        /** 官方默认高度。不是协议强制值。 */
        export const DefaultHeight = 480;

        /** 官方默认刷新率。不是协议强制值。 */
        export const DefaultHertz = 60;
      }
    }
  }
}
