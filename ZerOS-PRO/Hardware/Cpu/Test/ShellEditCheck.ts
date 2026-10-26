/**
 * @module ZerOS.Hardware.Cpu.ShellEditCheck
 * @description 跑行编辑、拆词和路径整理的原生自检
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只读已经编好的 ZNB1。映像自己把用例数、失败数和第一处失败写在三个固定位址。
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
const checkPrefix = "[ZerOS.Hardware.Cpu.ShellEditCheck]";

/** 映像从位地址 0 放起。12 个八位组的头之后，第一条代码在位地址 96。 */
const entryBit = 96n;
/** 用例数、失败数、第一处失败。相邻隔 64 位。 */
const casesBit = 2097152n;
const failsBit = 2097216n;
const firstBit = 2097280n;
/**
 * 映像必须用 -slot 1 编。0 号槽的编译器栈从位地址 1048576 起，
 * 会和这份超过 128KiB 的代码叠在一起。1 号槽把栈挪到代码后面。
 * 缓冲要盖住 1 号槽的堆。
 */
const bufferOctets = 56_000_000;
/** 拆词函数很大，一整套用例要留够步数。 */
const stepLimit = 200_000_000;

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
  const state = freshNativeState(entryBit);
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
    stepLimit,
  );
  if (stopped.kind !== "halt") {
    const cases = wordAt(memory, casesBit);
    const fails = wordAt(memory, failsBit);
    const first = wordAt(memory, firstBit);
    const rip = stopped.state.rip;
    fail(`did not halt (${stopped.kind}) rip ${rip.toString()} after ${cases.toString()} cases, ${fails.toString()} fails, first ${first.toString()}`);
  }
  const cases = wordAt(memory, casesBit);
  const fails = wordAt(memory, failsBit);
  const first = wordAt(memory, firstBit);
  if (cases < 80n || fails !== 0n || first !== 0n) {
    fail(`cases ${cases.toString()}, fails ${fails.toString()}, first ${first.toString()}`);
  }
  console.log(`shell-edit-ok ${cases.toString()}`);
}

const imagePath = (globalThis as { process?: { argv?: readonly string[] } }).process?.argv?.[2];
if (imagePath === undefined || imagePath.length === 0) {
  fail("missing image path");
}
runImage(imagePath);
