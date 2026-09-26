/**
 * @module ZerOS.Hardware.Cpu.CpuSelfCheck
 * @description CPU 在核心挂载之后的自检
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 核对已挂载核心的停止状态、调度和保持位，再核对寄存器与一次访存。
 * 自检结束时 0 号核心回到停止。写过的内存八位组恢复为 0。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. runCpuSelfCheck
 *   3. runCpuRegisterCheck
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as StateRoot } from "../Enum/CoreRunState";
import { ZerOS as RuntimeRoot } from "../Bootstrap/CpuRuntime";
import { ZerOS as OpcodeRoot } from "../../Motherboard/Enum/MemoryOpcode";
import { ZerOS as InstructionRoot } from "../Structure/CpuInstruction";
import { ZerOS as BinaryRoot } from "../Structure/ProgramBinary";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      const CoreStateHalted = StateRoot.Hardware.Cpu.CoreStateHalted;
      const CoreStateRunning = StateRoot.Hardware.Cpu.CoreStateRunning;
      const declaredCount = RuntimeRoot.Hardware.Cpu.declaredCount;
      const coreState = RuntimeRoot.Hardware.Cpu.coreState;
      const schedule = RuntimeRoot.Hardware.Cpu.schedule;
      const halt = RuntimeRoot.Hardware.Cpu.halt;
      const pass = RuntimeRoot.Hardware.Cpu.pass;
      const take = RuntimeRoot.Hardware.Cpu.take;
      const place = RuntimeRoot.Hardware.Cpu.place;
      const add = RuntimeRoot.Hardware.Cpu.add;
      const binary = RuntimeRoot.Hardware.Cpu.binary;
      const load = RuntimeRoot.Hardware.Cpu.load;
      const store = RuntimeRoot.Hardware.Cpu.store;
      const MemoryOpcodeLoadOctet = OpcodeRoot.Hardware.Motherboard.MemoryOpcodeLoadOctet;
      const MemoryOpcodeStoreOctet = OpcodeRoot.Hardware.Motherboard.MemoryOpcodeStoreOctet;
      const MemoryOpcodeLoad64 = OpcodeRoot.Hardware.Motherboard.MemoryOpcodeLoad64;
      const MemoryOpcodeStore64 = OpcodeRoot.Hardware.Motherboard.MemoryOpcodeStore64;
      const parseCpuInstruction = InstructionRoot.Hardware.Cpu.parseCpuInstruction;
      const formatCpuInstruction = InstructionRoot.Hardware.Cpu.formatCpuInstruction;
      const encodeProgramBinary = BinaryRoot.Hardware.Cpu.encodeProgramBinary;
      const decodeProgramBinary = BinaryRoot.Hardware.Cpu.decodeProgramBinary;
      const runGuest = RuntimeRoot.Hardware.Cpu.runGuest;
      const checkPrefix = "[ZerOS.Hardware.Cpu.CpuSelfCheck]";

      function fail(message: string): never {
        throw new Error(`${checkPrefix} ${message}`);
      }

      /**
       * 核心已经全部挂上之后调用。
       * 单核实现只检查调度和停止。两个及以上核心再检查一次传递。
       */
      export function runCpuSelfCheck(): void {
        const count = declaredCount();
        if (count < 1) {
          fail("还没有声明核心数");
        }
        for (let ordinal = 0; ordinal < count; ordinal += 1) {
          if (coreState(ordinal) !== CoreStateHalted) {
            fail("新挂上的核心不是停止状态");
          }
        }
        schedule(0);
        if (coreState(0) !== CoreStateRunning) {
          fail("调度之后核心仍不在执行中");
        }
        halt(0);
        if (coreState(0) !== CoreStateHalted) {
          fail("停止之后核心仍在执行中");
        }
        if (count >= 2) {
          pass(0, 1, 7n);
          if (take(1) !== 7n) {
            fail("保持位取出的值不是放进去的那个整数");
          }
          let emptyRejected = false;
          try {
            take(1);
          } catch {
            emptyRejected = true;
          }
          if (!emptyRejected) {
            fail("空的保持位仍然被取走");
          }
        }
      }

      /**
       * 0 号核心在调用前处于停止。这里把它调起来。
       * place 两个整数，相加后写入内存，再读回，最后把该八位组恢复为 0。
       */
      /**
       * 二进制往返必须和助记符解析得到同一条指令，并且核心能直接执行解码结果。
       * 大立即数覆盖不小于 2^63 的那一档，避免和负数补码混在一起。
       */
      async function checkProgramBinary(): Promise<void> {
        const lines = [
          "place r0, 20",
          "place r1, 22",
          "add r2, r0, r1",
          "halt",
          "place r3, 9223372036854775808",
          "load.64 r4, 1048576",
          "jz r0, 3",
        ];
        const parsed: InstructionRoot.Hardware.Cpu.CpuInstruction[] = [];
        for (const line of lines) {
          const step = parseCpuInstruction(line);
          if (step === null) {
            fail("样例指令是空的");
          }
          parsed.push(step);
        }
        const decoded = decodeProgramBinary(encodeProgramBinary(parsed));
        if (decoded.length !== parsed.length) {
          fail("程序二进制的条数和原文不一致");
        }
        for (let index = 0; index < parsed.length; index += 1) {
          const before = parsed[index];
          const after = decoded[index];
          if (before === undefined || after === undefined) {
            fail("程序二进制缺了一条");
          }
          if (formatCpuInstruction(before) !== formatCpuInstruction(after)) {
            fail("程序二进制读回的指令和原文不一致");
          }
        }
        const guest = await runGuest(0, decoded.slice(0, 4));
        if (!guest.Ok || guest.Registers[2] !== 42n) {
          fail("核心没有直接执行程序二进制");
        }
      }

      export async function runCpuRegisterCheck(): Promise<void> {
        await checkProgramBinary();
        schedule(0);
        const placedLeft = await place(0, 0, 1n);
        const placedRight = await place(0, 1, 2n);
        if (placedLeft.Value !== 1n || placedRight.Value !== 2n) {
          fail("Place 没有把整数写入寄存器");
        }
        const sum = await add(0, 2, 0, 1);
        if (sum.Value !== 3n) {
          fail("Add 的和不是两个寄存器的精确相加");
        }
        await store(0, MemoryOpcodeStoreOctet, 0n, 2);
        try {
          const loaded = await load(0, MemoryOpcodeLoadOctet, 0n, 3);
          if (loaded.Value !== 3n) {
            fail("Load 读回的八位组不是寄存器里存进去的和");
          }
          await place(0, 0, -2n);
          await place(0, 1, 3n);
          const product = await binary(0, "mul", 2, 0, 1);
          if (product.Value !== -6n) {
            fail("Mul 的积不是精确相乘");
          }
          await store(0, MemoryOpcodeStore64, 64n, 2);
          const signed = await load(0, MemoryOpcodeLoad64, 64n, 3);
          if (signed.Value !== -6n) {
            fail("Load 没有把补码负数读回寄存器");
          }
          await place(0, 2, 0n);
          await store(0, MemoryOpcodeStore64, 64n, 2);
          await place(0, 0, 0x4000000000000000n);
          await place(0, 1, 0x4008000000000000n);
          const scaled = await binary(0, "fmul", 2, 0, 1);
          if (scaled.Value !== 0x4018000000000000n) {
            fail("浮点乘法没有得到 6 的二进制 64 位型");
          }
          const remainder = await binary(0, "fmod", 2, 0, 1);
          if (remainder.Value !== 0x4000000000000000n) {
            fail("浮点取模没有得到 2 的二进制 64 位型");
          }
          await place(0, 0, -1n);
          await place(0, 1, 2n);
          const order = await binary(0, "lt", 2, 0, 1);
          if (order.Value !== 1n) {
            fail("Lt 没有按数学整数序比较负数");
          }
        } finally {
          await place(0, 2, 0n);
          await store(0, MemoryOpcodeStoreOctet, 0n, 2);
          halt(0);
        }
      }
    }
  }
}
