/**
 * @module ZerOS.Hardware.Display.AcceptGpuFrame
 * @description 把显卡交出的帧写入面板
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只在页面线程调用。尺寸必须和当前面板一致，像素必须全部合法，才整帧写入。
 * 任一条件不满足就整份丢弃，不改帧缓冲。不导入显卡实现。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. acceptGpuFrame
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as DisplayRoot } from "../Bootstrap/Display";
import { ZerOS as PixelRoot } from "../Structure/Pixel";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Display {
      const Display = DisplayRoot.Hardware.Display.Display;
      const isPixel = PixelRoot.Hardware.Display.isPixel;
      const framePrefix = "[ZerOS.Hardware.Display.AcceptGpuFrame]";

      /**
       * 面板已经接上之后调用。
       * 先核对全部像素，通过之后才写入，因此半帧不会留在缓冲里。
       */
      export function acceptGpuFrame(frameWidth: number, frameHeight: number, pixels: Uint32Array): void {
        if (frameWidth !== Display.Width || frameHeight !== Display.Height) {
          throw new Error(`${framePrefix} 帧尺寸和面板不一致`);
        }
        if (pixels.length !== frameWidth * frameHeight) {
          throw new Error(`${framePrefix} 帧长度不是宽乘高`);
        }
        const count = pixels.length;
        for (let index = 0; index < count; index += 1) {
          const pixel = pixels[index];
          if (pixel === undefined || !isPixel(pixel)) {
            throw new Error(`${framePrefix} 帧里有非法像素`);
          }
        }
        Display.Framebuffer.set(pixels);
        Display.Redraw();
      }
    }
  }
}
