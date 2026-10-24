/**
 * @module ZerOS.Hardware.Cpu.CpuSelfCheck
 * @description CPU 在核心挂载之后的自检
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 核对已挂载核心的停止状态、调度和保持位，再核对寄存器与一次访存。
 * 寄存器核对之前，还会跑直循环、用户核失败、系统调用恢复和上下文槽。
 * 那些核对各自交还核心。自检结束时 0 号核心回到停止。写过的内存八位组恢复为 0。
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
import { ZerOS as StraightRoot } from "./LocalStraightCheck";
import { ZerOS as UserFaultRoot } from "./UserFaultCheck";
import { ZerOS as SyscallResumeRoot } from "./SyscallResumeCheck";
import { ZerOS as ContextSlotRoot } from "./ContextSlotCheck";
import { ZerOS as FaultDeliveryRoot } from "./FaultDeliveryCheck";
import { ZerOS as FaultFrameRoot } from "./FaultFrameCheck";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      const CoreStateHalted = StateRoot.Hardware.Cpu.CoreStateHalted;
      const CoreStateRunning = StateRoot.Hardware.Cpu.CoreStateRunning;
      const declaredCount = RuntimeRoot.Hardware.Cpu.declaredCount;
      const coreState = RuntimeRoot.Hardware.Cpu.coreState;
      const schedule = RuntimeRoot.Hardware.Cpu.schedule;
      const halt = RuntimeRoot.Hardware.Cpu.halt;
      const restoreMounted = RuntimeRoot.Hardware.Cpu.restoreMounted;
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
      const runLocalStraightCheck = StraightRoot.Hardware.Cpu.runLocalStraightCheck;
      const runUserFaultCheck = UserFaultRoot.Hardware.Cpu.runUserFaultCheck;
      const runSyscallResumeCheck = SyscallResumeRoot.Hardware.Cpu.runSyscallResumeCheck;
      const runContextSlotCheck = ContextSlotRoot.Hardware.Cpu.runContextSlotCheck;
      const runFaultDeliveryCheck = FaultDeliveryRoot.Hardware.Cpu.runFaultDeliveryCheck;
      const runFaultFrameCheck = FaultFrameRoot.Hardware.Cpu.runFaultFrameCheck;
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
          fail("the core count has not been declared");
        }
        for (let ordinal = 0; ordinal < count; ordinal += 1) {
          if (coreState(ordinal) !== CoreStateHalted) {
            fail("a newly mounted core was not halted");
          }
        }
        schedule(0);
        if (coreState(0) !== CoreStateRunning) {
          fail("the core was still not running after schedule");
        }
        halt(0);
        if (coreState(0) !== CoreStateHalted) {
          fail("the core was still running after halt");
        }
        if (count >= 2) {
          pass(0, 1, 7n);
          if (take(1) !== 7n) {
            fail("the latch value is not the integer that was passed");
          }
          let emptyRejected = false;
          try {
            take(1);
          } catch {
            emptyRejected = true;
          }
          if (!emptyRejected) {
            fail("an empty latch was still taken");
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
          "dwell r1",
        ];
        const parsed: InstructionRoot.Hardware.Cpu.CpuInstruction[] = [];
        for (const line of lines) {
          const step = parseCpuInstruction(line);
          if (step === null) {
            fail("the sample program is empty");
          }
          parsed.push(step);
        }
        const decoded = decodeProgramBinary(encodeProgramBinary(parsed));
        if (decoded.length !== parsed.length) {
          fail("the binary instruction count does not match the source");
        }
        for (let index = 0; index < parsed.length; index += 1) {
          const before = parsed[index];
          const after = decoded[index];
          if (before === undefined || after === undefined) {
            fail("the binary is missing an instruction");
          }
          if (formatCpuInstruction(before) !== formatCpuInstruction(after)) {
            fail("the binary decoded to different instructions");
          }
        }
        const guest = await runGuest(0, decoded.slice(0, 4));
        if (!guest.Ok || guest.Registers[2] !== 42n) {
          fail("the core did not execute the program binary");
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
            fail("the install sample is empty");
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
            fail("the installed program is empty");
          }
          steps.push(step);
        }
        const guest = await runGuest(0, steps);
        if (!guest.Ok) {
          fail(`install did not finish ${guest.Message}`);
        }
        if (coreState(1) !== CoreStateHalted) {
          fail("the target was not halted after install");
        }
        const cleared = await readRegisters(1);
        if (cleared[2] !== 0n) {
          fail("install did not clear the registers");
        }
        schedule(1);
        await startedRun(1);
        if (coreState(1) !== CoreStateHalted) {
          fail("the installed program did not halt");
        }
        const ran = await readRegisters(1);
        if (ran[2] !== 42n) {
          fail("the installed program did not run on the target core");
        }
        const refusedLines = ["place r1, 0", "place r2, 0", "place r3, 1", "install r1, r2, r3", "halt"];
        const refused: InstructionRoot.Hardware.Cpu.CpuInstruction[] = [];
        for (const line of refusedLines) {
          const step = parseCpuInstruction(line);
          if (step === null) {
            fail("the rejected sample is empty");
          }
          refused.push(step);
        }
        const denied = await runGuest(0, refused);
        if (denied.Ok || !denied.Message.includes("install")) {
          fail("install onto itself still succeeded");
        }
        const kept = await readRegisters(1);
        if (kept[2] !== 42n || coreState(1) !== CoreStateHalted) {
          fail("a failed install changed the target core");
        }
      }

      function linesOf(lines: readonly string[]): InstructionRoot.Hardware.Cpu.CpuInstruction[] {
        const steps: InstructionRoot.Hardware.Cpu.CpuInstruction[] = [];
        for (const line of lines) {
          const step = parseCpuInstruction(line);
          if (step === null) {
            fail(`sample did not parse ${line}`);
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
            fail(`the time slice did not stop on the second store ${guest.Message}`);
          }
          /* runGuest 不留下已装入映像，所以从原来的指令继续，而不是走 Schedule。 */
          await runSequence(0, steps);
          const resumed = await readRegisters(0);
          if (resumed[2] !== 3n || coreState(0) !== CoreStateHalted) {
            fail("execution did not continue at the next instruction after the slice");
          }
        } finally {
          const cleared = await runGuest(0, linesOf(["place r1, 0", "slice r1", "halt"]));
          if (!cleared.Ok && coreState(0) !== CoreStateRunning) {
            fail(`the time slice was not cleared ${cleared.Message}`);
          }
        }
      }

      /**
       * 0 毫秒马上继续。1 毫秒等完再执行下一条。超过 1000 必须失败，而且不能把后面的赋值做掉。
       */
      async function checkDwell(): Promise<void> {
        const stayed = await runGuest(0, linesOf([
          "place r1, 0",
          "dwell r1",
          "place r2, 5",
          "halt",
        ]));
        if (!stayed.Ok || stayed.Registers[2] !== 5n || coreState(0) !== CoreStateHalted) {
          fail(`dwell 0 did not continue ${stayed.Message}`);
        }
        const waited = await runGuest(0, linesOf([
          "place r1, 1",
          "dwell r1",
          "place r2, 6",
          "halt",
        ]));
        if (!waited.Ok || waited.Registers[2] !== 6n) {
          fail(`dwell 1 did not continue ${waited.Message}`);
        }
        const rejected = await runGuest(0, linesOf([
          "place r1, 1001",
          "dwell r1",
          "place r2, 9",
          "halt",
        ]));
        if (rejected.Ok || !rejected.Message.includes("dwell is outside")) {
          fail(`dwell accepted a millisecond count past 1000 ${rejected.Message}`);
        }
        if (rejected.Registers[2] === 9n) {
          fail("dwell past 1000 still executed the next instruction");
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
          fail("a dynamic library was installed as a whole image");
        }
        const kept = await readRegisters(1);
        if (kept[2] !== 42n) {
          fail("a failed library install changed the target");
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
          fail(`attach did not stop on the exported entry ${linked.Message}`);
        }
        schedule(1);
        await startedRun(1);
        const ran = await readRegisters(1);
        if (ran[0] !== 42n || ran[3] !== 7n) {
          fail("the call after attach did not produce the sum, or the data was not moved to core 1");
        }
        const again = await runGuest(0, linesOf([
          "place r1, 1",
          `place r2, ${String(libraryBase)}`,
          `place r3, ${String(library.length)}`,
          "attach r0, r1, r2, r3",
          "halt",
        ]));
        if (!again.Ok || again.Registers[0] !== 5n) {
          fail(`attaching the same export again changed the entry ${again.Message}`);
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
          fail("the failed relocation case did not leave the registers");
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
          fail("a data relocation that does not match was still installed");
        }
        const kept = await readRegisters(1);
        if (kept[2] !== 99n) {
          fail("a failed relocation cleared the target registers");
        }
        const home = RelocateDataFloor + RelocateSlotBits;
        const planted = await runGuest(0, linesOf([
          "place r4, 62",
          `store.64 r4, ${String(home)}`,
          "halt",
        ]));
        if (!planted.Ok || planted.Registers[4] !== 62n) {
          fail("the window sample was not written into the register");
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
          fail(`relocatable install failed ${linked.Message}`);
        }
        schedule(1);
        await startedRun(1);
        const ran = await readRegisters(1);
        if (ran[0] !== 62n || ran[2] !== 0n) {
          fail("the data immediate was not relocated to core 1, or the jump was not retargeted to the end");
        }
        const cleared = await runGuest(0, linesOf([
          "place r4, 0",
          `store.64 r4, ${String(home)}`,
          "halt",
        ]));
        if (!cleared.Ok) {
          fail("the window sample was not cleared");
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
            fail(`bound failed ${opened.Message}`);
          }
          const denied = await runGuest(1, linesOf([
            "place r1, 1",
            "store.octet r1, 64",
            "halt",
          ]));
          if (denied.Ok || !denied.Message.includes("bound")) {
            fail("a write outside the window still succeeded");
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
            fail("a second supervisor still succeeded");
          }
        } finally {
          clearGate();
        }
      }

      /**
       * 监督核划定另一颗核心之后，那颗核心不能再碰显卡。
       * 运算仍然留下结果。卸下之后交还监督核，避免这颗核心一直停在客核心。
       */
      async function checkGuestPrivilege(): Promise<void> {
        if (declaredCount() < 2) {
          return;
        }
        try {
          const opened = await runGuest(0, linesOf([
            "gate",
            "place r1, 1",
            "place r2, 0",
            "place r3, 64",
            "bound r1, r2, r3",
            "halt",
          ]));
          if (!opened.Ok) {
            fail(`the guest core was not bounded ${opened.Message}`);
          }
          const denied = await runGuest(1, linesOf(["gpu.compose", "halt"]));
          if (denied.Ok || !denied.Message.includes("privileged")) {
            fail(`the guest core still executed a GPU instruction ${denied.Message}`);
          }
          const kept = await runGuest(1, linesOf(["place r1, 0", "dwell r1", "place r2, 7", "halt"]));
          if (!kept.Ok || kept.Registers[2] !== 7n) {
            fail(`the guest core did not keep the arithmetic result ${kept.Message}`);
          }
        } finally {
          await runGuest(0, linesOf(["place r1, 1", "release r1", "halt"]));
          clearGate();
        }
      }

      export async function runCpuRegisterCheck(): Promise<void> {
        await checkProgramBinary();
        await checkInstall();
        await checkSlice();
        await checkDwell();
        await checkBound();
        await checkAttach();
        await checkPieInstall();
        await checkGuestPrivilege();
        await runLocalStraightCheck();
        await runUserFaultCheck();
        await runSyscallResumeCheck();
        await runContextSlotCheck();
        await runFaultDeliveryCheck();
        await runFaultFrameCheck();
        schedule(0);
        const placedLeft = await place(0, 0, 1n);
        const placedRight = await place(0, 1, 2n);
        if (placedLeft.Value !== 1n || placedRight.Value !== 2n) {
          fail("place did not write the integer into the register");
        }
        const sum = await add(0, 2, 0, 1);
        if (sum.Value !== 3n) {
          fail("add was not the exact sum of the two registers");
        }
        await store(0, MemoryOpcodeStoreOctet, 0n, 2);
        try {
          const loaded = await load(0, MemoryOpcodeLoadOctet, 0n, 3);
          if (loaded.Value !== 3n) {
            fail("load did not read back the sum stored from the register");
          }
          await place(0, 0, -2n);
          await place(0, 1, 3n);
          const product = await binary(0, "mul", 2, 0, 1);
          if (product.Value !== -6n) {
            fail("mul was not the exact product");
          }
          await store(0, MemoryOpcodeStore64, 64n, 2);
          const signed = await load(0, MemoryOpcodeLoad64, 64n, 3);
          if (signed.Value !== -6n) {
            fail("load did not read the two's-complement negative back into the register");
          }
          await place(0, 2, 0n);
          await store(0, MemoryOpcodeStore64, 64n, 2);
          await place(0, 0, 0x4000000000000000n);
          await place(0, 1, 0x4008000000000000n);
          const scaled = await binary(0, "fmul", 2, 0, 1);
          if (scaled.Value !== 0x4018000000000000n) {
            fail("float multiply did not produce the binary64 of 6");
          }
          const remainder = await binary(0, "fmod", 2, 0, 1);
          if (remainder.Value !== 0x4000000000000000n) {
            fail("float remainder did not produce the binary64 of 2");
          }
          await place(0, 0, -1n);
          await place(0, 1, 2n);
          const order = await binary(0, "lt", 2, 0, 1);
          if (order.Value !== 1n) {
            fail("lt did not compare the negative in mathematical integer order");
          }
        } finally {
          await place(0, 2, 0n);
          await store(0, MemoryOpcodeStoreOctet, 0n, 2);
          halt(0);
        }
        /* release 把窗口收成 0。装入程序和内核不是客程序，第一条写栈要回到刚挂载。 */
        const mounted = declaredCount();
        for (let ordinal = 1; ordinal < mounted; ordinal += 1) {
          restoreMounted(ordinal);
        }
      }
    }
  }
}
