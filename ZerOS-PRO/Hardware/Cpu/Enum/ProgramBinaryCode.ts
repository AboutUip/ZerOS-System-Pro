/**
 * @module ZerOS.Hardware.Cpu.ProgramBinaryCode
 * @description 程序二进制里的指令编号
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 这些编号只出现在无扩展名的程序文件里。
 * 它们不是 ZCP1 的机器码，也不是主板内存通道的操作码。
 * 同一条指令在 ZAP 里仍是一行助记符。编号只为了跳过那一次文本解析。
 * 编译器 `Compiler/Obr/src/image/Write.cpp` 必须使用同一张表。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 文件头
 *   2. 指令编号
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      /** 文件头四个字节：Z P B 1。 */
      export const ProgramBinaryMagic0 = 0x5a;
      export const ProgramBinaryMagic1 = 0x50;
      export const ProgramBinaryMagic2 = 0x42;
      export const ProgramBinaryMagic3 = 0x31;

      /**
       * 版本 1 只有指令，读完必须正好用尽字节。
       * 版本 2 在这些指令之后还有链接目录。编码器往返仍写版本 1。
       */
      export const ProgramBinaryVersion = 1;

      /** 带导出、导入和重定位的映像。 */
      export const ProgramBinaryVersionLink = 2;

      /** 1 表示文件里的多字节整数是小端。 */
      export const ProgramBinaryLittleEndian = 1;

      /** 没有操作数。 */
      export const ProgramBinaryHalt = 1;
      export const ProgramBinaryGpuPresent = 2;
      export const ProgramBinaryGpuCompose = 3;

      /** 后面跟一个寄存器编号。 */
      export const ProgramBinaryGpuDrop = 4;
      export const ProgramBinaryGpuHertz = 5;
      export const ProgramBinaryGpuClear = 6;
      export const ProgramBinaryMemHertz = 7;
      export const ProgramBinaryJmp = 8;
      export const ProgramBinaryRet = 9;

      /** 后面跟两个寄存器编号。 */
      export const ProgramBinaryGpuGlyph = 10;
      export const ProgramBinaryGpuMetric = 11;
      export const ProgramBinaryGpuLoad = 12;
      export const ProgramBinaryGpuStore = 13;
      export const ProgramBinaryMemMetric = 14;
      export const ProgramBinaryHertz = 15;
      export const ProgramBinaryNot = 16;
      export const ProgramBinaryItof = 17;
      export const ProgramBinaryInbox = 18;
      export const ProgramBinaryPortState = 19;

      /** 后面跟三个寄存器编号。 */
      export const ProgramBinaryPortChar = 20;
      export const ProgramBinaryXchg = 21;
      export const ProgramBinaryGpuPlot = 22;
      export const ProgramBinaryGpuAlign = 23;
      export const ProgramBinaryGpuPaint = 24;
      export const ProgramBinaryAdd = 25;
      export const ProgramBinaryEq = 26;
      export const ProgramBinarySub = 27;
      export const ProgramBinaryUdiv = 28;
      export const ProgramBinaryUmod = 29;
      export const ProgramBinaryMul = 30;
      export const ProgramBinaryDiv = 31;
      export const ProgramBinaryMod = 32;
      export const ProgramBinaryAnd = 33;
      export const ProgramBinaryOr = 34;
      export const ProgramBinaryXor = 35;
      export const ProgramBinaryShl = 36;
      export const ProgramBinaryShr = 37;
      export const ProgramBinaryFadd = 38;
      export const ProgramBinaryFsub = 39;
      export const ProgramBinaryFmul = 40;
      export const ProgramBinaryFdiv = 41;
      export const ProgramBinaryFpow = 42;
      export const ProgramBinaryFmod = 43;
      export const ProgramBinaryLt = 44;
      export const ProgramBinaryLe = 45;
      export const ProgramBinaryGt = 46;
      export const ProgramBinaryGe = 47;
      export const ProgramBinaryFeq = 48;

      /** 后面跟四个寄存器编号。 */
      export const ProgramBinaryMetric = 49;
      export const ProgramBinaryQuery = 50;
      export const ProgramBinaryPortByte = 51;

      /** 后面跟五个寄存器编号。 */
      export const ProgramBinaryGpuCharacter = 52;

      /** 后面跟六个寄存器编号。 */
      export const ProgramBinaryGpuText = 53;
      export const ProgramBinaryGpuAccel = 54;

      /** 后面跟七个寄存器编号。 */
      export const ProgramBinaryGpuBox = 55;

      /** 一个寄存器，再加一个 32 位指令编号。 */
      export const ProgramBinaryCall = 56;
      export const ProgramBinaryLink = 57;
      export const ProgramBinaryJz = 58;
      export const ProgramBinaryJnz = 59;

      /**
       * 一个寄存器，再加一个 64 位立即数。
       * 立即数先有一个标记：0 是有符号，1 是不小于 2^63 的无符号。
       */
      export const ProgramBinaryPlace = 60;
      export const ProgramBinaryLoad = 61;
      export const ProgramBinaryStore = 62;

      /** 内存通道操作码，再加两个寄存器。 */
      export const ProgramBinaryLdi = 63;
      export const ProgramBinarySti = 64;

      /** 三个寄存器：目标核心、线性位元地址、八位组长度。 */
      export const ProgramBinaryInstall = 65;

      /** 一个寄存器：要调度的核心。 */
      export const ProgramBinarySchedule = 66;
      /** 一个寄存器：本核心的时间片，0 表示直到停机。 */
      export const ProgramBinarySlice = 67;
      /** 两个寄存器：目标核心、要送出的整数。 */
      export const ProgramBinaryPass = 68;
      /** 两个寄存器：是否取到、取到的整数。 */
      export const ProgramBinaryTake = 69;
      /** 两个寄存器：回复目的、服务号。 */
      export const ProgramBinarySvc = 70;
      /** 三个寄存器：核心、起点、位数。 */
      export const ProgramBinaryBound = 71;
      /** 没有操作数。当前核心成为监督核。 */
      export const ProgramBinaryGate = 72;
      /** 一个寄存器：要卸下的核心。 */
      export const ProgramBinaryRelease = 73;
      /** 没有操作数。停在下一条，寄存器保留。 */
      export const ProgramBinaryYield = 74;
      /** 一个寄存器：写入本核心编号。 */
      export const ProgramBinaryCore = 75;
      /** 四个寄存器：目的、扩展口、位元地址、八位组个数。 */
      export const ProgramBinaryFill = 76;
      /** 六个寄存器：目的、扩展口、句柄、偏移、位元地址、八位组个数。 */
      export const ProgramBinaryCarry = 77;
      /** 两个寄存器：目标核心、上下文槽。把已停止核心的寄存器和序列抄进槽。 */
      export const ProgramBinaryCapture = 78;
      /** 两个寄存器：目标核心、上下文槽。把槽里的寄存器和序列放回已停止的核心。 */
      export const ProgramBinaryRestore = 79;
      /** 四个寄存器：结果、目标核心、位元地址、八位组长度。把动态库接到已有序列末尾。 */
      export const ProgramBinaryAttach = 80;

      /** 立即数标记。0 用有符号 64 位读回，1 用无符号 64 位读回。 */
      export const ProgramBinaryImmediateSigned = 0;
      export const ProgramBinaryImmediateWide = 1;
    }
  }
}
