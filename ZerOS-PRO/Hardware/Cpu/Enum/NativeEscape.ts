/**
 * @module ZerOS.Hardware.Cpu.NativeEscape
 * @description 0F 3F 后面的 ZerOS 操作编号
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 编号与 NativeOpcodeRegistry 的 0F 3F 行一致。
 * 这些编号不是 ZPB1 文件里的指令编号。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 编号
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      /** 把本核心编号写入后面那个寄存器。客核心可以执行。 */
      export const NativeEscapeCore = 1;

      /** 取得监督权。没有寄存器字节。已经有监督核时失败。客核心不能执行。 */
      export const NativeEscapeGate = 2;

      /**
       * 把第二个寄存器里的整数放进第一个寄存器所指的核心。
       * 两个都是寄存器编号，不是要传递的整数。客核心不能执行。
       */
      export const NativeEscapePass = 3;

      /** 取出本核心保持位。先写有没有，再写值。客核心不能执行。 */
      export const NativeEscapeTake = 4;

      /**
       * 系统调用。第一个寄存器接收回复，第二个寄存器提供服务号。
       * 客核心可以执行。回复不写入 ZAP 寄存器。
       */
      export const NativeEscapeSvc = 5;

      /** 调度寄存器里的那颗核心。客核心不能执行。 */
      export const NativeEscapeSchedule = 6;

      /** 卸下寄存器里的那颗核心。客核心不能执行。 */
      export const NativeEscapeRelease = 7;

      /** 划定可访问范围。依次是核心、起点、长度。客核心不能执行。 */
      export const NativeEscapeBound = 8;

      /** 把本核心的时间片设为寄存器里的条数。客核心可以执行。 */
      export const NativeEscapeSlice = 9;

      /** 停在下一条。没有寄存器字节。客核心可以执行。 */
      export const NativeEscapeYield = 10;

      /**
       * 查询。依次是结果寄存器、座位、字段、下标。
       * 这一条只完成座位 1。客核心只能查协议允许的字段。
       */
      export const NativeEscapeQuery = 11;

      /** 装入程序。依次是核心、位地址、八位组长度。客核心不能执行。 */
      export const NativeEscapeInstall = 12;

      /** 把核心抄进槽。依次是核心、槽号。客核心不能执行。 */
      export const NativeEscapeCapture = 13;

      /** 把槽放回核心。依次是核心、槽号。客核心不能执行。 */
      export const NativeEscapeRestore = 14;

      /** 设置核心的 Hz。依次是核心、频率。客核心不能执行。 */
      export const NativeEscapeHertz = 15;

      /**
       * 把动态库接到已有序列末尾。
       * 依次是结果、核心、位地址、八位组长度。结果是入口编号，写入原生寄存器。
       */
      export const NativeEscapeAttach = 16;

      /** 把颜色目标交出去。没有寄存器字节。客核心不能执行。 */
      export const NativeEscapePresent = 17;

      /** 画一个封闭点阵字形。依次是横坐标、纵坐标、码位、前景、背景。客核心不能执行。 */
      export const NativeEscapeCharacter = 18;

      /**
       * 固定功能绘制。依次是结果、操作码、四个二进制 64 位型。
       * 结果写入原生寄存器。客核心不能执行。
       */
      export const NativeEscapeAccel = 19;

      /** 交换扩展口上的 8 个八位组。结果写回第三个寄存器。客核心不能执行。 */
      export const NativeEscapeExchange = 20;

      /** 按句柄把扩展口上的字节写入位地址。结果写入第一个寄存器。客核心不能执行。 */
      export const NativeEscapeCarry = 21;

      /** 读扩展口状态。结果写入第一个寄存器。客核心不能执行。 */
      export const NativeEscapePortState = 22;

      /** 读扩展口的一个标识字符。结果写入第一个寄存器。客核心不能执行。 */
      export const NativeEscapePortChar = 23;

      /** 读扩展口的一个字段八位组。结果写入第一个寄存器。客核心不能执行。 */
      export const NativeEscapePortByte = 24;

      /** 把扩展口句柄映射进线性位元。结果是起始位地址。客核心不能执行。 */
      export const NativeEscapeMap = 25;

      /** 卸下映射。没有结果寄存器。客核心不能执行。 */
      export const NativeEscapeUnmap = 26;

      /** 按毫秒等待。核心保持执行中。客核心可以执行。 */
      export const NativeEscapeDwell = 27;

      /** 取出入站整数。先写有没有，再写值。客核心不能执行。 */
      export const NativeEscapeInbox = 28;

      /** 把扩展口上已经准备好的应答写入位地址。结果写入第一个寄存器。客核心不能执行。 */
      export const NativeEscapeFill = 29;

      /**
       * 让一颗已停止的核心进入兼容任务。三个寄存器：核心、描述符位地址、描述符八位组数。
       * 描述符必须是 32 个八位组。客核心不能执行。全机同时只能有一份。
       */
      export const NativeEscapeAdmit = 30;

      /**
       * 这条转义后面固定有几个寄存器编号。
       * 没有计数字节。未登记的编号返回空，调用方必须失败且不改指令指针。
       */
      export function nativeEscapeArity(opcode: number): number | null {
        if (opcode === NativeEscapeGate || opcode === NativeEscapeYield || opcode === NativeEscapePresent) {
          return 0;
        }
        if (
          opcode === NativeEscapeCore
          || opcode === NativeEscapeSchedule
          || opcode === NativeEscapeRelease
          || opcode === NativeEscapeSlice
          || opcode === NativeEscapeDwell
        ) {
          return 1;
        }
        if (
          opcode === NativeEscapePass
          || opcode === NativeEscapeTake
          || opcode === NativeEscapeSvc
          || opcode === NativeEscapeCapture
          || opcode === NativeEscapeRestore
          || opcode === NativeEscapeHertz
          || opcode === NativeEscapePortState
          || opcode === NativeEscapeUnmap
          || opcode === NativeEscapeInbox
        ) {
          return 2;
        }
        if (
          opcode === NativeEscapeBound
          || opcode === NativeEscapeInstall
          || opcode === NativeEscapeExchange
          || opcode === NativeEscapePortChar
          || opcode === NativeEscapeAdmit
        ) {
          return 3;
        }
        if (
          opcode === NativeEscapeQuery
          || opcode === NativeEscapeAttach
          || opcode === NativeEscapePortByte
          || opcode === NativeEscapeMap
          || opcode === NativeEscapeFill
        ) {
          return 4;
        }
        if (opcode === NativeEscapeCharacter) {
          return 5;
        }
        if (opcode === NativeEscapeAccel || opcode === NativeEscapeCarry) {
          return 6;
        }
        return null;
      }
    }
  }
}
