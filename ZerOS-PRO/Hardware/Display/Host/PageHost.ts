/**
 * @file PageHost.ts
 * @desc 这一页的启动顺序：先接上显示器并封印页面，再动态加载 Boot。
 *       静态导入会把主板加电提前到画布出现之前。
 */

import { ZerOS as DisplayRoot } from "../Bootstrap/Display";
import { ZerOS as SealRoot } from "./DomSeal";
import { ZerOS as DisplaySelfCheckRoot } from "../Test/DisplaySelfCheck";
import { ZerOS as AcceptGpuFrameRoot } from "./AcceptGpuFrame";
import { ZerOS as PublishKeyboardRoot } from "./PublishKeyboard";
import { ZerOS as MotherboardRoot } from "../../Motherboard/Bootstrap/Motherboard";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Display {
      /** 找到唯一画布，启动显示器，然后才允许机器加电。 */
      function openDisplayPage(): void {
        const canvas = document.querySelector("canvas");
        if (!(canvas instanceof HTMLCanvasElement)) {
          throw new Error("[ZerOS.Hardware.Display.PageHost] 页面没有画布");
        }
        DisplayRoot.Hardware.Display.Display.Attach(canvas);
        const display = DisplayRoot.Hardware.Display.Display;
        MotherboardRoot.Hardware.Motherboard.Motherboard.PublishPanel(display.Width, display.Height, display.Hertz);
        SealRoot.Hardware.Display.sealHostPage(canvas);
        PublishKeyboardRoot.Hardware.Display.publishKeyboard();
        const runDisplaySelfCheck = DisplaySelfCheckRoot.Hardware.Display.runDisplaySelfCheck;
        const acceptGpuFrame = AcceptGpuFrameRoot.Hardware.Display.acceptGpuFrame;
        const page = MotherboardRoot.Hardware.Motherboard.Motherboard;
        page.WhenFrame((frameWidth, frameHeight, pixels): void => {
          try {
            acceptGpuFrame(frameWidth, frameHeight, pixels);
          } catch {
            return;
          }
        });
        try {
          runDisplaySelfCheck();
        } catch {
          return;
        }
        const host = globalThis as { ZerOSExchange?: (index: number, direction: number, word: bigint) => Promise<bigint> };
        host.ZerOSExchange = (index, direction, word): Promise<bigint> => page.Exchange(index, direction, word);
        void import("../../../Boot/Boot");
      }

      openDisplayPage();
    }
  }
}
