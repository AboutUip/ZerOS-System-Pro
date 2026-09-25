/**
 * @module ZerOS.Hardware.Display.DisplaySelfCheck
 * @description 显示器在主板、内存和 CPU 自检之后的自检
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 核对官方标定的分辨率、刷新率和帧缓冲长度，并确认非法像素不会被呈现。
 * 结束时帧缓冲恢复为全 0，并再呈现一次。
 * 不导入主板、内存或 CPU。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. runDisplaySelfCheck
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as ConfigRoot } from "../Config/DisplayConfig";
import { ZerOS as DisplayRoot } from "../Bootstrap/Display";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Display {
      const DefaultWidth = ConfigRoot.Hardware.Display.Config.DefaultWidth;
      const DefaultHeight = ConfigRoot.Hardware.Display.Config.DefaultHeight;
      const DefaultHertz = ConfigRoot.Hardware.Display.Config.DefaultHertz;
      const PixelMax = ConfigRoot.Hardware.Display.Config.PixelMax;
      const Display = DisplayRoot.Hardware.Display.Display;
      const checkPrefix = "[ZerOS.Hardware.Display.DisplaySelfCheck]";

      function fail(message: string): never {
        throw new Error(`${checkPrefix} ${message}`);
      }

      /**
       * 面板已经接上之后调用。
       * 先确认标定，再确认呈现不会改写合法像素，最后确认非法像素被拒绝。
       */
      export function runDisplaySelfCheck(): void {
        if (Display.Width !== DefaultWidth || Display.Height !== DefaultHeight) {
          fail("分辨率不是官方标定");
        }
        if (Display.Hertz !== DefaultHertz) {
          fail("刷新率不是官方标定");
        }
        const framebuffer = Display.Framebuffer;
        if (framebuffer.length !== DefaultWidth * DefaultHeight) {
          fail("帧缓冲长度不是宽乘高");
        }
        framebuffer[0] = 0x112233;
        Display.Redraw();
        if (framebuffer[0] !== 0x112233) {
          fail("呈现改写了帧缓冲");
        }
        framebuffer[0] = PixelMax + 1;
        let rejected = false;
        try {
          Display.Redraw();
        } catch {
          rejected = true;
        }
        if (!rejected || framebuffer[0] !== PixelMax + 1) {
          framebuffer[0] = 0;
          fail("非法像素没有被拒绝");
        }
        framebuffer[0] = 0;
        Display.Redraw();
      }
    }
  }
}
