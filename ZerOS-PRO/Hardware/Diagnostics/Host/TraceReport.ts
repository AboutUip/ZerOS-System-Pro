/**
 * @module ZerOS.Hardware.Diagnostics.TraceReport
 * @description 把诊断页读成一份能贴进文档的报告
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只读 TracePage 和页面上的 __zerosBoot，不写回。报告是派生视图，原始记录才是权威。
 * 开始和结束按 span 编号配对，父子按 parent 编号组树；没有 command span 的旧记录退回按核配对。
 * 端口 span 在树里显示端口、种类和字节数；svc 后的 queue 是它从发出到监督核取走的时间。
 * 报告先给命令树和服务总量，再给最长调用、交换、停机和启动表，最后一行是判决。
 * 没有记录时明确写“空”，不编造原因。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 启动
 *   3. 服务
 *   4. 交换与停机
 *   5. 报告
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as PageRoot } from "./TracePage";
import { ZerOS as OpRoot } from "../Enum/TraceOp";
import { ZerOS as DebugMapRoot } from "../../Debug/Host/DebugMap";
import { ZerOS as CoreStopRoot } from "../../Cpu/Host/PageCoreStop";
import { type ZerOS as EntryRoot } from "../Structure/TraceEntry";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Diagnostics {
      const readTrace = PageRoot.Hardware.Diagnostics.readTrace;
      const traceDropped = PageRoot.Hardware.Diagnostics.traceDropped;
      const tracePending = PageRoot.Hardware.Diagnostics.tracePending;
      const traceStatus = PageRoot.Hardware.Diagnostics.traceStatus;
      const traceMemStatus = PageRoot.Hardware.Diagnostics.traceMemStatus;
      const readCoreStop = CoreStopRoot.Hardware.Cpu.readCoreStop;
      const traceOpName = OpRoot.Hardware.Diagnostics.traceOpName;
      const traceServiceName = OpRoot.Hardware.Diagnostics.traceServiceName;
      const gpuPhaseName = OpRoot.Hardware.Diagnostics.gpuPhaseName;
      const TraceOp = OpRoot.Hardware.Diagnostics.TraceOp;
      const lookupSite = DebugMapRoot.Hardware.Debug.lookupSite;
      type TraceEntry = EntryRoot.Hardware.Diagnostics.TraceEntry;
      type DebugSiteRun = DebugMapRoot.Hardware.Debug.DebugSiteRun;

      interface DebugMapWindow {
        __zerosDebugMaps?: ReadonlyMap<number, readonly DebugSiteRun[]>;
        __zerosDebugMapsStatus?: string;
      }

      function readTraceMaps(): ReadonlyMap<number, readonly DebugSiteRun[]> {
        return (globalThis as DebugMapWindow).__zerosDebugMaps ?? new Map();
      }

      function traceMapStatus(): string {
        return (globalThis as DebugMapWindow).__zerosDebugMapsStatus ?? "not started";
      }

      interface BootMark {
        readonly Name: string;
        readonly At: number;
      }

      interface BootWindow {
        __zerosBoot?: unknown;
      }

      interface SpanRun {
        readonly Op: number;
        readonly Span: number;
        readonly Parent: number;
        readonly Core: number;
        readonly At: number;
        readonly End: number;
        readonly Duration: number;
        readonly A0: number;
        readonly A1: number;
      }

      interface ServiceRun {
        readonly Service: number;
        readonly Core: number;
        readonly At: number;
        readonly Duration: number;
      }

      interface ServiceSummary {
        readonly Service: number;
        readonly Count: number;
        readonly Total: number;
        readonly Max: number;
      }

      interface ExchangeRun {
        readonly Port: number;
        readonly Direction: number;
        readonly At: number;
        readonly Duration: number;
      }

      interface StopCount {
        Reason: number;
        Count: number;
      }


      /* ------------------------------------------------------------------ */
      /* 2. 启动                                                             */
      /* ------------------------------------------------------------------ */

      /** 页面上的启动点。不是页面线程时是空。 */
      function readBootMarks(): readonly BootMark[] {
        const host = globalThis as BootWindow;
        const raw: unknown = host.__zerosBoot;
        if (!Array.isArray(raw)) {
          return [];
        }
        const out: BootMark[] = [];
        for (const item of raw as readonly unknown[]) {
          if (typeof item !== "object" || item === null) {
            continue;
          }
          const record = item as { Name?: unknown; At?: unknown };
          if (typeof record.Name === "string" && typeof record.At === "number") {
            out.push({ Name: record.Name, At: record.At });
          }
        }
        return out;
      }

      /* ------------------------------------------------------------------ */
      /* 3. 服务                                                             */
      /* ------------------------------------------------------------------ */

      /** 结束事件到开始事件的映射。 */
      const SpanBegin: Readonly<Record<number, number>> = {
        [TraceOp.SvcReply]: TraceOp.Svc,
        [TraceOp.ExchangeReply]: TraceOp.Exchange,
        [TraceOp.CommandEnd]: TraceOp.Command,
        [TraceOp.InstallEnd]: TraceOp.Install,
        [TraceOp.PortEnd]: TraceOp.Port,
        [TraceOp.GpuEnd]: TraceOp.Gpu,
        [TraceOp.FrameEnd]: TraceOp.Frame,
      };

      /**
       * 按 span 编号配对开始和结束。服务 36 和命令根共用编号，
       * 所以键里同时带事件码，两棵记录不会互相覆盖。
       */
      function spanRuns(entries: readonly TraceEntry[]): readonly SpanRun[] {
        const open = new Map<string, TraceEntry>();
        const out: SpanRun[] = [];
        for (const entry of entries) {
          if (entry.Span === 0) {
            continue;
          }
          const beginOp = SpanBegin[entry.Op];
          if (beginOp !== undefined) {
            const key = `${String(beginOp)}:${String(entry.Span)}`;
            const start = open.get(key);
            if (start === undefined) {
              continue;
            }
            open.delete(key);
            out.push({
              Op: beginOp,
              Span: entry.Span,
              Parent: start.Parent,
              Core: start.Core,
              At: start.At,
              End: entry.At,
              Duration: Math.max(0, entry.At - start.At),
              A0: start.A0,
              A1: start.A1,
            });
            continue;
          }
          if (entry.Op === TraceOp.Svc || entry.Op === TraceOp.Exchange || entry.Op === TraceOp.Command || entry.Op === TraceOp.Install || entry.Op === TraceOp.Port || entry.Op === TraceOp.Gpu || entry.Op === TraceOp.Frame) {
            open.set(`${String(entry.Op)}:${String(entry.Span)}`, entry);
          }
        }
        return out;
      }

      function serviceRuns(spans: readonly SpanRun[]): readonly ServiceRun[] {
        const out: ServiceRun[] = [];
        for (const span of spans) {
          if (span.Op !== TraceOp.Svc) {
            continue;
          }
          out.push({
            Service: span.A0,
            Core: span.Core,
            At: span.At,
            Duration: span.Duration,
          });
        }
        out.sort((left, right): number => right.Duration - left.Duration);
        return out;
      }

      function summarizeServices(runs: readonly ServiceRun[]): readonly ServiceSummary[] {
        const totals = new Map<number, { Count: number; Total: number; Max: number }>();
        for (const run of runs) {
          const current = totals.get(run.Service) ?? { Count: 0, Total: 0, Max: 0 };
          current.Count += 1;
          current.Total += run.Duration;
          if (run.Duration > current.Max) {
            current.Max = run.Duration;
          }
          totals.set(run.Service, current);
        }
        const out: ServiceSummary[] = [];
        for (const [service, value] of totals) {
          out.push({ Service: service, Count: value.Count, Total: value.Total, Max: value.Max });
        }
        out.sort((left, right): number => right.Total - left.Total);
        return out;
      }

      /* ------------------------------------------------------------------ */
      /* 4. 交换与停机                                                       */
      /* ------------------------------------------------------------------ */

      function exchangeRuns(spans: readonly SpanRun[]): readonly ExchangeRun[] {
        const out: ExchangeRun[] = [];
        for (const span of spans) {
          if (span.Op !== TraceOp.Exchange) {
            continue;
          }
          out.push({
            Port: span.A0,
            Direction: span.A1,
            At: span.At,
            Duration: span.Duration,
          });
        }
        out.sort((left, right): number => right.Duration - left.Duration);
        return out;
      }

      function stopCounts(entries: readonly TraceEntry[]): readonly StopCount[] {
        const counts = new Map<number, number>();
        for (const entry of entries) {
          if (entry.Op !== TraceOp.CoreStop) {
            continue;
          }
          counts.set(entry.A0, (counts.get(entry.A0) ?? 0) + 1);
        }
        const out: StopCount[] = [];
        for (const [reason, count] of counts) {
          out.push({ Reason: reason, Count: count });
        }
        out.sort((left, right): number => right.Count - left.Count);
        return out;
      }

      function hostEventName(kind: number): string {
        if (kind === 1) {
          return "pointer";
        }
        if (kind === 2) {
          return "inbox";
        }
        if (kind === 3) {
          return "debug";
        }
        if (kind === 4) {
          return "panel";
        }
        if (kind === 5) {
          return "keyboard";
        }
        if (kind === 6) {
          return "pointer-dev";
        }
        if (kind === 7) {
          return "fault";
        }
        if (kind === 8) {
          return "clock";
        }
        if (kind === 9) {
          return "sandbox";
        }
        if (kind === 10) {
          return "display";
        }
        if (kind === 11) {
          return "sandbox-result";
        }
        if (kind === 12) {
          return "keyboard-page";
        }
        if (kind === 13) {
          return "pointer-page";
        }
        return `host ${String(kind)}`;
      }

      function rejectSourceName(source: number): string {
        if (source === 1) {
          return "inbox";
        }
        if (source === 2) {
          return "pointer";
        }
        if (source === 3) {
          return "frame";
        }
        if (source === 4) {
          return "exchange";
        }
        if (source === 5) {
          return "debug";
        }
        if (source === 6) {
          return "unknown";
        }
        if (source === 7) {
          return "buffer";
        }
        if (source === 8) {
          return "page";
        }
        if (source === 9) {
          return "worker";
        }
        return `source ${String(source)}`;
      }

      function rejectReasonName(reason: number): string {
        if (reason === 1) {
          return "shape";
        }
        if (reason === 2) {
          return "overflow";
        }
        if (reason === 3) {
          return "unknown";
        }
        if (reason === 4) {
          return "buffer";
        }
        if (reason === 5) {
          return "timeout";
        }
        if (reason === 6) {
          return "invalid";
        }
        if (reason === 7) {
          return "clone";
        }
        return `reason ${String(reason)}`;
      }

      function workerKindName(kind: number): string {
        if (kind === 1) {
          return "board";
        }
        if (kind === 2) {
          return "cpu";
        }
        if (kind === 3) {
          return "core";
        }
        if (kind === 4) {
          return "gpu";
        }
        if (kind === 5) {
          return "memory";
        }
        return `worker ${String(kind)}`;
      }

      function workerPhaseName(phase: number): string {
        if (phase === 1) {
          return "spawn";
        }
        if (phase === 2) {
          return "ready";
        }
        if (phase === 3) {
          return "error";
        }
        if (phase === 4) {
          return "message-error";
        }
        return `phase ${String(phase)}`;
      }

      function boardMessageName(code: number): string {
        if (code === 1) {
          return "power";
        }
        if (code === 2) {
          return "fault";
        }
        if (code === 3) {
          return "bind";
        }
        if (code === 4) {
          return "go";
        }
        if (code === 5) {
          return "ready";
        }
        if (code === 6) {
          return "checked";
        }
        if (code === 7) {
          return "trace";
        }
        if (code === 8) {
          return "trace-page";
        }
        if (code === 9) {
          return "panel";
        }
        if (code === 10) {
          return "debug-run";
        }
        if (code === 11) {
          return "debug-switch";
        }
        if (code === 12) {
          return "debug-result";
        }
        if (code === 13) {
          return "fault-log";
        }
        if (code === 14) {
          return "boot-mark";
        }
        return `board ${String(code)}`;
      }

      interface WaitRun {
        readonly Core: number;
        readonly Service: number;
        readonly At: number;
        readonly Duration: number;
      }

      /** 按 svc span 配对 wait 停止与 Wake；只表示宿主侧等待区间，不是任务因果。 */
      function waitRuns(entries: readonly TraceEntry[]): readonly WaitRun[] {
        const lastSvc = new Map<number, { readonly Service: number; readonly Span: number }>();
        const openBySpan = new Map<number, { readonly At: number; readonly Core: number; readonly Service: number }>();
        const openByCore = new Map<number, { readonly At: number; readonly Core: number; readonly Service: number }>();
        const out: WaitRun[] = [];
        for (const entry of entries) {
          if (entry.Op === TraceOp.Svc) {
            lastSvc.set(entry.Core, { Service: entry.A0, Span: entry.Span });
            continue;
          }
          if (entry.Op === TraceOp.CoreStop && entry.A0 === 2) {
            const svc = lastSvc.get(entry.Core);
            const start = { At: entry.At, Core: entry.Core, Service: svc?.Service ?? 0 };
            if (svc !== undefined && svc.Span !== 0) {
              openBySpan.set(svc.Span, start);
            }
            openByCore.set(entry.Core, start);
            continue;
          }
          if (entry.Op !== TraceOp.Wake) {
            continue;
          }
          const bySpan = entry.Span === 0 ? undefined : openBySpan.get(entry.Span);
          const start = bySpan ?? openByCore.get(entry.Core);
          if (start === undefined) {
            continue;
          }
          if (entry.Span !== 0) {
            openBySpan.delete(entry.Span);
          }
          openByCore.delete(start.Core);
          out.push({ Core: start.Core, Service: start.Service, At: start.At, Duration: Math.max(0, entry.At - start.At) });
        }
        out.sort((left, right): number => right.Duration - left.Duration);
        return out;
      }

      function stopName(reason: number): string {
        if (reason === 0) {
          return "halt";
        }
        if (reason === 1) {
          return "yield";
        }
        if (reason === 2) {
          return "wait";
        }
        if (reason === 3) {
          return "fault";
        }
        return `reason ${String(reason)}`;
      }

      interface TaskEdge {
        readonly Child: number;
        readonly Parent: number;
        readonly Code: number;
        readonly At: number;
        readonly Duration: number;
      }

      /**
       * 用内核诊断块的 task-wait / task-exit 配对任务级等待。
       * task-exit 的 A0 低 16 位是退出码，高位是子任务 pid；A1 是父任务 pid。
       * task-wait 的 A0 是等的人，A1 是等的目标（-1 表示任意子任务）。
       */
      function taskEdges(entries: readonly TraceEntry[]): readonly TaskEdge[] {
        const waits = entries
          .filter((entry): boolean => entry.Op === TraceOp.TaskWait)
          .sort((left, right): number => left.At - right.At);
        const exits = entries.filter((entry): boolean => entry.Op === TraceOp.TaskExit);
        const out: TaskEdge[] = [];
        for (const exit of exits) {
          const child = Math.floor(exit.A0 / 65536);
          const code = exit.A0 % 65536;
          let matched: TraceEntry | null = null;
          for (const wait of waits) {
            if (wait.At > exit.At || wait.A0 !== exit.A1) {
              continue;
            }
            if (wait.A1 !== -1 && wait.A1 !== child) {
              continue;
            }
            matched = wait;
          }
          if (matched !== null) {
            out.push({
              Child: child,
              Parent: exit.A1,
              Code: code,
              At: matched.At,
              Duration: Math.max(0, exit.At - matched.At),
            });
          }
        }
        out.sort((left, right): number => right.Duration - left.Duration);
        return out;
      }

      interface SleepEdge {
        readonly Pid: number;
        readonly Core: number;
        readonly At: number;
        readonly Duration: number;
      }

      /** 调度器 sleep/wake 按任务 pid 配对；这是不依赖具体等待对象的阻塞边。 */
      function sleepEdges(entries: readonly TraceEntry[]): readonly SleepEdge[] {
        const sleeps = entries
          .filter((entry): boolean => entry.Op === TraceOp.TaskSleep)
          .sort((left, right): number => left.At - right.At);
        const wakes = entries.filter((entry): boolean => entry.Op === TraceOp.TaskWake);
        const out: SleepEdge[] = [];
        const used = new Set<number>();
        for (const wake of wakes) {
          let matched = -1;
          for (let index = 0; index < sleeps.length; index += 1) {
            const sleep = sleeps[index];
            if (sleep === undefined || used.has(index) || sleep.At > wake.At || sleep.A0 !== wake.A0) {
              continue;
            }
            if (matched < 0 || sleep.At >= (sleeps[matched]?.At ?? 0)) {
              matched = index;
            }
          }
          if (matched >= 0) {
            used.add(matched);
            const sleep = sleeps[matched];
            if (sleep !== undefined) {
              out.push({
                Pid: wake.A0,
                Core: wake.A1,
                At: sleep.At,
                Duration: Math.max(0, wake.At - sleep.At),
              });
            }
          }
        }
        out.sort((left, right): number => right.Duration - left.Duration);
        return out;
      }

      interface InputEdge {
        readonly Id: number;
        readonly Source: string;
        readonly Duration: number;
        readonly Matched: boolean;
      }

      /**
       * 页面按键与客侧 key ring 消费按 ZKP1 关联号配对。
       * Input.A0 是页面写入第 7 字的关联号；KeyConsumed.A0 是固件查询码 7 读回的同一个号。
       */
      function inputEdges(entries: readonly TraceEntry[]): readonly InputEdge[] {
        const inputs = entries
          .filter((entry): boolean => entry.Op === TraceOp.Input && entry.A1 >= 32)
          .sort((left, right): number => left.At - right.At);
        const consumed = entries.filter((entry): boolean => entry.Op === TraceOp.KeyConsumed);
        const out: InputEdge[] = [];
        for (const input of inputs) {
          const match = consumed.find(
            (entry): boolean => entry.A0 === input.A0 && entry.At >= input.At,
          );
          out.push({
            Id: input.A0,
            Source: match === undefined ? "unmatched" : "key",
            Duration: match === undefined ? 0 : Math.max(0, match.At - input.At),
            Matched: match !== undefined,
          });
        }
        return out;
      }

      /** 鼠标按键/滚轮输入与固件消费按 ZPP1 关联号配对。 */
      function pointerEdges(entries: readonly TraceEntry[]): readonly InputEdge[] {
        const inputs = entries
          .filter((entry): boolean => entry.Op === TraceOp.Input && entry.A1 >= 0 && entry.A1 <= 3)
          .sort((left, right): number => left.At - right.At);
        const consumed = entries.filter((entry): boolean => entry.Op === TraceOp.PointerConsumed);
        const out: InputEdge[] = [];
        for (const input of inputs) {
          const match = consumed.find(
            (entry): boolean => entry.A0 === input.A0 && entry.At >= input.At,
          );
          out.push({
            Id: input.A0,
            Source: match === undefined ? "unmatched" : "pointer",
            Duration: match === undefined ? 0 : Math.max(0, match.At - input.At),
            Matched: match !== undefined,
          });
        }
        return out;
      }

      function millis(microseconds: number): string {
        return `${(microseconds / 1000).toFixed(1)}ms`;
      }

      /* ------------------------------------------------------------------ */
      /* 5. 报告                                                             */
      /* ------------------------------------------------------------------ */

      interface CommandItem {
        readonly At: number;
        readonly Text: string;
      }

      function spanLabel(run: SpanRun): string {
        if (run.Op === TraceOp.Svc) {
          return `svc ${traceServiceName(run.A0)} core=${String(run.Core)}`;
        }
        if (run.Op === TraceOp.Exchange) {
          return `exchange port=${String(run.A0)} dir=${String(run.A1)}`;
        }
        if (run.Op === TraceOp.Install) {
          return `install core=${String(run.A0)}`;
        }
        if (run.Op === TraceOp.Gpu) {
          const name = run.A0 === 1 ? "gpu.compose" : run.A0 === 2 ? "gpu.present" : `gpu ${String(run.A0)}`;
          return run.A1 > 0 ? `${name} cmds=${String(run.A1)}` : name;
        }
        if (run.Op === TraceOp.Frame) {
          return "frame";
        }
        if (run.Op === TraceOp.Port) {
          const port = run.A0 % 256;
          const kind = Math.floor(run.A0 / 256);
          if (kind === 1) {
            return `xchg port=${String(port)} dir=${String(run.A1)}`;
          }
          const name = kind === 2 ? "fill" : kind === 3 ? "carry" : kind === 4 ? "offer" : `port-kind-${String(kind)}`;
          return `${name} port=${String(port)} ${String(run.A1)}B`;
        }
        return `${traceOpName(run.Op)} core=${String(run.Core)}`;
      }

      /** 早先的页没有 command span，按第一条服务到提示符拼一棵浅树。 */
      function legacyCommandTree(
        entries: readonly TraceEntry[],
        services: readonly ServiceRun[],
        exchanges: readonly ExchangeRun[],
      ): readonly string[] {
        const items: CommandItem[] = [];
        for (const run of services) {
          items.push({ At: run.At, Text: `svc ${traceServiceName(run.Service)} core=${String(run.Core)} ${millis(run.Duration)}` });
        }
        for (const run of exchanges) {
          items.push({ At: run.At, Text: `exchange port=${String(run.Port)} dir=${String(run.Direction)} ${millis(run.Duration)}` });
        }
        if (items.length === 0) {
          return [];
        }
        items.sort((left, right): number => left.At - right.At);
        let promptAt: number | null = null;
        for (const entry of entries) {
          if (entry.Op === TraceOp.Prompt) {
            promptAt = entry.At;
          }
        }
        const start = items[0]?.At ?? 0;
        const last = items[items.length - 1];
        const end = promptAt ?? (last === undefined ? start : last.At);
        const lines: string[] = [];
        lines.push("");
        lines.push(`command: total ${millis(Math.max(0, end - start))}`);
        for (const item of items.slice(0, 20)) {
          lines.push(`  ${item.Text}`);
        }
        if (items.length > 20) {
          lines.push(`  ... ${String(items.length - 20)} more`);
        }
        if (promptAt !== null) {
          lines.push("  prompt");
        }
        return lines;
      }

      /** 按 parent 编号把真实 span 画成树。没有 command span 时退回浅树。 */
      function commandTree(
        spans: readonly SpanRun[],
        entries: readonly TraceEntry[],
        services: readonly ServiceRun[],
        exchanges: readonly ExchangeRun[],
      ): readonly string[] {
        const commands = spans.filter((run): boolean => run.Op === TraceOp.Command).sort((left, right): number => left.At - right.At);
        if (commands.length === 0) {
          return legacyCommandTree(entries, services, exchanges);
        }
        const prompts = entries.filter((entry): boolean => entry.Op === TraceOp.Prompt);
        const dispatched = new Map<number, number>();
        for (const entry of entries) {
          if (entry.Op === TraceOp.Dispatch) {
            dispatched.set(entry.Span, entry.At);
          }
        }
        /** svc 后的括注：排队时间。 */
        const notesOf = (run: SpanRun): string => {
          const at = dispatched.get(run.Span);
          if (at === undefined) {
            return "";
          }
          const wait = at - run.At;
          return wait >= 1000 ? ` (queue ${millis(wait)})` : "";
        };
        const execOf = (run: SpanRun): number => {
          if (run.Op !== TraceOp.Command) {
            return 0;
          }
          let total = 0;
          for (const entry of entries) {
            if (entry.Op === TraceOp.Exec && entry.Span === run.Span) {
              total += entry.A0;
            }
          }
          return total;
        };
        const attached = new Set<string>();
        const keyOf = (run: SpanRun): string => `${String(run.Op)}:${String(run.Span)}`;
        const childrenOf = (parent: number): readonly SpanRun[] => spans
          .filter((run): boolean => run.Parent === parent && run.Op !== TraceOp.Command && run.Span !== parent)
          .sort((left, right): number => left.At - right.At);
        const lines: string[] = [];
        const paint = (run: SpanRun, depth: number): void => {
          if (depth > 6) {
            return;
          }
          attached.add(keyOf(run));
          lines.push(`${"  ".repeat(depth)}${spanLabel(run)} ${millis(run.Duration)}${notesOf(run)}`);
          for (const child of childrenOf(run.Span).slice(0, 30)) {
            paint(child, depth + 1);
          }
        };
        for (const command of commands) {
          attached.add(keyOf(command));
          const executed = execOf(command);
          const execNote = executed > 0 ? ` exec=${String(executed)}` : "";
          lines.push("");
          lines.push(`command: total ${millis(command.Duration)} core=${String(command.Core)}${notesOf(command)}${execNote}`);
          for (const child of childrenOf(command.Span).slice(0, 40)) {
            paint(child, 1);
          }
          if (prompts.some((entry): boolean => entry.Span === command.Span)) {
            lines.push("  prompt");
          }
        }
        const orphans = spans
          .filter((run): boolean => run.Op !== TraceOp.Command && !attached.has(keyOf(run)) && !(run.Op === TraceOp.Svc && (run.A0 === 35 || run.A0 === 36)) && run.Duration > 0)
          .sort((left, right): number => right.Duration - left.Duration);
        if (orphans.length > 0) {
          lines.push("");
          lines.push("other spans (no command parent):");
          for (const run of orphans.slice(0, 12)) {
            lines.push(`  ${spanLabel(run)} ${millis(run.Duration)}`);
          }
          if (orphans.length > 12) {
            lines.push(`  ... ${String(orphans.length - 12)} more`);
          }
        }
        return lines;
      }

      /** 一份纯文本报告。没有记录时也返回可读的结论，不抛。 */
      export function reportTrace(): string {
        const entries = readTrace();
        const marks = readBootMarks();
        const spans = spanRuns(entries);
        const services = serviceRuns(spans);
        const summary = summarizeServices(services);
        const exchanges = exchangeRuns(spans);
        const stops = stopCounts(entries);
        const lines: string[] = [];
        lines.push("ztrace report");
        lines.push(`records: ${String(entries.length)}  dropped: ${String(traceDropped())}  pending: ${String(tracePending())}  prompts: ${String(traceStatus().Prompts)}  boot marks: ${String(marks.length)}`);
        const tree = commandTree(spans, entries, services, exchanges);
        if (tree.length > 0) {
          lines.push(...tree);
        }
        const mem = traceMemStatus();
        if (mem.Count > 0) {
          lines.push("");
          lines.push(`memory batches: ${String(mem.Count)}  total=${millis(mem.Total)}  max=${millis(mem.Max)}`);
          for (const core of mem.Cores) {
            lines.push(
              `  core ${String(core.Core)}  count=${String(core.Count)}  total=${millis(core.Total)}  max=${millis(core.Max)}`,
            );
          }
          if (mem.Services.length > 0) {
            lines.push("  by service:");
            let attributed = 0;
            let attributedTotal = 0;
            const ordered = [...mem.Services].sort((left, right): number => right.Count - left.Count);
            for (const service of ordered) {
              attributed += service.Count;
              attributedTotal += service.Total;
              lines.push(
                `    ${traceServiceName(service.Service).padEnd(10)} count=${String(service.Count)}  total=${millis(service.Total)}`,
              );
            }
            if (mem.Count > attributed) {
              lines.push(
                `    ${"(unattributed)".padEnd(10)} count=${String(mem.Count - attributed)}  total=${millis(Math.max(0, mem.Total - attributedTotal))}`,
              );
            }
          }
        }
        const stages = entries.filter((entry): boolean => entry.Op === TraceOp.GpuStage);
        if (stages.length > 0) {
          let scene = 0;
          let accel = 0;
          for (const stage of stages) {
            scene += stage.A0;
            accel += stage.A1;
          }
          lines.push("");
          lines.push(`gpu stages: presents=${String(stages.length)} scene=${String(scene)} accel=${String(accel)}`);
        }
        const phases = new Map<number, { Count: number; Total: number; Max: number }>();
        for (const entry of entries) {
          if (entry.Op !== TraceOp.GpuPhase) {
            continue;
          }
          const phase = phases.get(entry.A0) ?? { Count: 0, Total: 0, Max: 0 };
          phase.Count += 1;
          phase.Total += entry.A1;
          if (entry.A1 > phase.Max) {
            phase.Max = entry.A1;
          }
          phases.set(entry.A0, phase);
        }
        if (phases.size > 0) {
          lines.push("  phases:");
          const order = [...phases.keys()].sort((left, right): number => left - right);
          for (const phase of order) {
            const value = phases.get(phase);
            if (value === undefined) {
              continue;
            }
            lines.push(
              `    ${gpuPhaseName(phase).padEnd(8)} count=${String(value.Count)}  total=${millis(value.Total)}  max=${millis(value.Max)}`,
            );
          }
        }
        const hostCounts = new Map<number, number>();
        const boardCounts = new Map<number, number>();
        const rejectCounts = new Map<string, number>();
        const workerCounts = new Map<string, number>();
        const execByCore = new Map<number, number>();
        for (const entry of entries) {
          if (entry.Op === TraceOp.HostEvent) {
            hostCounts.set(entry.A0, (hostCounts.get(entry.A0) ?? 0) + 1);
          } else if (entry.Op === TraceOp.HostMessage) {
            boardCounts.set(entry.A0, (boardCounts.get(entry.A0) ?? 0) + 1);
          } else if (entry.Op === TraceOp.HostReject) {
            const key = `${String(entry.A0)}:${String(entry.A1)}`;
            rejectCounts.set(key, (rejectCounts.get(key) ?? 0) + 1);
          } else if (entry.Op === TraceOp.Worker) {
            const kind = Math.floor(entry.A0 / 256);
            const phase = entry.A0 % 256;
            const key = `${String(kind)}:${String(phase)}`;
            workerCounts.set(key, (workerCounts.get(key) ?? 0) + 1);
          } else if (entry.Op === TraceOp.Exec) {
            execByCore.set(entry.Core, (execByCore.get(entry.Core) ?? 0) + entry.A0);
          }
        }
        if (hostCounts.size > 0) {
          lines.push("");
          lines.push("host events:");
          const ordered = [...hostCounts.entries()].sort((left, right): number => right[1] - left[1]);
          for (const [kind, count] of ordered.slice(0, 10)) {
            lines.push(`  ${hostEventName(kind).padEnd(15)} ${String(count)}`);
          }
        }
        if (boardCounts.size > 0) {
          lines.push("");
          lines.push("host messages:");
          const ordered = [...boardCounts.entries()].sort((left, right): number => right[1] - left[1]);
          for (const [kind, count] of ordered.slice(0, 12)) {
            lines.push(`  ${boardMessageName(kind).padEnd(13)} ${String(count)}`);
          }
        }
        if (rejectCounts.size > 0) {
          lines.push("");
          lines.push("host rejects:");
          const ordered = [...rejectCounts.entries()].sort((left, right): number => right[1] - left[1]);
          for (const [key, count] of ordered.slice(0, 12)) {
            const [sourceText, reasonText] = key.split(":");
            const source = Number(sourceText);
            const reason = Number(reasonText);
            lines.push(`  ${rejectSourceName(source).padEnd(9)} ${rejectReasonName(reason).padEnd(8)} ${String(count)}`);
          }
        }
        if (workerCounts.size > 0) {
          lines.push("");
          lines.push("worker lifecycle:");
          const ordered = [...workerCounts.entries()].sort((left, right): number => right[1] - left[1]);
          for (const [key, count] of ordered.slice(0, 16)) {
            const [kindText, phaseText] = key.split(":");
            const kind = Number(kindText);
            const phase = Number(phaseText);
            lines.push(`  ${workerKindName(kind).padEnd(8)} ${workerPhaseName(phase).padEnd(14)} ${String(count)}`);
          }
        }
        if (execByCore.size > 0) {
          lines.push("");
          lines.push("cpu executed:");
          const ordered = [...execByCore.entries()].sort((left, right): number => right[1] - left[1]);
          for (const [core, executed] of ordered) {
            lines.push(`  core ${String(core)}  ${String(executed)}`);
          }
        }
        interface InsnRange {
          Core: number;
          Start: number;
          Site: string;
          Total: number;
          Samples: number;
          Time: number;
        }
        interface InsnCore {
          Samples: number;
          Total: number;
        }
        const maps = readTraceMaps();
        const ranges = new Map<string, InsnRange>();
        const insnCores = new Map<number, InsnCore>();
        const lastInsn = new Map<number, { readonly At: number; readonly Key: string }>();
        let insnTotal = 0;
        let insnSamples = 0;
        for (const entry of entries) {
          if (entry.Op !== TraceOp.Insn) {
            continue;
          }
          const runs = maps.get(entry.Core);
          const site = runs === undefined ? "-" : lookupSite(runs, entry.A0);
          /* A1=1 是原生单条采样；无源行时按 64 字节窗口聚合，避免每 PC 只有一两次。 */
          const start = entry.A1 === 1 ? Math.floor(entry.A0 / 512) * 512 : entry.A0;
          const key = site !== "-" ? `${String(entry.Core)}:${site}` : `${String(entry.Core)}:${String(start)}`;
          const current = ranges.get(key) ?? { Core: entry.Core, Start: start, Site: site, Total: 0, Samples: 0, Time: 0 };
          current.Total += entry.A1;
          current.Samples += 1;
          ranges.set(key, current);
          const previous = lastInsn.get(entry.Core);
          if (previous !== undefined && entry.At > previous.At) {
            const delta = entry.At - previous.At;
            /* 跨命令/跨长空档不归到上一条采样，避免把等待算进函数。 */
            if (delta <= 50_000) {
              const before = ranges.get(previous.Key);
              if (before !== undefined) {
                before.Time += delta;
              }
            }
          }
          lastInsn.set(entry.Core, { At: entry.At, Key: key });
          const core = insnCores.get(entry.Core) ?? { Samples: 0, Total: 0 };
          core.Samples += 1;
          core.Total += entry.A1;
          insnCores.set(entry.Core, core);
          insnTotal += entry.A1;
          insnSamples += 1;
        }
        if (ranges.size > 0) {
          lines.push("");
          lines.push(`instruction samples: ${String(insnSamples)}  units=${String(insnTotal)}`);
          lines.push(`  source maps: ${maps.size > 0 ? [...maps.keys()].map((core): string => `core ${String(core)}`).join(", ") : traceMapStatus()}`);
          const coreOrder = [...insnCores.entries()].sort((left, right): number => right[1].Samples - left[1].Samples);
          for (const [coreOrdinal, core] of coreOrder) {
            lines.push(`  core ${String(coreOrdinal)}  samples=${String(core.Samples)}  units=${String(core.Total)}`);
            const top = [...ranges.values()]
              .filter((range): boolean => range.Core === coreOrdinal)
              .sort((left, right): number => (right.Time !== 0 ? right.Time : right.Total) - (left.Time !== 0 ? left.Time : left.Total))
              .slice(0, 3);
            for (const range of top) {
              const label = range.Site !== "-" ? range.Site : `#${String(range.Start)}`;
              lines.push(`    ${label}  time=${millis(range.Time)}  units=${String(range.Total)}  samples=${String(range.Samples)}`);
            }
          }
        }
        if (summary.length > 0) {
          lines.push("");
          lines.push("service totals:");
          for (const item of summary.slice(0, 8)) {
            lines.push(`  ${traceServiceName(item.Service).padEnd(10)} count=${String(item.Count)}  total=${millis(item.Total)}  max=${millis(item.Max)}`);
          }
          lines.push("");
          lines.push("longest calls:");
          for (const run of services.slice(0, 10)) {
            lines.push(`  ${traceServiceName(run.Service).padEnd(10)} core=${String(run.Core)}  ${millis(run.Duration)}`);
          }
        }
        if (exchanges.length > 0) {
          lines.push("");
          lines.push("exchanges:");
          for (const run of exchanges.slice(0, 8)) {
            lines.push(`  port=${String(run.Port)} dir=${String(run.Direction)}  ${millis(run.Duration)}`);
          }
        }
        interface ProtocolPort {
          Port: number;
          Kind: number;
          Count: number;
          Bytes: number;
        }
        const ports = new Map<string, ProtocolPort>();
        for (const span of spans) {
          if (span.Op !== TraceOp.Port) {
            continue;
          }
          const port = span.A0 % 256;
          const kind = Math.floor(span.A0 / 256);
          const key = `${String(port)}:${String(kind)}`;
          const current = ports.get(key) ?? { Port: port, Kind: kind, Count: 0, Bytes: 0 };
          current.Count += 1;
          if (kind !== 1) {
            current.Bytes += span.A1;
          }
          ports.set(key, current);
        }
        if (ports.size > 0) {
          lines.push("");
          lines.push("protocol ports:");
          const ordered = [...ports.values()].sort((left, right): number => right.Count - left.Count).slice(0, 8);
          for (const item of ordered) {
            const kind = item.Kind === 1 ? "xchg" : item.Kind === 2 ? "fill" : item.Kind === 3 ? "carry" : item.Kind === 4 ? "offer" : `kind ${String(item.Kind)}`;
            lines.push(`  port ${String(item.Port)}  ${kind.padEnd(6)} count=${String(item.Count)}  bytes=${String(item.Bytes)}`);
          }
        }
        if (stops.length > 0) {
          lines.push("");
          lines.push("core stops:");
          for (const stop of stops) {
            lines.push(`  ${stopName(stop.Reason).padEnd(8)} ${String(stop.Count)}`);
          }
        }
        const latest: { Core: number; Reason: number; Index: number; Op: string; Snapshot: { Registers: readonly string[]; Pc: string; StackPointer: string; StackStart: string; StackEnd: string } | null }[] = [];
        for (let core = 0; core < 8; core += 1) {
          const stop = readCoreStop(core);
          if (stop !== null) {
            latest.push(stop);
          }
        }
        if (latest.length > 0) {
          lines.push("");
          lines.push("latest stops:");
          for (const stop of latest) {
            lines.push(
              `  core ${String(stop.Core)}  ${stopName(stop.Reason)}  index=${String(stop.Index)}  op=${stop.Op.length > 0 ? stop.Op : "-"}`,
            );
            if (stop.Snapshot !== null) {
              const snapshot = stop.Snapshot;
              lines.push(
                `    pc=${snapshot.Pc}  sp=${snapshot.StackPointer}  stack=${snapshot.StackStart}..${snapshot.StackEnd}`,
              );
              if (snapshot.Registers.length > 0) {
                lines.push(`    registers: ${snapshot.Registers.join(" ")}`);
              }
            }
          }
        }
        const waits = waitRuns(entries);
        if (waits.length > 0) {
          lines.push("");
          lines.push("wait spans:");
          for (const run of waits.slice(0, 10)) {
            lines.push(`  ${traceServiceName(run.Service).padEnd(9)} core=${String(run.Core)}  ${millis(run.Duration)}`);
          }
        }
        const edges = taskEdges(entries);
        if (edges.length > 0) {
          lines.push("");
          lines.push("task waits:");
          for (const edge of edges.slice(0, 10)) {
            lines.push(
              `  child=${String(edge.Child)} parent=${String(edge.Parent)} code=${String(edge.Code)}  ${millis(edge.Duration)}`,
            );
          }
        }
        const sleeps = sleepEdges(entries);
        if (sleeps.length > 0) {
          lines.push("");
          lines.push("task sleeps:");
          for (const edge of sleeps.slice(0, 10)) {
            lines.push(`  pid=${String(edge.Pid)} core=${String(edge.Core)}  ${millis(edge.Duration)}`);
          }
        }
        const inputs = inputEdges(entries);
        if (inputs.length > 0) {
          const unmatched = inputs.filter((edge): boolean => !edge.Matched).length;
          lines.push("");
          lines.push(`input spans: matched=${String(inputs.length - unmatched)}/${String(inputs.length)}`);
          for (const edge of inputs.slice(0, 10)) {
            const duration = edge.Matched ? millis(edge.Duration) : "unmatched";
            lines.push(`  id=${String(edge.Id)} ${edge.Source.padEnd(9)} ${duration}`);
          }
        }
        const pointers = pointerEdges(entries);
        if (pointers.length > 0) {
          const unmatched = pointers.filter((edge): boolean => !edge.Matched).length;
          lines.push("");
          lines.push(`pointer spans: matched=${String(pointers.length - unmatched)}/${String(pointers.length)}`);
          for (const edge of pointers.slice(0, 10)) {
            const duration = edge.Matched ? millis(edge.Duration) : "unmatched";
            lines.push(`  id=${String(edge.Id)} ${edge.Source.padEnd(9)} ${duration}`);
          }
        }



        lines.push("");
        if (entries.length === 0) {
          lines.push("verdict: no trace records; the debug switch may be off or nothing has run yet");
        } else if (summary.length > 0) {
          const top = summary[0];
          lines.push(`verdict: ${traceServiceName(top?.Service ?? 0)} total ${millis(top?.Total ?? 0)} across ${String(top?.Count ?? 0)} calls, max ${millis(top?.Max ?? 0)}`);
        } else if (marks.length > 1 && ((marks[marks.length - 1]?.At ?? 0) - (marks[0]?.At ?? 0)) > 5000) {
          lines.push("verdict: boot is over 5s; check the boot table");
        } else {
          lines.push(`verdict: ${String(entries.length)} records, no single event over 1s`);
        }
        if (marks.length > 0) {
          const base = marks[0]?.At ?? 0;
          const last = marks[marks.length - 1];
          const total = last === undefined ? 0 : last.At - base;
          lines.push("");
          lines.push(`boot: total ${millis(total * 1000)}`);
          for (const mark of marks) {
            lines.push(`  ${mark.Name.padEnd(12)} ${millis((mark.At - base) * 1000)}`);
          }
        }
        return lines.join("\n");
      }

      /** 报告里事件码的名字；给以后查看器用。 */
      export function traceEventName(op: number): string {
        return traceOpName(op);
      }
    }
  }
}
