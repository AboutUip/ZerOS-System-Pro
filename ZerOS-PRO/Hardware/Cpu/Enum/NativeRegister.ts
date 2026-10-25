/**
 * @module ZerOS.Hardware.Cpu.NativeRegister
 * @description 原生指令的 16 个整数寄存器编号
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 编号与 ZCP1 §4.12 的顺序一致。ZAP 的 r0 至 r7 不在这里。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 编号
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      /** rax。调用结果写在这里。 */
      export const NativeRax = 0;
      /** rcx。 */
      export const NativeRcx = 1;
      /** rdx。 */
      export const NativeRdx = 2;
      /** rbx。被调用方保存。 */
      export const NativeRbx = 3;
      /** rsp。栈的八位组地址。 */
      export const NativeRsp = 4;
      /** rbp。被调用方保存。 */
      export const NativeRbp = 5;
      /** rsi。 */
      export const NativeRsi = 6;
      /** rdi。第一个整数参数。 */
      export const NativeRdi = 7;
      /** r8。 */
      export const NativeR8 = 8;
      /** r9。 */
      export const NativeR9 = 9;
      /** r10。 */
      export const NativeR10 = 10;
      /** r11。 */
      export const NativeR11 = 11;
      /** r12。被调用方保存。 */
      export const NativeR12 = 12;
      /** r13。被调用方保存。 */
      export const NativeR13 = 13;
      /** r14。被调用方保存。 */
      export const NativeR14 = 14;
      /** r15。被调用方保存。 */
      export const NativeR15 = 15;
      /** 原生整数寄存器个数。 */
      export const NativeRegisterCount = 16;
    }
  }
}
