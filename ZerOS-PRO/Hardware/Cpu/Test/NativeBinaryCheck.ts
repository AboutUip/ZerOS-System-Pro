/**
 * @module ZerOS.Hardware.Cpu.NativeBinaryCheck
 * @description 可选的单项：用一份外部 busybox 核对原生入口
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 默认关闭。引导、页面、npm test、npm run check 都不加载本文件，也不寻找 busybox。
 * 新环境没有这份 ELF 时什么都不做，不报错。
 * 只有亲手执行本文件，并且 ZEROS_BUSYBOX_CHECK=1 时，才读取 ZEROS_BUSYBOX 指向的未改过的 ELF。
 * 栈上放 argc、argv、空环境和辅助向量，页长是 4096。二进制不放进仓库，路径不写死。
 * 入口走完后停在下一条尚未登记的编码，或停在第一次系统调用。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 开关（默认关闭）
 *   3. runBusyboxCheck
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { existsSync, readFileSync } from "fs";

import { ZerOS as ConfigRoot } from "../Config/CpuConfig";
import { ZerOS as RegisterRoot } from "../Enum/NativeRegister";
import { ZerOS as NativeRoot } from "../Native/NativeRun";
import { ZerOS as StateRoot } from "../Structure/NativeState";

/* -------------------------------------------------------------------------- */
/* 2. 开关（默认关闭）                                                          */
/* -------------------------------------------------------------------------- */

/** 只有明确写成 1 才打开这一项。未设置、空串和其它值都保持关闭。 */
function busyboxCheckEnabled(): boolean {
  return process.env["ZEROS_BUSYBOX_CHECK"] === "1";
}

/** 被别的模块导入时不执行。只有本文件是进程入口才看开关。 */
function invokedDirectly(): boolean {
  const entry = (process.argv[1] ?? "").replaceAll("\\", "/");
  return entry.endsWith("/NativeBinaryCheck.ts") || entry.endsWith("/NativeBinaryCheck.js");
}

if (invokedDirectly() && busyboxCheckEnabled()) {
  runBusyboxCheck();
} else if (invokedDirectly()) {
  console.log("busybox check is off");
}

/* -------------------------------------------------------------------------- */
/* 3. runBusyboxCheck                                                          */
/* -------------------------------------------------------------------------- */

function runBusyboxCheck(): void {
  const filePath = process.env["ZEROS_BUSYBOX"] ?? "";
  if (filePath.length === 0 || !existsSync(filePath)) {
    throw new Error("ZEROS_BUSYBOX_CHECK is on but ZEROS_BUSYBOX does not name a file");
  }

  const stepNative = NativeRoot.Hardware.Cpu.stepNative;
  const freshNativeState = StateRoot.Hardware.Cpu.freshNativeState;
  const NativeRax = RegisterRoot.Hardware.Cpu.NativeRax;
  const NativeRcx = RegisterRoot.Hardware.Cpu.NativeRcx;
  const NativeRdx = RegisterRoot.Hardware.Cpu.NativeRdx;
  const NativeRsp = RegisterRoot.Hardware.Cpu.NativeRsp;
  const NativeRbp = RegisterRoot.Hardware.Cpu.NativeRbp;
  const NativeRsi = RegisterRoot.Hardware.Cpu.NativeRsi;
  const NativeRdi = RegisterRoot.Hardware.Cpu.NativeRdi;
  const NativeR8 = RegisterRoot.Hardware.Cpu.NativeR8;
  const NativeR9 = RegisterRoot.Hardware.Cpu.NativeR9;
  const NativeR10 = RegisterRoot.Hardware.Cpu.NativeR10;
  const NativeR11 = RegisterRoot.Hardware.Cpu.NativeR11;
  const NativeR12 = RegisterRoot.Hardware.Cpu.NativeR12;
  const NativeR13 = RegisterRoot.Hardware.Cpu.NativeR13;
  const NativeR14 = RegisterRoot.Hardware.Cpu.NativeR14;
  const NativeR15 = RegisterRoot.Hardware.Cpu.NativeR15;
  const origin = BigInt(ConfigRoot.Hardware.Cpu.Config.MapEndBits);
  const space = ConfigRoot.Hardware.Cpu.Config.CompatSpaceBytes;
  const knownEntry = 0x4038b1n;
  const file = new Uint8Array(readFileSync(filePath));

  function u16(at: number): number {
    return (file[at] ?? 0) | ((file[at + 1] ?? 0) << 8);
  }

  function u32(at: number): number {
    return (file[at] ?? 0)
      | ((file[at + 1] ?? 0) << 8)
      | ((file[at + 2] ?? 0) << 16)
      | ((file[at + 3] ?? 0) << 24);
  }

  function u64(at: number): bigint {
    let value = 0n;
    for (let index = 0; index < 8; index += 1) {
      value |= BigInt(file[at + index] ?? 0) << BigInt(index * 8);
    }
    return value;
  }

  if (file[0] !== 0x7f || file[1] !== 0x45 || file[2] !== 0x4c || file[3] !== 0x46 || file[4] !== 2 || file[5] !== 1) {
    throw new Error("busybox is not ELF64 LSB");
  }
  if (u16(18) !== 62) {
    throw new Error("busybox is not x86-64");
  }
  const entry = u64(24);
  if (entry !== knownEntry) {
    throw new Error(`unexpected entry 0x${entry.toString(16)}`);
  }
  const phoff = Number(u64(32));
  const phentsize = u16(54);
  const phnum = u16(56);
  const mem = new Uint8Array(space);
  for (let index = 0; index < phnum; index += 1) {
    const header = phoff + index * phentsize;
    if (u32(header) !== 1) {
      continue;
    }
    const offset = Number(u64(header + 8));
    const vaddr = Number(u64(header + 16));
    const filesz = Number(u64(header + 32));
    const memsz = Number(u64(header + 40));
    if (vaddr < 0 || memsz < filesz || vaddr + memsz > space) {
      throw new Error(`load segment does not fit at 0x${vaddr.toString(16)}`);
    }
    mem.set(file.subarray(offset, offset + filesz), vaddr);
  }

  const rsp = 16772096;
  const argument = 16770000;
  mem.set(new TextEncoder().encode("busybox"), argument);
  function writeQword(at: number, value: bigint): void {
    let rest = value;
    for (let index = 0; index < 8; index += 1) {
      mem[at + index] = Number(rest & 0xffn);
      rest >>= 8n;
    }
  }
  writeQword(rsp, 1n);
  writeQword(rsp + 8, BigInt(argument));
  writeQword(rsp + 16, 0n);
  writeQword(rsp + 24, 0n);
  /* 空的环境后面必须是辅助向量。页长为 0 时后续按页对齐会落到地址 0。 */
  writeQword(rsp + 32, 6n);
  writeQword(rsp + 40, 4096n);
  writeQword(rsp + 48, 3n);
  writeQword(rsp + 56, 0x400040n);
  writeQword(rsp + 64, 4n);
  writeQword(rsp + 72, 56n);
  writeQword(rsp + 80, 5n);
  writeQword(rsp + 88, 4n);
  writeQword(rsp + 96, 9n);
  writeQword(rsp + 104, entry);
  writeQword(rsp + 112, 31n);
  writeQword(rsp + 120, BigInt(argument));
  writeQword(rsp + 128, 0n);
  writeQword(rsp + 136, 0n);

  const state = freshNativeState(origin + entry * 8n);
  state.compat = true;
  state.reg[NativeRsp] = BigInt(rsp);
  const port: StateRoot.Hardware.Cpu.NativeOctetPort = {
    limitBit: origin + BigInt(space) * 8n,
    load(bit: bigint): number {
      const user = (bit - origin) / 8n;
      if (user < 0n || user >= BigInt(space)) {
        return 0;
      }
      return mem[Number(user)] ?? 0;
    },
    store(bit: bigint, value: number): void {
      const user = (bit - origin) / 8n;
      if (user < 0n || user >= BigInt(space)) {
        return;
      }
      mem[Number(user)] = value & 255;
    },
  };

  const stepLimit = 100000;
  let steps = 0;
  let stop = "limit";
  const recent: string[] = [];
  while (steps < stepLimit) {
    const outcome = stepNative(state, port);
    if (outcome === "cont") {
      steps += 1;
      recent.push(((state.rip - origin) / 8n).toString(16));
      if (recent.length > 8) {
        recent.shift();
      }
      continue;
    }
    if (outcome === "syscall") {
      const call = state.reg[NativeRax] ?? 0n;
      const arg0 = state.reg[NativeRdi] ?? 0n;
      const arg1 = state.reg[NativeRsi] ?? 0n;
      const arg2 = state.reg[NativeRdx] ?? 0n;
      /* arch_prctl(ARCH_SET_FS)。后面的 %fs 访存要用这个基址。 */
      if (call === 0x9en && arg0 === 0x1002n) {
        state.fsbase = arg1;
        state.reg[NativeRax] = 0n;
        steps += 1;
        recent.push(((state.rip - origin) / 8n).toString(16));
        if (recent.length > 8) {
          recent.shift();
        }
        continue;
      }
      /* ioctl(TIOCGWINSZ)。写下 24 行 80 列，其它请求仍停下来。 */
      if (call === 0x10n && arg1 === 0x5413n) {
        const at = Number(arg2);
        if (at < 4096 || at + 8 > space) {
          break;
        }
        mem[at] = 24;
        mem[at + 1] = 0;
        mem[at + 2] = 80;
        mem[at + 3] = 0;
        mem[at + 4] = 0;
        mem[at + 5] = 0;
        mem[at + 6] = 0;
        mem[at + 7] = 0;
        state.reg[NativeRax] = 0n;
        steps += 1;
        recent.push(((state.rip - origin) / 8n).toString(16));
        if (recent.length > 8) {
          recent.shift();
        }
        continue;
      }
      /* getuid。探测里先按 root 返回 0，好让后面的指令继续露出来。 */
      if (call === 0x66n) {
        state.reg[NativeRax] = 0n;
        steps += 1;
        recent.push(((state.rip - origin) / 8n).toString(16));
        if (recent.length > 8) {
          recent.shift();
        }
        continue;
      }
      /* set_tid_address。返回一个线程号，清子线程指针留在 rdi。 */
      if (call === 0xdan) {
        state.reg[NativeRax] = 1n;
        steps += 1;
        recent.push(((state.rip - origin) / 8n).toString(16));
        if (recent.length > 8) {
          recent.shift();
        }
        continue;
      }
    }
    stop = typeof outcome === "string" ? outcome : outcome.kind;
    break;
  }

  const user = (state.rip - origin) / 8n;
  const bytes: string[] = [];
  const shown = Number(user);
  for (let index = 0; index < 16; index += 1) {
    bytes.push((mem[shown + index] ?? 0).toString(16).padStart(2, "0"));
  }
  if (steps < 12 || stop === "limit") {
    throw new Error(`stopped before _start finished at 0x${user.toString(16)} after ${String(steps)} steps ${stop} ${bytes.join("")}`);
  }
  const shownReg = [
    ["rax", NativeRax],
    ["rcx", NativeRcx],
    ["rdx", NativeRdx],
    ["rsp", NativeRsp],
    ["rbp", NativeRbp],
    ["rsi", NativeRsi],
    ["rdi", NativeRdi],
    ["r8", NativeR8],
    ["r9", NativeR9],
    ["r10", NativeR10],
    ["r11", NativeR11],
    ["r12", NativeR12],
    ["r13", NativeR13],
    ["r14", NativeR14],
    ["r15", NativeR15],
  ] as const;
  const regs = shownReg.map(([name, index]) => `${name}=0x${(state.reg[index] ?? 0n).toString(16)}`);
  console.log(`native-binary steps=${String(steps)} stop=${stop} user=0x${user.toString(16)} bytes=${bytes.join("")} ${regs.join(" ")}`);
  console.log(`recent ${recent.join(" ")}`);
  }
