/**
 * @module ZerOS.Hardware.Cpu.CoreDispatch
 * @description 一个 CPU 核心线程
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 每个核心一条 Worker。8 个寄存器只存在于这条线程。
 * 连续的寄存器运算在这里一次做完，碰到访存、端口或停机才把控制交回去。
 * 不写回寄存器的显卡命令也在这里按出现顺序排成一队，一次送给主板。
 * 要回节点编号的命令，以及 Present，仍单独等待，好让后面的指令看见结果。
 * 这一核心写过的对齐字节留在核心里，没写过的 Load / Store 才去主板。
 * 不导入内存实现，也不自己决定挂载。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 核心状态
 *   3. 消息
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as ConfigRoot } from "../Config/CpuConfig";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      const RegisterCount = ConfigRoot.Hardware.Cpu.Config.RegisterCount;
      const corePrefix = "[ZerOS.Hardware.Cpu.Core]";

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
      /** 一队显卡命令已经送出，还要等主板做完才回答这次本地执行。 */
      let pendingBurst: { readonly cursor: number; readonly executed: number; readonly fault: string } | null = null;
      /**
       * 编译器反复从这里读当前帧的基址。
       * 核心记下最近一次写进去的 64 位，同一地址的 load.64 就不必再去内存。
       */
      const FrameAddress = 4653056n;
      const Load64 = 9;
      const Store64 = 10;
      /**
       * 界面库的临时槽。编译器把它们放在帧指针下面，只有这一颗核心自己读写。
       * 每个字形都要来回读十几次。若每次都去内存，一页设置画面要等很久，按键就被堵住。
       * 这些 64 位字留在核心里。范围之外的访存仍走内存。
       */
      const ScratchBase = 4603904n;
      const ScratchLimit = 4653056n;
      const scratchWords = new Array<bigint>(Number((ScratchLimit - ScratchBase) / 64n)).fill(0n);
      /**
       * 这一核心已经写过的八位组。键是位地址除以 8。
       * 设置画面每次重画都要再读同一批字符串、行表和栈上的局部变量。写过之后就在这里读，不再每个字节都问一次内存。
       * 没写过的地址仍走内存，所以别的设备事先放好的数据还在。这不是协议里的缓存。
       */
      const keptOctets = new Map<bigint, number>();
      /** 固件单元格。栈指针那一个字不在这段里，它仍交给内存。 */
      const KeptLow = 4096n;
      const KeptLowEnd = 1048576n;
      /** 0 号核心的调用栈。编译器从 2097152 往上长，一帧远小于这段。 */
      const KeptStack = 2097152n;
      const KeptStackEnd = 2621440n;
      /** 字符串堆。只盖住从堆底起的一段，再往上的分配仍走内存。 */
      const KeptHeap = 5767168n;
      const KeptHeapEnd = 6815744n;
      let frameWord: bigint | null = null;
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
          quietFault = `${corePrefix} 加速命令的寄存器不在 0 到 7`;
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
      function absorbScratch(step: Record<string, unknown>): boolean {
        const op = step["Op"];
        if (op !== "load" && op !== "store") {
          return false;
        }
        const opcode = step["Opcode"];
        if (op === "load" && opcode !== Load64) {
          return false;
        }
        if (op === "store" && opcode !== Store64) {
          return false;
        }
        const address = step["Address"];
        if (typeof address !== "bigint" || address < ScratchBase || address >= ScratchLimit) {
          return false;
        }
        if ((address - ScratchBase) % 64n !== 0n) {
          return false;
        }
        const index = Number((address - ScratchBase) / 64n);
        const register = registerIndex(step["Register"]);
        if (!Number.isInteger(index) || index < 0 || index >= scratchWords.length || register === null) {
          quietFault = `${corePrefix} 界面临时槽不完整`;
          return true;
        }
        if (op === "load") {
          registers[register] = scratchWords[index] ?? 0n;
          return true;
        }
        scratchWords[index] = readRegister(register);
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
       * 读这一核心写过的对齐字节。八个位里只要有一个没写过，就返回 false，整次改走内存。
       * 帧指针和界面临时槽另有记录，这里不碰。
       */
      function absorbLinear(step: Record<string, unknown>): boolean {
        const op = step["Op"];
        if (op !== "load" && op !== "store" && op !== "ldi" && op !== "sti") {
          return false;
        }
        const opcode = step["Opcode"];
        if (typeof opcode !== "number") {
          return false;
        }
        const width = linearWidth(opcode);
        if (width === 0) {
          return false;
        }
        let address: bigint;
        if (op === "load" || op === "store") {
          const direct = step["Address"];
          if (typeof direct !== "bigint") {
            return false;
          }
          address = direct;
        } else {
          const pointer = registerIndex(step["Address"]);
          if (pointer === null) {
            quietFault = `${corePrefix} 间接访存的地址寄存器不在 0 到 7`;
            return true;
          }
          address = readRegister(pointer);
        }
        if (address < 0n || address % 8n !== 0n || address === FrameAddress) {
          return false;
        }
        const inLow = address >= KeptLow && address < KeptLowEnd;
        const inStack = address >= KeptStack && address < KeptStackEnd;
        const inHeap = address >= KeptHeap && address < KeptHeapEnd;
        const last = address + BigInt((width - 1) * 8);
        if (inLow && last >= KeptLowEnd) {
          return false;
        }
        if (inStack && last >= KeptStackEnd) {
          return false;
        }
        if (inHeap && last >= KeptHeapEnd) {
          return false;
        }
        if (!inLow && !inStack && !inHeap) {
          return false;
        }
        if (address < ScratchLimit && last >= ScratchBase) {
          return false;
        }
        const register = registerIndex(step["Register"]);
        if (register === null) {
          quietFault = `${corePrefix} 访存的数据寄存器不在 0 到 7`;
          return true;
        }
        const base = address / 8n;
        const bits = BigInt(width * 8);
        const modulus = 1n << bits;
        if (linearStore(opcode)) {
          const value = readRegister(register);
          const min = width === 1 ? 0n : -(modulus >> 1n);
          const max = width === 1 ? modulus - 1n : (modulus >> 1n) - 1n;
          if (value < min || value > max) {
            for (let index = 0; index < width; index += 1) {
              keptOctets.delete(base + BigInt(index));
            }
            return false;
          }
          let rest = value < 0n ? value + modulus : value;
          for (let index = 0; index < width; index += 1) {
            keptOctets.set(base + BigInt(index), Number(rest & 0xffn));
            rest >>= 8n;
          }
          return true;
        }
        for (let index = 0; index < width; index += 1) {
          if (!keptOctets.has(base + BigInt(index))) {
            return false;
          }
        }
        let loaded = 0n;
        for (let index = width - 1; index >= 0; index -= 1) {
          loaded = (loaded << 8n) | BigInt(keptOctets.get(base + BigInt(index)) ?? 0);
        }
        if (width > 1) {
          const sign = modulus >> 1n;
          if (loaded >= sign) {
            loaded -= modulus;
          }
        }
        registers[register] = loaded;
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
      function absorbQuery(step: Record<string, unknown>): boolean {
        if (step["Op"] !== "query") {
          return false;
        }
        const destination = registerIndex(step["Register"]);
        const seatRegister = registerIndex(step["Seat"]);
        const fieldRegister = registerIndex(step["Field"]);
        const indexRegister = registerIndex(step["Index"]);
        if (destination === null || seatRegister === null || fieldRegister === null || indexRegister === null) {
          quietFault = `${corePrefix} 查询命令不完整`;
          return true;
        }
        const seat = readNumber(seatRegister);
        const field = readNumber(fieldRegister);
        const index = readNumber(indexRegister);
        if (seat === null || field === null || index === null) {
          quietFault = `${corePrefix} 查询命令的整数超出范围`;
          return true;
        }
        const hit = queryCache.get(queryKey(seat, field, index));
        if (hit === undefined) {
          return false;
        }
        registers[destination] = hit;
        return true;
      }

      function readStepNumber(step: Record<string, unknown>, key: string): number | null {
        const register = registerIndex(step[key]);
        if (register === null) {
          quietFault = `${corePrefix} 显卡命令的寄存器不在 0 到 7`;
          return null;
        }
        const value = readNumber(register);
        if (value === null) {
          quietFault = `${corePrefix} 显卡命令的整数超出范围`;
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
            quietFault = `${corePrefix} 显卡命令无法识别`;
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
       * 帧基址已经在手里时，这条 load.64 就在核心里完成。
       * 返回 false 表示这不是一条可以就地完成的帧读取。
       */
      function absorbFrameLoad(step: Record<string, unknown>): boolean {
        if (step["Op"] !== "load" || step["Opcode"] !== Load64 || step["Address"] !== FrameAddress || frameWord === null) {
          return false;
        }
        const register = registerIndex(step["Register"]);
        if (register === null) {
          quietFault = `${corePrefix} Load 命令不完整`;
          return true;
        }
        registers[register] = frameWord;
        return true;
      }

      function runBurst(start: number): { readonly cursor: number; readonly executed: number; readonly flush: boolean } {
        const steps = program;
        if (steps === null || !Number.isInteger(start) || start < 0) {
          quietFault = `${corePrefix} 本地执行的起点不合法`;
          return { cursor: start, executed: 0, flush: heldQueue.length > 0 };
        }
        quiet = true;
        quietFault = "";
        let cursor = start;
        let executed = 0;
        while (cursor < steps.length && executed < 100000) {
          const step = steps[cursor];
          if (step === undefined) {
            break;
          }
          const op = step["Op"];
          if (typeof op !== "string") {
            break;
          }
          if (isLocalOp(op)) {
            const next = applyLocal(step, op, cursor, steps.length);
            if (quietFault !== "") {
              break;
            }
            cursor = next;
            executed += 1;
            continue;
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

      function applyLocal(step: Record<string, unknown>, op: string, cursor: number, length: number): number {
        if (op === "place") {
          onPlace(renamed(step));
          return cursor + 1;
        }
        if (op === "add") {
          onAdd(renamed(step));
          return cursor + 1;
        }
        if (op === "eq") {
          onEq(renamed(step));
          return cursor + 1;
        }
        if (op === "not") {
          onNot(renamed(step));
          return cursor + 1;
        }
        if (op === "itof") {
          onIntegerToFloat(renamed(step));
          return cursor + 1;
        }
        if (op === "sub" || op === "udiv" || op === "umod" || op === "mul" || op === "div" || op === "mod" || op === "and" || op === "or" || op === "xor" || op === "shl" || op === "shr") {
          onArith(renamed(step), op);
          return cursor + 1;
        }
        if (op === "lt" || op === "le" || op === "gt" || op === "ge") {
          onOrder(renamed(step), op);
          return cursor + 1;
        }
        if (op === "feq") {
          onFloatEqual(renamed(step));
          return cursor + 1;
        }
        if (op === "fadd" || op === "fsub" || op === "fmul" || op === "fdiv" || op === "fpow" || op === "fmod") {
          onFloat(renamed(step), op);
          return cursor + 1;
        }
        if (op === "jz" || op === "jnz") {
          const condition = registerIndex(step["Condition"]);
          const target = step["Target"];
          if (condition === null || typeof target !== "number") {
            quietFault = `${corePrefix} 跳转不完整`;
            return cursor;
          }
          const taken = op === "jz" ? readRegister(condition) === 0n : readRegister(condition) !== 0n;
          if (!taken) {
            return cursor + 1;
          }
          if (!Number.isInteger(target) || target < 0 || target >= length) {
            quietFault = `${corePrefix} 跳转目标不在这段指令里`;
            return cursor;
          }
          return target;
        }
        if (op === "link" || op === "call") {
          const register = registerIndex(step["Register"]);
          const target = step["Target"];
          if (register === null || typeof target !== "number" || !Number.isInteger(target) || target < 0 || target >= length) {
            quietFault = `${corePrefix} 跳转目标不在这段指令里`;
            return cursor;
          }
          registers[register] = BigInt(cursor + 1);
          return target;
        }
        const register = registerIndex(step["Register"]);
        if (register === null) {
          quietFault = `${corePrefix} 跳转不完整`;
          return cursor;
        }
        const target = readRegister(register);
        if (target < 0n || target >= BigInt(length)) {
          quietFault = `${corePrefix} 跳转目标不在这段指令里`;
          return cursor;
        }
        return Number(target);
      }

      function renamed(step: Record<string, unknown>): Record<string, unknown> {
        return {
          destination: step["Destination"],
          left: step["Left"],
          right: step["Right"],
          register: step["Register"],
          data: step["Data"],
          source: step["Source"],
        };
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

      function onBoard(data: unknown): void {
        const record = asRecord(data);
        const kind = record?.["kind"];
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
              message: typeof batchMessage === "string" ? batchMessage : `${corePrefix} 显卡队列失败`,
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
          fail("Place 的寄存器或数据不合法");
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
          fail("Add 的寄存器编号不在 0 到 7");
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
          fail("Eq 的寄存器编号不在 0 到 7");
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
          fail("算术指令的寄存器编号不在 0 到 7");
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
            fail("除数是 0");
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
            fail("移位次数不在 0 到 63");
            return;
          }
          result = op === "shl" ? lhs << rhs : lhs >> rhs;
        } else if (rhs <= 0n || lhs < 0n) {
          fail("无符号除法的操作数不合法");
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
          fail("取反的寄存器编号不在 0 到 7");
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
          fail("整数转浮点的寄存器编号不在 0 到 7");
          return;
        }
        let number = 0;
        try {
          number = Number(readRegister(source));
        } catch {
          fail("整数超出有限二进制 64");
          return;
        }
        const bits = bitsFromFloat(number);
        if (bits === null) {
          fail("整数超出有限二进制 64");
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
          fail("比较的寄存器编号不在 0 到 7");
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
        const buffer = new ArrayBuffer(8);
        const view = new DataView(buffer);
        view.setBigInt64(0, value, true);
        const number = view.getFloat64(0, true);
        if (!Number.isFinite(number)) {
          return null;
        }
        return number;
      }

      function bitsFromFloat(value: number): bigint | null {
        if (!Number.isFinite(value)) {
          return null;
        }
        const buffer = new ArrayBuffer(8);
        const view = new DataView(buffer);
        view.setFloat64(0, value, true);
        if (!Number.isFinite(view.getFloat64(0, true))) {
          return null;
        }
        return view.getBigInt64(0, true);
      }

      function rawFloat(value: bigint): number | null {
        if (value < -9223372036854775808n || value > 9223372036854775807n) {
          return null;
        }
        const buffer = new ArrayBuffer(8);
        const view = new DataView(buffer);
        view.setBigInt64(0, value, true);
        return view.getFloat64(0, true);
      }

      function onFloatEqual(record: Record<string, unknown>): void {
        const destination = registerIndex(record["destination"]);
        const left = registerIndex(record["left"]);
        const right = registerIndex(record["right"]);
        if (destination === null || left === null || right === null) {
          fail("浮点相等的寄存器编号不在 0 到 7");
          return;
        }
        const lhs = rawFloat(readRegister(left));
        const rhs = rawFloat(readRegister(right));
        if (lhs === null || rhs === null) {
          fail("浮点位型放不进二进制 64");
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
          fail("浮点指令的寄存器编号不在 0 到 7");
          return;
        }
        const lhs = floatBits(readRegister(left));
        const rhs = floatBits(readRegister(right));
        if (lhs === null || rhs === null) {
          fail("浮点操作数不是有限的二进制 64");
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
            fail("浮点除数是 0");
            return;
          }
          number = lhs % rhs;
        } else if (rhs === 0) {
          fail("浮点除数是 0");
          return;
        } else {
          number = lhs / rhs;
        }
        const bits = bitsFromFloat(number);
        if (bits === null) {
          fail("浮点结果不是有限的二进制 64");
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
          fail("Inbox 命令不完整");
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
          fail("内存频率命令不完整");
          return;
        }
        const hertz = readNumber(register);
        if (hertz === null) {
          fail("内存频率的整数超出范围");
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
          fail("内存指标命令不完整");
          return;
        }
        const kind = readNumber(kindRegister);
        if (kind === null) {
          fail("内存指标的整数超出范围");
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
          fail("交换命令不完整");
          return;
        }
        const portNumber = readNumber(index);
        const directionNumber = readNumber(direction);
        const word = readU64(data);
        if (portNumber === null || directionNumber === null || word === null) {
          fail("交换命令的整数超出范围");
          return;
        }
        pendingRegister = data;
        waiting = true;
        port.postMessage({ kind: "xchg", port: portNumber, direction: directionNumber, data: word });
      }

      function onPortState(record: Record<string, unknown>): void {
        const port = board;
        const destination = registerIndex(record["destination"]);
        const index = registerIndex(record["port"]);
        if (port === null || destination === null || index === null) {
          fail("扩展口状态命令不完整");
          return;
        }
        const portNumber = readNumber(index);
        if (portNumber === null) {
          fail("扩展口编号超出范围");
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
          fail("设备标识命令不完整");
          return;
        }
        const portNumber = readNumber(index);
        const offsetNumber = readNumber(offset);
        if (portNumber === null || offsetNumber === null) {
          fail("设备标识的整数超出范围");
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
          fail("设备字段命令不完整");
          return;
        }
        const portNumber = readNumber(index);
        const fieldNumber = readNumber(field);
        const offsetNumber = readNumber(offset);
        if (portNumber === null || fieldNumber === null || offsetNumber === null) {
          fail("设备字段的整数超出范围");
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
          fail("查询命令不完整");
          return;
        }
        const seatNumber = readNumber(seat);
        const fieldNumber = readNumber(field);
        const indexNumber = readNumber(index);
        if (seatNumber === null || fieldNumber === null || indexNumber === null) {
          fail("查询命令的整数超出范围");
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
          fail("Load 命令不完整");
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
          fail("Store 命令不完整");
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
            fail("显卡命令的寄存器不在 0 到 7");
            return false;
          }
          const value = readNumber(register);
          if (value === null) {
            fail("显卡命令的整数超出范围");
            return false;
          }
          payload[name] = value;
        }
        return true;
      }

      function onGpu(record: Record<string, unknown>): void {
        const port = board;
        const gpuOp = record["gpuOp"];
        if (port === null || typeof gpuOp !== "string") {
          fail("显卡命令不完整");
          return;
        }
        const payload: Record<string, unknown> = { kind: "gpu", gpuOp };
        const writesResult = gpuOp === "box" || gpuOp === "text";
        if (writesResult) {
          const register = registerIndex(record["register"]);
          if (register === null) {
            fail("显卡命令的寄存器不在 0 到 7");
            return;
          }
          pendingRegister = register;
        }
        if (gpuOp === "clear") {
          const register = registerIndex(record["register"]);
          if (register === null) {
            fail("显卡命令的寄存器不在 0 到 7");
            return;
          }
          const pixel = readNumber(register);
          if (pixel === null) {
            fail("显卡命令的整数超出范围");
            return;
          }
          payload["pixel"] = pixel;
        } else if (gpuOp === "plot" || gpuOp === "character") {
          const names = gpuOp === "plot" ? ["x", "y", "pixel"] : ["x", "y", "code", "foreground", "background"];
          for (const name of names) {
            const register = registerIndex(record[name]);
            if (register === null) {
              fail("显卡命令的寄存器不在 0 到 7");
              return;
            }
            const value = readNumber(register);
            if (value === null) {
              fail("显卡命令的整数超出范围");
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
            fail("显卡命令的寄存器不在 0 到 7");
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
            fail("显卡命令的寄存器不在 0 到 7");
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
            fail("显卡命令的寄存器不在 0 到 7");
            return;
          }
          pendingRegister = register;
          payload["operation"] = Number(readRegister(operation));
          payload["a"] = readRegister(a);
          payload["b"] = readRegister(b);
          payload["c"] = readRegister(c);
          payload["d"] = readRegister(d);
        } else if (gpuOp !== "present" && gpuOp !== "compose") {
          fail("显卡命令无法识别");
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
            port.postMessage({ kind: "burst", ok: false, message: `${corePrefix} 上一条显卡队列还没完成`, cursor: 0, executed: 0 });
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
                refuse("本地执行的指令不完整");
                return;
              }
              stored.push(step);
            }
            program = stored;
            heldQueue = [];
          }
          if (!running) {
            refuse("核心不在执行中");
            return;
          }
          const start = record["cursor"];
          if (typeof start !== "number") {
            refuse("本地执行的起点不合法");
            return;
          }
          const outcome = runBurst(start);
          const fault = quietFault;
          quietFault = "";
          if (outcome.flush && heldQueue.length > 0) {
            const boardPort = board;
            if (boardPort === null) {
              heldQueue = [];
              port.postMessage({ kind: "burst", ok: false, message: `${corePrefix} 显卡队列没有主板`, cursor: outcome.cursor, executed: outcome.executed });
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
        if (kind === "peek") {
          const register = registerIndex(record["register"]);
          if (register === null) {
            reply(false, true, 0n, `${corePrefix} 寄存器不在 0 到 7`);
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
            fillPort.postMessage({ kind: "filled", ok: false, message: `${corePrefix} 查询记录不完整` });
            return;
          }
          if (!rememberSpan(seat, field, index, values, null)) {
            fillPort.postMessage({ kind: "filled", ok: false, message: `${corePrefix} 查询记录不完整` });
            return;
          }
          fillPort.postMessage({ kind: "filled", ok: true });
          return;
        }
        if (kind === "pass" || kind === "take") {
          return;
        }
        if (kind !== "place" && kind !== "add" && kind !== "eq" && kind !== "sub" && kind !== "udiv" && kind !== "umod" && kind !== "mul" && kind !== "div" && kind !== "mod" && kind !== "and" && kind !== "or" && kind !== "xor" && kind !== "shl" && kind !== "shr" && kind !== "lt" && kind !== "le" && kind !== "gt" && kind !== "ge" && kind !== "not" && kind !== "itof" && kind !== "fadd" && kind !== "fsub" && kind !== "fmul" && kind !== "fdiv" && kind !== "fpow" && kind !== "fmod" && kind !== "feq" && kind !== "load" && kind !== "store" && kind !== "gpu" && kind !== "inbox" && kind !== "xchg" && kind !== "port-state" && kind !== "port-char" && kind !== "port-byte" && kind !== "query" && kind !== "mem-hertz" && kind !== "mem-metric") {
          return;
        }
        if (!running) {
          fail("核心不在执行中");
          return;
        }
        if (waiting) {
          fail("上一条命令还没完成");
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
      export function acceptCoreMessage(data: unknown): void {
        const record = asRecord(data);
        if (record?.["kind"] !== "core") {
          return;
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
