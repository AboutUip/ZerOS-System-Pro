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
import { ZerOS as ConfigRoot } from "../Config/CpuConfig";

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
      const runSequence = RuntimeRoot.Hardware.Cpu.runSequence;
      const startedRun = RuntimeRoot.Hardware.Cpu.startedRun;
      const readRegisters = RuntimeRoot.Hardware.Cpu.readRegisters;
      const clearGate = RuntimeRoot.Hardware.Cpu.clearGate;
      const RelocateSlotBits = ConfigRoot.Hardware.Cpu.Config.RelocateSlotBits;
      const RelocateDataFloor = ConfigRoot.Hardware.Cpu.Config.RelocateDataFloor;
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
          "install r1, r2, r3",
          "attach r0, r1, r2, r3",
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

      /**
       * 把一小段映像写进 0 号核心已经握住的堆，装到 1 号核心，再 Schedule。
       * 1 号核心应停着，寄存器先被清零，跑完后 r2 是 42。
       * 对自己装入必须失败，并且不能改掉 1 号核心已经留下的结果。
       */
      async function checkInstall(): Promise<void> {
        if (declaredCount() < 2) {
          return;
        }
        const imageLines = ["place r2, 42", "halt"];
        const image: InstructionRoot.Hardware.Cpu.CpuInstruction[] = [];
        for (const line of imageLines) {
          const step = parseCpuInstruction(line);
          if (step === null) {
            fail("装入样例是空的");
          }
          image.push(step);
        }
        const bytes = encodeProgramBinary(image);
        const base = 6800000;
        const lines: string[] = [];
        for (let index = 0; index < bytes.length; index += 1) {
          lines.push(`place r3, ${String(bytes[index] ?? 0)}`);
          lines.push(`store.octet r3, ${String(base + index * 8)}`);
        }
        lines.push("place r1, 1");
        lines.push(`place r2, ${String(base)}`);
        lines.push(`place r3, ${String(bytes.length)}`);
        lines.push("install r1, r2, r3");
        lines.push("halt");
        const steps: InstructionRoot.Hardware.Cpu.CpuInstruction[] = [];
        for (const line of lines) {
          const step = parseCpuInstruction(line);
          if (step === null) {
            fail("装入程序是空的");
          }
          steps.push(step);
        }
        const guest = await runGuest(0, steps);
        if (!guest.Ok) {
          fail(`装入没有完成 ${guest.Message}`);
        }
        if (coreState(1) !== CoreStateHalted) {
          fail("装入后目标不是停止");
        }
        const cleared = await readRegisters(1);
        if (cleared[2] !== 0n) {
          fail("装入没有把寄存器清零");
        }
        schedule(1);
        await startedRun(1);
        if (coreState(1) !== CoreStateHalted) {
          fail("装入的程序没有停");
        }
        const ran = await readRegisters(1);
        if (ran[2] !== 42n) {
          fail("装入的程序没有在目标核心上执行");
        }
        const refusedLines = ["place r1, 0", "place r2, 0", "place r3, 1", "install r1, r2, r3", "halt"];
        const refused: InstructionRoot.Hardware.Cpu.CpuInstruction[] = [];
        for (const line of refusedLines) {
          const step = parseCpuInstruction(line);
          if (step === null) {
            fail("拒绝样例是空的");
          }
          refused.push(step);
        }
        const denied = await runGuest(0, refused);
        if (denied.Ok || !denied.Message.includes("install")) {
          fail("对自己装入仍然成功了");
        }
        const kept = await readRegisters(1);
        if (kept[2] !== 42n || coreState(1) !== CoreStateHalted) {
          fail("失败的装入改动了目标核心");
        }
      }

      function linesOf(lines: readonly string[]): InstructionRoot.Hardware.Cpu.CpuInstruction[] {
        const steps: InstructionRoot.Hardware.Cpu.CpuInstruction[] = [];
        for (const line of lines) {
          const step = parseCpuInstruction(line);
          if (step === null) {
            fail(`样例无法解析 ${line}`);
          }
          steps.push(step);
        }
        return steps;
      }

      /**
       * 时间片到了就停在下一条，寄存器还在。再次调度从那里继续。
       */
      async function checkSlice(): Promise<void> {
        const steps = linesOf([
          "place r1, 2",
          "slice r1",
          "place r2, 1",
          "place r2, 2",
          "place r2, 3",
          "halt",
        ]);
        try {
          const guest = await runGuest(0, steps);
          if (!guest.Ok || guest.Registers[2] !== 2n || coreState(0) !== CoreStateHalted) {
            fail(`时间片没有停在第二条赋值 ${guest.Message}`);
          }
          /* runGuest 不留下已装入映像，所以从原来的指令继续，而不是走 Schedule。 */
          await runSequence(0, steps);
          const resumed = await readRegisters(0);
          if (resumed[2] !== 3n || coreState(0) !== CoreStateHalted) {
            fail("时间片之后没有从下一条继续");
          }
        } finally {
          const cleared = await runGuest(0, linesOf(["place r1, 0", "slice r1", "halt"]));
          if (!cleared.Ok && coreState(0) !== CoreStateRunning) {
            fail(`时间片没有交还 ${cleared.Message}`);
          }
        }
      }

      /**
       * 版本 2 的目录接在指令后面。种类 2 不能 install。
       * attach 把 add 接到调用后面，数据立即数加上 1 号核心的窗口位移。
       * 第二次同名导出不再加长序列，结果仍是第一次的入口编号。
       */
      async function checkAttach(): Promise<void> {
        if (declaredCount() < 2) {
          return;
        }
        const caller = withLink(
          linesOf(["place r1, 20", "place r2, 22", "link r7, 4", "halt", "halt"]),
          1,
          [],
          [{ name: "add", index: 2 }],
          [],
        );
        const library = withLink(
          linesOf(["add r0, r1, r2", "load.64 r3, 1048576", "jmp r7"]),
          2,
          [{ name: "add", index: 0 }],
          [],
          [{ index: 1, field: 0, addend: 1048576n }],
        );
        const callerBase = 7000000;
        const libraryBase = 7100000;
        const denied = await runGuest(0, [
          ...storeLines(library, libraryBase),
          ...linesOf([
            "place r1, 1",
            `place r2, ${String(libraryBase)}`,
            `place r3, ${String(library.length)}`,
            "install r1, r2, r3",
            "halt",
          ]),
        ]);
        if (denied.Ok || !denied.Message.includes("install")) {
          fail("动态库被整段装入了");
        }
        const kept = await readRegisters(1);
        if (kept[2] !== 42n) {
          fail("失败的动态库装入改动了目标");
        }
        const linked = await runGuest(0, [
          ...storeLines(caller, callerBase),
          ...linesOf([
            "place r1, 1",
            `place r2, ${String(callerBase)}`,
            `place r3, ${String(caller.length)}`,
            "install r1, r2, r3",
            `place r2, ${String(libraryBase)}`,
            `place r3, ${String(library.length)}`,
            "attach r0, r1, r2, r3",
            "place r4, 7",
            "store.64 r4, 9437184",
            "halt",
          ]),
        ]);
        if (!linked.Ok || linked.Registers[0] !== 5n) {
          fail(`接入没有停在导出入口 ${linked.Message}`);
        }
        schedule(1);
        await startedRun(1);
        const ran = await readRegisters(1);
        if (ran[0] !== 42n || ran[3] !== 7n) {
          fail("接入后的调用没有得到和，或数据没有挪到 1 号核心");
        }
        const again = await runGuest(0, linesOf([
          "place r1, 1",
          `place r2, ${String(libraryBase)}`,
          `place r3, ${String(library.length)}`,
          "attach r0, r1, r2, r3",
          "halt",
        ]));
        if (!again.Ok || again.Registers[0] !== 5n) {
          fail(`重复接入改了入口 ${again.Message}`);
        }
      }

      /**
       * 版本 2 种类 1 在清寄存器之前改立即数。
       * 数据加数按 0 号窗口记录，装到 1 号时加上一槽。
       * 跳转加数就是新编号，不再另加起始下标。
       * 对不上的重定位失败，1 号寄存器保持原样。
       */
      async function checkPieInstall(): Promise<void> {
        if (declaredCount() < 2) {
          return;
        }
        const marked = await runGuest(1, linesOf(["place r2, 99", "halt"]));
        if (!marked.Ok || marked.Registers[2] !== 99n) {
          fail("重定位失败用例没有留下寄存器");
        }
        const bad = withLink(
          linesOf(["add r0, r0, r1", "halt"]),
          1,
          [],
          [],
          [{ index: 0, field: 0, addend: BigInt(RelocateDataFloor) }],
        );
        const badBase = 7200000;
        const refused = await runGuest(0, [
          ...storeLines(bad, badBase),
          ...linesOf([
            "place r1, 1",
            `place r2, ${String(badBase)}`,
            `place r3, ${String(bad.length)}`,
            "install r1, r2, r3",
            "halt",
          ]),
        ]);
        if (refused.Ok || !refused.Message.includes("install")) {
          fail("对不上的数据重定位仍然装入了");
        }
        const kept = await readRegisters(1);
        if (kept[2] !== 99n) {
          fail("失败的重定位清掉了目标寄存器");
        }
        const home = RelocateDataFloor + RelocateSlotBits;
        const planted = await runGuest(0, linesOf([
          "place r4, 62",
          `store.64 r4, ${String(home)}`,
          "halt",
        ]));
        if (!planted.Ok || planted.Registers[4] !== 62n) {
          fail("窗口样例没有写进寄存器");
        }
        const image = withLink(
          linesOf([
            "load.64 r0, 1048576",
            "place r1, 0",
            "jz r1, 9",
            "place r2, 5",
            "halt",
          ]),
          1,
          [],
          [],
          [
            { index: 0, field: 0, addend: BigInt(RelocateDataFloor) },
            { index: 2, field: 1, addend: 4n },
          ],
        );
        const imageBase = 7300000;
        const linked = await runGuest(0, [
          ...storeLines(image, imageBase),
          ...linesOf([
            "place r1, 1",
            `place r2, ${String(imageBase)}`,
            `place r3, ${String(image.length)}`,
            "install r1, r2, r3",
            "halt",
          ]),
        ]);
        if (!linked.Ok) {
          fail(`可重定位装入失败 ${linked.Message}`);
        }
        schedule(1);
        await startedRun(1);
        const ran = await readRegisters(1);
        if (ran[0] !== 62n || ran[2] !== 0n) {
          fail("数据立即数没有挪到 1 号核心，或跳转没有改到序列末尾");
        }
        const cleared = await runGuest(0, linesOf([
          "place r4, 0",
          `store.64 r4, ${String(home)}`,
          "halt",
        ]));
        if (!cleared.Ok) {
          fail("窗口样例没有清掉");
        }
      }

      function storeLines(bytes: Uint8Array, base: number): InstructionRoot.Hardware.Cpu.CpuInstruction[] {
        const lines: string[] = [];
        for (let index = 0; index < bytes.length; index += 1) {
          lines.push(`place r3, ${String(bytes[index] ?? 0)}`);
          lines.push(`store.octet r3, ${String(base + index * 8)}`);
        }
        return linesOf(lines);
      }

      function withLink(
        steps: readonly InstructionRoot.Hardware.Cpu.CpuInstruction[],
        kind: number,
        symbols: readonly { readonly name: string; readonly index: number }[],
        imports: readonly { readonly name: string; readonly index: number }[],
        relocs: readonly { readonly index: number; readonly field: number; readonly addend: bigint }[],
      ): Uint8Array {
        const raw = encodeProgramBinary(steps);
        let trailer = 16;
        for (const item of symbols) {
          trailer += 1 + item.name.length + 4;
        }
        for (const item of imports) {
          trailer += 1 + item.name.length + 4;
        }
        trailer += relocs.length * 14;
        const bytes = new Uint8Array(raw.length + trailer);
        bytes.set(raw);
        bytes[4] = 2;
        const view = new DataView(bytes.buffer);
        let at = raw.length;
        view.setUint16(at, kind, true);
        at += 2;
        view.setUint16(at, 0, true);
        at += 2;
        view.setUint32(at, symbols.length, true);
        at += 4;
        view.setUint32(at, imports.length, true);
        at += 4;
        view.setUint32(at, relocs.length, true);
        at += 4;
        const writeName = (name: string, index: number): void => {
          view.setUint8(at, name.length);
          at += 1;
          for (let cursor = 0; cursor < name.length; cursor += 1) {
            view.setUint8(at, name.charCodeAt(cursor));
            at += 1;
          }
          view.setUint32(at, index, true);
          at += 4;
        };
        for (const item of symbols) {
          writeName(item.name, item.index);
        }
        for (const item of imports) {
          writeName(item.name, item.index);
        }
        for (const item of relocs) {
          view.setUint32(at, item.index, true);
          at += 4;
          view.setUint8(at, item.field);
          at += 1;
          view.setUint8(at, 0);
          at += 1;
          view.setBigInt64(at, item.addend, true);
          at += 8;
        }
        return bytes;
      }

      /**
       * 监督核划定范围之后，范围外的写入失败。测完把范围放开，并交还监督核。
       */
      async function checkBound(): Promise<void> {
        if (declaredCount() < 2) {
          return;
        }
        try {
          const opened = await runGuest(0, linesOf([
            "gate",
            "place r1, 1",
            "place r2, 0",
            "place r3, 8",
            "bound r1, r2, r3",
            "halt",
          ]));
          if (!opened.Ok) {
            fail(`划定范围失败 ${opened.Message}`);
          }
          const denied = await runGuest(1, linesOf([
            "place r1, 1",
            "store.octet r1, 64",
            "halt",
          ]));
          if (denied.Ok || !denied.Message.includes("bound")) {
            fail("范围外的写入仍然成功");
          }
          const restored = await runGuest(0, linesOf([
            "place r1, 1",
            "place r2, 0",
            "place r3, 134217728",
            "bound r1, r2, r3",
            "gate",
            "halt",
          ]));
          if (restored.Ok || !restored.Message.includes("gate")) {
            fail("第二个监督核仍然成功");
          }
        } finally {
          clearGate();
        }
      }

      export async function runCpuRegisterCheck(): Promise<void> {
        await checkProgramBinary();
        await checkInstall();
        await checkSlice();
        await checkBound();
        await checkAttach();
        await checkPieInstall();
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
