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
import { ZerOS as MetricRoot } from "../../Motherboard/Host/MetricPage";
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
      const traceInstant = TracePageRoot.Hardware.Diagnostics.traceInstant;
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
      const noteIdleShape = RuntimeRoot.Hardware.Cpu.noteIdleShape;
      const pauseIdleSpin = RuntimeRoot.Hardware.Cpu.pauseIdleSpin;
      const idleSpinning = RuntimeRoot.Hardware.Cpu.idleSpinning;
      const supervisorPoke = RuntimeRoot.Hardware.Cpu.supervisorPoke;
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
      async function trapCompat(ordinal: number, state: NativeState): Promise<boolean> {
        await nativeWriteSpan(ordinal, BigInt(MapEndBits), encodeCompatFrame(state));
        return nativeSvc(ordinal, 27n, NativeRax);
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
          /* 服务 28 的退出码在 native home+128；调试打开时一次读回 8 个八位组。 */
          if (service === 28n && traceEnabled()) {
            const home = readNativeWindow(ordinal);
            if (home !== null) {
              try {
                const bytes = await nativeReadSpan(ordinal, home + 128n, 8);
                let code = 0n;
                for (let index = 0; index < 8; index += 1) {
                  code |= BigInt(bytes[index] ?? 0) << BigInt(index * 8);
                }
                traceInstant(TraceOp.ProcessExit, TraceLayer.Sched, ordinal, Number(code & 0xffffn), 0);
              } catch {
                /* 读不到就保留原有退出路径。 */
              }
            }
          }
          if (!nativeSvc(ordinal, service, reply)) {
            /* 指针留在这条调用上。让出之后监督核先把保持位取走，再调度回来重试。 */
            nativeYield(ordinal);
            return "yield";
          }
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
              const posted = await trapCompat(ordinal, state);
              if (!posted) {
                /* 0F 05 已经走过。退回这两字节，让出后从同一条再试。 */
                state.rip -= 2n;
                nativeYield(ordinal);
                stopped = { kind: "yield", state };
                break;
              }
              waiting = true;
              stopped = { kind: "wait", state };
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
        /* 键盘环在位址 6528 的次数和 6656 起五个槽，到 7296 为止。
           缓存下标是八位组。7296 是引导阶段字，不能算进环里。 */
        const keyRingCount = 6528 / 8;
        const keyRingSlots = 6656 / 8;
        const keyRingSlotsEnd = 7296 / 8;
        const keyRingOctet = (index: number): boolean => {
          if (index >= keyRingCount && index < keyRingCount + 8) {
            return true;
          }
          return index >= keyRingSlots && index < keyRingSlotsEnd;
        };
        /* 页键用安全整数。大整数做键时，每次取数都要散列一个堆对象，监督核的循环会被这截拖住。 */
        const pages = new Map<number, Uint8Array>();
        const sparse = new Map<number, number>();
        const dirty = new Set<number>();
        /** 本核窗口里改过的字节。送邮箱和调度时不走这张表，避免每次按键都扫一遍控制台。 */
        const ownDirty = new Set<number>();
        let waiting = false;
        let hot: Uint8Array | null = null;
        let hotBase = -1;
        const recallNum = (index: number): number | undefined => {
          /* 键盘环由固件写、监督核读。页缓存会把刚发布的次数留成旧值，这一段只认刚读回来的稀疏字节。 */
          if (keyRingOctet(index)) {
            return sparse.get(index);
          }
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
        /* 自己的窗口不进脏表。每次 store 都算一遍大整数会把写出拖慢，这里只算一次。 */
        const ownKeepStart = Number((BigInt(RelocateDataFloor) + BigInt(ordinal) * BigInt(RelocateSlotBits)) / 8n);
        const ownKeepStop = ownKeepStart + Number(BigInt(RelocateSlotBits) / 8n);
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
          if (index >= ownKeepStart && index < ownKeepStop) {
            ownDirty.add(index);
          } else {
            dirty.add(index);
          }
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
        const ownOctet = (BigInt(RelocateDataFloor) + BigInt(ordinal) * BigInt(RelocateSlotBits)) / 8n;
        const ownEnd = ownOctet + BigInt(RelocateSlotBits) / 8n;
        const ownN = Number(ownOctet);
        const ownEndN = Number(ownEnd);
        const flush = async (mailboxOnly = false, onlyPage: bigint | null = null, skipOwn = false): Promise<void> => {
          const includeOwn = !mailboxOnly && !skipOwn;
          if (dirty.size === 0 && (!includeOwn || ownDirty.size === 0)) {
            return;
          }
          /* 连续脏字节收成一段。段与段不相邻时一次消息写回，不再每段等一次主板。
             降频、空转和还没画字形的矩形只送邮箱，数据窗留到取出、调度、查询或字形绘制。
             缺页时只送即将被整页换掉的那一页，别的页继续攒着。
             引导清表的脏字节远超上限，那种调用不会走这条。邮箱每次都送，固件才能看见。 */
          const sharedN = Number(sharedOctet);
          const onlyN = onlyPage === null ? null : Number(onlyPage);
          const pending: number[] = [];
          const collect = (source: Set<number>): void => {
            for (const octet of source) {
              if (mailboxOnly && octet >= sharedN) {
                continue;
              }
              if (skipOwn && octet >= ownN && octet < ownEndN) {
                continue;
              }
              if (onlyN !== null && octet >= sharedN && (octet & ~pageMaskN) !== onlyN) {
                continue;
              }
              pending.push(octet);
            }
          };
          collect(dirty);
          if (includeOwn) {
            collect(ownDirty);
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
              const key = origin + step;
              dirty.delete(key);
              ownDirty.delete(key);
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
        /* 环的通知已经到了，但这一圈读到的次数还没比上次更大。
           读环返回真时，主循环自己记下次数已经前进。 */
        let ringUnseen = false;
        let ringAdvanced = false;
        let lastRingCount = -1;
        const fill = async (bit: bigint): Promise<boolean> => {
          const octet = Number(bit / 8n);
          if (keyRingOctet(octet)) {
            /* 次数、栅栏和五个槽一起读。一次只读一个字的话，conPump 要来回三四趟，一字节就要二十多毫秒。 */
            const ringBytes = 104;
            const bytes = await nativeReadSpan(ordinal, 6528n, ringBytes);
            const base = 6528 / 8;
            const width = bytes.length < ringBytes ? bytes.length : ringBytes;
            for (let step = 0; step < width; step += 1) {
              sparse.set(base + step, bytes[step] ?? 0);
            }
            /* 6528 是写入次数。通知已经到了而次数没变，就不能睡。 */
            if (bytes.length >= 4) {
              let count = 0;
              for (let step = 0; step < 4; step += 1) {
                count += (bytes[step] ?? 0) * (2 ** (step * 8));
              }
              if (count > lastRingCount) {
                lastRingCount = count;
                return true;
              }
            }
            return false;
          }
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
          return false;
        };
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
        /** 固件刚发布的键盘环不能沿用这一拍早先读到的字节。 */
        const forgetKeyRing = (): void => {
          const stale: number[] = [];
          for (const key of sparse.keys()) {
            if (keyRingOctet(key)) {
              stale.push(key);
            }
          }
          for (const key of stale) {
            sparse.delete(key);
          }
        };
        /*
         * 监督核的数据缓冲只可信自己窗口里的字。
         * 客程序的参数写在别的核心的窗口里。上一次系统调用读过的那一页会留在缓冲中，
         * 客程序随后改掉的标志和描述符，下一次取出时仍是旧值。
         * 取出到一条调用后先丢掉窗外的页，分发再读到的就是客程序刚写上的字。
         * 自己窗口里的任务表不丢，那些字已经在取出前写回。
         */
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
        /* 客程序的参数只在它自己的窗口里。丢掉整份窗外缓存的话，终端格子每次按键都要重新读回。 */
        const dropCaller = (caller: number): void => {
          if (!Number.isInteger(caller) || caller < 0 || caller > 31) {
            dropForeign();
            return;
          }
          const start = Number((BigInt(RelocateDataFloor) + BigInt(caller) * BigInt(RelocateSlotBits)) / 8n);
          const end = start + Number(BigInt(RelocateSlotBits) / 8n);
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start) {
            dropForeign();
            return;
          }
          hot = null;
          for (const key of sparse.keys()) {
            if (key >= start && key < end) {
              sparse.delete(key);
            }
          }
          for (const key of pages.keys()) {
            if (key >= start && key < end && (key < ownN || key >= ownEndN)) {
              pages.delete(key);
            }
          }
        };
        /*
         * 同步切片大约 1 毫秒，然后用消息通道让出。
         * Hz 不再把这一拍睡成 16 或 33 毫秒。以前取出调用后把切片放到 32 毫秒，
         * 是因为每次让出都要等别的核心把 Hz 睡眠跑完。那种睡眠已经去掉，
         * 1 毫秒的让出足够把显示拍和固件的 poll 排进来。
         * serving 只决定脏字节能不能并进同一段搬运，不再把同步切片放到 32 毫秒。
         */
        const sliceMs = 1;
        let serving = false;
        const sliceCheck = 8;
        /*
         * 平时用消息通道让出，监督核的空转不会每拍都吃掉 4 毫秒。
         * 消息通道会插到定时器前面。终端铺上之后仍只用通道，避免按键路径上堆定时器。
         * 终端还没铺上时，固件的加载圈和设置界面都停在 dwell 上。
         * 通道若完全不让，圆圈画出一帧就停住，字体的网络读也完不成。
         * 这一段大约每 32 毫秒才走一次定时器，其余仍走通道。频率和每拍条数都不改。
         */
        let yieldResume: (() => void) | null = null;
        let yieldForced = false;
        let timerYieldAt = 0;
        /* 只记住已经写进环的按下次数。松开不加这个序号，回显的写出不会被切开。
           还有按下没进环时，这一拍满 1 毫秒就交给固件。 */
        let attentionSeen = 0;
        const keyArrived = (): boolean => {
          return MetricRoot.Hardware.Motherboard.keySerialNow() !== attentionSeen
            || RuntimeRoot.Hardware.Cpu.keyUnwritten();
        };
        const yieldChannel = new MessageChannel();
        yieldChannel.port1.onmessage = (): void => {
          const resume = yieldResume;
          yieldResume = null;
          if (resume !== null) {
            resume();
          }
        };
        /* 键进来之后这几毫秒继续跑。环里的次数往往比通知晚一点才读得到。
           过了这几毫秒就停在入站通知和显示拍上，不再自己发消息。 */
        let hotUntil = 0;
        const noteHot = (): void => {
          const until = performance.now() + 8;
          if (until > hotUntil) {
            hotUntil = until;
          }
        };
        RuntimeRoot.Hardware.Cpu.bindYieldPoke((): void => {
          /* 落在同步切片里时，这一拍还没进等待。记下，拍尾不要再排一帧。 */
          yieldForced = true;
          const resume = yieldResume;
          yieldResume = null;
          if (resume !== null) {
            resume();
          }
        });
        /* firmware 为真时必须真的让出，固件才能来收键。这时不能因为入站标记已经是 1 就立刻返回。 */
        const yieldTurn = (firmware: boolean): Promise<void> => {
          /* 调用已经在保持位里，或上一拍的叫醒落在同步切片中。这一拍直接继续，去取调用。
             入站标记不算：环还没写上，立刻返回会把固件的 poll 饿死。 */
          /* 固件还等着交换结果时，不能用已经解决的承诺立刻再跑。
             那会占住微任务，方向 2 的结果进不了队，键写进环要等十几毫秒。 */
          if (
            !firmware
            && (yieldForced || nativeGatePending() || RuntimeRoot.Hardware.Cpu.keyRingPending())
          ) {
            yieldForced = false;
            /* 固件还等着交换结果时，不能用已经解决的承诺立刻再跑。
               那会占住微任务，方向 2 的结果进不了队。
               只让出一个宏任务，结果落地后马上读环。睡到下一拍显示，字形会晚二十多毫秒。 */
            if (RuntimeRoot.Hardware.Cpu.nativeFirmwareAwaiting()) {
              return new Promise((resolve): void => {
                let settled = false;
                const finish = (): void => {
                  if (settled) {
                    return;
                  }
                  settled = true;
                  if (yieldResume === finish) {
                    yieldResume = null;
                  }
                  resolve();
                };
                yieldResume = finish;
                yieldChannel.port2.postMessage(null);
              });
            }
            return Promise.resolve();
          }
          /* 终端还没铺上时，大约每 32 毫秒才把队列让给定时器一次。
             固件的 30 Hz 圆圈和字体的网络读仍排得进。
             其余节拍走消息通道。每拍都用定时器的话，宿主会把 0 毫秒抬到大约 4 毫秒，引导就被这截间隙拖住。
             终端铺上之后仍只用通道，避免按键路径上堆定时器。 */
          if (!firmware && !nativeTerminalLive() && performance.now() - timerYieldAt >= 32) {
            timerYieldAt = performance.now();
            return new Promise((resolve): void => {
              setTimeout(resolve, 0);
            });
          }
          return new Promise((resolve): void => {
            let settled = false;
            const finish = (): void => {
              if (settled) {
                return;
              }
              settled = true;
              if (yieldResume === finish) {
                yieldResume = null;
              }
              resolve();
            };
            yieldResume = finish;
            /* 决定让出之后，调用可能已经放进保持位。poke 若早于这一行，只把 yieldForced 留下。
               这里再看一次。已经在分发的延后回复不算：那一拍仍要睡到子任务真正把下一次调用放进来。 */
            if (yieldForced || nativeGatePending()) {
              finish();
              return;
            }
            /* 这一拍的指令预算用完了，调用还在分发。不能睡到下一次按键，
               否则 spawn 停在清表上。让出一个宏任务再接着分发。 */
            if (serving && !firmware) {
              yieldChannel.port2.postMessage(null);
              return;
            }
            /* 键已经进环，这一圈的 conPump 还没跑完。
               睡在入站字上会一直等到下一次按下，这一字节就卡在环里。 */
            if (!firmware && ringUnseen) {
              yieldChannel.port2.postMessage(null);
              return;
            }
            if (firmware) {
              /* 等当前这次让出挂上之后再拉固件，避免在监督核的栈上重入 poll。 */
              yieldChannel.port2.postMessage(null);
              queueMicrotask((): void => {
                RuntimeRoot.Hardware.Cpu.pokeFirmwareYield();
              });
              return;
            }
            const mark = MetricRoot.Hardware.Motherboard.keyAttentionWords();
            const canWait = mark !== null && typeof Atomics.waitAsync === "function";
            /* 引导和按键后的短窗仍自己发消息，读环才跟得上。
               窗过了就只等入站通知和显示拍。定时器会被浏览器拉长，这里不用。 */
            /* 引导和按键后的短窗自己发消息。延后的回复（壳在 wait、同核 spawn 还没交回）
               不在这里转圈：子任务放进保持位时会 poke，这一拍从等待里回来。 */
            if (!canWait || !nativeTerminalLive() || performance.now() < hotUntil) {
              yieldChannel.port2.postMessage(null);
            }
            if (mark === null || typeof Atomics.waitAsync !== "function") {
              return;
            }
            /* 等这一格发生变化。键入队会加一，不论当前是 0 还是上次没减干净的数。
               已经变了就只叫醒固件。计数不归零时立刻结束会转成空转。 */
            const current = Atomics.load(mark, 0);
            const waited = Atomics.waitAsync(mark, 0, current);
            if (waited.async) {
              void waited.value.then((): void => {
                queueMicrotask((): void => {
                  noteHot();
                  RuntimeRoot.Hardware.Cpu.pokeFirmwareYield();
                  finish();
                });
              });
            } else {
              noteHot();
              queueMicrotask((): void => {
                RuntimeRoot.Hardware.Cpu.pokeFirmwareYield();
              });
            }
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
          /* 数据窗里已经改过、还没送出的字节。邮箱和监督核自己的窗口不算。
             自己窗口里的格子留在缓冲里，不能因为它们超过 64KB 就把一次按键的回复整段写回去。 */
          const dataOctets = (): number => {
            let count = 0;
            const sharedN = Number(sharedOctet);
            for (const octet of dirty) {
              if (octet < sharedN || (octet >= ownN && octet < ownEndN)) {
                continue;
              }
              count += 1;
            }
            return count;
          };
          /* 画字符串的参数是 itof 之后的位型。先还原成整数，再按八位组去本地缓冲里抄。 */
          const fontBits = new DataView(new ArrayBuffer(8));
          const floatInteger = (bits: bigint): number | null => {
            fontBits.setBigInt64(0, BigInt.asIntN(64, bits), true);
            const value = fontBits.getFloat64(0, true);
            if (!Number.isSafeInteger(value)) {
              return null;
            }
            return value;
          };
          /* 这些出口会让别的核心或设备读刚才写下的字节，必须先整段送出。
             pass 只改本核心的保持位，紧接着的调度仍会送出。降频、空转和查询只碰邮箱。 */
          const mustExpose = (opcode: number): boolean => {
            return opcode === NativeEscapeSchedule
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
          /* 客程序正在执行指令、保持位里又没有新调用：监督核停在这里。
             读键盘、dwell 和已经去掉的 Hz 定时器都不算执行。
             提示符处不能停：键写进环之后还要 conPump 把这一字节交回壳。
             客程序只是可运行、还没取指时也不能睡，否则没人 schedule。
             停机和系统调用都会放开这把闩。 */
          const parkForGuest = async (): Promise<boolean> => {
            /* 已经取走的调用还在分发。键和客程序都不能把这一次回复截掉。 */
            if (serving) {
              return false;
            }
            if (!nativeTerminalLive() || !nativeGuestBusy(ordinal) || nativeGatePending()) {
              return false;
            }
            if (dataOctets() > 0) {
              await flush(false);
            }
            serving = false;
            await nativeWaitLatch();
            /* 回来先走一圈。拍号可能已经变了，再睡会把显示程序留到下一次系统调用。 */
            return false;
          };
          for (;;) {
            /* 30 Hz 的 core() 空转。有真实指令或未取走的调用时不进入下面的取指。 */
            if (await pauseIdleSpin(ordinal)) {
              if (nativeAccount(ordinal, 0)) {
                return;
              }
            }
            if (await parkForGuest()) {
              continue;
            }
            const budget = nativePaceBudget(ordinal);
            if (budget < 1) {
              await flush();
              dropShared();
              if (nativeAccount(ordinal, 0)) {
                return;
              }
              await yieldTurn(false);
              continue;
            }
            let ran = 0;
            let sliceAt = performance.now();
            /* 这一拍已经把下一条调用放进保持位时，先取走再让出。
               写出的回复会顺手叫醒显示。若在降频处把线程交出去，呈现要等下一拍，字形就晚十几毫秒。
               每拍只多取一次，后面的调用仍把线程还给固件。 */
            let pendingTake = 0;
            /* 环的通知先到，这一圈的读可能还在飞，读到的是旧次数。
               这一圈先跑完，下一圈再读一次，不要睡到下一拍显示。 */
            let pumpAgain = false;
            /* 这一圈已经走到给自己升频。中途按 1 毫秒停掉的不算，conPump 可能还停在缺页上。 */
            let sawEpilogue = false;
            /* 没人在取指时，主循环尾上把频率升回去就结束这一拍。
               同一毫秒里再转圈会把线程占满，固件和回收都排在后面。 */
            let restHigh = false;
            /* 入站有字时先把线程交给固件，键盘环才写得上。
               保持位里已经有调用时不再让。那次让出会把已经提交的写出拖过这一拍，字形跟着晚十几毫秒。
               固件写完环就会清掉入站标记。只看入站的话，这一拍读到的旧计数会留到下一次按键。
               写环留下的标记单独丢掉本地副本，这一圈读到的是刚写上的计数。 */
            const pressed = MetricRoot.Hardware.Motherboard.keySerialNow();
            const published = RuntimeRoot.Hardware.Cpu.takeKeyRing();
            /* 只在这一拍真有新键时丢掉环的副本。每拍都丢的话，conPump 每次都要再读一整圈。 */
            if (published > 0) {
              forgetKeyRing();
            }
            if (published > 0) {
              attentionSeen += published;
              pumpAgain = true;
              ringUnseen = true;
              /* 这一圈之前读到的次数不算数。要等通知之后再读到更大的次数。 */
              ringAdvanced = false;
              noteHot();
            }
            if (keyArrived()) {
              noteHot();
            }
            if (!nativeGatePending() && (pressed !== attentionSeen || RuntimeRoot.Hardware.Cpu.keyUnwritten())) {
              /* 叫醒没落到等待上就不记次数。下一拍再试，键不用干等那 8 毫秒。
                 这里不记住计数。环没写上之前，调用仍按 1 毫秒让出。 */
              await yieldTurn(true);
              RuntimeRoot.Hardware.Cpu.takeFirmwareCatch();
              forgetKeyRing();
            }
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
                if (await fill(error.bit)) {
                  ringAdvanced = true;
                }
                if (recall(error.bit / 8n) === undefined) {
                  throw new Error("native instruction failed");
                }
                /* 键盘环刚读回来。下一拍开头会丢掉这份副本。
                   这一条 load 还没把次数写进寄存器就停的话，conPump 看不见已经进环的键，
                   监督核接着睡到下一次按下。这一条必须马上再执行。
                   别的缺页仍按 1 毫秒把线程还给固件，避免一长串缺页占住写环。 */
                if (keyRingOctet(Number(error.bit / 8n))) {
                  /* 读环的往返不占这一拍的 1 毫秒。占了的话，次数刚进寄存器，后面的 conWake 又被截掉。 */
                  sliceAt = performance.now();
                  continue;
                }
                if (performance.now() - sliceAt >= sliceMs && !serving) {
                  break;
                }
                continue;
              }
              if (outcome === "cont") {
                ran += 1;
                /* 每 8 条才看一次钟。每条都看，会比快指令还贵；隔得再远，慢指令会把这一拍拖过 1 毫秒。
                   跳转也走这里，不把 core() 空转计数清掉。while (core()) 中间的 jmp 仍算空转。
                   正在分发时不切开。刚敲下的命令还算「有键」，切开就会把 spawn 停在清表上，
                   监督核接着睡到下一次按键，这条命令永远等不到回复。 */
                if (ran % sliceCheck === 0 && performance.now() - sliceAt >= sliceMs && !serving) {
                  break;
                }
                continue;
              }
              noteIdleShape(ordinal, typeof outcome === "object" && outcome.opcode === NativeEscapeCore);
              /* 连续的存储先留在本核心。每一拍结束都整段送出的话，一次调用会被切成几十次二十字节的往返。
                 回复、调度、绘制、搬运和装入之前整段送出。打开字体面仍先送出。
                 画字符串时标量已经抄齐就留在本核心，缺字才送出，避免抄到空页。攒过 64KB 仍马上送。 */
              let mailboxOnly = false;
              let stagedFont = false;
              let fillFont: { readonly start: number; readonly glyphs: number } | null = null;
              /* 这一行的标量还在本核心缓冲里。抄齐了就交给绘制队列，避免每行再向主板读一次。
                 缺任何一个八位组就先把脏页写回，再读回这一行并留在缓冲里。下一行就能抄齐。 */
              if (typeof outcome === "object" && outcome.opcode === NativeEscapeAccel && ordinal === 2) {
                const operation = readReg(state, outcome.regs, 1);
                if (operation === 42n) {
                  const rawAddress = readReg(state, outcome.regs, 2);
                  const rawCount = readReg(state, outcome.regs, 3);
                  if (rawAddress !== null && rawCount !== null) {
                    const address = floatInteger(rawAddress);
                    const glyphs = floatInteger(rawCount);
                    if (
                      address !== null
                      && glyphs !== null
                      && address >= 0
                      && address % 8 === 0
                      && glyphs > 0
                      && glyphs <= 4096
                    ) {
                      const octets = glyphs * 4;
                      const start = address / 8;
                      const bytes = new Uint8Array(octets);
                      let complete = true;
                      for (let step = 0; step < octets; step += 1) {
                        const found = recallNum(start + step);
                        if (found === undefined) {
                          complete = false;
                          break;
                        }
                        bytes[step] = found;
                      }
                      if (complete) {
                        RuntimeRoot.Hardware.Cpu.stageNativeFont(bytes);
                        stagedFont = true;
                      } else {
                        fillFont = { start, glyphs };
                      }
                    }
                  }
                }
              }
              if (typeof outcome === "object") {
                const opcode = outcome.opcode;
                let expose = mustExpose(opcode) || dataOctets() >= 65536;
                if (opcode === NativeEscapeAccel) {
                  const operation = readReg(state, outcome.regs, 1);
                  if (operation === 40n || (operation === 42n && !stagedFont)) {
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
              /* 调度、矩形和呈现读不到监督核窗口里的格子。那些字留到这一拍结束再送。
                 客程序窗口里的返回值仍在这一次送出。 */
              const skipOwn = typeof outcome === "object"
                && (outcome.opcode === NativeEscapeSchedule
                  || outcome.opcode === NativeEscapePresent
                  || outcome.opcode === NativeEscapeCharacter)
                && dataOctets() < 65536;
              await flush(mailboxOnly, null, skipOwn);
              /* 缓冲里缺的那一行已经写回主板。读回来留在本核心，绘制队列直接带上这些字节。 */
              if (fillFont !== null) {
                const filled = await nativeReadSpan(ordinal, BigInt(fillFont.start), fillFont.glyphs * 4);
                if (filled.length === fillFont.glyphs * 4) {
                  install(BigInt(fillFont.start), filled);
                  RuntimeRoot.Hardware.Cpu.stageNativeFont(filled);
                }
              }
              if (outcome === "halt") {
                finishNativeHalt(ordinal);
                return;
              }
              if (outcome === "fault") {
                throw new Error("native instruction failed");
              }
              if (outcome === "syscall") {
                await flush();
                const posted = await trapCompat(ordinal, state);
                if (!posted) {
                  state.rip -= 2n;
                  nativeYield(ordinal);
                  finishNativeYield(ordinal);
                  return;
                }
                waiting = true;
                return;
              }
              /* hertz(30) 再 hertz(100000000) 不再按低频率补睡。chargePace 只记账。 */
              const applied = await applyEscape(ordinal, state, outcome);
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
                  const packedSlot = outcome.regs[1];
                  const packed = packedSlot === undefined ? 0n : state.reg[packedSlot] ?? 0n;
                  dropCaller(Number(packed >> 32n));
                  /* 调用号已经在寄存器里。分发紧挨着这条 take，不要先让出再做。
                     切片仍是 1 毫秒。不再放到 32 毫秒，否则固件的 poll 要等分发跑完。 */
                  serving = true;
                  tookCall = true;
                }
              }
              /* 只有给自己降频或升频，才表示主循环这一圈已经走完。
                 spawn 里给子核设 1000000 也是 hertz。把它当成收尾的话，
                 schedWake 还没执行，监督核就睡到下一次按键，壳停在 spawn。 */
              const hertzTarget = outcome.opcode === NativeEscapeHertz
                ? readReg(state, outcome.regs, 0)
                : null;
              const selfHertz = hertzTarget === BigInt(ordinal);
              /* 给自己升频是主循环这一圈的收尾，分发函数已经返回。
                 同核 spawn 可以不回复就返回，那一拍仍要结束，子任务才跑得起来。 */
              if (selfHertz) {
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
                 每条都让出时，定时器会把引导切成几毫秒一截。满一毫秒后下面的 break 仍把线程还给固件。
                 已经形成的 core() 空转不再吃完这一毫秒。 */
              if (
                outcome.opcode === NativeEscapeCore
                && nativeTerminalLive()
                && !nativeGuestBusy(ordinal)
                && !RuntimeRoot.Hardware.Cpu.nativeGatePending()
                && !RuntimeRoot.Hardware.Cpu.keyRingPending()
              ) {
                restHigh = true;
              }
              if (
                (selfHertz || outcome.opcode === NativeEscapeCore)
                && performance.now() - sliceAt < sliceMs
                && !(outcome.opcode === NativeEscapeCore && idleSpinning(ordinal))
              ) {
                /* 自己的 core() 后面那次升频已经跑完。这一拍到此为止，去等键或显示拍。
                   给别的核设频率不是这一拍的收尾。 */
                if (!(restHigh && selfHertz)) {
                  continue;
                }
                restHigh = false;
                sawEpilogue = true;
              }
              /* 这次调用还没走到降频或 core。中间让出会把写出和呈现切成十几毫秒。
                 收尾那次给自己升频已经把 serving 清掉。同核 spawn 没回复也一样，
                 否则子任务的下一次调用进不了这一条线程。
                 按下还没进环才切开。松开键的交换还在飞时不要切，呈现会被切成十几毫秒。 */
              if (!serving && performance.now() - sliceAt >= sliceMs && keyArrived()) {
                break;
              }
              if (serving) {
                continue;
              }
              if (nativeGatePending() && pendingTake < 1) {
                pendingTake += 1;
                continue;
              }
              break;
            }
            /* 这一拍被系统调用或查询打断时，数据窗继续留着。
               以前只要这一拍不是被钟截断就会整段送出，相邻的几个字被拆成二十字节一次。
               超过 64KB 仍送，引导清表不会堆在缓冲里。
               调用中间没送出的格子留在缓冲里，绘制队列已经抄过。不在这一拍结束时再搬一次。 */
            await flush(dataOctets() < 65536);
            dropShared();
            await nativeChargePace(ordinal, ran);
            if (nativeAccount(ordinal, ran)) {
              return;
            }
            /* 客程序正在执行指令时，监督核停在保持位上。空转扫表会把线程从命令手里抢走。
               调用写入保持位后立刻继续。客程序还没跑起来、或正停在读键盘里时不在这里等。 */
            if (await parkForGuest()) {
              continue;
            }
            /* 通知之后至少要读到一次更大的次数，并且那一圈已经走完主循环。
               只走到升频还不够：升频前的 conPump 可能仍拿着旧次数。 */
            if (ringUnseen && ringAdvanced && sawEpilogue && published === 0) {
              ringUnseen = false;
              ringAdvanced = false;
            }
            supervisorPoke(ordinal);
            if (pumpAgain) {
              pumpAgain = false;
              continue;
            }
            await yieldTurn(false);
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
        if (stopped.kind === "yield") {
          finishNativeYield(ordinal);
          return;
        }
        if (stopped.kind === "fault") {
          throw new Error("native resume faulted");
        }
      }

      bindNativeResume((ordinal: number): Promise<void> => resumeNative(ordinal));
      bindNativeImage((ordinal: number): Promise<void> => runNativeImage(ordinal));
    }
  }
}
