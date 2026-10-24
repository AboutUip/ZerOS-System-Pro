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
 * install 替换另一颗核心的指令序列，不创建进程。目标正在执行时，先停在下一条指令边界再换。
 * 动态库必须用 attach 接到末尾。本地指令突发仍按 Hz 逐条记账，短于 1 毫秒才不挂起。
 * 没被核心吸收的访存、查询和端口，只要后一条不读前一条写入的寄存器，就并成一次消息。
 * halt、yield、svc、gate、schedule、release、bound、slice、抢占和时间片仍是单条边界。
 * capture 与 restore 在 8 个槽里保存或放回寄存器、下一条、已装入序列和链接目录，也不创建进程。
 * 映像用和开机相同的解码器解一次，执行时不再从那段地址取指。
 * 停机时把宿主记录发给主板线程。那不是客程序指令，也不写进客程序能读的内存。
 * 用户核 3 到 7 成为客核心之后，指令失败只停这一颗：查询上是停止、原因 0，宿主记录里的原因才是 3。
 * 自检结束后，固件、沙盒、监督核，以及还没成为客核心的装入程序，失败都送到错误帧。
 * 显卡来源不送错误帧。自检还没结束时，仍只有监督核会上报，免得探针里的预期失败画成整机停机。
 * 0 号核心正忙时，失败帧在下一条指令边界上接替它。这次接替不记成新的失败。
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
import { ZerOS as MailboxRoot } from "../../Motherboard/Host/Mailbox";
import { ZerOS as MetricPageRoot } from "../../Motherboard/Host/MetricPage";
import { ZerOS as StopReasonRoot } from "../Enum/StopReason";
import { ZerOS as FaultRecordRoot } from "../Structure/FaultRecord";
import { ZerOS as DebugLogRoot } from "../../Debug/Host/DebugLog";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      type CoreRunState = CoreRunStateRoot.Hardware.Cpu.CoreRunState;
      type CpuCommandResult = CommandResultRoot.Hardware.Cpu.CpuCommandResult;
      type CpuInstruction = InstructionRoot.Hardware.Cpu.CpuInstruction;
      const CoreStopMessage = MailboxRoot.Hardware.Motherboard.MailMessage.CoreStop;
      const FaultMessage = MailboxRoot.Hardware.Motherboard.MailMessage.Fault;
      const FaultLogMessage = MailboxRoot.Hardware.Motherboard.MailMessage.FaultLog;
      const faultFromText = FaultRecordRoot.Hardware.Cpu.faultFromText;
      const rememberFault = DebugLogRoot.Hardware.Debug.rememberFault;
      const StopReasonHalted = StopReasonRoot.Hardware.Cpu.StopReasonHalted;
      const StopReasonYielded = StopReasonRoot.Hardware.Cpu.StopReasonYielded;
      const StopReasonWaiting = StopReasonRoot.Hardware.Cpu.StopReasonWaiting;
      const StopReasonFailed = StopReasonRoot.Hardware.Cpu.StopReasonFailed;

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

      /** 一批出核心访问的结果。hostFault 非空时由 CPU 线程换成原来的失败语句。 */
      interface AccessOutcome {
        readonly ok: boolean;
        readonly cursor: number;
        readonly executed: number;
        readonly message: string;
        readonly hostFault: string;
      }

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
        /** 一批出核心的访存、查询或端口做完。失败也从这里回来，已完成条数在结果里。 */
        access: ((outcome: AccessOutcome) => void) | null;
        accessReject: ((error: Error) => void) | null;
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
        /**
         * 核心线程在这次突发里报出的失败指令编号。
         * 没有失败时是空。宿主记录读完就清掉。不是查询字段。
         */
        faultIndex: number | null;
        /** 0 表示一直跑到 halt。其它正数是每轮最多执行的指令数。 */
        sliceQuota: number;
        sliceLeft: number;
        /** 负长度表示还不限制访存。 */
        boundOrigin: bigint;
        boundLength: bigint;
        /** 系统调用的回复要写进这个寄存器。空表示没在等。 */
        svcDest: number | null;
        /**
         * 监督核已经用 install 或 bound 划定过的其它核心。
         * 这种核心只能做运算、窗口内访存、停机、让出、时间片、查自己的编号和系统调用。
         * 固件所在的核心、监督核自己，以及监督核出现之前装上的核心，都不是客核心。
         */
        guest: boolean;
        /** 监督核要求这颗核心在下一条指令边界停下。 */
        preemptRequested: boolean;
        /**
         * 系统调用还没回复时的固件空转记号。
         * 空表示没有这趟空转。调度或抢占清掉它，等待中的循环就退出。
         */
        blockToken: object | null;
        /** 已经停在边界后叫醒正在等的监督核。空表示没人在等。 */
        preemptResolve: (() => void) | null;
      }

      /** 与公共时钟的宿主节拍相同。短于它的等待不挂起。 */
      const HostTickMs = 1;

      /** 一次突发的条数上限。再长会把抢占拖过这一宿主节拍。频率仍按实际条数记账。 */
      const BurstCap = 100000;

      /** 监督核。空表示还没有人调用 gate，这时装入和调度不设限。 */
      let gateOrdinal: number | null = null;

      const LineBits = BigInt(ConfigRoot.Hardware.Cpu.Config.LineBits);

      /** 这一份实现声明的核心数。挂载不得超过它。 */
      let declaredCoreCount = 0;

      /** 正在跑一段指令的核心。固件和客程序共用，避免两段同时写同一组寄存器。 */
      const sequenceBusy = new Set<number>();

      /**
       * 这颗核心正在执行的指令序列。
       * 只用来在停机时查出操作名。客程序读不到这张表。
       */
      const activeProgram = new Map<number, readonly CpuInstruction[]>();
      /** 最近一次失败的指令编号和操作名。停机记录发出之后，上报还要再用一次。 */
      const notedFault = new Map<number, { readonly index: number; readonly op: string }>();
      /**
       * 自检结束前只有监督核的失败送出整机。
       * 打开之后，固件、沙盒和还没成为客核心的装入程序也送。客核心任务仍然只记日志。
       */
      let faultDelivery = false;
      /**
       * 自检要把故意的除零留在本线程，不能送给主板。
       * 探针还在等 ok 时送出去，主板会把它画成整机失败，固件就起不来。
       * 探针成功的那一刻才关掉。关掉之前积下的记录不补发。
       */
      let parkFaultPosts = false;
      const parkedFaults: {
        readonly kind: string;
        readonly message: string;
        readonly core: number;
        readonly index: number;
        readonly op: string;
        readonly code: number;
      }[] = [];
      /**
       * 等 0 号核心走到下一条指令边界后要跑的失败帧。
       * 只在 CPU 线程里读写。客程序碰不到，查询字段里也没有。
       */
      let faultFrame: readonly CpuInstruction[] | null = null;
      /** 失败帧跑完时叫醒等待的一方。空着表示当前没有人在等。 */
      let faultFrameSettle: ((outcome: { readonly Ok: boolean; readonly Message: string }) => void) | null = null;
      /** 失败帧自己正在执行。这段期间不再被后一次失败帧打断。 */
      let showingFaultFrame = false;

      const cores = new Map<number, MountedCore>();

      function fail(message: string): never {
        throw new Error(`${runtimePrefix} ${message}`);
      }

      function requireOrdinal(ordinal: number): MountedCore {
        if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= declaredCoreCount) {
          fail("core ordinal is outside the declared range");
        }
        const core = cores.get(ordinal);
        if (core === undefined) {
          fail("core is not mounted");
        }
        return core;
      }

      /** 记录实现声明的核心数。只能在坐座时写一次。 */
      export function declareCoreCount(coreCount: number): void {
        if (!Number.isInteger(coreCount) || coreCount < CoreCountMin || coreCount > CoreCountMax) {
          fail("declared core count is outside 1 to 256");
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
        fail("unknown CPU field");
      }

      /**
       * 上一回写进指标页的数。
       * 加载圈每一拍都要发布。八个字段、八颗核心每次都新建整数的话，垃圾会越积越多，圆圈就跟着越转越顿。
       * 没变的字段留着上次那个整数，不再写。
       */
      interface MetricSnap {
        state: number;
        hertz: number;
        executed: number;
        origin: bigint;
        length: bigint;
        cursor: number;
        stop: number;
        slice: number;
        mounted: boolean;
      }

      const metricSnaps = new Map<number, MetricSnap>();
      let metricIdentitySent = false;

      /** 卸下之后清掉快照。同一编号再挂上时要重新写「已经挂上」。 */
      function forgetCoreMetric(ordinal: number): void {
        metricSnaps.delete(ordinal);
      }

      /**
       * 把已经记下的 CPU 数值写进指标页。
       * 核心即将执行之前写一次。查询在核心里读页，不再为了每个字段回到这条线程。
       * 只有和上次不同的字段才写。正在跑的那颗通常只多了完成条数，其余核心这一拍一个字都不用动。
       */
      function publishCpuQuery(): void {
        const writeMetric = MetricPageRoot.Hardware.Motherboard.writeMetric;
        const writeCoreMounted = MetricPageRoot.Hardware.Motherboard.writeCoreMounted;
        if (!metricIdentitySent) {
          writeMetric(1, 0, 0, BigInt(declaredCoreCount));
          writeMetric(1, 1, 0, BigInt(RegisterCount));
          metricIdentitySent = true;
        }
        for (const [ordinal, core] of cores) {
          const cursor = core.resumeCursor ?? -1;
          const length = core.boundLength < 0n ? LineBits : core.boundLength;
          let snap = metricSnaps.get(ordinal);
          if (snap === undefined) {
            snap = {
              state: -1,
              hertz: -1,
              executed: -1,
              origin: -1n,
              length: -2n,
              cursor: -2,
              stop: -1,
              slice: -1,
              mounted: false,
            };
            metricSnaps.set(ordinal, snap);
          }
          if (!snap.mounted) {
            writeCoreMounted(ordinal, true);
            snap.mounted = true;
          }
          if (snap.state !== core.state) {
            writeMetric(1, 5, ordinal, BigInt(core.state));
            snap.state = core.state;
          }
          if (snap.hertz !== core.Hertz) {
            writeMetric(1, 6, ordinal, BigInt(core.Hertz));
            snap.hertz = core.Hertz;
          }
          if (snap.executed !== core.Executed) {
            writeMetric(1, 7, ordinal, BigInt(core.Executed));
            snap.executed = core.Executed;
          }
          if (snap.origin !== core.boundOrigin) {
            writeMetric(1, 8, ordinal, core.boundOrigin);
            snap.origin = core.boundOrigin;
          }
          if (snap.length !== length) {
            writeMetric(1, 9, ordinal, length);
            snap.length = length;
          }
          if (snap.cursor !== cursor) {
            writeMetric(1, 10, ordinal, BigInt(cursor));
            snap.cursor = cursor;
          }
          if (snap.stop !== core.stopKind) {
            writeMetric(1, 11, ordinal, BigInt(core.stopKind));
            snap.stop = core.stopKind;
          }
          if (snap.slice !== core.sliceQuota) {
            writeMetric(1, 12, ordinal, BigInt(core.sliceQuota));
            snap.slice = core.sliceQuota;
          }
        }
      }

      /** 挂上主板交来的指标页。没交来时查询仍走原来的单条路径。 */
      export function adoptMetricPage(buffer: SharedArrayBuffer): void {
        MetricPageRoot.Hardware.Motherboard.attachMetricPage(buffer);
        publishCpuQuery();
      }

      /**
       * 主板挂上一个核心后，把 CPU 这一侧的端口交进来。
       * 新核心处于停止。主板不负责把它调成执行中。
       */
      export function acceptMountedCore(ordinal: number, port: MessagePort): void {
        if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= declaredCoreCount) {
          fail("refused to mount a core past the declaration");
        }
        if (cores.has(ordinal)) {
          fail("this core is already mounted");
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
          access: null,
          accessReject: null,
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
          faultIndex: null,
          sliceQuota: 0,
          sliceLeft: 0,
          boundOrigin: 0n,
          boundLength: -1n,
          svcDest: null,
          guest: false,
          preemptRequested: false,
          preemptResolve: null,
          blockToken: null,
        };
        port.onmessage = (event: MessageEvent): void => {
          onCoreMessage(core, event.data as unknown);
        };
        cores.set(ordinal, core);
        /* 卸下时标记已写成 0。不立刻写回的话，别的核心会把这颗新挂上的核心读成没有挂载。 */
        publishCpuQuery();
      }

      /** 主板强制卸载之后，这个编号立刻不可调度。 */
      export function dropCore(ordinal: number): void {
        const core = cores.get(ordinal);
        if (core === undefined) {
          return;
        }
        const reject = core.pendingReject ?? core.accessReject ?? core.fillReject ?? core.spanReject;
        core.access = null;
        core.accessReject = null;
        const wake = core.preemptResolve;
        core.preemptResolve = null;
        core.preemptRequested = false;
        core.blockToken = null;
        cores.delete(ordinal);
        sequenceBusy.delete(ordinal);
        activeProgram.delete(ordinal);
        forgetCoreMetric(ordinal);
        MetricPageRoot.Hardware.Motherboard.writeCoreMounted(ordinal, false);
        if (wake !== null) {
          wake();
        }
        if (reject !== null) {
          reject(new Error(`${runtimePrefix} core was forcibly unmounted`));
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
            const reported = record["cursor"];
            /* 核心报出的编号用来给失败记录定位。0 可能是还没跑起来就拒绝，留给循环里的光标判断。 */
            core.faultIndex = typeof reported === "number" && Number.isInteger(reported) && reported >= 0 ? reported : null;
            reject(new Error(typeof message === "string" ? message : `${runtimePrefix} core execution failed`));
            return;
          }
          core.faultIndex = null;
          const cursor = record["cursor"];
          const executed = record["executed"];
          if (typeof cursor !== "number" || typeof executed !== "number") {
            reject(new Error(`${runtimePrefix} local execution reply is incomplete`));
            return;
          }
          resolve(cursor, executed);
          return;
        }
        if (record["kind"] === "access") {
          const resolve = core.access;
          const reject = core.accessReject;
          core.access = null;
          core.accessReject = null;
          if (resolve === null || reject === null) {
            return;
          }
          const cursor = record["cursor"];
          const executed = record["executed"];
          const hostFault = record["hostFault"];
          const message = record["message"];
          const ok = record["ok"];
          if (typeof cursor !== "number" || typeof executed !== "number" || typeof ok !== "boolean") {
            reject(new Error(`${runtimePrefix} local execution reply is incomplete`));
            return;
          }
          resolve({
            ok,
            cursor,
            executed,
            message: typeof message === "string" ? message : "",
            hostFault: typeof hostFault === "string" ? hostFault : "",
          });
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
            reject(new Error("capture private bytes failed"));
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
            reject(new Error(typeof message === "string" ? message : `${runtimePrefix} install memory access failed`));
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
            reject(new Error(typeof message === "string" ? message : `${runtimePrefix} query record failed`));
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
          reject(new Error(typeof message === "string" ? message : `${runtimePrefix} core execution failed`));
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

      /**
       * 这一份八核机器上的用户核。
       * 0 是固件，1 是沙盒，2 是监督核。3 到 7 才是用户任务所在的核。
       * 用户核失败只停自己，监督核继续跑，由内核按「已停止、原因 0」收掉那个任务。
       */
      function userCore(ordinal: number): boolean {
        return ordinal >= 3 && ordinal <= 7;
      }

      /**
       * 自检全部通过后调用。
       * 在这之前打开的话，探针里故意失败的装入会把整机画成停机。
       */
      export function openFaultDelivery(): void {
        faultDelivery = true;
      }

      /**
       * 打开时清掉上次留下的记录，并且不再把失败送出这颗 CPU 线程。
       * 关掉时不把积压补发出去。那些是自检故意制造的。
       */
      export function parkInstalledFaults(park: boolean): void {
        parkFaultPosts = park;
        if (park) {
          parkedFaults.length = 0;
        }
      }

      /** 自检读这份副本。调用方改数组不会改到线程里的原件。 */
      export function readParkedFaults(): readonly {
        readonly kind: string;
        readonly message: string;
        readonly core: number;
        readonly index: number;
        readonly op: string;
        readonly code: number;
      }[] {
        return parkedFaults.slice();
      }

      /**
       * 在 0 号核心上呈一帧失败画面。
       * 这颗核心正忙时，先记住这段指令，等它自己的序列走到下一条边界再接替。
       * 接替只停掉正在跑的序列，不把它记成一次新的失败。核心空着就立刻跑。
       * 第二次同时进来会被拒绝，避免两帧抢同一组寄存器。
       */
      export function presentFaultFrame(steps: readonly CpuInstruction[]): Promise<void> {
        if (steps.length < 1) {
          return Promise.reject(new Error("fault picture was not drawn"));
        }
        if (faultFrame !== null || showingFaultFrame || faultFrameSettle !== null) {
          return Promise.reject(new Error("fault picture is already running"));
        }
        if (!sequenceBusy.has(0)) {
          const core = requireOrdinal(0);
          /* 留下的下一条属于被接替的程序。失败帧必须从自己的第 0 条开始。 */
          core.resumeCursor = null;
          core.svcDest = null;
          core.stopKind = 0;
          core.blockToken = null;
          showingFaultFrame = true;
          return runSequence(0, steps).then(
            (): void => {
              showingFaultFrame = false;
            },
            (error: unknown): Promise<never> => {
              showingFaultFrame = false;
              const message = error instanceof Error ? error.message : "fault picture was not drawn";
              return Promise.reject(new Error(message));
            },
          );
        }
        faultFrame = steps;
        return new Promise((resolve, reject): void => {
          faultFrameSettle = (outcome): void => {
            if (outcome.Ok) {
              resolve();
              return;
            }
            reject(new Error(outcome.Message));
          };
        });
      }

      /**
       * 0 号核心正等着让出给失败帧时，停在这条边界上。
       * 返回 true 表示调用方该结束当前序列，而且不要把它当成指令失败。
       */
      function leaveForFaultFrame(ordinal: number): boolean {
        if (ordinal !== 0 || faultFrame === null || showingFaultFrame) {
          return false;
        }
        halt(ordinal);
        return true;
      }

      /** 0 号核心是否停着，调试运行用来决定能不能借用它。不改变这颗核心。 */
      export function coreIsHalted(ordinal: number): boolean {
        const core = cores.get(ordinal);
        return core?.state === CoreStateHalted && !sequenceBusy.has(ordinal);
      }

      /**
       * 把这次失败收成记录并留在本线程。
       * 客核心只发日志，不发整机失败。自检没结束时，固件、沙盒和用户核也不发整机失败。
       * 返回 true 表示已经向主板发了整机失败。
       */
      function reportInstalledFault(ordinal: number, error: unknown): boolean {
        const message = error instanceof Error ? error.message : "the installed program failed";
        const stack = error instanceof Error && typeof error.stack === "string" ? error.stack : "";
        const noted = notedFault.get(ordinal);
        const record = faultFromText(message, ordinal, noted?.index ?? 0, noted?.op ?? "", stack);
        rememberFault(record);
        const guestTask = userCore(ordinal) && requireOrdinal(ordinal).guest;
        const machine = faultDelivery ? !guestTask : ordinal >= 2 && !userCore(ordinal);
        const kind = machine ? FaultMessage : FaultLogMessage;
        if (parkFaultPosts) {
          parkedFaults.push({
            kind,
            message,
            core: record.Core,
            index: record.Index,
            op: record.Op,
            code: record.Code,
          });
          return false;
        }
        globalThis.postMessage({
          kind,
          message,
          code: record.Code,
          source: record.Source,
          core: record.Core,
          index: record.Index,
          op: record.Op,
          site: record.Site,
          stack: record.Stack,
          window: record.Window,
        });
        return machine;
      }

      /** 已挂载核心进入执行中。已装入且当前没在跑时，从第一条开始执行那段序列。 */
      export function schedule(ordinal: number): void {
        const core = requireOrdinal(ordinal);
        /* 回复来了就结束固件空转，接着跑留下的客程序。 */
        core.blockToken = null;
        core.state = CoreStateRunning;
        core.port.postMessage({ kind: "state", running: true });
        if (core.installed === null || sequenceBusy.has(ordinal)) {
          return;
        }
        const steps = core.installed;
        const run = runSequence(ordinal, steps);
        core.started = run;
        void run.catch((error: unknown): void => {
          /* 客核心的任务失败只留日志。其余在自检结束后都是整机失败。 */
          reportInstalledFault(ordinal, error);
        });
      }

      /** 等最近一次由 Schedule 拉起的装入序列结束。没有拉起过就失败。 */
      export function startedRun(ordinal: number): Promise<void> {
        const started = requireOrdinal(ordinal).started;
        if (started === null) {
          fail("this core did not start the installed program");
        }
        return started;
      }

      /**
       * 把这次停下发给主板线程。
       * 页面再留成每颗核心最近的一条。这里不写寄存器，也不写客程序能读的内存。
       * 失败用原因 3，不改核心自己的 stopKind，查询字段 11 因此仍是 0、1 或 2。
       */
      function noteStop(ordinal: number, reason: number, index: number, op: string, detail: string): void {
        globalThis.postMessage({
          kind: CoreStopMessage,
          ordinal,
          reason,
          index,
          op,
          detail,
        });
      }

      /** 正在执行的那条指令的操作名。编号越过末尾，或这颗核心没在跑序列时，是空串。 */
      function instructionOp(ordinal: number, index: number): string {
        const steps = activeProgram.get(ordinal);
        if (steps === undefined) {
          return "";
        }
        const step = steps[index];
        if (step === undefined) {
          return "";
        }
        return step.Op;
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
        /* 系统调用会停很久。客程序不继续，核心仍要醒着，由固件按 30 Hz 空转。 */
        if (kind === 2) {
          beginBlockedPace(ordinal);
        }
      }

      /**
       * 客程序停在系统调用里时，核心保持执行中。
       * 这一循环不取客程序指令，不改寄存器，也不增加已完成条数。
       * 大约 30 Hz 才睡一次，宿主不会被这一颗核心占满。
       */
      function beginBlockedPace(ordinal: number): void {
        const core = requireOrdinal(ordinal);
        if (core.stopKind !== 2) {
          return;
        }
        const token = {};
        core.blockToken = token;
        core.state = CoreStateRunning;
        core.port.postMessage({ kind: "state", running: true });
        void blockedPace(core, token);
      }

      async function blockedPace(core: MountedCore, token: object): Promise<void> {
        while (core.blockToken === token) {
          await waitSpan(1000 / 30);
        }
      }

      function supervisor(caller: number): boolean {
        return gateOrdinal === null || caller === gateOrdinal;
      }

      /**
       * 监督核把另一颗核心装入或划定之后，那颗核心成为客核心。
       * 监督核划定自己时不标记。还没有监督核时，装入和划定都不标记。
       */
      function markGuest(target: number): void {
        if (gateOrdinal !== null && target !== gateOrdinal) {
          requireOrdinal(target).guest = true;
        }
      }

      /**
       * 客核心不能碰显卡、扩展口、频率，也不能把整数交给别的核或自己再当监督核。
       * 运算、访存、halt、yield、dwell、svc、slice、core 不在这张表里。
       */
      function guestBlocked(op: string): boolean {
        return op.startsWith("gpu.")
          || op === "port.state"
          || op === "port.char"
          || op === "port.byte"
          || op === "xchg"
          || op === "inbox"
          || op === "fill"
          || op === "carry"
          || op === "mem.hertz"
          || op === "mem.metric"
          || op === "hertz"
          || op === "metric"
          || op === "pass"
          || op === "take"
          || op === "gate";
      }

      function refuseGuest(ordinal: number, op: string): void {
        if (requireOrdinal(ordinal).guest && guestBlocked(op)) {
          fail("privileged instruction");
        }
      }

      /**
       * 客核心只能问 CPU 座位。
       * 字段 0 至 4 是整机身份，任意下标都可以。
       * 字段 5 至 12 是某一颗核心的状态，下标必须是正在执行的自己。
       */
      function guestMayQuery(ordinal: number, seat: number, field: number, index: number): boolean {
        if (seat !== 1 || field < 0 || field > 12) {
          return false;
        }
        return field < 5 || index === ordinal;
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
          fail(`bound access is outside the window at ${address.toString()} window ${core.boundOrigin.toString()} length ${core.boundLength.toString()}`);
        }
      }

      function consume(ordinal: number, cursor: number, count: number): boolean {
        const core = requireOrdinal(ordinal);
        if (core.sliceQuota > 0 && count > 0) {
          core.sliceLeft -= count;
        }
        /* 抢占和用尽的时间片都停在这一条。先应答抢占，避免监督核一直等。 */
        if (stopIfPreempted(ordinal, cursor)) {
          return true;
        }
        if (core.sliceQuota <= 0 || core.sliceLeft > 0) {
          return false;
        }
        noteStop(ordinal, StopReasonYielded, cursor, instructionOp(ordinal, cursor), "");
        park(ordinal, cursor, 1);
        return true;
      }

      /** 读取运行状态。 */
      export function coreState(ordinal: number): CoreRunState {
        return requireOrdinal(ordinal).state;
      }

      function numberFromRegister(value: bigint): number {
        if (value < -16777216n || value > 0xffffffffn) {
          fail("register integer is out of range");
        }
        return Number(value);
      }

      /** 读执行中核心的一个寄存器。不计入命令条数，也不占一拍。 */
      function peekRegister(ordinal: number, register: number): Promise<bigint> {
        const core = requireOrdinal(ordinal);
        if (core.state !== CoreStateRunning) {
          fail("core is not running");
        }
        if (core.peek !== null || core.pending !== null) {
          fail("core still has a command in flight");
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
          fail("core is not running");
        }
        if (core.pending !== null || core.peek !== null || core.fill !== null) {
          fail("core still has a command in flight");
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
          fail("Hz is outside 1 to 1000000000");
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
        return chargePace(core, 1);
      }

      /**
       * 连续完成的指令仍逐条占拍。
       * 合并进一次突发时不能少记账。累计等待短于宿主节拍才不挂起。
       */
      function chargePace(core: MountedCore, count: number): Promise<void> {
        if (count <= 0) {
          return Promise.resolve();
        }
        core.paceIndex += count;
        const deadline = core.paceOrigin + (core.paceIndex * 1000) / core.Hertz;
        /* 拍号一直涨会超出安全整数。把起点挪到这一拍，拍号清零，到期时刻不变。 */
        if (core.paceIndex > 1000000000) {
          core.paceOrigin = deadline;
          core.paceIndex = 0;
        }
        const delay = deadline - performance.now();
        return waitSpan(delay);
      }

      /**
       * 这一宿主节拍里最多连续做这么多条。
       * 30 Hz 时一拍长于 1 毫秒，所以一次只做 1 条再睡。100 MHz 时大约 10 万条凑满 1 毫秒。
       */
      function paceBudget(hertz: number): number {
        const quantum = Math.floor((hertz * HostTickMs) / 1000);
        if (quantum < 1) {
          return 1;
        }
        if (quantum > BurstCap) {
          return BurstCap;
        }
        return quantum;
      }

      /**
       * 让正在执行的核心停在下一条指令边界。
       * 停止原因是 1，寄存器和下一条都留着。已经停着的直接返回。
       * 不等它自己执行 yield。
       */
      function preempt(target: number): Promise<void> {
        const core = requireOrdinal(target);
        core.blockToken = null;
        if (!sequenceBusy.has(target)) {
          /* 没在取指，多半是系统调用的空转。上一条停机记录还在，这里不再盖掉。 */
          if (core.state === CoreStateRunning) {
            halt(target);
          }
          return Promise.resolve();
        }
        return new Promise((resolve): void => {
          core.preemptResolve = resolve;
          core.preemptRequested = true;
        });
      }

      /**
       * 抢占请求到了就停在这条。
       * 先从正在执行的集合里拿走，再叫醒监督核，避免它看见核心仍忙。
       */
      function stopIfPreempted(ordinal: number, cursor: number): boolean {
        const core = requireOrdinal(ordinal);
        if (!core.preemptRequested) {
          return false;
        }
        core.preemptRequested = false;
        noteStop(ordinal, StopReasonYielded, cursor, instructionOp(ordinal, cursor), "");
        park(ordinal, cursor, 1);
        sequenceBusy.delete(ordinal);
        const resolve = core.preemptResolve;
        core.preemptResolve = null;
        if (resolve !== null) {
          resolve();
        }
        return true;
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
          fail("core is not running");
        }
        if (core.pending !== null) {
          fail("core still has a command in flight");
        }
        return waitPace(core).then((): Promise<CpuCommandResult> => {
          return new Promise((resolve, reject): void => {
            core.pending = resolve;
            core.pendingReject = reject;
            publishCpuQuery();
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
        fail("unknown core metric");
      }

      function requireRegister(register: number): void {
        if (!Number.isInteger(register) || register < 0 || register >= RegisterCount) {
          fail("register is outside 0 to 7");
        }
      }

      /** 这条出核心指令读哪些寄存器、写哪些寄存器。不能并批的指令返回空。 */
      function effectMasks(step: CpuInstruction): { readonly read: number; readonly write: number } | null {
        if (step.Op === "load") {
          return { read: 0, write: registerBit(step.Register) };
        }
        if (step.Op === "store") {
          return { read: registerBit(step.Register), write: 0 };
        }
        if (step.Op === "ldi") {
          return { read: registerBit(step.Address), write: registerBit(step.Register) };
        }
        if (step.Op === "sti") {
          return { read: registerBit(step.Address) | registerBit(step.Register), write: 0 };
        }
        if (step.Op === "query") {
          return { read: registerBit(step.Seat) | registerBit(step.Field) | registerBit(step.Index), write: registerBit(step.Register) };
        }
        if (step.Op === "inbox") {
          return { read: 0, write: registerBit(step.Found) | registerBit(step.Value) };
        }
        if (step.Op === "xchg") {
          return { read: registerBit(step.Port) | registerBit(step.Direction) | registerBit(step.Data), write: registerBit(step.Data) };
        }
        if (step.Op === "fill") {
          return { read: registerBit(step.Port) | registerBit(step.Address) | registerBit(step.Count), write: registerBit(step.Destination) };
        }
        if (step.Op === "carry") {
          return {
            read: registerBit(step.Port) | registerBit(step.Handle) | registerBit(step.Offset) | registerBit(step.Address) | registerBit(step.Count),
            write: registerBit(step.Destination),
          };
        }
        if (step.Op === "port.state") {
          return { read: registerBit(step.Port), write: registerBit(step.Destination) };
        }
        if (step.Op === "port.char") {
          return { read: registerBit(step.Port) | registerBit(step.Offset), write: registerBit(step.Destination) };
        }
        if (step.Op === "port.byte") {
          return { read: registerBit(step.Port) | registerBit(step.Field) | registerBit(step.Offset), write: registerBit(step.Destination) };
        }
        return null;
      }

      function registerBit(register: number): number {
        if (!Number.isInteger(register) || register < 0 || register >= RegisterCount) {
          return 0;
        }
        return 1 << register;
      }

      /** 立即数访存的操作码和范围。对不上就留给原来的单条路径，失败语句不变。 */
      function outboundReady(ordinal: number, step: CpuInstruction): boolean {
        if (step.Op === "load" || step.Op === "store") {
          if (!memoryReady(step.Op, step.Opcode)) {
            return false;
          }
          return boundOk(ordinal, step.Address, accessBits(step.Opcode));
        }
        if (step.Op === "ldi" || step.Op === "sti") {
          return memoryReady(step.Op, step.Opcode);
        }
        return true;
      }

      function memoryReady(op: "load" | "store" | "ldi" | "sti", opcode: number): boolean {
        const memoryOpcode = toMemoryOpcode(opcode);
        if (memoryOpcode === null) {
          return false;
        }
        const reading = memoryOpcodeDirection(memoryOpcode) === ChannelDirectionRead;
        if (op === "load" || op === "ldi") {
          return reading;
        }
        return !reading;
      }

      /** 与 withinBound 相同，但不抛出。越界的那一条留在批外面。 */
      function boundOk(ordinal: number, address: bigint, bits: number): boolean {
        if (gateOrdinal === ordinal) {
          return true;
        }
        const core = requireOrdinal(ordinal);
        if (core.boundLength < 0n) {
          return true;
        }
        if (bits < 1 || address < core.boundOrigin || address + BigInt(bits) > core.boundOrigin + core.boundLength) {
          return false;
        }
        return true;
      }

      /**
       * 从 cursor 起连续能并批的条数。
       * 后一条若读前一条写入的寄存器，就停在它前面。停机、让出和调度不在这张表里。
       */
      function gatherAccess(ordinal: number, steps: readonly CpuInstruction[], cursor: number, cap: number): number {
        const guest = requireOrdinal(ordinal).guest;
        let written = 0;
        let count = 0;
        while (count < cap && cursor + count < steps.length) {
          const step = steps[cursor + count];
          if (step === undefined) {
            break;
          }
          if (guest && guestBlocked(step.Op)) {
            break;
          }
          const effect = effectMasks(step);
          if (effect === null || !outboundReady(ordinal, step)) {
            break;
          }
          if ((effect.read & written) !== 0) {
            break;
          }
          written |= effect.write;
          count += 1;
        }
        return count;
      }

      /** 这一拍里出核心访问还能占多少条。时间片剩下的更少时，以时间片为准。 */
      function accessAllowance(ordinal: number, room: number, spent: number): number {
        let cap = room - spent;
        if (cap < 1) {
          cap = 1;
        }
        const core = requireOrdinal(ordinal);
        if (core.sliceQuota > 0 && core.sliceLeft < cap) {
          cap = core.sliceLeft;
        }
        if (cap < 1) {
          return 0;
        }
        return cap;
      }

      /**
       * 把一段出核心访问交给核心一次做完。
       * 不在这里另记节拍。调用方按实际完成条数走原来的 chargePace。
       */
      function runAccess(ordinal: number, cursor: number, count: number): Promise<AccessOutcome> {
        const core = requireOrdinal(ordinal);
        if (core.state !== CoreStateRunning) {
          fail("core is not running");
        }
        if (core.pending !== null || core.burst !== null || core.access !== null) {
          fail("core still has a command in flight");
        }
        core.faultIndex = null;
        return new Promise((resolve, reject): void => {
          core.access = resolve;
          core.accessReject = reject;
          publishCpuQuery();
          core.port.postMessage({
            kind: "access",
            cursor,
            count,
            checkBound: gateOrdinal !== ordinal,
          });
        });
      }

      /** 批里失败时换成原来的语句。已完成条数由调用方先计入。 */
      function raiseAccessFault(hostFault: string, message: string): never {
        if (hostFault === "bound") {
          fail("bound access is outside the window");
        }
        if (hostFault === "fill-align") {
          fail("fill address is not aligned");
        }
        if (hostFault === "fill-length") {
          fail("fill length is out of range");
        }
        if (hostFault === "carry-align") {
          fail("carry address is not aligned");
        }
        if (hostFault === "carry-length") {
          fail("carry length is out of range");
        }
        if (hostFault === "guest") {
          fail("privileged instruction");
        }
        throw new Error(message.length > 0 ? message : `${runtimePrefix} core execution failed`);
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
          fail("core is not running");
        }
        if (core.pending !== null || core.burst !== null) {
          fail("core still has a command in flight");
        }
        core.faultIndex = null;
        return new Promise((resolve, reject): void => {
          core.burst = (next, executed): void => {
            resolve({ cursor: next, executed });
          };
          core.burstReject = reject;
          publishCpuQuery();
          core.port.postMessage({
            kind: "burst",
            cursor,
            limit,
            boundOrigin: core.boundOrigin,
            boundLength: core.boundLength,
            guest: core.guest,
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
          fail("load only accepts a read opcode");
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
          fail("store only accepts a write opcode");
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
        reject("relocation");
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
        reject("relocation");
      }

      function shiftedTarget(addend: bigint, base: number, limit: number, reject: (text: string) => never): number {
        if (addend < 0n || addend > 0xffffffffn) {
          reject("relocation");
        }
        const target = Number(addend) + base;
        if (!Number.isSafeInteger(target) || target < 0 || target >= limit) {
          reject("relocation");
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
          installFail("memory access failed");
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
          installFail("target core is not halted");
        }
        return new Promise((resolve, reject): void => {
          core.planted = (ok: boolean): void => {
            if (ok) {
              resolve();
              return;
            }
            reject(new Error("restore registers failed"));
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
          contextFail("capture", "target core is not halted");
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
          contextFail("restore", "target core is not halted");
        }
        return new Promise((resolve, reject): void => {
          core.cachePlanted = (ok: boolean): void => {
            if (ok) {
              resolve();
              return;
            }
            reject(new Error("restore private bytes failed"));
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
          fail(`${name} target core is not halted`);
        }
        return new Promise((resolve, reject): void => {
          core.cachePlanted = (ok: boolean): void => {
            if (ok) {
              resolve();
              return;
            }
            reject(new Error(`${name} private bytes failed`));
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
          contextFail("capture", "requires the supervisor");
        }
        const target = coreOrdinal(targetValue);
        const slot = contextSlot(slotValue);
        if (target === null || target === caller || slot === null) {
          contextFail("capture", "target core is not halted");
        }
        await preempt(target);
        const targetCore = cores.get(target);
        if (targetCore?.state !== CoreStateHalted || sequenceBusy.has(target)) {
          contextFail("capture", "target core is not halted");
        }
        if (targetCore.installed === null) {
          contextFail("capture", "target has no program");
        }
        const registers = await readImage(target);
        const cache = await readPrivate(target);
        const held = contextSlots[slot];
        if (held === undefined) {
          contextFail("capture", "slot is out of range");
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
          contextFail("restore", "requires the supervisor");
        }
        const target = coreOrdinal(targetValue);
        const slot = contextSlot(slotValue);
        if (target === null || target === caller || slot === null) {
          contextFail("restore", "target core is not halted");
        }
        await preempt(target);
        const targetCore = cores.get(target);
        if (targetCore?.state !== CoreStateHalted || sequenceBusy.has(target)) {
          contextFail("restore", "target core is not halted");
        }
        const held = contextSlots[slot];
        if (held?.filled !== true) {
          contextFail("restore", "slot is empty");
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
          installFail("target core is not halted");
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
          attachFail("requires the supervisor");
        }
        const targetValue = await peekRegister(caller, step.Core);
        const address = await peekRegister(caller, step.Address);
        const length = await peekRegister(caller, step.Length);
        const target = coreOrdinal(targetValue);
        if (target === null || target === caller) {
          attachFail("target core is not halted");
        }
        await preempt(target);
        const targetCore = cores.get(target);
        if (targetCore?.state !== CoreStateHalted || sequenceBusy.has(target)) {
          attachFail("target core is not halted");
        }
        if (targetCore.installed === null) {
          attachFail("target has no program");
        }
        if (address < 0n || address % 8n !== 0n) {
          attachFail("address is not 8-aligned");
        }
        if (length < 0n || length > BigInt(InstallOctetLimit)) {
          attachFail("length is out of range");
        }
        const octets = await readSpan(caller, address, Number(length));
        let image: ProgramImage;
        try {
          image = decodeProgramImage(octets);
        } catch {
          attachFail("program image");
        }
        if (image.kind !== 2) {
          attachFail("is not a dynamic library");
        }
        const head = image.symbols[0];
        if (head === undefined) {
          attachFail("no export");
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
            attachFail("no symbol");
          }
          await place(caller, step.Destination, BigInt(existing));
          return;
        }
        if (known > 0) {
          attachFail("duplicate export");
        }
        const codeBase = targetCore.installed.length;
        const library = image.steps.slice();
        const limit = codeBase + library.length;
        const bias = BigInt(target) * BigInt(RelocateSlotBits);
        for (const reloc of image.relocs) {
          const current = library[reloc.index];
          if (current === undefined) {
            attachFail("relocation");
          }
          if (reloc.field === 1) {
            library[reloc.index] = retarget(current, shiftedTarget(reloc.addend, codeBase, limit, attachFail), attachFail);
          } else {
            const value = reloc.addend + bias;
            if (value < -9223372036854775808n || value > 9223372036854775807n) {
              attachFail("relocation");
            }
            library[reloc.index] = redata(current, value, attachFail);
          }
        }
        for (const item of image.imports) {
          const found = symbolIndex(targetCore.exports, item.name);
          const current = library[item.index];
          if (found === null || current === undefined) {
            attachFail("no symbol");
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
            attachFail("no symbol");
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
       * 把映像装到另一颗核心。正在执行时先停在下一条指令边界。
       * 解码失败、重定位对不上，或目标不合格时，不改那颗核心的序列和寄存器。
       * 已经抢占之后若后续失败，目标保持停止，不自动再调度。
       * 版本 2 种类 1 的数据立即数先加上目标核心相对 0 号的窗口位移，再清寄存器。
       * 动态库不能整段换上，必须用 attach 接到已有序列后面。
       */
      async function installImage(caller: number, targetValue: bigint, address: bigint, length: bigint): Promise<void> {
        if (!supervisor(caller)) {
          installFail("requires the supervisor");
        }
        const target = coreOrdinal(targetValue);
        if (target === null || target === caller) {
          installFail("target core is not halted");
        }
        const targetCore = cores.get(target);
        if (targetCore === undefined) {
          installFail("target core is not halted");
        }
        if (address < 0n || address % 8n !== 0n) {
          installFail("address is not 8-aligned");
        }
        if (length < 0n || length > BigInt(InstallOctetLimit)) {
          installFail("length is out of range");
        }
        const octets = await readSpan(caller, address, Number(length));
        let image: ProgramImage;
        try {
          image = decodeProgramImage(octets);
        } catch {
          installFail("program image");
        }
        if (image.kind === 2) {
          installFail("dynamic library");
        }
        const placed = image.steps.slice();
        const bias = BigInt(target) * BigInt(RelocateSlotBits);
        for (const reloc of image.relocs) {
          const current = placed[reloc.index];
          if (current === undefined) {
            installFail("relocation");
          }
          if (reloc.field === 1) {
            placed[reloc.index] = retarget(current, shiftedTarget(reloc.addend, 0, placed.length, installFail), installFail);
          } else if (reloc.field === 0) {
            const value = reloc.addend + bias;
            if (value < -9223372036854775808n || value > 9223372036854775807n) {
              installFail("relocation");
            }
            placed[reloc.index] = redata(current, value, installFail);
          } else {
            installFail("relocation");
          }
        }
        await preempt(target);
        if (targetCore.state !== CoreStateHalted || sequenceBusy.has(target)) {
          installFail("target core is not halted");
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
        markGuest(target);
      }

      /**
       * 把已经解码的程序放上一颗停止的核心，不启动。
       * 这是上电时的宿主交付，不是客程序的 install。
       * 自检里的 release 会把可访问长度收成 0。宿主交付要回到刚挂载的样子：
       * 没有窗口、不是客核心，否则装入程序的第一条写就会被收成整机失败。
       * 寄存器保持挂载时的 0，不必再走一轮清寄存器。
       * 固件循环稍后用 schedule 启动它，读盘因此不必占住换红点的那一核。
       */
      export function seatImage(ordinal: number, steps: readonly CpuInstruction[]): void {
        const targetCore = requireOrdinal(ordinal);
        if (targetCore.state !== CoreStateHalted || sequenceBusy.has(ordinal)) {
          fail("target core is not halted");
        }
        targetCore.installed = steps.slice();
        targetCore.exports = [];
        targetCore.imports = [];
        targetCore.resumeCursor = null;
        targetCore.stopKind = 0;
        targetCore.svcDest = null;
        targetCore.sliceQuota = 0;
        targetCore.sliceLeft = 0;
        targetCore.boundOrigin = 0n;
        targetCore.boundLength = -1n;
        targetCore.guest = false;
        targetCore.latch = null;
      }

      /**
       * 自检用过的样本程序不能留在核心上。
       * 探针结束后固件会调度这颗核，留着除零程序就会把整机画成停机。
       * 核心必须已经停止，而且没有序列还在跑。
       */
      export function clearInstalled(ordinal: number): void {
        const core = requireOrdinal(ordinal);
        if (core.state !== CoreStateHalted || sequenceBusy.has(ordinal)) {
          fail("target core is not halted");
        }
        core.installed = null;
        core.exports = [];
        core.imports = [];
        core.resumeCursor = null;
        core.stopKind = 0;
        core.svcDest = null;
      }

      /**
       * 自检用 release 卸过的核心，可访问长度是 0。
       * 长度 0 和刚挂载时的「还没有窗口」不是一回事。刚挂载是负数，表示还没划定。
       * 引导程序和内核的第一条就是写栈，它们要的是刚挂载的状态。
       * 客程序的 install 不会改窗口，所以必须在探针返回前由自检自己交还。
       */
      export function restoreMounted(ordinal: number): void {
        const core = requireOrdinal(ordinal);
        if (core.state !== CoreStateHalted || sequenceBusy.has(ordinal)) {
          fail("target core is not halted");
        }
        core.boundOrigin = 0n;
        core.boundLength = -1n;
        core.guest = false;
      }

      /**
       * 有保留的下一条时从那里继续，否则从第 0 条开始。
       * halt 或序列结束会忘掉下一条。yield、时间片和系统调用会留下下一条。
       * dwell 按宿主毫秒等完再取下一条，等待期间核心仍是执行中。
       * 不把每一行指令文本送出线程。页面收到后会直接丢掉，
       * 而每一条都会先占住 CPU 线程，再占住主板线程，键盘和访存就排在后面。
       */
      export async function runSequence(
        ordinal: number,
        steps: readonly CpuInstruction[],
      ): Promise<void> {
        if (sequenceBusy.has(ordinal)) {
          fail("this core is already running another program");
        }
        sequenceBusy.add(ordinal);
        const started = requireOrdinal(ordinal);
        let cursor = started.resumeCursor ?? 0;
        const deliver = started.svcDest;
        started.resumeCursor = null;
        started.stopKind = 0;
        started.sliceLeft = started.sliceQuota;
        try {
        activeProgram.set(ordinal, steps);
        schedule(ordinal);
        if (deliver !== null) {
          if (started.latch === null) {
            fail("syscall has no reply yet");
          }
          const reply = take(ordinal);
          started.svcDest = null;
          await place(ordinal, deliver, reply);
        }
        while (cursor < steps.length) {
          if (leaveForFaultFrame(ordinal)) {
            return;
          }
          if (stopIfPreempted(ordinal, cursor)) {
            return;
          }
          if (started.sliceQuota > 0 && started.sliceLeft <= 0) {
            noteStop(ordinal, StopReasonYielded, cursor, instructionOp(ordinal, cursor), "");
            park(ordinal, cursor, 1);
            return;
          }
          const budget = paceBudget(started.Hertz);
          const room = started.sliceQuota > 0 && started.sliceLeft < budget ? started.sliceLeft : budget;
          /* 续跑时不重复送整段程序。核心里没有这段、或游标已经越过程序末尾时，第一次会原地不动。 */
          let span = await runBurst(ordinal, cursor, cursor === 0 ? steps : null, room);
          if (span.executed < 1 && span.cursor === cursor && cursor < steps.length) {
            const stalled = steps[cursor];
            if (stalled !== undefined && localOp(stalled.Op)) {
              span = await runBurst(ordinal, cursor, steps, room);
            }
          }
          requireOrdinal(ordinal).Executed += span.executed;
          cursor = span.cursor;
          await chargePace(requireOrdinal(ordinal), span.executed);
          if (consume(ordinal, cursor, span.executed)) {
            return;
          }
          if (cursor >= steps.length) {
            break;
          }
          const step = steps[cursor];
          if (step !== undefined && localOp(step.Op)) {
            if (span.executed < 1) {
              fail(`local execution did not advance at ${step.Op}`);
            }
            continue;
          }
          if (step === undefined) {
            break;
          }
          /* 突发把这一拍用满时，下一条可能还能被核心吸收。先回到突发，避免把它误送去主板。 */
          if (span.executed >= room) {
            continue;
          }
          const accessCount = gatherAccess(ordinal, steps, cursor, accessAllowance(ordinal, room, span.executed));
          if (accessCount > 0) {
            const accessStart = cursor;
            const outcome = await runAccess(ordinal, accessStart, accessCount);
            const done = outcome.cursor - accessStart;
            if (!Number.isInteger(outcome.cursor) || done < 0 || done > accessCount) {
              fail("local execution reply is incomplete");
            }
            if (done > 0 || !outcome.ok) {
              requireOrdinal(ordinal).Executed += done;
              cursor = outcome.cursor;
              await chargePace(requireOrdinal(ordinal), done);
              if (!outcome.ok) {
                requireOrdinal(ordinal).faultIndex = cursor;
                raiseAccessFault(outcome.hostFault, outcome.message);
              }
              if (consume(ordinal, cursor, done)) {
                return;
              }
              continue;
            }
          }
          refuseGuest(ordinal, step.Op);
          if (step.Op === "halt") {
            const stopping = requireOrdinal(ordinal);
            stopping.resumeCursor = null;
            stopping.stopKind = 0;
            stopping.svcDest = null;
            noteStop(ordinal, StopReasonHalted, cursor, "halt", "");
            halt(ordinal);
            wakeGate(ordinal);
            return;
          }
          if (step.Op === "yield") {
            requireOrdinal(ordinal).Executed += 1;
            noteStop(ordinal, StopReasonYielded, cursor, "yield", "");
            park(ordinal, cursor + 1, 1);
            return;
          }
          if (step.Op === "gate") {
            if (gateOrdinal !== null) {
              fail("gate already has a supervisor");
            }
            gateOrdinal = ordinal;
            requireOrdinal(ordinal).Executed += 1;
          } else if (step.Op === "core") {
            await place(ordinal, step.Register, BigInt(ordinal));
          } else if (step.Op === "slice") {
            const count = await peekRegister(ordinal, step.Count);
            if (count < 0n || count > 0xffffffffn) {
              fail("slice is out of range");
            }
            const sliced = requireOrdinal(ordinal);
            sliced.sliceQuota = Number(count);
            sliced.sliceLeft = sliced.sliceQuota;
            sliced.Executed += 1;
            cursor += 1;
            continue;
          } else if (step.Op === "dwell") {
            /* 等的是墙上的毫秒，不按 Hz 折算。0 马上继续。
               核心保持执行中，别的核心可以在这次让出里往前走。 */
            const ms = await peekRegister(ordinal, step.Time);
            if (ms < 0n || ms > 1000n) {
              fail("dwell is outside 0 to 1000");
            }
            requireOrdinal(ordinal).Executed += 1;
            cursor += 1;
            if (ms >= 1n) {
              await waitSpan(Number(ms));
            }
            if (consume(ordinal, cursor, 1)) {
              return;
            }
            continue;
          } else if (step.Op === "schedule") {
            await waitPace(requireOrdinal(ordinal));
            const target = coreOrdinal(await peekRegister(ordinal, step.Core));
            if (target === null || !supervisor(ordinal)) {
              fail("schedule requires the supervisor");
            }
            const chosen = requireOrdinal(target);
            if (chosen.installed === null) {
              fail("schedule found no program");
            }
            if (chosen.svcDest !== null && chosen.latch === null) {
              fail("schedule found a syscall with no reply");
            }
            if (!sequenceBusy.has(target)) {
              schedule(target);
            }
            requireOrdinal(ordinal).Executed += 1;
          } else if (step.Op === "release") {
            await waitPace(requireOrdinal(ordinal));
            const target = coreOrdinal(await peekRegister(ordinal, step.Core));
            if (target === null || target === ordinal || !supervisor(ordinal)) {
              fail("release requires the supervisor");
            }
            const chosen = requireOrdinal(target);
            await preempt(target);
            if (chosen.state !== CoreStateHalted || sequenceBusy.has(target)) {
              fail("release target is not halted");
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
            chosen.guest = false;
            await wipeRegisters(target);
            await clearPrivate(target, "release");
            requireOrdinal(ordinal).Executed += 1;
          } else if (step.Op === "bound") {
            const target = coreOrdinal(await peekRegister(ordinal, step.Core));
            const origin = await peekRegister(ordinal, step.Origin);
            const length = await peekRegister(ordinal, step.Length);
            if (target === null || !supervisor(ordinal)) {
              fail("bound requires the supervisor");
            }
            if (origin < 0n || length < 0n || origin + length < origin) {
              fail("bound range is illegal");
            }
            const chosen = requireOrdinal(target);
            if (target !== ordinal) {
              await preempt(target);
            }
            if (target !== ordinal && (chosen.state !== CoreStateHalted || sequenceBusy.has(target))) {
              fail("bound target is not halted");
            }
            chosen.boundOrigin = origin;
            chosen.boundLength = length;
            markGuest(target);
            requireOrdinal(ordinal).Executed += 1;
          } else if (step.Op === "pass") {
            const target = coreOrdinal(await peekRegister(ordinal, step.Core));
            const data = await peekRegister(ordinal, step.Value);
            if (target === null) {
              fail("pass target is not mounted");
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
              fail("syscall has no supervisor");
            }
            const service = await peekRegister(ordinal, step.Service);
            if (service < 0n || service > 0xffffffffn) {
              fail("syscall service is out of range");
            }
            pass(ordinal, gateOrdinal, (BigInt(ordinal) << 32n) | service);
            requireOrdinal(ordinal).svcDest = step.Destination;
            requireOrdinal(ordinal).Executed += 1;
            noteStop(ordinal, StopReasonWaiting, cursor, "svc", "");
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
                fail("jump target is outside this program");
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
              fail("jump target is outside this program");
            }
            cursor = step.Target;
            continue;
          }
          if (step.Op === "jmp" || step.Op === "ret") {
            await waitPace(requireOrdinal(ordinal));
            const target = numberFromRegister(await peekRegister(ordinal, step.Register));
            requireOrdinal(ordinal).Executed += 1;
            if (!Number.isInteger(target) || target < 0 || target >= steps.length) {
              fail("jump target is outside this program");
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
              fail("fill address is not aligned");
            }
            if (count < 0n || count > 4096n) {
              fail("fill length is out of range");
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
              fail("carry address is not aligned");
            }
            if (count < 0n || count > 268435456n) {
              fail("carry length is out of range");
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
            if (requireOrdinal(ordinal).guest && !guestMayQuery(ordinal, seat, field, index)) {
              fail("privileged instruction");
            }
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
          if (consume(ordinal, cursor, 1)) {
            return;
          }
        }
        const finished = requireOrdinal(ordinal);
        finished.resumeCursor = null;
        finished.stopKind = 0;
        finished.svcDest = null;
        noteStop(ordinal, StopReasonHalted, cursor, "", "");
        halt(ordinal);
        wakeGate(ordinal);
        } catch (error: unknown) {
          /* 失败的那条命令可能还占着核心。先记下失败的那一条，再把回调放开。
             用户核在这里停成查询上的正常结束；异常仍抛出，由 schedule 决定不报给主板。
             编号必须在清掉正在执行的序列之前取，否则操作名对不上失败的那一条。 */
          const message = error instanceof Error ? error.message : `${runtimePrefix} instruction sequence failed`;
          const core = cores.get(ordinal);
          let index = cursor;
          if (core !== undefined && core.faultIndex !== null && core.faultIndex >= cursor) {
            index = core.faultIndex;
          }
          const failedOp = instructionOp(ordinal, index);
          notedFault.set(ordinal, { index, op: failedOp });
          noteStop(ordinal, StopReasonFailed, index, failedOp, message);
          if (core !== undefined) {
            core.faultIndex = null;
            core.pending = null;
            core.pendingReject = null;
            core.peek = null;
            core.fill = null;
            core.fillReject = null;
            core.image = null;
            core.burst = null;
            core.burstReject = null;
            core.access = null;
            core.accessReject = null;
            core.span = null;
            core.spanReject = null;
            core.wiped = null;
            core.planted = null;
            core.cached = null;
            core.cacheReject = null;
            core.cachePlanted = null;
            /* 用户核要让内核看见「已经停下、原因 0、任务仍在跑」。
               原因 3 只留在上面的宿主记录里，不能写进查询字段 11。 */
            if (userCore(ordinal)) {
              core.stopKind = 0;
            }
            if (core.state === CoreStateRunning || userCore(ordinal)) {
              halt(ordinal);
            }
          }
          throw error;
        } finally {
          /*
           * 失败帧只接替 0 号核心，而且不打断已经在画的那一帧。
           * 先放开忙碌标记，再从第 0 条跑画面。接替本身不抛错，所以上面的 catch 不会再上报一次。
           */
          const pendingFrame = ordinal === 0 && !showingFaultFrame ? faultFrame : null;
          const settleFrame = pendingFrame !== null ? faultFrameSettle : null;
          if (pendingFrame !== null) {
            faultFrame = null;
            faultFrameSettle = null;
            showingFaultFrame = true;
          }
          activeProgram.delete(ordinal);
          sequenceBusy.delete(ordinal);
          if (pendingFrame !== null && settleFrame !== null) {
            const core = requireOrdinal(0);
            core.resumeCursor = null;
            core.svcDest = null;
            core.stopKind = 0;
            core.blockToken = null;
            void runSequence(0, pendingFrame).then(
              (): void => {
                showingFaultFrame = false;
                settleFrame({ Ok: true, Message: "" });
              },
              (error: unknown): void => {
                showingFaultFrame = false;
                const message = error instanceof Error ? error.message : "fault picture was not drawn";
                settleFrame({ Ok: false, Message: message });
              },
            );
          }
        }
      }

      /**
       * 读出核心当前的 8 个寄存器。
       * 不要求核心正在执行。这是宿主取映像，不是一条 ZAP 指令。
       */
      function readImage(ordinal: number): Promise<readonly bigint[]> {
        const core = requireOrdinal(ordinal);
        if (core.pending !== null || core.peek !== null || core.image !== null) {
          fail("core still has a command in flight");
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
          return { Ok: false, Message: `${runtimePrefix} no such core`, Registers: empty };
        }
        let ok = true;
        let message = "";
        try {
          /* 自检要的是这一段从第 0 条跑完。留下的下一条属于上一段，不能拿来跳过装入。 */
          const core = requireOrdinal(ordinal);
          if (core.state === CoreStateHalted && !sequenceBusy.has(ordinal)) {
            core.resumeCursor = null;
            core.svcDest = null;
          }
          await runSequence(ordinal, steps);
        } catch (error: unknown) {
          ok = false;
          message = error instanceof Error ? error.message : `${runtimePrefix} guest program failed`;
        }
        try {
          const registers = await readImage(ordinal);
          return { Ok: ok, Message: message, Registers: registers };
        } catch (error: unknown) {
          const imageMessage = error instanceof Error ? error.message : `${runtimePrefix} registers could not be read`;
          return {
            Ok: false,
            Message: message.length > 0 ? message : imageMessage,
            Registers: empty,
          };
        }
      }

      /**
       * 借一颗核心跑完沙盒客程序，再把原来的映像从第一条重新调度。
       * 沙盒不占住这颗核心。地址窗仍按装入时的核心号计算，跑完后空转程序自己重建栈。
       * 自检走 runGuest，不会把正在跑的固件打断。
       */
      export async function runBorrowed(
        ordinal: number,
        steps: readonly CpuInstruction[],
      ): Promise<{ readonly Ok: boolean; readonly Message: string; readonly Registers: readonly bigint[] }> {
        const empty = new Array<bigint>(RegisterCount).fill(0n);
        if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= declaredCoreCount) {
          return { Ok: false, Message: `${runtimePrefix} no such core`, Registers: empty };
        }
        const core = requireOrdinal(ordinal);
        const shelf = core.installed;
        const shelfHertz = core.Hertz;
        let ok = true;
        let message = "";
        let registers: readonly bigint[] = empty;
        try {
          if (core.state === CoreStateRunning || sequenceBusy.has(ordinal)) {
            await preempt(ordinal);
          }
          core.resumeCursor = null;
          core.stopKind = 0;
          core.svcDest = null;
          setHertz(ordinal, OfficialHertz);
          try {
            await runSequence(ordinal, steps);
          } catch (error: unknown) {
            ok = false;
            message = error instanceof Error ? error.message : `${runtimePrefix} guest program failed`;
          }
          try {
            registers = (await readImage(ordinal)).slice();
          } catch (error: unknown) {
            ok = false;
            const imageMessage = error instanceof Error ? error.message : `${runtimePrefix} registers could not be read`;
            if (message.length === 0) {
              message = imageMessage;
            }
          }
        } finally {
          const current = cores.get(ordinal);
          if (current !== undefined) {
            setHertz(ordinal, shelfHertz);
            if (shelf !== null && current.installed === shelf && !sequenceBusy.has(ordinal)) {
              current.resumeCursor = 0;
              current.stopKind = 1;
              current.svcDest = null;
              current.sliceQuota = 0;
              current.sliceLeft = 0;
              schedule(ordinal);
            }
          }
        }
        return { Ok: ok, Message: message, Registers: registers };
      }

      /**
       * 把整数放进目标核心的空保持位。
       * 保持位已有值时失败，不覆盖。来源核心也必须已挂载。
       */
      export function pass(fromOrdinal: number, toOrdinal: number, data: bigint): void {
        requireOrdinal(fromOrdinal);
        const target = requireOrdinal(toOrdinal);
        if (target.latch !== null) {
          fail("target latch is already full");
        }
        target.latch = data;
        target.port.postMessage({ kind: "pass", data });
      }

      /** 取出并清空保持位。空的时候失败。 */
      export function take(ordinal: number): bigint {
        const core = requireOrdinal(ordinal);
        const value = core.latch;
        if (value === null) {
          fail("latch is empty");
        }
        core.latch = null;
        core.port.postMessage({ kind: "take" });
        return value;
      }
    }
  }
}
