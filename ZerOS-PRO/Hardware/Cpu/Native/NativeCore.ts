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
      const nativeExchange = RuntimeRoot.Hardware.Cpu.nativeExchange;
      const nativeCarry = RuntimeRoot.Hardware.Cpu.nativeCarry;
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
      const nativeIdleTick = RuntimeRoot.Hardware.Cpu.nativeIdleTick;
      const nativeYieldPace = RuntimeRoot.Hardware.Cpu.nativeYieldPace;
      const nativeKeyWait = RuntimeRoot.Hardware.Cpu.nativeKeyWait;
      const nativeGuestHot = RuntimeRoot.Hardware.Cpu.nativeGuestHot;
      const noteCoreRank = RuntimeRoot.Hardware.Cpu.noteCoreRank;
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
          while (steps < 64) {
            steps += 1;
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
        const pages = new Map<bigint, Uint8Array>();
        const sparse = new Map<bigint, number>();
        const dirty = new Set<bigint>();
        let waiting = false;
        const recall = (octet: bigint): number | undefined => {
          const lone = sparse.get(octet);
          if (lone !== undefined) {
            return lone;
          }
          const base = octet & ~pageMask;
          const page = pages.get(base);
          if (page === undefined) {
            return undefined;
          }
          return page[Number(octet - base)];
        };
        /* 核心 2 的数据起点是 1048576 + 2×268435456。档发布在这之后 49152 位，八个八位组。 */
        const rankPublishOctet = 67246080n;
        const keep = (octet: bigint, value: number): void => {
          const stored = value & 0xff;
          if (octet >= rankPublishOctet && octet < rankPublishOctet + 8n) {
            noteCoreRank(Number(octet - rankPublishOctet), stored);
          }
          const base = octet & ~pageMask;
          const page = pages.get(base);
          if (page !== undefined) {
            page[Number(octet - base)] = stored;
            sparse.delete(octet);
          } else {
            sparse.set(octet, stored);
          }
          dirty.add(octet);
        };
        const install = (origin: bigint, bytes: Uint8Array): void => {
          if (bytes.length === Number(pageOctets) && (origin & pageMask) === 0n) {
            pages.set(origin, new Uint8Array(bytes));
            const end = origin + pageOctets;
            for (const key of sparse.keys()) {
              if (key >= origin && key < end) {
                sparse.delete(key);
              }
            }
            return;
          }
          for (let step = 0; step < bytes.length; step += 1) {
            const octet = origin + BigInt(step);
            const stored = bytes[step] ?? 0;
            const base = octet & ~pageMask;
            const page = pages.get(base);
            if (page !== undefined) {
              page[Number(octet - base)] = stored;
              sparse.delete(octet);
            } else {
              sparse.set(octet, stored);
            }
          }
        };
        const flush = async (): Promise<void> => {
          if (dirty.size === 0) {
            return;
          }
          /* 连续脏字节收成一段。段与段不相邻时一次消息写回，不再每段等一次主板。 */
          const pending = [...dirty].sort((left, right): number => (left < right ? -1 : left > right ? 1 : 0));
          const addresses: bigint[] = [];
          const parts: Uint8Array[] = [];
          let index = 0;
          while (index < pending.length) {
            const origin = pending[index];
            if (origin === undefined) {
              break;
            }
            let count = 1;
            while (
              count < MailboxSpanBytes
              && index + count < pending.length
              && pending[index + count] === origin + BigInt(count)
            ) {
              count += 1;
            }
            const bytes = new Uint8Array(count);
            for (let step = 0; step < count; step += 1) {
              bytes[step] = recall(origin + BigInt(step)) ?? 0;
            }
            addresses.push(origin * 8n);
            parts.push(bytes);
            for (let step = 0; step < count; step += 1) {
              dirty.delete(origin + BigInt(step));
            }
            index += count;
          }
          let cursor = 0;
          while (cursor < addresses.length) {
            const end = Math.min(addresses.length, cursor + 128);
            await nativeWriteSpans(ordinal, addresses.slice(cursor, end), parts.slice(cursor, end));
            cursor = end;
          }
        };
        const fill = async (bit: bigint): Promise<void> => {
          await flush();
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
        const sharedOctet = BigInt(RelocateDataFloor) / 8n;
        const dropShared = (): void => {
          for (const key of sparse.keys()) {
            if (key < sharedOctet) {
              sparse.delete(key);
            }
          }
          for (const key of pages.keys()) {
            if (key < sharedOctet) {
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
        const dropForeign = (): void => {
          for (const key of sparse.keys()) {
            if (key < ownOctet || key >= ownEnd) {
              sparse.delete(key);
            }
          }
          for (const key of pages.keys()) {
            if (key < ownOctet || key >= ownEnd) {
              pages.delete(key);
            }
          }
        };
        /*
         * 节拍不足 1 毫秒时不会挂起，所以每拍结束仍要让出一次宏任务。
         * 频率高时一拍的预算能到 10 万条。stepNative 在 CPU 线程上同步做完，墙钟往往是一两百毫秒。
         * 固件的 dwell 和别的核心的定时都排在这条线程上。
         * 这里不改频率。墙钟走过 1 毫秒就先把已经跑过的条数记上拍再让出，100 MHz 仍是 100 MHz。
         */
        const sliceMs = 1;
        const sliceCheck = 8;
        /*
         * 平时用消息通道让出，监督核的空转不会每拍都吃掉 4 毫秒。
         * 有至少 1000 Hz 的客程序正在跑，或停在系统调用里等键盘时，最多每 4 毫秒改用一次定时器。
         * 消息通道会插到定时器前面。壳程序的访存回复若只排在通道后面，按键就会等到下一次空转睡醒。
         */
        let yieldResume: (() => void) | null = null;
        const yieldChannel = new MessageChannel();
        yieldChannel.port1.onmessage = (): void => {
          const resume = yieldResume;
          yieldResume = null;
          if (resume !== null) {
            resume();
          }
        };
        let lastGuestYield = 0;
        const yieldTurn = (): Promise<void> => {
          const now = performance.now();
          if (nativeGuestHot(ordinal) && now - lastGuestYield >= 4) {
            lastGuestYield = now;
            return new Promise((resolve): void => {
              setTimeout(resolve, 0);
            });
          }
          return new Promise((resolve): void => {
            yieldResume = resolve;
            yieldChannel.port2.postMessage(null);
          });
        };
        const port: NativeOctetPort = {
          limitBit: 1n << 48n,
          load(bit: bigint): number {
            if (bit >= base && bit % 8n === 0n) {
              const index = Number((bit - base) / 8n);
              if (Number.isSafeInteger(index) && index >= 0 && index < code.length) {
                return code[index] ?? 0;
              }
            }
            if (!nativeBitAllowed(ordinal, bit, 8)) {
              return -1;
            }
            const found = recall(bit / 8n);
            if (found !== undefined) {
              return found;
            }
            throw nativeMiss(bit);
          },
          store(bit: bigint, value: number): void {
            if (!nativeBitAllowed(ordinal, bit, 8) || bit % 8n !== 0n) {
              return;
            }
            const octet = bit / 8n;
            if (bit >= base) {
              const index = Number((bit - base) / 8n);
              if (Number.isSafeInteger(index) && index >= 0 && index < code.length) {
                code[index] = value & 0xff;
              }
            }
            keep(octet, value);
          },
        };
        try {
          if (ordinal >= 0 && ordinal < coastArm.length) {
            coastArm[ordinal] = 0;
          }
          for (;;) {
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
            while (ran < budget) {
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
              await flush();
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
              if (outcome.opcode === NativeEscapeCarry || outcome.opcode === NativeEscapeFill) {
                pages.clear();
                sparse.clear();
              }
              if (outcome.opcode === NativeEscapeTake) {
                const foundSlot = outcome.regs[0];
                const found = foundSlot === undefined ? 0n : state.reg[foundSlot] ?? 0n;
                if (found === 1n) {
                  dropForeign();
                }
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
              /* 查询不离开这一拍。调度每圈要问好几次核心状态，每次都让出会把按键推迟到下一次空转。 */
              if (outcome.opcode === NativeEscapeQuery && performance.now() - sliceAt < sliceMs) {
                continue;
              }
              break;
            }
            await flush();
            dropShared();
            if (ordinal >= 0 && ordinal < coastArm.length && (coastArm[ordinal] ?? 0) === 1 && ran > 0) {
              /* 壳等键盘时，这一拍的 8 毫秒合睡会挡住下一次收键。只让出，不把线程睡住。
                 有命令在取指时仍合睡，这条线程留给命令。 */
              if (nativeKeyWait(ordinal)) {
                nativeYieldPace(ordinal);
                await nativeChargePace(ordinal, ran);
              } else {
                await nativeIdleTick(ordinal);
              }
              nativeCoast(ordinal);
              coastArm[ordinal] = 0;
            } else {
              await nativeChargePace(ordinal, ran);
            }
            if (nativeAccount(ordinal, ran + billed)) {
              return;
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
