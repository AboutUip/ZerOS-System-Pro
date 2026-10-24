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
import { ZerOS as PublishPointerRoot } from "./PublishPointer";
import { ZerOS as MotherboardRoot } from "../../Motherboard/Bootstrap/Motherboard";
import { ZerOS as NasRuntimeRoot } from "../../Nas/Bootstrap/NasRuntime";
import { ZerOS as PageCoreStopRoot } from "../../Cpu/Host/PageCoreStop";
import { ZerOS as FlagRoot } from "../../Debug/Config/DebugFlag";
import { ZerOS as SurfaceRoot } from "../../Debug/Host/DebugSurface";
import { type ZerOS as FaultRoot } from "../../Cpu/Structure/FaultRecord";
import { type ZerOS as StopRoot } from "../../Cpu/Structure/CoreStop";

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
        PublishPointerRoot.Hardware.Display.publishPointer();
        const runDisplaySelfCheck = DisplaySelfCheckRoot.Hardware.Display.runDisplaySelfCheck;
        const acceptGpuFrame = AcceptGpuFrameRoot.Hardware.Display.acceptGpuFrame;
        const acceptGpuBitmap = AcceptGpuFrameRoot.Hardware.Display.acceptGpuBitmap;
        const page = MotherboardRoot.Hardware.Motherboard.Motherboard;
        const saveDisplaySize = NasRuntimeRoot.Hardware.Nas.saveDisplaySize;
        page.WhenPanel((width, height): void => {
          try {
            display.SetResolution(width, height);
            page.PublishPanel(width, height, display.Hertz);
          } catch {
            return;
          }
          /* 面板已经换成这一档，再把宽高落进 NAS 的 /boot/display。 */
          void saveDisplaySize(width, height);
        });
        page.WhenFrame((frameWidth, frameHeight, pixels, bitmap): void => {
          try {
            if (bitmap !== null) {
              acceptGpuBitmap(frameWidth, frameHeight, bitmap);
              return;
            }
            if (pixels !== null) {
              acceptGpuFrame(frameWidth, frameHeight, pixels);
            }
          } catch {
            return;
          }
        });
        try {
          runDisplaySelfCheck();
        } catch {
          return;
        }
        const readCoreStop = PageCoreStopRoot.Hardware.Cpu.readCoreStop;
        const DebugEnabled = FlagRoot.Hardware.Debug.DebugEnabled;
        type FaultRecord = FaultRoot.Hardware.Cpu.FaultRecord;
        type CoreStop = StopRoot.Hardware.Cpu.CoreStop;
        const hooks = {
          faults: (): readonly FaultRecord[] => page.Faults(),
          last: (): FaultRecord | null => page.LastFault(),
          stop: (ordinal: number): CoreStop | null => readCoreStop(ordinal),
          exchange: (index: number, direction: number, word: bigint): Promise<bigint> => page.Exchange(index, direction, word),
          run: (lines: readonly string[]): Promise<string> => page.DebugRun(lines),
        };
        /* 开关关闭时这里什么都不挂。打开时全局和被封住的控制台各有一份只读入口。 */
        SurfaceRoot.Hardware.Debug.installDebugSurface(globalThis, DebugEnabled, hooks);
        if (DebugEnabled) {
          try {
            SurfaceRoot.Hardware.Debug.installDebugSurface(console, DebugEnabled, hooks);
          } catch {
            /* 控制台对象不允许再挂属性时，全局入口仍然在。 */
          }
        }
        void import("../../../Boot/Boot");
      }

      openDisplayPage();
    }
  }
}
