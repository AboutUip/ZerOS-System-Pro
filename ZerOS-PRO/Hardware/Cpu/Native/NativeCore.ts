/**
 * @module ZerOS.Hardware.Cpu.NativeCore
 * @description 在一颗核心的线性位元上跑原生指令
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 指令字节先经这颗核心写入，再读回来执行。
 * 0F 3F 的监督、保持位和系统调用在这里直接完成，不编成 ZAP 指令。
 * 不替换这颗核心上的 ZAP 寄存器。普通停机后核心停止。系统调用期间核心保持执行中。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 访存
 *   3. 执行
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as ConfigRoot } from "../Config/CpuConfig";
import { ZerOS as MailboxRoot } from "../../Motherboard/Host/Mailbox";
import { ZerOS as EscapeRoot } from "../Enum/NativeEscape";
import { ZerOS as RegisterRoot } from "../Enum/NativeRegister";
import { ZerOS as CompatRoot } from "../Structure/CompatFrame";
import { ZerOS as NativeRoot } from "../Native/NativeRun";
import { ZerOS as OpcodeRoot } from "../../Motherboard/Enum/MemoryOpcode";
import { ZerOS as RuntimeRoot } from "../Bootstrap/CpuRuntime";
import { ZerOS as TracePageRoot } from "../../Diagnostics/Host/TracePage";
import { ZerOS as TraceOpRoot } from "../../Diagnostics/Enum/TraceOp";
import type { ZerOS as StateRoot } from "../Structure/NativeState";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      const RelocateDataFloor = ConfigRoot.Hardware.Cpu.Config.RelocateDataFloor;
      const RelocateSlotBits = ConfigRoot.Hardware.Cpu.Config.RelocateSlotBits;
      const MapEndBits = ConfigRoot.Hardware.Cpu.Config.MapEndBits;
      const NativeRax = RegisterRoot.Hardware.Cpu.NativeRax;
      const encodeCompatFrame = CompatRoot.Hardware.Cpu.encodeCompatFrame;
      const applyCompatFrame = CompatRoot.Hardware.Cpu.applyCompatFrame;
      const MailboxSpanBytes = MailboxRoot.Hardware.Motherboard.MailboxSpanBytes;
      const stepNative = NativeRoot.Hardware.Cpu.stepNative;
      const isNativeMiss = NativeRoot.Hardware.Cpu.isNativeMiss;
      const nativeMiss = NativeRoot.Hardware.Cpu.nativeMiss;
      const traceEnabled = TracePageRoot.Hardware.Diagnostics.traceEnabled;
      const traceSpanEvent = TracePageRoot.Hardware.Diagnostics.traceSpanEvent;
      const TraceOp = TraceOpRoot.Hardware.Diagnostics.TraceOp;
      const TraceLayer = TraceOpRoot.Hardware.Diagnostics.TraceLayer;
      const traceParent = RuntimeRoot.Hardware.Cpu.traceParent;
      /** B1 原生采样累计：每 1024 条记一条，不逐条写。 */
      let nativeTraceCarry = 0;
      const NativeInsnStride = 1024;

      /** 原生指令采样。pc 是相对装入基址的八位组偏移，不是绝对位地址。 */
      function noteNativeInsn(ordinal: number, state: NativeState, baseBit: number, count: number): void {
        nativeTraceCarry += count;
        if (nativeTraceCarry < NativeInsnStride) {
          return;
        }
        nativeTraceCarry = 0;
        const pc = Math.floor(Number(state.rip - BigInt(Math.trunc(baseBit))));
        if (!Number.isInteger(pc) || pc < 0) {
          return;
        }
        traceSpanEvent(TraceOp.Insn, TraceLayer.Core, ordinal, traceParent(ordinal), 0, pc, 1);
      }
      const NativeEscapeCore = EscapeRoot.Hardware.Cpu.NativeEscapeCore;
      const NativeEscapeGate = EscapeRoot.Hardware.Cpu.NativeEscapeGate;
      const NativeEscapePass = EscapeRoot.Hardware.Cpu.NativeEscapePass;
      const NativeEscapeTake = EscapeRoot.Hardware.Cpu.NativeEscapeTake;
      const NativeEscapeSvc = EscapeRoot.Hardware.Cpu.NativeEscapeSvc;
      const MemoryOpcodeLoadOctet = OpcodeRoot.Hardware.Motherboard.MemoryOpcodeLoadOctet;
      const MemoryOpcodeStoreOctet = OpcodeRoot.Hardware.Motherboard.MemoryOpcodeStoreOctet;
      const beginNative = RuntimeRoot.Hardware.Cpu.beginNative;
      const endNative = RuntimeRoot.Hardware.Cpu.endNative;
      const adoptNativeFrame = RuntimeRoot.Hardware.Cpu.adoptNativeFrame;
      const noteNativeWindow = RuntimeRoot.Hardware.Cpu.noteNativeWindow;
      const readNativeWindow = RuntimeRoot.Hardware.Cpu.readNativeWindow;
      const readNativeFrame = RuntimeRoot.Hardware.Cpu.readNativeFrame;
      const bindNativeResume = RuntimeRoot.Hardware.Cpu.bindNativeResume;
      const nativeGate = RuntimeRoot.Hardware.Cpu.nativeGate;
      const nativePass = RuntimeRoot.Hardware.Cpu.nativePass;
      const nativeTake = RuntimeRoot.Hardware.Cpu.nativeTake;
      const nativeSvc = RuntimeRoot.Hardware.Cpu.nativeSvc;
      const acceptNativeReply = RuntimeRoot.Hardware.Cpu.acceptNativeReply;
      const nativeReplyPending = RuntimeRoot.Hardware.Cpu.nativeReplyPending;
      const nativeReachedHalt = RuntimeRoot.Hardware.Cpu.nativeReachedHalt;
      const nativeSchedule = RuntimeRoot.Hardware.Cpu.nativeSchedule;
      const nativeRelease = RuntimeRoot.Hardware.Cpu.nativeRelease;
      const nativeBound = RuntimeRoot.Hardware.Cpu.nativeBound;
      const nativeSlice = RuntimeRoot.Hardware.Cpu.nativeSlice;
      const nativeYield = RuntimeRoot.Hardware.Cpu.nativeYield;
      const nativeQuery = RuntimeRoot.Hardware.Cpu.nativeQuery;
      const nativeInstall = RuntimeRoot.Hardware.Cpu.nativeInstall;
      const nativeAdmit = RuntimeRoot.Hardware.Cpu.nativeAdmit;
      const nativeCapture = RuntimeRoot.Hardware.Cpu.nativeCapture;
      const nativeRestore = RuntimeRoot.Hardware.Cpu.nativeRestore;
      const nativeHertz = RuntimeRoot.Hardware.Cpu.nativeHertz;
      const nativeAttach = RuntimeRoot.Hardware.Cpu.nativeAttach;
      const nativePresent = RuntimeRoot.Hardware.Cpu.nativePresent;
      const nativeCharacter = RuntimeRoot.Hardware.Cpu.nativeCharacter;
      const nativeAccel = RuntimeRoot.Hardware.Cpu.nativeAccel;
      const nativeBitAllowed = RuntimeRoot.Hardware.Cpu.nativeBitAllowed;
      const nativeBoundFree = RuntimeRoot.Hardware.Cpu.nativeBoundFree;
      const nativeExchange = RuntimeRoot.Hardware.Cpu.nativeExchange;
      const nativeCarry = RuntimeRoot.Hardware.Cpu.nativeCarry;
      const nativeOffer = RuntimeRoot.Hardware.Cpu.nativeOffer;
      const nativeFill = RuntimeRoot.Hardware.Cpu.nativeFill;
      const nativePortState = RuntimeRoot.Hardware.Cpu.nativePortState;
      const nativePortChar = RuntimeRoot.Hardware.Cpu.nativePortChar;
      const nativePortByte = RuntimeRoot.Hardware.Cpu.nativePortByte;
      const nativeMap = RuntimeRoot.Hardware.Cpu.nativeMap;
      const nativeUnmap = RuntimeRoot.Hardware.Cpu.nativeUnmap;
      const nativeInbox = RuntimeRoot.Hardware.Cpu.nativeInbox;
      const nativeDwell = RuntimeRoot.Hardware.Cpu.nativeDwell;
      const nativeReadSpan = RuntimeRoot.Hardware.Cpu.nativeReadSpan;
      const nativeWriteSpan = RuntimeRoot.Hardware.Cpu.nativeWriteSpan;
      const nativeWriteSpans = RuntimeRoot.Hardware.Cpu.nativeWriteSpans;
      const nativePaceBudget = RuntimeRoot.Hardware.Cpu.nativePaceBudget;
      const nativeChargePace = RuntimeRoot.Hardware.Cpu.nativeChargePace;
      const nativeCoast = RuntimeRoot.Hardware.Cpu.nativeCoast;
      const nativeYieldPace = RuntimeRoot.Hardware.Cpu.nativeYieldPace;
      const nativeGuestBusy = RuntimeRoot.Hardware.Cpu.nativeGuestBusy;
      const nativeGatePending = RuntimeRoot.Hardware.Cpu.nativeGatePending;
      const nativeWaitLatch = RuntimeRoot.Hardware.Cpu.nativeWaitLatch;
      const nativeTerminalLive = RuntimeRoot.Hardware.Cpu.nativeTerminalLive;
      const noteCoreRank = RuntimeRoot.Hardware.Cpu.noteCoreRank;
      const noteSpanBudget = RuntimeRoot.Hardware.Cpu.noteSpanBudget;
      const noteMachineHalt = RuntimeRoot.Hardware.Cpu.noteMachineHalt;
      const nativeAccount = RuntimeRoot.Hardware.Cpu.nativeAccount;
      const enterNativeImage = RuntimeRoot.Hardware.Cpu.enterNativeImage;
      const leaveNativeImage = RuntimeRoot.Hardware.Cpu.leaveNativeImage;
      const finishNativeHalt = RuntimeRoot.Hardware.Cpu.finishNativeHalt;
      const finishNativeYield = RuntimeRoot.Hardware.Cpu.finishNativeYield;
      const readNativeProgram = RuntimeRoot.Hardware.Cpu.readNativeProgram;
      const bindNativeImage = RuntimeRoot.Hardware.Cpu.bindNativeImage;
      const haltCore = RuntimeRoot.Hardware.Cpu.halt;
      const NativeEscapeSchedule = EscapeRoot.Hardware.Cpu.NativeEscapeSchedule;
      const NativeEscapeRelease = EscapeRoot.Hardware.Cpu.NativeEscapeRelease;
      const NativeEscapeBound = EscapeRoot.Hardware.Cpu.NativeEscapeBound;
      const NativeEscapeSlice = EscapeRoot.Hardware.Cpu.NativeEscapeSlice;
      const NativeEscapeYield = EscapeRoot.Hardware.Cpu.NativeEscapeYield;
      const NativeEscapeQuery = EscapeRoot.Hardware.Cpu.NativeEscapeQuery;
      const NativeEscapeInstall = EscapeRoot.Hardware.Cpu.NativeEscapeInstall;
      const NativeEscapeAdmit = EscapeRoot.Hardware.Cpu.NativeEscapeAdmit;
      const NativeEscapeCapture = EscapeRoot.Hardware.Cpu.NativeEscapeCapture;
      const NativeEscapeRestore = EscapeRoot.Hardware.Cpu.NativeEscapeRestore;
      const NativeEscapeHertz = EscapeRoot.Hardware.Cpu.NativeEscapeHertz;
      const NativeEscapeAttach = EscapeRoot.Hardware.Cpu.NativeEscapeAttach;
      const NativeEscapePresent = EscapeRoot.Hardware.Cpu.NativeEscapePresent;
      const NativeEscapeCharacter = EscapeRoot.Hardware.Cpu.NativeEscapeCharacter;
      const NativeEscapeAccel = EscapeRoot.Hardware.Cpu.NativeEscapeAccel;
      const NativeEscapeExchange = EscapeRoot.Hardware.Cpu.NativeEscapeExchange;
      const NativeEscapeCarry = EscapeRoot.Hardware.Cpu.NativeEscapeCarry;
      const NativeEscapeOffer = EscapeRoot.Hardware.Cpu.NativeEscapeOffer;
      const NativeEscapePortState = EscapeRoot.Hardware.Cpu.NativeEscapePortState;
      const NativeEscapePortChar = EscapeRoot.Hardware.Cpu.NativeEscapePortChar;
      const NativeEscapePortByte = EscapeRoot.Hardware.Cpu.NativeEscapePortByte;
      const NativeEscapeMap = EscapeRoot.Hardware.Cpu.NativeEscapeMap;
      const NativeEscapeUnmap = EscapeRoot.Hardware.Cpu.NativeEscapeUnmap;
      const NativeEscapeDwell = EscapeRoot.Hardware.Cpu.NativeEscapeDwell;
      const NativeEscapeInbox = EscapeRoot.Hardware.Cpu.NativeEscapeInbox;
      const NativeEscapeFill = EscapeRoot.Hardware.Cpu.NativeEscapeFill;
      const load = RuntimeRoot.Hardware.Cpu.load;
      const store = RuntimeRoot.Hardware.Cpu.store;
      const place = RuntimeRoot.Hardware.Cpu.place;
      const readRegisters = RuntimeRoot.Hardware.Cpu.readRegisters;
      type NativeState = StateRoot.Hardware.Cpu.NativeState;
      type NativeEscape = StateRoot.Hardware.Cpu.NativeEscape;
      type NativeOctetPort = StateRoot.Hardware.Cpu.NativeOctetPort;
      type NativeStop = StateRoot.Hardware.Cpu.NativeStop;

      /** 代码和栈都放在这 528 个八位组里。栈顶在起点之后 512 个八位组。 */
      const windowOctets = 0x210;

      /** 续跑时从留下的指令指针起读回这么多个八位组，够一条停机指令。 */
      const resumeOctets = 32;

      async function savedRegisters(ordinal: number): Promise<bigint[]> {
        const image = await readRegisters(ordinal);
        return image.slice();
      }

      async function restoreRegisters(ordinal: number, saved: readonly bigint[]): Promise<void> {
        for (let index = 0; index < saved.length; index += 1) {
          const value = saved[index];
          if (value !== undefined) {
            await place(ordinal, index, value);
          }
        }
      }

      async function readOctet(ordinal: number, bit: bigint): Promise<number> {
        await load(ordinal, MemoryOpcodeLoadOctet, bit, 0);
        const image = await readRegisters(ordinal);
        return Number((image[0] ?? 0n) & 0xffn);
      }

      async function writeOctet(ordinal: number, bit: bigint, value: number): Promise<void> {
        await place(ordinal, 0, BigInt(value & 0xff));
        await store(ordinal, MemoryOpcodeStoreOctet, bit, 0);
      }

      /**
       * 经这颗核心读一段八位组。核心必须是停止的，而且没有装入 ZAP 序列。
       * 读完仍停止。ZAP 寄存器恢复成调用前的值。
       */
      export async function readNativeOctets(ordinal: number, bit: bigint, count: number): Promise<Uint8Array> {
        const saved = await savedRegisters(ordinal);
        const out = new Uint8Array(count);
        beginNative(ordinal);
        try {
          for (let index = 0; index < count; index += 1) {
            out[index] = await readOctet(ordinal, bit + BigInt(index) * 8n);
          }
          return out;
        } finally {
          await restoreRegisters(ordinal, saved);
          endNative(ordinal);
        }
      }

      /** 经这颗核心写一段八位组。调用前后都是停止。 */
      export async function writeNativeOctets(ordinal: number, bit: bigint, octets: Uint8Array): Promise<void> {
        const saved = await savedRegisters(ordinal);
        beginNative(ordinal);
        try {
          for (let index = 0; index < octets.length; index += 1) {
            await writeOctet(ordinal, bit + BigInt(index) * 8n, octets[index] ?? 0);
          }
        } finally {
          await restoreRegisters(ordinal, saved);
          endNative(ordinal);
        }
      }

      /** 刚把自己降到一拍一条。1 表示下一条普通指令要睡一个节拍，随后把起点拨回。下标是核心号。 */
      const coastArm = [0, 0, 0, 0, 0, 0, 0, 0];

      /** 取出转义操作数。编号越界或寄存器帧里没有这一格时是空。 */
      function readReg(state: NativeState, regs: readonly number[], index: number): bigint | null {
        const slot = regs[index];
        if (slot === undefined) {
          return null;
        }
        return state.reg[slot] ?? null;
      }

      /**
       * 兼容任务的 0F 05。
       * 帧写到尾区页 0，再以服务号 27 通知监督核。回复寄存器只是把保持位交回去，续跑时改读这帧。
       */
      async function trapCompat(ordinal: number, state: NativeState): Promise<void> {
        await nativeWriteSpan(ordinal, BigInt(MapEndBits), encodeCompatFrame(state));
        nativeSvc(ordinal, 27n, NativeRax);
      }

      /**
       * 做完一条 0F 3F。
       * 成功才把指令指针改到下一条。系统调用留下等待，yield 留下停止。
       * 装入、卸下、划定、抄槽和接入要等访存结束，所以这里是异步的。
       */
      async function applyEscape(
        ordinal: number,
        state: NativeState,
        escape: NativeEscape,
      ): Promise<"cont" | "wait" | "yield" | "fault"> {
        const regs = escape.regs;
        if (escape.opcode === NativeEscapeCore) {
          const dest = regs[0];
          if (dest === undefined) {
            return "fault";
          }
          state.reg[dest] = BigInt(ordinal);
          state.rip = escape.next;
          return "cont";
        }
        if (escape.opcode === NativeEscapeGate) {
          if (!nativeGate(ordinal)) {
            return "fault";
          }
          state.rip = escape.next;
          return "cont";
        }
        if (escape.opcode === NativeEscapePass) {
          const target = readReg(state, regs, 0);
          const data = readReg(state, regs, 1);
          if (target === null || data === null) {
            return "fault";
          }
          nativePass(ordinal, target, data);
          state.rip = escape.next;
          return "cont";
        }
        if (escape.opcode === NativeEscapeTake) {
          const foundIndex = regs[0];
          const valueIndex = regs[1];
          if (foundIndex === undefined || valueIndex === undefined) {
            return "fault";
          }
          const taken = nativeTake(ordinal);
          state.reg[foundIndex] = taken.found;
          state.reg[valueIndex] = taken.value;
          state.rip = escape.next;
          return "cont";
        }
        if (escape.opcode === NativeEscapeSvc) {
          const reply = regs[0];
          const service = readReg(state, regs, 1);
          if (reply === undefined || service === null) {
            return "fault";
          }
          nativeSvc(ordinal, service, reply);
          state.rip = escape.next;
          return "wait";
        }
        if (escape.opcode === NativeEscapeSchedule) {
          const target = readReg(state, regs, 0);
          if (target === null) {
            return "fault";
          }
          nativeSchedule(ordinal, target);
          state.rip = escape.next;
          return "cont";
        }
        if (escape.opcode === NativeEscapeRelease) {
          const target = readReg(state, regs, 0);
          if (target === null) {
            return "fault";
          }
          await nativeRelease(ordinal, target);
          state.rip = escape.next;
          return "cont";
        }
        if (escape.opcode === NativeEscapeBound) {
          const target = readReg(state, regs, 0);
          const origin = readReg(state, regs, 1);
          const length = readReg(state, regs, 2);
          if (target === null || origin === null || length === null) {
            return "fault";
          }
          await nativeBound(ordinal, target, origin, length);
          state.rip = escape.next;
          return "cont";
        }
        if (escape.opcode === NativeEscapeSlice) {
          const count = readReg(state, regs, 0);
          if (count === null) {
            return "fault";
          }
          nativeSlice(ordinal, count);
          state.rip = escape.next;
          return "cont";
        }
        if (escape.opcode === NativeEscapeYield) {
          state.rip = escape.next;
          nativeYield(ordinal);
          return "yield";
        }
        if (escape.opcode === NativeEscapeQuery) {
          const dest = regs[0];
          const seat = readReg(state, regs, 1);
          const field = readReg(state, regs, 2);
          const index = readReg(state, regs, 3);
          if (dest === undefined || seat === null || field === null || index === null) {
            return "fault";
          }
          const value = await nativeQuery(ordinal, seat, field, index);
          state.reg[dest] = value;
          state.rip = escape.next;
          return "cont";
        }
        if (escape.opcode === NativeEscapeInstall) {
          const target = readReg(state, regs, 0);
          const address = readReg(state, regs, 1);
          const length = readReg(state, regs, 2);
          if (target === null || address === null || length === null) {
            return "fault";
          }
          await nativeInstall(ordinal, target, address, length);
          state.rip = escape.next;
          return "cont";
        }
        if (escape.opcode === NativeEscapeAdmit) {
          const target = readReg(state, regs, 0);
          const address = readReg(state, regs, 1);
          const length = readReg(state, regs, 2);
          if (target === null || address === null || length === null) {
            return "fault";
          }
          await nativeAdmit(ordinal, target, address, length);
          state.rip = escape.next;
          return "cont";
        }
        if (escape.opcode === NativeEscapeCapture) {
          const target = readReg(state, regs, 0);
          const slot = readReg(state, regs, 1);
          if (target === null || slot === null) {
            return "fault";
          }
          await nativeCapture(ordinal, target, slot);
          state.rip = escape.next;
          return "cont";
        }
        if (escape.opcode === NativeEscapeRestore) {
          const target = readReg(state, regs, 0);
          const slot = readReg(state, regs, 1);
          if (target === null || slot === null) {
            return "fault";
          }
          await nativeRestore(ordinal, target, slot);
          state.rip = escape.next;
          return "cont";
        }
        if (escape.opcode === NativeEscapeHertz) {
          const target = readReg(state, regs, 0);
          const hertz = readReg(state, regs, 1);
          if (target === null || hertz === null) {
            return "fault";
          }
          nativeHertz(ordinal, target, hertz);
          state.rip = escape.next;
          return "cont";
        }
        if (escape.opcode === NativeEscapeAttach) {
          const dest = regs[0];
          const target = readReg(state, regs, 1);
          const address = readReg(state, regs, 2);
          const length = readReg(state, regs, 3);
          if (dest === undefined || target === null || address === null || length === null) {
            return "fault";
          }
          state.reg[dest] = await nativeAttach(ordinal, target, address, length);
          state.rip = escape.next;
          return "cont";
        }
        if (escape.opcode === NativeEscapePresent) {
          await nativePresent(ordinal);
          state.rip = escape.next;
          return "cont";
        }
        if (escape.opcode === NativeEscapeCharacter) {
          const x = readReg(state, regs, 0);
          const y = readReg(state, regs, 1);
          const code = readReg(state, regs, 2);
          const foreground = readReg(state, regs, 3);
          const background = readReg(state, regs, 4);
          if (x === null || y === null || code === null || foreground === null || background === null) {
            return "fault";
          }
          await nativeCharacter(ordinal, x, y, code, foreground, background);
          state.rip = escape.next;
          return "cont";
        }
        if (escape.opcode === NativeEscapeAccel) {
          const dest = regs[0];
          const operation = readReg(state, regs, 1);
          const a = readReg(state, regs, 2);
          const b = readReg(state, regs, 3);
          const c = readReg(state, regs, 4);
          const d = readReg(state, regs, 5);
          if (dest === undefined || operation === null || a === null || b === null || c === null || d === null) {
            return "fault";
          }
          state.reg[dest] = await nativeAccel(ordinal, operation, a, b, c, d);
          state.rip = escape.next;
          return "cont";
        }
        if (escape.opcode === NativeEscapeExchange) {
          const port = readReg(state, regs, 0);
          const direction = readReg(state, regs, 1);
          const data = readReg(state, regs, 2);
          const dest = regs[2];
          if (port === null || direction === null || data === null || dest === undefined) {
            return "fault";
          }
          state.reg[dest] = await nativeExchange(ordinal, port, direction, data);
          state.rip = escape.next;
          return "cont";
        }
        if (escape.opcode === NativeEscapeCarry) {
          const dest = regs[0];
          const port = readReg(state, regs, 1);
          const handle = readReg(state, regs, 2);
          const offset = readReg(state, regs, 3);
          const address = readReg(state, regs, 4);
          const count = readReg(state, regs, 5);
          if (dest === undefined || port === null || handle === null || offset === null || address === null || count === null) {
            return "fault";
          }
          state.reg[dest] = await nativeCarry(ordinal, port, handle, offset, address, count);
          state.rip = escape.next;
          return "cont";
        }
        if (escape.opcode === NativeEscapeOffer) {
          const dest = regs[0];
          const port = readReg(state, regs, 1);
          const request = readReg(state, regs, 2);
          const length = readReg(state, regs, 3);
          const reply = readReg(state, regs, 4);
          const limit = readReg(state, regs, 5);
          if (dest === undefined || port === null || request === null || length === null || reply === null || limit === null) {
            return "fault";
          }
          state.reg[dest] = await nativeOffer(ordinal, port, request, length, reply, limit);
          state.rip = escape.next;
          return "cont";
        }
        if (escape.opcode === NativeEscapeFill) {
          const dest = regs[0];
          const port = readReg(state, regs, 1);
          const address = readReg(state, regs, 2);
          const count = readReg(state, regs, 3);
          if (dest === undefined || port === null || address === null || count === null) {
            return "fault";
          }
          state.reg[dest] = await nativeFill(ordinal, port, address, count);
          state.rip = escape.next;
          return "cont";
        }
        if (escape.opcode === NativeEscapePortState) {
          const dest = regs[0];
          const port = readReg(state, regs, 1);
          if (dest === undefined || port === null) {
            return "fault";
          }
          state.reg[dest] = await nativePortState(ordinal, port);
          state.rip = escape.next;
          return "cont";
        }
        if (escape.opcode === NativeEscapePortChar) {
          const dest = regs[0];
          const port = readReg(state, regs, 1);
          const offset = readReg(state, regs, 2);
          if (dest === undefined || port === null || offset === null) {
            return "fault";
          }
          state.reg[dest] = await nativePortChar(ordinal, port, offset);
          state.rip = escape.next;
          return "cont";
        }
        if (escape.opcode === NativeEscapePortByte) {
          const dest = regs[0];
          const port = readReg(state, regs, 1);
          const field = readReg(state, regs, 2);
          const offset = readReg(state, regs, 3);
          if (dest === undefined || port === null || field === null || offset === null) {
            return "fault";
          }
          state.reg[dest] = await nativePortByte(ordinal, port, field, offset);
          state.rip = escape.next;
          return "cont";
        }
        if (escape.opcode === NativeEscapeMap) {
          const dest = regs[0];
          const port = readReg(state, regs, 1);
          const handle = readReg(state, regs, 2);
          const length = readReg(state, regs, 3);
          if (dest === undefined || port === null || handle === null || length === null) {
            return "fault";
          }
          state.reg[dest] = await nativeMap(ordinal, port, handle, length);
          state.rip = escape.next;
          return "cont";
        }
        if (escape.opcode === NativeEscapeUnmap) {
          const address = readReg(state, regs, 0);
          const length = readReg(state, regs, 1);
          if (address === null || length === null) {
            return "fault";
          }
          await nativeUnmap(ordinal, address, length);
          state.rip = escape.next;
          return "cont";
        }
        if (escape.opcode === NativeEscapeInbox) {
          const foundIndex = regs[0];
          const valueIndex = regs[1];
          if (foundIndex === undefined || valueIndex === undefined) {
            return "fault";
          }
          const taken = await nativeInbox(ordinal);
          state.reg[foundIndex] = taken.found;
          state.reg[valueIndex] = taken.value;
          state.rip = escape.next;
          return "cont";
        }
        if (escape.opcode === NativeEscapeDwell) {
          const milliseconds = readReg(state, regs, 0);
          if (milliseconds === null) {
            return "fault";
          }
          await nativeDwell(ordinal, milliseconds);
          state.rip = escape.next;
          return "cont";
        }
        return "fault";
      }

      /**
       * 核心已经在执行。
       * preload 有值时先写进线性位元再读回。空则从当前指令指针读回续跑所需的字节。
       * 系统调用会留下执行中；其余结束时核心停止。
       */
      async function runPrepared(
        ordinal: number,
        state: NativeState,
        baseBit: bigint,
        preload: Uint8Array | null,
      ): Promise<NativeStop> {
        const memory = new Uint8Array(windowOctets);
        const dirty = new Uint8Array(windowOctets);
        let saved: readonly bigint[] | null = null;
        let waiting = false;
        try {
          saved = await savedRegisters(ordinal);
          if (preload !== null) {
            memory.set(preload, 0);
            for (let index = 0; index < preload.length; index += 1) {
              await writeOctet(ordinal, baseBit + BigInt(index) * 8n, memory[index] ?? 0);
            }
            for (let index = 0; index < preload.length; index += 1) {
              memory[index] = await readOctet(ordinal, baseBit + BigInt(index) * 8n);
            }
          } else {
            const origin = Number((state.rip - baseBit) / 8n);
            if (!Number.isInteger(origin) || origin < 0 || origin + resumeOctets > windowOctets) {
              return { kind: "fault", state };
            }
            for (let index = 0; index < resumeOctets; index += 1) {
              memory[origin + index] = await readOctet(ordinal, baseBit + BigInt(origin + index) * 8n);
            }
          }
          const port: NativeOctetPort = {
            limitBit: baseBit + BigInt(windowOctets) * 8n,
            load(bit: bigint): number {
              if (bit < baseBit || !nativeBitAllowed(ordinal, bit, 8)) {
                return -1;
              }
              const index = Number((bit - baseBit) / 8n);
              if (!Number.isInteger(index) || index < 0 || index >= windowOctets) {
                return -1;
              }
              return memory[index] ?? 0;
            },
            store(bit: bigint, value: number): void {
              if (bit < baseBit || !nativeBitAllowed(ordinal, bit, 8)) {
                return;
              }
              const index = Number((bit - baseBit) / 8n);
              if (!Number.isInteger(index) || index < 0 || index >= windowOctets) {
                return;
              }
              memory[index] = value;
              dirty[index] = 1;
            },
          };
          let steps = 0;
          let stopped: NativeStop = { kind: "fault", state };
          const tracing = traceEnabled();
          while (steps < 64) {
            steps += 1;
            if (tracing) {
              noteNativeInsn(ordinal, state, Number(baseBit), 1);
            }
            const outcome = stepNative(state, port);
            if (outcome === "halt") {
              nativeReachedHalt(ordinal);
              stopped = { kind: "halt", state };
              break;
            }
            if (outcome === "cont") {
              continue;
            }
            if (outcome === "fault") {
              stopped = { kind: "fault", state };
              break;
            }
            if (outcome === "syscall") {
              waiting = true;
              stopped = { kind: "wait", state };
              await trapCompat(ordinal, state);
              break;
            }
            const applied = await applyEscape(ordinal, state, outcome);
            if (applied === "fault") {
              stopped = { kind: "fault", state };
              break;
            }
            if (applied === "wait") {
              waiting = true;
              stopped = { kind: "wait", state };
              break;
            }
            if (applied === "yield") {
              stopped = { kind: "yield", state };
              break;
            }
          }
          for (let index = 0; index < windowOctets; index += 1) {
            if (dirty[index] === 1) {
              await writeOctet(ordinal, baseBit + BigInt(index) * 8n, memory[index] ?? 0);
            }
          }
          adoptNativeFrame(ordinal, state);
          noteNativeWindow(ordinal, baseBit);
          return stopped;
        } finally {
          if (saved !== null) {
            await restoreRegisters(ordinal, saved);
          }
          if (!waiting) {
            endNative(ordinal);
          }
        }
      }

      /**
       * 把 image 写到 baseBit，读回后再按位地址执行。
       * 停机或失败后核心停止。系统调用则保持执行中，等调度写入回复。
       */
      export async function runNativeOnCore(
        ordinal: number,
        image: Uint8Array,
        state: NativeState,
        baseBit: bigint,
      ): Promise<NativeStop> {
        if (image.length > windowOctets || baseBit % 8n !== 0n) {
          return { kind: "fault", state };
        }
        beginNative(ordinal);
        return runPrepared(ordinal, state, baseBit, image);
      }

      /**
       * 跑装入时抄下的整段原生代码。
       * 取指不看后来的 bound。数据访存先落在这一侧的缓冲里，一条指令成功后再写回。
       * 节拍、抢占和时间片与 ZAP 序列同一套。
       */
      async function runNativeImage(ordinal: number): Promise<void> {
        const program = readNativeProgram(ordinal);
        if (program === null) {
          throw new Error("native image cannot start");
        }
        enterNativeImage(ordinal);
        const state = program.state;
        const code = program.code;
        const base = program.base;
        if (nativeReplyPending(ordinal)) {
          const reply = acceptNativeReply(ordinal);
          if (state.compat) {
            const frameBytes = await nativeReadSpan(ordinal, BigInt(MapEndBits), 152);
            if (!applyCompatFrame(state, frameBytes)) {
              leaveNativeImage(ordinal);
              throw new Error("native syscall cannot resume");
            }
          } else {
            const slot = state.reg[reply.reg];
            if (slot === undefined) {
              leaveNativeImage(ordinal);
              throw new Error("native syscall cannot resume");
            }
            state.reg[reply.reg] = reply.value;
          }
        }
        /*
         * 一页六万多个八位组如果各占一条表项，表会留在老生代。
         * 核心 2 升到 100 MHz 时取指分配很快，垃圾回收会把 CPU 线程停住大约 100 毫秒。
         * 固件的 dwell 排在同一条线程上，设置画面就跟着停。降回 30 Hz 时几乎不再分配，回收也不来。
         * 整页放进一块字节数组，回收不再扫这张大表。频率仍由客程序自己改。
         */
        const pageOctets = 65536n;
        const pageMask = pageOctets - 1n;
        const pageOctetsN = 65536;
        const pageMaskN = 65535;
        /* 页键用安全整数。大整数做键时，每次取数都要散列一个堆对象，监督核的循环会被这截拖住。 */
        const pages = new Map<number, Uint8Array>();
        const sparse = new Map<number, number>();
        const dirty = new Set<number>();
        let waiting = false;
        let hot: Uint8Array | null = null;
        let hotBase = -1;
        const recallNum = (index: number): number | undefined => {
          const lone = sparse.get(index);
          if (lone !== undefined) {
            return lone;
          }
          const local = index - hotBase;
          if (hot !== null && local >= 0 && local < pageOctetsN) {
            return hot[local];
          }
          const base = index & ~pageMaskN;
          const page = pages.get(base);
          if (page === undefined) {
            return undefined;
          }
          hot = page;
          hotBase = base;
          return page[index - base];
        };
        const forgetRange = (address: bigint, count: bigint): void => {
          /* 搬运和填零写在别的核心上。只丢掉这一段，监督核自己的页还留着。
             整份缓冲一起丢掉的话，下一条指令又把六万字节拉回来，一次列目录会重复拉几千兆。 */
          if (count <= 0n || address < 0n) {
            return;
          }
          const start = Number(address / 8n);
          const bytes = Number(count);
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(bytes) || bytes < 1) {
            pages.clear();
            sparse.clear();
            hot = null;
            return;
          }
          const end = start + bytes;
          hot = null;
          for (const key of sparse.keys()) {
            if (key >= start && key < end) {
              sparse.delete(key);
            }
          }
          const first = start & ~pageMaskN;
          const last = (end + pageMaskN) & ~pageMaskN;
          for (let page = first; page < last; page += pageOctetsN) {
            pages.delete(page);
          }
        };
        const recall = (octet: bigint): number | undefined => {
          return recallNum(Number(octet));
        };
        /* 核心 2 的数据起点是 1048576 + 2×268435456。档发布在这之后 49152 位，八个八位组。
           49344 位是内核发布的这一轮消息上限，小端 8 个八位组。颗粒游标占到 49343，再往后才是这个字。 */
        const rankPublishN = 67246080;
        const spanWordN = rankPublishN + 24;
        const keep = (index: number, value: number): void => {
          const stored = value & 0xff;
          if (index >= rankPublishN && index < rankPublishN + 8) {
            noteCoreRank(index - rankPublishN, stored);
          }
          /* 档发布之后的那一个八位组。1 表示 1 号被信号打中，宿主从这里停机。 */
          if (index === rankPublishN + 8) {
            noteMachineHalt(stored);
          }
          const base = index & ~pageMaskN;
          const page = base === hotBase && hot !== null ? hot : pages.get(base);
          if (page !== undefined) {
            hot = page;
            hotBase = base;
            page[index - base] = stored;
            sparse.delete(index);
          } else {
            sparse.set(index, stored);
          }
          dirty.add(index);
          /* 上限字的八个八位组都到了，才把小端的低 32 位交给主板。高位不是 0 就当成还没发布。 */
          if (index >= spanWordN && index < spanWordN + 8) {
            let word = 0;
            let high = false;
            for (let step = 0; step < 8; step += 1) {
              const byte = recallNum(spanWordN + step);
              if (byte === undefined) {
                word = -1;
                break;
              }
              if (step < 4) {
                word += byte << (step * 8);
              } else if (byte !== 0) {
                high = true;
              }
            }
            if (word >= 0) {
              noteSpanBudget(high ? 0 : word);
            }
          }
        };
        const install = (origin: bigint, bytes: Uint8Array): void => {
          const originN = Number(origin);
          hot = null;
          if (bytes.length === pageOctetsN && (originN & pageMaskN) === 0) {
            pages.set(originN, new Uint8Array(bytes));
            const end = originN + pageOctetsN;
            for (const key of sparse.keys()) {
              if (key >= originN && key < end) {
                sparse.delete(key);
              }
            }
            return;
          }
          for (let step = 0; step < bytes.length; step += 1) {
            const octet = originN + step;
            const stored = bytes[step] ?? 0;
            const base = octet & ~pageMaskN;
            const page = pages.get(base);
            if (page !== undefined) {
              page[octet - base] = stored;
              sparse.delete(octet);
            } else {
              sparse.set(octet, stored);
            }
          }
        };
        const sharedOctet = BigInt(RelocateDataFloor) / 8n;
        const flush = async (mailboxOnly = false, onlyPage: bigint | null = null): Promise<void> => {
          if (dirty.size === 0) {
            return;
          }
          /* 连续脏字节收成一段。段与段不相邻时一次消息写回，不再每段等一次主板。
             降频、空转和还没画字形的矩形只送邮箱，数据窗留到取出、调度、查询或字形绘制。
             缺页时只送即将被整页换掉的那一页，别的页继续攒着。
             引导清表的脏字节远超上限，那种调用不会走这条。邮箱每次都送，固件才能看见。 */
          const sharedN = Number(sharedOctet);
          const onlyN = onlyPage === null ? null : Number(onlyPage);
          const pending: number[] = [];
          for (const octet of dirty) {
            if (mailboxOnly && octet >= sharedN) {
              continue;
            }
            if (onlyN !== null && octet >= sharedN && (octet & ~pageMaskN) !== onlyN) {
              continue;
            }
            pending.push(octet);
          }
          if (pending.length === 0) {
            return;
          }
          pending.sort((left, right): number => left - right);
          const addresses: bigint[] = [];
          const parts: Uint8Array[] = [];
          /* 调用还没返回时，相邻的几个字中间常常空着一两个没改的字节。
             这些字节本核心已经有，并进同一段，一次搬运就能带走整条记录。
             没读过的空洞不能用旧值盖掉，仍从这里切开。调用之外不并空洞。 */
          const holeLimit = serving ? 64 : 0;
          let index = 0;
          while (index < pending.length) {
            const origin = pending[index];
            if (origin === undefined) {
              break;
            }
            let end = origin;
            let scan = index;
            while (scan < pending.length && end - origin < MailboxSpanBytes) {
              const key = pending[scan];
              if (key === undefined) {
                break;
              }
              if (key > end) {
                const gap = key - end;
                if (!Number.isSafeInteger(gap) || gap > holeLimit || key - origin >= MailboxSpanBytes) {
                  break;
                }
                let cached = true;
                for (let step = 0; step < gap; step += 1) {
                  if (recallNum(end + step) === undefined) {
                    cached = false;
                    break;
                  }
                }
                if (!cached) {
                  break;
                }
                end = key;
              }
              while (scan < pending.length && pending[scan] === end && end - origin < MailboxSpanBytes) {
                end += 1;
                scan += 1;
              }
            }
            const count = end - origin;
            if (!Number.isSafeInteger(count) || count < 1) {
              break;
            }
            const bytes = new Uint8Array(count);
            for (let step = 0; step < count; step += 1) {
              bytes[step] = recallNum(origin + step) ?? 0;
            }
            addresses.push(BigInt(origin) * 8n);
            parts.push(bytes);
            for (let step = 0; step < count; step += 1) {
              dirty.delete(origin + step);
            }
            index = scan;
          }
          let cursor = 0;
          while (cursor < addresses.length) {
            const end = Math.min(addresses.length, cursor + 128);
            await nativeWriteSpans(ordinal, addresses.slice(cursor, end), parts.slice(cursor, end));
            cursor = end;
          }
        };
        const fill = async (bit: bigint): Promise<void> => {
          /* 只把这一页已经改过的字节送出去。整份脏缓冲一起送的话，每次缺页都会把还没写完的记录切成几十字节。 */
          const dirtyPage = (bit / 8n) & ~pageMask;
          await flush(false, dirtyPage);
          /* 整页都在窗口里才一次读回。窗口边只读错过的那一个八位组，不把窗外的字节带进缓冲。 */
          let page = (bit / 8n) & ~pageMask;
          let count = Number(pageOctets);
          const last = page + pageOctets - 1n;
          if (!nativeBitAllowed(ordinal, page * 8n, 8) || !nativeBitAllowed(ordinal, last * 8n, 8)) {
            page = bit / 8n;
            count = 1;
          }
          install(page, await nativeReadSpan(ordinal, page * 8n, count));
        };
        /* 数据区以下是和固件共用的邮箱。这一拍写回之后丢掉，下一拍才能看见固件刚写的字。
           数据区起点按页对齐，整页要么全在邮箱里，要么全在数据区。 */
        const dropShared = (): void => {
          const sharedN = Number(sharedOctet);
          hot = null;
          for (const key of sparse.keys()) {
            if (key < sharedN) {
              sparse.delete(key);
            }
          }
          for (const key of pages.keys()) {
            if (key < sharedN) {
              pages.delete(key);
            }
          }
        };
        /*
         * 监督核的数据缓冲只可信自己窗口里的字。
         * 客程序的参数写在别的核心的窗口里。上一次系统调用读过的那一页会留在缓冲中，
         * 客程序随后改掉的标志和描述符，下一次取出时仍是旧值。
         * 取出到一条调用后先丢掉窗外的页，分发再读到的就是客程序刚写上的字。
         * 自己窗口里的任务表不丢，那些字已经在取出前写回。
         */
        const ownOctet = (BigInt(RelocateDataFloor) + BigInt(ordinal) * BigInt(RelocateSlotBits)) / 8n;
        const ownEnd = ownOctet + BigInt(RelocateSlotBits) / 8n;
        const ownN = Number(ownOctet);
        const ownEndN = Number(ownEnd);
        const dropForeign = (): void => {
          hot = null;
          for (const key of sparse.keys()) {
            if (key < ownN || key >= ownEndN) {
              sparse.delete(key);
            }
          }
          for (const key of pages.keys()) {
            if (key < ownN || key >= ownEndN) {
              pages.delete(key);
            }
          }
        };
        /*
         * 节拍不足 1 毫秒时不会挂起，所以每拍结束仍要让出一次宏任务。
         * 频率高时一拍的预算能到 10 万条。stepNative 在 CPU 线程上同步做完，墙钟往往是一两百毫秒。
         * 固件的 dwell 和别的核心的定时都排在这条线程上。
         * 这里不改频率。没有系统调用时，墙钟走过 1 毫秒就先记账再让出，100 MHz 仍是 100 MHz。
         * 取出一条调用之后，分发要一次做完。再按 1 毫秒切开，每次让出都要等别的核心排完，
         * 一次分配就会被拉到一百多毫秒。这一段把上限放到 32 毫秒，到了仍让出，客程序才能把回复接走。
         * 主循环回到 hertz 或 core，说明这次调用已经返回，上限收回 1 毫秒，空转不再占住线程。
         */
        let serving = false;
        let sliceMs = 1;
        const sliceCheck = 8;
        /*
         * 平时用消息通道让出，监督核的空转不会每拍都吃掉 4 毫秒。
         * 消息通道会插到定时器前面。终端铺上之后仍只用通道，避免按键路径上堆定时器。
         * 终端还没铺上时，固件的加载圈和设置界面都停在 dwell 上。
         * 通道若完全不让，圆圈画出一帧就停住，字体的网络读也完不成。
         * 这一段大约每 32 毫秒才走一次定时器，其余仍走通道。频率和每拍条数都不改。
         */
        let yieldResume: (() => void) | null = null;
        let timerYieldAt = 0;
        const yieldChannel = new MessageChannel();
        yieldChannel.port1.onmessage = (): void => {
          const resume = yieldResume;
          yieldResume = null;
          if (resume !== null) {
            resume();
          }
        };
        const yieldTurn = (): Promise<void> => {
          /* 终端还没铺上时，大约每 32 毫秒才把队列让给定时器一次。
             固件的 30 Hz 圆圈和字体的网络读仍排得进。
             其余节拍走消息通道。每拍都用定时器的话，宿主会把 0 毫秒抬到大约 4 毫秒，引导就被这截间隙拖住。
             终端铺上之后仍只用通道，避免按键路径上堆定时器。 */
          if (!nativeTerminalLive() && performance.now() - timerYieldAt >= 32) {
            timerYieldAt = performance.now();
            return new Promise((resolve): void => {
              setTimeout(resolve, 0);
            });
          }
          return new Promise((resolve): void => {
            yieldResume = resolve;
            yieldChannel.port2.postMessage(null);
          });
        };
        const baseNum = Number(base);
        const boundFree = nativeBoundFree(ordinal);
        const loadNumber = (bit: number): number => {
          if (bit < 0 || (bit & 7) !== 0) {
            return -1;
          }
          /* 位址会超过 2^31。不能用 >>，那是 32 位有符号移位，核心 1 往后的窗口会落成负数，同一页永远命不中。 */
          const index = (bit - baseNum) / 8;
          if (index >= 0 && index < code.length && Number.isInteger(index)) {
            return code[index] ?? 0;
          }
          if (!boundFree && !nativeBitAllowed(ordinal, BigInt(bit), 8)) {
            return -1;
          }
          const found = recallNum(bit / 8);
          if (found !== undefined) {
            return found;
          }
          throw nativeMiss(BigInt(bit));
        };
        const storeNumber = (bit: number, value: number): void => {
          if (bit < 0 || (bit & 7) !== 0) {
            return;
          }
          if (!boundFree && !nativeBitAllowed(ordinal, BigInt(bit), 8)) {
            return;
          }
          const index = (bit - baseNum) / 8;
          if (index >= 0 && index < code.length && Number.isInteger(index)) {
            code[index] = value & 0xff;
          }
          keep(bit / 8, value);
        };
        const port: NativeOctetPort = {
          limitBit: 1n << 48n,
          loadNumber,
          storeNumber,
          load(bit: bigint): number {
            return loadNumber(Number(bit));
          },
          store(bit: bigint, value: number): void {
            storeNumber(Number(bit), value);
          },
        };
        try {
          if (ordinal >= 0 && ordinal < coastArm.length) {
            coastArm[ordinal] = 0;
          }
          /* 数据窗里已经改过、还没送出的字节。邮箱标志不算，固件要马上看见。 */
          const dataOctets = (): number => {
            let count = 0;
            for (const octet of dirty) {
              if (octet >= sharedOctet) {
                count += 1;
              }
            }
            return count;
          };
          /* 这些出口会让别的核心或设备读刚才写下的字节，必须先整段送出。
             降频、空转和查询只碰邮箱，数据留到回复或下一次这种出口。 */
          const mustExpose = (opcode: number): boolean => {
            return opcode === NativeEscapePass
              || opcode === NativeEscapeSchedule
              || opcode === NativeEscapePresent
              || opcode === NativeEscapeCharacter
              || opcode === NativeEscapeExchange
              || opcode === NativeEscapeCarry
              || opcode === NativeEscapeOffer
              || opcode === NativeEscapeFill
              || opcode === NativeEscapeInstall
              || opcode === NativeEscapeAdmit
              || opcode === NativeEscapeAttach
              || opcode === NativeEscapeCapture
              || opcode === NativeEscapeRestore;
          };
          /* 客程序已经在取指、保持位里又没有新调用：监督核停在这里。
             停在这一拍的末尾再让，前面那 128 条仍会把命令挤成几十毫秒一跳。 */
          const parkForGuest = async (): Promise<boolean> => {
            if (!nativeTerminalLive() || !nativeGuestBusy(ordinal) || nativeGatePending()) {
              return false;
            }
            if (dataOctets() > 0) {
              await flush(false);
            }
            serving = false;
            sliceMs = 1;
            await nativeWaitLatch();
            return true;
          };
          for (;;) {
            if (await parkForGuest()) {
              continue;
            }
            sliceMs = serving ? 32 : 1;
            const budget = nativePaceBudget(ordinal);
            if (budget < 1) {
              await flush();
              dropShared();
              if (nativeAccount(ordinal, 0)) {
                return;
              }
              await yieldTurn();
              continue;
            }
            let ran = 0;
            /* 本拍里已经按旧频率记过的条数。降频指令会先把它们记掉，不能再按新频率记一次。 */
            let billed = 0;
            const sliceAt = performance.now();
            const tracing = traceEnabled();
            while (ran < budget) {
              if (tracing) {
                noteNativeInsn(ordinal, state, baseNum, 1);
              }
              let outcome: ReturnType<typeof stepNative>;
              try {
                outcome = stepNative(state, port);
              } catch (error: unknown) {
                if (!isNativeMiss(error)) {
                  throw error;
                }
                await fill(error.bit);
                if (recall(error.bit / 8n) === undefined) {
                  throw new Error("native instruction failed");
                }
                continue;
              }
              if (outcome === "cont") {
                ran += 1;
                /* 每 8 条才看一次钟。每条都看，会比快指令还贵；隔得再远，慢指令会把这一拍拖过 1 毫秒。 */
                if (ran % sliceCheck === 0 && performance.now() - sliceAt >= sliceMs) {
                  break;
                }
                continue;
              }
              /* 连续的存储先留在本核心。每一拍结束都整段送出的话，一次调用会被切成几十次二十字节的往返。
                 回复、调度、绘制、搬运和装入之前整段送出。打开字体面和画字符串也在这里送，
                 从本核心缓冲抄字体再附在命令上会抄到空页。攒过 64KB 仍马上送，避免脏页无界增长。 */
              let mailboxOnly = false;
              if (typeof outcome === "object") {
                const opcode = outcome.opcode;
                let expose = mustExpose(opcode) || dataOctets() >= 65536;
                if (opcode === NativeEscapeAccel) {
                  const operation = readReg(state, outcome.regs, 1);
                  if (operation === 40n || operation === 42n) {
                    expose = true;
                  }
                }
                const quiet = opcode === NativeEscapeHertz
                  || opcode === NativeEscapeCore
                  || opcode === NativeEscapeQuery
                  || opcode === NativeEscapeDwell
                  || opcode === NativeEscapeInbox
                  || opcode === NativeEscapePortState
                  || opcode === NativeEscapePortChar
                  || opcode === NativeEscapePortByte;
                mailboxOnly = dataOctets() < 65536 && (quiet || !expose);
              }
              await flush(mailboxOnly);
              if (outcome === "halt") {
                finishNativeHalt(ordinal);
                return;
              }
              if (outcome === "fault") {
                throw new Error("native instruction failed");
              }
              if (outcome === "syscall") {
                await flush();
                await trapCompat(ordinal, state);
                waiting = true;
                return;
              }
              /*
               * hertz 改的是下一条起的频率。这一拍里已经跑完的指令仍按改之前的 Hz 记账。
               * 若先改成 30 再把整拍条数乘上 1000/30，监督核空转尾上那几十条会一次睡满大约一秒。
               * 只在目标就是自己时提前记账：改别人的频率不会换掉自己的节拍。
               */
              const lowersSelf = outcome.opcode === NativeEscapeHertz && readReg(state, outcome.regs, 0) === BigInt(ordinal);
              let previousBudget = 0;
              if (lowersSelf) {
                previousBudget = nativePaceBudget(ordinal);
                await nativeChargePace(ordinal, ran);
                billed += ran;
                ran = 0;
              }
              const applied = await applyEscape(ordinal, state, outcome);
              if (lowersSelf && ordinal >= 0 && ordinal < coastArm.length) {
                const nextBudget = nativePaceBudget(ordinal);
                coastArm[ordinal] = previousBudget > 1 && nextBudget === 1 ? 1 : 0;
              }
              if (outcome.opcode === NativeEscapeCarry || outcome.opcode === NativeEscapeFill || outcome.opcode === NativeEscapeOffer) {
                const addressSlot = outcome.opcode === NativeEscapeFill ? 2 : 4;
                const countSlot = outcome.opcode === NativeEscapeFill ? 3 : 5;
                const address = readReg(state, outcome.regs, addressSlot);
                const count = readReg(state, outcome.regs, countSlot);
                if (address === null || count === null) {
                  pages.clear();
                  sparse.clear();
                  hot = null;
                } else {
                  forgetRange(address, count);
                }
              }
              let tookCall = false;
              if (outcome.opcode === NativeEscapeTake) {
                const foundSlot = outcome.regs[0];
                const found = foundSlot === undefined ? 0n : state.reg[foundSlot] ?? 0n;
                if (found === 1n) {
                  dropForeign();
                  /* 调用号已经在寄存器里。分发紧挨着这条 take，不要先让出再做。 */
                  serving = true;
                  sliceMs = 32;
                  tookCall = true;
                }
              }
              /* 主循环尾上的降频和 core 表示这次调用已经走完。下一拍恢复 1 毫秒，把线程还给固件和客程序。 */
              if (outcome.opcode === NativeEscapeHertz || outcome.opcode === NativeEscapeCore) {
                serving = false;
              }
              if (applied === "fault") {
                throw new Error("native instruction failed");
              }
              if (applied === "wait") {
                waiting = true;
                return;
              }
              if (applied === "yield") {
                finishNativeYield(ordinal);
                return;
              }
              if (tookCall && performance.now() - sliceAt < sliceMs) {
                continue;
              }
              /* 查询不离开这一拍。调度每圈要问好几次核心状态，每次都让出会把按键推迟到下一次空转。
                 已经攒下的绘制同样留在这一拍里。一行一次让出，滚屏会把换行拖到好几秒。
                 打开字体面要等编号，不在这里连着做。 */
              if (outcome.opcode === NativeEscapeQuery && performance.now() - sliceAt < sliceMs) {
                continue;
              }
              if (outcome.opcode === NativeEscapeAccel && performance.now() - sliceAt < sliceMs) {
                const operation = readReg(state, outcome.regs, 1);
                if (operation !== 40n) {
                  continue;
                }
              }
              /* 主循环尾上的降频和 core 仍要让出，但同一毫秒里先把这一圈跑完。
                 每条都让出时，定时器会把引导切成几毫秒一截。满一毫秒后下面的 break 仍把线程还给固件。 */
              if (
                (outcome.opcode === NativeEscapeHertz || outcome.opcode === NativeEscapeCore)
                && performance.now() - sliceAt < sliceMs
              ) {
                continue;
              }
              break;
            }
            /* 这一拍被系统调用或查询打断时，数据窗继续留着。
               以前只要这一拍不是被钟截断就会整段送出，相邻的几个字被拆成二十字节一次。
               超过 64KB 仍送，引导清表不会堆在缓冲里。 */
            await flush(dataOctets() < 65536);
            dropShared();
            if (ordinal >= 0 && ordinal < coastArm.length && (coastArm[ordinal] ?? 0) === 1 && ran > 0) {
              /* 降到 30 Hz 之后不再合睡。合睡会把刚做完的调用按住大约 8 毫秒。
                 频率账仍记下，paceYield 把这一拍的条数从睡眠里拿掉，线程接着跑下一条。 */
              nativeYieldPace(ordinal);
              await nativeChargePace(ordinal, ran);
              nativeCoast(ordinal);
              coastArm[ordinal] = 0;
            } else {
              await nativeChargePace(ordinal, ran);
            }
            if (nativeAccount(ordinal, ran + billed)) {
              return;
            }
            /* 客程序正在算时，监督核停在保持位上。空转扫表会把线程从命令手里抢走。
               正在分发时也停：回复已经调度了客程序，再跑完这一圈会把命令挤到下一次降频。
               调用写入保持位后立刻继续。客程序还没跑起来、或正停在调用里时不在这里等，否则没人把调用做完。 */
            if (await parkForGuest()) {
              continue;
            }
            await yieldTurn();
          }
        } catch (error: unknown) {
          if (!waiting) {
            haltCore(ordinal);
          }
          throw error;
        } finally {
          leaveNativeImage(ordinal);
        }
      }

      /**
       * 调度在回复已经放进保持位之后调用。
       * 回复写入原生寄存器，再从留下的位地址继续，直到停机或再一次系统调用。
       */
      async function resumeNative(ordinal: number): Promise<void> {
        const frame = readNativeFrame(ordinal);
        const baseBit = readNativeWindow(ordinal);
        if (frame === null || baseBit === null) {
          throw new Error("native syscall cannot resume");
        }
        if (nativeReplyPending(ordinal)) {
          const reply = acceptNativeReply(ordinal);
          if (frame.reg[reply.reg] === undefined) {
            throw new Error("native syscall cannot resume");
          }
          frame.reg[reply.reg] = reply.value;
        }
        const stopped = await runPrepared(ordinal, frame, baseBit, null);
        if (stopped.kind === "fault") {
          throw new Error("native resume faulted");
        }
      }

      bindNativeResume((ordinal: number): Promise<void> => resumeNative(ordinal));
      bindNativeImage((ordinal: number): Promise<void> => runNativeImage(ordinal));
    }
  }
}
