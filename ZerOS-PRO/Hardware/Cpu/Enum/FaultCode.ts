/**
 * @module ZerOS.Hardware.Cpu.FaultCode
 * @description ZCP1 指令失败错误码
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只放登记表里的错误码整数。含义以 FaultRegistry 为准，这里不另写一套解释。
 * 不判定哪一句失败该用哪个码。判定在故障记录里。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 错误码
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      /** 尚未归类。登记表短名 Unspecified。 */
      export const FaultCodeUnspecified = 0;
      /** 跳转编号不在当前指令文本里。 */
      export const FaultCodeJump = 1;
      /** 寄存器编号或寄存器里的整数不能用于该命令。 */
      export const FaultCodeRegister = 2;
      /** 核心不是执行中。 */
      export const FaultCodeNotRunning = 3;
      /** 上一条命令尚未完成。 */
      export const FaultCodeBusy = 4;
      /** Hz 超出 1 至 1000000000。 */
      export const FaultCodeHertz = 5;
      /** 访存操作码与读或写不匹配。 */
      export const FaultCodeOpcode = 6;
      /** 指标种类不是 0 或 1。 */
      export const FaultCodeMetric = 7;
      /** 扩展口交换被拒绝。 */
      export const FaultCodeExchange = 8;
      /** 查询没有登记，或这一次读取失败。 */
      export const FaultCodeQuery = 9;
      /** 显卡拒绝了这一条命令。 */
      export const FaultCodeGpu = 10;
      /** 存储端口拒绝了这一次访问。 */
      export const FaultCodeMemory = 11;
      /** 装入被拒绝。 */
      export const FaultCodeInstall = 12;
      /** 访存越界，或 bound 的参数不合法。 */
      export const FaultCodeBound = 13;
      /** schedule 被拒绝。 */
      export const FaultCodeSchedule = 14;
      /** pass 被拒绝。 */
      export const FaultCodePass = 15;
      /** svc 被拒绝。 */
      export const FaultCodeSyscall = 16;
      /** gate 被拒绝。 */
      export const FaultCodeGate = 17;
      /** release 被拒绝。 */
      export const FaultCodeRelease = 18;
      /** slice 的条数不合法。 */
      export const FaultCodeSlice = 19;
      /** capture 或 restore 被拒绝。 */
      export const FaultCodeContext = 20;
      /** attach 被拒绝。 */
      export const FaultCodeAttach = 21;
      /** 客核心执行了不允许的指令。 */
      export const FaultCodePrivilege = 22;
      /** dwell 的毫秒不是 0 至 1000。 */
      export const FaultCodeDwell = 23;
      /** mmap 或 munmap 被拒绝，或卸下之后又读了那段。 */
      export const FaultCodeMap = 24;
      /** 已登记错误码的最后一号。比它大的整数还没有含义。 */
      export const FaultCodeLast = 24;
    }
  }
}
