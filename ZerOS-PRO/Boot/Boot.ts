/**
 * @module ZerOS.Boot
 * @description Boot：通电之后交给 CPU 的第一段指令
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 先给主板通电。设备坐稳并且面板自检通过后，这段指令由 CPU 逐条执行。
 * 不导入内存插头，也不把总控交给内核。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 主板导入
 *   2. 指令与 Run
 *   3. 模块加载执行 Run
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as AssembleRoot } from "./Assemble";
import { ZerOS as BiosRoot } from "./Bios";
import { ZerOS as MotherboardRoot } from "../Hardware/Motherboard/Bootstrap/Motherboard";
import { logoLines } from "zeros-boot-firmware";

export namespace ZerOS {
  /* ------------------------------------------------------------------------ */
  /* 2. Boot                                                                   */
  /* ------------------------------------------------------------------------ */

  export namespace Boot {
    /**
     * 当前这一块主板。Boot 不更换它。
     */
    export const Motherboard: typeof MotherboardRoot.Hardware.Motherboard.Motherboard =
      MotherboardRoot.Hardware.Motherboard.Motherboard;

    /**
     * 引导一开始交给 CPU 的指令。正文在 Logo.obr，由工具链填进虚拟模块。
     * 汇编展开标号和 call 之后才交给 CPU。黑底上居中写白色的 BOOT。
     */
    export const Logo: readonly string[] = AssembleRoot.Boot.assemble(logoLines);

    /**
     * 收尾之后的固件循环。
     * 先在 logo 上标出 F12。等待结束就清屏。按下 F12 进入设置画面。
     */
    export const Drive: readonly string[] = AssembleRoot.Boot.assemble(BiosRoot.Boot.BiosLines);

    /**
     * 登记 logo 和固件循环后通电。
     * 主板画出 logo，设备坐稳后跑固件循环。Boot 不等待循环结束。
     */
    export function Run(): void {
      Motherboard.SetLogo(Logo);
      Motherboard.SetDrive(Drive);
      Motherboard.Power();
    }
  }
}

/* -------------------------------------------------------------------------- */
/* 3. 入口副作用                                                               */
/* -------------------------------------------------------------------------- */

ZerOS.Boot.Run();
