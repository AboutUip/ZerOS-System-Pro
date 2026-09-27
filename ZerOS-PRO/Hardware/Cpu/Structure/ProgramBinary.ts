/**
 * @module ZerOS.Hardware.Cpu.ProgramBinary
 * @description 把已经展开的指令写成无扩展名二进制，或从中读回
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 文件头标明版本和小端。每条记录是编号加操作数，不再保存助记符。
 * 读回来的结构和 parseCpuInstruction 得到的是同一种指令，执行路径不变。
 * 这不是 ZCP1 机器码。标号和 call 必须在写入之前已经收成指令编号。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 读写
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as CodeRoot } from "../Enum/ProgramBinaryCode";
import { type ZerOS as InstructionRoot } from "./CpuInstruction";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      type CpuInstruction = InstructionRoot.Hardware.Cpu.CpuInstruction;

      const ProgramBinaryMagic0 = CodeRoot.Hardware.Cpu.ProgramBinaryMagic0;
      const ProgramBinaryMagic1 = CodeRoot.Hardware.Cpu.ProgramBinaryMagic1;
      const ProgramBinaryMagic2 = CodeRoot.Hardware.Cpu.ProgramBinaryMagic2;
      const ProgramBinaryMagic3 = CodeRoot.Hardware.Cpu.ProgramBinaryMagic3;
      const ProgramBinaryVersion = CodeRoot.Hardware.Cpu.ProgramBinaryVersion;
      const ProgramBinaryLittleEndian = CodeRoot.Hardware.Cpu.ProgramBinaryLittleEndian;
      const ProgramBinaryHalt = CodeRoot.Hardware.Cpu.ProgramBinaryHalt;
      const ProgramBinaryGpuPresent = CodeRoot.Hardware.Cpu.ProgramBinaryGpuPresent;
      const ProgramBinaryGpuCompose = CodeRoot.Hardware.Cpu.ProgramBinaryGpuCompose;
      const ProgramBinaryGpuDrop = CodeRoot.Hardware.Cpu.ProgramBinaryGpuDrop;
      const ProgramBinaryGpuHertz = CodeRoot.Hardware.Cpu.ProgramBinaryGpuHertz;
      const ProgramBinaryGpuClear = CodeRoot.Hardware.Cpu.ProgramBinaryGpuClear;
      const ProgramBinaryMemHertz = CodeRoot.Hardware.Cpu.ProgramBinaryMemHertz;
      const ProgramBinaryJmp = CodeRoot.Hardware.Cpu.ProgramBinaryJmp;
      const ProgramBinaryRet = CodeRoot.Hardware.Cpu.ProgramBinaryRet;
      const ProgramBinaryGpuGlyph = CodeRoot.Hardware.Cpu.ProgramBinaryGpuGlyph;
      const ProgramBinaryGpuMetric = CodeRoot.Hardware.Cpu.ProgramBinaryGpuMetric;
      const ProgramBinaryGpuLoad = CodeRoot.Hardware.Cpu.ProgramBinaryGpuLoad;
      const ProgramBinaryGpuStore = CodeRoot.Hardware.Cpu.ProgramBinaryGpuStore;
      const ProgramBinaryMemMetric = CodeRoot.Hardware.Cpu.ProgramBinaryMemMetric;
      const ProgramBinaryHertz = CodeRoot.Hardware.Cpu.ProgramBinaryHertz;
      const ProgramBinaryNot = CodeRoot.Hardware.Cpu.ProgramBinaryNot;
      const ProgramBinaryItof = CodeRoot.Hardware.Cpu.ProgramBinaryItof;
      const ProgramBinaryInbox = CodeRoot.Hardware.Cpu.ProgramBinaryInbox;
      const ProgramBinaryPortState = CodeRoot.Hardware.Cpu.ProgramBinaryPortState;
      const ProgramBinaryPortChar = CodeRoot.Hardware.Cpu.ProgramBinaryPortChar;
      const ProgramBinaryXchg = CodeRoot.Hardware.Cpu.ProgramBinaryXchg;
      const ProgramBinaryGpuPlot = CodeRoot.Hardware.Cpu.ProgramBinaryGpuPlot;
      const ProgramBinaryGpuAlign = CodeRoot.Hardware.Cpu.ProgramBinaryGpuAlign;
      const ProgramBinaryGpuPaint = CodeRoot.Hardware.Cpu.ProgramBinaryGpuPaint;
      const ProgramBinaryAdd = CodeRoot.Hardware.Cpu.ProgramBinaryAdd;
      const ProgramBinaryEq = CodeRoot.Hardware.Cpu.ProgramBinaryEq;
      const ProgramBinarySub = CodeRoot.Hardware.Cpu.ProgramBinarySub;
      const ProgramBinaryUdiv = CodeRoot.Hardware.Cpu.ProgramBinaryUdiv;
      const ProgramBinaryUmod = CodeRoot.Hardware.Cpu.ProgramBinaryUmod;
      const ProgramBinaryMul = CodeRoot.Hardware.Cpu.ProgramBinaryMul;
      const ProgramBinaryDiv = CodeRoot.Hardware.Cpu.ProgramBinaryDiv;
      const ProgramBinaryMod = CodeRoot.Hardware.Cpu.ProgramBinaryMod;
      const ProgramBinaryAnd = CodeRoot.Hardware.Cpu.ProgramBinaryAnd;
      const ProgramBinaryOr = CodeRoot.Hardware.Cpu.ProgramBinaryOr;
      const ProgramBinaryXor = CodeRoot.Hardware.Cpu.ProgramBinaryXor;
      const ProgramBinaryShl = CodeRoot.Hardware.Cpu.ProgramBinaryShl;
      const ProgramBinaryShr = CodeRoot.Hardware.Cpu.ProgramBinaryShr;
      const ProgramBinaryFadd = CodeRoot.Hardware.Cpu.ProgramBinaryFadd;
      const ProgramBinaryFsub = CodeRoot.Hardware.Cpu.ProgramBinaryFsub;
      const ProgramBinaryFmul = CodeRoot.Hardware.Cpu.ProgramBinaryFmul;
      const ProgramBinaryFdiv = CodeRoot.Hardware.Cpu.ProgramBinaryFdiv;
      const ProgramBinaryFpow = CodeRoot.Hardware.Cpu.ProgramBinaryFpow;
      const ProgramBinaryFmod = CodeRoot.Hardware.Cpu.ProgramBinaryFmod;
      const ProgramBinaryLt = CodeRoot.Hardware.Cpu.ProgramBinaryLt;
      const ProgramBinaryLe = CodeRoot.Hardware.Cpu.ProgramBinaryLe;
      const ProgramBinaryGt = CodeRoot.Hardware.Cpu.ProgramBinaryGt;
      const ProgramBinaryGe = CodeRoot.Hardware.Cpu.ProgramBinaryGe;
      const ProgramBinaryFeq = CodeRoot.Hardware.Cpu.ProgramBinaryFeq;
      const ProgramBinaryMetric = CodeRoot.Hardware.Cpu.ProgramBinaryMetric;
      const ProgramBinaryQuery = CodeRoot.Hardware.Cpu.ProgramBinaryQuery;
      const ProgramBinaryPortByte = CodeRoot.Hardware.Cpu.ProgramBinaryPortByte;
      const ProgramBinaryGpuCharacter = CodeRoot.Hardware.Cpu.ProgramBinaryGpuCharacter;
      const ProgramBinaryGpuText = CodeRoot.Hardware.Cpu.ProgramBinaryGpuText;
      const ProgramBinaryGpuAccel = CodeRoot.Hardware.Cpu.ProgramBinaryGpuAccel;
      const ProgramBinaryGpuBox = CodeRoot.Hardware.Cpu.ProgramBinaryGpuBox;
      const ProgramBinaryCall = CodeRoot.Hardware.Cpu.ProgramBinaryCall;
      const ProgramBinaryLink = CodeRoot.Hardware.Cpu.ProgramBinaryLink;
      const ProgramBinaryJz = CodeRoot.Hardware.Cpu.ProgramBinaryJz;
      const ProgramBinaryJnz = CodeRoot.Hardware.Cpu.ProgramBinaryJnz;
      const ProgramBinaryPlace = CodeRoot.Hardware.Cpu.ProgramBinaryPlace;
      const ProgramBinaryLoad = CodeRoot.Hardware.Cpu.ProgramBinaryLoad;
      const ProgramBinaryStore = CodeRoot.Hardware.Cpu.ProgramBinaryStore;
      const ProgramBinaryLdi = CodeRoot.Hardware.Cpu.ProgramBinaryLdi;
      const ProgramBinarySti = CodeRoot.Hardware.Cpu.ProgramBinarySti;
      const ProgramBinaryInstall = CodeRoot.Hardware.Cpu.ProgramBinaryInstall;
      const ProgramBinarySchedule = CodeRoot.Hardware.Cpu.ProgramBinarySchedule;
      const ProgramBinarySlice = CodeRoot.Hardware.Cpu.ProgramBinarySlice;
      const ProgramBinaryPass = CodeRoot.Hardware.Cpu.ProgramBinaryPass;
      const ProgramBinaryTake = CodeRoot.Hardware.Cpu.ProgramBinaryTake;
      const ProgramBinarySvc = CodeRoot.Hardware.Cpu.ProgramBinarySvc;
      const ProgramBinaryBound = CodeRoot.Hardware.Cpu.ProgramBinaryBound;
      const ProgramBinaryGate = CodeRoot.Hardware.Cpu.ProgramBinaryGate;
      const ProgramBinaryRelease = CodeRoot.Hardware.Cpu.ProgramBinaryRelease;
      const ProgramBinaryYield = CodeRoot.Hardware.Cpu.ProgramBinaryYield;
      const ProgramBinaryCore = CodeRoot.Hardware.Cpu.ProgramBinaryCore;
      const ProgramBinaryFill = CodeRoot.Hardware.Cpu.ProgramBinaryFill;
      const ProgramBinaryCarry = CodeRoot.Hardware.Cpu.ProgramBinaryCarry;
      const ProgramBinaryCapture = CodeRoot.Hardware.Cpu.ProgramBinaryCapture;
      const ProgramBinaryRestore = CodeRoot.Hardware.Cpu.ProgramBinaryRestore;
      const ProgramBinaryAttach = CodeRoot.Hardware.Cpu.ProgramBinaryAttach;
      const ProgramBinaryVersionLink = CodeRoot.Hardware.Cpu.ProgramBinaryVersionLink;
      const ProgramBinaryImmediateSigned = CodeRoot.Hardware.Cpu.ProgramBinaryImmediateSigned;
      const ProgramBinaryImmediateWide = CodeRoot.Hardware.Cpu.ProgramBinaryImmediateWide;

      const binaryPrefix = "[ZerOS.Hardware.Cpu.ProgramBinary]";
      const signedLimit = 0x8000000000000000n;
      const unsignedLimit = 0x10000000000000000n;

      function fail(message: string): never {
        throw new Error(`${binaryPrefix} ${message}`);
      }

      /**
       * 头部四个魔数对齐时，这段字节才可能是程序二进制。
       * 太短或魔数不对就当普通 ZAP，不在这里报错。
       */
      export function isProgramBinary(bytes: Uint8Array): boolean {
        return bytes.length >= 12
          && bytes[0] === ProgramBinaryMagic0
          && bytes[1] === ProgramBinaryMagic1
          && bytes[2] === ProgramBinaryMagic2
          && bytes[3] === ProgramBinaryMagic3;
      }

      interface Writer {
        bytes: Uint8Array;
        used: number;
      }

      function reserve(writer: Writer, extra: number): DataView {
        const need = writer.used + extra;
        if (need > writer.bytes.length) {
          let size = writer.bytes.length;
          while (size < need) {
            size *= 2;
          }
          const next = new Uint8Array(size);
          next.set(writer.bytes);
          writer.bytes = next;
        }
        return new DataView(writer.bytes.buffer);
      }

      function writeCode(writer: Writer, code: number): void {
        const view = reserve(writer, 2);
        view.setUint16(writer.used, code, true);
        writer.used += 2;
      }

      function writeRegister(writer: Writer, register: number): void {
        if (!Number.isInteger(register) || register < 0 || register > 7) {
          fail("寄存器编号超出 0 到 7");
        }
        const view = reserve(writer, 1);
        view.setUint8(writer.used, register);
        writer.used += 1;
      }

      function writeRegisters(writer: Writer, registers: readonly number[]): void {
        for (const register of registers) {
          writeRegister(writer, register);
        }
      }

      function writeTarget(writer: Writer, target: number): void {
        if (!Number.isInteger(target) || target < 0 || target > 0xffffffff) {
          fail("跳转目标放不进 32 位");
        }
        const view = reserve(writer, 4);
        view.setUint32(writer.used, target, true);
        writer.used += 4;
      }

      /** 负数和小于 2^63 的数用有符号；更大的 64 位模式用无符号，避免和 -1 撞成同一个补码。 */
      function writeImmediate(writer: Writer, value: bigint): void {
        const view = reserve(writer, 9);
        if (value < 0n) {
          if (value < -signedLimit) {
            fail("立即数小于有符号 64 位");
          }
          view.setUint8(writer.used, ProgramBinaryImmediateSigned);
          view.setBigInt64(writer.used + 1, value, true);
        } else if (value >= signedLimit) {
          if (value >= unsignedLimit) {
            fail("立即数超出 64 位");
          }
          view.setUint8(writer.used, ProgramBinaryImmediateWide);
          view.setBigUint64(writer.used + 1, value, true);
        } else {
          view.setUint8(writer.used, ProgramBinaryImmediateSigned);
          view.setBigInt64(writer.used + 1, value, true);
        }
        writer.used += 9;
      }

      function writeOpcode(writer: Writer, opcode: number): void {
        if (!Number.isInteger(opcode) || opcode < 1 || opcode > 14) {
          fail("访存操作码不在通道表里");
        }
        const view = reserve(writer, 1);
        view.setUint8(writer.used, opcode);
        writer.used += 1;
      }

      function encodeOne(writer: Writer, step: CpuInstruction): void {
        switch (step.Op) {
          case "halt":
            writeCode(writer, ProgramBinaryHalt);
            return;
          case "gpu.present":
            writeCode(writer, ProgramBinaryGpuPresent);
            return;
          case "gpu.compose":
            writeCode(writer, ProgramBinaryGpuCompose);
            return;
          case "gpu.drop":
            writeCode(writer, ProgramBinaryGpuDrop);
            writeRegister(writer, step.Node);
            return;
          case "gpu.hertz":
            writeCode(writer, ProgramBinaryGpuHertz);
            writeRegister(writer, step.Hertz);
            return;
          case "gpu.clear":
            writeCode(writer, ProgramBinaryGpuClear);
            writeRegister(writer, step.Register);
            return;
          case "mem.hertz":
            writeCode(writer, ProgramBinaryMemHertz);
            writeRegister(writer, step.Hertz);
            return;
          case "jmp":
            writeCode(writer, ProgramBinaryJmp);
            writeRegister(writer, step.Register);
            return;
          case "ret":
            writeCode(writer, ProgramBinaryRet);
            writeRegister(writer, step.Register);
            return;
          case "gpu.glyph":
            writeCode(writer, ProgramBinaryGpuGlyph);
            writeRegisters(writer, [step.Node, step.Code]);
            return;
          case "gpu.metric":
            writeCode(writer, ProgramBinaryGpuMetric);
            writeRegisters(writer, [step.Register, step.Kind]);
            return;
          case "gpu.load":
            writeCode(writer, ProgramBinaryGpuLoad);
            writeRegisters(writer, [step.Register, step.Address]);
            return;
          case "gpu.store":
            writeCode(writer, ProgramBinaryGpuStore);
            writeRegisters(writer, [step.Address, step.Value]);
            return;
          case "mem.metric":
            writeCode(writer, ProgramBinaryMemMetric);
            writeRegisters(writer, [step.Register, step.Kind]);
            return;
          case "hertz":
            writeCode(writer, ProgramBinaryHertz);
            writeRegisters(writer, [step.Ordinal, step.Hertz]);
            return;
          case "not":
            writeCode(writer, ProgramBinaryNot);
            writeRegisters(writer, [step.Destination, step.Source]);
            return;
          case "itof":
            writeCode(writer, ProgramBinaryItof);
            writeRegisters(writer, [step.Destination, step.Source]);
            return;
          case "inbox":
            writeCode(writer, ProgramBinaryInbox);
            writeRegisters(writer, [step.Found, step.Value]);
            return;
          case "port.state":
            writeCode(writer, ProgramBinaryPortState);
            writeRegisters(writer, [step.Destination, step.Port]);
            return;
          case "port.char":
            writeCode(writer, ProgramBinaryPortChar);
            writeRegisters(writer, [step.Destination, step.Port, step.Offset]);
            return;
          case "xchg":
            writeCode(writer, ProgramBinaryXchg);
            writeRegisters(writer, [step.Port, step.Direction, step.Data]);
            return;
          case "install":
            writeCode(writer, ProgramBinaryInstall);
            writeRegisters(writer, [step.Core, step.Address, step.Length]);
            return;
          case "schedule":
            writeCode(writer, ProgramBinarySchedule);
            writeRegister(writer, step.Core);
            return;
          case "slice":
            writeCode(writer, ProgramBinarySlice);
            writeRegister(writer, step.Count);
            return;
          case "pass":
            writeCode(writer, ProgramBinaryPass);
            writeRegisters(writer, [step.Core, step.Value]);
            return;
          case "take":
            writeCode(writer, ProgramBinaryTake);
            writeRegisters(writer, [step.Found, step.Value]);
            return;
          case "svc":
            writeCode(writer, ProgramBinarySvc);
            writeRegisters(writer, [step.Destination, step.Service]);
            return;
          case "bound":
            writeCode(writer, ProgramBinaryBound);
            writeRegisters(writer, [step.Core, step.Origin, step.Length]);
            return;
          case "gate":
            writeCode(writer, ProgramBinaryGate);
            return;
          case "release":
            writeCode(writer, ProgramBinaryRelease);
            writeRegister(writer, step.Core);
            return;
          case "yield":
            writeCode(writer, ProgramBinaryYield);
            return;
          case "core":
            writeCode(writer, ProgramBinaryCore);
            writeRegister(writer, step.Register);
            return;
          case "fill":
            writeCode(writer, ProgramBinaryFill);
            writeRegisters(writer, [step.Destination, step.Port, step.Address, step.Count]);
            return;
          case "carry":
            writeCode(writer, ProgramBinaryCarry);
            writeRegisters(writer, [step.Destination, step.Port, step.Handle, step.Offset, step.Address, step.Count]);
            return;
          case "capture":
            writeCode(writer, ProgramBinaryCapture);
            writeRegisters(writer, [step.Core, step.Slot]);
            return;
          case "restore":
            writeCode(writer, ProgramBinaryRestore);
            writeRegisters(writer, [step.Core, step.Slot]);
            return;
          case "attach":
            writeCode(writer, ProgramBinaryAttach);
            writeRegisters(writer, [step.Destination, step.Core, step.Address, step.Length]);
            return;
          case "gpu.plot":
            writeCode(writer, ProgramBinaryGpuPlot);
            writeRegisters(writer, [step.X, step.Y, step.Pixel]);
            return;
          case "gpu.align":
            writeCode(writer, ProgramBinaryGpuAlign);
            writeRegisters(writer, [step.Node, step.AlignX, step.AlignY]);
            return;
          case "gpu.paint":
            writeCode(writer, ProgramBinaryGpuPaint);
            writeRegisters(writer, [step.Node, step.Foreground, step.Background]);
            return;
          case "add":
            writeCode(writer, ProgramBinaryAdd);
            writeRegisters(writer, [step.Destination, step.Left, step.Right]);
            return;
          case "eq":
            writeCode(writer, ProgramBinaryEq);
            writeRegisters(writer, [step.Destination, step.Left, step.Right]);
            return;
          case "sub":
            writeCode(writer, ProgramBinarySub);
            writeRegisters(writer, [step.Destination, step.Left, step.Right]);
            return;
          case "udiv":
            writeCode(writer, ProgramBinaryUdiv);
            writeRegisters(writer, [step.Destination, step.Left, step.Right]);
            return;
          case "umod":
            writeCode(writer, ProgramBinaryUmod);
            writeRegisters(writer, [step.Destination, step.Left, step.Right]);
            return;
          case "mul":
            writeCode(writer, ProgramBinaryMul);
            writeRegisters(writer, [step.Destination, step.Left, step.Right]);
            return;
          case "div":
            writeCode(writer, ProgramBinaryDiv);
            writeRegisters(writer, [step.Destination, step.Left, step.Right]);
            return;
          case "mod":
            writeCode(writer, ProgramBinaryMod);
            writeRegisters(writer, [step.Destination, step.Left, step.Right]);
            return;
          case "and":
            writeCode(writer, ProgramBinaryAnd);
            writeRegisters(writer, [step.Destination, step.Left, step.Right]);
            return;
          case "or":
            writeCode(writer, ProgramBinaryOr);
            writeRegisters(writer, [step.Destination, step.Left, step.Right]);
            return;
          case "xor":
            writeCode(writer, ProgramBinaryXor);
            writeRegisters(writer, [step.Destination, step.Left, step.Right]);
            return;
          case "shl":
            writeCode(writer, ProgramBinaryShl);
            writeRegisters(writer, [step.Destination, step.Left, step.Right]);
            return;
          case "shr":
            writeCode(writer, ProgramBinaryShr);
            writeRegisters(writer, [step.Destination, step.Left, step.Right]);
            return;
          case "fadd":
            writeCode(writer, ProgramBinaryFadd);
            writeRegisters(writer, [step.Destination, step.Left, step.Right]);
            return;
          case "fsub":
            writeCode(writer, ProgramBinaryFsub);
            writeRegisters(writer, [step.Destination, step.Left, step.Right]);
            return;
          case "fmul":
            writeCode(writer, ProgramBinaryFmul);
            writeRegisters(writer, [step.Destination, step.Left, step.Right]);
            return;
          case "fdiv":
            writeCode(writer, ProgramBinaryFdiv);
            writeRegisters(writer, [step.Destination, step.Left, step.Right]);
            return;
          case "fpow":
            writeCode(writer, ProgramBinaryFpow);
            writeRegisters(writer, [step.Destination, step.Left, step.Right]);
            return;
          case "fmod":
            writeCode(writer, ProgramBinaryFmod);
            writeRegisters(writer, [step.Destination, step.Left, step.Right]);
            return;
          case "lt":
            writeCode(writer, ProgramBinaryLt);
            writeRegisters(writer, [step.Destination, step.Left, step.Right]);
            return;
          case "le":
            writeCode(writer, ProgramBinaryLe);
            writeRegisters(writer, [step.Destination, step.Left, step.Right]);
            return;
          case "gt":
            writeCode(writer, ProgramBinaryGt);
            writeRegisters(writer, [step.Destination, step.Left, step.Right]);
            return;
          case "ge":
            writeCode(writer, ProgramBinaryGe);
            writeRegisters(writer, [step.Destination, step.Left, step.Right]);
            return;
          case "feq":
            writeCode(writer, ProgramBinaryFeq);
            writeRegisters(writer, [step.Destination, step.Left, step.Right]);
            return;
          case "metric":
            writeCode(writer, ProgramBinaryMetric);
            writeRegisters(writer, [step.Register, step.Ordinal, step.Kind]);
            return;
          case "query":
            writeCode(writer, ProgramBinaryQuery);
            writeRegisters(writer, [step.Register, step.Seat, step.Field, step.Index]);
            return;
          case "port.byte":
            writeCode(writer, ProgramBinaryPortByte);
            writeRegisters(writer, [step.Destination, step.Port, step.Field, step.Offset]);
            return;
          case "gpu.character":
            writeCode(writer, ProgramBinaryGpuCharacter);
            writeRegisters(writer, [step.X, step.Y, step.Code, step.Foreground, step.Background]);
            return;
          case "gpu.text":
            writeCode(writer, ProgramBinaryGpuText);
            writeRegisters(writer, [step.Register, step.Parent, step.X, step.Y, step.Width, step.Height]);
            return;
          case "gpu.accel":
            writeCode(writer, ProgramBinaryGpuAccel);
            writeRegisters(writer, [step.Register, step.Operation, step.A, step.B, step.C, step.D]);
            return;
          case "gpu.box":
            writeCode(writer, ProgramBinaryGpuBox);
            writeRegisters(writer, [step.Register, step.Parent, step.X, step.Y, step.Width, step.Height, step.Fill]);
            return;
          case "call":
            writeCode(writer, ProgramBinaryCall);
            writeRegister(writer, step.Register);
            writeTarget(writer, step.Target);
            return;
          case "link":
            writeCode(writer, ProgramBinaryLink);
            writeRegister(writer, step.Register);
            writeTarget(writer, step.Target);
            return;
          case "jz":
            writeCode(writer, ProgramBinaryJz);
            writeRegister(writer, step.Condition);
            writeTarget(writer, step.Target);
            return;
          case "jnz":
            writeCode(writer, ProgramBinaryJnz);
            writeRegister(writer, step.Condition);
            writeTarget(writer, step.Target);
            return;
          case "place":
            writeCode(writer, ProgramBinaryPlace);
            writeRegister(writer, step.Register);
            writeImmediate(writer, step.Data);
            return;
          case "load":
            writeCode(writer, ProgramBinaryLoad);
            writeOpcode(writer, step.Opcode);
            writeImmediate(writer, step.Address);
            writeRegister(writer, step.Register);
            return;
          case "store":
            writeCode(writer, ProgramBinaryStore);
            writeOpcode(writer, step.Opcode);
            writeImmediate(writer, step.Address);
            writeRegister(writer, step.Register);
            return;
          case "ldi":
            writeCode(writer, ProgramBinaryLdi);
            writeOpcode(writer, step.Opcode);
            writeRegisters(writer, [step.Register, step.Address]);
            return;
          case "sti":
            writeCode(writer, ProgramBinarySti);
            writeOpcode(writer, step.Opcode);
            writeRegisters(writer, [step.Register, step.Address]);
            return;
          default: {
            const unexpected: never = step;
            fail(`没有这种指令 ${String(unexpected)}`);
          }
        }
      }

      /** 把展开后的指令序列写成小端文件。空序列也有 12 字节文件头。 */
      export function encodeProgramBinary(steps: readonly CpuInstruction[]): Uint8Array {
        const writer: Writer = { bytes: new Uint8Array(256), used: 12 };
        const header = new DataView(writer.bytes.buffer);
        header.setUint8(0, ProgramBinaryMagic0);
        header.setUint8(1, ProgramBinaryMagic1);
        header.setUint8(2, ProgramBinaryMagic2);
        header.setUint8(3, ProgramBinaryMagic3);
        header.setUint16(4, ProgramBinaryVersion, true);
        header.setUint16(6, ProgramBinaryLittleEndian, true);
        header.setUint32(8, steps.length, true);
        for (const step of steps) {
          encodeOne(writer, step);
        }
        return writer.bytes.slice(0, writer.used);
      }

      interface Reader {
        view: DataView;
        at: number;
        end: number;
      }

      function readByte(reader: Reader): number {
        if (reader.at >= reader.end) {
          fail("程序二进制在一条指令中间结束");
        }
        const value = reader.view.getUint8(reader.at);
        reader.at += 1;
        return value;
      }

      function readRegister(reader: Reader): number {
        const register = readByte(reader);
        if (register > 7) {
          fail("寄存器编号超出 0 到 7");
        }
        return register;
      }

      function readCode(reader: Reader): number {
        if (reader.at + 2 > reader.end) {
          fail("程序二进制在指令编号处结束");
        }
        const code = reader.view.getUint16(reader.at, true);
        reader.at += 2;
        return code;
      }

      function readTarget(reader: Reader): number {
        if (reader.at + 4 > reader.end) {
          fail("程序二进制在跳转目标处结束");
        }
        const target = reader.view.getUint32(reader.at, true);
        reader.at += 4;
        return target;
      }

      function readImmediate(reader: Reader): bigint {
        const mark = readByte(reader);
        if (reader.at + 8 > reader.end) {
          fail("程序二进制在立即数处结束");
        }
        if (mark === ProgramBinaryImmediateSigned) {
          const value = reader.view.getBigInt64(reader.at, true);
          reader.at += 8;
          return value;
        }
        if (mark === ProgramBinaryImmediateWide) {
          const value = reader.view.getBigUint64(reader.at, true);
          reader.at += 8;
          return value;
        }
        fail("立即数标记无法识别");
      }

      function readOpcode(reader: Reader): number {
        const opcode = readByte(reader);
        if (opcode < 1 || opcode > 14) {
          fail("访存操作码不在通道表里");
        }
        return opcode;
      }

      function readOne(reader: Reader): CpuInstruction {
        const code = readCode(reader);
        if (code === ProgramBinaryHalt) {
          return { Op: "halt" };
        }
        if (code === ProgramBinaryGpuPresent) {
          return { Op: "gpu.present" };
        }
        if (code === ProgramBinaryGpuCompose) {
          return { Op: "gpu.compose" };
        }
        if (code === ProgramBinaryGpuDrop) {
          return { Op: "gpu.drop", Node: readRegister(reader) };
        }
        if (code === ProgramBinaryGpuHertz) {
          return { Op: "gpu.hertz", Hertz: readRegister(reader) };
        }
        if (code === ProgramBinaryGpuClear) {
          return { Op: "gpu.clear", Register: readRegister(reader) };
        }
        if (code === ProgramBinaryMemHertz) {
          return { Op: "mem.hertz", Hertz: readRegister(reader) };
        }
        if (code === ProgramBinaryJmp) {
          return { Op: "jmp", Register: readRegister(reader) };
        }
        if (code === ProgramBinaryRet) {
          return { Op: "ret", Register: readRegister(reader) };
        }
        if (code === ProgramBinaryGpuGlyph) {
          return { Op: "gpu.glyph", Node: readRegister(reader), Code: readRegister(reader) };
        }
        if (code === ProgramBinaryGpuMetric) {
          return { Op: "gpu.metric", Register: readRegister(reader), Kind: readRegister(reader) };
        }
        if (code === ProgramBinaryGpuLoad) {
          return { Op: "gpu.load", Register: readRegister(reader), Address: readRegister(reader) };
        }
        if (code === ProgramBinaryGpuStore) {
          return { Op: "gpu.store", Address: readRegister(reader), Value: readRegister(reader) };
        }
        if (code === ProgramBinaryMemMetric) {
          return { Op: "mem.metric", Register: readRegister(reader), Kind: readRegister(reader) };
        }
        if (code === ProgramBinaryHertz) {
          return { Op: "hertz", Ordinal: readRegister(reader), Hertz: readRegister(reader) };
        }
        if (code === ProgramBinaryNot) {
          return { Op: "not", Destination: readRegister(reader), Source: readRegister(reader) };
        }
        if (code === ProgramBinaryItof) {
          return { Op: "itof", Destination: readRegister(reader), Source: readRegister(reader) };
        }
        if (code === ProgramBinaryInbox) {
          return { Op: "inbox", Found: readRegister(reader), Value: readRegister(reader) };
        }
        if (code === ProgramBinaryPortState) {
          return { Op: "port.state", Destination: readRegister(reader), Port: readRegister(reader) };
        }
        if (code === ProgramBinaryPortChar) {
          return {
            Op: "port.char",
            Destination: readRegister(reader),
            Port: readRegister(reader),
            Offset: readRegister(reader),
          };
        }
        if (code === ProgramBinaryXchg) {
          return {
            Op: "xchg",
            Port: readRegister(reader),
            Direction: readRegister(reader),
            Data: readRegister(reader),
          };
        }
        if (code === ProgramBinaryInstall) {
          return {
            Op: "install",
            Core: readRegister(reader),
            Address: readRegister(reader),
            Length: readRegister(reader),
          };
        }
        if (code === ProgramBinarySchedule) {
          return { Op: "schedule", Core: readRegister(reader) };
        }
        if (code === ProgramBinarySlice) {
          return { Op: "slice", Count: readRegister(reader) };
        }
        if (code === ProgramBinaryPass) {
          return { Op: "pass", Core: readRegister(reader), Value: readRegister(reader) };
        }
        if (code === ProgramBinaryTake) {
          return { Op: "take", Found: readRegister(reader), Value: readRegister(reader) };
        }
        if (code === ProgramBinarySvc) {
          return { Op: "svc", Destination: readRegister(reader), Service: readRegister(reader) };
        }
        if (code === ProgramBinaryBound) {
          return {
            Op: "bound",
            Core: readRegister(reader),
            Origin: readRegister(reader),
            Length: readRegister(reader),
          };
        }
        if (code === ProgramBinaryGate) {
          return { Op: "gate" };
        }
        if (code === ProgramBinaryRelease) {
          return { Op: "release", Core: readRegister(reader) };
        }
        if (code === ProgramBinaryYield) {
          return { Op: "yield" };
        }
        if (code === ProgramBinaryCore) {
          return { Op: "core", Register: readRegister(reader) };
        }
        if (code === ProgramBinaryFill) {
          return {
            Op: "fill",
            Destination: readRegister(reader),
            Port: readRegister(reader),
            Address: readRegister(reader),
            Count: readRegister(reader),
          };
        }
        if (code === ProgramBinaryCarry) {
          return {
            Op: "carry",
            Destination: readRegister(reader),
            Port: readRegister(reader),
            Handle: readRegister(reader),
            Offset: readRegister(reader),
            Address: readRegister(reader),
            Count: readRegister(reader),
          };
        }
        if (code === ProgramBinaryCapture) {
          return { Op: "capture", Core: readRegister(reader), Slot: readRegister(reader) };
        }
        if (code === ProgramBinaryRestore) {
          return { Op: "restore", Core: readRegister(reader), Slot: readRegister(reader) };
        }
        if (code === ProgramBinaryAttach) {
          return {
            Op: "attach",
            Destination: readRegister(reader),
            Core: readRegister(reader),
            Address: readRegister(reader),
            Length: readRegister(reader),
          };
        }
        if (code === ProgramBinaryGpuPlot) {
          return { Op: "gpu.plot", X: readRegister(reader), Y: readRegister(reader), Pixel: readRegister(reader) };
        }
        if (code === ProgramBinaryGpuAlign) {
          return {
            Op: "gpu.align",
            Node: readRegister(reader),
            AlignX: readRegister(reader),
            AlignY: readRegister(reader),
          };
        }
        if (code === ProgramBinaryGpuPaint) {
          return {
            Op: "gpu.paint",
            Node: readRegister(reader),
            Foreground: readRegister(reader),
            Background: readRegister(reader),
          };
        }
        if (code === ProgramBinaryAdd || code === ProgramBinaryEq || code === ProgramBinarySub || code === ProgramBinaryUdiv || code === ProgramBinaryUmod || code === ProgramBinaryMul || code === ProgramBinaryDiv || code === ProgramBinaryMod || code === ProgramBinaryAnd || code === ProgramBinaryOr || code === ProgramBinaryXor || code === ProgramBinaryShl || code === ProgramBinaryShr || code === ProgramBinaryFadd || code === ProgramBinaryFsub || code === ProgramBinaryFmul || code === ProgramBinaryFdiv || code === ProgramBinaryFpow || code === ProgramBinaryFmod || code === ProgramBinaryLt || code === ProgramBinaryLe || code === ProgramBinaryGt || code === ProgramBinaryGe || code === ProgramBinaryFeq) {
          const destination = readRegister(reader);
          const left = readRegister(reader);
          const right = readRegister(reader);
          if (code === ProgramBinaryAdd) {
            return { Op: "add", Destination: destination, Left: left, Right: right };
          }
          if (code === ProgramBinaryEq) {
            return { Op: "eq", Destination: destination, Left: left, Right: right };
          }
          if (code === ProgramBinarySub) {
            return { Op: "sub", Destination: destination, Left: left, Right: right };
          }
          if (code === ProgramBinaryUdiv) {
            return { Op: "udiv", Destination: destination, Left: left, Right: right };
          }
          if (code === ProgramBinaryUmod) {
            return { Op: "umod", Destination: destination, Left: left, Right: right };
          }
          if (code === ProgramBinaryMul) {
            return { Op: "mul", Destination: destination, Left: left, Right: right };
          }
          if (code === ProgramBinaryDiv) {
            return { Op: "div", Destination: destination, Left: left, Right: right };
          }
          if (code === ProgramBinaryMod) {
            return { Op: "mod", Destination: destination, Left: left, Right: right };
          }
          if (code === ProgramBinaryAnd) {
            return { Op: "and", Destination: destination, Left: left, Right: right };
          }
          if (code === ProgramBinaryOr) {
            return { Op: "or", Destination: destination, Left: left, Right: right };
          }
          if (code === ProgramBinaryXor) {
            return { Op: "xor", Destination: destination, Left: left, Right: right };
          }
          if (code === ProgramBinaryShl) {
            return { Op: "shl", Destination: destination, Left: left, Right: right };
          }
          if (code === ProgramBinaryShr) {
            return { Op: "shr", Destination: destination, Left: left, Right: right };
          }
          if (code === ProgramBinaryFadd) {
            return { Op: "fadd", Destination: destination, Left: left, Right: right };
          }
          if (code === ProgramBinaryFsub) {
            return { Op: "fsub", Destination: destination, Left: left, Right: right };
          }
          if (code === ProgramBinaryFmul) {
            return { Op: "fmul", Destination: destination, Left: left, Right: right };
          }
          if (code === ProgramBinaryFdiv) {
            return { Op: "fdiv", Destination: destination, Left: left, Right: right };
          }
          if (code === ProgramBinaryFpow) {
            return { Op: "fpow", Destination: destination, Left: left, Right: right };
          }
          if (code === ProgramBinaryFmod) {
            return { Op: "fmod", Destination: destination, Left: left, Right: right };
          }
          if (code === ProgramBinaryLt) {
            return { Op: "lt", Destination: destination, Left: left, Right: right };
          }
          if (code === ProgramBinaryLe) {
            return { Op: "le", Destination: destination, Left: left, Right: right };
          }
          if (code === ProgramBinaryGt) {
            return { Op: "gt", Destination: destination, Left: left, Right: right };
          }
          if (code === ProgramBinaryGe) {
            return { Op: "ge", Destination: destination, Left: left, Right: right };
          }
          return { Op: "feq", Destination: destination, Left: left, Right: right };
        }
        if (code === ProgramBinaryMetric) {
          return {
            Op: "metric",
            Register: readRegister(reader),
            Ordinal: readRegister(reader),
            Kind: readRegister(reader),
          };
        }
        if (code === ProgramBinaryQuery) {
          return {
            Op: "query",
            Register: readRegister(reader),
            Seat: readRegister(reader),
            Field: readRegister(reader),
            Index: readRegister(reader),
          };
        }
        if (code === ProgramBinaryPortByte) {
          return {
            Op: "port.byte",
            Destination: readRegister(reader),
            Port: readRegister(reader),
            Field: readRegister(reader),
            Offset: readRegister(reader),
          };
        }
        if (code === ProgramBinaryGpuCharacter) {
          return {
            Op: "gpu.character",
            X: readRegister(reader),
            Y: readRegister(reader),
            Code: readRegister(reader),
            Foreground: readRegister(reader),
            Background: readRegister(reader),
          };
        }
        if (code === ProgramBinaryGpuText) {
          return {
            Op: "gpu.text",
            Register: readRegister(reader),
            Parent: readRegister(reader),
            X: readRegister(reader),
            Y: readRegister(reader),
            Width: readRegister(reader),
            Height: readRegister(reader),
          };
        }
        if (code === ProgramBinaryGpuAccel) {
          return {
            Op: "gpu.accel",
            Register: readRegister(reader),
            Operation: readRegister(reader),
            A: readRegister(reader),
            B: readRegister(reader),
            C: readRegister(reader),
            D: readRegister(reader),
          };
        }
        if (code === ProgramBinaryGpuBox) {
          return {
            Op: "gpu.box",
            Register: readRegister(reader),
            Parent: readRegister(reader),
            X: readRegister(reader),
            Y: readRegister(reader),
            Width: readRegister(reader),
            Height: readRegister(reader),
            Fill: readRegister(reader),
          };
        }
        if (code === ProgramBinaryCall) {
          return { Op: "call", Register: readRegister(reader), Target: readTarget(reader) };
        }
        if (code === ProgramBinaryLink) {
          return { Op: "link", Register: readRegister(reader), Target: readTarget(reader) };
        }
        if (code === ProgramBinaryJz) {
          return { Op: "jz", Condition: readRegister(reader), Target: readTarget(reader) };
        }
        if (code === ProgramBinaryJnz) {
          return { Op: "jnz", Condition: readRegister(reader), Target: readTarget(reader) };
        }
        if (code === ProgramBinaryPlace) {
          return { Op: "place", Register: readRegister(reader), Data: readImmediate(reader) };
        }
        if (code === ProgramBinaryLoad) {
          return {
            Op: "load",
            Opcode: readOpcode(reader),
            Address: readImmediate(reader),
            Register: readRegister(reader),
          };
        }
        if (code === ProgramBinaryStore) {
          return {
            Op: "store",
            Opcode: readOpcode(reader),
            Address: readImmediate(reader),
            Register: readRegister(reader),
          };
        }
        if (code === ProgramBinaryLdi) {
          return {
            Op: "ldi",
            Opcode: readOpcode(reader),
            Register: readRegister(reader),
            Address: readRegister(reader),
          };
        }
        if (code === ProgramBinarySti) {
          return {
            Op: "sti",
            Opcode: readOpcode(reader),
            Register: readRegister(reader),
            Address: readRegister(reader),
          };
        }
        fail("指令编号无法识别");
      }

      /** 导出或尚未接上的导入。index 在导出上是指令编号，在导入上是要改的那条调用。 */
      export interface ProgramSymbol {
        readonly name: string;
        readonly index: number;
      }

      /** field 0 改数据立即数，1 改跳转编号。addend 是相对 0 号核心窗口或本映像起点的数。 */
      export interface ProgramReloc {
        readonly index: number;
        readonly field: number;
        readonly addend: bigint;
      }

      /**
       * 一次解码的结果。版本 1 的 kind 是 1，三份目录都是空的。
       * kind 2 是动态库，install 必须拒绝，只许 attach 接到已有序列后面。
       */
      export interface ProgramImage {
        readonly steps: CpuInstruction[];
        readonly kind: number;
        readonly symbols: ProgramSymbol[];
        readonly imports: ProgramSymbol[];
        readonly relocs: ProgramReloc[];
      }

      const LinkNameMax = 64;
      const LinkExportMax = 256;
      const LinkImportMax = 256;
      const LinkRelocMax = 4096;

      function readU16(reader: Reader): number {
        if (reader.at + 2 > reader.end) {
          fail("程序二进制在链接目录处结束");
        }
        const value = reader.view.getUint16(reader.at, true);
        reader.at += 2;
        return value;
      }

      function readU32(reader: Reader): number {
        if (reader.at + 4 > reader.end) {
          fail("程序二进制在链接目录处结束");
        }
        const value = reader.view.getUint32(reader.at, true);
        reader.at += 4;
        return value;
      }

      function readI64(reader: Reader): bigint {
        if (reader.at + 8 > reader.end) {
          fail("程序二进制在链接目录处结束");
        }
        const value = reader.view.getBigInt64(reader.at, true);
        reader.at += 8;
        return value;
      }

      function readSymbolName(reader: Reader): string {
        const length = readByte(reader);
        if (length < 1 || length > LinkNameMax) {
          fail("符号名超出范围");
        }
        let name = "";
        for (let index = 0; index < length; index += 1) {
          const byte = readByte(reader);
          if (byte < 0x21 || byte > 0x7e) {
            fail("符号名超出范围");
          }
          name += String.fromCharCode(byte);
        }
        return name;
      }

      function readSymbols(reader: Reader, count: number, limit: number, steps: number): ProgramSymbol[] {
        if (count > limit) {
          fail("符号太多");
        }
        const items: ProgramSymbol[] = [];
        for (let index = 0; index < count; index += 1) {
          const name = readSymbolName(reader);
          const site = readU32(reader);
          if (site >= steps) {
            fail("符号编号越出这段指令");
          }
          items.push({ name, index: site });
        }
        return items;
      }

      function readLink(reader: Reader, steps: number): Pick<ProgramImage, "kind" | "symbols" | "imports" | "relocs"> {
        const kind = readU16(reader);
        const flags = readU16(reader);
        if ((kind !== 1 && kind !== 2) || flags !== 0) {
          fail("程序映像种类无法识别");
        }
        const exportCount = readU32(reader);
        const importCount = readU32(reader);
        const relocCount = readU32(reader);
        const symbols = readSymbols(reader, exportCount, LinkExportMax, steps);
        const imports = readSymbols(reader, importCount, LinkImportMax, steps);
        if (relocCount > LinkRelocMax) {
          fail("重定位太多");
        }
        const relocs: ProgramReloc[] = [];
        for (let index = 0; index < relocCount; index += 1) {
          const site = readU32(reader);
          const field = readByte(reader);
          const pad = readByte(reader);
          const addend = readI64(reader);
          if (site >= steps || (field !== 0 && field !== 1) || pad !== 0) {
            fail("重定位无法识别");
          }
          relocs.push({ index: site, field, addend });
        }
        return { kind, symbols, imports, relocs };
      }

      /**
       * 读回指令和链接目录。版本 1 没有目录，读完必须正好用尽字节。
       * 版本 2 把目录读完，多出来的尾巴同样拒绝。
       */
      export function decodeProgramImage(bytes: Uint8Array): ProgramImage {
        if (!isProgramBinary(bytes)) {
          fail("不是程序二进制");
        }
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const version = view.getUint16(4, true);
        const endian = view.getUint16(6, true);
        if (version !== ProgramBinaryVersion && version !== ProgramBinaryVersionLink) {
          fail("程序二进制版本无法识别");
        }
        if (endian !== ProgramBinaryLittleEndian) {
          fail("程序二进制不是小端");
        }
        const count = view.getUint32(8, true);
        const reader: Reader = { view, at: 12, end: bytes.byteLength };
        const steps: CpuInstruction[] = [];
        for (let index = 0; index < count; index += 1) {
          steps.push(readOne(reader));
        }
        if (version === ProgramBinaryVersion) {
          if (reader.at !== reader.end) {
            fail("程序二进制还有没读完的字节");
          }
          return { steps, kind: 1, symbols: [], imports: [], relocs: [] };
        }
        const link = readLink(reader, steps.length);
        if (reader.at !== reader.end) {
          fail("程序二进制还有没读完的字节");
        }
        return { steps, kind: link.kind, symbols: link.symbols, imports: link.imports, relocs: link.relocs };
      }

      /** 只要指令。版本 2 的目录由 decodeProgramImage 交给装入和接入。 */
      export function decodeProgramBinary(bytes: Uint8Array): CpuInstruction[] {
        return decodeProgramImage(bytes).steps;
      }
    }
  }
}
