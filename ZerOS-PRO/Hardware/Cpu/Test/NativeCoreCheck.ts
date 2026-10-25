/**
 * @module ZerOS.Hardware.Cpu.NativeCoreCheck
 * @description 核对原生指令走核心的线性位元，并且槽能放回原生帧
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 用 1 号核心的窗口。抄进 2 号槽再放回。结束时清掉这段窗口和原生帧。
 * 0 号核心取得监督权，接收系统调用，再把回复交回 1 号核心的原生寄存器。
 * 同一条转义还要装入 3 号核心、划定范围、查询、抄槽、改频率、接入动态库，并交出画面、读帧边，然后卸下并交还挂载状态。
 * 槽要放回 16 个寄存器和五个标志。划定之后，窗口外的原生写入必须整条失败。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. runNativeCoreCheck
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as ConfigRoot } from "../Config/CpuConfig";
import { ZerOS as RegisterRoot } from "../Enum/NativeRegister";
import { ZerOS as CoreRoot } from "../Native/NativeCore";
import { ZerOS as RuntimeRoot } from "../Bootstrap/CpuRuntime";
import { ZerOS as BinaryRoot } from "../Structure/ProgramBinary";
import { ZerOS as StateRoot } from "../Structure/NativeState";
import { ZerOS as GpuConfigRoot } from "../../Gpu/Config/GpuConfig";
import { ZerOS as LinesRoot } from "./GuestLines";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      const DataFloor = ConfigRoot.Hardware.Cpu.Config.RelocateDataFloor;
      const SlotBits = ConfigRoot.Hardware.Cpu.Config.RelocateSlotBits;
      const OfficialHertz = ConfigRoot.Hardware.Cpu.Config.OfficialHertz;
      const NativeRax = RegisterRoot.Hardware.Cpu.NativeRax;
      const NativeRcx = RegisterRoot.Hardware.Cpu.NativeRcx;
      const NativeRdx = RegisterRoot.Hardware.Cpu.NativeRdx;
      const NativeRbx = RegisterRoot.Hardware.Cpu.NativeRbx;
      const NativeRsi = RegisterRoot.Hardware.Cpu.NativeRsi;
      const NativeR8 = RegisterRoot.Hardware.Cpu.NativeR8;
      const NativeR15 = RegisterRoot.Hardware.Cpu.NativeR15;
      const OfficialFrameWidth = GpuConfigRoot.Hardware.Gpu.Config.OfficialFrameWidth;
      const OfficialFrameHeight = GpuConfigRoot.Hardware.Gpu.Config.OfficialFrameHeight;
      const NativeRsp = RegisterRoot.Hardware.Cpu.NativeRsp;
      const encodeProgramBinary = BinaryRoot.Hardware.Cpu.encodeProgramBinary;
      const decodeProgramBinary = BinaryRoot.Hardware.Cpu.decodeProgramBinary;
      const restoreMounted = RuntimeRoot.Hardware.Cpu.restoreMounted;
      const setHertz = RuntimeRoot.Hardware.Cpu.setHertz;
      const runNativeOnCore = CoreRoot.Hardware.Cpu.runNativeOnCore;
      const readNativeOctets = CoreRoot.Hardware.Cpu.readNativeOctets;
      const writeNativeOctets = CoreRoot.Hardware.Cpu.writeNativeOctets;
      const freshNativeState = StateRoot.Hardware.Cpu.freshNativeState;
      const readNativeFrame = RuntimeRoot.Hardware.Cpu.readNativeFrame;
      const adoptNativeFrame = RuntimeRoot.Hardware.Cpu.adoptNativeFrame;
      const finishNative = RuntimeRoot.Hardware.Cpu.finishNative;
      const readRegisters = RuntimeRoot.Hardware.Cpu.readRegisters;
      const schedule = RuntimeRoot.Hardware.Cpu.schedule;
      const startedRun = RuntimeRoot.Hardware.Cpu.startedRun;
      const runGuest = RuntimeRoot.Hardware.Cpu.runGuest;
      const clearGate = RuntimeRoot.Hardware.Cpu.clearGate;
      const guestLines = LinesRoot.Hardware.Cpu.guestLines;
      const checkPrefix = "[ZerOS.Hardware.Cpu.NativeCoreCheck]";
      const core = 1;

      function fail(message: string): never {
        throw new Error(`${checkPrefix} ${message}`);
      }

      /** 把 64 位立即数写成 mov。只用于自检里的非负整数。 */
      function movImm(reg: number, value: bigint): number[] {
        const bytes = [reg < 8 ? 0x48 : 0x49, 0xb8 + (reg & 7)];
        let rest = value;
        for (let index = 0; index < 8; index += 1) {
          bytes.push(Number(rest & 0xffn));
          rest >>= 8n;
        }
        return bytes;
      }

      function cat(parts: readonly (readonly number[])[]): Uint8Array {
        let count = 0;
        for (const part of parts) {
          count += part.length;
        }
        const out = new Uint8Array(count);
        let at = 0;
        for (const part of parts) {
          out.set(part, at);
          at += part.length;
        }
        return out;
      }

      /**
       * 把一段指令写成种类 2 的动态库。
       * 只有一个导出 `add`，下标是 0。装入必须拒绝这种映像，只能接到已有序列后面。
       */
      function linkedLibrary(steps: ReturnType<typeof guestLines>): Uint8Array {
        const raw = encodeProgramBinary(steps);
        const name = "add";
        const bytes = new Uint8Array(raw.length + 16 + 1 + name.length + 4);
        bytes.set(raw);
        bytes[4] = 2;
        const view = new DataView(bytes.buffer);
        let at = raw.length;
        view.setUint16(at, 2, true);
        at += 2;
        view.setUint16(at, 0, true);
        at += 2;
        view.setUint32(at, 1, true);
        at += 4;
        view.setUint32(at, 0, true);
        at += 4;
        view.setUint32(at, 0, true);
        at += 4;
        view.setUint8(at, name.length);
        at += 1;
        for (let index = 0; index < name.length; index += 1) {
          view.setUint8(at, name.charCodeAt(index));
          at += 1;
        }
        view.setUint32(at, 0, true);
        return bytes;
      }

      function gateProgram(): Uint8Array {
        return new Uint8Array([0x0f, 0x3f, 0x02, 0xf4]);
      }

      function svcProgram(): Uint8Array {
        return new Uint8Array([
          0x48, 0xb8, 0x1a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x0f, 0x3f, 0x05, 0x01, 0x00,
          0xf4,
        ]);
      }

      function takeProgram(): Uint8Array {
        return new Uint8Array([0x0f, 0x3f, 0x04, 0x01, 0x00, 0xf4]);
      }

      function passProgram(): Uint8Array {
        return new Uint8Array([
          0x48, 0xb8, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x48, 0xb9, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x0f, 0x3f, 0x03, 0x00, 0x01,
          0xf4,
        ]);
      }

      function callProgram(): Uint8Array {
        return new Uint8Array([
          0x48, 0xb8, 0x28, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0xe8, 0x01, 0x00, 0x00, 0x00,
          0xf4,
          0x48, 0xb9, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x48, 0x01, 0xc8,
          0xc3,
        ]);
      }

      /**
       * 内存坐稳之后调用。1 号核心必须是停止的，而且没有装入程序。
       */
      export async function runNativeCoreCheck(): Promise<void> {
        const base = BigInt(DataFloor + SlotBits);
        const supervisorBase = BigInt(DataFloor + 65536);
        const imageBit = supervisorBase + 2048n;
        const libraryBit = imageBit + 4096n;
        let opened = false;
        let supervisorUsed = false;
        let sliceTouched = false;
        let guestLeft = false;
        let boundLeft = false;
        let hertzLeft = false;
        let imageLength = 0;
        let libraryLength = 0;
        try {
          const state = freshNativeState(base);
          state.reg[NativeRsp] = base / 8n + 0x200n;
          const stopped = await runNativeOnCore(core, callProgram(), state, base);
          if (stopped.kind !== "halt" || stopped.state.reg[NativeRax] !== 42n) {
            fail("the core did not return from the native call");
          }
          const stored = await readNativeOctets(core, base + 4032n, 8);
          let word = 0n;
          for (let index = 0; index < stored.length; index += 1) {
            word += BigInt(stored[index] ?? 0) << BigInt(index * 8);
          }
          if (word !== base + 120n) {
            fail("the return bit address was not stored through the core");
          }
          opened = true;
          const captured = await runGuest(0, guestLines([
            "gate",
            "place r1, 1",
            "place r2, 2",
            "capture r1, r2",
            "halt",
          ]));
          if (!captured.Ok) {
            fail(`the native frame was not captured ${captured.Message}`);
          }
          adoptNativeFrame(core, null);
          const restored = await runGuest(0, guestLines([
            "place r1, 1",
            "place r2, 2",
            "restore r1, r2",
            "halt",
          ]));
          if (!restored.Ok) {
            fail(`the native frame was not restored ${restored.Message}`);
          }
          const frame = readNativeFrame(core);
          if (frame === null) {
            fail("restore did not bring back the native registers");
          }
          if (frame.reg[NativeRax] !== 42n || frame.rip !== state.rip) {
            fail("restore did not bring back the native registers");
          }
          const escape = new Uint8Array([0x0f, 0x3f, 0x01, 0x00, 0xf4]);
          const named = await runNativeOnCore(core, escape, freshNativeState(base), base);
          if (named.kind !== "halt" || named.state.reg[NativeRax] !== BigInt(core)) {
            fail("0F 3F did not write the core ordinal");
          }
          clearGate();
          supervisorUsed = true;
          const gated = await runNativeOnCore(0, gateProgram(), freshNativeState(supervisorBase), supervisorBase);
          if (gated.kind !== "halt") {
            fail("gate did not complete");
          }
          const again = await runNativeOnCore(0, gateProgram(), freshNativeState(supervisorBase), supervisorBase);
          if (again.kind !== "fault" || again.state.rip !== supervisorBase) {
            fail("a second gate replaced the supervisor");
          }
          const caller = freshNativeState(base);
          const waiting = await runNativeOnCore(core, svcProgram(), caller, base);
          if (waiting.kind !== "wait" || waiting.state.reg[NativeRax] !== 26n || waiting.state.rip !== base + 120n) {
            fail("svc did not wait at the next instruction");
          }
          const took = await runNativeOnCore(0, takeProgram(), freshNativeState(supervisorBase), supervisorBase);
          if (took.kind !== "halt" || took.state.reg[NativeRcx] !== 1n || took.state.reg[NativeRax] !== ((1n << 32n) | 26n)) {
            fail("take did not receive the native syscall");
          }
          const passed = await runNativeOnCore(0, passProgram(), freshNativeState(supervisorBase), supervisorBase);
          if (passed.kind !== "halt") {
            fail("pass did not deliver the reply");
          }
          const before = await readRegisters(core);
          schedule(core);
          await startedRun(core);
          const after = await readRegisters(core);
          if (before.length !== after.length) {
            fail("svc wrote a ZAP register");
          }
          for (let index = 0; index < before.length; index += 1) {
            if (before[index] !== after[index]) {
              fail("svc wrote a ZAP register");
            }
          }
          const replied = readNativeFrame(core);
          if (replied === null) {
            fail("the syscall reply did not land in the native register");
          }
          if (replied.reg[NativeRcx] !== 7n || replied.reg[NativeRax] !== 26n || replied.rip !== base + 128n) {
            fail("the syscall reply did not land in the native register");
          }
          const yieldHead = cat([movImm(NativeRax, 1n), [0x0f, 0x3f, 0x0a]]);
          const yielded = cat([Array.from(yieldHead), movImm(NativeRax, 2n), [0xf4]]);
          const paused = await runNativeOnCore(core, yielded, freshNativeState(base), base);
          if (paused.kind !== "yield" || paused.state.reg[NativeRax] !== 1n || paused.state.rip !== base + BigInt(yieldHead.length) * 8n) {
            fail("yield did not stop at the next instruction");
          }
          const resumed = await runNativeOnCore(0, cat([
            movImm(NativeRax, BigInt(core)),
            [0x0f, 0x3f, 0x06, NativeRax],
            [0xf4],
          ]), freshNativeState(supervisorBase), supervisorBase);
          if (resumed.kind !== "halt") {
            fail("schedule did not resume the yielded core");
          }
          await startedRun(core);
          const continued = readNativeFrame(core);
          if (continued === null) {
            fail("schedule did not continue the native frame");
          }
          if (continued.reg[NativeRax] !== 2n || continued.rip !== base + BigInt(yielded.length) * 8n) {
            fail("schedule did not continue the native frame");
          }
          sliceTouched = true;
          const sliced = await runNativeOnCore(core, cat([
            movImm(NativeRax, 4n),
            [0x0f, 0x3f, 0x09, NativeRax],
            [0xf4],
          ]), freshNativeState(base), base);
          if (sliced.kind !== "halt") {
            fail("slice did not complete");
          }
          const quota = await runNativeOnCore(0, cat([
            movImm(NativeRax, 1n),
            movImm(NativeRcx, 12n),
            movImm(NativeRdx, BigInt(core)),
            [0x0f, 0x3f, 0x0b, NativeRbx, NativeRax, NativeRcx, NativeRdx],
            [0xf4],
          ]), freshNativeState(supervisorBase), supervisorBase);
          if (quota.kind !== "halt" || quota.state.reg[NativeRbx] !== 4n) {
            fail("query did not read the native slice");
          }
          const cleared = await runNativeOnCore(core, cat([
            movImm(NativeRax, 0n),
            [0x0f, 0x3f, 0x09, NativeRax],
            [0xf4],
          ]), freshNativeState(base), base);
          if (cleared.kind !== "halt") {
            fail("slice was not cleared");
          }
          sliceTouched = false;
          const image = encodeProgramBinary(guestLines(["place r2, 9", "halt"]));
          imageLength = image.length;
          await writeNativeOctets(0, imageBit, image);
          guestLeft = true;
          const installed = await runNativeOnCore(0, cat([
            movImm(NativeRax, 3n),
            movImm(NativeRcx, imageBit),
            movImm(NativeRdx, BigInt(image.length)),
            [0x0f, 0x3f, 0x0c, NativeRax, NativeRcx, NativeRdx],
            movImm(NativeRax, 3n),
            [0x0f, 0x3f, 0x06, NativeRax],
            [0xf4],
          ]), freshNativeState(supervisorBase), supervisorBase);
          if (installed.kind !== "halt") {
            fail("install did not schedule the target");
          }
          await startedRun(3);
          const ran = await readRegisters(3);
          if (ran[2] !== 9n) {
            fail("the installed program did not run");
          }
          const bounded = await runNativeOnCore(0, cat([
            movImm(NativeRax, 3n),
            movImm(NativeRcx, 100n),
            movImm(NativeRdx, 50n),
            [0x0f, 0x3f, 0x08, NativeRax, NativeRcx, NativeRdx],
            [0xf4],
          ]), freshNativeState(supervisorBase), supervisorBase);
          if (bounded.kind !== "halt") {
            fail("bound did not complete");
          }
          const origin = await runNativeOnCore(0, cat([
            movImm(NativeRax, 1n),
            movImm(NativeRcx, 8n),
            movImm(NativeRdx, 3n),
            [0x0f, 0x3f, 0x0b, NativeRbx, NativeRax, NativeRcx, NativeRdx],
            [0xf4],
          ]), freshNativeState(supervisorBase), supervisorBase);
          if (origin.kind !== "halt" || origin.state.reg[NativeRbx] !== 100n) {
            fail("query did not read the bound origin");
          }
          const length = await runNativeOnCore(0, cat([
            movImm(NativeRax, 1n),
            movImm(NativeRcx, 9n),
            movImm(NativeRdx, 3n),
            [0x0f, 0x3f, 0x0b, NativeRbx, NativeRax, NativeRcx, NativeRdx],
            [0xf4],
          ]), freshNativeState(supervisorBase), supervisorBase);
          if (length.kind !== "halt" || length.state.reg[NativeRbx] !== 50n) {
            fail("query did not read the bound length");
          }
          const released = await runNativeOnCore(0, cat([
            movImm(NativeRax, 3n),
            [0x0f, 0x3f, 0x07, NativeRax],
            [0xf4],
          ]), freshNativeState(supervisorBase), supervisorBase);
          if (released.kind !== "halt") {
            fail("release did not complete");
          }
          restoreMounted(3);
          guestLeft = false;
          const marked = await runNativeOnCore(core, cat([
            movImm(NativeR15, 11n),
            movImm(NativeRax, 1n),
            movImm(NativeRcx, 0xffffffffffffffffn),
            [0x48, 0x01, 0xc8],
            [0xf4],
          ]), freshNativeState(base), base);
          if (marked.kind !== "halt" || !marked.state.cf || !marked.state.zf || marked.state.of || marked.state.sf || !marked.state.pf) {
            fail("the native frame did not record flags");
          }
          if (marked.state.reg[NativeR15] !== 11n || marked.state.reg[NativeRax] !== 0n) {
            fail("the native frame did not record r15");
          }
          const held = readNativeFrame(core);
          if (held === null) {
            fail("the native frame was gone before capture");
          }
          const heldRax = held.reg[NativeRax];
          const heldRip = held.rip;
          const copied = await runNativeOnCore(0, cat([
            movImm(NativeRax, BigInt(core)),
            movImm(NativeRcx, 2n),
            [0x0f, 0x3f, 0x0d, NativeRax, NativeRcx],
            [0xf4],
          ]), freshNativeState(supervisorBase), supervisorBase);
          if (copied.kind !== "halt") {
            fail("capture did not copy the native frame");
          }
          adoptNativeFrame(core, null);
          const returned = await runNativeOnCore(0, cat([
            movImm(NativeRax, BigInt(core)),
            movImm(NativeRcx, 2n),
            [0x0f, 0x3f, 0x0e, NativeRax, NativeRcx],
            [0xf4],
          ]), freshNativeState(supervisorBase), supervisorBase);
          if (returned.kind !== "halt") {
            fail("restore did not return the native frame");
          }
          const brought = readNativeFrame(core);
          if (brought === null) {
            fail("restore did not return the native frame");
          }
          if (brought.reg[NativeRax] !== heldRax || brought.rip !== heldRip) {
            fail("restore did not return the native frame");
          }
          if (brought.cf !== held.cf || brought.zf !== held.zf || brought.sf !== held.sf || brought.of !== held.of || brought.pf !== held.pf) {
            fail("restore did not return the flags");
          }
          for (let index = 0; index < 16; index += 1) {
            if (brought.reg[index] !== held.reg[index]) {
              fail("restore did not return every register");
            }
          }
          const across = base + 480n;
          const outside = base + 1600n;
          const acrossBefore = await readNativeOctets(core, across, 8);
          const outsideBefore = await readNativeOctets(core, outside, 8);
          boundLeft = true;
          const limited = await runNativeOnCore(0, cat([
            movImm(NativeRax, BigInt(core)),
            movImm(NativeRcx, base),
            movImm(NativeRdx, 512n),
            [0x0f, 0x3f, 0x08, NativeRax, NativeRcx, NativeRdx],
            [0xf4],
          ]), freshNativeState(supervisorBase), supervisorBase);
          if (limited.kind !== "halt") {
            fail("bound did not limit the native window");
          }
          const torn = await runNativeOnCore(core, cat([
            movImm(NativeRax, 0x0101010101010101n),
            movImm(NativeRcx, base / 8n + 60n),
            [0x48, 0x89, 0x01],
            [0xf4],
          ]), freshNativeState(base), base);
          if (torn.kind !== "fault" || torn.state.rip !== base + 160n) {
            fail("a native store across the bound still completed");
          }
          const missed = await runNativeOnCore(core, cat([
            movImm(NativeRax, 0x0101010101010101n),
            movImm(NativeRcx, base / 8n + 200n),
            [0x48, 0x89, 0x01],
            [0xf4],
          ]), freshNativeState(base), base);
          if (missed.kind !== "fault" || missed.state.rip !== base + 160n) {
            fail("a native store outside the bound still completed");
          }
          restoreMounted(core);
          boundLeft = false;
          const acrossAfter = await readNativeOctets(core, across, 8);
          const outsideAfter = await readNativeOctets(core, outside, 8);
          for (let index = 0; index < 8; index += 1) {
            if (acrossBefore[index] !== acrossAfter[index] || outsideBefore[index] !== outsideAfter[index]) {
              fail("a failed native store wrote part of the word");
            }
          }
          hertzLeft = true;
          const slowed = await runNativeOnCore(0, cat([
            movImm(NativeRax, 3n),
            movImm(NativeRcx, 30n),
            [0x0f, 0x3f, 0x0f, NativeRax, NativeRcx],
            [0xf4],
          ]), freshNativeState(supervisorBase), supervisorBase);
          if (slowed.kind !== "halt") {
            fail("hertz did not change the target");
          }
          const paced = await runNativeOnCore(0, cat([
            movImm(NativeRax, 1n),
            movImm(NativeRcx, 6n),
            movImm(NativeRdx, 3n),
            [0x0f, 0x3f, 0x0b, NativeRbx, NativeRax, NativeRcx, NativeRdx],
            [0xf4],
          ]), freshNativeState(supervisorBase), supervisorBase);
          if (paced.kind !== "halt" || paced.state.reg[NativeRbx] !== 30n) {
            fail("query did not read the native hertz");
          }
          const official = await runNativeOnCore(0, cat([
            movImm(NativeRax, 3n),
            movImm(NativeRcx, BigInt(OfficialHertz)),
            [0x0f, 0x3f, 0x0f, NativeRax, NativeRcx],
            [0xf4],
          ]), freshNativeState(supervisorBase), supervisorBase);
          if (official.kind !== "halt") {
            fail("hertz did not restore the official rate");
          }
          hertzLeft = false;
          const presented = await runNativeOnCore(0, new Uint8Array([0x0f, 0x3f, 0x11, 0xf4]), freshNativeState(supervisorBase), supervisorBase);
          if (presented.kind !== "halt") {
            fail("present did not hand off the frame");
          }
          const wide = await runNativeOnCore(0, cat([
            movImm(NativeRax, 38n),
            movImm(NativeRcx, 0n),
            movImm(NativeRdx, 0n),
            movImm(NativeRbx, 0n),
            movImm(NativeRsi, 0n),
            [0x0f, 0x3f, 0x13, NativeR8, NativeRax, NativeRcx, NativeRdx, NativeRbx, NativeRsi],
            [0xf4],
          ]), freshNativeState(supervisorBase), supervisorBase);
          if (wide.kind !== "halt" || wide.state.reg[NativeR8] !== BigInt(OfficialFrameWidth)) {
            fail("accel did not read the frame width");
          }
          const high = await runNativeOnCore(0, cat([
            movImm(NativeRax, 38n),
            movImm(NativeRcx, 0x3ff0000000000000n),
            movImm(NativeRdx, 0n),
            movImm(NativeRbx, 0n),
            movImm(NativeRsi, 0n),
            [0x0f, 0x3f, 0x13, NativeR8, NativeRax, NativeRcx, NativeRdx, NativeRbx, NativeRsi],
            [0xf4],
          ]), freshNativeState(supervisorBase), supervisorBase);
          if (high.kind !== "halt" || high.state.reg[NativeR8] !== BigInt(OfficialFrameHeight)) {
            fail("accel did not read the frame height");
          }
          const callerImage = encodeProgramBinary(guestLines(["place r2, 1", "halt"]));
          const library = linkedLibrary(guestLines(["halt"]));
          const entry = BigInt(decodeProgramBinary(callerImage).length);
          if (callerImage.length > imageLength) {
            imageLength = callerImage.length;
          }
          libraryLength = library.length;
          await writeNativeOctets(0, imageBit, callerImage);
          await writeNativeOctets(0, libraryBit, library);
          guestLeft = true;
          const seated = await runNativeOnCore(0, cat([
            movImm(NativeRax, 3n),
            movImm(NativeRcx, imageBit),
            movImm(NativeRdx, BigInt(callerImage.length)),
            [0x0f, 0x3f, 0x0c, NativeRax, NativeRcx, NativeRdx],
            [0xf4],
          ]), freshNativeState(supervisorBase), supervisorBase);
          if (seated.kind !== "halt") {
            fail("the caller was not installed for attach");
          }
          const linked = await runNativeOnCore(0, cat([
            movImm(NativeRax, 3n),
            movImm(NativeRcx, libraryBit),
            movImm(NativeRdx, BigInt(library.length)),
            [0x0f, 0x3f, 0x10, NativeRbx, NativeRax, NativeRcx, NativeRdx],
            [0xf4],
          ]), freshNativeState(supervisorBase), supervisorBase);
          if (linked.kind !== "halt" || linked.state.reg[NativeRbx] !== entry) {
            fail("attach did not report the exported entry");
          }
          const detached = await runNativeOnCore(0, cat([
            movImm(NativeRax, 3n),
            [0x0f, 0x3f, 0x07, NativeRax],
            [0xf4],
          ]), freshNativeState(supervisorBase), supervisorBase);
          if (detached.kind !== "halt") {
            fail("release did not clear the attached core");
          }
          restoreMounted(3);
          guestLeft = false;
        } finally {
          finishNative(core);
          if (supervisorUsed) {
            finishNative(0);
          }
          if (sliceTouched) {
            await runNativeOnCore(core, cat([
              movImm(NativeRax, 0n),
              [0x0f, 0x3f, 0x09, NativeRax],
              [0xf4],
            ]), freshNativeState(base), base);
          }
          if (boundLeft) {
            restoreMounted(core);
          }
          if (guestLeft) {
            await runNativeOnCore(0, cat([
              movImm(NativeRax, 3n),
              [0x0f, 0x3f, 0x07, NativeRax],
              [0xf4],
            ]), freshNativeState(supervisorBase), supervisorBase);
            restoreMounted(3);
          }
          if (hertzLeft) {
            setHertz(3, OfficialHertz);
          }
          const zeros = new Uint8Array(40);
          await writeNativeOctets(core, base, zeros);
          await writeNativeOctets(core, base + 4032n, new Uint8Array(8));
          if (supervisorUsed) {
            await writeNativeOctets(0, supervisorBase, new Uint8Array(64));
          }
          if (imageLength > 0) {
            await writeNativeOctets(0, imageBit, new Uint8Array(imageLength));
          }
          if (libraryLength > 0) {
            await writeNativeOctets(0, libraryBit, new Uint8Array(libraryLength));
          }
          if (opened) {
            clearGate();
          }
        }
      }
    }
  }
}
