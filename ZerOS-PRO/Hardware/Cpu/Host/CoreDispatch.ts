/**
 * @module ZerOS.Hardware.Cpu.CoreDispatch
 * @description 一个 CPU 核心线程
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 每个核心一条 Worker。8 个寄存器只存在于这条线程，整数不取模。
 * 指令进核心后收成紧凑数组。同一种、下标已经落在 0 到 7 的整数运算连成一段，用直循环做完。
 * 直循环覆盖 add、sub、mul、除法、求余、位运算和比较。跳转、调用、place、浮点，以及下标不合法的那一条，仍逐条执行。
 * 除零、无符号操作数不合法、移位越界停在失败的那一条，不写目的寄存器，后面的指令也不做。
 * 不再为每条本地运算分配字段对象。
 * 碰到不能吸收的访存、查询或端口，能同批的收成一条消息交给主板。停机和让出仍是单条边界。
 * 不写回寄存器的显卡命令也在这里按出现顺序排成一队，一次送给主板。
 * 要回节点编号的命令，以及 Present，仍单独等待，好让后面的指令看见结果。
 * 已经发布的数值查询在核心里读完，不把绘制队列切开。
 * 这一核心写过的对齐字节留在核心里，没写过的 Load / Store 才去主板。
 * 不导入内存实现，也不自己决定挂载。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 核心状态（同一种运算的直循环紧挨 runBurst）
 *   3. 消息
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as CompactRoot } from "./CompactProgram";
import { ZerOS as ConfigRoot } from "../Config/CpuConfig";
import { ZerOS as MetricPageRoot } from "../../Motherboard/Host/MetricPage";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      const RegisterCount = ConfigRoot.Hardware.Cpu.Config.RegisterCount;
      const RelocateSlotBits = ConfigRoot.Hardware.Cpu.Config.RelocateSlotBits;
      const corePrefix = "[ZerOS.Hardware.Cpu.Core]";
      const readMetric = MetricPageRoot.Hardware.Motherboard.readMetric;
      const attachMetricPage = MetricPageRoot.Hardware.Motherboard.attachMetricPage;
      const packProgram = CompactRoot.Hardware.Cpu.packProgram;
      const RegisterStride = CompactRoot.Hardware.Cpu.RegisterStride;
      const RegisterMissing = CompactRoot.Hardware.Cpu.RegisterMissing;
      const LocalNone = CompactRoot.Hardware.Cpu.LocalNone;
      const LocalPlace = CompactRoot.Hardware.Cpu.LocalPlace;
      const LocalAdd = CompactRoot.Hardware.Cpu.LocalAdd;
      const LocalEq = CompactRoot.Hardware.Cpu.LocalEq;
      const LocalSub = CompactRoot.Hardware.Cpu.LocalSub;
      const LocalUdiv = CompactRoot.Hardware.Cpu.LocalUdiv;
      const LocalUmod = CompactRoot.Hardware.Cpu.LocalUmod;
      const LocalMul = CompactRoot.Hardware.Cpu.LocalMul;
      const LocalDiv = CompactRoot.Hardware.Cpu.LocalDiv;
      const LocalMod = CompactRoot.Hardware.Cpu.LocalMod;
      const LocalAnd = CompactRoot.Hardware.Cpu.LocalAnd;
      const LocalOr = CompactRoot.Hardware.Cpu.LocalOr;
      const LocalXor = CompactRoot.Hardware.Cpu.LocalXor;
      const LocalShl = CompactRoot.Hardware.Cpu.LocalShl;
      const LocalShr = CompactRoot.Hardware.Cpu.LocalShr;
      const LocalLt = CompactRoot.Hardware.Cpu.LocalLt;
      const LocalLe = CompactRoot.Hardware.Cpu.LocalLe;
      const LocalGt = CompactRoot.Hardware.Cpu.LocalGt;
      const LocalGe = CompactRoot.Hardware.Cpu.LocalGe;
      const LocalNot = CompactRoot.Hardware.Cpu.LocalNot;
      const LocalItof = CompactRoot.Hardware.Cpu.LocalItof;
      const LocalFadd = CompactRoot.Hardware.Cpu.LocalFadd;
      const LocalFsub = CompactRoot.Hardware.Cpu.LocalFsub;
      const LocalFmul = CompactRoot.Hardware.Cpu.LocalFmul;
      const LocalFdiv = CompactRoot.Hardware.Cpu.LocalFdiv;
      const LocalFpow = CompactRoot.Hardware.Cpu.LocalFpow;
      const LocalFmod = CompactRoot.Hardware.Cpu.LocalFmod;
      const LocalFeq = CompactRoot.Hardware.Cpu.LocalFeq;
      const LocalJz = CompactRoot.Hardware.Cpu.LocalJz;
      const LocalJnz = CompactRoot.Hardware.Cpu.LocalJnz;
      const LocalJmp = CompactRoot.Hardware.Cpu.LocalJmp;
      const LocalRet = CompactRoot.Hardware.Cpu.LocalRet;
      const LocalLink = CompactRoot.Hardware.Cpu.LocalLink;
      const LocalCall = CompactRoot.Hardware.Cpu.LocalCall;
      /** 出核心批的内部种类。主板按同样的数字解释，客程序看不见。 */
      const AccessExec = 1;
      const AccessQuery = 2;
      const AccessInbox = 3;
      const AccessExchange = 4;
      const AccessFill = 5;
      const AccessCarry = 6;
      const AccessPortState = 7;
      const AccessPortChar = 8;
      const AccessPortByte = 9;

      let running = false;
      let board: MessagePort | null = null;
      let cpu: MessagePort | null = null;
      let waiting = false;
      /** 读访存回来之后要写入的寄存器。写访存不使用。 */
      let pendingRegister: number | null = null;
      /** inbox 还要把“是否取到”写入另一个寄存器。 */
      let pendingFound: number | null = null;
      const registers = new Array<bigint>(RegisterCount).fill(0n);

      function asRecord(data: unknown): Record<string, unknown> | null {
        if (typeof data !== "object" || data === null || Array.isArray(data)) {
          return null;
        }
        return data as Record<string, unknown>;
      }

      let quiet = false;
      let quietFault = "";
      let program: readonly Record<string, unknown>[] | null = null;
      /**
       * 与 program 对齐的紧凑指令。
       * 本地热路径只读这四条数组。对象步骤留给吸收和出核心，因为那些字段多、又不是每条都走。
       */
      let packedOp: Uint8Array = new Uint8Array(0);
      let packedReg: Uint8Array = new Uint8Array(0);
      let packedImm: readonly (bigint | null)[] = [];
      let packedTarget: readonly (number | null)[] = [];
      /** 浮点位型来回转换共用这一小块，避免本地突发里每条都分配缓冲。 */
      const floatRaw = new ArrayBuffer(8);
      const floatView = new DataView(floatRaw);
      /** 浮点和整数转浮点仍走原来的检查。这一份对象反复改写，不在热路径上新分配。 */
      const operandScratch: Record<string, unknown> = {
        destination: 0,
        left: 0,
        right: 0,
        register: 0,
        data: 0n,
        source: 0,
      };
      /** 一队显卡命令已经送出，还要等主板做完才回答这次本地执行。 */
      let pendingBurst: { readonly cursor: number; readonly executed: number; readonly fault: string } | null = null;
      /**
       * 帧指针所在的那个字。0 号核心是 70729728。
       * 其它核心在挂载时加上 核心号 × 槽距，与 obrc -slot 一致。
       * 每次调用都对这个字做 store.64，返回时再 load.64。
       * 字只给这一颗核心用。读和写都留在 frameWord 里，否则设置画面一帧要为这一个字进出内存六百多次。
       */
      let FrameAddress = 70729728n;
      const Load64 = 9;
      const Store64 = 10;
      /**
       * 界面库的临时槽。编译器把它们放在帧指针下面，只有这一颗核心自己读写。
       * 每个字形都要来回读十几次。若每次都去内存，一页设置画面要等很久，按键就被堵住。
       * 这些 64 位字留在核心里。范围之外的访存仍走内存。
       */
      let ScratchBase = 70680576n;
      let ScratchLimit = 70729728n;
      const scratchWords = new Array<bigint>(Number((ScratchLimit - ScratchBase) / 64n)).fill(0n);
      /**
       * 这一核心已经写过、别的核心读不到的八位组。键是位地址除以 8。
       * 设置画面每次重画都要再读同一批字符串、行表和栈上的局部变量。写过之后就在这里读，不再每个字节都问一次内存。
       * 没写过的地址仍走内存，所以别的设备事先放好的数据还在。
       * capture 把这张表、临时字和帧字一起抄走，restore 整份换上。install 与 release 成功时清掉，下一份程序才不会读到上一份留下的栈。
       */
      const keptOctets = new Map<bigint, number>();
      /** 固件单元格。栈指针那一个字不在这段里，它仍交给内存。 */
      const KeptLow = 4096n;
      const KeptLowEnd = 1048576n;
      /**
       * 启动结束标志。核心 0 读，核心 2 或 3 写。
       * 落在固件格子里，但这一字必须进共享内存，不能只留在写它的那颗核心上。
       */
      const SharedBootFlag = 5952n;
      /**
       * 固件模式。核心 0 在清屏之后写成 1，核心 2 读到 1 才往帧上画字。
       * 和结束标志一样落在固件格子里。若只留在 0 号核心的缓存，2 号核心永远读到 0，清屏之后面板就一直是黑的。
       */
      const SharedModeWord = 4096n;
      /**
       * 准备完成标记。核心 2 在 1 号进入等待后写成 1。
       * 和结束标志一样落在固件格子里，必须进共享内存。固件不读它，加载画面不离开。
       */
      const SharedInstallWord = 6208n;
      /** 监督核请固件停笔。核心 2 写，核心 0 读。必须进共享内存。 */
      const SharedStopWord = 6272n;
      /** 固件已经停笔。核心 0 写，核心 2 读。必须进共享内存。 */
      const SharedStopAck = 6336n;
      /**
       * 固件调试开关。核心 0 写成 0 或 1。
       * 落在固件格子里。若只留在 0 号核心的缓存，主板看不见这次写入，页面也就挂不上入口。
       */
      const SharedDebugWord = 8128n;

      /** 这次访存是否盖住结束标志、模式字、准备完成标记、停笔握手或调试开关。bitWidth 是这次访问的位数。 */
      function touchesSharedFirmware(address: bigint, bitWidth: bigint): boolean {
        const end = address + bitWidth;
        if (address < SharedBootFlag + 64n && end > SharedBootFlag) {
          return true;
        }
        if (address < SharedModeWord + 64n && end > SharedModeWord) {
          return true;
        }
        if (address < SharedInstallWord + 64n && end > SharedInstallWord) {
          return true;
        }
        if (address < SharedStopWord + 64n && end > SharedStopWord) {
          return true;
        }
        if (address < SharedStopAck + 64n && end > SharedStopAck) {
          return true;
        }
        if (address < SharedDebugWord + 64n && end > SharedDebugWord) {
          return true;
        }
        return false;
      }

      /**
       * 0 号核心的调用栈。编译器从 68173824 往上长，一帧远小于这段。
       * 挂载后按核心号挪到 -slot 的窗口，局部变量才不必每个字都去问内存。
       */
      let KeptStack = 68173824n;
      let KeptStackEnd = 68698112n;
      /** 栈指针那个字。它贴在数据下限上，不在固件格子里。 */
      let KeptSp = 1048576n;
      let KeptSpEnd = 1048640n;
      /** 堆指针那个字。造字符串时每次都要读它。 */
      let KeptHeapPtr = 70795264n;
      let KeptHeapPtrEnd = 70795328n;
      /** 编译器静态区。一槽 65536 个位元。 */
      let KeptStatic = 71319552n;
      let KeptStaticEnd = 71385088n;
      /** 字符串堆。起点按八位组对齐，盖住整段编译器堆。 */
      let KeptHeap = 71843840n;
      let KeptHeapEnd = 138952704n;
      let frameWord: bigint | null = null;
      /** 装入正在按八位组把一段映像读走。这不是下一条取指。字体面读文件时也用这一段。 */
      let spanActive = false;
      /** 原生写入正在等主板落下这一段。和上面的读取不能叠在一起。 */
      let depositActive = false;
      let depositBytes: Uint8Array | null = null;
      let depositBit = 0n;
      let spanBytes: Uint8Array | null = null;
      /** 这段读完要附在加速命令上，而不是交回装入。 */
      let fontHold: { readonly payload: Record<string, unknown>; readonly register: number } | null = null;
      const fontBits = new DataView(new ArrayBuffer(8));
      let spanAt = 0;
      let spanBit = 0n;
      const InstallOctetLimit = 16777216;
      let pendingFrame = false;
      /** 还没到必须看见画面的指令。访存可以穿插在中间，队列继续往后排。 */
      let heldQueue: Record<string, unknown>[] = [];

      function reply(ok: boolean, isStore: boolean, value: bigint, message: string): void {
        if (quiet) {
          if (!ok) {
            quietFault = message;
          }
          return;
        }
        const port = cpu;
        if (port === null) {
          return;
        }
        port.postMessage({ kind: "result", ok, isStore, value, message });
      }

      function isLocalOp(op: string): boolean {
        return op === "place" || op === "add" || op === "eq" || op === "sub" || op === "udiv" || op === "umod" || op === "mul" || op === "div" || op === "mod" || op === "and" || op === "or" || op === "xor" || op === "shl" || op === "shr" || op === "lt" || op === "le" || op === "gt" || op === "ge" || op === "not" || op === "itof" || op === "fadd" || op === "fsub" || op === "fmul" || op === "fdiv" || op === "fpow" || op === "fmod" || op === "feq" || op === "jz" || op === "jnz" || op === "jmp" || op === "ret" || op === "link" || op === "call";
      }

      /**
       * 这些显卡命令不把编号写回寄存器。
       * 可以先记下寄存器里的数，和后面的寄存器运算穿插前进，到必须看见结果时再一次送出。
       */
      function isQueuedGpu(op: string): boolean {
        return op === "gpu.align" || op === "gpu.paint" || op === "gpu.glyph" || op === "gpu.drop" || op === "gpu.compose" || op === "gpu.clear" || op === "gpu.plot" || op === "gpu.character" || op === "gpu.hertz" || op === "gpu.store";
      }

      /**
       * 下一条指令会不会读 r6。
       * 加速绘制把结果放进 r6，但字形和矩形接着就不管它了。
       * 这种可以先攒进队列。紧跟着用 r6 的查询必须当场做完，不能攒。
       */
      function readsSix(step: Record<string, unknown> | undefined): boolean {
        if (step === undefined) {
          return false;
        }
        const op = step["Op"];
        if (typeof op !== "string") {
          return true;
        }
        const sources = ["Left", "Right", "Condition", "Source", "A", "B", "C", "D", "Operation", "X", "Y", "Pixel", "Code", "Foreground", "Background", "Node", "AlignX", "AlignY", "Hertz", "Kind", "Parent", "Width", "Height", "Fill", "Value"];
        for (const key of sources) {
          if (step[key] === 6) {
            return true;
          }
        }
        if ((op === "store" || op === "sti") && (step["Register"] === 6 || step["Address"] === 6)) {
          return true;
        }
        if (op === "ldi" && step["Address"] === 6) {
          return true;
        }
        if (op === "install" && (step["Core"] === 6 || step["Address"] === 6 || step["Length"] === 6)) {
          return true;
        }
        if ((op === "capture" || op === "restore") && (step["Core"] === 6 || step["Slot"] === 6)) {
          return true;
        }
        if (op.startsWith("gpu.") && op !== "gpu.accel" && op !== "gpu.present" && op !== "gpu.compose" && step["Register"] === 6) {
          return true;
        }
        return false;
      }

      /** 把一条不读回 r6 的加速命令抄成整数。参数仍是寄存器里的二进制 64 位。 */
      function captureAccel(step: Record<string, unknown>): Record<string, unknown> | null {
        const operation = registerIndex(step["Operation"]);
        const a = registerIndex(step["A"]);
        const b = registerIndex(step["B"]);
        const c = registerIndex(step["C"]);
        const d = registerIndex(step["D"]);
        if (operation === null || a === null || b === null || c === null || d === null) {
          quietFault = `${corePrefix} accel command register is outside 0 to 7`;
          return null;
        }
        /* 字体面要回编号，并且要先把内存里的字节读走。不能和矩形一起丢掉结果。 */
        const fontOp = readRegister(operation);
        if (fontOp === 40n || fontOp === 41n || fontOp === 42n) {
          return null;
        }
        return {
          gpuOp: "accel",
          operation: Number(readRegister(operation)),
          a: readRegister(a),
          b: readRegister(b),
          c: readRegister(c),
          d: readRegister(d),
        };
      }

      /**
       * 界面临时槽的 load.64 / store.64 在核心里完成。
       * 不是这个范围，或不是 64 位整字，就返回 false，仍交给内存。
       */
      type ScratchPlan =
        | { readonly kind: "leave" }
        | { readonly kind: "fault" }
        | { readonly kind: "load"; readonly register: number; readonly index: number }
        | { readonly kind: "store"; readonly register: number; readonly index: number };

      /** 界面临时槽能不能就地做完。只读，供出核心批在往前看时使用。 */
      function scratchPlan(step: Record<string, unknown>): ScratchPlan {
        const op = step["Op"];
        if (op !== "load" && op !== "store") {
          return { kind: "leave" };
        }
        const opcode = step["Opcode"];
        if (op === "load" && opcode !== Load64) {
          return { kind: "leave" };
        }
        if (op === "store" && opcode !== Store64) {
          return { kind: "leave" };
        }
        const address = step["Address"];
        if (typeof address !== "bigint" || address < ScratchBase || address >= ScratchLimit) {
          return { kind: "leave" };
        }
        if (outsideBound(address, 64n)) {
          return { kind: "leave" };
        }
        if ((address - ScratchBase) % 64n !== 0n) {
          return { kind: "leave" };
        }
        const index = Number((address - ScratchBase) / 64n);
        const register = registerIndex(step["Register"]);
        if (!Number.isInteger(index) || index < 0 || index >= scratchWords.length || register === null) {
          return { kind: "fault" };
        }
        if (op === "load") {
          return { kind: "load", register, index };
        }
        return { kind: "store", register, index };
      }

      function absorbScratch(step: Record<string, unknown>): boolean {
        const plan = scratchPlan(step);
        if (plan.kind === "leave") {
          return false;
        }
        if (plan.kind === "fault") {
          quietFault = `${corePrefix} frame scratch is incomplete`;
          return true;
        }
        if (plan.kind === "load") {
          registers[plan.register] = scratchWords[plan.index] ?? 0n;
          return true;
        }
        scratchWords[plan.index] = readRegister(plan.register);
        return true;
      }

      /** 操作码对应的八位组个数。位访问和认不出的操作码返回 0，仍交给内存。 */
      function linearWidth(opcode: number): number {
        if (opcode === 3 || opcode === 4) {
          return 1;
        }
        if (opcode === 5 || opcode === 6) {
          return 2;
        }
        if (opcode === 7 || opcode === 8 || opcode === 11 || opcode === 12) {
          return 4;
        }
        if (opcode === 9 || opcode === 10 || opcode === 13 || opcode === 14) {
          return 8;
        }
        return 0;
      }

      function linearStore(opcode: number): boolean {
        return opcode === 4 || opcode === 6 || opcode === 8 || opcode === 10 || opcode === 12 || opcode === 14;
      }

      /**
       * 线性缓存能不能就地做完。只读，不改缓存。
       * drop 是写入放不进位宽：真正执行时会先丢掉这几个字节，再改走内存。
       */
      type LinearPlan =
        | { readonly kind: "leave" }
        | { readonly kind: "fault"; readonly message: string }
        | { readonly kind: "drop"; readonly base: bigint; readonly width: number }
        | { readonly kind: "store"; readonly register: number; readonly base: bigint; readonly width: number; readonly value: bigint }
        | { readonly kind: "load"; readonly register: number; readonly base: bigint; readonly width: number };

      function classifyLinear(step: Record<string, unknown>): LinearPlan {
        const op = step["Op"];
        if (op !== "load" && op !== "store" && op !== "ldi" && op !== "sti") {
          return { kind: "leave" };
        }
        const opcode = step["Opcode"];
        if (typeof opcode !== "number") {
          return { kind: "leave" };
        }
        const width = linearWidth(opcode);
        if (width === 0) {
          return { kind: "leave" };
        }
        let address: bigint;
        if (op === "load" || op === "store") {
          const direct = step["Address"];
          if (typeof direct !== "bigint") {
            return { kind: "leave" };
          }
          address = direct;
        } else {
          const pointer = registerIndex(step["Address"]);
          if (pointer === null) {
            return { kind: "fault", message: `${corePrefix} indirect address register is outside 0 to 7` };
          }
          address = readRegister(pointer);
        }
        if (address < 0n || address % 8n !== 0n || address === FrameAddress) {
          return { kind: "leave" };
        }
        /* 结束标志、模式字和调试开关要让主板看见，不能留在本核心的缓存里。 */
        if (touchesSharedFirmware(address, BigInt(width * 8))) {
          return { kind: "leave" };
        }
        if (outsideBound(address, BigInt(width * 8))) {
          return { kind: "leave" };
        }
        const inLow = address >= KeptLow && address < KeptLowEnd;
        const inStack = address >= KeptStack && address < KeptStackEnd;
        const inHeap = address >= KeptHeap && address < KeptHeapEnd;
        const inSp = address >= KeptSp && address < KeptSpEnd;
        const inHeapPtr = address >= KeptHeapPtr && address < KeptHeapPtrEnd;
        const inStatic = address >= KeptStatic && address < KeptStaticEnd;
        const last = address + BigInt((width - 1) * 8);
        if (inLow && last >= KeptLowEnd) {
          return { kind: "leave" };
        }
        if (inStack && last >= KeptStackEnd) {
          return { kind: "leave" };
        }
        if (inHeap && last >= KeptHeapEnd) {
          return { kind: "leave" };
        }
        if (inSp && last >= KeptSpEnd) {
          return { kind: "leave" };
        }
        if (inHeapPtr && last >= KeptHeapPtrEnd) {
          return { kind: "leave" };
        }
        if (inStatic && last >= KeptStaticEnd) {
          return { kind: "leave" };
        }
        if (!inLow && !inStack && !inHeap && !inSp && !inHeapPtr && !inStatic) {
          return { kind: "leave" };
        }
        if (address < ScratchLimit && last >= ScratchBase) {
          return { kind: "leave" };
        }
        const register = registerIndex(step["Register"]);
        if (register === null) {
          return { kind: "fault", message: `${corePrefix} memory data register is outside 0 to 7` };
        }
        const base = address / 8n;
        const bits = BigInt(width * 8);
        const modulus = 1n << bits;
        if (linearStore(opcode)) {
          const value = readRegister(register);
          const min = width === 1 ? 0n : -(modulus >> 1n);
          const max = width === 1 ? modulus - 1n : (modulus >> 1n) - 1n;
          if (value < min || value > max) {
            return { kind: "drop", base, width };
          }
          return { kind: "store", register, base, width, value };
        }
        for (let index = 0; index < width; index += 1) {
          if (!keptOctets.has(base + BigInt(index))) {
            return { kind: "leave" };
          }
        }
        return { kind: "load", register, base, width };
      }

      /**
       * 读这一核心写过的对齐字节。八个位里只要有一个没写过，就返回 false，整次改走内存。
       * 帧指针和界面临时槽另有记录，这里不碰。
       */
      function absorbLinear(step: Record<string, unknown>): boolean {
        const plan = classifyLinear(step);
        if (plan.kind === "leave") {
          return false;
        }
        if (plan.kind === "fault") {
          quietFault = plan.message;
          return true;
        }
        if (plan.kind === "drop") {
          for (let index = 0; index < plan.width; index += 1) {
            keptOctets.delete(plan.base + BigInt(index));
          }
          return false;
        }
        const bits = BigInt(plan.width * 8);
        const modulus = 1n << bits;
        if (plan.kind === "store") {
          let rest = plan.value < 0n ? plan.value + modulus : plan.value;
          for (let index = 0; index < plan.width; index += 1) {
            keptOctets.set(plan.base + BigInt(index), Number(rest & 0xffn));
            rest >>= 8n;
          }
          return true;
        }
        let loaded = 0n;
        for (let index = plan.width - 1; index >= 0; index -= 1) {
          loaded = (loaded << 8n) | BigInt(keptOctets.get(plan.base + BigInt(index)) ?? 0);
        }
        if (plan.width > 1) {
          const sign = modulus >> 1n;
          if (loaded >= sign) {
            loaded -= modulus;
          }
        }
        registers[plan.register] = loaded;
        return true;
      }

      /**
       * 标识字符串和不变的个数。Hz、执行条数、口状态每次仍去问。
       * 同一页会把同一个字符问很多遍。问过的留在核心里，这段不是协议里的缓存。
       */
      const queryCache = new Map<string, bigint>();

      function queryKey(seat: number, field: number, index: number): string {
        return `${String(seat)}:${String(field)}:${String(index)}`;
      }

      /** 把一组查询结果写进记录。列表里有非整数就一个都不留，并返回 false。 */
      function rememberSpan(seat: number, field: number, index: number, list: unknown, single: bigint | null): boolean {
        if (!Array.isArray(list)) {
          if (single !== null) {
            queryCache.set(queryKey(seat, field, index), single);
          }
          return single !== null;
        }
        const stored: bigint[] = [];
        for (const item of list) {
          if (typeof item !== "bigint") {
            return false;
          }
          stored.push(item);
        }
        for (let step = 0; step < stored.length; step += 1) {
          const item = stored[step];
          if (item === undefined) {
            return false;
          }
          queryCache.set(queryKey(seat, field, index + step), item);
        }
        return true;
      }

      function charQuery(seat: number, field: number): boolean {
        if (seat === 0) {
          return field === 2;
        }
        if (seat === 1 || seat === 2 || seat === 3) {
          return field === 2 || field === 3 || field === 4;
        }
        if (seat === 5) {
          return field === 1 || field === 2 || field === 3;
        }
        return false;
      }

      function liveQuery(seat: number, field: number): boolean {
        if (seat === 1) {
          return field === 5 || field === 6 || field === 7;
        }
        if (seat === 2) {
          return field === 5 || field === 6;
        }
        if (seat === 3) {
          return field === 6 || field === 7;
        }
        if (seat === 5) {
          return field === 0;
        }
        return false;
      }

      let pendingQuery: { readonly seat: number; readonly field: number; readonly index: number; readonly live: boolean } | null = null;

      /**
       * 这条查询的结果已经在核心里时，直接写入寄存器并继续往下执行。
       * 没有记录就返回 false，仍停下来去问主板。
       */
      type QueryPlan =
        | { readonly kind: "leave" }
        | { readonly kind: "fault"; readonly message: string }
        | { readonly kind: "hit"; readonly register: number; readonly value: bigint };

      /** 查询缓存命中或命令本身不完整。未命中返回 leave，出核心批可以把它送去主板。 */
      function queryPlan(step: Record<string, unknown>): QueryPlan {
        if (step["Op"] !== "query") {
          return { kind: "leave" };
        }
        const destination = registerIndex(step["Register"]);
        const seatRegister = registerIndex(step["Seat"]);
        const fieldRegister = registerIndex(step["Field"]);
        const indexRegister = registerIndex(step["Index"]);
        if (destination === null || seatRegister === null || fieldRegister === null || indexRegister === null) {
          return { kind: "fault", message: `${corePrefix} query command is incomplete` };
        }
        const seat = readNumber(seatRegister);
        const field = readNumber(fieldRegister);
        const index = readNumber(indexRegister);
        if (seat === null || field === null || index === null) {
          return { kind: "fault", message: `${corePrefix} query command integer is out of range` };
        }
        if (guestCore && (seat !== 1 || field < 0 || field > 12 || (field >= 5 && index !== selfOrdinal))) {
          return { kind: "fault", message: "[ZerOS.Hardware.Cpu.CpuRuntime] privileged instruction" };
        }
        const published = readMetric(seat, field, index);
        if (published.kind === "missing") {
          if (published.reason === "port") {
            return { kind: "fault", message: "[ZerOS.Hardware.Motherboard.ExpansionPort] expansion port is outside 0 to 3" };
          }
          if (published.reason === "core-unmounted") {
            return { kind: "fault", message: "[ZerOS.Hardware.Cpu.CpuRuntime] core is not mounted" };
          }
          return { kind: "fault", message: "[ZerOS.Hardware.Cpu.CpuRuntime] core ordinal is outside the declared range" };
        }
        if (published.kind === "value") {
          return { kind: "hit", register: destination, value: published.value };
        }
        const hit = queryCache.get(queryKey(seat, field, index));
        if (hit === undefined) {
          return { kind: "leave" };
        }
        return { kind: "hit", register: destination, value: hit };
      }

      function absorbQuery(step: Record<string, unknown>): boolean {
        const plan = queryPlan(step);
        if (plan.kind === "leave") {
          return false;
        }
        if (plan.kind === "fault") {
          quietFault = plan.message;
          return true;
        }
        registers[plan.register] = plan.value;
        return true;
      }

      function readStepNumber(step: Record<string, unknown>, key: string): number | null {
        const register = registerIndex(step[key]);
        if (register === null) {
          quietFault = `${corePrefix} GPU command register is outside 0 to 7`;
          return null;
        }
        const value = readNumber(register);
        if (value === null) {
          quietFault = `${corePrefix} GPU command integer is out of range`;
          return null;
        }
        return value;
      }

      /** 按这条指令当时的寄存器，抄出一条已经填好整数的显卡命令。失败时留下 quietFault。 */
      function captureQueuedGpu(step: Record<string, unknown>, op: string): Record<string, unknown> | null {
        const gpuOp = op.slice(4);
        const payload: Record<string, unknown> = { gpuOp };
        const fields: Record<string, readonly string[]> = {
          align: ["Node", "AlignX", "AlignY"],
          paint: ["Node", "Foreground", "Background"],
          glyph: ["Node", "Code"],
          drop: ["Node"],
          clear: ["Register"],
          plot: ["X", "Y", "Pixel"],
          character: ["X", "Y", "Code", "Foreground", "Background"],
          hertz: ["Hertz"],
          store: ["Address", "Value"],
        };
        const names = fields[gpuOp];
        if (names === undefined) {
          return payload;
        }
        const wire: Record<string, string> = {
          Node: "node",
          AlignX: "alignX",
          AlignY: "alignY",
          Foreground: "foreground",
          Background: "background",
          Code: "code",
          Register: "pixel",
          X: "x",
          Y: "y",
          Pixel: "pixel",
          Hertz: "hertz",
          Address: "address",
          Value: "value",
        };
        for (const name of names) {
          const value = readStepNumber(step, name);
          if (value === null) {
            return null;
          }
          const wireName = wire[name];
          if (wireName === undefined) {
            quietFault = `${corePrefix} GPU command was not recognized`;
            return null;
          }
          payload[wireName] = value;
        }
        return payload;
      }

      function isMemoryOp(op: string): boolean {
        return op === "load" || op === "store" || op === "ldi" || op === "sti";
      }

      /**
       * 帧指针这一字的 load.64 / store.64。
       * 读要等 frameWord 里已经有值。写只要数据是 64 位无符号，就直接记下，不再送内存。
       * 负数或超过 2^64−1 的写仍交给内存，失败句子和原来的单条 Store 一样。
       * 划在界外的也不碰，让原来的越界检查生效。
       */
      type FramePlan =
        | { readonly kind: "leave" }
        | { readonly kind: "fault" }
        | { readonly kind: "load"; readonly register: number }
        | { readonly kind: "store"; readonly value: bigint };

      function framePlan(step: Record<string, unknown>): FramePlan {
        const op = step["Op"];
        const writing = op === "store";
        if (op !== "load" && !writing) {
          return { kind: "leave" };
        }
        if (step["Address"] !== FrameAddress) {
          return { kind: "leave" };
        }
        const opcode = step["Opcode"];
        if (writing) {
          if (opcode !== Store64) {
            return { kind: "leave" };
          }
        } else if (opcode !== Load64 || frameWord === null) {
          return { kind: "leave" };
        }
        if (outsideBound(FrameAddress, 64n)) {
          return { kind: "leave" };
        }
        const register = registerIndex(step["Register"]);
        if (register === null) {
          return { kind: "fault" };
        }
        if (!writing) {
          return { kind: "load", register };
        }
        const value = readRegister(register);
        if (value < 0n || value > 0xffffffffffffffffn) {
          return { kind: "leave" };
        }
        return { kind: "store", value };
      }

      function absorbFrameLoad(step: Record<string, unknown>): boolean {
        const plan = framePlan(step);
        if (plan.kind === "leave") {
          return false;
        }
        if (plan.kind === "fault") {
          const writing = step["Op"] === "store";
          quietFault = `${corePrefix} ${writing ? "store" : "load"} command is incomplete`;
          return true;
        }
        if (plan.kind === "store") {
          frameWord = plan.value;
          return true;
        }
        const word = frameWord;
        if (word === null) {
          return false;
        }
        registers[plan.register] = word;
        return true;
      }

      /**
       * 后面这条会不会被核心吸收。
       * take 要先做完才能碰下一条。drop 会改缓存，也不能提前送进同一条主板消息。
       * leave 才是可以和前面的出核心访问排在一起的。
       * 监督核不受 bound 限制。帧字已经在手里时，即使划界把它划在外面，单条路径仍用帧字。
       */
      function predictAbsorb(step: Record<string, unknown>, checkBound: boolean): "take" | "drop" | "leave" {
        if (!checkBound && step["Op"] === "load" && step["Opcode"] === Load64 && step["Address"] === FrameAddress && frameWord !== null) {
          return "take";
        }
        if (framePlan(step).kind !== "leave" || scratchPlan(step).kind !== "leave") {
          return "take";
        }
        const linear = classifyLinear(step);
        if (linear.kind === "drop") {
          return "drop";
        }
        if (linear.kind !== "leave") {
          return "take";
        }
        if (queryPlan(step).kind !== "leave") {
          return "take";
        }
        return "leave";
      }

      /** 监督核的帧读取。bound 划在外面时吸收路径会放过，单条 Load 仍用帧字。 */
      function takeSupervisorFrame(step: Record<string, unknown>): boolean {
        if (step["Op"] !== "load" || step["Opcode"] !== Load64 || step["Address"] !== FrameAddress || frameWord === null) {
          return false;
        }
        const register = registerIndex(step["Register"]);
        if (register === null) {
          quietFault = `${corePrefix} load command is incomplete`;
          return true;
        }
        registers[register] = frameWord;
        return true;
      }

      let boundOrigin = 0n;
      let boundLength = -1n;
      let burstLimit = 100000;
      /** 这颗核心已被监督核划成客核心。显卡队列不得在交回宿主之前送出。 */
      let guestCore = false;
      /** 这颗核心自己的编号。客核心只能读自己的字段 5 至 12。 */
      let selfOrdinal = 0;

      function outsideBound(address: bigint, bits: bigint): boolean {
        if (boundLength < 0n) {
          return false;
        }
        if (address < boundOrigin) {
          return true;
        }
        return address + bits > boundOrigin + boundLength;
      }

      /*
       * 同一种本地整数运算的直循环。
       *
       * applyPacked 每条都要调用一次，并顺着 place、add、eq……判断下去。
       * 一段里操作码不变时，这些判断的答案从头到尾一样。这里先把连续的同一种、
       * 下标都在 0 到 7 的指令划成一段，再进只含这一种运算的循环。
       * 循环体内不调用函数。若改成每条调用一个运算回调，又会回到逐条调用那条慢路上。
       *
       * 下标不合法的那一条留在段外，仍由 applyPacked 报原来的失败句子。
       * 除零、无符号操作数不合法、移位超出 0 到 63，停在当前编号：不写目的寄存器，
       * 编号更大的指令也不会被这个循环做掉。
       * place、浮点、跳转和调用不进这里。跳转越界仍是 applyPacked 的失败。
       * 寄存器保持 bigint。ZCP1 不设位宽，这里不改成定宽数组，也不按 2^n 取模。
       */

      /**
       * 直循环最少条数。
       * 只有一条时仍走 applyPacked，失败句子才能和单条路径逐字相同。
       * 这不是 burst 消息字段，也不改变本拍上限。
       */
      const straightMinCount = 2;

      /**
       * 这种操作码能不能进直循环，以及要核对几个下标。
       * 2 是取反：目的和来源。3 是双操作数。0 表示留给 applyPacked。
       * place、浮点、跳转、调用都是 0。名单以外的新操作码也是 0，避免被误收进错误的循环。
       */
      function straightWidth(code: number): number {
        if (code === LocalNot) {
          return 2;
        }
        if (
          code === LocalAdd || code === LocalSub || code === LocalMul
          || code === LocalDiv || code === LocalMod || code === LocalUdiv || code === LocalUmod
          || code === LocalAnd || code === LocalOr || code === LocalXor || code === LocalShl || code === LocalShr
          || code === LocalEq || code === LocalLt || code === LocalLe || code === LocalGt || code === LocalGe
        ) {
          return 3;
        }
        return 0;
      }

      /**
       * 从 from 起，把同一种且下标都合法的指令划到开区间右端。
       * 不改寄存器，也不在这里失败。下标不合法就停在它前面，让 applyPacked 用原来的句子报错。
       * 空槽必须当成 RegisterMissing。写成 0 会把空槽误认成 0 号寄存器，合法段就被放宽了。
       */
      function findSameEnd(code: number, from: number, endLimit: number, width: number): number {
        const ops = packedOp;
        const slots = packedReg;
        const stride = RegisterStride;
        const count = RegisterCount;
        let end = from;
        while (end < endLimit) {
          /* 中间夹了别的操作码，后面留给下一轮。下一轮可能是另一种直循环，也可能是跳转。 */
          if ((ops[end] ?? LocalNone) !== code) {
            break;
          }
          const base = end * stride;
          const destination = slots[base] ?? RegisterMissing;
          const left = slots[base + 1] ?? RegisterMissing;
          if (destination >= count || left >= count) {
            break;
          }
          /* 取反只有目的和来源。右槽收指令时是空的，拿来核对会把合法的取反整段排掉。 */
          if (width === 3) {
            const right = slots[base + 2] ?? RegisterMissing;
            if (right >= count) {
              break;
            }
          }
          end += 1;
        }
        return end;
      }

      /**
       * 连续 add。调用方保证 [from, to) 全是 add，且三个下标都小于寄存器个数。
       * 本地绑定数组，避免循环里反复去读外层 let。运算直接写在循环里，不经回调。
       */
      function runAdd(from: number, to: number): void {
        const regs = registers;
        const slots = packedReg;
        const stride = RegisterStride;
        for (let at = from; at < to; at += 1) {
          const base = at * stride;
          /* (1) 下标已在划段时核对。0 只是类型上空槽的退路，正常段走不到。 */
          const destination = slots[base] ?? 0;
          const left = slots[base + 1] ?? 0;
          const right = slots[base + 2] ?? 0;
          /* (2) 先读后写。目的和来源是同一个寄存器时，用的是本条之前的值。 */
          const lhs = regs[left] ?? 0n;
          const rhs = regs[right] ?? 0n;
          /* (3) 和直接写回 bigint 寄存器，不按位宽截断。 */
          regs[destination] = lhs + rhs;
        }
      }

      /** 连续减法。装载和先读后写与 runAdd 相同，只把运算换成减。 */
      function runSub(from: number, to: number): void {
        const regs = registers;
        const slots = packedReg;
        const stride = RegisterStride;
        for (let at = from; at < to; at += 1) {
          const base = at * stride;
          const destination = slots[base] ?? 0;
          const left = slots[base + 1] ?? 0;
          const right = slots[base + 2] ?? 0;
          /* 先读后写。目的和来源重叠时用本条之前的值，写回不取模。 */
          const lhs = regs[left] ?? 0n;
          const rhs = regs[right] ?? 0n;
          regs[destination] = lhs - rhs;
        }
      }

      /** 连续乘法。不取模，乘积有多宽就写多宽。 */
      function runMul(from: number, to: number): void {
        const regs = registers;
        const slots = packedReg;
        const stride = RegisterStride;
        for (let at = from; at < to; at += 1) {
          const base = at * stride;
          const destination = slots[base] ?? 0;
          const left = slots[base + 1] ?? 0;
          const right = slots[base + 2] ?? 0;
          /* 先读后写。目的和来源重叠时用本条之前的值，写回不取模。 */
          const lhs = regs[left] ?? 0n;
          const rhs = regs[right] ?? 0n;
          regs[destination] = lhs * rhs;
        }
      }

      /** 连续按位与。 */
      function runAnd(from: number, to: number): void {
        const regs = registers;
        const slots = packedReg;
        const stride = RegisterStride;
        for (let at = from; at < to; at += 1) {
          const base = at * stride;
          const destination = slots[base] ?? 0;
          const left = slots[base + 1] ?? 0;
          const right = slots[base + 2] ?? 0;
          /* 先读后写。目的和来源重叠时用本条之前的值，写回不取模。 */
          const lhs = regs[left] ?? 0n;
          const rhs = regs[right] ?? 0n;
          regs[destination] = lhs & rhs;
        }
      }

      /** 连续按位或。 */
      function runOr(from: number, to: number): void {
        const regs = registers;
        const slots = packedReg;
        const stride = RegisterStride;
        for (let at = from; at < to; at += 1) {
          const base = at * stride;
          const destination = slots[base] ?? 0;
          const left = slots[base + 1] ?? 0;
          const right = slots[base + 2] ?? 0;
          /* 先读后写。目的和来源重叠时用本条之前的值，写回不取模。 */
          const lhs = regs[left] ?? 0n;
          const rhs = regs[right] ?? 0n;
          regs[destination] = lhs | rhs;
        }
      }

      /** 连续按位异或。 */
      function runXor(from: number, to: number): void {
        const regs = registers;
        const slots = packedReg;
        const stride = RegisterStride;
        for (let at = from; at < to; at += 1) {
          const base = at * stride;
          const destination = slots[base] ?? 0;
          const left = slots[base + 1] ?? 0;
          const right = slots[base + 2] ?? 0;
          /* 先读后写。目的和来源重叠时用本条之前的值，写回不取模。 */
          const lhs = regs[left] ?? 0n;
          const rhs = regs[right] ?? 0n;
          regs[destination] = lhs ^ rhs;
        }
      }

      /**
       * 连续取反。右槽在收指令时是空的，这里不读。
       * 先读来源再写目的，来源和目的是同一个寄存器时用的是旧值。
       */
      function runNot(from: number, to: number): void {
        const regs = registers;
        const slots = packedReg;
        const stride = RegisterStride;
        for (let at = from; at < to; at += 1) {
          const base = at * stride;
          const destination = slots[base] ?? 0;
          const sourceIndex = slots[base + 1] ?? 0;
          /* 右槽是空位，不参与取反。先读来源再写目的。 */
          const source = regs[sourceIndex] ?? 0n;
          regs[destination] = ~source;
        }
      }

      /** 连续相等比较。结果写成 0 或 1，与单条 eq 相同，不把布尔值留在寄存器里。 */
      function runEq(from: number, to: number): void {
        const regs = registers;
        const slots = packedReg;
        const stride = RegisterStride;
        for (let at = from; at < to; at += 1) {
          const base = at * stride;
          const destination = slots[base] ?? 0;
          const left = slots[base + 1] ?? 0;
          const right = slots[base + 2] ?? 0;
          /* 先读后写。目的和来源重叠时用本条之前的值，写回不取模。 */
          const lhs = regs[left] ?? 0n;
          const rhs = regs[right] ?? 0n;
          regs[destination] = lhs === rhs ? 1n : 0n;
        }
      }

      /** 连续小于。结果写成 0 或 1，与 applyOrder 相同。 */
      function runLt(from: number, to: number): void {
        const regs = registers;
        const slots = packedReg;
        const stride = RegisterStride;
        for (let at = from; at < to; at += 1) {
          const base = at * stride;
          const destination = slots[base] ?? 0;
          const left = slots[base + 1] ?? 0;
          const right = slots[base + 2] ?? 0;
          /* 先读后写。目的和来源重叠时用本条之前的值，写回不取模。 */
          const lhs = regs[left] ?? 0n;
          const rhs = regs[right] ?? 0n;
          regs[destination] = lhs < rhs ? 1n : 0n;
        }
      }

      /** 连续小于等于。结果写成 0 或 1。 */
      function runLe(from: number, to: number): void {
        const regs = registers;
        const slots = packedReg;
        const stride = RegisterStride;
        for (let at = from; at < to; at += 1) {
          const base = at * stride;
          const destination = slots[base] ?? 0;
          const left = slots[base + 1] ?? 0;
          const right = slots[base + 2] ?? 0;
          /* 先读后写。目的和来源重叠时用本条之前的值，写回不取模。 */
          const lhs = regs[left] ?? 0n;
          const rhs = regs[right] ?? 0n;
          regs[destination] = lhs <= rhs ? 1n : 0n;
        }
      }

      /** 连续大于。结果写成 0 或 1。 */
      function runGt(from: number, to: number): void {
        const regs = registers;
        const slots = packedReg;
        const stride = RegisterStride;
        for (let at = from; at < to; at += 1) {
          const base = at * stride;
          const destination = slots[base] ?? 0;
          const left = slots[base + 1] ?? 0;
          const right = slots[base + 2] ?? 0;
          /* 先读后写。目的和来源重叠时用本条之前的值，写回不取模。 */
          const lhs = regs[left] ?? 0n;
          const rhs = regs[right] ?? 0n;
          regs[destination] = lhs > rhs ? 1n : 0n;
        }
      }

      /** 连续大于等于。结果写成 0 或 1。 */
      function runGe(from: number, to: number): void {
        const regs = registers;
        const slots = packedReg;
        const stride = RegisterStride;
        for (let at = from; at < to; at += 1) {
          const base = at * stride;
          const destination = slots[base] ?? 0;
          const left = slots[base + 1] ?? 0;
          const right = slots[base + 2] ?? 0;
          /* 先读后写。目的和来源重叠时用本条之前的值，写回不取模。 */
          const lhs = regs[left] ?? 0n;
          const rhs = regs[right] ?? 0n;
          regs[destination] = lhs >= rhs ? 1n : 0n;
        }
      }

      /**
       * 连续有符号除法。
       * 除数是 0 时用和 applyArith 相同的句子失败，返回这一条的编号，目的寄存器不写。
       * 整段都成功时返回 to。调用方用这个返回值停住，不会把失败后面的指令做掉。
       */
      function runDiv(from: number, to: number): number {
        const regs = registers;
        const slots = packedReg;
        const stride = RegisterStride;
        for (let at = from; at < to; at += 1) {
          const base = at * stride;
          const destination = slots[base] ?? 0;
          const left = slots[base + 1] ?? 0;
          const right = slots[base + 2] ?? 0;
          const lhs = regs[left] ?? 0n;
          const rhs = regs[right] ?? 0n;
          /* 除数是 0 先返回。写在检查之后，这一条不会改目的寄存器。 */
          if (rhs === 0n) {
            fail("divisor is 0");
            return at;
          }
          regs[destination] = lhs / rhs;
        }
        return to;
      }

      /**
       * 连续有符号求余。除数是 0 时与除法同一句失败。
       * 余数与 applyArith 相同：商向零截断，再用被除数减去商乘除数。
       */
      function runMod(from: number, to: number): number {
        const regs = registers;
        const slots = packedReg;
        const stride = RegisterStride;
        for (let at = from; at < to; at += 1) {
          const base = at * stride;
          const destination = slots[base] ?? 0;
          const left = slots[base + 1] ?? 0;
          const right = slots[base + 2] ?? 0;
          const lhs = regs[left] ?? 0n;
          const rhs = regs[right] ?? 0n;
          /* 除数是 0 先返回。写在检查之后，这一条不会改目的寄存器。 */
          if (rhs === 0n) {
            fail("divisor is 0");
            return at;
          }
          const quotient = lhs / rhs;
          regs[destination] = lhs - quotient * rhs;
        }
        return to;
      }

      /**
       * 连续无符号除法。
       * 除数小于等于 0，或被除数小于 0，用和 applyArith 相同的句子失败，不写目的寄存器。
       */
      function runUdiv(from: number, to: number): number {
        const regs = registers;
        const slots = packedReg;
        const stride = RegisterStride;
        for (let at = from; at < to; at += 1) {
          const base = at * stride;
          const destination = slots[base] ?? 0;
          const left = slots[base + 1] ?? 0;
          const right = slots[base + 2] ?? 0;
          const lhs = regs[left] ?? 0n;
          const rhs = regs[right] ?? 0n;
          /* 无符号操作数不合法先返回，目的寄存器保持进入这一条之前的值。 */
          if (rhs <= 0n || lhs < 0n) {
            fail("unsigned division operand is illegal");
            return at;
          }
          regs[destination] = lhs / rhs;
        }
        return to;
      }

      /**
       * 连续无符号求余。失败条件与无符号除法相同。
       * 成功时用 %，与 applyArith 的无符号余数一致，不用有符号那条还原式。
       */
      function runUmod(from: number, to: number): number {
        const regs = registers;
        const slots = packedReg;
        const stride = RegisterStride;
        for (let at = from; at < to; at += 1) {
          const base = at * stride;
          const destination = slots[base] ?? 0;
          const left = slots[base + 1] ?? 0;
          const right = slots[base + 2] ?? 0;
          const lhs = regs[left] ?? 0n;
          const rhs = regs[right] ?? 0n;
          /* 无符号操作数不合法先返回，目的寄存器保持进入这一条之前的值。 */
          if (rhs <= 0n || lhs < 0n) {
            fail("unsigned division operand is illegal");
            return at;
          }
          regs[destination] = lhs % rhs;
        }
        return to;
      }

      /**
       * 连续左移。次数不在 0 到 63 时停在这一条，不写目的寄存器。
       * 检查放在移位前面，避免运行时抛错，也避免失败的这条被写上。
       */
      function runShl(from: number, to: number): number {
        const regs = registers;
        const slots = packedReg;
        const stride = RegisterStride;
        for (let at = from; at < to; at += 1) {
          const base = at * stride;
          const destination = slots[base] ?? 0;
          const left = slots[base + 1] ?? 0;
          const right = slots[base + 2] ?? 0;
          const lhs = regs[left] ?? 0n;
          const rhs = regs[right] ?? 0n;
          /* 次数越界先返回。不能先移位，否则运行时抛错，目的寄存器也会被写上。 */
          if (rhs < 0n || rhs > 63n) {
            fail("shift count is outside 0 to 63");
            return at;
          }
          regs[destination] = lhs << rhs;
        }
        return to;
      }

      /** 连续算术右移。次数范围和失败句子与左移相同，方向与 applyArith 的 shr 相同。 */
      function runShr(from: number, to: number): number {
        const regs = registers;
        const slots = packedReg;
        const stride = RegisterStride;
        for (let at = from; at < to; at += 1) {
          const base = at * stride;
          const destination = slots[base] ?? 0;
          const left = slots[base + 1] ?? 0;
          const right = slots[base + 2] ?? 0;
          const lhs = regs[left] ?? 0n;
          const rhs = regs[right] ?? 0n;
          /* 次数越界先返回。不能先移位，否则运行时抛错，目的寄存器也会被写上。 */
          if (rhs < 0n || rhs > 63n) {
            fail("shift count is outside 0 to 63");
            return at;
          }
          regs[destination] = lhs >> rhs;
        }
        return to;
      }

      /**
       * 按操作码进入对应的直循环。这个 switch 一段只走一次，不在每条指令上走。
       * 不会失败的运算做完整个 [from, to)，返回 to。
       * 会失败的运算返回停住的编号。这个编号不能改成 to，否则失败那一条和它后面的会被当成已经做完。
       * 名单和 straightWidth 不一致时什么都不做，返回 from，调用方再逐条执行。
       */
      function runSame(code: number, from: number, to: number): number {
        switch (code) {
          case LocalAdd:
            runAdd(from, to);
            return to;
          case LocalSub:
            runSub(from, to);
            return to;
          case LocalMul:
            runMul(from, to);
            return to;
          case LocalAnd:
            runAnd(from, to);
            return to;
          case LocalOr:
            runOr(from, to);
            return to;
          case LocalXor:
            runXor(from, to);
            return to;
          case LocalNot:
            runNot(from, to);
            return to;
          case LocalEq:
            runEq(from, to);
            return to;
          case LocalLt:
            runLt(from, to);
            return to;
          case LocalLe:
            runLe(from, to);
            return to;
          case LocalGt:
            runGt(from, to);
            return to;
          case LocalGe:
            runGe(from, to);
            return to;
          case LocalDiv:
            return runDiv(from, to);
          case LocalMod:
            return runMod(from, to);
          case LocalUdiv:
            return runUdiv(from, to);
          case LocalUmod:
            return runUmod(from, to);
          case LocalShl:
            return runShl(from, to);
          case LocalShr:
            return runShr(from, to);
          default:
            return from;
        }
      }

      /**
       * 从起点执行到程序结束、本拍条数用尽，或一条指令失败。
       * 连续的同一种整数运算走直循环。其余本地指令仍逐条走 applyPacked。
       * 失败时 cursor 停在失败的那一条，这一条不计入 executed。
       */
      function runBurst(start: number): { readonly cursor: number; readonly executed: number; readonly flush: boolean } {
        const steps = program;
        if (steps === null || !Number.isInteger(start) || start < 0) {
          quietFault = `${corePrefix} local execution start is illegal`;
          return { cursor: start, executed: 0, flush: heldQueue.length > 0 };
        }
        quiet = true;
        quietFault = "";
        let cursor = start;
        let executed = 0;
        while (cursor < steps.length && executed < burstLimit) {
          /*
           * 本地运算不读对象。操作码是小整数。
           * 连续两条以上、下标都合法、又是同一种不改控制流的整数运算时，整段走直循环。
           * 否则仍逐条 applyPacked，失败句子不变。
           */
          const code = cursor < packedOp.length ? (packedOp[cursor] ?? LocalNone) : LocalNone;
          if (code !== LocalNone) {
            const width = straightWidth(code);
            if (width !== 0) {
              /* 上界取本拍剩余条数、程序长度、紧凑指令数的最小值。packedOp.length 是指令数，不是槽数组的长度。 */
              const roomEnd = cursor + (burstLimit - executed);
              const endLimit = Math.min(roomEnd, steps.length, packedOp.length);
              /* 下一条已经不是同一种，最多只有一条，不值得划段。 */
              if (cursor + 1 < endLimit && (packedOp[cursor + 1] ?? LocalNone) === code) {
                const end = findSameEnd(code, cursor, endLimit, width);
                if (end - cursor >= straightMinCount) {
                  const stopped = runSame(code, cursor, end);
                  /*
                   * stopped 指向还没成功完成的那一条：整段成功时是段尾，失败时是失败编号。
                   * 相减得到的是已经写入的条数，失败那一条本身不计入。
                   * 直循环没收下时 stopped 仍是 cursor 且没有失败，退回逐条。
                   */
                  if (stopped !== cursor || quietFault !== "") {
                    executed += stopped - cursor;
                    cursor = stopped;
                    /* break 跳出的是本拍的 while。失败后不再执行后面的指令。 */
                    if (quietFault !== "") {
                      break;
                    }
                    continue;
                  }
                }
              }
            }
            const next = applyPacked(cursor, steps.length);
            if (quietFault !== "") {
              break;
            }
            cursor = next;
            executed += 1;
            continue;
          }
          const step = steps[cursor];
          if (step === undefined) {
            break;
          }
          const op = step["Op"];
          if (typeof op !== "string") {
            break;
          }
          if (guestCore && op.startsWith("gpu.")) {
            quietFault = `${corePrefix} privileged instruction`;
            break;
          }
          /* 收紧凑时漏掉的本地操作不能悄悄跳过，否则游标不前进，宿主会反复再发。 */
          if (isLocalOp(op)) {
            quietFault = `${corePrefix} local instruction is incomplete`;
            break;
          }
          if (absorbFrameLoad(step)) {
            if (quietFault !== "") {
              break;
            }
            cursor += 1;
            executed += 1;
            continue;
          }
          if (absorbScratch(step)) {
            if (quietFault !== "") {
              break;
            }
            cursor += 1;
            executed += 1;
            continue;
          }
          if (absorbLinear(step)) {
            if (quietFault !== "") {
              break;
            }
            cursor += 1;
            executed += 1;
            continue;
          }
          if (absorbQuery(step)) {
            if (quietFault !== "") {
              break;
            }
            cursor += 1;
            executed += 1;
            continue;
          }
          if (op === "gpu.accel" && !readsSix(steps[cursor + 1])) {
            const capturedAccel = captureAccel(step);
            if (capturedAccel === null) {
              break;
            }
            heldQueue.push(capturedAccel);
            cursor += 1;
            executed += 1;
            continue;
          }
          if (!isQueuedGpu(op)) {
            break;
          }
          const captured = captureQueuedGpu(step, op);
          if (captured === null) {
            break;
          }
          heldQueue.push(captured);
          cursor += 1;
          executed += 1;
        }
        quiet = false;
        const stopped = cursor < steps.length ? steps[cursor]?.["Op"] : undefined;
        const hold = quietFault === "" && typeof stopped === "string" && isMemoryOp(stopped);
        return { cursor, executed, flush: !hold };
      }

      /**
       * 三个下标都在 0 到 7 才继续。
       * 失败语句按原来的单条命令，宿主记录仍能对上同一种错。
       */
      function rejectTriple(destination: number, left: number, right: number, message: string): boolean {
        if (destination >= RegisterCount || left >= RegisterCount || right >= RegisterCount) {
          fail(message);
          return true;
        }
        return false;
      }

      /**
       * 减法、乘除和位运算。先读后写，除零和移位越界不改目的寄存器。
       * 分支顺序与原来的 onArith 相同，无符号除法仍落在最后一支。
       */
      function applyArith(code: number, destination: number, left: number, right: number): void {
        const lhs = readRegister(left);
        const rhs = readRegister(right);
        let result = 0n;
        if (code === LocalSub) {
          result = lhs - rhs;
        } else if (code === LocalMul) {
          result = lhs * rhs;
        } else if (code === LocalDiv || code === LocalMod) {
          if (rhs === 0n) {
            fail("divisor is 0");
            return;
          }
          const quotient = lhs / rhs;
          result = code === LocalDiv ? quotient : lhs - quotient * rhs;
        } else if (code === LocalAnd) {
          result = lhs & rhs;
        } else if (code === LocalOr) {
          result = lhs | rhs;
        } else if (code === LocalXor) {
          result = lhs ^ rhs;
        } else if (code === LocalShl || code === LocalShr) {
          if (rhs < 0n || rhs > 63n) {
            fail("shift count is outside 0 to 63");
            return;
          }
          result = code === LocalShl ? lhs << rhs : lhs >> rhs;
        } else if (rhs <= 0n || lhs < 0n) {
          fail("unsigned division operand is illegal");
          return;
        } else if (code === LocalUdiv) {
          result = lhs / rhs;
        } else {
          result = lhs % rhs;
        }
        registers[destination] = result;
      }

      /** 有序比较写成 0 或 1。目的寄存器在两个操作数都读完之后才写。 */
      function applyOrder(code: number, destination: number, left: number, right: number): void {
        const lhs = readRegister(left);
        const rhs = readRegister(right);
        let result = false;
        if (code === LocalLt) {
          result = lhs < rhs;
        } else if (code === LocalLe) {
          result = lhs <= rhs;
        } else if (code === LocalGt) {
          result = lhs > rhs;
        } else {
          result = lhs >= rhs;
        }
        registers[destination] = result ? 1n : 0n;
      }

      /**
       * 执行一条已经收紧的本地指令。
       * 成功时返回下一条的编号，跳转则返回目标编号。失败时编号不变，并留下原来的失败语句。
       */
      function applyPacked(cursor: number, length: number): number {
        const code = packedOp[cursor] ?? LocalNone;
        const base = cursor * RegisterStride;
        const destination = packedReg[base] ?? RegisterMissing;
        const left = packedReg[base + 1] ?? RegisterMissing;
        const right = packedReg[base + 2] ?? RegisterMissing;
        if (code === LocalPlace) {
          const data = packedImm[cursor];
          if (destination >= RegisterCount || data === undefined || data === null) {
            fail("place register or immediate is illegal");
            return cursor;
          }
          registers[destination] = data;
          return cursor + 1;
        }
        if (code === LocalAdd) {
          if (rejectTriple(destination, left, right, "add register is outside 0 to 7")) {
            return cursor;
          }
          registers[destination] = readRegister(left) + readRegister(right);
          return cursor + 1;
        }
        if (code === LocalEq) {
          if (rejectTriple(destination, left, right, "eq register is outside 0 to 7")) {
            return cursor;
          }
          registers[destination] = readRegister(left) === readRegister(right) ? 1n : 0n;
          return cursor + 1;
        }
        if (code === LocalNot) {
          if (destination >= RegisterCount || left >= RegisterCount) {
            fail("not register is outside 0 to 7");
            return cursor;
          }
          registers[destination] = ~readRegister(left);
          return cursor + 1;
        }
        if (code === LocalItof || code === LocalFeq || code === LocalFadd || code === LocalFsub || code === LocalFmul || code === LocalFdiv || code === LocalFpow || code === LocalFmod) {
          operandScratch["destination"] = destination;
          operandScratch["left"] = left;
          operandScratch["right"] = right;
          operandScratch["source"] = left;
          if (code === LocalItof) {
            onIntegerToFloat(operandScratch);
          } else if (code === LocalFeq) {
            onFloatEqual(operandScratch);
          } else if (code === LocalFadd) {
            onFloat(operandScratch, "fadd");
          } else if (code === LocalFsub) {
            onFloat(operandScratch, "fsub");
          } else if (code === LocalFmul) {
            onFloat(operandScratch, "fmul");
          } else if (code === LocalFdiv) {
            onFloat(operandScratch, "fdiv");
          } else if (code === LocalFpow) {
            onFloat(operandScratch, "fpow");
          } else {
            onFloat(operandScratch, "fmod");
          }
          if (quietFault !== "") {
            return cursor;
          }
          return cursor + 1;
        }
        if (
          code === LocalSub || code === LocalUdiv || code === LocalUmod || code === LocalMul
          || code === LocalDiv || code === LocalMod || code === LocalAnd || code === LocalOr
          || code === LocalXor || code === LocalShl || code === LocalShr
        ) {
          if (rejectTriple(destination, left, right, "arithmetic register is outside 0 to 7")) {
            return cursor;
          }
          applyArith(code, destination, left, right);
          if (quietFault !== "") {
            return cursor;
          }
          return cursor + 1;
        }
        if (code === LocalLt || code === LocalLe || code === LocalGt || code === LocalGe) {
          if (rejectTriple(destination, left, right, "compare register is outside 0 to 7")) {
            return cursor;
          }
          applyOrder(code, destination, left, right);
          return cursor + 1;
        }
        if (code === LocalJz || code === LocalJnz) {
          const at = packedTarget[cursor];
          if (destination >= RegisterCount || at === undefined || at === null) {
            quietFault = `${corePrefix} jump is incomplete`;
            return cursor;
          }
          const taken = code === LocalJz ? readRegister(destination) === 0n : readRegister(destination) !== 0n;
          if (!taken) {
            return cursor + 1;
          }
          if (!Number.isInteger(at) || at < 0 || at >= length) {
            quietFault = `${corePrefix} jump target is outside this program`;
            return cursor;
          }
          return at;
        }
        if (code === LocalLink || code === LocalCall) {
          const at = packedTarget[cursor];
          if (destination >= RegisterCount || at === undefined || at === null || !Number.isInteger(at) || at < 0 || at >= length) {
            quietFault = `${corePrefix} jump target is outside this program`;
            return cursor;
          }
          registers[destination] = BigInt(cursor + 1);
          return at;
        }
        if (code === LocalJmp || code === LocalRet) {
          if (destination >= RegisterCount) {
            quietFault = `${corePrefix} jump is incomplete`;
            return cursor;
          }
          const at = readRegister(destination);
          if (at < 0n || at >= BigInt(length)) {
            quietFault = `${corePrefix} jump target is outside this program`;
            return cursor;
          }
          return Number(at);
        }
        quietFault = `${corePrefix} local instruction is incomplete`;
        return cursor;
      }

      function fail(message: string): void {
        waiting = false;
        pendingRegister = null;
        pendingFound = null;
        reply(false, false, 0n, `${corePrefix} ${message}`);
      }

      function registerIndex(value: unknown): number | null {
        if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value >= RegisterCount) {
          return null;
        }
        return value;
      }

      function readRegister(index: number): bigint {
        const value = registers[index];
        if (value === undefined) {
          return 0n;
        }
        return value;
      }

      /** 加速参数里的有限整数。小数和越界都不当成地址或长度。 */
      function finiteInteger(bits: bigint): number | null {
        fontBits.setBigInt64(0, BigInt.asIntN(64, bits), true);
        const value = fontBits.getFloat64(0, true);
        if (!Number.isSafeInteger(value)) {
          return null;
        }
        return value;
      }

      /**
       * FontFace 和 FontDraw 要先把线性位元读进这条命令。
       * 参数不合法时不读，原样送去显卡，由显卡拒绝并且不分配编号。
       * 返回 true 表示已经开始读，调用方不要再送这一条。
       */
      function beginFontRead(payload: Record<string, unknown>): boolean {
        const op = payload["operation"];
        const a = payload["a"];
        const b = payload["b"];
        const c = payload["c"];
        if (op !== 40 && op !== 42) {
          return false;
        }
        if (typeof a !== "bigint" || typeof b !== "bigint" || typeof c !== "bigint") {
          return false;
        }
        const address = finiteInteger(a);
        const second = finiteInteger(b);
        if (address === null || second === null || address < 0 || address % 8 !== 0) {
          return false;
        }
        let length = 0;
        if (op === 40) {
          const ppem = finiteInteger(c);
          if (ppem === null || ppem < 1 || ppem > 256 || second < 1 || second > InstallOctetLimit) {
            return false;
          }
          length = second;
        } else if (second < 0 || second > 4096) {
          return false;
        } else {
          length = second * 4;
        }
        if (length === 0) {
          payload["bytes"] = new Uint8Array(0);
          return false;
        }
        if (spanActive || fontHold !== null) {
          fail("font memory access is still in flight");
          return true;
        }
        const register = pendingRegister;
        if (register === null) {
          fail("font command register is outside 0 to 7");
          return true;
        }
        fontHold = { payload, register };
        spanBytes = new Uint8Array(length);
        spanAt = 0;
        spanBit = BigInt(address);
        spanActive = true;
        stepSpan();
        return true;
      }

      function finishSpan(ok: boolean, message: string): void {
        spanActive = false;
        const payload = spanBytes;
        spanBytes = null;
        const hold = fontHold;
        fontHold = null;
        if (hold !== null) {
          if (!ok || payload === null) {
            pendingRegister = null;
            waiting = false;
            reply(false, false, 0n, message.length > 0 ? message : `${corePrefix} font memory access failed`);
            return;
          }
          hold.payload["bytes"] = payload;
          const boardPort = board;
          if (boardPort === null) {
            pendingRegister = null;
            reply(false, false, 0n, `${corePrefix} font memory access has no board`);
            return;
          }
          pendingRegister = hold.register;
          waiting = true;
          boardPort.postMessage(hold.payload);
          return;
        }
        const port = cpu;
        if (port === null) {
          return;
        }
        port.postMessage({ kind: "span", ok, bytes: payload, message });
      }

      /**
       * 先用这一核心已经写过的八位组。没写过的一段一次问主板。
       * 装入必须看见和 load 一样的字节，包括还留在核心里的那些。
       */
      function stepSpan(): void {
        const bytes = spanBytes;
        if (bytes === null) {
          return;
        }
        while (spanAt < bytes.length) {
          const bit = spanBit + BigInt(spanAt) * 8n;
          const key = bit / 8n;
          if (keptOctets.has(key)) {
            bytes[spanAt] = keptOctets.get(key) ?? 0;
            spanAt += 1;
            continue;
          }
          const boardPort = board;
          if (boardPort === null) {
            finishSpan(false, `${corePrefix} install memory access has no board`);
            return;
          }
          const room = bytes.length - spanAt;
          const cap = room < 262144 ? room : 262144;
          const startKey = bit / 8n;
          const endKey = startKey + BigInt(cap);
          let run = cap;
          for (const key of keptOctets.keys()) {
            if (key > startKey && key < endKey) {
              const distance = Number(key - startKey);
              if (distance < run) {
                run = distance;
              }
            }
          }
          if (run < 1) {
            finishSpan(false, `${corePrefix} install memory access failed`);
            return;
          }
          boardPort.postMessage({ kind: "load-span", address: bit, length: run });
          return;
        }
        finishSpan(true, "");
      }

      /** 一条已经填好整数、准备离开核心的访问。主板按 tag 解释，不看客指令名。 */
      interface AccessWire {
        readonly tag: number;
        readonly opcode: number;
        readonly address: bigint;
        readonly data: bigint;
        readonly a: number;
        readonly b: number;
        readonly c: number;
        readonly d: number;
      }

      /** 主板把结果送回来之后，核心按这份记录写寄存器和缓存。 */
      interface AccessMeta {
        readonly apply: "load" | "store" | "port" | "inbox" | "query";
        readonly register: number;
        readonly found: number;
        readonly frameStore: bigint | null;
        readonly frameLoad: boolean;
        readonly querySeat: number;
        readonly queryField: number;
        readonly queryIndex: number;
        readonly queryLive: boolean;
      }

      interface AccessBuilt {
        readonly wire: AccessWire;
        readonly meta: AccessMeta;
      }

      type AccessBuild =
        | { readonly kind: "item"; readonly built: AccessBuilt }
        | { readonly kind: "stop" }
        | { readonly kind: "fault"; readonly message: string; readonly hostFault: string };

      /**
       * 一次出核心访问还没回答 CPU。
       * 中间可以先吸收一段，再送一批主板命令。失败时游标停在那一条。
       */
      interface AccessJob {
        readonly origin: number;
        readonly end: number;
        cursor: number;
        readonly checkBound: boolean;
        metas: AccessMeta[];
        runStart: number;
        nextCursor: number;
        faultAfter: string;
        hostAfter: string;
      }

      let accessJob: AccessJob | null = null;

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

      /** 监督核不检查。位数为 0 的操作码也算越界，与 CPU 线程的 withinBound 一致。 */
      function hitsBound(address: bigint, bits: number, checkBound: boolean): boolean {
        if (!checkBound) {
          return false;
        }
        if (bits < 1) {
          return true;
        }
        return outsideBound(address, BigInt(bits));
      }

      function blankMeta(apply: AccessMeta["apply"], register: number): AccessMeta {
        return {
          apply,
          register,
          found: -1,
          frameStore: null,
          frameLoad: false,
          querySeat: 0,
          queryField: 0,
          queryIndex: 0,
          queryLive: false,
        };
      }

      function wireOf(tag: number, opcode: number, address: bigint, data: bigint, a: number, b: number, c: number, d: number): AccessWire {
        return { tag, opcode, address, data, a, b, c, d };
      }

      function buildMemory(step: Record<string, unknown>, checkBound: boolean): AccessBuild {
        const op = step["Op"];
        const writing = op === "store" || op === "sti";
        const incomplete = `${corePrefix} ${writing ? "Store" : "Load"} command is incomplete`;
        const opcode = step["Opcode"];
        if (typeof opcode !== "number") {
          return { kind: "fault", message: incomplete, hostFault: "" };
        }
        let address: bigint;
        if (op === "load" || op === "store") {
          const direct = step["Address"];
          if (typeof direct !== "bigint") {
            return { kind: "fault", message: incomplete, hostFault: "" };
          }
          address = direct;
        } else {
          const pointer = registerIndex(step["Address"]);
          if (pointer === null) {
            return { kind: "fault", message: `${corePrefix} indirect address register is outside 0 to 7`, hostFault: "" };
          }
          address = readRegister(pointer);
        }
        const register = registerIndex(step["Register"]);
        if (register === null) {
          return { kind: "fault", message: incomplete, hostFault: "" };
        }
        const bits = accessBits(opcode);
        if (hitsBound(address, bits, checkBound)) {
          return { kind: "fault", message: "", hostFault: "bound" };
        }
        const data = writing ? readRegister(register) : 0n;
        const frame = address === FrameAddress && opcode === (writing ? Store64 : Load64);
        const meta = blankMeta(writing ? "store" : "load", register);
        return {
          kind: "item",
          built: {
            wire: wireOf(AccessExec, opcode, address, data, 0, 0, 0, 0),
            meta: {
              ...meta,
              frameStore: writing && frame ? data : null,
              frameLoad: !writing && frame,
            },
          },
        };
      }

      function buildQuery(step: Record<string, unknown>): AccessBuild {
        const destination = registerIndex(step["Register"]);
        const seatRegister = registerIndex(step["Seat"]);
        const fieldRegister = registerIndex(step["Field"]);
        const indexRegister = registerIndex(step["Index"]);
        if (destination === null || seatRegister === null || fieldRegister === null || indexRegister === null) {
          return { kind: "fault", message: `${corePrefix} query command is incomplete`, hostFault: "" };
        }
        const seat = readNumber(seatRegister);
        const field = readNumber(fieldRegister);
        const index = readNumber(indexRegister);
        if (seat === null || field === null || index === null) {
          return { kind: "fault", message: `${corePrefix} query command integer is out of range`, hostFault: "" };
        }
        /* 座位 1 的标识在 CPU 线程。停在这里，让原来的单条路径去答。 */
        if (seat === 1) {
          return { kind: "stop" };
        }
        if (guestCore) {
          return { kind: "fault", message: "", hostFault: "guest" };
        }
        let count = 1;
        if (charQuery(seat, field)) {
          count = 32;
          if (seat === 5) {
            const room = 64 - (index % 64);
            if (room < count) {
              count = room;
            }
          }
        }
        const meta = blankMeta("query", destination);
        return {
          kind: "item",
          built: {
            wire: wireOf(AccessQuery, 0, 0n, 0n, seat, field, index, count),
            meta: {
              ...meta,
              querySeat: seat,
              queryField: field,
              queryIndex: index,
              queryLive: liveQuery(seat, field),
            },
          },
        };
      }

      function buildFill(step: Record<string, unknown>, checkBound: boolean): AccessBuild {
        if (guestCore) {
          return { kind: "fault", message: "", hostFault: "guest" };
        }
        const destination = registerIndex(step["Destination"]);
        const index = registerIndex(step["Port"]);
        const addressRegister = registerIndex(step["Address"]);
        const countRegister = registerIndex(step["Count"]);
        if (destination === null || index === null || addressRegister === null || countRegister === null) {
          return { kind: "fault", message: `${corePrefix} carry command is incomplete`, hostFault: "" };
        }
        const address = readRegister(addressRegister);
        const countWord = readRegister(countRegister);
        if (address < 0n || address % 8n !== 0n) {
          return { kind: "fault", message: "", hostFault: "fill-align" };
        }
        if (countWord < 0n || countWord > 4096n) {
          return { kind: "fault", message: "", hostFault: "fill-length" };
        }
        const count = Number(countWord);
        if (count > 0 && hitsBound(address, count * 8, checkBound)) {
          return { kind: "fault", message: "", hostFault: "bound" };
        }
        const portNumber = readNumber(index);
        if (portNumber === null) {
          return { kind: "fault", message: `${corePrefix} carry command integer is out of range`, hostFault: "" };
        }
        return {
          kind: "item",
          built: {
            wire: wireOf(AccessFill, 0, address, 0n, portNumber, 0, count, 0),
            meta: blankMeta("port", destination),
          },
        };
      }

      function buildCarry(step: Record<string, unknown>, checkBound: boolean): AccessBuild {
        if (guestCore) {
          return { kind: "fault", message: "", hostFault: "guest" };
        }
        const destination = registerIndex(step["Destination"]);
        const index = registerIndex(step["Port"]);
        const handleRegister = registerIndex(step["Handle"]);
        const offsetRegister = registerIndex(step["Offset"]);
        const addressRegister = registerIndex(step["Address"]);
        const countRegister = registerIndex(step["Count"]);
        if (destination === null || index === null || handleRegister === null || offsetRegister === null || addressRegister === null || countRegister === null) {
          return { kind: "fault", message: `${corePrefix} fill command is incomplete`, hostFault: "" };
        }
        const address = readRegister(addressRegister);
        const countWord = readRegister(countRegister);
        if (address < 0n || address % 8n !== 0n) {
          return { kind: "fault", message: "", hostFault: "carry-align" };
        }
        if (countWord < 0n || countWord > 268435456n) {
          return { kind: "fault", message: "", hostFault: "carry-length" };
        }
        const count = Number(countWord);
        if (count > 0 && hitsBound(address, count * 8, checkBound)) {
          return { kind: "fault", message: "", hostFault: "bound" };
        }
        const portNumber = readNumber(index);
        const handle = readNumber(handleRegister);
        const offset = readNumber(offsetRegister);
        if (portNumber === null || handle === null || offset === null) {
          return { kind: "fault", message: `${corePrefix} fill command integer is out of range`, hostFault: "" };
        }
        return {
          kind: "item",
          built: {
            wire: wireOf(AccessCarry, 0, address, 0n, portNumber, handle, offset, count),
            meta: blankMeta("port", destination),
          },
        };
      }

      function buildExchange(step: Record<string, unknown>): AccessBuild {
        if (guestCore) {
          return { kind: "fault", message: "", hostFault: "guest" };
        }
        const index = registerIndex(step["Port"]);
        const direction = registerIndex(step["Direction"]);
        const data = registerIndex(step["Data"]);
        if (index === null || direction === null || data === null) {
          return { kind: "fault", message: `${corePrefix} exchange command is incomplete`, hostFault: "" };
        }
        const portNumber = readNumber(index);
        const directionNumber = readNumber(direction);
        const word = readU64(data);
        if (portNumber === null || directionNumber === null || word === null) {
          return { kind: "fault", message: `${corePrefix} exchange command integer is out of range`, hostFault: "" };
        }
        return {
          kind: "item",
          built: {
            wire: wireOf(AccessExchange, 0, 0n, word, portNumber, directionNumber, 0, 0),
            meta: blankMeta("port", data),
          },
        };
      }

      function buildInbox(step: Record<string, unknown>): AccessBuild {
        if (guestCore) {
          return { kind: "fault", message: "", hostFault: "guest" };
        }
        const found = registerIndex(step["Found"]);
        const value = registerIndex(step["Value"]);
        if (found === null || value === null) {
          return { kind: "fault", message: `${corePrefix} inbox command is incomplete`, hostFault: "" };
        }
        const meta = blankMeta("inbox", value);
        return {
          kind: "item",
          built: {
            wire: wireOf(AccessInbox, 0, 0n, 0n, 0, 0, 0, 0),
            meta: { ...meta, found },
          },
        };
      }

      function buildPortRead(step: Record<string, unknown>, tag: number, incomplete: string, range: string): AccessBuild {
        if (guestCore) {
          return { kind: "fault", message: "", hostFault: "guest" };
        }
        const destination = registerIndex(step["Destination"]);
        const index = registerIndex(step["Port"]);
        const offset = tag === AccessPortState ? null : registerIndex(step["Offset"]);
        const field = tag === AccessPortByte ? registerIndex(step["Field"]) : null;
        if (destination === null || index === null || (tag !== AccessPortState && offset === null) || (tag === AccessPortByte && field === null)) {
          return { kind: "fault", message: `${corePrefix} ${incomplete}`, hostFault: "" };
        }
        const portNumber = readNumber(index);
        const offsetNumber = offset === null ? 0 : readNumber(offset);
        const fieldNumber = field === null ? 0 : readNumber(field);
        if (portNumber === null || offsetNumber === null || fieldNumber === null) {
          return { kind: "fault", message: `${corePrefix} ${range}`, hostFault: "" };
        }
        return {
          kind: "item",
          built: {
            wire: wireOf(tag, 0, 0n, 0n, portNumber, fieldNumber, offsetNumber, 0),
            meta: blankMeta("port", destination),
          },
        };
      }

      /** 把一条没被吸收的指令收成主板批的一项。座位 1 的查询和停机类指令返回 stop。 */
      function buildAccessItem(step: Record<string, unknown>, checkBound: boolean): AccessBuild {
        const op = step["Op"];
        if (op === "load" || op === "store" || op === "ldi" || op === "sti") {
          return buildMemory(step, checkBound);
        }
        if (op === "query") {
          return buildQuery(step);
        }
        if (op === "inbox") {
          return buildInbox(step);
        }
        if (op === "xchg") {
          return buildExchange(step);
        }
        if (op === "fill") {
          return buildFill(step, checkBound);
        }
        if (op === "carry") {
          return buildCarry(step, checkBound);
        }
        if (op === "port.state") {
          return buildPortRead(step, AccessPortState, "port state command is incomplete", "port ordinal is out of range");
        }
        if (op === "port.char") {
          return buildPortRead(step, AccessPortChar, "device id command is incomplete", "device id integer is out of range");
        }
        if (op === "port.byte") {
          return buildPortRead(step, AccessPortByte, "device field command is incomplete", "device field integer is out of range");
        }
        return { kind: "stop" };
      }

      function finishAccess(ok: boolean, message: string, hostFault: string): void {
        const job = accessJob;
        accessJob = null;
        const port = cpu;
        if (job === null || port === null) {
          return;
        }
        port.postMessage({
          kind: "access",
          ok,
          cursor: job.cursor,
          executed: job.cursor - job.origin,
          message,
          hostFault,
        });
      }

      function postAccessBatch(port: MessagePort, wires: readonly AccessWire[]): void {
        const tag = new Uint8Array(wires.length);
        const opcode = new Uint8Array(wires.length);
        const address: bigint[] = [];
        const data: bigint[] = [];
        const a: number[] = [];
        const b: number[] = [];
        const c: number[] = [];
        const d: number[] = [];
        let index = 0;
        for (const wire of wires) {
          tag[index] = wire.tag;
          opcode[index] = wire.opcode;
          address.push(wire.address);
          data.push(wire.data);
          a.push(wire.a);
          b.push(wire.b);
          c.push(wire.c);
          d.push(wire.d);
          index += 1;
        }
        port.postMessage({ kind: "access-batch", tag, opcode, address, data, a, b, c, d });
      }

      /**
       * 先做还能留在核心里的前缀，再把连续的出核心访问收成一条主板消息。
       * 吸收会改缓存的指令把这一条主板消息截断，成功之后再继续，失败时后面的不做。
       */
      function pumpAccess(): void {
        const job = accessJob;
        const steps = program;
        if (job === null || steps === null) {
          finishAccess(false, `${corePrefix} local instruction is incomplete`, "");
          return;
        }
        quietFault = "";
        while (job.cursor < job.end) {
          const step = steps[job.cursor];
          if (step === undefined) {
            finishAccess(true, "", "");
            return;
          }
          if (!job.checkBound && takeSupervisorFrame(step)) {
            if (quietFault !== "") {
              finishAccess(false, quietFault, "");
              return;
            }
            job.cursor += 1;
            continue;
          }
          if (absorbFrameLoad(step) || absorbScratch(step) || absorbLinear(step) || absorbQuery(step)) {
            if (quietFault !== "") {
              finishAccess(false, quietFault, "");
              return;
            }
            job.cursor += 1;
            continue;
          }
          const first = buildAccessItem(step, job.checkBound);
          if (first.kind === "stop") {
            finishAccess(true, "", "");
            return;
          }
          if (first.kind === "fault") {
            finishAccess(false, first.message, first.hostFault);
            return;
          }
          const wires: AccessWire[] = [first.built.wire];
          const metas: AccessMeta[] = [first.built.meta];
          let scan = job.cursor + 1;
          let faultAfter = "";
          let hostAfter = "";
          while (scan < job.end) {
            const ahead = steps[scan];
            if (ahead === undefined) {
              break;
            }
            if (predictAbsorb(ahead, job.checkBound) !== "leave") {
              break;
            }
            const built = buildAccessItem(ahead, job.checkBound);
            if (built.kind === "stop") {
              break;
            }
            if (built.kind === "fault") {
              faultAfter = built.message;
              hostAfter = built.hostFault;
              break;
            }
            wires.push(built.built.wire);
            metas.push(built.built.meta);
            scan += 1;
          }
          const boardPort = board;
          if (boardPort === null) {
            const missing = wires[0]?.tag === AccessQuery ? `${corePrefix} query command is incomplete` : `${corePrefix} load command is incomplete`;
            finishAccess(false, missing, "");
            return;
          }
          job.metas = metas;
          job.runStart = job.cursor;
          job.nextCursor = scan;
          job.faultAfter = faultAfter;
          job.hostAfter = hostAfter;
          postAccessBatch(boardPort, wires);
          return;
        }
        finishAccess(true, "", "");
      }

      function spanAtItem(record: Record<string, unknown>, itemIndex: number): readonly bigint[] | null {
        const at = record["spanAt"];
        const list = record["spanList"];
        if (!Array.isArray(at) || !Array.isArray(list)) {
          return null;
        }
        for (let index = 0; index < at.length; index += 1) {
          if (at[index] !== itemIndex) {
            continue;
          }
          const span: unknown = list[index];
          if (!Array.isArray(span)) {
            return null;
          }
          const values: bigint[] = [];
          for (const item of span) {
            if (typeof item !== "bigint") {
              return null;
            }
            values.push(item);
          }
          return values;
        }
        return null;
      }

      function applyAccessMeta(meta: AccessMeta, value: bigint, found: number, span: readonly bigint[] | null): void {
        if (meta.frameStore !== null) {
          frameWord = meta.frameStore;
        }
        if (meta.apply === "store") {
          return;
        }
        if (meta.apply === "load") {
          registers[meta.register] = value;
          if (meta.frameLoad) {
            frameWord = value;
          }
          return;
        }
        if (meta.apply === "inbox") {
          registers[meta.found] = BigInt(found);
          registers[meta.register] = value;
          return;
        }
        if (meta.apply === "query") {
          registers[meta.register] = value;
          if (!meta.queryLive) {
            rememberSpan(meta.querySeat, meta.queryField, meta.queryIndex, span, value);
          }
          return;
        }
        registers[meta.register] = value;
      }

      /** 主板按顺序做完一批。成功的写回寄存器，失败的那一条不写结果，后面的丢掉。 */
      function settleAccessBatch(record: Record<string, unknown>): void {
        const job = accessJob;
        if (job === null) {
          return;
        }
        const done = record["done"];
        const values = record["value"];
        const founds = record["found"];
        const ok = record["ok"] === true;
        const attempted = record["attempted"] === true;
        const message = record["message"];
        const fault = typeof message === "string" ? message : `${corePrefix} memory access failed`;
        if (typeof done !== "number" || !Number.isInteger(done) || done < 0 || done > job.metas.length || !Array.isArray(values) || !(founds instanceof Uint8Array)) {
          finishAccess(false, `${corePrefix} memory access failed`, "");
          return;
        }
        for (let index = 0; index < done; index += 1) {
          const meta = job.metas[index];
          const value: unknown = values[index];
          const found = founds[index];
          if (meta === undefined || typeof value !== "bigint" || found === undefined) {
            job.cursor = job.runStart + index;
            finishAccess(false, `${corePrefix} memory access failed`, "");
            return;
          }
          applyAccessMeta(meta, value, found, spanAtItem(record, index));
        }
        if (!ok) {
          if (attempted) {
            const failed = job.metas[done];
            if (failed !== undefined && failed.frameStore !== null) {
              frameWord = failed.frameStore;
            }
          }
          job.cursor = job.runStart + done;
          finishAccess(false, fault, "");
          return;
        }
        job.cursor = job.nextCursor;
        if (job.faultAfter !== "" || job.hostAfter !== "") {
          finishAccess(false, job.faultAfter, job.hostAfter);
          return;
        }
        pumpAccess();
      }

      function onBoard(data: unknown): void {
        const record = asRecord(data);
        const kind = record?.["kind"];
        if (kind === "access-batch-result" && record !== null) {
          settleAccessBatch(record);
          return;
        }
        if (kind === "gpu-batch-result") {
          const pending = pendingBurst;
          pendingBurst = null;
          const cpuPort = cpu;
          if (pending === null || cpuPort === null) {
            return;
          }
          const batchOk = record?.["ok"] !== false;
          const batchMessage = record?.["message"];
          if (!batchOk) {
            cpuPort.postMessage({
              kind: "burst",
              ok: false,
              message: typeof batchMessage === "string" ? batchMessage : `${corePrefix} GPU queue failed`,
              cursor: pending.cursor,
              executed: pending.executed,
            });
            return;
          }
          if (pending.fault !== "") {
            cpuPort.postMessage({
              kind: "burst",
              ok: false,
              message: pending.fault,
              cursor: pending.cursor,
              executed: pending.executed,
            });
            return;
          }
          cpuPort.postMessage({ kind: "burst", ok: true, cursor: pending.cursor, executed: pending.executed });
          return;
        }
        if (kind === "store-span-result" && depositActive) {
          depositActive = false;
          const payload = depositBytes;
          const bit = depositBit;
          depositBytes = null;
          const storedOk = record?.["ok"] !== false;
          const cpuPort = cpu;
          if (!storedOk || payload === null) {
            if (cpuPort !== null) {
              const storedMessage = record?.["message"];
              cpuPort.postMessage({
                kind: "stored",
                ok: false,
                message: typeof storedMessage === "string" ? storedMessage : `${corePrefix} native store failed`,
              });
            }
            return;
          }
          /* 主板已经落下。盖住同一段的私有字节必须丢掉，下一次按段读才不会用旧值盖住新值。 */
          if (keptOctets.size > 0) {
            const start = bit / 8n;
            const end = start + BigInt(payload.length);
            for (const key of keptOctets.keys()) {
              if (key >= start && key < end) {
                keptOctets.delete(key);
              }
            }
          }
          if (cpuPort !== null) {
            cpuPort.postMessage({ kind: "stored", ok: true, message: "" });
          }
          return;
        }
        if (kind === "load-span-result" && spanActive) {
          const spanOk = record?.["ok"] !== false;
          const chunk = record?.["bytes"];
          const spanMessage = record?.["message"];
          if (!spanOk || !(chunk instanceof Uint8Array) || spanBytes === null || spanAt + chunk.length > spanBytes.length) {
            finishSpan(false, typeof spanMessage === "string" ? spanMessage : `${corePrefix} install memory access failed`);
            return;
          }
          spanBytes.set(chunk, spanAt);
          spanAt += chunk.length;
          stepSpan();
          return;
        }
        if (kind !== "exec-result" && kind !== "inbox-result" && kind !== "port-result") {
          return;
        }
        waiting = false;
        const ok = record?.["ok"] !== false;
        const isStore = record?.["isStore"] === true;
        const value = record?.["value"];
        const message = record?.["message"];
        const loaded = typeof value === "bigint" ? value : 0n;
        const target = pendingRegister;
        const foundRegister = pendingFound;
        pendingRegister = null;
        pendingFound = null;
        if (kind === "inbox-result") {
          const found = record?.["found"];
          if (typeof found === "bigint" && foundRegister !== null && target !== null) {
            registers[foundRegister] = found;
            registers[target] = loaded;
          }
          reply(true, true, loaded, "");
          return;
        }
        if (kind === "port-result") {
          if (ok && target !== null) {
            registers[target] = loaded;
          }
          const asked = pendingQuery;
          pendingQuery = null;
          if (ok && asked !== null && !asked.live) {
            rememberSpan(asked.seat, asked.field, asked.index, record?.["values"], loaded);
          }
          reply(ok, false, loaded, typeof message === "string" ? message : "");
          return;
        }
        if (ok && !isStore && target !== null) {
          registers[target] = loaded;
          if (pendingFrame) {
            frameWord = loaded;
          }
        }
        pendingFrame = false;
        reply(ok, isStore, loaded, typeof message === "string" ? message : "");
      }

      function onPlace(record: Record<string, unknown>): void {
        const register = registerIndex(record["register"]);
        const data = record["data"];
        if (register === null || typeof data !== "bigint") {
          fail("place register or immediate is illegal");
          return;
        }
        registers[register] = data;
        reply(true, false, data, "");
      }

      function onAdd(record: Record<string, unknown>): void {
        const destination = registerIndex(record["destination"]);
        const left = registerIndex(record["left"]);
        const right = registerIndex(record["right"]);
        if (destination === null || left === null || right === null) {
          fail("add register is outside 0 to 7");
          return;
        }
        const sum = readRegister(left) + readRegister(right);
        registers[destination] = sum;
        reply(true, false, sum, "");
      }

      function onEq(record: Record<string, unknown>): void {
        const destination = registerIndex(record["destination"]);
        const left = registerIndex(record["left"]);
        const right = registerIndex(record["right"]);
        if (destination === null || left === null || right === null) {
          fail("eq register is outside 0 to 7");
          return;
        }
        const same = readRegister(left) === readRegister(right) ? 1n : 0n;
        registers[destination] = same;
        reply(true, false, same, "");
      }

      function onArith(record: Record<string, unknown>, op: "sub" | "udiv" | "umod" | "mul" | "div" | "mod" | "and" | "or" | "xor" | "shl" | "shr"): void {
        const destination = registerIndex(record["destination"]);
        const left = registerIndex(record["left"]);
        const right = registerIndex(record["right"]);
        if (destination === null || left === null || right === null) {
          fail("arithmetic register is outside 0 to 7");
          return;
        }
        const lhs = readRegister(left);
        const rhs = readRegister(right);
        let result = 0n;
        if (op === "sub") {
          result = lhs - rhs;
        } else if (op === "mul") {
          result = lhs * rhs;
        } else if (op === "div" || op === "mod") {
          if (rhs === 0n) {
            fail("divisor is 0");
            return;
          }
          const quotient = lhs / rhs;
          result = op === "div" ? quotient : lhs - quotient * rhs;
        } else if (op === "and") {
          result = lhs & rhs;
        } else if (op === "or") {
          result = lhs | rhs;
        } else if (op === "xor") {
          result = lhs ^ rhs;
        } else if (op === "shl" || op === "shr") {
          if (rhs < 0n || rhs > 63n) {
            fail("shift count is outside 0 to 63");
            return;
          }
          result = op === "shl" ? lhs << rhs : lhs >> rhs;
        } else if (rhs <= 0n || lhs < 0n) {
          fail("unsigned division operand is illegal");
          return;
        } else if (op === "udiv") {
          result = lhs / rhs;
        } else {
          result = lhs % rhs;
        }
        registers[destination] = result;
        reply(true, false, result, "");
      }

      function onNot(record: Record<string, unknown>): void {
        const destination = registerIndex(record["destination"]);
        const source = registerIndex(record["source"]);
        if (destination === null || source === null) {
          fail("not register is outside 0 to 7");
          return;
        }
        const result = ~readRegister(source);
        registers[destination] = result;
        reply(true, false, result, "");
      }

      function onIntegerToFloat(record: Record<string, unknown>): void {
        const destination = registerIndex(record["destination"]);
        const source = registerIndex(record["source"]);
        if (destination === null || source === null) {
          fail("int-to-float register is outside 0 to 7");
          return;
        }
        let number = 0;
        try {
          number = Number(readRegister(source));
        } catch {
          fail("integer does not fit in finite binary64");
          return;
        }
        const bits = bitsFromFloat(number);
        if (bits === null) {
          fail("integer does not fit in finite binary64");
          return;
        }
        registers[destination] = bits;
        reply(true, false, bits, "");
      }

      function onOrder(record: Record<string, unknown>, op: "lt" | "le" | "gt" | "ge"): void {
        const destination = registerIndex(record["destination"]);
        const left = registerIndex(record["left"]);
        const right = registerIndex(record["right"]);
        if (destination === null || left === null || right === null) {
          fail("compare register is outside 0 to 7");
          return;
        }
        const lhs = readRegister(left);
        const rhs = readRegister(right);
        let result = false;
        if (op === "lt") {
          result = lhs < rhs;
        } else if (op === "le") {
          result = lhs <= rhs;
        } else if (op === "gt") {
          result = lhs > rhs;
        } else {
          result = lhs >= rhs;
        }
        const bit = result ? 1n : 0n;
        registers[destination] = bit;
        reply(true, false, bit, "");
      }

      function floatBits(value: bigint): number | null {
        if (value < -9223372036854775808n || value > 9223372036854775807n) {
          return null;
        }
        floatView.setBigInt64(0, value, true);
        const number = floatView.getFloat64(0, true);
        if (!Number.isFinite(number)) {
          return null;
        }
        return number;
      }

      function bitsFromFloat(value: number): bigint | null {
        if (!Number.isFinite(value)) {
          return null;
        }
        floatView.setFloat64(0, value, true);
        if (!Number.isFinite(floatView.getFloat64(0, true))) {
          return null;
        }
        return floatView.getBigInt64(0, true);
      }

      function rawFloat(value: bigint): number | null {
        if (value < -9223372036854775808n || value > 9223372036854775807n) {
          return null;
        }
        floatView.setBigInt64(0, value, true);
        return floatView.getFloat64(0, true);
      }

      function onFloatEqual(record: Record<string, unknown>): void {
        const destination = registerIndex(record["destination"]);
        const left = registerIndex(record["left"]);
        const right = registerIndex(record["right"]);
        if (destination === null || left === null || right === null) {
          fail("float compare register is outside 0 to 7");
          return;
        }
        const lhs = rawFloat(readRegister(left));
        const rhs = rawFloat(readRegister(right));
        if (lhs === null || rhs === null) {
          fail("float bits do not fit in binary64");
          return;
        }
        const bit = lhs === rhs ? 1n : 0n;
        registers[destination] = bit;
        reply(true, false, bit, "");
      }

      function onFloat(record: Record<string, unknown>, op: "fadd" | "fsub" | "fmul" | "fdiv" | "fpow" | "fmod"): void {
        const destination = registerIndex(record["destination"]);
        const left = registerIndex(record["left"]);
        const right = registerIndex(record["right"]);
        if (destination === null || left === null || right === null) {
          fail("float instruction register is outside 0 to 7");
          return;
        }
        const lhs = floatBits(readRegister(left));
        const rhs = floatBits(readRegister(right));
        if (lhs === null || rhs === null) {
          fail("float operand is not a finite binary64");
          return;
        }
        let number = 0;
        if (op === "fadd") {
          number = lhs + rhs;
        } else if (op === "fsub") {
          number = lhs - rhs;
        } else if (op === "fmul") {
          number = lhs * rhs;
        } else if (op === "fpow") {
          number = lhs ** rhs;
        } else if (op === "fmod") {
          if (rhs === 0) {
            fail("float divisor is 0");
            return;
          }
          number = lhs % rhs;
        } else if (rhs === 0) {
          fail("float divisor is 0");
          return;
        } else {
          number = lhs / rhs;
        }
        const bits = bitsFromFloat(number);
        if (bits === null) {
          fail("float result is not a finite binary64");
          return;
        }
        registers[destination] = bits;
        reply(true, false, bits, "");
      }

      function readU64(register: number): bigint | null {
        const value = readRegister(register);
        if (value < 0n || value > 0xffffffffffffffffn) {
          return null;
        }
        return value;
      }

      function onInbox(record: Record<string, unknown>): void {
        const port = board;
        const found = registerIndex(record["found"]);
        const value = registerIndex(record["value"]);
        if (port === null || found === null || value === null) {
          fail("inbox command is incomplete");
          return;
        }
        pendingFound = found;
        pendingRegister = value;
        waiting = true;
        port.postMessage({ kind: "inbox" });
      }

      function onMemoryHertz(record: Record<string, unknown>): void {
        const port = board;
        const register = registerIndex(record["hertz"]);
        if (port === null || register === null) {
          fail("memory hertz command is incomplete");
          return;
        }
        const hertz = readNumber(register);
        if (hertz === null) {
          fail("memory hertz integer is out of range");
          return;
        }
        waiting = true;
        port.postMessage({ kind: "mem-hertz", hertz });
      }

      function onMemoryMetric(record: Record<string, unknown>): void {
        const port = board;
        const register = registerIndex(record["register"]);
        const kindRegister = registerIndex(record["metric"]);
        if (port === null || register === null || kindRegister === null) {
          fail("memory metric command is incomplete");
          return;
        }
        const kind = readNumber(kindRegister);
        if (kind === null) {
          fail("memory metric integer is out of range");
          return;
        }
        pendingRegister = register;
        waiting = true;
        port.postMessage({ kind: "mem-metric", metric: kind });
      }

      function onExchange(record: Record<string, unknown>): void {
        const port = board;
        const index = registerIndex(record["port"]);
        const direction = registerIndex(record["direction"]);
        const data = registerIndex(record["data"]);
        if (port === null || index === null || direction === null || data === null) {
          fail("exchange command is incomplete");
          return;
        }
        const portNumber = readNumber(index);
        const directionNumber = readNumber(direction);
        const word = readU64(data);
        if (portNumber === null || directionNumber === null || word === null) {
          fail("exchange command integer is out of range");
          return;
        }
        pendingRegister = data;
        waiting = true;
        port.postMessage({ kind: "xchg", port: portNumber, direction: directionNumber, data: word });
      }

      function onMmap(record: Record<string, unknown>): void {
        const port = board;
        const destination = registerIndex(record["destination"]);
        const index = registerIndex(record["port"]);
        const handleRegister = registerIndex(record["handle"]);
        const lengthRegister = registerIndex(record["length"]);
        if (port === null || destination === null || index === null || handleRegister === null || lengthRegister === null) {
          fail("map request was rejected");
          return;
        }
        const portNumber = readNumber(index);
        const handle = readNumber(handleRegister);
        const length = readNumber(lengthRegister);
        if (portNumber === null || handle === null || length === null) {
          fail("map request was rejected");
          return;
        }
        pendingRegister = destination;
        waiting = true;
        port.postMessage({ kind: "mmap", port: portNumber, handle, length });
      }

      function onMunmap(record: Record<string, unknown>): void {
        const port = board;
        const addressRegister = registerIndex(record["address"]);
        const lengthRegister = registerIndex(record["length"]);
        if (port === null || addressRegister === null || lengthRegister === null) {
          fail("map request was rejected");
          return;
        }
        const length = readNumber(lengthRegister);
        if (length === null) {
          fail("map request was rejected");
          return;
        }
        pendingRegister = null;
        waiting = true;
        port.postMessage({ kind: "munmap", address: readRegister(addressRegister), length });
      }

      function onFill(record: Record<string, unknown>): void {
        const port = board;
        const destination = registerIndex(record["destination"]);
        const index = registerIndex(record["port"]);
        const addressRegister = registerIndex(record["address"]);
        const countRegister = registerIndex(record["count"]);
        if (port === null || destination === null || index === null || addressRegister === null || countRegister === null) {
          fail("carry command is incomplete");
          return;
        }
        const portNumber = readNumber(index);
        const address = readRegister(addressRegister);
        const count = readNumber(countRegister);
        if (portNumber === null || count === null || address < 0n || address % 8n !== 0n || count < 0 || count > 4096) {
          fail("carry command integer is out of range");
          return;
        }
        pendingRegister = destination;
        waiting = true;
        port.postMessage({ kind: "fill", port: portNumber, address, count });
      }

      function onCarry(record: Record<string, unknown>): void {
        const port = board;
        const destination = registerIndex(record["destination"]);
        const index = registerIndex(record["port"]);
        const handleRegister = registerIndex(record["handle"]);
        const offsetRegister = registerIndex(record["offset"]);
        const addressRegister = registerIndex(record["address"]);
        const countRegister = registerIndex(record["count"]);
        if (port === null || destination === null || index === null || handleRegister === null || offsetRegister === null || addressRegister === null || countRegister === null) {
          fail("fill command is incomplete");
          return;
        }
        const portNumber = readNumber(index);
        const handle = readNumber(handleRegister);
        const offset = readNumber(offsetRegister);
        const address = readRegister(addressRegister);
        const count = readNumber(countRegister);
        if (portNumber === null || handle === null || offset === null || count === null || address < 0n || address % 8n !== 0n || count < 0 || count > 268435456) {
          fail("fill command integer is out of range");
          return;
        }
        pendingRegister = destination;
        waiting = true;
        port.postMessage({ kind: "carry", port: portNumber, handle, offset, address, count });
      }

      function onPortState(record: Record<string, unknown>): void {
        const port = board;
        const destination = registerIndex(record["destination"]);
        const index = registerIndex(record["port"]);
        if (port === null || destination === null || index === null) {
          fail("port state command is incomplete");
          return;
        }
        const portNumber = readNumber(index);
        if (portNumber === null) {
          fail("port ordinal is out of range");
          return;
        }
        pendingRegister = destination;
        waiting = true;
        port.postMessage({ kind: "port-state", port: portNumber });
      }

      function onPortChar(record: Record<string, unknown>): void {
        const port = board;
        const destination = registerIndex(record["destination"]);
        const index = registerIndex(record["port"]);
        const offset = registerIndex(record["offset"]);
        if (port === null || destination === null || index === null || offset === null) {
          fail("device id command is incomplete");
          return;
        }
        const portNumber = readNumber(index);
        const offsetNumber = readNumber(offset);
        if (portNumber === null || offsetNumber === null) {
          fail("device id integer is out of range");
          return;
        }
        pendingRegister = destination;
        waiting = true;
        port.postMessage({ kind: "port-char", port: portNumber, offset: offsetNumber });
      }

      function onPortByte(record: Record<string, unknown>): void {
        const port = board;
        const destination = registerIndex(record["destination"]);
        const index = registerIndex(record["port"]);
        const field = registerIndex(record["field"]);
        const offset = registerIndex(record["offset"]);
        if (port === null || destination === null || index === null || field === null || offset === null) {
          fail("device field command is incomplete");
          return;
        }
        const portNumber = readNumber(index);
        const fieldNumber = readNumber(field);
        const offsetNumber = readNumber(offset);
        if (portNumber === null || fieldNumber === null || offsetNumber === null) {
          fail("device field integer is out of range");
          return;
        }
        pendingRegister = destination;
        waiting = true;
        port.postMessage({ kind: "port-byte", port: portNumber, field: fieldNumber, offset: offsetNumber });
      }

      function onQuery(record: Record<string, unknown>): void {
        const port = board;
        const destination = registerIndex(record["register"]);
        const seat = registerIndex(record["seat"]);
        const field = registerIndex(record["field"]);
        const index = registerIndex(record["index"]);
        if (port === null || destination === null || seat === null || field === null || index === null) {
          fail("query command is incomplete");
          return;
        }
        const seatNumber = readNumber(seat);
        const fieldNumber = readNumber(field);
        const indexNumber = readNumber(index);
        if (seatNumber === null || fieldNumber === null || indexNumber === null) {
          fail("query command integer is out of range");
          return;
        }
        pendingRegister = destination;
        waiting = true;
        pendingQuery = { seat: seatNumber, field: fieldNumber, index: indexNumber, live: liveQuery(seatNumber, fieldNumber) };
        if (charQuery(seatNumber, fieldNumber)) {
          let count = 32;
          if (seatNumber === 5) {
            const room = 64 - (indexNumber % 64);
            if (room < count) {
              count = room;
            }
          }
          port.postMessage({ kind: "query-span", seat: seatNumber, field: fieldNumber, index: indexNumber, count });
          return;
        }
        port.postMessage({ kind: "query", seat: seatNumber, field: fieldNumber, index: indexNumber });
      }

      function readNumber(register: number): number | null {
        const value = readRegister(register);
        if (value < -16777216n || value > 0xffffffffn) {
          return null;
        }
        return Number(value);
      }

      function onLoad(record: Record<string, unknown>): void {
        const port = board;
        const register = registerIndex(record["register"]);
        const opcode = record["opcode"];
        const address = record["address"];
        if (port === null || register === null || typeof opcode !== "number" || typeof address !== "bigint") {
          fail("load command is incomplete");
          return;
        }
        if (opcode === Load64 && address === FrameAddress && frameWord !== null) {
          registers[register] = frameWord;
          reply(true, false, frameWord, "");
          return;
        }
        pendingFrame = opcode === Load64 && address === FrameAddress;
        pendingRegister = register;
        waiting = true;
        port.postMessage({ kind: "exec", opcode, address, data: 0n });
      }

      function onStore(record: Record<string, unknown>): void {
        const port = board;
        const register = registerIndex(record["register"]);
        const opcode = record["opcode"];
        const address = record["address"];
        if (port === null || register === null || typeof opcode !== "number" || typeof address !== "bigint") {
          fail("store command is incomplete");
          return;
        }
        const data = readRegister(register);
        if (opcode === Store64 && address === FrameAddress) {
          frameWord = data;
        }
        waiting = true;
        port.postMessage({ kind: "exec", opcode, address, data });
      }

      function copyRegisters(
        record: Record<string, unknown>,
        names: readonly string[],
        payload: Record<string, unknown>,
      ): boolean {
        for (const name of names) {
          const register = registerIndex(record[name]);
          if (register === null) {
            fail("GPU command register is outside 0 to 7");
            return false;
          }
          const value = readNumber(register);
          if (value === null) {
            fail("GPU command integer is out of range");
            return false;
          }
          payload[name] = value;
        }
        return true;
      }

      /**
       * 原生指令的寄存器不在这 8 个 ZAP 寄存器里。
       * 宿主已经取出整数或二进制 64 位型。这里只核对，再送出和 ZAP 相同的显卡消息。
       */
      function onResolvedGpu(record: Record<string, unknown>, payload: Record<string, unknown>, port: MessagePort): boolean {
        const gpuOp = payload["gpuOp"];
        if (gpuOp === "character") {
          const names = ["x", "y", "code", "foreground", "background"];
          for (const name of names) {
            const value = record[name];
            if (typeof value !== "number" || !Number.isInteger(value) || value < -16777216 || value > 0xffffffff) {
              fail("GPU command integer is out of range");
              return true;
            }
            payload[name] = value;
          }
        } else if (gpuOp === "accel") {
          const register = registerIndex(record["register"]);
          const operation = record["operation"];
          const a = record["a"];
          const b = record["b"];
          const c = record["c"];
          const d = record["d"];
          if (
            register === null
            || typeof operation !== "bigint"
            || typeof a !== "bigint"
            || typeof b !== "bigint"
            || typeof c !== "bigint"
            || typeof d !== "bigint"
          ) {
            fail("GPU command register is outside 0 to 7");
            return true;
          }
          pendingRegister = register;
          payload["operation"] = Number(operation);
          payload["a"] = a;
          payload["b"] = b;
          payload["c"] = c;
          payload["d"] = d;
          if (beginFontRead(payload)) {
            return true;
          }
        } else if (gpuOp !== "present" && gpuOp !== "compose") {
          fail("GPU command was not recognized");
          return true;
        }
        waiting = true;
        port.postMessage(payload);
        return true;
      }

      function onGpu(record: Record<string, unknown>): void {
        const port = board;
        const gpuOp = record["gpuOp"];
        if (port === null || typeof gpuOp !== "string") {
          fail("GPU command is incomplete");
          return;
        }
        const payload: Record<string, unknown> = { kind: "gpu", gpuOp };
        if (record["resolved"] === true) {
          onResolvedGpu(record, payload, port);
          return;
        }
        const writesResult = gpuOp === "box" || gpuOp === "text";
        if (writesResult) {
          const register = registerIndex(record["register"]);
          if (register === null) {
            fail("GPU command register is outside 0 to 7");
            return;
          }
          pendingRegister = register;
        }
        if (gpuOp === "clear") {
          const register = registerIndex(record["register"]);
          if (register === null) {
            fail("GPU command register is outside 0 to 7");
            return;
          }
          const pixel = readNumber(register);
          if (pixel === null) {
            fail("GPU command integer is out of range");
            return;
          }
          payload["pixel"] = pixel;
        } else if (gpuOp === "plot" || gpuOp === "character") {
          const names = gpuOp === "plot" ? ["x", "y", "pixel"] : ["x", "y", "code", "foreground", "background"];
          for (const name of names) {
            const register = registerIndex(record[name]);
            if (register === null) {
              fail("GPU command register is outside 0 to 7");
              return;
            }
            const value = readNumber(register);
            if (value === null) {
              fail("GPU command integer is out of range");
              return;
            }
            payload[name] = value;
          }
        } else if (gpuOp === "box" || gpuOp === "text") {
          const names = gpuOp === "box"
            ? ["parent", "x", "y", "width", "height", "fill"]
            : ["parent", "x", "y", "width", "height"];
          if (!copyRegisters(record, names, payload)) {
            pendingRegister = null;
            return;
          }
        } else if (gpuOp === "align") {
          if (!copyRegisters(record, ["node", "alignX", "alignY"], payload)) {
            return;
          }
        } else if (gpuOp === "paint") {
          if (!copyRegisters(record, ["node", "foreground", "background"], payload)) {
            return;
          }
        } else if (gpuOp === "glyph") {
          if (!copyRegisters(record, ["node", "code"], payload)) {
            return;
          }
        } else if (gpuOp === "drop") {
          if (!copyRegisters(record, ["node"], payload)) {
            return;
          }
        } else if (gpuOp === "hertz") {
          if (!copyRegisters(record, ["hertz"], payload)) {
            return;
          }
        } else if (gpuOp === "metric") {
          const register = registerIndex(record["register"]);
          if (register === null) {
            fail("GPU command register is outside 0 to 7");
            return;
          }
          pendingRegister = register;
          if (!copyRegisters(record, ["metric"], payload)) {
            pendingRegister = null;
            return;
          }
        } else if (gpuOp === "load") {
          const register = registerIndex(record["register"]);
          if (register === null) {
            fail("GPU command register is outside 0 to 7");
            return;
          }
          pendingRegister = register;
          if (!copyRegisters(record, ["address"], payload)) {
            pendingRegister = null;
            return;
          }
        } else if (gpuOp === "store") {
          if (!copyRegisters(record, ["address", "value"], payload)) {
            return;
          }
        } else if (gpuOp === "accel") {
          const register = registerIndex(record["register"]);
          const operation = registerIndex(record["operation"]);
          const a = registerIndex(record["a"]);
          const b = registerIndex(record["b"]);
          const c = registerIndex(record["c"]);
          const d = registerIndex(record["d"]);
          if (register === null || operation === null || a === null || b === null || c === null || d === null) {
            fail("GPU command register is outside 0 to 7");
            return;
          }
          pendingRegister = register;
          payload["operation"] = Number(readRegister(operation));
          payload["a"] = readRegister(a);
          payload["b"] = readRegister(b);
          payload["c"] = readRegister(c);
          payload["d"] = readRegister(d);
          if (beginFontRead(payload)) {
            return;
          }
        } else if (gpuOp !== "present" && gpuOp !== "compose") {
          fail("GPU command was not recognized");
          return;
        }
        waiting = true;
        port.postMessage(payload);
      }

      function onCpu(data: unknown): void {
        const record = asRecord(data);
        if (record === null) {
          return;
        }
        const kind = record["kind"];
        if (kind === "burst") {
          const port = cpu;
          if (port === null) {
            return;
          }
          if (pendingBurst !== null) {
            port.postMessage({ kind: "burst", ok: false, message: `${corePrefix} a GPU queue is still in flight`, cursor: 0, executed: 0 });
            return;
          }
          if (accessJob !== null) {
            port.postMessage({ kind: "burst", ok: false, message: `${corePrefix} an off-core access is still in flight`, cursor: 0, executed: 0 });
            return;
          }
          const refuse = (message: string): void => {
            port.postMessage({ kind: "burst", ok: false, message: `${corePrefix} ${message}`, cursor: 0, executed: 0 });
          };
          const steps = record["steps"];
          if (Array.isArray(steps)) {
            const stored: Record<string, unknown>[] = [];
            for (const item of steps) {
              const step = asRecord(item);
              if (step === null) {
                refuse("local instruction is incomplete");
                return;
              }
              stored.push(step);
            }
            program = stored;
            const packed = packProgram(stored);
            packedOp = packed.op;
            packedReg = packed.reg;
            packedImm = packed.imm;
            packedTarget = packed.target;
            heldQueue = [];
          }
          if (!running) {
            refuse("core is not running");
            return;
          }
          const start = record["cursor"];
          if (typeof start !== "number") {
            refuse("local execution start is illegal");
            return;
          }
          const limit = record["limit"];
          burstLimit = typeof limit === "number" && limit > 0 ? limit : 100000;
          const origin = record["boundOrigin"];
          const length = record["boundLength"];
          boundOrigin = typeof origin === "bigint" ? origin : 0n;
          boundLength = typeof length === "bigint" ? length : -1n;
          guestCore = record["guest"] === true;
          if (guestCore) {
            queryCache.clear();
          }
          const outcome = runBurst(start);
          const fault = quietFault;
          quietFault = "";
          if (outcome.flush && heldQueue.length > 0) {
            const boardPort = board;
            if (boardPort === null) {
              heldQueue = [];
              port.postMessage({ kind: "burst", ok: false, message: `${corePrefix} GPU queue has no board`, cursor: outcome.cursor, executed: outcome.executed });
              return;
            }
            const commands = heldQueue;
            heldQueue = [];
            pendingBurst = { cursor: outcome.cursor, executed: outcome.executed, fault };
            boardPort.postMessage({ kind: "gpu-batch", commands });
            return;
          }
          if (fault !== "") {
            port.postMessage({ kind: "burst", ok: false, message: fault, cursor: outcome.cursor, executed: outcome.executed });
            return;
          }
          port.postMessage({ kind: "burst", ok: true, cursor: outcome.cursor, executed: outcome.executed });
          return;
        }
        if (kind === "access") {
          const port = cpu;
          if (port === null) {
            return;
          }
          if (accessJob !== null || pendingBurst !== null) {
            port.postMessage({
              kind: "access",
              ok: false,
              message: `${corePrefix} an off-core access is still in flight`,
              cursor: 0,
              executed: 0,
              hostFault: "",
            });
            return;
          }
          if (!running) {
            port.postMessage({
              kind: "access",
              ok: false,
              message: `${corePrefix} core is not running`,
              cursor: 0,
              executed: 0,
              hostFault: "",
            });
            return;
          }
          const start = record["cursor"];
          const count = record["count"];
          const steps = program;
          if (typeof start !== "number" || typeof count !== "number" || !Number.isInteger(start) || !Number.isInteger(count) || count < 1 || steps === null || start < 0 || start >= steps.length) {
            port.postMessage({
              kind: "access",
              ok: false,
              message: `${corePrefix} local instruction is incomplete`,
              cursor: typeof start === "number" ? start : 0,
              executed: 0,
              hostFault: "",
            });
            return;
          }
          const end = start + count;
          accessJob = {
            origin: start,
            end: end > steps.length ? steps.length : end,
            cursor: start,
            checkBound: record["checkBound"] === true,
            metas: [],
            runStart: start,
            nextCursor: start,
            faultAfter: "",
            hostAfter: "",
          };
          pumpAccess();
          return;
        }
        if (kind === "state") {
          running = record["running"] === true;
          waiting = false;
          pendingRegister = null;
          pendingFound = null;
          return;
        }
        if (kind === "image") {
          const port = cpu;
          if (port === null) {
            return;
          }
          port.postMessage({ kind: "image", registers: registers.slice() });
          return;
        }
        if (kind === "wipe") {
          for (let index = 0; index < RegisterCount; index += 1) {
            registers[index] = 0n;
          }
          frameWord = null;
          const wipePort = cpu;
          if (wipePort !== null) {
            wipePort.postMessage({ kind: "wiped" });
          }
          return;
        }
        if (kind === "plant") {
          const words = record["words"];
          const plantPort = cpu;
          if (plantPort === null) {
            return;
          }
          if (!Array.isArray(words) || words.length !== RegisterCount) {
            plantPort.postMessage({ kind: "planted", ok: false });
            return;
          }
          const next: bigint[] = [];
          for (const item of words) {
            if (typeof item !== "bigint") {
              plantPort.postMessage({ kind: "planted", ok: false });
              return;
            }
            next.push(item);
          }
          for (let index = 0; index < RegisterCount; index += 1) {
            registers[index] = next[index] ?? 0n;
          }
          frameWord = null;
          plantPort.postMessage({ kind: "planted", ok: true });
          return;
        }
        if (kind === "cache") {
          const cachePort = cpu;
          if (cachePort === null) {
            return;
          }
          const snap = copyPrivate();
          cachePort.postMessage({
            kind: "cached",
            ok: true,
            addresses: snap.addresses,
            bytes: snap.bytes,
            scratch: snap.scratch,
            frameHeld: snap.frameHeld,
            frame: snap.frame,
          });
          return;
        }
        if (kind === "cache-clear") {
          clearPrivate();
          const clearPort = cpu;
          if (clearPort !== null) {
            clearPort.postMessage({ kind: "cache-planted", ok: true });
          }
          return;
        }
        if (kind === "cache-plant") {
          const plantedOk = replacePrivate(record);
          const plantCachePort = cpu;
          if (plantCachePort !== null) {
            plantCachePort.postMessage({ kind: "cache-planted", ok: plantedOk });
          }
          return;
        }
        if (kind === "store-span") {
          const address = record["address"];
          const bytes = record["bytes"];
          const storePort = cpu;
          if (storePort === null) {
            return;
          }
          if (depositActive || spanActive || typeof address !== "bigint" || !(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > 262144 || address < 0n || address % 8n !== 0n) {
            storePort.postMessage({ kind: "stored", ok: false, message: `${corePrefix} native store failed` });
            return;
          }
          const boardPort = board;
          if (boardPort === null) {
            storePort.postMessage({ kind: "stored", ok: false, message: `${corePrefix} native store failed` });
            return;
          }
          depositBytes = bytes;
          depositBit = address;
          depositActive = true;
          boardPort.postMessage({ kind: "store-span", address, bytes });
          return;
        }
        if (kind === "span") {
          const address = record["address"];
          const length = record["length"];
          const spanPort = cpu;
          if (spanPort === null) {
            return;
          }
          if (spanActive || typeof address !== "bigint" || typeof length !== "number" || !Number.isInteger(length) || length < 0 || length > InstallOctetLimit || address < 0n || address % 8n !== 0n) {
            spanPort.postMessage({ kind: "span", ok: false, bytes: null, message: `${corePrefix} install memory access failed` });
            return;
          }
          spanBytes = new Uint8Array(length);
          spanAt = 0;
          spanBit = address;
          spanActive = true;
          stepSpan();
          return;
        }
        if (kind === "peek") {
          const register = registerIndex(record["register"]);
          if (register === null) {
            reply(false, true, 0n, `${corePrefix} register is outside 0 to 7`);
            return;
          }
          const port = cpu;
          if (port === null) {
            return;
          }
          port.postMessage({ kind: "peek", ok: true, value: readRegister(register) });
          return;
        }
        if (kind === "query-fill") {
          const seat = record["seat"];
          const field = record["field"];
          const index = record["index"];
          const values = record["values"];
          const fillPort = cpu;
          if (fillPort === null) {
            return;
          }
          if (typeof seat !== "number" || typeof field !== "number" || typeof index !== "number" || !Array.isArray(values)) {
            fillPort.postMessage({ kind: "filled", ok: false, message: `${corePrefix} query record is incomplete` });
            return;
          }
          if (!rememberSpan(seat, field, index, values, null)) {
            fillPort.postMessage({ kind: "filled", ok: false, message: `${corePrefix} query record is incomplete` });
            return;
          }
          fillPort.postMessage({ kind: "filled", ok: true });
          return;
        }
        if (kind === "pass" || kind === "take") {
          return;
        }
        if (kind !== "place" && kind !== "add" && kind !== "eq" && kind !== "sub" && kind !== "udiv" && kind !== "umod" && kind !== "mul" && kind !== "div" && kind !== "mod" && kind !== "and" && kind !== "or" && kind !== "xor" && kind !== "shl" && kind !== "shr" && kind !== "lt" && kind !== "le" && kind !== "gt" && kind !== "ge" && kind !== "not" && kind !== "itof" && kind !== "fadd" && kind !== "fsub" && kind !== "fmul" && kind !== "fdiv" && kind !== "fpow" && kind !== "fmod" && kind !== "feq" && kind !== "load" && kind !== "store" && kind !== "gpu" && kind !== "inbox" && kind !== "xchg" && kind !== "fill" && kind !== "carry" && kind !== "mmap" && kind !== "munmap" && kind !== "port-state" && kind !== "port-char" && kind !== "port-byte" && kind !== "query" && kind !== "mem-hertz" && kind !== "mem-metric") {
          return;
        }
        if (!running) {
          fail("core is not running");
          return;
        }
        if (waiting) {
          fail("the previous command is still in flight");
          return;
        }
        if (kind === "place") {
          onPlace(record);
          return;
        }
        if (kind === "add") {
          onAdd(record);
          return;
        }
        if (kind === "eq") {
          onEq(record);
          return;
        }
        if (kind === "sub" || kind === "udiv" || kind === "umod" || kind === "mul" || kind === "div" || kind === "mod" || kind === "and" || kind === "or" || kind === "xor" || kind === "shl" || kind === "shr") {
          onArith(record, kind);
          return;
        }
        if (kind === "lt" || kind === "le" || kind === "gt" || kind === "ge") {
          onOrder(record, kind);
          return;
        }
        if (kind === "not") {
          onNot(record);
          return;
        }
        if (kind === "itof") {
          onIntegerToFloat(record);
          return;
        }
        if (kind === "fadd" || kind === "fsub" || kind === "fmul" || kind === "fdiv" || kind === "fpow" || kind === "fmod") {
          onFloat(record, kind);
          return;
        }
        if (kind === "feq") {
          onFloatEqual(record);
          return;
        }
        if (kind === "query") {
          onQuery(record);
          return;
        }
        if (kind === "port-byte") {
          onPortByte(record);
          return;
        }
        if (kind === "inbox") {
          onInbox(record);
          return;
        }
        if (kind === "xchg") {
          onExchange(record);
          return;
        }
        if (kind === "fill") {
          onFill(record);
          return;
        }
        if (kind === "carry") {
          onCarry(record);
          return;
        }
        if (kind === "mmap") {
          onMmap(record);
          return;
        }
        if (kind === "munmap") {
          onMunmap(record);
          return;
        }
        if (kind === "mem-hertz") {
          onMemoryHertz(record);
          return;
        }
        if (kind === "mem-metric") {
          onMemoryMetric(record);
          return;
        }
        if (kind === "port-state") {
          onPortState(record);
          return;
        }
        if (kind === "port-char") {
          onPortChar(record);
          return;
        }
        if (kind === "load") {
          onLoad(record);
          return;
        }
        if (kind === "gpu") {
          onGpu(record);
          return;
        }
        onStore(record);
      }

      /**
       * 接收主板交来的第一条消息，接上两条端口。
       * 寄存器从全 0 开始。主板端口只用于访存结果。
       */
      /**
       * 把编译器窗口挪到这颗核心的槽上。
       * obrc -slot 加的是 核心号 × 槽距。0 号保持原地址。
       * 固件格子不加。5952 结束标志和 4096 模式字仍然进共享内存。
       */
      function adoptSlot(ordinal: number): void {
        if (!Number.isInteger(ordinal) || ordinal <= 0 || ordinal > 255) {
          return;
        }
        const delta = BigInt(ordinal) * BigInt(RelocateSlotBits);
        FrameAddress += delta;
        ScratchBase += delta;
        ScratchLimit += delta;
        KeptStack += delta;
        KeptStackEnd += delta;
        KeptHeap += delta;
        KeptHeapEnd += delta;
        KeptSp += delta;
        KeptSpEnd += delta;
        KeptHeapPtr += delta;
        KeptHeapPtrEnd += delta;
        KeptStatic += delta;
        KeptStaticEnd += delta;
      }

      /**
       * 抄出这颗核心上别人读不到的写入。
       * 地址保持原来的位地址，放回时不换算到另一颗核心。临时字和帧字一并带走。
       */
      function copyPrivate(): { addresses: bigint[]; bytes: number[]; scratch: bigint[]; frameHeld: boolean; frame: bigint } {
        const addresses: bigint[] = [];
        const bytes: number[] = [];
        for (const [key, value] of keptOctets) {
          addresses.push(key);
          bytes.push(value);
        }
        return {
          addresses,
          bytes,
          scratch: scratchWords.slice(),
          frameHeld: frameWord !== null,
          frame: frameWord ?? 0n,
        };
      }

      /** 新映像或卸下之后，上一份程序的栈、静态区和帧字都不再留下。 */
      function clearPrivate(): void {
        keptOctets.clear();
        scratchWords.fill(0n);
        frameWord = null;
      }

      /**
       * 用槽里的一份替换当前私有写入。
       * 先核对长度和每个八位组，核对失败时原表不动。
       */
      function replacePrivate(record: Record<string, unknown>): boolean {
        const addresses = record["addresses"];
        const bytes = record["bytes"];
        const scratch = record["scratch"];
        const frameHeld = record["frameHeld"] === true;
        const frame = record["frame"];
        if (!Array.isArray(addresses) || !Array.isArray(bytes) || addresses.length !== bytes.length) {
          return false;
        }
        if (!Array.isArray(scratch) || scratch.length !== scratchWords.length) {
          return false;
        }
        if (typeof frame !== "bigint") {
          return false;
        }
        const next = new Map<bigint, number>();
        const keys: bigint[] = [];
        for (const item of addresses) {
          if (typeof item !== "bigint") {
            return false;
          }
          keys.push(item);
        }
        const octets: number[] = [];
        for (const item of bytes) {
          if (typeof item !== "number" || !Number.isInteger(item) || item < 0 || item > 255) {
            return false;
          }
          octets.push(item);
        }
        for (let index = 0; index < keys.length; index += 1) {
          const key = keys[index];
          const value = octets[index];
          if (key === undefined || value === undefined) {
            return false;
          }
          next.set(key, value);
        }
        const words: bigint[] = [];
        for (const item of scratch) {
          if (typeof item !== "bigint") {
            return false;
          }
          words.push(item);
        }
        if (words.length !== scratchWords.length) {
          return false;
        }
        keptOctets.clear();
        for (const [key, value] of next) {
          keptOctets.set(key, value);
        }
        for (let index = 0; index < scratchWords.length; index += 1) {
          scratchWords[index] = words[index] ?? 0n;
        }
        frameWord = frameHeld ? frame : null;
        return true;
      }

      export function acceptCoreMessage(data: unknown): void {
        const record = asRecord(data);
        if (record?.["kind"] !== "core") {
          return;
        }
        const ordinal = record["ordinal"];
        if (typeof ordinal === "number" && Number.isInteger(ordinal) && ordinal >= 0 && ordinal <= 255) {
          selfOrdinal = ordinal;
          adoptSlot(ordinal);
        }
        const metrics = record["metrics"];
        if (metrics instanceof SharedArrayBuffer) {
          attachMetricPage(metrics);
        }
        const boardPort = record["boardPort"];
        const cpuPort = record["cpuPort"];
        if (!(boardPort instanceof MessagePort) || !(cpuPort instanceof MessagePort)) {
          return;
        }
        board = boardPort;
        cpu = cpuPort;
        boardPort.onmessage = (event: MessageEvent): void => {
          onBoard(event.data as unknown);
        };
        cpuPort.onmessage = (event: MessageEvent): void => {
          onCpu(event.data as unknown);
        };
        boardPort.start();
        cpuPort.start();
      }
    }
  }
}
