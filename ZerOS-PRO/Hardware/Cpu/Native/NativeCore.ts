/**
 * @module ZerOS.Hardware.Cpu.NativeCore
 * @description 鍦ㄤ竴棰楁牳蹇冪殑绾挎€т綅鍏冧笂璺戝師鐢熸寚浠? *
 * ---------------------------------------------------------------------------
 * 鏂囦欢鑱岃矗
 * ---------------------------------------------------------------------------
 * 鎸囦护瀛楄妭鍏堢粡杩欓鏍稿績鍐欏叆锛屽啀璇诲洖鏉ユ墽琛屻€? * 0F 3F 鐨勭洃鐫ｃ€佷繚鎸佷綅鍜岀郴缁熻皟鐢ㄥ湪杩欓噷鐩存帴瀹屾垚锛屼笉缂栨垚 ZAP 鎸囦护銆? * 涓嶆浛鎹㈣繖棰楁牳蹇冧笂鐨?ZAP 瀵勫瓨鍣ㄣ€傛櫘閫氬仠鏈哄悗鏍稿績鍋滄銆傜郴缁熻皟鐢ㄦ湡闂存牳蹇冧繚鎸佹墽琛屼腑銆? *
 * ---------------------------------------------------------------------------
 * 浠ｇ爜缁勭粐锛堜弗鏍间紭鍏堢骇锛岃嚜涓婅€屼笅锛岀姝㈡墦涔憋級
 * ---------------------------------------------------------------------------
 *   1. 瀵煎叆
 *   2. 璁垮瓨
 *   3. 鎵ц
 */

/* -------------------------------------------------------------------------- */
/* 1. 瀵煎叆                                                                     */
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
      /** B1 鍘熺敓閲囨牱绱锛氭瘡 1024 鏉¤涓€鏉★紝涓嶉€愭潯鍐欍€?*/
      let nativeTraceCarry = 0;
      const NativeInsnStride = 1024;

      /** 鍘熺敓鎸囦护閲囨牱銆俻c 鏄浉瀵硅鍏ュ熀鍧€鐨勫叓浣嶇粍鍋忕Щ锛屼笉鏄粷瀵逛綅鍦板潃銆?*/
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
      const readBoundOrigin = RuntimeRoot.Hardware.Cpu.readBoundOrigin;
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

      /** 浠ｇ爜鍜屾爤閮芥斁鍦ㄨ繖 528 涓叓浣嶇粍閲屻€傛爤椤跺湪璧风偣涔嬪悗 512 涓叓浣嶇粍銆?*/
      const windowOctets = 0x210;

      /** 缁窇鏃朵粠鐣欎笅鐨勬寚浠ゆ寚閽堣捣璇诲洖杩欎箞澶氫釜鍏綅缁勶紝澶熶竴鏉″仠鏈烘寚浠ゃ€?*/
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
       * 缁忚繖棰楁牳蹇冭涓€娈靛叓浣嶇粍銆傛牳蹇冨繀椤绘槸鍋滄鐨勶紝鑰屼笖娌℃湁瑁呭叆 ZAP 搴忓垪銆?       * 璇诲畬浠嶅仠姝€俍AP 瀵勫瓨鍣ㄦ仮澶嶆垚璋冪敤鍓嶇殑鍊笺€?       */
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

      /** 缁忚繖棰楁牳蹇冨啓涓€娈靛叓浣嶇粍銆傝皟鐢ㄥ墠鍚庨兘鏄仠姝€?*/
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

      /** 鍙栧嚭杞箟鎿嶄綔鏁般€傜紪鍙疯秺鐣屾垨瀵勫瓨鍣ㄥ抚閲屾病鏈夎繖涓€鏍兼椂鏄┖銆?*/
      function readReg(state: NativeState, regs: readonly number[], index: number): bigint | null {
        const slot = regs[index];
        if (slot === undefined) {
          return null;
        }
        return state.reg[slot] ?? null;
      }

      /**
       * 鍏煎浠诲姟鐨?0F 05銆?       * 甯у啓鍒板熬鍖洪〉 0锛屽啀浠ユ湇鍔″彿 27 閫氱煡鐩戠潱鏍搞€傚洖澶嶅瘎瀛樺櫒鍙槸鎶婁繚鎸佷綅浜ゅ洖鍘伙紝缁窇鏃舵敼璇昏繖甯с€?       */
      async function trapCompat(ordinal: number, state: NativeState): Promise<boolean> {
        await nativeWriteSpan(ordinal, BigInt(MapEndBits), encodeCompatFrame(state));
        return nativeSvc(ordinal, 27n, NativeRax);
      }

      /**
       * 鍋氬畬涓€鏉?0F 3F銆?       * 鎴愬姛鎵嶆妸鎸囦护鎸囬拡鏀瑰埌涓嬩竴鏉°€傜郴缁熻皟鐢ㄧ暀涓嬬瓑寰咃紝yield 鐣欎笅鍋滄銆?       * 瑁呭叆銆佸嵏涓嬨€佸垝瀹氥€佹妱妲藉拰鎺ュ叆瑕佺瓑璁垮瓨缁撴潫锛屾墍浠ヨ繖閲屾槸寮傛鐨勩€?       */
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
          /* 鏈嶅姟 28 鐨勯€€鍑虹爜鍦?native home+128锛涜皟璇曟墦寮€鏃朵竴娆¤鍥?8 涓叓浣嶇粍銆?*/
          if (service === 28n && traceEnabled()) {
            /* 同步快照，避免 await 后 bound 被换掉。 */
            const home = readBoundOrigin(ordinal);
            if (home !== 0n) {
              try {
                const bytes = await nativeReadSpan(ordinal, home + 128n, 8);
                let code = 0n;
                for (let index = 0; index < 8; index += 1) {
                  code |= BigInt(bytes[index] ?? 0) << BigInt(index * 8);
                }
                traceInstant(TraceOp.ProcessExit, TraceLayer.Sched, ordinal, Number(code & 0xffffn), 0);
              } catch {
                /* 璇讳笉鍒板氨淇濈暀鍘熸湁閫€鍑鸿矾寰勩€?*/
              }
            }
          }
          if (!nativeSvc(ordinal, service, reply)) {
            /* 鎸囬拡鐣欏湪杩欐潯璋冪敤涓娿€傝鍑轰箣鍚庣洃鐫ｆ牳鍏堟妸淇濇寔浣嶅彇璧帮紝鍐嶈皟搴﹀洖鏉ラ噸璇曘€?*/
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
       * 鏍稿績宸茬粡鍦ㄦ墽琛屻€?       * preload 鏈夊€兼椂鍏堝啓杩涚嚎鎬т綅鍏冨啀璇诲洖銆傜┖鍒欎粠褰撳墠鎸囦护鎸囬拡璇诲洖缁窇鎵€闇€鐨勫瓧鑺傘€?       * 绯荤粺璋冪敤浼氱暀涓嬫墽琛屼腑锛涘叾浣欑粨鏉熸椂鏍稿績鍋滄銆?       */
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
                /* 0F 05 宸茬粡璧拌繃銆傞€€鍥炶繖涓ゅ瓧鑺傦紝璁╁嚭鍚庝粠鍚屼竴鏉″啀璇曘€?*/
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
       * 鎶?image 鍐欏埌 baseBit锛岃鍥炲悗鍐嶆寜浣嶅湴鍧€鎵ц銆?       * 鍋滄満鎴栧け璐ュ悗鏍稿績鍋滄銆傜郴缁熻皟鐢ㄥ垯淇濇寔鎵ц涓紝绛夎皟搴﹀啓鍏ュ洖澶嶃€?       */
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
       * 璺戣鍏ユ椂鎶勪笅鐨勬暣娈靛師鐢熶唬鐮併€?       * 鍙栨寚涓嶇湅鍚庢潵鐨?bound銆傛暟鎹瀛樺厛钀藉湪杩欎竴渚х殑缂撳啿閲岋紝涓€鏉℃寚浠ゆ垚鍔熷悗鍐嶅啓鍥炪€?       * 鑺傛媿銆佹姠鍗犲拰鏃堕棿鐗囦笌 ZAP 搴忓垪鍚屼竴濂椼€?       */
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
         * 涓€椤靛叚涓囧涓叓浣嶇粍濡傛灉鍚勫崰涓€鏉¤〃椤癸紝琛ㄤ細鐣欏湪鑰佺敓浠ｃ€?         * 鏍稿績 2 鍗囧埌 100 MHz 鏃跺彇鎸囧垎閰嶅緢蹇紝鍨冨溇鍥炴敹浼氭妸 CPU 绾跨▼鍋滀綇澶х害 100 姣銆?         * 鍥轰欢鐨?dwell 鎺掑湪鍚屼竴鏉＄嚎绋嬩笂锛岃缃敾闈㈠氨璺熺潃鍋溿€傞檷鍥?30 Hz 鏃跺嚑涔庝笉鍐嶅垎閰嶏紝鍥炴敹涔熶笉鏉ャ€?         * 鏁撮〉鏀捐繘涓€鍧楀瓧鑺傛暟缁勶紝鍥炴敹涓嶅啀鎵繖寮犲ぇ琛ㄣ€傞鐜囦粛鐢卞绋嬪簭鑷繁鏀广€?         */
        const pageOctets = 65536n;
        const pageMask = pageOctets - 1n;
        const pageOctetsN = 65536;
        const pageMaskN = 65535;
        /* 閿洏鐜湪浣嶅潃 6528 鐨勬鏁板拰 6656 璧蜂簲涓Ы锛屽埌 7296 涓烘銆?           缂撳瓨涓嬫爣鏄叓浣嶇粍銆?296 鏄紩瀵奸樁娈靛瓧锛屼笉鑳界畻杩涚幆閲屻€?*/
        const keyRingCount = 6528 / 8;
        const keyRingSlots = 6656 / 8;
        const keyRingSlotsEnd = 7296 / 8;
        const keyRingOctet = (index: number): boolean => {
          if (index >= keyRingCount && index < keyRingCount + 8) {
            return true;
          }
          return index >= keyRingSlots && index < keyRingSlotsEnd;
        };
        /* 椤甸敭鐢ㄥ畨鍏ㄦ暣鏁般€傚ぇ鏁存暟鍋氶敭鏃讹紝姣忔鍙栨暟閮借鏁ｅ垪涓€涓爢瀵硅薄锛岀洃鐫ｆ牳鐨勫惊鐜細琚繖鎴嫋浣忋€?*/
        const pages = new Map<number, Uint8Array>();
        const sparse = new Map<number, number>();
        const dirty = new Set<number>();
        /** 鏈牳绐楀彛閲屾敼杩囩殑瀛楄妭銆傞€侀偖绠卞拰璋冨害鏃朵笉璧拌繖寮犺〃锛岄伩鍏嶆瘡娆℃寜閿兘鎵竴閬嶆帶鍒跺彴銆?*/
        const ownDirty = new Set<number>();
        let waiting = false;
        let hot: Uint8Array | null = null;
        let hotBase = -1;
        const recallNum = (index: number): number | undefined => {
          /* 閿洏鐜敱鍥轰欢鍐欍€佺洃鐫ｆ牳璇汇€傞〉缂撳瓨浼氭妸鍒氬彂甯冪殑娆℃暟鐣欐垚鏃у€硷紝杩欎竴娈靛彧璁ゅ垰璇诲洖鏉ョ殑绋€鐤忓瓧鑺傘€?*/
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
          /* 鎼繍鍜屽～闆跺啓鍦ㄥ埆鐨勬牳蹇冧笂銆傚彧涓㈡帀杩欎竴娈碉紝鐩戠潱鏍歌嚜宸辩殑椤佃繕鐣欑潃銆?             鏁翠唤缂撳啿涓€璧蜂涪鎺夌殑璇濓紝涓嬩竴鏉℃寚浠ゅ張鎶婂叚涓囧瓧鑺傛媺鍥炴潵锛屼竴娆″垪鐩綍浼氶噸澶嶆媺鍑犲崈鍏嗐€?*/
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
        /* 鑷繁鐨勭獥鍙ｄ笉杩涜剰琛ㄣ€傛瘡娆?store 閮界畻涓€閬嶅ぇ鏁存暟浼氭妸鍐欏嚭鎷栨參锛岃繖閲屽彧绠椾竴娆°€?*/
        const ownKeepStart = Number((BigInt(RelocateDataFloor) + BigInt(ordinal) * BigInt(RelocateSlotBits)) / 8n);
        const ownKeepStop = ownKeepStart + Number(BigInt(RelocateSlotBits) / 8n);
        /* 鏍稿績 2 鐨勬暟鎹捣鐐规槸 1048576 + 2脳268435456銆傛。鍙戝竷鍦ㄨ繖涔嬪悗 49152 浣嶏紝鍏釜鍏綅缁勩€?           49344 浣嶆槸鍐呮牳鍙戝竷鐨勮繖涓€杞秷鎭笂闄愶紝灏忕 8 涓叓浣嶇粍銆傞绮掓父鏍囧崰鍒?49343锛屽啀寰€鍚庢墠鏄繖涓瓧銆?*/
        const rankPublishN = 67246080;
        const spanWordN = rankPublishN + 24;
        const keep = (index: number, value: number): void => {
          const stored = value & 0xff;
          if (index >= rankPublishN && index < rankPublishN + 8) {
            noteCoreRank(index - rankPublishN, stored);
          }
          /* 妗ｅ彂甯冧箣鍚庣殑閭ｄ竴涓叓浣嶇粍銆? 琛ㄧず 1 鍙疯淇″彿鎵撲腑锛屽涓讳粠杩欓噷鍋滄満銆?*/
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
          /* 涓婇檺瀛楃殑鍏釜鍏綅缁勯兘鍒颁簡锛屾墠鎶婂皬绔殑浣?32 浣嶄氦缁欎富鏉裤€傞珮浣嶄笉鏄?0 灏卞綋鎴愯繕娌″彂甯冦€?*/
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
          /* 杩炵画鑴忓瓧鑺傛敹鎴愪竴娈点€傛涓庢涓嶇浉閭绘椂涓€娆℃秷鎭啓鍥烇紝涓嶅啀姣忔绛変竴娆′富鏉裤€?             闄嶉銆佺┖杞拰杩樻病鐢诲瓧褰㈢殑鐭╁舰鍙€侀偖绠憋紝鏁版嵁绐楃暀鍒板彇鍑恒€佽皟搴︺€佹煡璇㈡垨瀛楀舰缁樺埗銆?             缂洪〉鏃跺彧閫佸嵆灏嗚鏁撮〉鎹㈡帀鐨勯偅涓€椤碉紝鍒殑椤电户缁敀鐫€銆?             寮曞娓呰〃鐨勮剰瀛楄妭杩滆秴涓婇檺锛岄偅绉嶈皟鐢ㄤ笉浼氳蛋杩欐潯銆傞偖绠辨瘡娆￠兘閫侊紝鍥轰欢鎵嶈兘鐪嬭銆?*/
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
          /* 璋冪敤杩樻病杩斿洖鏃讹紝鐩搁偦鐨勫嚑涓瓧涓棿甯稿父绌虹潃涓€涓や釜娌℃敼鐨勫瓧鑺傘€?             杩欎簺瀛楄妭鏈牳蹇冨凡缁忔湁锛屽苟杩涘悓涓€娈碉紝涓€娆℃惉杩愬氨鑳藉甫璧版暣鏉¤褰曘€?             娌¤杩囩殑绌烘礊涓嶈兘鐢ㄦ棫鍊肩洊鎺夛紝浠嶄粠杩欓噷鍒囧紑銆傝皟鐢ㄤ箣澶栦笉骞剁┖娲炪€?*/
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
        /* 鐜殑閫氱煡宸茬粡鍒颁簡锛屼絾杩欎竴鍦堣鍒扮殑娆℃暟杩樻病姣斾笂娆℃洿澶с€?           璇荤幆杩斿洖鐪熸椂锛屼富寰幆鑷繁璁颁笅娆℃暟宸茬粡鍓嶈繘銆?*/
        let ringUnseen = false;
        let ringAdvanced = false;
        let lastRingCount = -1;
        const fill = async (bit: bigint): Promise<boolean> => {
          const octet = Number(bit / 8n);
          if (keyRingOctet(octet)) {
            /* 娆℃暟銆佹爡鏍忓拰浜斾釜妲戒竴璧疯銆備竴娆″彧璇讳竴涓瓧鐨勮瘽锛宑onPump 瑕佹潵鍥炰笁鍥涜稛锛屼竴瀛楄妭灏辫浜屽崄澶氭绉掋€?*/
            const ringBytes = 104;
            const bytes = await nativeReadSpan(ordinal, 6528n, ringBytes);
            const base = 6528 / 8;
            const width = bytes.length < ringBytes ? bytes.length : ringBytes;
            for (let step = 0; step < width; step += 1) {
              sparse.set(base + step, bytes[step] ?? 0);
            }
            /* 6528 鏄啓鍏ユ鏁般€傞€氱煡宸茬粡鍒颁簡鑰屾鏁版病鍙橈紝灏变笉鑳界潯銆?*/
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
          /* 鍙妸杩欎竴椤靛凡缁忔敼杩囩殑瀛楄妭閫佸嚭鍘汇€傛暣浠借剰缂撳啿涓€璧烽€佺殑璇濓紝姣忔缂洪〉閮戒細鎶婅繕娌″啓瀹岀殑璁板綍鍒囨垚鍑犲崄瀛楄妭銆?*/
          const dirtyPage = (bit / 8n) & ~pageMask;
          await flush(false, dirtyPage);
          /* 鏁撮〉閮藉湪绐楀彛閲屾墠涓€娆¤鍥炪€傜獥鍙ｈ竟鍙閿欒繃鐨勯偅涓€涓叓浣嶇粍锛屼笉鎶婄獥澶栫殑瀛楄妭甯﹁繘缂撳啿銆?*/
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
        /** 鍥轰欢鍒氬彂甯冪殑閿洏鐜笉鑳芥部鐢ㄨ繖涓€鎷嶆棭鍏堣鍒扮殑瀛楄妭銆?*/
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
         * 鐩戠潱鏍哥殑鏁版嵁缂撳啿鍙彲淇¤嚜宸辩獥鍙ｉ噷鐨勫瓧銆?         * 瀹㈢▼搴忕殑鍙傛暟鍐欏湪鍒殑鏍稿績鐨勭獥鍙ｉ噷銆備笂涓€娆＄郴缁熻皟鐢ㄨ杩囩殑閭ｄ竴椤典細鐣欏湪缂撳啿涓紝
         * 瀹㈢▼搴忛殢鍚庢敼鎺夌殑鏍囧織鍜屾弿杩扮锛屼笅涓€娆″彇鍑烘椂浠嶆槸鏃у€笺€?         * 鍙栧嚭鍒颁竴鏉¤皟鐢ㄥ悗鍏堜涪鎺夌獥澶栫殑椤碉紝鍒嗗彂鍐嶈鍒扮殑灏辨槸瀹㈢▼搴忓垰鍐欎笂鐨勫瓧銆?         * 鑷繁绐楀彛閲岀殑浠诲姟琛ㄤ笉涓紝閭ｄ簺瀛楀凡缁忓湪鍙栧嚭鍓嶅啓鍥炪€?         */
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
        /* 瀹㈢▼搴忕殑鍙傛暟鍙湪瀹冭嚜宸辩殑绐楀彛閲屻€備涪鎺夋暣浠界獥澶栫紦瀛樼殑璇濓紝缁堢鏍煎瓙姣忔鎸夐敭閮借閲嶆柊璇诲洖銆?*/
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
         * 鍚屾鍒囩墖澶х害 1 姣锛岀劧鍚庣敤娑堟伅閫氶亾璁╁嚭銆?         * Hz 涓嶅啀鎶婅繖涓€鎷嶇潯鎴?16 鎴?33 姣銆備互鍓嶅彇鍑鸿皟鐢ㄥ悗鎶婂垏鐗囨斁鍒?32 姣锛?         * 鏄洜涓烘瘡娆¤鍑洪兘瑕佺瓑鍒殑鏍稿績鎶?Hz 鐫＄湢璺戝畬銆傞偅绉嶇潯鐪犲凡缁忓幓鎺夛紝
         * 1 姣鐨勮鍑鸿冻澶熸妸鏄剧ず鎷嶅拰鍥轰欢鐨?poll 鎺掕繘鏉ャ€?         * serving 鍙喅瀹氳剰瀛楄妭鑳戒笉鑳藉苟杩涘悓涓€娈垫惉杩愶紝涓嶅啀鎶婂悓姝ュ垏鐗囨斁鍒?32 姣銆?         */
        const sliceMs = 1;
        let serving = false;
        const sliceCheck = 8;
        /*
         * 骞虫椂鐢ㄦ秷鎭€氶亾璁╁嚭锛岀洃鐫ｆ牳鐨勭┖杞笉浼氭瘡鎷嶉兘鍚冩帀 4 姣銆?         * 娑堟伅閫氶亾浼氭彃鍒板畾鏃跺櫒鍓嶉潰銆傜粓绔摵涓婁箣鍚庝粛鍙敤閫氶亾锛岄伩鍏嶆寜閿矾寰勪笂鍫嗗畾鏃跺櫒銆?         * 缁堢杩樻病閾轰笂鏃讹紝鍥轰欢鐨勫姞杞藉湀鍜岃缃晫闈㈤兘鍋滃湪 dwell 涓娿€?         * 閫氶亾鑻ュ畬鍏ㄤ笉璁╋紝鍦嗗湀鐢诲嚭涓€甯у氨鍋滀綇锛屽瓧浣撶殑缃戠粶璇讳篃瀹屼笉鎴愩€?         * 杩欎竴娈靛ぇ绾︽瘡 32 姣鎵嶈蛋涓€娆″畾鏃跺櫒锛屽叾浣欎粛璧伴€氶亾銆傞鐜囧拰姣忔媿鏉℃暟閮戒笉鏀广€?         */
        let yieldResume: (() => void) | null = null;
        let yieldForced = false;
        let timerYieldAt = 0;
        /* 鍙浣忓凡缁忓啓杩涚幆鐨勬寜涓嬫鏁般€傛澗寮€涓嶅姞杩欎釜搴忓彿锛屽洖鏄剧殑鍐欏嚭涓嶄細琚垏寮€銆?           杩樻湁鎸変笅娌¤繘鐜椂锛岃繖涓€鎷嶆弧 1 姣灏变氦缁欏浐浠躲€?*/
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
        /* 閿繘鏉ヤ箣鍚庤繖鍑犳绉掔户缁窇銆傜幆閲岀殑娆℃暟寰€寰€姣旈€氱煡鏅氫竴鐐规墠璇诲緱鍒般€?           杩囦簡杩欏嚑姣灏卞仠鍦ㄥ叆绔欓€氱煡鍜屾樉绀烘媿涓婏紝涓嶅啀鑷繁鍙戞秷鎭€?*/
        let hotUntil = 0;
        const noteHot = (): void => {
          const until = performance.now() + 8;
          if (until > hotUntil) {
            hotUntil = until;
          }
        };
        RuntimeRoot.Hardware.Cpu.bindYieldPoke(ordinal, (): void => {
          /* 钀藉湪鍚屾鍒囩墖閲屾椂锛岃繖涓€鎷嶈繕娌¤繘绛夊緟銆傝涓嬶紝鎷嶅熬涓嶈鍐嶆帓涓€甯с€?*/
          yieldForced = true;
          const resume = yieldResume;
          yieldResume = null;
          if (resume !== null) {
            resume();
          }
        });
        /* firmware 涓虹湡鏃跺繀椤荤湡鐨勮鍑猴紝鍥轰欢鎵嶈兘鏉ユ敹閿€傝繖鏃朵笉鑳藉洜涓哄叆绔欐爣璁板凡缁忔槸 1 灏辩珛鍒昏繑鍥炪€?*/
        const yieldTurn = (firmware: boolean): Promise<void> => {
          /* 璋冪敤宸茬粡鍦ㄤ繚鎸佷綅閲岋紝鎴栦笂涓€鎷嶇殑鍙啋钀藉湪鍚屾鍒囩墖涓€傝繖涓€鎷嶇洿鎺ョ户缁紝鍘诲彇璋冪敤銆?             鍏ョ珯鏍囪涓嶇畻锛氱幆杩樻病鍐欎笂锛岀珛鍒昏繑鍥炰細鎶婂浐浠剁殑 poll 楗挎銆?*/
          /* 鍥轰欢杩樼瓑鐫€浜ゆ崲缁撴灉鏃讹紝涓嶈兘鐢ㄥ凡缁忚В鍐崇殑鎵胯绔嬪埢鍐嶈窇銆?             閭ｄ細鍗犱綇寰换鍔★紝鏂瑰悜 2 鐨勭粨鏋滆繘涓嶄簡闃燂紝閿啓杩涚幆瑕佺瓑鍗佸嚑姣銆?*/
          if (
            !firmware
            && (yieldForced || nativeGatePending() || RuntimeRoot.Hardware.Cpu.keyRingPending())
          ) {
            yieldForced = false;
            /* 鍥轰欢杩樼瓑鐫€浜ゆ崲缁撴灉鏃讹紝涓嶈兘鐢ㄥ凡缁忚В鍐崇殑鎵胯绔嬪埢鍐嶈窇銆?               閭ｄ細鍗犱綇寰换鍔★紝鏂瑰悜 2 鐨勭粨鏋滆繘涓嶄簡闃熴€?               鍙鍑轰竴涓畯浠诲姟锛岀粨鏋滆惤鍦板悗椹笂璇荤幆銆傜潯鍒颁笅涓€鎷嶆樉绀猴紝瀛楀舰浼氭櫄浜屽崄澶氭绉掋€?*/
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
          /* 缁堢杩樻病閾轰笂鏃讹紝澶х害姣?32 姣鎵嶆妸闃熷垪璁╃粰瀹氭椂鍣ㄤ竴娆°€?             鍥轰欢鐨?30 Hz 鍦嗗湀鍜屽瓧浣撶殑缃戠粶璇讳粛鎺掑緱杩涖€?             鍏朵綑鑺傛媿璧版秷鎭€氶亾銆傛瘡鎷嶉兘鐢ㄥ畾鏃跺櫒鐨勮瘽锛屽涓讳細鎶?0 姣鎶埌澶х害 4 姣锛屽紩瀵煎氨琚繖鎴棿闅欐嫋浣忋€?             缁堢閾轰笂涔嬪悗浠嶅彧鐢ㄩ€氶亾锛岄伩鍏嶆寜閿矾寰勪笂鍫嗗畾鏃跺櫒銆?*/
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
            /* 鍐冲畾璁╁嚭涔嬪悗锛岃皟鐢ㄥ彲鑳藉凡缁忔斁杩涗繚鎸佷綅銆俻oke 鑻ユ棭浜庤繖涓€琛岋紝鍙妸 yieldForced 鐣欎笅銆?               杩欓噷鍐嶇湅涓€娆°€傚凡缁忓湪鍒嗗彂鐨勫欢鍚庡洖澶嶄笉绠楋細閭ｄ竴鎷嶄粛瑕佺潯鍒板瓙浠诲姟鐪熸鎶婁笅涓€娆¤皟鐢ㄦ斁杩涙潵銆?*/
            if (yieldForced || nativeGatePending()) {
              finish();
              return;
            }
            /* 杩欎竴鎷嶇殑鎸囦护棰勭畻鐢ㄥ畬浜嗭紝璋冪敤杩樺湪鍒嗗彂銆備笉鑳界潯鍒颁笅涓€娆℃寜閿紝
               鍚﹀垯 spawn 鍋滃湪娓呰〃涓娿€傝鍑轰竴涓畯浠诲姟鍐嶆帴鐫€鍒嗗彂銆?*/
            if (serving && !firmware) {
              yieldChannel.port2.postMessage(null);
              return;
            }
            /* 閿凡缁忚繘鐜紝杩欎竴鍦堢殑 conPump 杩樻病璺戝畬銆?               鐫″湪鍏ョ珯瀛椾笂浼氫竴鐩寸瓑鍒颁笅涓€娆℃寜涓嬶紝杩欎竴瀛楄妭灏卞崱鍦ㄧ幆閲屻€?*/
            if (!firmware && ringUnseen) {
              yieldChannel.port2.postMessage(null);
              return;
            }
            if (firmware) {
              /* 绛夊綋鍓嶈繖娆¤鍑烘寕涓婁箣鍚庡啀鎷夊浐浠讹紝閬垮厤鍦ㄧ洃鐫ｆ牳鐨勬爤涓婇噸鍏?poll銆?*/
              yieldChannel.port2.postMessage(null);
              queueMicrotask((): void => {
                RuntimeRoot.Hardware.Cpu.pokeFirmwareYield();
              });
              return;
            }
            const mark = MetricRoot.Hardware.Motherboard.keyAttentionWords();
            const canWait = mark !== null && typeof Atomics.waitAsync === "function";
            /* 寮曞鍜屾寜閿悗鐨勭煭绐椾粛鑷繁鍙戞秷鎭紝璇荤幆鎵嶈窡寰椾笂銆?               绐楄繃浜嗗氨鍙瓑鍏ョ珯閫氱煡鍜屾樉绀烘媿銆傚畾鏃跺櫒浼氳娴忚鍣ㄦ媺闀匡紝杩欓噷涓嶇敤銆?*/
            /* 寮曞鍜屾寜閿悗鐨勭煭绐楄嚜宸卞彂娑堟伅銆傚欢鍚庣殑鍥炲锛堝３鍦?wait銆佸悓鏍?spawn 杩樻病浜ゅ洖锛?               涓嶅湪杩欓噷杞湀锛氬瓙浠诲姟鏀捐繘淇濇寔浣嶆椂浼?poke锛岃繖涓€鎷嶄粠绛夊緟閲屽洖鏉ャ€?*/
            if (!canWait || !nativeTerminalLive() || performance.now() < hotUntil) {
              yieldChannel.port2.postMessage(null);
            }
            if (mark === null || typeof Atomics.waitAsync !== "function") {
              return;
            }
            /* 绛夎繖涓€鏍煎彂鐢熷彉鍖栥€傞敭鍏ラ槦浼氬姞涓€锛屼笉璁哄綋鍓嶆槸 0 杩樻槸涓婃娌″噺骞插噣鐨勬暟銆?               宸茬粡鍙樹簡灏卞彧鍙啋鍥轰欢銆傝鏁颁笉褰掗浂鏃剁珛鍒荤粨鏉熶細杞垚绌鸿浆銆?*/
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
          /* 浣嶅潃浼氳秴杩?2^31銆備笉鑳界敤 >>锛岄偅鏄?32 浣嶆湁绗﹀彿绉讳綅锛屾牳蹇?1 寰€鍚庣殑绐楀彛浼氳惤鎴愯礋鏁帮紝鍚屼竴椤垫案杩滃懡涓嶄腑銆?*/
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
          /* 鏁版嵁绐楅噷宸茬粡鏀硅繃銆佽繕娌￠€佸嚭鐨勫瓧鑺傘€傞偖绠卞拰鐩戠潱鏍歌嚜宸辩殑绐楀彛涓嶇畻銆?             鑷繁绐楀彛閲岀殑鏍煎瓙鐣欏湪缂撳啿閲岋紝涓嶈兘鍥犱负瀹冧滑瓒呰繃 64KB 灏辨妸涓€娆℃寜閿殑鍥炲鏁存鍐欏洖鍘汇€?*/
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
          /* 鐢诲瓧绗︿覆鐨勫弬鏁版槸 itof 涔嬪悗鐨勪綅鍨嬨€傚厛杩樺師鎴愭暣鏁帮紝鍐嶆寜鍏綅缁勫幓鏈湴缂撳啿閲屾妱銆?*/
          const fontBits = new DataView(new ArrayBuffer(8));
          const floatInteger = (bits: bigint): number | null => {
            fontBits.setBigInt64(0, BigInt.asIntN(64, bits), true);
            const value = fontBits.getFloat64(0, true);
            if (!Number.isSafeInteger(value)) {
              return null;
            }
            return value;
          };
          /* 杩欎簺鍑哄彛浼氳鍒殑鏍稿績鎴栬澶囪鍒氭墠鍐欎笅鐨勫瓧鑺傦紝蹇呴』鍏堟暣娈甸€佸嚭銆?             pass 鍙敼鏈牳蹇冪殑淇濇寔浣嶏紝绱ф帴鐫€鐨勮皟搴︿粛浼氶€佸嚭銆傞檷棰戙€佺┖杞拰鏌ヨ鍙閭銆?*/
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
          /* 瀹㈢▼搴忔鍦ㄦ墽琛屾寚浠ゃ€佷繚鎸佷綅閲屽張娌℃湁鏂拌皟鐢細鐩戠潱鏍稿仠鍦ㄨ繖閲屻€?             璇婚敭鐩樸€乨well 鍜屽凡缁忓幓鎺夌殑 Hz 瀹氭椂鍣ㄩ兘涓嶇畻鎵ц銆?             鎻愮ず绗﹀涓嶈兘鍋滐細閿啓杩涚幆涔嬪悗杩樿 conPump 鎶婅繖涓€瀛楄妭浜ゅ洖澹炽€?             瀹㈢▼搴忓彧鏄彲杩愯銆佽繕娌″彇鎸囨椂涔熶笉鑳界潯锛屽惁鍒欐病浜?schedule銆?             鍋滄満鍜岀郴缁熻皟鐢ㄩ兘浼氭斁寮€杩欐妸闂┿€?*/
          const parkForGuest = async (): Promise<boolean> => {
            /* 宸茬粡鍙栬蛋鐨勮皟鐢ㄨ繕鍦ㄥ垎鍙戙€傞敭鍜屽绋嬪簭閮戒笉鑳芥妸杩欎竴娆″洖澶嶆埅鎺夈€?*/
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
            /* 鍥炴潵鍏堣蛋涓€鍦堛€傛媿鍙峰彲鑳藉凡缁忓彉浜嗭紝鍐嶇潯浼氭妸鏄剧ず绋嬪簭鐣欏埌涓嬩竴娆＄郴缁熻皟鐢ㄣ€?*/
            return false;
          };
          for (;;) {
            /* 30 Hz 鐨?core() 绌鸿浆銆傛湁鐪熷疄鎸囦护鎴栨湭鍙栬蛋鐨勮皟鐢ㄦ椂涓嶈繘鍏ヤ笅闈㈢殑鍙栨寚銆?*/
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
            /* 杩欎竴鎷嶅凡缁忔妸涓嬩竴鏉¤皟鐢ㄦ斁杩涗繚鎸佷綅鏃讹紝鍏堝彇璧板啀璁╁嚭銆?               鍐欏嚭鐨勫洖澶嶄細椤烘墜鍙啋鏄剧ず銆傝嫢鍦ㄩ檷棰戝鎶婄嚎绋嬩氦鍑哄幓锛屽憟鐜拌绛変笅涓€鎷嶏紝瀛楀舰灏辨櫄鍗佸嚑姣銆?               姣忔媿鍙鍙栦竴娆★紝鍚庨潰鐨勮皟鐢ㄤ粛鎶婄嚎绋嬭繕缁欏浐浠躲€?*/
            let pendingTake = 0;
            /* 鐜殑閫氱煡鍏堝埌锛岃繖涓€鍦堢殑璇诲彲鑳借繕鍦ㄩ锛岃鍒扮殑鏄棫娆℃暟銆?               杩欎竴鍦堝厛璺戝畬锛屼笅涓€鍦堝啀璇讳竴娆★紝涓嶈鐫″埌涓嬩竴鎷嶆樉绀恒€?*/
            let pumpAgain = false;
            /* 杩欎竴鍦堝凡缁忚蛋鍒扮粰鑷繁鍗囬銆備腑閫旀寜 1 姣鍋滄帀鐨勪笉绠楋紝conPump 鍙兘杩樺仠鍦ㄧ己椤典笂銆?*/
            let sawEpilogue = false;
            /* 娌′汉鍦ㄥ彇鎸囨椂锛屼富寰幆灏句笂鎶婇鐜囧崌鍥炲幓灏辩粨鏉熻繖涓€鎷嶃€?               鍚屼竴姣閲屽啀杞湀浼氭妸绾跨▼鍗犳弧锛屽浐浠跺拰鍥炴敹閮芥帓鍦ㄥ悗闈€?*/
            let restHigh = false;
            /* 鍏ョ珯鏈夊瓧鏃跺厛鎶婄嚎绋嬩氦缁欏浐浠讹紝閿洏鐜墠鍐欏緱涓娿€?               淇濇寔浣嶉噷宸茬粡鏈夎皟鐢ㄦ椂涓嶅啀璁┿€傞偅娆¤鍑轰細鎶婂凡缁忔彁浜ょ殑鍐欏嚭鎷栬繃杩欎竴鎷嶏紝瀛楀舰璺熺潃鏅氬崄鍑犳绉掋€?               鍥轰欢鍐欏畬鐜氨浼氭竻鎺夊叆绔欐爣璁般€傚彧鐪嬪叆绔欑殑璇濓紝杩欎竴鎷嶈鍒扮殑鏃ц鏁颁細鐣欏埌涓嬩竴娆℃寜閿€?               鍐欑幆鐣欎笅鐨勬爣璁板崟鐙涪鎺夋湰鍦板壇鏈紝杩欎竴鍦堣鍒扮殑鏄垰鍐欎笂鐨勮鏁般€?*/
            const pressed = MetricRoot.Hardware.Motherboard.keySerialNow();
            const published = RuntimeRoot.Hardware.Cpu.takeKeyRing();
            /* 鍙湪杩欎竴鎷嶇湡鏈夋柊閿椂涓㈡帀鐜殑鍓湰銆傛瘡鎷嶉兘涓㈢殑璇濓紝conPump 姣忔閮借鍐嶈涓€鏁村湀銆?*/
            if (published > 0) {
              forgetKeyRing();
            }
            if (published > 0) {
              attentionSeen += published;
              pumpAgain = true;
              ringUnseen = true;
              /* 杩欎竴鍦堜箣鍓嶈鍒扮殑娆℃暟涓嶇畻鏁般€傝绛夐€氱煡涔嬪悗鍐嶈鍒版洿澶х殑娆℃暟銆?*/
              ringAdvanced = false;
              noteHot();
            }
            if (keyArrived()) {
              noteHot();
            }
            if (!nativeGatePending() && (pressed !== attentionSeen || RuntimeRoot.Hardware.Cpu.keyUnwritten())) {
              /* 鍙啋娌¤惤鍒扮瓑寰呬笂灏变笉璁版鏁般€備笅涓€鎷嶅啀璇曪紝閿笉鐢ㄥ共绛夐偅 8 姣銆?                 杩欓噷涓嶈浣忚鏁般€傜幆娌″啓涓婁箣鍓嶏紝璋冪敤浠嶆寜 1 姣璁╁嚭銆?*/
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
                /* 閿洏鐜垰璇诲洖鏉ャ€備笅涓€鎷嶅紑澶翠細涓㈡帀杩欎唤鍓湰銆?                   杩欎竴鏉?load 杩樻病鎶婃鏁板啓杩涘瘎瀛樺櫒灏卞仠鐨勮瘽锛宑onPump 鐪嬩笉瑙佸凡缁忚繘鐜殑閿紝
                   鐩戠潱鏍告帴鐫€鐫″埌涓嬩竴娆℃寜涓嬨€傝繖涓€鏉″繀椤婚┈涓婂啀鎵ц銆?                   鍒殑缂洪〉浠嶆寜 1 姣鎶婄嚎绋嬭繕缁欏浐浠讹紝閬垮厤涓€闀夸覆缂洪〉鍗犱綇鍐欑幆銆?*/
                if (keyRingOctet(Number(error.bit / 8n))) {
                  /* 璇荤幆鐨勫線杩斾笉鍗犺繖涓€鎷嶇殑 1 姣銆傚崰浜嗙殑璇濓紝娆℃暟鍒氳繘瀵勫瓨鍣紝鍚庨潰鐨?conWake 鍙堣鎴帀銆?*/
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
                /* 姣?8 鏉℃墠鐪嬩竴娆￠挓銆傛瘡鏉￠兘鐪嬶紝浼氭瘮蹇寚浠よ繕璐碉紱闅斿緱鍐嶈繙锛屾參鎸囦护浼氭妸杩欎竴鎷嶆嫋杩?1 姣銆?                   璺宠浆涔熻蛋杩欓噷锛屼笉鎶?core() 绌鸿浆璁℃暟娓呮帀銆倃hile (core()) 涓棿鐨?jmp 浠嶇畻绌鸿浆銆?                   姝ｅ湪鍒嗗彂鏃朵笉鍒囧紑銆傚垰鏁蹭笅鐨勫懡浠よ繕绠椼€屾湁閿€嶏紝鍒囧紑灏变細鎶?spawn 鍋滃湪娓呰〃涓婏紝
                   鐩戠潱鏍告帴鐫€鐫″埌涓嬩竴娆℃寜閿紝杩欐潯鍛戒护姘歌繙绛変笉鍒板洖澶嶃€?*/
                if (ran % sliceCheck === 0 && performance.now() - sliceAt >= sliceMs && !serving) {
                  break;
                }
                continue;
              }
              noteIdleShape(ordinal, typeof outcome === "object" && outcome.opcode === NativeEscapeCore);
              /* 杩炵画鐨勫瓨鍌ㄥ厛鐣欏湪鏈牳蹇冦€傛瘡涓€鎷嶇粨鏉熼兘鏁存閫佸嚭鐨勮瘽锛屼竴娆¤皟鐢ㄤ細琚垏鎴愬嚑鍗佹浜屽崄瀛楄妭鐨勫線杩斻€?                 鍥炲銆佽皟搴︺€佺粯鍒躲€佹惉杩愬拰瑁呭叆涔嬪墠鏁存閫佸嚭銆傛墦寮€瀛椾綋闈粛鍏堥€佸嚭銆?                 鐢诲瓧绗︿覆鏃舵爣閲忓凡缁忔妱榻愬氨鐣欏湪鏈牳蹇冿紝缂哄瓧鎵嶉€佸嚭锛岄伩鍏嶆妱鍒扮┖椤点€傛敀杩?64KB 浠嶉┈涓婇€併€?*/
              let mailboxOnly = false;
              let stagedFont = false;
              let fillFont: { readonly start: number; readonly glyphs: number } | null = null;
              /* 杩欎竴琛岀殑鏍囬噺杩樺湪鏈牳蹇冪紦鍐查噷銆傛妱榻愪簡灏变氦缁欑粯鍒堕槦鍒楋紝閬垮厤姣忚鍐嶅悜涓绘澘璇讳竴娆°€?                 缂轰换浣曚竴涓叓浣嶇粍灏卞厛鎶婅剰椤靛啓鍥烇紝鍐嶈鍥炶繖涓€琛屽苟鐣欏湪缂撳啿閲屻€備笅涓€琛屽氨鑳芥妱榻愩€?*/
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
              /* 璋冨害銆佺煩褰㈠拰鍛堢幇璇讳笉鍒扮洃鐫ｆ牳绐楀彛閲岀殑鏍煎瓙銆傞偅浜涘瓧鐣欏埌杩欎竴鎷嶇粨鏉熷啀閫併€?                 瀹㈢▼搴忕獥鍙ｉ噷鐨勮繑鍥炲€间粛鍦ㄨ繖涓€娆￠€佸嚭銆?*/
              const skipOwn = typeof outcome === "object"
                && (outcome.opcode === NativeEscapeSchedule
                  || outcome.opcode === NativeEscapePresent
                  || outcome.opcode === NativeEscapeCharacter)
                && dataOctets() < 65536;
              await flush(mailboxOnly, null, skipOwn);
              /* 缂撳啿閲岀己鐨勯偅涓€琛屽凡缁忓啓鍥炰富鏉裤€傝鍥炴潵鐣欏湪鏈牳蹇冿紝缁樺埗闃熷垪鐩存帴甯︿笂杩欎簺瀛楄妭銆?*/
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
              /* hertz(30) 鍐?hertz(100000000) 涓嶅啀鎸変綆棰戠巼琛ョ潯銆俢hargePace 鍙璐︺€?*/
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
                  /* 璋冪敤鍙峰凡缁忓湪瀵勫瓨鍣ㄩ噷銆傚垎鍙戠揣鎸ㄧ潃杩欐潯 take锛屼笉瑕佸厛璁╁嚭鍐嶅仛銆?                     鍒囩墖浠嶆槸 1 姣銆備笉鍐嶆斁鍒?32 姣锛屽惁鍒欏浐浠剁殑 poll 瑕佺瓑鍒嗗彂璺戝畬銆?*/
                  serving = true;
                  tookCall = true;
                }
              }
              /* 鍙湁缁欒嚜宸遍檷棰戞垨鍗囬锛屾墠琛ㄧず涓诲惊鐜繖涓€鍦堝凡缁忚蛋瀹屻€?                 spawn 閲岀粰瀛愭牳璁?1000000 涔熸槸 hertz銆傛妸瀹冨綋鎴愭敹灏剧殑璇濓紝
                 schedWake 杩樻病鎵ц锛岀洃鐫ｆ牳灏辩潯鍒颁笅涓€娆℃寜閿紝澹冲仠鍦?spawn銆?*/
              const hertzTarget = outcome.opcode === NativeEscapeHertz
                ? readReg(state, outcome.regs, 0)
                : null;
              const selfHertz = hertzTarget === BigInt(ordinal);
              /* 缁欒嚜宸卞崌棰戞槸涓诲惊鐜繖涓€鍦堢殑鏀跺熬锛屽垎鍙戝嚱鏁板凡缁忚繑鍥炪€?                 鍚屾牳 spawn 鍙互涓嶅洖澶嶅氨杩斿洖锛岄偅涓€鎷嶄粛瑕佺粨鏉燂紝瀛愪换鍔℃墠璺戝緱璧锋潵銆?*/
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
              /* 鏌ヨ涓嶇寮€杩欎竴鎷嶃€傝皟搴︽瘡鍦堣闂ソ鍑犳鏍稿績鐘舵€侊紝姣忔閮借鍑轰細鎶婃寜閿帹杩熷埌涓嬩竴娆＄┖杞€?                 宸茬粡鏀掍笅鐨勭粯鍒跺悓鏍风暀鍦ㄨ繖涓€鎷嶉噷銆備竴琛屼竴娆¤鍑猴紝婊氬睆浼氭妸鎹㈣鎷栧埌濂藉嚑绉掋€?                 鎵撳紑瀛椾綋闈㈣绛夌紪鍙凤紝涓嶅湪杩欓噷杩炵潃鍋氥€?*/
              if (outcome.opcode === NativeEscapeQuery && performance.now() - sliceAt < sliceMs) {
                continue;
              }
              if (outcome.opcode === NativeEscapeAccel && performance.now() - sliceAt < sliceMs) {
                const operation = readReg(state, outcome.regs, 1);
                if (operation !== 40n) {
                  continue;
                }
              }
              /* 涓诲惊鐜熬涓婄殑闄嶉鍜?core 浠嶈璁╁嚭锛屼絾鍚屼竴姣閲屽厛鎶婅繖涓€鍦堣窇瀹屻€?                 姣忔潯閮借鍑烘椂锛屽畾鏃跺櫒浼氭妸寮曞鍒囨垚鍑犳绉掍竴鎴€傛弧涓€姣鍚庝笅闈㈢殑 break 浠嶆妸绾跨▼杩樼粰鍥轰欢銆?                 宸茬粡褰㈡垚鐨?core() 绌鸿浆涓嶅啀鍚冨畬杩欎竴姣銆?*/
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
                /* 鑷繁鐨?core() 鍚庨潰閭ｆ鍗囬宸茬粡璺戝畬銆傝繖涓€鎷嶅埌姝や负姝紝鍘荤瓑閿垨鏄剧ず鎷嶃€?                   缁欏埆鐨勬牳璁鹃鐜囦笉鏄繖涓€鎷嶇殑鏀跺熬銆?*/
                if (!(restHigh && selfHertz)) {
                  continue;
                }
                restHigh = false;
                sawEpilogue = true;
              }
              /* 杩欐璋冪敤杩樻病璧板埌闄嶉鎴?core銆備腑闂磋鍑轰細鎶婂啓鍑哄拰鍛堢幇鍒囨垚鍗佸嚑姣銆?                 鏀跺熬閭ｆ缁欒嚜宸卞崌棰戝凡缁忔妸 serving 娓呮帀銆傚悓鏍?spawn 娌″洖澶嶄篃涓€鏍凤紝
                 鍚﹀垯瀛愪换鍔＄殑涓嬩竴娆¤皟鐢ㄨ繘涓嶄簡杩欎竴鏉＄嚎绋嬨€?                 鎸変笅杩樻病杩涚幆鎵嶅垏寮€銆傛澗寮€閿殑浜ゆ崲杩樺湪椋炴椂涓嶈鍒囷紝鍛堢幇浼氳鍒囨垚鍗佸嚑姣銆?*/
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
            /* 杩欎竴鎷嶈绯荤粺璋冪敤鎴栨煡璇㈡墦鏂椂锛屾暟鎹獥缁х画鐣欑潃銆?               浠ュ墠鍙杩欎竴鎷嶄笉鏄閽熸埅鏂氨浼氭暣娈甸€佸嚭锛岀浉閭荤殑鍑犱釜瀛楄鎷嗘垚浜屽崄瀛楄妭涓€娆°€?               瓒呰繃 64KB 浠嶉€侊紝寮曞娓呰〃涓嶄細鍫嗗湪缂撳啿閲屻€?               璋冪敤涓棿娌￠€佸嚭鐨勬牸瀛愮暀鍦ㄧ紦鍐查噷锛岀粯鍒堕槦鍒楀凡缁忔妱杩囥€備笉鍦ㄨ繖涓€鎷嶇粨鏉熸椂鍐嶆惉涓€娆°€?*/
            await flush(dataOctets() < 65536);
            dropShared();
            await nativeChargePace(ordinal, ran);
            if (nativeAccount(ordinal, ran)) {
              return;
            }
            /* 瀹㈢▼搴忔鍦ㄦ墽琛屾寚浠ゆ椂锛岀洃鐫ｆ牳鍋滃湪淇濇寔浣嶄笂銆傜┖杞壂琛ㄤ細鎶婄嚎绋嬩粠鍛戒护鎵嬮噷鎶㈣蛋銆?               璋冪敤鍐欏叆淇濇寔浣嶅悗绔嬪埢缁х画銆傚绋嬪簭杩樻病璺戣捣鏉ャ€佹垨姝ｅ仠鍦ㄨ閿洏閲屾椂涓嶅湪杩欓噷绛夈€?*/
            if (await parkForGuest()) {
              continue;
            }
            /* 閫氱煡涔嬪悗鑷冲皯瑕佽鍒颁竴娆℃洿澶х殑娆℃暟锛屽苟涓旈偅涓€鍦堝凡缁忚蛋瀹屼富寰幆銆?               鍙蛋鍒板崌棰戣繕涓嶅锛氬崌棰戝墠鐨?conPump 鍙兘浠嶆嬁鐫€鏃ф鏁般€?*/
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
       * 璋冨害鍦ㄥ洖澶嶅凡缁忔斁杩涗繚鎸佷綅涔嬪悗璋冪敤銆?       * 鍥炲鍐欏叆鍘熺敓瀵勫瓨鍣紝鍐嶄粠鐣欎笅鐨勪綅鍦板潃缁х画锛岀洿鍒板仠鏈烘垨鍐嶄竴娆＄郴缁熻皟鐢ㄣ€?       */
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
