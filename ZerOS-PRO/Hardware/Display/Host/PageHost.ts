/**
 * @file PageHost.ts
 * @desc 这一页的启动顺序：先接上显示器并封印页面，再动态加载主板上电入口。
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
import { ZerOS as BootTraceRoot } from "../../Debug/Host/BootTrace";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Display {
      /** 找到唯一画布，启动显示器，然后才允许机器加电。 */
      function openDisplayPage(): void {
        BootTraceRoot.Hardware.Debug.markBoot("page");
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
        page.WhenFrame((frameWidth, frameHeight, pixels, bitmap, originX, originY, scroll): void => {
          try {
            if (bitmap !== null) {
              if (scroll !== undefined && scroll.length >= 4) {
                display.ShiftBands(scroll);
              }
              acceptGpuBitmap(frameWidth, frameHeight, bitmap, originX ?? 0, originY ?? 0);
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
        const setDebugEnabled = FlagRoot.Hardware.Debug.setDebugEnabled;
        const readBootOctet = NasRuntimeRoot.Hardware.Nas.readBootOctet;
        const saveBootOctet = NasRuntimeRoot.Hardware.Nas.saveBootOctet;
        type FaultRecord = FaultRoot.Hardware.Cpu.FaultRecord;
        type CoreStop = StopRoot.Hardware.Cpu.CoreStop;
        const hooks = {
          faults: (): readonly FaultRecord[] => page.Faults(),
          last: (): FaultRecord | null => page.LastFault(),
          stop: (ordinal: number): CoreStop | null => readCoreStop(ordinal),
          exchange: (index: number, direction: number, word: bigint): Promise<bigint> => page.Exchange(index, direction, word),
          run: (lines: readonly string[]): Promise<string> => page.DebugRun(lines),
        };
        /**
         * 已经挂上的那一档。null 表示还没按文件或固件摆过。
         * 同一档再来一次就不再改全局对象，免得把控制台里已经拿住的入口换掉。
         */
        let applied: boolean | null = null;
        /** 固件已经写过开关。之后到达的启动读取不再把新的一档盖回旧文件。 */
        let sawFirmware = false;
        function applyDebugSwitch(on: boolean): void {
          setDebugEnabled(on);
          if (applied === on) {
            return;
          }
          applied = on;
          /* 关闭时摘掉入口。打开时全局和被封住的控制台各有一份。 */
          SurfaceRoot.Hardware.Debug.installDebugSurface(globalThis, on, hooks);
          try {
            SurfaceRoot.Hardware.Debug.installDebugSurface(console, on, hooks);
          } catch {
            /* 控制台对象不允许再挂属性时，全局入口仍然在。 */
          }
        }
        applyDebugSwitch(false);
        page.WhenDebugSwitch((on): void => {
          sawFirmware = true;
          applyDebugSwitch(on);
          /* 固件不占客机会话。这一位由页面写进 /boot/debug。 */
          void saveBootOctet("/boot/debug", on ? 1 : 0);
        });
        void readBootOctet("/boot/debug").then((byte): void => {
          if (sawFirmware || byte === null) {
            return;
          }
          applyDebugSwitch(byte === 1);
        });
        void import("../../Motherboard/Bootstrap/FirmwarePower");
      }

      openDisplayPage();
    }
  }
}
