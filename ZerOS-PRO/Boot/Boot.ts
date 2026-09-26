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

import { ZerOS as BiosRoot } from "./Bios";
import { ZerOS as MotherboardRoot } from "../Hardware/Motherboard/Bootstrap/Motherboard";
import { logoProgram } from "zeros-boot-firmware";

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
     * 引导一开始交给 CPU 的程序。正文在 Logo.obr，由工具链编成二进制填进虚拟模块。
     * 黑底中央是带向左阴影的 Starting 和六个点，第一颗点是红的。
     */
    export const Logo: Uint8Array = Uint8Array.from(logoProgram);

    /**
     * 收尾之后的固件循环。
     * 等待期间红点按六个点的顺序往后换色。等待结束就清屏。按下 F12 进入设置画面：顶栏切换类别，左侧是子类，右侧是内容。
     */
    export const Drive: Uint8Array = BiosRoot.Boot.BiosProgram;

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
