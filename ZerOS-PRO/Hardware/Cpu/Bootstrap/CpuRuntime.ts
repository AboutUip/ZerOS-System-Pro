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
 * install 只替换另一颗已停止核心的指令序列，不创建进程。动态库必须用 attach 接到末尾。
 * capture 与 restore 在 8 个槽里保存或放回寄存器、下一条、已装入序列和链接目录，也不创建进程。
 * 映像用和开机相同的解码器解一次，执行时不再从那段地址取指。
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
import { ZerOS as BinaryRoot } from "../Structure/ProgramBinary";

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
      const decodeProgramImage = BinaryRoot.Hardware.Cpu.decodeProgramImage;
      type ProgramImage = BinaryRoot.Hardware.Cpu.ProgramImage;
      type ProgramSymbol = BinaryRoot.Hardware.Cpu.ProgramSymbol;
      const RelocateSlotBits = ConfigRoot.Hardware.Cpu.Config.RelocateSlotBits;
      const runtimePrefix = "[ZerOS.Hardware.Cpu.CpuRuntime]";
      /** 一次装入最多读这么多个八位组。再长就拒绝，避免一条指令扫完整条地址线。 */
      const InstallOctetLimit = 16777216;

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
        /** 装入后等着执行的指令序列。没有装入时是空。 */
        installed: CpuInstruction[] | null;
        /** 已经接到这颗核心上的导出。编号是当前序列里的指令下标。 */
        exports: ProgramSymbol[];
        /** 还没对上名字的调用。编号是要改的那条指令。 */
        imports: ProgramSymbol[];
        /** 正在把映像八位组从这颗核心读回来。 */
        span: ((bytes: Uint8Array) => void) | null;
        spanReject: ((error: Error) => void) | null;
        /** 目标核心已经把 8 个寄存器写成 0。 */
        wiped: (() => void) | null;
        /** 目标核心已经按给出的 8 个整数写好寄存器。参数是这次是否写上。 */
        planted: ((ok: boolean) => void) | null;
        /** 读回这颗核心上别人看不见的已写入八位组、临时字和帧字。 */
        cached: ((snap: PrivateOctets) => void) | null;
        cacheReject: ((error: Error) => void) | null;
        /** 私有写入已经按槽换上，或已经清掉。参数是这次是否写上。 */
        cachePlanted: ((ok: boolean) => void) | null;
        /** Schedule 拉起装入序列后的那一次执行。宿主用它等程序停下来。 */
        started: Promise<void> | null;
        /** 下次从这里继续。空表示从第一条重新开始。 */
        resumeCursor: number | null;
        /** 0 已经结束，1 时间片或 yield 停住，2 在等系统调用回复。 */
        stopKind: number;
        /** 0 表示一直跑到 halt。其它正数是每轮最多执行的指令数。 */
        sliceQuota: number;
        sliceLeft: number;
        /** 负长度表示还不限制访存。 */
        boundOrigin: bigint;
        boundLength: bigint;
        /** 系统调用的回复要写进这个寄存器。空表示没在等。 */
        svcDest: number | null;
      }

      /** 监督核。空表示还没有人调用 gate，这时装入和调度不设限。 */
      let gateOrdinal: number | null = null;

      const LineBits = BigInt(ConfigRoot.Hardware.Cpu.Config.LineBits);

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
        if (field === 8) {
          return core.boundOrigin;
        }
        if (field === 9) {
          return core.boundLength < 0n ? LineBits : core.boundLength;
        }
        if (field === 10) {
          return core.resumeCursor === null ? -1n : BigInt(core.resumeCursor);
        }
        if (field === 11) {
          return BigInt(core.stopKind);
        }
        if (field === 12) {
          return BigInt(core.sliceQuota);
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
          installed: null,
          exports: [],
          imports: [],
          span: null,
          spanReject: null,
          wiped: null,
          planted: null,
          cached: null,
          cacheReject: null,
          cachePlanted: null,
          started: null,
          resumeCursor: null,
          stopKind: 0,
          sliceQuota: 0,
          sliceLeft: 0,
          boundOrigin: 0n,
          boundLength: -1n,
          svcDest: null,
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
        const reject = core.pendingReject ?? core.fillReject ?? core.spanReject;
        cores.delete(ordinal);
        sequenceBusy.delete(ordinal);
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
        if (record["kind"] === "wiped") {
          const resolve = core.wiped;
          core.wiped = null;
          if (resolve !== null) {
            resolve();
          }
          return;
        }
        if (record["kind"] === "planted") {
          const resolve = core.planted;
          core.planted = null;
          if (resolve !== null) {
            resolve(record["ok"] === true);
          }
          return;
        }
        if (record["kind"] === "cached") {
          const resolve = core.cached;
          const reject = core.cacheReject;
          core.cached = null;
          core.cacheReject = null;
          if (resolve === null || reject === null) {
            return;
          }
          const snap = privateOctets(record);
          if (snap === null) {
            reject(new Error("capture 私有写入"));
            return;
          }
          resolve(snap);
          return;
        }
        if (record["kind"] === "cache-planted") {
          const resolve = core.cachePlanted;
          core.cachePlanted = null;
          if (resolve !== null) {
            resolve(record["ok"] === true);
          }
          return;
        }
        if (record["kind"] === "span") {
          const resolve = core.span;
          const reject = core.spanReject;
          core.span = null;
          core.spanReject = null;
          if (resolve === null || reject === null) {
            return;
          }
          const bytes = record["bytes"];
          if (record["ok"] !== true || !(bytes instanceof Uint8Array)) {
            const message = record["message"];
            reject(new Error(typeof message === "string" ? message : `${runtimePrefix} install 访存`));
            return;
          }
          resolve(bytes);
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

      /** 已挂载核心进入执行中。已装入且当前没在跑时，从第一条开始执行那段序列。 */
      export function schedule(ordinal: number): void {
        const core = requireOrdinal(ordinal);
        core.state = CoreStateRunning;
        core.port.postMessage({ kind: "state", running: true });
        if (core.installed === null || sequenceBusy.has(ordinal)) {
          return;
        }
        const steps = core.installed;
        const run = runSequence(ordinal, steps);
        core.started = run;
        void run.catch((error: unknown): void => {
          /* 核心 2 起是内核和服务。失败画到面板上。固件和沙盒仍走它们自己的失败路径。 */
          if (ordinal < 2) {
            return;
          }
          const message = error instanceof Error ? error.message : "装入的程序失败";
          globalThis.postMessage({ kind: "fault", message });
        });
      }

      /** 等最近一次由 Schedule 拉起的装入序列结束。没有拉起过就失败。 */
      export function startedRun(ordinal: number): Promise<void> {
        const started = requireOrdinal(ordinal).started;
        if (started === null) {
          fail("这颗核心没有开始执行装入的程序");
        }
        return started;
      }

      /** 已挂载核心进入停止。停止后不再执行命令。 */
      export function halt(ordinal: number): void {
        const core = requireOrdinal(ordinal);
        core.state = CoreStateHalted;
        core.port.postMessage({ kind: "state", running: false });
      }

      /**
       * 自检用过监督核之后把它交还。
       * 客程序没有对应指令。内核稍后自己 gate。
       */
      export function clearGate(): void {
        gateOrdinal = null;
      }

      function wakeGate(except: number): void {
        if (gateOrdinal === null || gateOrdinal === except) {
          return;
        }
        const gate = cores.get(gateOrdinal);
        if (gate === undefined) {
          return;
        }
        if (gate.installed === null || gate.resumeCursor === null || gate.stopKind !== 1) {
          return;
        }
        if (gate.state !== CoreStateHalted || sequenceBusy.has(gateOrdinal)) {
          return;
        }
        schedule(gateOrdinal);
      }

      function park(ordinal: number, cursor: number, kind: number): void {
        const core = requireOrdinal(ordinal);
        core.resumeCursor = cursor;
        core.stopKind = kind;
        halt(ordinal);
        wakeGate(ordinal);
      }

      function supervisor(caller: number): boolean {
        return gateOrdinal === null || caller === gateOrdinal;
      }

      function accessBits(opcode: number): number {
        if (opcode === 1 || opcode === 2) {
          return 1;
        }
        if (opcode === 3 || opcode === 4) {
          return 8;
        }
        if (opcode === 5 || opcode === 6) {
          return 16;
        }
        if (opcode === 7 || opcode === 8 || opcode === 11 || opcode === 12) {
          return 32;
        }
        if (opcode === 9 || opcode === 10 || opcode === 13 || opcode === 14) {
          return 64;
        }
        return 0;
      }

      function withinBound(ordinal: number, address: bigint, bits: number): void {
        if (gateOrdinal === ordinal) {
          return;
        }
        const core = requireOrdinal(ordinal);
        if (core.boundLength < 0n) {
          return;
        }
        if (bits < 1 || address < core.boundOrigin || address + BigInt(bits) > core.boundOrigin + core.boundLength) {
          fail("bound 访存越界");
        }
      }

      async function consume(ordinal: number, cursor: number, count: number): Promise<boolean> {
        const core = requireOrdinal(ordinal);
        if (core.sliceQuota <= 0 || count <= 0) {
          return false;
        }
        core.sliceLeft -= count;
        if (core.sliceLeft > 0) {
          return false;
        }
        /* 按这颗核心自己的 Hz 等一拍，时间片才不会把宿主占满。100MHz 时不足 1 毫秒，不会挂起。 */
        await waitPace(core);
        park(ordinal, cursor, 1);
        return true;
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
        limit: number,
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
          core.port.postMessage({
            kind: "burst",
            cursor,
            limit,
            boundOrigin: core.boundOrigin,
            boundLength: core.boundLength,
            ...(steps === null ? {} : { steps }),
          });
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
        withinBound(ordinal, address, accessBits(opcode));
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
        withinBound(ordinal, address, accessBits(opcode));
        return beginCommand(ordinal, { kind: "store", opcode, address, register });
      }

      /** 把一条显卡命令交给核心。核心读寄存器后送给主板，主板再交给显卡。 */
      export function gpu(ordinal: number, message: Record<string, unknown>): Promise<CpuCommandResult> {
        return beginCommand(ordinal, message);
      }

      function installFail(text: string): never {
        fail(`install ${text}`);
      }

      function attachFail(text: string): never {
        fail(`attach ${text}`);
      }

      function copySymbols(items: readonly ProgramSymbol[]): ProgramSymbol[] {
        const next: ProgramSymbol[] = [];
        for (const item of items) {
          next.push({ name: item.name, index: item.index });
        }
        return next;
      }

      function symbolIndex(items: readonly ProgramSymbol[], name: string): number | null {
        for (const item of items) {
          if (item.name === name) {
            return item.index;
          }
        }
        return null;
      }

      /** 跳转编号换成接入或整段换上之后的位置。不是跳转就拒绝，避免把数据指令改掉。 */
      function retarget(step: CpuInstruction, target: number, reject: (text: string) => never): CpuInstruction {
        if (step.Op === "call" || step.Op === "link") {
          return { Op: step.Op, Register: step.Register, Target: target };
        }
        if (step.Op === "jz" || step.Op === "jnz") {
          return { Op: step.Op, Condition: step.Condition, Target: target };
        }
        reject("重定位");
      }

      /** 数据立即数换成这颗核心窗口里的地址。place、load、store 以外的指令没有这份立即数。 */
      function redata(step: CpuInstruction, value: bigint, reject: (text: string) => never): CpuInstruction {
        if (step.Op === "load") {
          return { Op: "load", Opcode: step.Opcode, Address: value, Register: step.Register };
        }
        if (step.Op === "store") {
          return { Op: "store", Opcode: step.Opcode, Address: value, Register: step.Register };
        }
        if (step.Op === "place") {
          return { Op: "place", Register: step.Register, Data: value };
        }
        reject("重定位");
      }

      function shiftedTarget(addend: bigint, base: number, limit: number, reject: (text: string) => never): number {
        if (addend < 0n || addend > 0xffffffffn) {
          reject("重定位");
        }
        const target = Number(addend) + base;
        if (!Number.isSafeInteger(target) || target < 0 || target >= limit) {
          reject("重定位");
        }
        return target;
      }

      function coreOrdinal(value: bigint): number | null {
        if (value < 0n || value >= BigInt(declaredCoreCount)) {
          return null;
        }
        const ordinal = Number(value);
        if (!Number.isInteger(ordinal)) {
          return null;
        }
        return ordinal;
      }

      /** 向正在执行的核心要一段八位组。核心先交自己写过的，其余再问主板。 */
      function readSpan(ordinal: number, address: bigint, length: number): Promise<Uint8Array> {
        const core = requireOrdinal(ordinal);
        if (core.span !== null || core.pending !== null) {
          installFail("访存");
        }
        return new Promise((resolve, reject): void => {
          core.span = resolve;
          core.spanReject = reject;
          core.port.postMessage({ kind: "span", address, length });
        });
      }

      /** 把目标核心的 8 个寄存器写成给出的整数。目标这时是停止的。 */
      function plantRegisters(ordinal: number, words: readonly bigint[]): Promise<void> {
        const core = requireOrdinal(ordinal);
        if (core.planted !== null || core.pending !== null || words.length !== RegisterCount) {
          installFail("目标核心未停止");
        }
        return new Promise((resolve, reject): void => {
          core.planted = (ok: boolean): void => {
            if (ok) {
              resolve();
              return;
            }
            reject(new Error("restore 寄存器"));
          };
          core.port.postMessage({ kind: "plant", words: words.slice() });
        });
      }

      /** 从核心的回答里取出私有八位组。对不上时返回空，调用方让这条指令失败。 */
      function privateOctets(record: Record<string, unknown>): PrivateOctets | null {
        const addresses = record["addresses"];
        const bytes = record["bytes"];
        const scratch = record["scratch"];
        const frame = record["frame"];
        if (!Array.isArray(addresses) || !Array.isArray(bytes) || addresses.length !== bytes.length) {
          return null;
        }
        if (!Array.isArray(scratch) || typeof frame !== "bigint") {
          return null;
        }
        const keys: bigint[] = [];
        for (const item of addresses) {
          if (typeof item !== "bigint") {
            return null;
          }
          keys.push(item);
        }
        const octets: number[] = [];
        for (const item of bytes) {
          if (typeof item !== "number" || !Number.isInteger(item) || item < 0 || item > 255) {
            return null;
          }
          octets.push(item);
        }
        const words: bigint[] = [];
        for (const item of scratch) {
          if (typeof item !== "bigint") {
            return null;
          }
          words.push(item);
        }
        return { addresses: keys, bytes: octets, scratch: words, frameHeld: record["frameHeld"] === true, frame };
      }

      /** 读出目标核心上别人看不见的写入。不改那颗核心。 */
      function readPrivate(ordinal: number): Promise<PrivateOctets> {
        const core = requireOrdinal(ordinal);
        if (core.cached !== null || core.pending !== null) {
          contextFail("capture", "目标核心未停止");
        }
        return new Promise((resolve, reject): void => {
          core.cached = resolve;
          core.cacheReject = reject;
          core.port.postMessage({ kind: "cache" });
        });
      }

      /** 用槽里的私有写入替换目标。核对失败时核心上的原表不动，这条指令失败。 */
      function plantPrivate(ordinal: number, cache: PrivateOctets): Promise<void> {
        const core = requireOrdinal(ordinal);
        if (core.cachePlanted !== null || core.pending !== null) {
          contextFail("restore", "目标核心未停止");
        }
        return new Promise((resolve, reject): void => {
          core.cachePlanted = (ok: boolean): void => {
            if (ok) {
              resolve();
              return;
            }
            reject(new Error("restore 私有写入"));
          };
          core.port.postMessage({
            kind: "cache-plant",
            addresses: cache.addresses.slice(),
            bytes: cache.bytes.slice(),
            scratch: cache.scratch.slice(),
            frameHeld: cache.frameHeld,
            frame: cache.frame,
          });
        });
      }

      /** 装入或卸下成功后清掉上一份程序留下的私有写入。 */
      function clearPrivate(ordinal: number, name: "install" | "release"): Promise<void> {
        const core = requireOrdinal(ordinal);
        if (core.cachePlanted !== null || core.pending !== null) {
          fail(`${name} 目标核心未停止`);
        }
        return new Promise((resolve, reject): void => {
          core.cachePlanted = (ok: boolean): void => {
            if (ok) {
              resolve();
              return;
            }
            reject(new Error(`${name} 私有写入`));
          };
          core.port.postMessage({ kind: "cache-clear" });
        });
      }

      /** 全机 8 个上下文槽。槽留下寄存器、下一条、已装入序列，以及别人读不到的写入。槽不是进程。 */
      const ContextSlotCount = 8;

      /** 一颗核心上别人读不到的八位组、临时字和帧字。地址不换算到别的核心。 */
      interface PrivateOctets {
        addresses: readonly bigint[];
        bytes: readonly number[];
        scratch: readonly bigint[];
        frameHeld: boolean;
        frame: bigint;
      }

      interface HeldContext {
        filled: boolean;
        cursor: number | null;
        registers: readonly bigint[];
        steps: InstructionRoot.Hardware.Cpu.CpuInstruction[];
        exports: ProgramSymbol[];
        imports: ProgramSymbol[];
        stopKind: number;
        sliceQuota: number;
        sliceLeft: number;
        svcDest: number | null;
        latch: bigint | null;
        cache: PrivateOctets;
      }

      const emptyCache: PrivateOctets = { addresses: [], bytes: [], scratch: [], frameHeld: false, frame: 0n };

      const contextSlots: HeldContext[] = [];
      for (let index = 0; index < ContextSlotCount; index += 1) {
        contextSlots.push({
          filled: false,
          cursor: null,
          registers: [],
          steps: [],
          exports: [],
          imports: [],
          stopKind: 0,
          sliceQuota: 0,
          sliceLeft: 0,
          svcDest: null,
          latch: null,
          cache: emptyCache,
        });
      }

      function contextSlot(value: bigint): number | null {
        if (value < 0n || value >= BigInt(ContextSlotCount)) {
          return null;
        }
        const slot = Number(value);
        if (!Number.isInteger(slot)) {
          return null;
        }
        return slot;
      }

      function contextFail(name: string, text: string): never {
        fail(`${name} ${text}`);
      }

      /**
       * 把已停止核心抄进一个槽。
       * 抄的是 8 个寄存器、留下的下一条、停止原因、时间片、当时装入的指令序列，以及别人读不到的已写入八位组。
       * 不改目标核心，也不保存可访问范围和 Hz。
       */
      async function captureContext(caller: number, targetValue: bigint, slotValue: bigint): Promise<void> {
        if (!supervisor(caller)) {
          contextFail("capture", "不是监督核");
        }
        const target = coreOrdinal(targetValue);
        const slot = contextSlot(slotValue);
        if (target === null || target === caller || slot === null) {
          contextFail("capture", "目标核心未停止");
        }
        const targetCore = cores.get(target);
        if (targetCore?.state !== CoreStateHalted || sequenceBusy.has(target)) {
          contextFail("capture", "目标核心未停止");
        }
        if (targetCore.installed === null) {
          contextFail("capture", "目标没有程序");
        }
        const registers = await readImage(target);
        const cache = await readPrivate(target);
        const held = contextSlots[slot];
        if (held === undefined) {
          contextFail("capture", "槽号超出范围");
        }
        held.filled = true;
        held.cursor = targetCore.resumeCursor;
        held.registers = registers.slice();
        held.steps = targetCore.installed.slice();
        held.exports = copySymbols(targetCore.exports);
        held.imports = copySymbols(targetCore.imports);
        held.stopKind = targetCore.stopKind;
        held.sliceQuota = targetCore.sliceQuota;
        held.sliceLeft = targetCore.sliceLeft;
        held.svcDest = targetCore.svcDest;
        held.latch = targetCore.latch;
        held.cache = {
          addresses: cache.addresses.slice(),
          bytes: cache.bytes.slice(),
          scratch: cache.scratch.slice(),
          frameHeld: cache.frameHeld,
          frame: cache.frame,
        };
      }

      /** 把槽放回已停止的核心。放回后仍然停止，要另一次 schedule 才继续。私有写入整份替换，地址不换算。 */
      async function restoreContext(caller: number, targetValue: bigint, slotValue: bigint): Promise<void> {
        if (!supervisor(caller)) {
          contextFail("restore", "不是监督核");
        }
        const target = coreOrdinal(targetValue);
        const slot = contextSlot(slotValue);
        if (target === null || target === caller || slot === null) {
          contextFail("restore", "目标核心未停止");
        }
        const targetCore = cores.get(target);
        if (targetCore?.state !== CoreStateHalted || sequenceBusy.has(target)) {
          contextFail("restore", "目标核心未停止");
        }
        const held = contextSlots[slot];
        if (held?.filled !== true) {
          contextFail("restore", "槽是空的");
        }
        await plantRegisters(target, held.registers);
        await plantPrivate(target, held.cache);
        targetCore.installed = held.steps.slice();
        targetCore.exports = copySymbols(held.exports);
        targetCore.imports = copySymbols(held.imports);
        targetCore.resumeCursor = held.cursor;
        targetCore.stopKind = held.stopKind;
        targetCore.sliceQuota = held.sliceQuota;
        targetCore.sliceLeft = held.sliceLeft;
        targetCore.svcDest = held.svcDest;
        targetCore.latch = held.latch;
      }

      /** 把目标核心的 8 个寄存器写成 0。目标这时是停止的，不能用 Place。 */
      function wipeRegisters(ordinal: number): Promise<void> {
        const core = requireOrdinal(ordinal);
        if (core.wiped !== null || core.pending !== null) {
          installFail("目标核心未停止");
        }
        return new Promise((resolve): void => {
          core.wiped = resolve;
          core.port.postMessage({ kind: "wipe" });
        });
      }

      /**
       * 把一份动态库接到已停止核心的指令末尾。
       * 库按 0 号核心的窗口编译。数据重定位加上 `目标编号 × 槽距`，跳转编号加上接入点。
       * 库自己的导入必须已经能在这颗核心上找到，否则整次失败，目标保持原样。
       * 同名导出已经都在时不再追加，结果寄存器写回原来的入口编号。
       */
      async function attachImage(caller: number, step: CpuInstruction & { Op: "attach" }): Promise<void> {
        if (!supervisor(caller)) {
          attachFail("不是监督核");
        }
        const targetValue = await peekRegister(caller, step.Core);
        const address = await peekRegister(caller, step.Address);
        const length = await peekRegister(caller, step.Length);
        const target = coreOrdinal(targetValue);
        if (target === null || target === caller) {
          attachFail("目标核心未停止");
        }
        const targetCore = cores.get(target);
        if (targetCore?.state !== CoreStateHalted || sequenceBusy.has(target)) {
          attachFail("目标核心未停止");
        }
        if (targetCore.installed === null) {
          attachFail("目标没有程序");
        }
        if (address < 0n || address % 8n !== 0n) {
          attachFail("地址没有按 8 对齐");
        }
        if (length < 0n || length > BigInt(InstallOctetLimit)) {
          attachFail("长度超出范围");
        }
        const octets = await readSpan(caller, address, Number(length));
        let image: ProgramImage;
        try {
          image = decodeProgramImage(octets);
        } catch {
          attachFail("程序映像");
        }
        if (image.kind !== 2) {
          attachFail("不是动态库");
        }
        const head = image.symbols[0];
        if (head === undefined) {
          attachFail("没有导出");
        }
        let known = 0;
        for (const item of image.symbols) {
          if (symbolIndex(targetCore.exports, item.name) !== null) {
            known += 1;
          }
        }
        if (known === image.symbols.length) {
          const existing = symbolIndex(targetCore.exports, head.name);
          if (existing === null) {
            attachFail("没有符号");
          }
          await place(caller, step.Destination, BigInt(existing));
          return;
        }
        if (known > 0) {
          attachFail("重复导出");
        }
        const codeBase = targetCore.installed.length;
        const library = image.steps.slice();
        const limit = codeBase + library.length;
        const bias = BigInt(target) * BigInt(RelocateSlotBits);
        for (const reloc of image.relocs) {
          const current = library[reloc.index];
          if (current === undefined) {
            attachFail("重定位");
          }
          if (reloc.field === 1) {
            library[reloc.index] = retarget(current, shiftedTarget(reloc.addend, codeBase, limit, attachFail), attachFail);
          } else {
            const value = reloc.addend + bias;
            if (value < -9223372036854775808n || value > 9223372036854775807n) {
              attachFail("重定位");
            }
            library[reloc.index] = redata(current, value, attachFail);
          }
        }
        for (const item of image.imports) {
          const found = symbolIndex(targetCore.exports, item.name);
          const current = library[item.index];
          if (found === null || current === undefined) {
            attachFail("没有符号");
          }
          library[item.index] = retarget(current, found, attachFail);
        }
        const prefix = targetCore.installed.slice();
        const nextImports: ProgramSymbol[] = [];
        for (const item of targetCore.imports) {
          const found = symbolIndex(image.symbols, item.name);
          if (found === null) {
            nextImports.push({ name: item.name, index: item.index });
            continue;
          }
          const current = prefix[item.index];
          if (current === undefined) {
            attachFail("没有符号");
          }
          prefix[item.index] = retarget(current, found + codeBase, attachFail);
        }
        const nextExports = copySymbols(targetCore.exports);
        for (const item of image.symbols) {
          nextExports.push({ name: item.name, index: item.index + codeBase });
        }
        targetCore.installed = prefix.concat(library);
        targetCore.exports = nextExports;
        targetCore.imports = nextImports;
        await place(caller, step.Destination, BigInt(head.index + codeBase));
      }

      /**
       * 把映像装到另一颗已停止的核心。
       * 解码失败、重定位对不上，或目标不合格时，不改那颗核心的序列和寄存器。
       * 版本 2 种类 1 的数据立即数先加上目标核心相对 0 号的窗口位移，再清寄存器。
       * 动态库不能整段换上，必须用 attach 接到已有序列后面。
       */
      async function installImage(caller: number, targetValue: bigint, address: bigint, length: bigint): Promise<void> {
        if (!supervisor(caller)) {
          installFail("不是监督核");
        }
        const target = coreOrdinal(targetValue);
        if (target === null || target === caller) {
          installFail("目标核心未停止");
        }
        const targetCore = cores.get(target);
        if (targetCore?.state !== CoreStateHalted || sequenceBusy.has(target)) {
          installFail("目标核心未停止");
        }
        if (address < 0n || address % 8n !== 0n) {
          installFail("地址没有按 8 对齐");
        }
        if (length < 0n || length > BigInt(InstallOctetLimit)) {
          installFail("长度超出范围");
        }
        const octets = await readSpan(caller, address, Number(length));
        let image: ProgramImage;
        try {
          image = decodeProgramImage(octets);
        } catch {
          installFail("程序映像");
        }
        if (image.kind === 2) {
          installFail("动态库");
        }
        const placed = image.steps.slice();
        const bias = BigInt(target) * BigInt(RelocateSlotBits);
        for (const reloc of image.relocs) {
          const current = placed[reloc.index];
          if (current === undefined) {
            installFail("重定位");
          }
          if (reloc.field === 1) {
            placed[reloc.index] = retarget(current, shiftedTarget(reloc.addend, 0, placed.length, installFail), installFail);
          } else if (reloc.field === 0) {
            const value = reloc.addend + bias;
            if (value < -9223372036854775808n || value > 9223372036854775807n) {
              installFail("重定位");
            }
            placed[reloc.index] = redata(current, value, installFail);
          } else {
            installFail("重定位");
          }
        }
        await wipeRegisters(target);
        await clearPrivate(target, "install");
        targetCore.installed = placed;
        targetCore.exports = copySymbols(image.symbols);
        targetCore.imports = copySymbols(image.imports);
        targetCore.resumeCursor = null;
        targetCore.stopKind = 0;
        targetCore.svcDest = null;
        targetCore.sliceQuota = 0;
        targetCore.sliceLeft = 0;
      }

      /**
       * 把已经解码的程序放上一颗停止的核心，不启动。
       * 这是上电时的宿主交付，不是客程序的 install。
       * 这一核还没有执行过，寄存器保持挂载时的 0，不必再走一轮清寄存器。
       * 固件循环稍后用 schedule 启动它，读盘因此不必占住换红点的那一核。
       */
      export function seatImage(ordinal: number, steps: readonly CpuInstruction[]): void {
        const targetCore = requireOrdinal(ordinal);
        if (targetCore.state !== CoreStateHalted || sequenceBusy.has(ordinal)) {
          fail("目标核心未停止");
        }
        targetCore.installed = steps.slice();
        targetCore.exports = [];
        targetCore.imports = [];
        targetCore.resumeCursor = null;
        targetCore.stopKind = 0;
        targetCore.svcDest = null;
        targetCore.sliceQuota = 0;
        targetCore.sliceLeft = 0;
      }

      /**
       * 有保留的下一条时从那里继续，否则从第 0 条开始。
       * halt 或序列结束会忘掉下一条。yield、时间片和系统调用会留下下一条。
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
        const started = requireOrdinal(ordinal);
        let cursor = started.resumeCursor ?? 0;
        const deliver = started.svcDest;
        started.resumeCursor = null;
        started.stopKind = 0;
        started.sliceLeft = started.sliceQuota;
        try {
        schedule(ordinal);
        if (deliver !== null) {
          if (started.latch === null) {
            fail("syscall 还没有回复");
          }
          const reply = take(ordinal);
          started.svcDest = null;
          await place(ordinal, deliver, reply);
        }
        while (cursor < steps.length) {
          if (started.sliceQuota > 0 && started.sliceLeft <= 0) {
            await waitPace(started);
            park(ordinal, cursor, 1);
            return;
          }
          const limit = started.sliceQuota > 0 ? started.sliceLeft : 0;
          const span = await runBurst(ordinal, cursor, cursor === 0 ? steps : null, limit);
          requireOrdinal(ordinal).Executed += span.executed;
          cursor = span.cursor;
          if (await consume(ordinal, cursor, span.executed)) {
            return;
          }
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
            const stopping = requireOrdinal(ordinal);
            stopping.resumeCursor = null;
            stopping.stopKind = 0;
            stopping.svcDest = null;
            halt(ordinal);
            wakeGate(ordinal);
            return;
          }
          if (step.Op === "yield") {
            requireOrdinal(ordinal).Executed += 1;
            park(ordinal, cursor + 1, 1);
            return;
          }
          if (step.Op === "gate") {
            if (gateOrdinal !== null) {
              fail("gate 已经有监督核");
            }
            gateOrdinal = ordinal;
            requireOrdinal(ordinal).Executed += 1;
          } else if (step.Op === "core") {
            await place(ordinal, step.Register, BigInt(ordinal));
          } else if (step.Op === "slice") {
            const count = await peekRegister(ordinal, step.Count);
            if (count < 0n || count > 0xffffffffn) {
              fail("slice 超出范围");
            }
            const sliced = requireOrdinal(ordinal);
            sliced.sliceQuota = Number(count);
            sliced.sliceLeft = sliced.sliceQuota;
            sliced.Executed += 1;
            cursor += 1;
            continue;
          } else if (step.Op === "schedule") {
            await waitPace(requireOrdinal(ordinal));
            const target = coreOrdinal(await peekRegister(ordinal, step.Core));
            if (target === null || !supervisor(ordinal)) {
              fail("schedule 不是监督核");
            }
            const chosen = requireOrdinal(target);
            if (chosen.installed === null) {
              fail("schedule 没有程序");
            }
            if (chosen.svcDest !== null && chosen.latch === null) {
              fail("schedule syscall 还没有回复");
            }
            if (!sequenceBusy.has(target)) {
              schedule(target);
            }
            requireOrdinal(ordinal).Executed += 1;
          } else if (step.Op === "release") {
            await waitPace(requireOrdinal(ordinal));
            const target = coreOrdinal(await peekRegister(ordinal, step.Core));
            if (target === null || target === ordinal || !supervisor(ordinal)) {
              fail("release 不是监督核");
            }
            const chosen = requireOrdinal(target);
            if (chosen.state !== CoreStateHalted || sequenceBusy.has(target)) {
              fail("release 目标核心未停止");
            }
            chosen.installed = null;
            chosen.exports = [];
            chosen.imports = [];
            chosen.resumeCursor = null;
            chosen.stopKind = 0;
            chosen.svcDest = null;
            chosen.sliceQuota = 0;
            chosen.sliceLeft = 0;
            chosen.boundOrigin = 0n;
            chosen.boundLength = 0n;
            chosen.latch = null;
            await wipeRegisters(target);
            await clearPrivate(target, "release");
            requireOrdinal(ordinal).Executed += 1;
          } else if (step.Op === "bound") {
            const target = coreOrdinal(await peekRegister(ordinal, step.Core));
            const origin = await peekRegister(ordinal, step.Origin);
            const length = await peekRegister(ordinal, step.Length);
            if (target === null || !supervisor(ordinal)) {
              fail("bound 不是监督核");
            }
            const chosen = requireOrdinal(target);
            if (target !== ordinal && (chosen.state !== CoreStateHalted || sequenceBusy.has(target))) {
              fail("bound 目标核心未停止");
            }
            if (origin < 0n || length < 0n || origin + length < origin) {
              fail("bound 范围不合法");
            }
            chosen.boundOrigin = origin;
            chosen.boundLength = length;
            requireOrdinal(ordinal).Executed += 1;
          } else if (step.Op === "pass") {
            const target = coreOrdinal(await peekRegister(ordinal, step.Core));
            const data = await peekRegister(ordinal, step.Value);
            if (target === null) {
              fail("pass 目标核心未挂载");
            }
            pass(ordinal, target, data);
            if (target === gateOrdinal) {
              wakeGate(ordinal);
            }
            requireOrdinal(ordinal).Executed += 1;
          } else if (step.Op === "take") {
            const current = requireOrdinal(ordinal);
            const found = current.latch === null ? 0n : 1n;
            const data = current.latch === null ? 0n : take(ordinal);
            await place(ordinal, step.Found, found);
            await place(ordinal, step.Value, data);
            current.Executed -= 1;
          } else if (step.Op === "svc") {
            if (gateOrdinal === null || gateOrdinal === ordinal) {
              fail("syscall 没有监督核");
            }
            const service = await peekRegister(ordinal, step.Service);
            if (service < 0n || service > 0xffffffffn) {
              fail("syscall 服务号超出范围");
            }
            pass(ordinal, gateOrdinal, (BigInt(ordinal) << 32n) | service);
            requireOrdinal(ordinal).svcDest = step.Destination;
            requireOrdinal(ordinal).Executed += 1;
            park(ordinal, cursor + 1, 2);
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
          } else if (step.Op === "fill") {
            const address = await peekRegister(ordinal, step.Address);
            const count = await peekRegister(ordinal, step.Count);
            if (address < 0n || address % 8n !== 0n) {
              fail("fill 地址没有对齐");
            }
            if (count < 0n || count > 4096n) {
              fail("fill 长度超出");
            }
            if (count > 0n) {
              withinBound(ordinal, address, Number(count) * 8);
            }
            await beginCommand(ordinal, {
              kind: "fill",
              destination: step.Destination,
              port: step.Port,
              address: step.Address,
              count: step.Count,
            });
          } else if (step.Op === "carry") {
            const address = await peekRegister(ordinal, step.Address);
            const count = await peekRegister(ordinal, step.Count);
            if (address < 0n || address % 8n !== 0n) {
              fail("carry 地址没有对齐");
            }
            if (count < 0n || count > 268435456n) {
              fail("carry 长度超出");
            }
            if (count > 0n) {
              withinBound(ordinal, address, Number(count) * 8);
            }
            await beginCommand(ordinal, {
              kind: "carry",
              destination: step.Destination,
              port: step.Port,
              handle: step.Handle,
              offset: step.Offset,
              address: step.Address,
              count: step.Count,
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
          } else if (step.Op === "install") {
            await waitPace(requireOrdinal(ordinal));
            const target = await peekRegister(ordinal, step.Core);
            const address = await peekRegister(ordinal, step.Address);
            const length = await peekRegister(ordinal, step.Length);
            await installImage(ordinal, target, address, length);
            requireOrdinal(ordinal).Executed += 1;
          } else if (step.Op === "attach") {
            await waitPace(requireOrdinal(ordinal));
            await attachImage(ordinal, step);
            requireOrdinal(ordinal).Executed += 1;
          } else if (step.Op === "capture") {
            await waitPace(requireOrdinal(ordinal));
            const target = await peekRegister(ordinal, step.Core);
            const slot = await peekRegister(ordinal, step.Slot);
            await captureContext(ordinal, target, slot);
            requireOrdinal(ordinal).Executed += 1;
          } else if (step.Op === "restore") {
            await waitPace(requireOrdinal(ordinal));
            const target = await peekRegister(ordinal, step.Core);
            const slot = await peekRegister(ordinal, step.Slot);
            await restoreContext(ordinal, target, slot);
            requireOrdinal(ordinal).Executed += 1;
          } else if (step.Op === "gpu.compose") {
            await gpu(ordinal, { kind: "gpu", gpuOp: "compose" });
          } else if (step.Op === "gpu.present") {
            await gpu(ordinal, { kind: "gpu", gpuOp: "present" });
          }
          cursor += 1;
          if (await consume(ordinal, cursor, 1)) {
            return;
          }
        }
        const finished = requireOrdinal(ordinal);
        finished.resumeCursor = null;
        finished.stopKind = 0;
        finished.svcDest = null;
        halt(ordinal);
        wakeGate(ordinal);
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
            core.span = null;
            core.spanReject = null;
            core.wiped = null;
            core.planted = null;
            core.cached = null;
            core.cacheReject = null;
            core.cachePlanted = null;
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

      /** 宿主读取 8 个寄存器。停止后也能读。不是一条 ZAP 指令。 */
      export function readRegisters(ordinal: number): Promise<readonly bigint[]> {
        return readImage(ordinal);
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
