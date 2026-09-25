/**
 * @file Display.ts
 * @desc 显示器对外入口。协议字段从这里读。页面宿主负责接上画布。
 *       本模块不导入 Boot、主板或内核。
 */

import { ZerOS as DeviceRoot } from "../Device/DisplayDevice";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Display {
      const device = DeviceRoot.Hardware.Display.displayDevice;

      /** ZDP1 规定的字段与方法，外加官方的 Attach。 */
      export const Display = {
        /** 当前宽度。 */
        get Width(): number {
          return device.Width;
        },

        /** 当前高度。 */
        get Height(): number {
          return device.Height;
        },

        /** 当前刷新率。 */
        get Hertz(): number {
          return device.Hertz;
        },

        /** 当前帧缓冲。 */
        get Framebuffer(): Uint32Array {
          return device.Framebuffer;
        },

        /**
         * 接上这一页的画布。
         * 这是官方宿主步骤，不是 ZDP1 方法名。
         */
        Attach(canvas: HTMLCanvasElement): void {
          device.Attach(canvas);
        },

        /** 提交分辨率。 */
        SetResolution(width: number, height: number): void {
          device.SetResolution(width, height);
        },

        /** 提交刷新率。 */
        SetHertz(hertz: number): void {
          device.SetHertz(hertz);
        },

        /** 呈现当前帧缓冲。 */
        Redraw(): void {
          device.Redraw();
        },
      };
    }
  }
}
