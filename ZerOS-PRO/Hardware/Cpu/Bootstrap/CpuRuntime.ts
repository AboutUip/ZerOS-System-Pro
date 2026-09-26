/**
 * @module ZerOS.Hardware.Cpu.CpuRuntime
 * @description CPU 主体：调度、执行入口、核心间保持位
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只在 CPU 线程里使用。核心 Worker 由主板创建；这里保存主板交来的端口。
 * 调度和 Pass / Take 不经过主板。Place 与 Add 只改核心上的寄存器。
 * Load / Store 把一条访存命令交给那个核心，由核心送给主板。
 * 不创建进程，也不解释一段程序。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 核心表
 *   3. 调度与传递
 *   4. 执行
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as ConfigRoot } from "../Config/CpuConfig";
import { ZerOS as ClockRoot } from "../../Clock/Bootstrap/HostClock";
import { ZerOS as CoreRunStateRoot } from "../Enum/CoreRunState";
import { ZerOS as MetricKindRoot } from "../Enum/MetricKind";
import { ZerOS as HertzRoot } from "../Structure/Hertz";
import { ZerOS as OpcodeRoot } from "../../Motherboard/Enum/MemoryOpcode";
import { ZerOS as DirectionRoot } from "../../Motherboard/Enum/ChannelDirection";
import { type ZerOS as CommandResultRoot } from "../Structure/CpuCommandResult";
import { type ZerOS as InstructionRoot } from "../Structure/CpuInstruction";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      type CoreRunState = CoreRunStateRoot.Hardware.Cpu.CoreRunState;
      type CpuCommandResult = CommandResultRoot.Hardware.Cpu.CpuCommandResult;
      type CpuInstruction = InstructionRoot.Hardware.Cpu.CpuInstruction;

      const CoreCountMin = ConfigRoot.Hardware.Cpu.Config.CoreCountMin;
      const CoreCountMax = ConfigRoot.Hardware.Cpu.Config.CoreCountMax;
      const RegisterCount = ConfigRoot.Hardware.Cpu.Config.RegisterCount;
      const OfficialHertz = ConfigRoot.Hardware.Cpu.Config.OfficialHertz;
      const adoptClock = ClockRoot.Hardware.Clock.adoptClock;
      const clockOrigin = ClockRoot.Hardware.Clock.clockOrigin;
      const waitSpan = ClockRoot.Hardware.Clock.waitSpan;
      const MetricHertz = MetricKindRoot.Hardware.Cpu.MetricHertz;
      const MetricExecuted = MetricKindRoot.Hardware.Cpu.MetricExecuted;
      const isHertz = HertzRoot.Hardware.Cpu.isHertz;
      const CoreStateHalted = CoreRunStateRoot.Hardware.Cpu.CoreStateHalted;
      const CoreStateRunning = CoreRunStateRoot.Hardware.Cpu.CoreStateRunning;
      const memoryOpcodeDirection = OpcodeRoot.Hardware.Motherboard.memoryOpcodeDirection;
      const toMemoryOpcode = OpcodeRoot.Hardware.Motherboard.toMemoryOpcode;
      const ChannelDirectionRead = DirectionRoot.Hardware.Motherboard.ChannelDirectionRead;
      const runtimePrefix = "[ZerOS.Hardware.Cpu.CpuRuntime]";

      interface MountedCore {
        readonly port: MessagePort;
        state: CoreRunState;
        latch: bigint | null;
        /** 核心还没回答时，完成函数挂在这里。 */
        pending: ((result: CpuCommandResult) => void) | null;
        pendingReject: ((error: Error) => void) | null;
        peek: ((value: bigint) => void) | null;
        /** 把一段查询结果交给核心记住。不计入已完成命令。 */
        fill: (() => void) | null;
        fillReject: ((error: Error) => void) | null;
        /** 宿主读取寄存器映像。与命令完成分开，停止后也能读。 */
        image: ((values: readonly bigint[]) => void) | null;
        /** 一段只碰寄存器的指令在核心里跑完后的回答。 */
        burst: ((cursor: number, executed: number) => void) | null;
        burstReject: ((error: Error) => void) | null;
        /** 当前频率。挂上时是官方标定，之后可以改，但不能超出协议范围。 */
        Hertz: number;
        /** 这个核心已经完成的命令条数。失败的命令不计入。 */
        Executed: number;
        /** 节拍起点。改频率时重新记下，避免沿用旧间隔。 */
        paceOrigin: number;
        /** 从起点起已经排过的拍数。 */
        paceIndex: number;
      }

      /** 这一份实现声明的核心数。挂载不得超过它。 */
      let declaredCoreCount = 0;

      /** 正在跑一段指令的核心。固件和客程序共用，避免两段同时写同一组寄存器。 */
      const sequenceBusy = new Set<number>();

      const cores = new Map<number, MountedCore>();

      function fail(message: string): never {
        throw new Error(`${runtimePrefix} ${message}`);
      }

      function requireOrdinal(ordinal: number): MountedCore {
        if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= declaredCoreCount) {
          fail("核心编号不在这份实现声明的范围里");
        }
        const core = cores.get(ordinal);
        if (core === undefined) {
          fail("核心还没有挂载");
        }
        return core;
      }

      /** 记录实现声明的核心数。只能在坐座时写一次。 */
      export function declareCoreCount(coreCount: number): void {
        if (!Number.isInteger(coreCount) || coreCount < CoreCountMin || coreCount > CoreCountMax) {
          fail("核心数声明不在 1 到 256");
        }
        declaredCoreCount = coreCount;
      }

      export function declaredCount(): number {
        return declaredCoreCount;
      }

      let cpuId = "";
      let cpuVendor = "";
      let cpuProtocol = "";

      /** 坐座时记下插头标识。查询指令按字符读出，不在这里解释用途。 */
      export function noteCpuIdentity(id: string, vendor: string, protocol: string): void {
        cpuId = id;
        cpuVendor = vendor;
        cpuProtocol = protocol;
      }

      function identityChar(text: string, index: number): bigint {
        if (!Number.isInteger(index) || index < 0 || index >= text.length) {
          return 0n;
        }
        return BigInt(text.charCodeAt(index));
      }

      /** 座位 1 的字段。0 核心数，1 寄存器个数，2 至 4 是标识字符，5 至 7 是某个核心的状态、Hz、条数。 */
      function queryCpu(field: number, index: number): bigint {
        if (field === 0) {
          return BigInt(declaredCoreCount);
        }
        if (field === 1) {
          return BigInt(RegisterCount);
        }
        if (field === 2) {
          return identityChar(cpuId, index);
        }
        if (field === 3) {
          return identityChar(cpuVendor, index);
        }
        if (field === 4) {
          return identityChar(cpuProtocol, index);
        }
        const core = requireOrdinal(index);
        if (field === 5) {
          return BigInt(core.state);
        }
        if (field === 6) {
          return BigInt(core.Hertz);
        }
        if (field === 7) {
          return BigInt(core.Executed);
        }
        fail("没有这种 CPU 字段");
      }

      /**
       * 主板挂上一个核心后，把 CPU 这一侧的端口交进来。
       * 新核心处于停止。主板不负责把它调成执行中。
       */
      export function acceptMountedCore(ordinal: number, port: MessagePort): void {
        if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= declaredCoreCount) {
          fail("拒绝挂载超出声明的核心");
        }
        if (cores.has(ordinal)) {
          fail("这个核心已经挂着");
        }
        const core: MountedCore = {
          port,
          state: CoreStateHalted,
          latch: null,
          pending: null,
          pendingReject: null,
          peek: null,
          fill: null,
          fillReject: null,
          image: null,
          burst: null,
          burstReject: null,
          Hertz: OfficialHertz,
          Executed: 0,
          paceOrigin: clockOrigin(),
          paceIndex: 0,
        };
        port.onmessage = (event: MessageEvent): void => {
          onCoreMessage(core, event.data as unknown);
        };
        cores.set(ordinal, core);
      }

      /** 主板强制卸载之后，这个编号立刻不可调度。 */
      export function dropCore(ordinal: number): void {
        const core = cores.get(ordinal);
        if (core === undefined) {
          return;
        }
        const reject = core.pendingReject ?? core.fillReject;
        cores.delete(ordinal);
        if (reject !== null) {
          reject(new Error(`${runtimePrefix} 核心已被强制卸载`));
        }
      }

      function onCoreMessage(core: MountedCore, data: unknown): void {
        if (typeof data !== "object" || data === null || Array.isArray(data)) {
          return;
        }
        const record = data as Record<string, unknown>;
        if (record["kind"] === "image") {
          const resolve = core.image;
          core.image = null;
          if (resolve === null) {
            return;
          }
          const values = record["registers"];
          if (!Array.isArray(values) || values.length !== RegisterCount) {
            return;
          }
          const registers: bigint[] = [];
          for (const item of values) {
            if (typeof item !== "bigint") {
              return;
            }
            registers.push(item);
          }
          resolve(registers);
          return;
        }
        if (record["kind"] === "burst") {
          const resolve = core.burst;
          const reject = core.burstReject;
          core.burst = null;
          core.burstReject = null;
          if (resolve === null || reject === null) {
            return;
          }
          if (record["ok"] !== true) {
            const message = record["message"];
            reject(new Error(typeof message === "string" ? message : `${runtimePrefix} 核心执行失败`));
            return;
          }
          const cursor = record["cursor"];
          const executed = record["executed"];
          if (typeof cursor !== "number" || typeof executed !== "number") {
            reject(new Error(`${runtimePrefix} 本地执行的回答不完整`));
            return;
          }
          resolve(cursor, executed);
          return;
        }
        if (record["kind"] === "peek") {
          const resolve = core.peek;
          core.peek = null;
          if (resolve === null) {
            return;
          }
          const value = record["value"];
          if (record["ok"] !== true || typeof value !== "bigint") {
            return;
          }
          resolve(value);
          return;
        }
        if (record["kind"] === "filled") {
          const resolve = core.fill;
          const reject = core.fillReject;
          core.fill = null;
          core.fillReject = null;
          if (resolve === null || reject === null) {
            return;
          }
          if (record["ok"] !== true) {
            const message = record["message"];
            reject(new Error(typeof message === "string" ? message : `${runtimePrefix} 查询记录失败`));
            return;
          }
          resolve();
          return;
        }
        const resolve = core.pending;
        const reject = core.pendingReject;
        core.pending = null;
        core.pendingReject = null;
        if (resolve === null || reject === null) {
          return;
        }
        if (record["ok"] !== true) {
          const message = record["message"];
          reject(new Error(typeof message === "string" ? message : `${runtimePrefix} 核心执行失败`));
          return;
        }
        core.Executed += 1;
        const isStore = record["isStore"] === true;
        const value = record["value"];
        resolve({
          IsStore: isStore,
          Value: typeof value === "bigint" ? value : 0n,
        });
      }

      /** 已挂载核心进入执行中。 */
      export function schedule(ordinal: number): void {
        const core = requireOrdinal(ordinal);
        core.state = CoreStateRunning;
        core.port.postMessage({ kind: "state", running: true });
      }

      /** 已挂载核心进入停止。停止后不再执行命令。 */
      export function halt(ordinal: number): void {
        const core = requireOrdinal(ordinal);
        core.state = CoreStateHalted;
        core.port.postMessage({ kind: "state", running: false });
      }

      /** 读取运行状态。 */
      export function coreState(ordinal: number): CoreRunState {
        return requireOrdinal(ordinal).state;
      }

      function numberFromRegister(value: bigint): number {
        if (value < -16777216n || value > 0xffffffffn) {
          fail("寄存器里的整数超出范围");
        }
        return Number(value);
      }

      /** 读执行中核心的一个寄存器。不计入命令条数，也不占一拍。 */
      function peekRegister(ordinal: number, register: number): Promise<bigint> {
        const core = requireOrdinal(ordinal);
        if (core.state !== CoreStateRunning) {
          fail("核心不在执行中");
        }
        if (core.peek !== null || core.pending !== null) {
          fail("核心还有一条命令没做完");
        }
        return new Promise((resolve): void => {
          core.peek = resolve;
          core.port.postMessage({ kind: "peek", register });
        });
      }

      /**
       * 把一批查询结果交给核心。
       * 标识字符问过一次之后，后面的同页重画不再逐字停下来。不计入命令条数。
       */
      function rememberQuery(
        ordinal: number,
        seat: number,
        field: number,
        index: number,
        values: readonly bigint[],
      ): Promise<void> {
        const core = requireOrdinal(ordinal);
        if (core.state !== CoreStateRunning) {
          fail("核心不在执行中");
        }
        if (core.pending !== null || core.peek !== null || core.fill !== null) {
          fail("核心还有一条命令没做完");
        }
        return new Promise((resolve, reject): void => {
          core.fill = resolve;
          core.fillReject = reject;
          core.port.postMessage({ kind: "query-fill", seat, field, index, values });
        });
      }

      /**
       * 改一个已挂载核心记下的 Hz。
       * 不在 1 到 1000000000 时失败，原来的频率和节拍都不变。
       */
      export function setHertz(ordinal: number, hertz: number): void {
        const core = requireOrdinal(ordinal);
        if (!isHertz(hertz)) {
          fail("Hz 不在 1 到 1000000000");
        }
        core.Hertz = hertz;
        core.paceOrigin = performance.now();
        core.paceIndex = 0;
      }

      /**
       * 主板把上电记下的起点送过来。
       * 此后新挂上的核心从这一点开始记账。
       */
      export function adoptHostClock(value: number): void {
        adoptClock(value);
      }

      /**
       * 按这个核心当前的 Hz 等到下一拍。
       * 节拍是绝对的：起点 + 拍号 × 1000 / Hz。
       * 不足 1 毫秒不挂起，一个宿主节拍里可以连续送出多条命令。
       */
      function waitPace(core: MountedCore): Promise<void> {
        core.paceIndex += 1;
        const deadline = core.paceOrigin + (core.paceIndex * 1000) / core.Hertz;
        const delay = deadline - performance.now();
        return waitSpan(delay);
      }

      /**
       * 把一条命令交给执行中的核心，并等待它回答。
       * 送出之前先按该核心的 Hz 等一拍。
       */
      function beginCommand(
        ordinal: number,
        message: Record<string, unknown>,
      ): Promise<CpuCommandResult> {
        const core = requireOrdinal(ordinal);
        if (core.state !== CoreStateRunning) {
          fail("核心不在执行中");
        }
        if (core.pending !== null) {
          fail("核心还有一条命令没做完");
        }
        return waitPace(core).then((): Promise<CpuCommandResult> => {
          return new Promise((resolve, reject): void => {
            core.pending = resolve;
            core.pendingReject = reject;
            core.port.postMessage(message);
          });
        });
      }

      /**
       * 读出一个核心已经记下的指标。
       * 0 是当前 Hz，1 是已完成命令条数。别的取值失败，不改记录。
       */
      export function metric(ordinal: number, kind: number): bigint {
        const core = requireOrdinal(ordinal);
        if (kind === MetricHertz) {
          return BigInt(core.Hertz);
        }
        if (kind === MetricExecuted) {
          return BigInt(core.Executed);
        }
        fail("没有这种核心指标");
      }

      function requireRegister(register: number): void {
        if (!Number.isInteger(register) || register < 0 || register >= RegisterCount) {
          fail("寄存器编号不在 0 到 7");
        }
      }

      function localOp(op: string): boolean {
        return op === "place" || op === "add" || op === "eq" || op === "sub" || op === "udiv" || op === "umod" || op === "mul" || op === "div" || op === "mod" || op === "and" || op === "or" || op === "xor" || op === "shl" || op === "shr" || op === "lt" || op === "le" || op === "gt" || op === "ge" || op === "not" || op === "itof" || op === "fadd" || op === "fsub" || op === "fmul" || op === "fdiv" || op === "fpow" || op === "fmod" || op === "feq" || op === "jz" || op === "jnz" || op === "jmp" || op === "ret" || op === "link" || op === "call";
      }

      /**
       * 把从 cursor 开始、只改寄存器的一段交给核心一次做完。
       * 不写回寄存器的显卡命令也由核心排成一队一次送出。
       * 碰到访存、端口、要回编号的显卡命令或停机就停在那一条，由调用方单独送出。
       */
      function runBurst(
        ordinal: number,
        cursor: number,
        steps: readonly CpuInstruction[] | null,
      ): Promise<{ readonly cursor: number; readonly executed: number }> {
        const core = requireOrdinal(ordinal);
        if (core.state !== CoreStateRunning) {
          fail("核心不在执行中");
        }
        if (core.pending !== null || core.burst !== null) {
          fail("核心还有一条命令没做完");
        }
        return new Promise((resolve, reject): void => {
          core.burst = (next, executed): void => {
            resolve({ cursor: next, executed });
          };
          core.burstReject = reject;
          if (steps === null) {
            core.port.postMessage({ kind: "burst", cursor });
            return;
          }
          core.port.postMessage({ kind: "burst", cursor, steps });
        });
      }

      /** 把整数写入该核心的一个寄存器。不访问存储。 */
      export function place(ordinal: number, register: number, data: bigint): Promise<CpuCommandResult> {
        requireRegister(register);
        return beginCommand(ordinal, { kind: "place", register, data });
      }

      /**
       * 目的寄存器等于左、右寄存器的精确和。
       * 三个编号都先检查，再交给核心。核心先读后写。
       */
      export function add(
        ordinal: number,
        destination: number,
        left: number,
        right: number,
      ): Promise<CpuCommandResult> {
        requireRegister(destination);
        requireRegister(left);
        requireRegister(right);
        return beginCommand(ordinal, { kind: "add", destination, left, right });
      }

      /**
       * 把一条双寄存器运算交给核心。
       * 乘法、带符号除法、位运算和二进制 64 浮点都走这里。
       */
      export function binary(
        ordinal: number,
        kind: "mul" | "div" | "mod" | "and" | "or" | "xor" | "shl" | "shr" | "fadd" | "fsub" | "fmul" | "fdiv" | "fpow" | "fmod" | "lt" | "le" | "gt" | "ge" | "feq",
        destination: number,
        left: number,
        right: number,
      ): Promise<CpuCommandResult> {
        requireRegister(destination);
        requireRegister(left);
        requireRegister(right);
        return beginCommand(ordinal, { kind, destination, left, right });
      }

      /** 读访存的结果写入寄存器。写操作码在这里就被拒绝。 */
      export function load(
        ordinal: number,
        opcode: number,
        address: bigint,
        register: number,
      ): Promise<CpuCommandResult> {
        requireRegister(register);
        const memoryOpcode = toMemoryOpcode(opcode);
        if (memoryOpcode === null || memoryOpcodeDirection(memoryOpcode) !== ChannelDirectionRead) {
          fail("Load 只接受读操作码");
        }
        return beginCommand(ordinal, { kind: "load", opcode, address, register });
      }

      /** 把寄存器里的整数写进存储。读操作码在这里就被拒绝。 */
      export function store(
        ordinal: number,
        opcode: number,
        address: bigint,
        register: number,
      ): Promise<CpuCommandResult> {
        requireRegister(register);
        const memoryOpcode = toMemoryOpcode(opcode);
        if (memoryOpcode === null || memoryOpcodeDirection(memoryOpcode) === ChannelDirectionRead) {
          fail("Store 只接受写操作码");
        }
        return beginCommand(ordinal, { kind: "store", opcode, address, register });
      }

      /** 把一条显卡命令交给核心。核心读寄存器后送给主板，主板再交给显卡。 */
      export function gpu(ordinal: number, message: Record<string, unknown>): Promise<CpuCommandResult> {
        return beginCommand(ordinal, message);
      }

      /**
       * 从第 0 条开始执行。jz / jnz 可以改下一条的编号。
       * 遇到 halt 或序列结束就停止该核心。一条失败则不再取下一条。
       * 不把每一行指令文本送出线程。页面收到后会直接丢掉，
       * 而每一条都会先占住 CPU 线程，再占住主板线程，键盘和访存就排在后面。
       */
      export async function runSequence(
        ordinal: number,
        steps: readonly CpuInstruction[],
      ): Promise<void> {
        if (sequenceBusy.has(ordinal)) {
          fail("这个核心正在执行另一段程序");
        }
        sequenceBusy.add(ordinal);
        let cursor = 0;
        try {
        schedule(ordinal);
        while (cursor < steps.length) {
          const span = await runBurst(ordinal, cursor, cursor === 0 ? steps : null);
          requireOrdinal(ordinal).Executed += span.executed;
          cursor = span.cursor;
          if (cursor >= steps.length) {
            break;
          }
          const step = steps[cursor];
          if (step !== undefined && localOp(step.Op)) {
            if (span.executed < 1) {
              fail("本地执行没有前进");
            }
            continue;
          }
          if (step === undefined) {
            break;
          }
          if (step.Op === "halt") {
            halt(ordinal);
            return;
          }
          if (step.Op === "jz" || step.Op === "jnz") {
            await waitPace(requireOrdinal(ordinal));
            const condition = await peekRegister(ordinal, step.Condition);
            const taken = step.Op === "jz" ? condition === 0n : condition !== 0n;
            requireOrdinal(ordinal).Executed += 1;
            if (taken) {
              if (!Number.isInteger(step.Target) || step.Target < 0 || step.Target >= steps.length) {
                fail("跳转目标不在这段指令里");
              }
              cursor = step.Target;
              continue;
            }
            cursor += 1;
            continue;
          }
          if (step.Op === "link" || step.Op === "call") {
            await place(ordinal, step.Register, BigInt(cursor + 1));
            if (!Number.isInteger(step.Target) || step.Target < 0 || step.Target >= steps.length) {
              fail("跳转目标不在这段指令里");
            }
            cursor = step.Target;
            continue;
          }
          if (step.Op === "jmp" || step.Op === "ret") {
            await waitPace(requireOrdinal(ordinal));
            const target = numberFromRegister(await peekRegister(ordinal, step.Register));
            requireOrdinal(ordinal).Executed += 1;
            if (!Number.isInteger(target) || target < 0 || target >= steps.length) {
              fail("跳转目标不在这段指令里");
            }
            cursor = target;
            continue;
          }
          if (step.Op === "place") {
            await place(ordinal, step.Register, step.Data);
          } else if (step.Op === "add") {
            await add(ordinal, step.Destination, step.Left, step.Right);
          } else if (step.Op === "eq") {
            await beginCommand(ordinal, {
              kind: "eq",
              destination: step.Destination,
              left: step.Left,
              right: step.Right,
            });
          } else if (step.Op === "sub" || step.Op === "udiv" || step.Op === "umod" || step.Op === "mul" || step.Op === "div" || step.Op === "mod" || step.Op === "and" || step.Op === "or" || step.Op === "xor" || step.Op === "shl" || step.Op === "shr" || step.Op === "fadd" || step.Op === "fsub" || step.Op === "fmul" || step.Op === "fdiv" || step.Op === "fpow" || step.Op === "fmod" || step.Op === "lt" || step.Op === "le" || step.Op === "gt" || step.Op === "ge" || step.Op === "feq") {
            await beginCommand(ordinal, {
              kind: step.Op,
              destination: step.Destination,
              left: step.Left,
              right: step.Right,
            });
          } else if (step.Op === "not" || step.Op === "itof") {
            await beginCommand(ordinal, {
              kind: step.Op,
              destination: step.Destination,
              source: step.Source,
            });
          } else if (step.Op === "ldi") {
            const address = await peekRegister(ordinal, step.Address);
            await load(ordinal, step.Opcode, address, step.Register);
          } else if (step.Op === "sti") {
            const address = await peekRegister(ordinal, step.Address);
            await store(ordinal, step.Opcode, address, step.Register);
          } else if (step.Op === "inbox") {
            await beginCommand(ordinal, { kind: "inbox", found: step.Found, value: step.Value });
          } else if (step.Op === "xchg") {
            await beginCommand(ordinal, {
              kind: "xchg",
              port: step.Port,
              direction: step.Direction,
              data: step.Data,
            });
          } else if (step.Op === "port.state") {
            await beginCommand(ordinal, { kind: "port-state", destination: step.Destination, port: step.Port });
          } else if (step.Op === "port.char") {
            await beginCommand(ordinal, {
              kind: "port-char",
              destination: step.Destination,
              port: step.Port,
              offset: step.Offset,
            });
          } else if (step.Op === "port.byte") {
            await beginCommand(ordinal, {
              kind: "port-byte",
              destination: step.Destination,
              port: step.Port,
              field: step.Field,
              offset: step.Offset,
            });
          } else if (step.Op === "query") {
            const seat = numberFromRegister(await peekRegister(ordinal, step.Seat));
            const field = numberFromRegister(await peekRegister(ordinal, step.Field));
            const index = numberFromRegister(await peekRegister(ordinal, step.Index));
            if (seat === 1) {
              const value = queryCpu(field, index);
              if (field === 2 || field === 3 || field === 4) {
                const values: bigint[] = [];
                for (let stepIndex = 0; stepIndex < 32; stepIndex += 1) {
                  values.push(queryCpu(field, index + stepIndex));
                }
                await rememberQuery(ordinal, seat, field, index, values);
              } else if (field === 0 || field === 1) {
                await rememberQuery(ordinal, seat, field, index, [value]);
              }
              await place(ordinal, step.Register, value);
            } else {
              await beginCommand(ordinal, {
                kind: "query",
                register: step.Register,
                seat: step.Seat,
                field: step.Field,
                index: step.Index,
              });
            }
          } else if (step.Op === "load") {
            await load(ordinal, step.Opcode, step.Address, step.Register);
          } else if (step.Op === "store") {
            await store(ordinal, step.Opcode, step.Address, step.Register);
          } else if (step.Op === "gpu.clear") {
            await gpu(ordinal, { kind: "gpu", gpuOp: "clear", register: step.Register });
          } else if (step.Op === "gpu.plot") {
            await gpu(ordinal, { kind: "gpu", gpuOp: "plot", x: step.X, y: step.Y, pixel: step.Pixel });
          } else if (step.Op === "gpu.character") {
            await gpu(ordinal, {
              kind: "gpu",
              gpuOp: "character",
              x: step.X,
              y: step.Y,
              code: step.Code,
              foreground: step.Foreground,
              background: step.Background,
            });
          } else if (step.Op === "gpu.box") {
            await gpu(ordinal, {
              kind: "gpu",
              gpuOp: "box",
              register: step.Register,
              parent: step.Parent,
              x: step.X,
              y: step.Y,
              width: step.Width,
              height: step.Height,
              fill: step.Fill,
            });
          } else if (step.Op === "gpu.text") {
            await gpu(ordinal, {
              kind: "gpu",
              gpuOp: "text",
              register: step.Register,
              parent: step.Parent,
              x: step.X,
              y: step.Y,
              width: step.Width,
              height: step.Height,
            });
          } else if (step.Op === "gpu.align") {
            await gpu(ordinal, { kind: "gpu", gpuOp: "align", node: step.Node, alignX: step.AlignX, alignY: step.AlignY });
          } else if (step.Op === "gpu.paint") {
            await gpu(ordinal, {
              kind: "gpu",
              gpuOp: "paint",
              node: step.Node,
              foreground: step.Foreground,
              background: step.Background,
            });
          } else if (step.Op === "gpu.glyph") {
            await gpu(ordinal, { kind: "gpu", gpuOp: "glyph", node: step.Node, code: step.Code });
          } else if (step.Op === "gpu.drop") {
            await gpu(ordinal, { kind: "gpu", gpuOp: "drop", node: step.Node });
          } else if (step.Op === "gpu.hertz") {
            await gpu(ordinal, { kind: "gpu", gpuOp: "hertz", hertz: step.Hertz });
          } else if (step.Op === "gpu.metric") {
            await gpu(ordinal, { kind: "gpu", gpuOp: "metric", register: step.Register, metric: step.Kind });
          } else if (step.Op === "gpu.load") {
            await gpu(ordinal, { kind: "gpu", gpuOp: "load", register: step.Register, address: step.Address });
          } else if (step.Op === "gpu.accel") {
            await gpu(ordinal, {
              kind: "gpu",
              gpuOp: "accel",
              register: step.Register,
              operation: step.Operation,
              a: step.A,
              b: step.B,
              c: step.C,
              d: step.D,
            });
          } else if (step.Op === "gpu.store") {
            await gpu(ordinal, { kind: "gpu", gpuOp: "store", address: step.Address, value: step.Value });
          } else if (step.Op === "mem.hertz") {
            await beginCommand(ordinal, { kind: "mem-hertz", hertz: step.Hertz });
          } else if (step.Op === "mem.metric") {
            await beginCommand(ordinal, { kind: "mem-metric", register: step.Register, metric: step.Kind });
          } else if (step.Op === "hertz") {
            await waitPace(requireOrdinal(ordinal));
            const target = numberFromRegister(await peekRegister(ordinal, step.Ordinal));
            const hertz = numberFromRegister(await peekRegister(ordinal, step.Hertz));
            setHertz(target, hertz);
            requireOrdinal(ordinal).Executed += 1;
          } else if (step.Op === "metric") {
            const target = numberFromRegister(await peekRegister(ordinal, step.Ordinal));
            const kind = numberFromRegister(await peekRegister(ordinal, step.Kind));
            const value = metric(target, kind);
            await place(ordinal, step.Register, value);
          } else if (step.Op === "gpu.compose") {
            await gpu(ordinal, { kind: "gpu", gpuOp: "compose" });
          } else {
            await gpu(ordinal, { kind: "gpu", gpuOp: "present" });
          }
          cursor += 1;
        }
        halt(ordinal);
        } catch (error: unknown) {
          /* 失败的那条命令可能还占着核心。先放开并停止，后面的异常画面或下一段客程序才能再调度它。 */
          const core = cores.get(ordinal);
          if (core !== undefined) {
            core.pending = null;
            core.pendingReject = null;
            core.peek = null;
            core.fill = null;
            core.fillReject = null;
            core.image = null;
            core.burst = null;
            core.burstReject = null;
            if (core.state === CoreStateRunning) {
              halt(ordinal);
            }
          }
          throw error;
        } finally {
          sequenceBusy.delete(ordinal);
        }
      }

      /**
       * 读出核心当前的 8 个寄存器。
       * 不要求核心正在执行。这是宿主取映像，不是一条 ZAP 指令。
       */
      function readImage(ordinal: number): Promise<readonly bigint[]> {
        const core = requireOrdinal(ordinal);
        if (core.pending !== null || core.peek !== null || core.image !== null) {
          fail("核心还有一条命令没做完");
        }
        return new Promise((resolve): void => {
          core.image = resolve;
          core.port.postMessage({ kind: "image" });
        });
      }

      /**
       * 在指定核心上跑完一段指令，把异常留在返回值里。
       * 不向主板发送引导故障。核心正忙时直接失败，不打断已经在跑的那段。
       */
      export async function runGuest(
        ordinal: number,
        steps: readonly CpuInstruction[],
      ): Promise<{ readonly Ok: boolean; readonly Message: string; readonly Registers: readonly bigint[] }> {
        const empty = new Array<bigint>(RegisterCount).fill(0n);
        if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= declaredCoreCount) {
          return { Ok: false, Message: `${runtimePrefix} 没有这颗核心`, Registers: empty };
        }
        let ok = true;
        let message = "";
        try {
          await runSequence(ordinal, steps);
        } catch (error: unknown) {
          ok = false;
          message = error instanceof Error ? error.message : `${runtimePrefix} 客程序失败`;
        }
        try {
          const registers = await readImage(ordinal);
          return { Ok: ok, Message: message, Registers: registers };
        } catch (error: unknown) {
          const imageMessage = error instanceof Error ? error.message : `${runtimePrefix} 读不出寄存器`;
          return {
            Ok: false,
            Message: message.length > 0 ? message : imageMessage,
            Registers: empty,
          };
        }
      }

      /**
       * 把整数放进目标核心的空保持位。
       * 保持位已有值时失败，不覆盖。来源核心也必须已挂载。
       */
      export function pass(fromOrdinal: number, toOrdinal: number, data: bigint): void {
        requireOrdinal(fromOrdinal);
        const target = requireOrdinal(toOrdinal);
        if (target.latch !== null) {
          fail("目标核心的保持位已经有值");
        }
        target.latch = data;
        target.port.postMessage({ kind: "pass", data });
      }

      /** 取出并清空保持位。空的时候失败。 */
      export function take(ordinal: number): bigint {
        const core = requireOrdinal(ordinal);
        const value = core.latch;
        if (value === null) {
          fail("保持位是空的");
        }
        core.latch = null;
        core.port.postMessage({ kind: "take" });
        return value;
      }
    }
  }
}
