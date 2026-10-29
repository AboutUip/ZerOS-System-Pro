/**
 * @module ZerOS.Hardware.Motherboard.FirmwarePower
 * @description 把三份固件映像装上主板并通电
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 页面加载本文件就会通电。Logo、Bios、Load 的源码在 Boot/，工具链编成二进制后从虚拟模块进来。
 * 通电前先核对内核窗口和失败帧。窗口重叠或失败帧对不上时，主板不通电。
 * 不导入内存插头，也不改固件指令。固件循环不在这里等它结束。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 映像与 powerFirmware
 *   3. 模块加载执行
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as WindowCheckRoot } from "../../Cpu/Test/KernelWindowCheck";
import { ZerOS as GlassCheckRoot } from "../Test/FaultGlassCheck";
import { ZerOS as MotherboardRoot } from "./Motherboard";
import { ZerOS as SevereRoot } from "../../Debug/Host/SevereConsole";
import { ZerOS as BootTraceRoot } from "../../Debug/Host/BootTrace";
import { biosProgram, biosProgramSites, loadProgram, loadProgramSites, logoProgram, logoProgramSites } from "zeros-boot-firmware";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      /* ------------------------------------------------------------------ */
      /* 2. 映像与 powerFirmware                                             */
      /* ------------------------------------------------------------------ */

      const Board = MotherboardRoot.Hardware.Motherboard.Motherboard;
      const runKernelWindowCheck = WindowCheckRoot.Hardware.Cpu.runKernelWindowCheck;
      const runFaultGlassCheck = GlassCheckRoot.Hardware.Motherboard.runFaultGlassCheck;
      const reportSevere = SevereRoot.Hardware.Debug.reportSevere;

      /** 探针之前的启动画面。正文在 Boot/Logo.obr。黑底中央是 Starting 和六个点，第一颗是红的。 */
      const Logo: Uint8Array = Uint8Array.from(logoProgram);

      /** 核心 0 上的固件循环。正文在 Boot/Bios.obr。等待结束就清屏，画面还在时 F12 进入设置。 */
      const Drive: Uint8Array = Uint8Array.from(biosProgram);

      /** 核心 3 上先停着的装入程序。正文在 Boot/Load.obr，按槽 3 编译。倒计时结束才调度。 */
      const Loader: Uint8Array = Uint8Array.from(loadProgram);

      /**
       * 核对通过后把三份映像交给主板并通电。
       * 失败帧核对要等调试入口回答，所以通电放在那次核对之后。
       */
      export function powerFirmware(): void {
        const markBoot = BootTraceRoot.Hardware.Debug.markBoot;
        markBoot("power");
        runKernelWindowCheck();
        void runFaultGlassCheck().then(
          (): void => {
            markBoot("glass");
            Board.SetLogo(Logo);
            Board.SetDrive(Drive);
            Board.SetLoader(Loader);
            Board.SetDebugSites(logoProgramSites, biosProgramSites, loadProgramSites);
            Board.Power();
          },
          (error: unknown): void => {
            const text = error instanceof Error ? error.message : "fault glass check failed";
            reportSevere(text);
          },
        );
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* 3. 模块加载执行                                                             */
/* -------------------------------------------------------------------------- */

ZerOS.Hardware.Motherboard.powerFirmware();
