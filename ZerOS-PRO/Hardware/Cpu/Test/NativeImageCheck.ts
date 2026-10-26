/**
 * @module ZerOS.Hardware.Cpu.NativeImageCheck
 * @description 用默认 obrc 的原生映像核对调用和按比例访存
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只读已经编好的 ZNB1，放在一块足够盖住编译器栈和帧的缓冲里执行。
 * 不挂进上电自检，避免页面打包去读宿主文件。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 执行
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { readFileSync } from "fs";

import { ZerOS as RegisterRoot } from "../Enum/NativeRegister";
import { ZerOS as NativeRoot } from "../Native/NativeRun";
import { ZerOS as StateRoot } from "../Structure/NativeState";

/* -------------------------------------------------------------------------- */
/* 2. 执行                                                                     */
/* -------------------------------------------------------------------------- */

const runNative = NativeRoot.Hardware.Cpu.runNative;
const freshNativeState = StateRoot.Hardware.Cpu.freshNativeState;
const NativeRbx = RegisterRoot.Hardware.Cpu.NativeRbx;
const NativeRsp = RegisterRoot.Hardware.Cpu.NativeRsp;
const NativeRbp = RegisterRoot.Hardware.Cpu.NativeRbp;
const NativeR12 = RegisterRoot.Hardware.Cpu.NativeR12;
const NativeR13 = RegisterRoot.Hardware.Cpu.NativeR13;
const NativeR14 = RegisterRoot.Hardware.Cpu.NativeR14;
const NativeR15 = RegisterRoot.Hardware.Cpu.NativeR15;
const checkPrefix = "[ZerOS.Hardware.Cpu.NativeImageCheck]";

/** 映像从位地址 0 放起。12 个八位组的头之后，第一条代码在位地址 96。 */
const entryBit = 96n;
/** 第一格。后面每一格再隔 64 位。 */
const firstBit = 2097152n;
const secondBit = 2097216n;
const thirdBit = 2097280n;
const fourthBit = 2097344n;
/** 入口把 rsp 设成 kUi 的八位组地址。返回后应仍是这个值。 */
const entryRsp = 8835072n;
/** 盖住 kUi 八位组 8835072 和 kFrame 八位组 8841216。 */
const bufferOctets = 9_000_000;

function fail(message: string): never {
  throw new Error(`${checkPrefix} ${message}`);
}

function wordAt(memory: Uint8Array, bit: bigint): bigint {
  const octet = Number(bit / 8n);
  let value = 0n;
  for (let index = 0; index < 8; index += 1) {
    const byte = memory[octet + index];
    if (byte === undefined) {
      fail(`word missing at bit ${bit.toString()}`);
    }
    value += BigInt(byte) << BigInt(index * 8);
  }
  return value;
}

/** 在字节里找一段 ASCII。readFileSync 这里只有单参数形式，返回的是字节而不是字符串。 */
function containsAscii(file: Uint8Array, text: string): boolean {
  const needle: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    needle.push(text.charCodeAt(index));
  }
  for (let index = 0; index + needle.length <= file.length; index += 1) {
    let same = true;
    for (let at = 0; at < needle.length; at += 1) {
      if (file[index + at] !== needle[at]) {
        same = false;
        break;
      }
    }
    if (same) {
      return true;
    }
  }
  return false;
}

/** 映像里要有 call，以及比例 8 的 SIB 存储。 */
function hasCallAndScale(file: Uint8Array): boolean {
  let call = false;
  let scaled = false;
  for (let index = 0; index + 4 < file.length; index += 1) {
    if (file[index] === 0xe8) {
      call = true;
    }
    const rex = file[index] ?? 0;
    const opcode = file[index + 1] ?? 0;
    const modrm = file[index + 2] ?? 0;
    const sib = file[index + 3] ?? 0;
    if (rex >= 0x48 && rex <= 0x4f && opcode === 0x89 && (modrm & 0xc7) === 0x44 && (sib >> 6) === 3) {
      scaled = true;
    }
  }
  return call && scaled;
}

function runImage(path: string): void {
  const file = readFileSync(path);
  if (file.length < 16 || file[0] !== 0x5a || file[1] !== 0x4e || file[2] !== 0x42 || file[3] !== 0x31) {
    fail("image is not ZNB1");
  }
  if (!hasCallAndScale(file)) {
    fail("image has no call or scaled store");
  }
  const zap = readFileSync(`${path}.zap`);
  if (!containsAscii(zap, "or r6,") || !containsAscii(zap, "sti.64 r4, r0") || !containsAscii(zap, "call ")) {
    fail("zap does not pass six integer arguments");
  }
  const memory = new Uint8Array(bufferOctets);
  memory.set(file.subarray(0, Math.min(file.length, memory.length)), 0);
  const state = freshNativeState(entryBit);
  state.reg[NativeRbx] = 11n;
  state.reg[NativeRbp] = 13n;
  state.reg[NativeR12] = 17n;
  state.reg[NativeR13] = 19n;
  state.reg[NativeR14] = 23n;
  state.reg[NativeR15] = 29n;
  const stopped = runNative(
    state,
    {
      limitBit: BigInt(memory.length) * 8n,
      load(bit: bigint): number {
        return memory[Number(bit / 8n)] ?? 0;
      },
      store(bit: bigint, value: number): void {
        const index = Number(bit / 8n);
        if (index < 0 || index >= memory.length) {
          fail(`store outside buffer at bit ${bit.toString()}`);
        }
        memory[index] = value & 0xff;
      },
    },
    100000,
  );
  if (stopped.kind !== "halt") {
    const rip = stopped.state.rip;
    const at = Number(rip / 8n);
    const shown: number[] = [];
    for (let index = 0; index < 16; index += 1) {
      const byte = memory[at + index];
      if (byte === undefined) {
        break;
      }
      shown.push(byte);
    }
    fail(`did not halt at rip ${rip.toString()} bytes ${shown.join(",")}`);
  }
  const first = wordAt(memory, firstBit);
  const second = wordAt(memory, secondBit);
  const third = wordAt(memory, thirdBit);
  const fourth = wordAt(memory, fourthBit);
  if (first !== 42n || second !== 43n || third !== 654322n || fourth !== 654321n) {
    fail(`memory is ${first.toString()}, ${second.toString()}, ${third.toString()}, ${fourth.toString()}`);
  }
  const kept = stopped.state.reg;
  if (
    kept[NativeRbx] !== 11n ||
    kept[NativeRbp] !== 13n ||
    kept[NativeR12] !== 17n ||
    kept[NativeR13] !== 19n ||
    kept[NativeR14] !== 23n ||
    kept[NativeR15] !== 29n
  ) {
    fail("callee-saved registers changed");
  }
  if (kept[NativeRsp] !== entryRsp) {
    fail(`rsp is ${kept[NativeRsp]?.toString() ?? "missing"}`);
  }
  console.log("native-image-ok");
}

const imagePath = (globalThis as { process?: { argv?: readonly string[] } }).process?.argv?.[2];
if (imagePath === undefined || imagePath.length === 0) {
  fail("missing image path");
}
runImage(imagePath);
