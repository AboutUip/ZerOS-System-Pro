/**
 * @module ZerOS.Hardware.Cpu.FaultSource
 * @description ZCP1 指令失败来源
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只放登记表里的来源整数和规范短名。短名要和登记表逐字相同，面板上的 SRC 行用它。
 * 不猜测一句失败该归到哪一类。归类在故障记录里。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 来源
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      /** 主板或坐座主机。 */
      export const FaultSourceBoard = 0;
      /** CPU。 */
      export const FaultSourceCpu = 1;
      /** 存储。 */
      export const FaultSourceMemory = 2;
      /** 显卡。这一类失败禁止再送面板，因为面板正是靠显卡画的。 */
      export const FaultSourceGpu = 3;
      /** 显示器。 */
      export const FaultSourceDisplay = 4;
      /** 扩展口。 */
      export const FaultSourceExpansion = 5;
      /** 键盘。 */
      export const FaultSourceKeyboard = 6;
      /** 已登记来源的最后一号。 */
      export const FaultSourceLast = 6;

      /**
       * 与来源整数对齐的规范短名。
       * 下标就是来源。面板写 SRC 时只能用这一列，不能临时改名。
       */
      export const FaultSourceName: readonly string[] = [
        "Board",
        "Cpu",
        "Memory",
        "Gpu",
        "Display",
        "Expansion",
        "Keyboard",
      ];
    }
  }
}
