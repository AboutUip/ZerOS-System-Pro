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

import { ZerOS as NativeRoot } from "../Native/NativeRun";
import { ZerOS as StateRoot } from "../Structure/NativeState";

/* -------------------------------------------------------------------------- */
/* 2. 执行                                                                     */
/* -------------------------------------------------------------------------- */

const runNative = NativeRoot.Hardware.Cpu.runNative;
const freshNativeState = StateRoot.Hardware.Cpu.freshNativeState;
const checkPrefix = "[ZerOS.Hardware.Cpu.NativeImageCheck]";

/** 映像从位地址 0 放起。12 个八位组的头之后，第一条代码在位地址 96。 */
const entryBit = 96n;
/** 第一格。第二格在其后 64 位，也就是下一个 long。 */
const firstBit = 2097152n;
const secondBit = 2097216n;
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

function runImage(path: string): void {
  const file = readFileSync(path);
  if (file.length < 16 || file[0] !== 0x5a || file[1] !== 0x4e || file[2] !== 0x42 || file[3] !== 0x31) {
    fail("image is not ZNB1");
  }
  const memory = new Uint8Array(bufferOctets);
  memory.set(file.subarray(0, Math.min(file.length, memory.length)), 0);
  const stopped = runNative(
    freshNativeState(entryBit),
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
  if (first !== 42n || second !== 43n) {
    fail(`memory is ${first.toString()} and ${second.toString()}`);
  }
  console.log("native-image-ok");
}

const imagePath = (globalThis as { process?: { argv?: readonly string[] } }).process?.argv?.[2];
if (imagePath === undefined || imagePath.length === 0) {
  fail("missing image path");
}
runImage(imagePath);
