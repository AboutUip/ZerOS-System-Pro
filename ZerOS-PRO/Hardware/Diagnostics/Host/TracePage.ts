/**
 * @module ZerOS.Hardware.Diagnostics.TracePage
 * @description 多个线程共用的定长记录页
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 页面开页，主板和 CPU 线程挂上同一块 SharedArrayBuffer。
 * 写入只用原子加预留一格；每格先清序号、写字段、再写序号，读方两次读到同一个序号才收下。
 * 满页覆盖最旧，丢掉的条数记在头部。
 * 关闭时只把启用位清 0，不释放别人的视图；下一次开页重新分配。
 * 不解释事件，也不生成报告。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 开页与挂页
 *   3. 写
 *   4. 读
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as ConfigRoot } from "../Config/TraceConfig";
import { ZerOS as OpRoot } from "../Enum/TraceOp";
import { type ZerOS as EntryRoot } from "../Structure/TraceEntry";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Diagnostics {
      const Config = ConfigRoot.Hardware.Diagnostics.TraceConfig;
      type TraceEntry = EntryRoot.Hardware.Diagnostics.TraceEntry;
      const SvcOp = OpRoot.Hardware.Diagnostics.TraceOp.Svc;
      const SvcReplyOp = OpRoot.Hardware.Diagnostics.TraceOp.SvcReply;
      const PromptOp = OpRoot.Hardware.Diagnostics.TraceOp.Prompt;
      /** exit 不回复，不能算进未回复计数；否则每条命令之后 pending 只增不减。 */
      const ExitService = 28;

      /** 头部由配置决定；当前是 256 个 32 位字。 */
      const HeaderInts = Config.HeaderBytes / 4;
      /** 一条记录占 8 个 32 位字，第一个字是序号。 */
      const RecordInts = Config.RecordBytes / 4;

      let owned: SharedArrayBuffer | null = null;
      let words: Int32Array | null = null;
      let seqs: Int32Array | null = null;
      let origin: Float64Array | null = null;
      let data: DataView | null = null;

      /* ------------------------------------------------------------------ */
      /* 2. 开页与挂页                                                       */
      /* ------------------------------------------------------------------ */

      function bind(buffer: SharedArrayBuffer): boolean {
        if (buffer.byteLength !== Config.PageBytes) {
          return false;
        }
        owned = buffer;
        words = new Int32Array(buffer, 0, HeaderInts);
        origin = new Float64Array(buffer, Config.OriginOffset, 1);
        seqs = new Int32Array(buffer, Config.HeaderBytes, Config.Capacity * RecordInts);
        data = new DataView(buffer, Config.HeaderBytes, Config.Capacity * Config.RecordBytes);
        return true;
      }

      /**
       * 页面线程建立诊断页。已经建立时返回同一块。
       * 只有页面线程调用；主板和 CPU 线程用 attachTracePage。
       */
      export function openTracePage(): SharedArrayBuffer {
        const existing = owned;
        if (existing !== null) {
          return existing;
        }
        const buffer = new SharedArrayBuffer(Config.PageBytes);
        if (!bind(buffer)) {
          throw new Error("[ZerOS.Hardware.Diagnostics.TracePage] 诊断页长度不对");
        }
        const header = words;
        const clock = origin;
        if (header === null || clock === null) {
          throw new Error("[ZerOS.Hardware.Diagnostics.TracePage] 诊断页没有建立");
        }
        header.fill(0);
        Atomics.store(header, Config.CapacitySlot, Config.Capacity);
        Atomics.store(header, Config.VersionSlot, Config.Version);
        Atomics.store(header, Config.MagicSlot, Config.Magic);
        clock[0] = performance.timeOrigin + performance.now();
        Atomics.store(header, Config.EnabledSlot, 1);
        return buffer;
      }

      /** 主板或 CPU 线程挂上页面线程交来的那一块。 */
      export function attachTracePage(buffer: SharedArrayBuffer): void {
        if (!bind(buffer)) {
          return;
        }
        const header = words;
        if (header === null) {
          return;
        }
        Atomics.store(header, Config.EnabledSlot, 1);
      }

      /** 页面关闭时调用。已经挂上的线程看到启用位变 0 后不再写。 */
      export function closeTracePage(): void {
        detachTracePage();
      }

      /** 任一持有方摘下这一页。 */
      export function detachTracePage(): void {
        const header = words;
        if (header !== null) {
          Atomics.store(header, Config.EnabledSlot, 0);
        }
        owned = null;
        words = null;
        seqs = null;
        origin = null;
        data = null;
      }

      /** 交给别的线程的那一块。没有开页时是 null。 */
      export function traceBuffer(): SharedArrayBuffer | null {
        return owned;
      }

      /** 这一份视图是否在收记录。 */
      export function traceEnabled(): boolean {
        const header = words;
        return header !== null && Atomics.load(header, Config.EnabledSlot) === 1;
      }

      /** 已经被覆盖掉的记录数。 */
      export function traceDropped(): number {
        const header = words;
        if (header === null) {
          return 0;
        }
        return Atomics.load(header, Config.DroppedSlot);
      }

      /** 还没有回复的 svc 条数。命令是否跑完，先看这个。 */
      export function tracePending(): number {
        const header = words;
        if (header === null) {
          return 0;
        }
        return Atomics.load(header, Config.PendingSlot);
      }

      export interface TraceStatus {
        readonly Records: number;
        readonly Pending: number;
        readonly Dropped: number;
        readonly Prompts: number;
      }

      export interface TraceMem {
        readonly Count: number;
        readonly Total: number;
        readonly Max: number;
        readonly Cores: readonly {
          readonly Core: number;
          readonly Count: number;
          readonly Total: number;
          readonly Max: number;
        }[];
        readonly Services: readonly {
          readonly Service: number;
          readonly Count: number;
          readonly Total: number;
          readonly Max: number;
        }[];
      }

      /** 轻量状态。轮询用，不生成报告。 */
      export function traceStatus(): TraceStatus {
        const header = words;
        if (header === null) {
          return { Records: 0, Pending: 0, Dropped: 0, Prompts: 0 };
        }
        const head = Atomics.load(header, Config.HeadSlot);
        return {
          Records: Math.min(Math.max(head, 0), Config.Capacity),
          Pending: Atomics.load(header, Config.PendingSlot),
          Dropped: Atomics.load(header, Config.DroppedSlot),
          Prompts: Atomics.load(header, Config.PromptSlot),
        };
      }

      /* ------------------------------------------------------------------ */
      /* 3. 写                                                               */
      /* ------------------------------------------------------------------ */

      /**
       * 写一条记录。
       * span 为 0 表示不是 span；parent 为 0 表示没有父。
       */
      function writeRecord(
        op: number,
        layer: number,
        core: number,
        span: number,
        parent: number,
        a0: number,
        a1: number,
      ): void {
        const header = words;
        const marks = seqs;
        const view = data;
        const clock = origin;
        if (header === null || marks === null || view === null || clock === null) {
          return;
        }
        if (Atomics.load(header, Config.EnabledSlot) !== 1) {
          return;
        }
        if (op === SvcOp && a0 !== ExitService) {
          Atomics.add(header, Config.PendingSlot, 1);
        } else if (op === SvcReplyOp && Atomics.load(header, Config.PendingSlot) > 0) {
          Atomics.sub(header, Config.PendingSlot, 1);
        }
        if (op === PromptOp) {
          Atomics.add(header, Config.PromptSlot, 1);
        }
        const head = Atomics.add(header, Config.HeadSlot, 1);
        const slot = head % Config.Capacity;
        const seq = Atomics.add(header, Config.SeqSlot, 1) + 1;
        const base = slot * Config.RecordBytes;
        Atomics.store(marks, slot * RecordInts, 0);
        const at = Math.max(0, Math.floor((performance.timeOrigin + performance.now() - (clock[0] ?? 0)) * 1000));
        view.setUint8(base + 4, op & 0xff);
        view.setUint8(base + 5, layer & 0xff);
        /* 核号 0–255；宿主事件是 -1。用有符号 16 位，读回不变成 65535。 */
        view.setInt16(base + 6, core, true);
        view.setUint32(base + 8, at >>> 0, true);
        view.setInt32(base + 12, a0, true);
        view.setInt32(base + 16, a1, true);
        view.setUint32(base + 20, span >>> 0, true);
        view.setUint32(base + 24, parent >>> 0, true);
        Atomics.store(marks, slot * RecordInts, seq);
        if (head >= Config.Capacity) {
          Atomics.add(header, Config.DroppedSlot, 1);
        }
      }

      /**
       * 写一条时刻记录。
       * core 用 -1 表示宿主；a0、a1 的语义由事件码决定。
       */
      export function traceInstant(op: number, layer: number, core: number, a0: number, a1: number): void {
        writeRecord(op, layer, core, 0, 0, a0, a1);
      }

      /** 开一个 span，返回它的编号。parent 为 0 表示没有父。 */
      export function traceSpanBegin(op: number, layer: number, core: number, parent: number, a0: number, a1: number): number {
        const header = words;
        if (header === null || Atomics.load(header, Config.EnabledSlot) !== 1) {
          return 0;
        }
        const span = Atomics.add(header, Config.SpanSlot, 1) + 1;
        writeRecord(op, layer, core, span, parent, a0, a1);
        return span;
      }

      /** 关一个 span。span 由 traceSpanBegin 交回。 */
      export function traceSpanEnd(op: number, layer: number, core: number, span: number, a0: number, a1: number): void {
        writeRecord(op, layer, core, span, 0, a0, a1);
      }

      /** 写一条挂在某个 span 上、但不占新编号的事件。 */
      export function traceSpanEvent(op: number, layer: number, core: number, span: number, parent: number, a0: number, a1: number): void {
        writeRecord(op, layer, core, span, parent, a0, a1);
      }

      /* ------------------------------------------------------------------ */
      /* 4. 读                                                               */
      /* ------------------------------------------------------------------ */

      /** 按时间顺序交回这一页里还在的记录。写到一半的格子丢掉。 */
      export function readTrace(): readonly TraceEntry[] {
        const header = words;
        const marks = seqs;
        const view = data;
        if (header === null || marks === null || view === null) {
          return [];
        }
        const head = Atomics.load(header, Config.HeadSlot);
        const count = Math.min(Math.max(head, 0), Config.Capacity);
        const start = head - count;
        const out: TraceEntry[] = [];
        for (let index = start; index < head; index += 1) {
          const slot = ((index % Config.Capacity) + Config.Capacity) % Config.Capacity;
          const before = Atomics.load(marks, slot * RecordInts);
          if (before === 0) {
            continue;
          }
          const base = slot * Config.RecordBytes;
          const entry: TraceEntry = {
            Op: view.getUint8(base + 4),
            Layer: view.getUint8(base + 5),
            Core: view.getInt16(base + 6, true),
            At: view.getUint32(base + 8, true),
            A0: view.getInt32(base + 12, true),
            A1: view.getInt32(base + 16, true),
            Span: view.getUint32(base + 20, true),
            Parent: view.getUint32(base + 24, true),
          };
          if (Atomics.load(marks, slot * RecordInts) !== before) {
            continue;
          }
          out.push(entry);
        }
        out.sort((left, right): number => left.At - right.At);
        return out;
      }

      function raiseMax(slot: number, value: number): void {
        const header = words;
        if (header === null) {
          return;
        }
        let current = Atomics.load(header, slot);
        while (value > current) {
          const previous = Atomics.compareExchange(header, slot, current, value);
          if (previous === current) {
            break;
          }
          current = previous;
        }
      }

      /** 累加访存批次的计数、总耗时和最大批。按核也留一份。不占记录环。 */
      export function traceMem(core: number, count: number, total: number, max: number): void {
        const header = words;
        if (header === null || count <= 0 || Atomics.load(header, Config.EnabledSlot) !== 1) {
          return;
        }
        Atomics.add(header, Config.MemCountSlot, count);
        Atomics.add(header, Config.MemTotalSlot, total);
        raiseMax(Config.MemMaxSlot, max);
        if (Number.isInteger(core) && core >= 0 && core < 8) {
          Atomics.add(header, Config.MemCoreCountSlot + core, count);
          Atomics.add(header, Config.MemCoreTotalSlot + core, total);
          raiseMax(Config.MemCoreMaxSlot + core, max);
        }
      }

      /**
       * 把一段访存批次记到服务名下。
       * 服务边界由 CPU 运行时给出；这里只做累加，不判断归属。
       */
      export function traceServiceMem(service: number, count: number, total: number, max: number): void {
        const header = words;
        if (header === null || count <= 0 || Atomics.load(header, Config.EnabledSlot) !== 1) {
          return;
        }
        if (Number.isInteger(service) && service > 0 && service < Config.MemServiceSlots) {
          Atomics.add(header, Config.MemServiceCountSlot + service, count);
          Atomics.add(header, Config.MemServiceTotalSlot + service, total);
          raiseMax(Config.MemServiceMaxSlot + service, max);
        }
      }

      /** 访存批次的汇总。报告用，不参与 span 配对。 */
      export function traceMemStatus(): TraceMem {
        const header = words;
        if (header === null) {
          return { Count: 0, Total: 0, Max: 0, Cores: [], Services: [] };
        }
        const cores: { Core: number; Count: number; Total: number; Max: number }[] = [];
        for (let core = 0; core < 8; core += 1) {
          const count = Atomics.load(header, Config.MemCoreCountSlot + core);
          if (count > 0) {
            cores.push({
              Core: core,
              Count: count,
              Total: Atomics.load(header, Config.MemCoreTotalSlot + core),
              Max: Atomics.load(header, Config.MemCoreMaxSlot + core),
            });
          }
        }
        const services: { Service: number; Count: number; Total: number; Max: number }[] = [];
        for (let service = 1; service < Config.MemServiceSlots; service += 1) {
          const count = Atomics.load(header, Config.MemServiceCountSlot + service);
          if (count > 0) {
            services.push({
              Service: service,
              Count: count,
              Total: Atomics.load(header, Config.MemServiceTotalSlot + service),
              Max: Atomics.load(header, Config.MemServiceMaxSlot + service),
            });
          }
        }
        return {
          Count: Atomics.load(header, Config.MemCountSlot),
          Total: Atomics.load(header, Config.MemTotalSlot),
          Max: Atomics.load(header, Config.MemMaxSlot),
          Cores: cores,
          Services: services,
        };
      }

      /** 清空读指针和所有格子。只在没有写入方时调用。 */
      export function clearTrace(): void {
        const header = words;
        const marks = seqs;
        if (header === null || marks === null) {
          return;
        }
        Atomics.store(header, Config.HeadSlot, 0);
        Atomics.store(header, Config.DroppedSlot, 0);
        Atomics.store(header, Config.PendingSlot, 0);
        Atomics.store(header, Config.PromptSlot, 0);
        Atomics.store(header, Config.SpanSlot, 0);
        Atomics.store(header, Config.MemCountSlot, 0);
        Atomics.store(header, Config.MemTotalSlot, 0);
        Atomics.store(header, Config.MemMaxSlot, 0);
        for (let core = 0; core < 8; core += 1) {
          Atomics.store(header, Config.MemCoreCountSlot + core, 0);
          Atomics.store(header, Config.MemCoreTotalSlot + core, 0);
          Atomics.store(header, Config.MemCoreMaxSlot + core, 0);
        }
        for (let service = 0; service < Config.MemServiceSlots; service += 1) {
          Atomics.store(header, Config.MemServiceCountSlot + service, 0);
          Atomics.store(header, Config.MemServiceTotalSlot + service, 0);
          Atomics.store(header, Config.MemServiceMaxSlot + service, 0);
        }
        marks.fill(0);
      }
    }
  }
}
