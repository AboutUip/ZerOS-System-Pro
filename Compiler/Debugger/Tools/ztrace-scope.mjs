/**
 * ZerOS 观测域（ObservationScope）工具侧第一步：按范围筛选 trace 记录。
 *
 * ---------------------------------------------------------------------------
 * 可信度规则（比功能更重要）
 * ---------------------------------------------------------------------------
 * 1. 字段语义必须有源码出处。每个 Op 的 A0/A1 含义来自下面 TRACE_OPS 的 source；
 *    不认识的 Op 一律显示为 op-<编号> 并保留原始 A0/A1，不猜含义。
 * 2. 不静默丢弃。每一类被排除的记录都要计数并列出原因。
 * 3. schema 识别。v2 记录有 Layer/Span/Parent；旧记录只有 A0..A3。
 *    旧记录上使用 --span/--parent/--layer 时直接报错退出，不用空值蒙混。
 * 4. 身份归属要明说。svc/exec 等记录只有 Core，没有 pid；--pid 只匹配 task-* 事件，
 *    其余记录归入“不可按 pid 归属”并单独计数。
 * 5. ProcessExit 的 Core 是核心号，不是 pid（ztrace.mjs 里的 hostExits.pid 命名不准）。
 * 6. stops/faults 数组里的 Op 是停机/故障那条指令的助记符文本（如 core/svc/div），
 *    不是 TraceOp 名称；来源 ZerOS-PRO/Hardware/Cpu/Bootstrap/CpuRuntime.ts 的
 *    noteStop(instructionOp)。entries 用 --op（TraceOp 名称/编号），stops/faults
 *    用 --stop-op（指令助记符文本），两个参数不混用，避免错配。
 *
 * ---------------------------------------------------------------------------
 * 用法
 * ---------------------------------------------------------------------------
 *   node Compiler/Debugger/Tools/ztrace-scope.mjs --capture <capture.json> [过滤]
 *
 * 过滤：
 *   --window boot|command|command:<n>|command:<文本>|all
 *   --core <编号|范围|host>       可重复；host = -1；范围如 3-7
 *   --op <名称|编号>             可重复；entries 用，TraceOp 名称或编号
 *   --stop-op <助记符>           可重复；stops/faults 用，指令助记符文本（core/div…）
 *   --service <编号>              可重复；匹配 svc/svc-reply/dispatch/wake 的 A0
 *   --pid <编号>                  可重复；只匹配带 pid 的任务事件
 *   --since <At> --until <At>     会话相对微秒
 *   --span <编号> --parent <编号> 仅 v2 记录
 *   --limit <行数>                默认 200
 *   --json                        机器可读输出
 *   --legend                      打印 Op 语义表
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/* -------------------------------------------------------------------------- */
/* 1. 事件语义（每条都有源码出处）                                             */
/* -------------------------------------------------------------------------- */

export const TRACE_LAYERS = {
  1: "host",
  2: "core",
  3: "protocol",
  4: "syscall",
  5: "sched",
  6: "boot",
};

/**
 * A0/A1 的含义。source 是仓库内相对路径:行号（以当前工作区为准）。
 * 没有 a0/a1 说明的字段一律显示原始数字，不解释。
 */
export const TRACE_OPS = {
  1: { name: "svc", a0: "service", a1: "0", span: "本次系统调用", source: "ZerOS-PRO/Hardware/Cpu/Bootstrap/CpuRuntime.ts:1712" },
  2: { name: "svc-reply", a0: "service", a1: "0", span: "同 svc", source: "ZerOS-PRO/Hardware/Cpu/Bootstrap/CpuRuntime.ts:1761" },
  3: { name: "exchange", a0: "扩展口下标", a1: "方向", span: "本次交换", source: "ZerOS-PRO/Hardware/Motherboard/Host/BoardDispatch.ts:358" },
  4: { name: "exchange-reply", a0: "扩展口下标", a1: "方向", span: "同 exchange", source: "ZerOS-PRO/Hardware/Motherboard/Host/BoardDispatch.ts:359" },
  5: { name: "core-stop", a0: "停机原因(0=halt 1=yield 2=svc 3=fail)", a1: "指令下标", source: "ZerOS-PRO/Hardware/Motherboard/Seat/CpuSeat.ts:465" },
  6: { name: "prompt", span: "命令 span", source: "ZerOS-PRO/Hardware/Cpu/Bootstrap/CpuRuntime.ts:1720" },
  7: { name: "command", span: "命令 span", source: "ZerOS-PRO/Hardware/Cpu/Bootstrap/CpuRuntime.ts:1705" },
  8: { name: "command-end", span: "命令 span", source: "ZerOS-PRO/Hardware/Cpu/Bootstrap/CpuRuntime.ts:1703" },
  9: { name: "install", a0: "目标核心", a1: "映像长度", span: "本次装入", source: "ZerOS-PRO/Hardware/Cpu/Bootstrap/CpuRuntime.ts:4402" },
  10: { name: "install-end", span: "同 install", source: "ZerOS-PRO/Hardware/Cpu/Bootstrap/CpuRuntime.ts:4407" },
  11: { name: "port", a0: "端口+种类*256", a1: "字节数", span: "本次端口交换", source: "ZerOS-PRO/Hardware/Cpu/Host/CoreDispatch.ts:1164" },
  12: { name: "port-end", span: "同 port", source: "ZerOS-PRO/Hardware/Cpu/Host/CoreDispatch.ts:1171" },
  13: { name: "dispatch", a0: "service", source: "ZerOS-PRO/Hardware/Cpu/Bootstrap/CpuRuntime.ts:3741" },
  14: { name: "gpu", a0: "gpu 操作码", a1: "命令条数", span: "本次 gpu 操作", source: "ZerOS-PRO/Hardware/Cpu/Bootstrap/CpuRuntime.ts:2756" },
  15: { name: "gpu-end", span: "同 gpu", source: "ZerOS-PRO/Hardware/Cpu/Bootstrap/CpuRuntime.ts:2763" },
  16: { name: "host-event", a0: "宿主事件种类", a1: "载荷（随种类不同）", source: "多个宿主文件，见 --legend" },
  17: { name: "frame", span: "本次帧传输", source: "ZerOS-PRO/Hardware/Motherboard/Host/BoardDispatch.ts:266" },
  18: { name: "frame-end", span: "同 frame", source: "ZerOS-PRO/Hardware/Motherboard/Host/BoardDispatch.ts:272" },
  19: { name: "exec", a0: "本次执行条数", span: "所属命令 span", source: "ZerOS-PRO/Hardware/Cpu/Bootstrap/CpuRuntime.ts:1658" },
  20: { name: "insn", a0: "pc 或起始 pc", a1: "采样条数", source: "ZerOS-PRO/Hardware/Cpu/Native/NativeCore.ts:71 / Cpu/Host/CoreDispatch.ts:1829" },
  21: { name: "wake", a0: "service", span: "被回复的 svc", source: "ZerOS-PRO/Hardware/Cpu/Bootstrap/CpuRuntime.ts:1760" },
  22: { name: "host-message", a0: "板级消息种类", source: "ZerOS-PRO/Hardware/Motherboard/Host/BoardDispatch.ts:426" },
  23: { name: "host-reject", a0: "来源", a1: "原因", source: "ZerOS-PRO/Hardware/Diagnostics/Host/WorkerTrace.ts:57" },
  24: { name: "worker", a0: "线程种类/阶段码", a1: "细节", source: "ZerOS-PRO/Hardware/Diagnostics/Host/WorkerTrace.ts:49" },
  25: { name: "task-wait", a0: "等待者 pid", a1: "目标 pid（-1 为任意子任务）", source: "ZerOS-PRO/Hardware/Motherboard/Seat/CpuSeat.ts:262" },
  26: { name: "task-exit", a0: "子 pid<<16 | 退出码", a1: "父 pid", source: "ZerOS-PRO/Hardware/Motherboard/Seat/CpuSeat.ts:264" },
  27: { name: "task-sleep", a0: "pid", a1: "核心号", source: "ZerOS-PRO/Hardware/Motherboard/Seat/CpuSeat.ts:266" },
  28: { name: "task-wake", a0: "pid", a1: "核心号", source: "ZerOS-PRO/Hardware/Motherboard/Seat/CpuSeat.ts:268" },
  29: { name: "input", a0: "关联号", a1: "键码/指针种类", source: "ZerOS-PRO/Hardware/Display/Host/PublishKeyboard.ts:131 / PublishPointer.ts:175" },
  30: { name: "key-consumed", a0: "关联号", a1: "键码低 16 位", source: "ZerOS-PRO/Hardware/Motherboard/Seat/CpuSeat.ts:241" },
  31: { name: "pointer-consumed", a0: "关联号", a1: "打包的指针载荷", source: "ZerOS-PRO/Hardware/Motherboard/Seat/CpuSeat.ts:270" },
  32: { name: "gpu-stage", a0: "场景命令数", a1: "加速命令数", source: "ZerOS-PRO/Hardware/Gpu/Host/GpuDispatch.ts:251" },
  33: { name: "gpu-phase", a0: "阶段", a1: "值（微秒）", source: "ZerOS-PRO/Hardware/Gpu/Host/GpuDispatch.ts:66" },
  34: { name: "process-exit", a0: "退出码", coreNote: "Core 是核心号，不是 pid", source: "ZerOS-PRO/Hardware/Cpu/Bootstrap/CpuRuntime.ts:4965 / Cpu/Native/NativeCore.ts:328" },
};

const OPS_WITH_SERVICE = new Set([1, 2, 13, 21]);
/** 宿主事件种类（ZerOS-PRO/Hardware/Diagnostics/Enum/TraceOp.ts 的 TraceHostEvent）。 */
export const HOST_EVENTS = {
  1: "pointer",
  2: "inbox",
  3: "debug",
  4: "panel",
  5: "keyboard",
  6: "pointer-device",
  7: "fault",
  8: "clock",
  9: "sandbox",
  10: "display",
  11: "sandbox-result",
  12: "keyboard-page",
  13: "pointer-page",
};

export function hostEventName(a0) {
  return HOST_EVENTS[a0] ?? `host-event-${a0}（非协议编号，可能是调试插桩）`;
}
const OPS_WITH_PID = {
  25: (e) => [e.A0, e.A1 === -1 ? null : e.A1],
  26: (e) => [Math.floor(e.A0 / 65536), e.A1],
  27: (e) => [e.A0],
  28: (e) => [e.A0],
  30: (e) => [null],
  31: (e) => [null],
};

export function opName(op) {
  const item = TRACE_OPS[op];
  return item === undefined ? `op-${op}` : item.name;
}

export function layerName(layer) {
  return TRACE_LAYERS[layer] ?? `layer-${layer}`;
}

/* -------------------------------------------------------------------------- */
/* 2. schema 识别与读取                                                        */
/* -------------------------------------------------------------------------- */

export function detectSchema(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return { kind: "empty", detail: "没有记录" };
  let v2 = 0;
  let legacy = 0;
  for (const entry of entries) {
    if (entry === null || typeof entry !== "object") continue;
    if ("Layer" in entry && "Span" in entry && "Parent" in entry) v2 += 1;
    else legacy += 1;
  }
  if (v2 > 0 && legacy === 0) return { kind: "v2", detail: `${v2} 条记录都带 Layer/Span/Parent` };
  if (legacy > 0 && v2 === 0) return { kind: "legacy", detail: `${legacy} 条记录缺 Layer/Span/Parent` };
  return { kind: "mixed", detail: `v2 ${v2} 条，legacy ${legacy} 条` };
}

export function loadCapture(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(`读不到 capture：${file}（${error.message}）`);
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new Error(`capture 不是合法 JSON：${file}（${error.message}）`);
  }
  if (json === null || typeof json !== "object" || !Array.isArray(json.commands)) {
    throw new Error(`capture 缺少 commands 数组：${file}`);
  }
  return json;
}

/** 把 boot 和每条命令的记录摊平成带窗口标签的列表。 */
export function flatten(capture) {
  const rows = [];
  const windows = [];
  const boot = capture.boot ?? {};
  const bootEntries = Array.isArray(boot.entries) ? boot.entries : [];
  windows.push({ label: "boot", index: -1, command: null, entries: bootEntries.length });
  for (const entry of bootEntries) rows.push({ entry, window: "boot", commandIndex: -1, command: null });
  capture.commands.forEach((command, index) => {
    const label = `command:${index + 1}`;
    const entries = Array.isArray(command.entries) ? command.entries : [];
    windows.push({ label, index, command: command.command, entries: entries.length });
    for (const entry of entries) rows.push({ entry, window: label, commandIndex: index, command: command.command });
  });
  return { rows, windows };
}

/* -------------------------------------------------------------------------- */
/* 3. 筛选                                                                     */
/* -------------------------------------------------------------------------- */

function parseNumberList(values, label) {
  const out = [];
  for (const value of values) {
    for (const part of String(value).split(",")) {
      const text = part.trim();
      if (text.length === 0) continue;
      const range = text.match(/^(-?\d+)\s*-\s*(-?\d+)$/);
      if (range !== null) {
        const from = Number(range[1]);
        const to = Number(range[2]);
        if (!Number.isInteger(from) || !Number.isInteger(to) || from > to) {
          throw new Error(`${label} 范围非法：${text}`);
        }
        for (let index = from; index <= to; index += 1) out.push(index);
        continue;
      }
      const single = text === "host" ? -1 : Number(text);
      if (!Number.isInteger(single)) throw new Error(`${label} 不是整数：${text}`);
      out.push(single);
    }
  }
  return [...new Set(out)];
}

function parseOpList(values) {
  const byName = new Map();
  for (const [number, item] of Object.entries(TRACE_OPS)) byName.set(item.name, Number(number));
  const out = [];
  for (const value of values) {
    for (const part of String(value).split(",")) {
      const text = part.trim();
      if (text.length === 0) continue;
      if (/^\d+$/.test(text)) {
        out.push(Number(text));
        continue;
      }
      const number = byName.get(text);
      if (number === undefined) {
        throw new Error(`--op 不认识：${text}（用 --legend 看合法名称）`);
      }
      out.push(number);
    }
  }
  return [...new Set(out)];
}

export function entryPids(entry) {
  const extract = OPS_WITH_PID[entry.Op];
  if (extract === undefined) return null;
  const raw = extract(entry).filter((value) => typeof value === "number");
  const identity = decodeTaskIdentity(entry);
  if (identity !== null && identity.trustworthy) {
    const real = identity.kind === "task-wait"
      ? [identity.waiter, identity.target]
      : identity.kind === "task-exit"
        ? [identity.child, identity.parent]
        : [identity.pid];
    return [...new Set([...raw, ...real.filter((value) => value >= 0)])];
  }
  return raw;
}

function matchWindow(row, spec) {
  if (spec.kind === "all") return true;
  if (spec.kind === "boot") return row.window === "boot";
  if (spec.kind === "command") return row.window !== "boot";
  return row.window === `command:${spec.index}`;
}

export function selectEntries(rows, filters, schema) {
  const included = [];
  const excluded = {
    window: 0,
    core: 0,
    op: 0,
    service: 0,
    pid: 0,
    notPidAttributable: 0,
    time: 0,
    span: 0,
    parent: 0,
    legacyField: 0,
    invalid: 0,
  };

  for (const row of rows) {
    const entry = row.entry;
    if (entry === null || typeof entry !== "object" || typeof entry.Op !== "number" || typeof entry.At !== "number") {
      excluded.invalid += 1;
      continue;
    }
    if (!matchWindow(row, filters.window)) {
      excluded.window += 1;
      continue;
    }
    if (filters.core !== null && !filters.core.includes(entry.Core)) {
      excluded.core += 1;
      continue;
    }
    if (filters.op !== null && !filters.op.includes(entry.Op)) {
      excluded.op += 1;
      continue;
    }
    if (filters.service !== null) {
      if (!OPS_WITH_SERVICE.has(entry.Op) || !filters.service.includes(entry.A0)) {
        excluded.service += 1;
        continue;
      }
    }
    if (filters.pid !== null) {
      const pids = entryPids(entry);
      if (pids === null) {
        excluded.notPidAttributable += 1;
        continue;
      }
      if (!pids.some((pid) => filters.pid.includes(pid))) {
        excluded.pid += 1;
        continue;
      }
    }
    if (filters.since !== null && entry.At < filters.since) {
      excluded.time += 1;
      continue;
    }
    if (filters.until !== null && entry.At > filters.until) {
      excluded.time += 1;
      continue;
    }
    if (filters.span !== null) {
      if (schema.kind === "legacy") {
        excluded.legacyField += 1;
        continue;
      }
      if (entry.Span !== filters.span) {
        excluded.span += 1;
        continue;
      }
    }
    if (filters.parent !== null) {
      if (schema.kind === "legacy") {
        excluded.legacyField += 1;
        continue;
      }
      if (entry.Parent !== filters.parent) {
        excluded.parent += 1;
        continue;
      }
    }
    included.push(row);
  }
  return { included, excluded };
}

/** stops / faults 是独立数组，字段是 Core/Reason/Index/Op(文本)/At/Detail。 */
export function flattenStopsFaults(capture) {
  const rows = [];
  const push = (kind, items, window, commandIndex, command) => {
    for (const item of items) rows.push({ item, kind, window, commandIndex, command });
  };
  const boot = capture.boot ?? {};
  push("stop", Array.isArray(boot.stops) ? boot.stops : [], "boot", -1, null);
  push("fault", Array.isArray(boot.faults) ? boot.faults : [], "boot", -1, null);
  capture.commands.forEach((command, index) => {
    push("stop", Array.isArray(command.stops) ? command.stops : [], `command:${index + 1}`, index, command.command);
    push("fault", Array.isArray(command.faults) ? command.faults : [], `command:${index + 1}`, index, command.command);
  });
  return rows;
}

export function selectStopsFaults(rows, filters, schema) {
  const included = [];
  const excluded = { window: 0, core: 0, op: 0, pid: 0, notPidAttributable: 0, time: 0, invalid: 0 };
  for (const row of rows) {
    const item = row.item;
    if (item === null || typeof item !== "object" || typeof item.At !== "number" || typeof item.Core !== "number") {
      excluded.invalid += 1;
      continue;
    }
    if (!matchWindow({ window: row.window }, filters.window)) {
      excluded.window += 1;
      continue;
    }
    if (filters.core !== null && !filters.core.includes(item.Core)) {
      excluded.core += 1;
      continue;
    }
    if (filters.stopOp !== null) {
      /* stops/faults 的 Op 是停机/故障那条指令的助记符文本（noteStop 里 instructionOp 的结果）。
         这里按原文本匹配；--op 只对 entries 生效，不参与 stops/faults 的匹配。 */
      if (typeof item.Op !== "string" || !filters.stopOp.includes(item.Op)) {
        excluded.op += 1;
        continue;
      }
    }
    if (filters.pid !== null) {
      excluded.notPidAttributable += 1;
      continue;
    }
    if (filters.since !== null && item.At < filters.since) {
      excluded.time += 1;
      continue;
    }
    if (filters.until !== null && item.At > filters.until) {
      excluded.time += 1;
      continue;
    }
    included.push(row);
  }
  return { included, excluded };
}

/**
 * svc 配对分析。只在“窗口 + 核心 + 时间”范围内找回复，不受 --op/--service/--pid 影响，
 * 免得用户自己的过滤把回复滤掉之后被误判成挂死。
 *
 * 未回复的 svc 再看同核有没有任务切换的证据：svcSpans 按核心号记账
 * （CpuRuntime.ts beginSvcSpan 的 svcSpans.set(ordinal, …) / endSvcSpan 的 svcSpans.get(ordinal)），
 * 同核换任务会让在途 span 串号或漏闭合。有这种证据时标记 ambiguous，提示“先按记账缺口查，
 * 不要直接判定挂死”。
 */
/** 按设计就不回复的服务：28 exit（ZerOS-PRO/Kernel/Init/start.obr 服务 28 分支“不再回复调用者”）。 */
const NO_REPLY_SERVICES = new Map([
  [28, "服务 28（exit）按设计不回复调用者；父任务 wait 时由 procExit 交回状态（Kernel/Init/start.obr）"],
]);
export function analyzeSvcPairs(rows, filters, capture) {
  const scope = rows.filter((row) => {
    const entry = row.entry;
    if (entry === null || typeof entry !== "object" || typeof entry.Op !== "number") return false;
    if (!matchWindow(row, filters.window)) return false;
    if (filters.core !== null && !filters.core.includes(entry.Core)) return false;
    if (filters.since !== null && entry.At < filters.since) return false;
    if (filters.until !== null && entry.At > filters.until) return false;
    return true;
  });
  /* 命令结果是采集器记录的事实（error/提示符/退出码），不是推测；
     用它给“未回复”做两候选判读，避免只凭 trace 就断定挂死。 */
  const outcomeOf = (row) => {
    if (row.commandIndex < 0) return null;
    const command = capture.commands[row.commandIndex];
    if (command === undefined) return null;
    const prompts = command.status !== null && typeof command.status === "object" ? Number(command.status.Prompts ?? 0) : 0;
    return {
      error: typeof command.error === "string" ? command.error : null,
      prompts,
      exitCode: command.exitCode ?? null,
    };
  };
  const verdictOf = (outcome) => {
    if (outcome === null) return "boot 窗口没有命令结果，只能看原始记录";
    const succeeded = outcome.error === null && outcome.prompts >= 1;
    return succeeded
      ? "命令已成功回到提示符：更像 trace 记账缺口（同核任务切换），不是挂死"
      : `命令本身没有成功（error=${outcome.error ?? "无"} prompts=${outcome.prompts}）：才值得怀疑真没回复`;
  };
  const paired = [];
  const unreplied = [];
  /* 回复索引一次建好，避免每个 svc 都线性找一遍（大 capture 上会拖垮工具）。 */
  const replyIndex = new Map();
  for (const row of scope) {
    const entry = row.entry;
    if (entry.Op !== 2) continue;
    const key = `${entry.Core}|${entry.Span}|${entry.A0}`;
    const list = replyIndex.get(key);
    if (list === undefined) replyIndex.set(key, [row]);
    else list.push(row);
  }
  for (const row of scope) {
    const entry = row.entry;
    if (entry.Op !== 1) continue;
    const candidates = replyIndex.get(`${entry.Core}|${entry.Span}|${entry.A0}`);
    const reply = candidates === undefined
      ? undefined
      : candidates.find((candidate) => candidate.entry.At > entry.At);
    if (reply !== undefined) {
      paired.push({ span: entry.Span, core: entry.Core, service: entry.A0, at: entry.At, replyAt: reply.entry.At });
      continue;
    }
    const switchEvidence = scope.filter((candidate) => {
      const later = candidate.entry.Core === entry.Core && candidate.entry.At > entry.At;
      if (!later) return false;
      if (candidate.entry.Op === 34) return true;
      if (candidate.entry.Op === 5 && candidate.entry.A0 !== 2) return true;
      return candidate.entry.Op === 1 && candidate.entry.Span !== entry.Span;
    });
    const outcome = outcomeOf(row);
    const designNote = NO_REPLY_SERVICES.get(entry.A0) ?? null;
    unreplied.push({
      span: entry.Span,
      core: entry.Core,
      service: entry.A0,
      at: entry.At,
      byDesign: designNote !== null,
      ambiguous: switchEvidence.length > 0,
      outcome,
      verdict: designNote ?? verdictOf(outcome),
      evidence: switchEvidence.slice(0, 3).map((candidate) => ({
        At: candidate.entry.At,
        Op: opName(candidate.entry.Op),
        A0: candidate.entry.A0,
        Span: candidate.entry.Span,
      })),
    });
  }
  return { paired, unreplied };
}

/* -------------------------------------------------------------------------- */
/* 3.5 任务身份：诊断字编码要先反解，不能把 A0 当 pid                          */
/* -------------------------------------------------------------------------- */

/**
 * 内核诊断字把四个字段压进一个 64 位字：`kind + a*16 + b*65536 + c*2^32`
 * （ZerOS-PRO/Kernel/Proc/sig.obr:17）。a 落在位 4..19，b 落在位 16..31，
 * 两者在位 16..19 重叠；宿主按 `a=(word/16)%65536`、`b=(word/65536)%65536`
 * 解码（ZerOS-PRO/Hardware/Motherboard/Seat/CpuSeat.ts:258-260）。
 * 所以 trace 里的 A0（a 字段）混进了 b 的低 4 位 × 4096，必须反解：
 *
 *   real_a = (A0 - (real_b % 16) * 4096 + 65536) % 65536
 *
 * 其中 real_b 来自 A1（b 字段自身没有被 a 污染，只要 real_a < 4096）。
 * 反解失败（范围不对）时返回 trustworthy=false，工具绝不拿它当身份。
 */
export function decodeTaskIdentity(entry) {
  const op = entry.Op;
  if (op !== 25 && op !== 26 && op !== 27 && op !== 28) return null;
  const invert = (inflated, b) => ((inflated - (b % 16) * 4096) % 65536 + 65536) % 65536;
  if (op === 25) {
    /* task-wait：内核 diagTask(1, waiterPid, waitFor+2)，宿主发 A0=a、A1=b-2。
       所以 target=A1（-1 表示任意子任务），b=A1+2。 */
    const target = entry.A1;
    const b = entry.A1 + 2;
    const waiter = invert(entry.A0, b);
    return {
      kind: "task-wait",
      raw: { a: entry.A0, b, c: 0 },
      waiter,
      target,
      trustworthy: waiter >= 0 && waiter <= 65535 && target >= -1,
      source: "Kernel/Proc/sig.obr:193 + Motherboard/Seat/CpuSeat.ts:262",
    };
  }
  if (op === 26) {
    /* task-exit：内核 diagTask(2, childPid, parentPid, code)，宿主发 A0=a*65536+c、A1=b。 */
    const decodeA = Math.floor(entry.A0 / 65536);
    const code = entry.A0 % 65536;
    const parent = entry.A1;
    const child = invert(decodeA, parent);
    return {
      kind: "task-exit",
      raw: { a: decodeA, b: parent, c: code },
      child,
      parent,
      code,
      trustworthy: child >= 0 && child <= 65535 && parent >= 0 && parent <= 65535,
      source: "Kernel/Proc/sig.obr:151 + Motherboard/Seat/CpuSeat.ts:264",
    };
  }
  /* task-sleep / task-wake：内核 diagTask(3/4, pid, core)，宿主发 A0=a、A1=b。 */
  const core = entry.A1;
  const pid = invert(entry.A0, core);
  return {
    kind: op === 27 ? "task-sleep" : "task-wake",
    raw: { a: entry.A0, b: core, c: 0 },
    pid,
    core,
    trustworthy: pid >= 0 && pid <= 65535 && core >= 0 && core <= 7,
    source: "Kernel/Sched/sched.obr:17,31 + Motherboard/Seat/CpuSeat.ts:266,268",
  };
}

/**
 * 从 lifecycle 事件建任务图。注意：task-exit 只在“唤醒睡眠中的等待者”时才发
 * （Kernel/Proc/sig.obr procExit 的唤醒分支），同核延迟回复等场景会缺边；
 * 缺边必须显式报告，不能默认“没有子任务”。
 */
export function buildTaskGraph(rows) {
  const nodes = new Map();
  const warnings = [];
  const nodeOf = (pid) => {
    let node = nodes.get(pid);
    if (node === undefined) {
      node = { pid, parent: null, firstAt: null, lastAt: null, cores: new Set(), exit: null, waits: [], edges: new Set() };
      nodes.set(pid, node);
    }
    return node;
  };
  for (const row of rows) {
    const entry = row.entry;
    if (entry === null || typeof entry !== "object") continue;
    const identity = decodeTaskIdentity(entry);
    if (identity === null || identity.trustworthy === false) {
      if (identity !== null) warnings.push(`At=${entry.At} 的 ${identity.kind} 反解不可信，已跳过`);
      continue;
    }
    const touch = (pid, at) => {
      const node = nodeOf(pid);
      if (node.firstAt === null || at < node.firstAt) node.firstAt = at;
      if (node.lastAt === null || at > node.lastAt) node.lastAt = at;
    };
    if (identity.kind === "task-sleep" || identity.kind === "task-wake") {
      touch(identity.pid, entry.At);
      nodeOf(identity.pid).cores.add(identity.core);
      continue;
    }
    if (identity.kind === "task-wait") {
      touch(identity.waiter, entry.At);
      const waiter = nodeOf(identity.waiter);
      waiter.waits.push({ target: identity.target, at: entry.At });
      if (identity.target >= 0) {
        touch(identity.target, entry.At);
        waiter.edges.add(`wait:${identity.target}`);
        const target = nodeOf(identity.target);
        if (target.parent === null) target.parent = identity.waiter;
        else if (target.parent !== identity.waiter) {
          warnings.push(`pid ${identity.target} 的父任务不一致：task-wait 说 ${identity.waiter}，已有 ${target.parent}`);
        }
      }
      continue;
    }
    /* task-exit */
    touch(identity.child, entry.At);
    touch(identity.parent, entry.At);
    const child = nodeOf(identity.child);
    if (child.parent === null) child.parent = identity.parent;
    else if (child.parent !== identity.parent) {
      warnings.push(`pid ${identity.child} 的父任务不一致：task-exit 说 ${identity.parent}，已有 ${child.parent}`);
    }
    child.exit = { at: entry.At, code: identity.code };
    nodeOf(identity.parent).edges.add(`exit:${identity.child}`);
  }
  const orphans = [...nodes.values()].filter((node) => node.parent === null && node.pid !== 1);
  if (orphans.length > 0) {
    warnings.push(`${orphans.length} 个 pid 没有任何 task-exit/task-wait 边（procExit 只在唤醒睡眠等待者时发 task-exit），父子关系未知：${orphans.map((node) => node.pid).join(",")}`);
  }
  return { nodes, warnings };
}

/** root 别名：shell 取 task-exit 边最多的父 pid；init 固定 pid 1（Kernel reserveOne）。 */
export function resolveRootAlias(graph, name) {
  if (/^\d+$/.test(name)) return { pid: Number(name), note: "直接给的 pid" };
  if (name === "init") return { pid: 1, note: "init 固定 pid 1（Kernel/Proc/task.obr reserveOne）" };
  if (name === "shell") {
    const counts = new Map();
    for (const node of graph.nodes.values()) {
      for (const edge of node.edges) {
        if (!edge.startsWith("exit:")) continue;
        counts.set(node.pid, (counts.get(node.pid) ?? 0) + 1);
      }
    }
    const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1]);
    if (ranked.length === 0) return { pid: null, note: "capture 里没有 task-exit 边，认不出 shell" };
    if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) {
      return { pid: null, note: `shell 候选并列（${ranked.filter((item) => item[1] === ranked[0][1]).map((item) => item[0]).join(",")}），拒绝猜测` };
    }
    return { pid: ranked[0][0], note: `task-exit 边最多的父 pid（${ranked[0][1]} 条）` };
  }
  return { pid: null, note: `不认识的别名：${name}` };
}

/**
 * 任务范围的动态成员：root 自己，加上从 task-exit/task-wait 边可达的后代。
 * 关系只有 self / descendants；execChain / serviceClosure 留给第 3/4 步（要 image/module/device 事件）。
 */
export function taskScopeMembers(graph, root, relation) {
  const warnings = [];
  if (relation !== "self" && relation !== "descendants") {
    throw new Error(`relation 只支持 self/descendants（execChain/serviceClosure 留给 image/module/device 步）`);
  }
  if (!graph.nodes.has(root)) {
    warnings.push(`pid ${root} 在 capture 里没有任何任务级事件`);
    return { members: [root], warnings, source: new Map([[root, "root"]]) };
  }
  const members = new Set([root]);
  const source = new Map([[root, "root"]]);
  if (relation === "descendants") {
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of graph.nodes.values()) {
        if (members.has(node.pid) || node.parent === null) continue;
        if (members.has(node.parent)) {
          members.add(node.pid);
          source.set(node.pid, `parent ${node.parent}`);
          changed = true;
        }
      }
    }
    for (const node of graph.nodes.values()) {
      for (const wait of node.waits) {
        if (wait.target >= 0 && members.has(node.pid) && !members.has(wait.target)) {
          members.add(wait.target);
          source.set(wait.target, `wait target of ${node.pid}`);
          changed = true;
        }
      }
    }
  }
  return { members: [...members].sort((left, right) => left - right), warnings, source };
}

/**
 * 记录归属：
 *   direct        —— 记录本身带任务身份，且 pid 在成员里；
 *   core-attributed —— 记录只有核心号，落进成员曾驻留的核心和时间段（近似，必须标注）。
 */
export function classifyTaskRow(row, graph, members) {
  const entry = row.entry;
  const identity = decodeTaskIdentity(entry);
  if (identity !== null && identity.trustworthy) {
    const pid = identity.kind === "task-wait" ? identity.waiter : identity.kind === "task-exit" ? identity.child : identity.pid;
    if (members.includes(pid)) return { match: "direct", pid };
    return { match: null, pid };
  }
  if (typeof entry.Core !== "number" || entry.Core < 0) return { match: null, pid: null };
  const at = entry.At;
  for (const pid of members) {
    const node = graph.nodes.get(pid);
    if (node === undefined) continue;
    if (!node.cores.has(entry.Core)) continue;
    /* 生命周期：有退出事件的，从第一次任务事件到退出；没有退出事件的（如 init），
       开始时间未知，按整个 capture 近似——这本来就是 core-attributed 近似档。 */
    const from = node.exit === null ? -Infinity : (node.firstAt ?? -Infinity);
    const to = node.exit === null ? Infinity : node.exit.at;
    if (at >= from && at <= to) return { match: "core-attributed", pid };
  }
  return { match: null, pid: null };
}

/* -------------------------------------------------------------------------- */
/* 3.6 调试会话：命名 scope、激活集合、切换日志                                 */
/* -------------------------------------------------------------------------- */

export const SESSION_SCHEMA = "zeros.ztrace.scope-session/1";

export function emptySession(now = new Date().toISOString()) {
  return { schema: SESSION_SCHEMA, createdAt: now, updatedAt: now, scopes: {}, active: [], log: [] };
}

export function loadSession(file) {
  if (!fs.existsSync(file)) return emptySession();
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  if (json === null || typeof json !== "object" || json.schema !== SESSION_SCHEMA) {
    throw new Error(`scope 会话文件 schema 不对（期望 ${SESSION_SCHEMA}）：${file}`);
  }
  if (typeof json.scopes !== "object" || json.scopes === null || !Array.isArray(json.active) || !Array.isArray(json.log)) {
    throw new Error(`scope 会话文件字段不全：${file}`);
  }
  return json;
}

export function saveSession(file, session) {
  session.updatedAt = new Date().toISOString();
  fs.writeFileSync(file, `${JSON.stringify(session, null, 2)}\n`);
}

function appendLog(session, action, name, note) {
  session.log.push({ at: new Date().toISOString(), action, name, note: note ?? "" });
  if (session.log.length > 200) session.log.splice(0, session.log.length - 200);
}

/** spec 语法：选择器用 `key=value;key=value`；任务范围用 `task=<pid|shell|init>;relation=self|descendants`。 */
export function defineScope(session, name, spec) {
  if (name.length === 0) throw new Error("scope 名字不能为空");
  const parts = String(spec).split(";").map((part) => part.trim()).filter((part) => part.length > 0);
  const fields = {};
  for (const part of parts) {
    const equal = part.indexOf("=");
    if (equal <= 0) throw new Error(`scope 片段不是 key=value：${part}`);
    fields[part.slice(0, equal).trim()] = part.slice(equal + 1).trim();
  }
  if (fields.task !== undefined) {
    const relation = fields.relation ?? "descendants";
    if (relation !== "self" && relation !== "descendants") {
      throw new Error(`relation 只支持 self/descendants：${relation}`);
    }
    const taskScope = { kind: "task", task: fields.task, relation };
    if (fields.window !== undefined) taskScope.window = parseWindowSpec(fields.window);
    session.scopes[name] = taskScope;
    appendLog(session, "define", name, `task=${fields.task};relation=${relation}${fields.window !== undefined ? `;window=${fields.window}` : ""}`);
    return;
  }
  const selector = {};
  for (const [key, value] of Object.entries(fields)) {
    if (key === "window") selector.window = parseWindowSpec(value);
    else if (key === "core") selector.core = parseNumberList([value], "core");
    else if (key === "op") selector.op = parseOpList([value]);
    else if (key === "stop-op") selector.stopOp = value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
    else if (key === "service") selector.service = parseNumberList([value], "service");
    else if (key === "pid") selector.pid = parseNumberList([value], "pid");
    else if (key === "since") selector.since = Number(value);
    else if (key === "until") selector.until = Number(value);
    else if (key === "span") selector.span = Number(value);
    else if (key === "parent") selector.parent = Number(value);
    else throw new Error(`scope 不认识的字段：${key}`);
  }
  session.scopes[name] = { kind: "selector", selector };
  appendLog(session, "define", name, spec);
}

function parseWindowSpec(value) {
  if (value === "boot") return { kind: "boot" };
  if (value === "command") return { kind: "command" };
  if (value === "all") return { kind: "all" };
  if (/^command:\d+$/.test(value)) return { kind: "by-index", index: Number(value.slice("command:".length)) };
  if (/^command:.+$/.test(value)) return { kind: "by-text", text: value.slice("command:".length) };
  throw new Error(`window 不合法：${value}`);
}

export function setActive(session, name, active) {
  if (session.scopes[name] === undefined) throw new Error(`scope 不存在：${name}`);
  const index = session.active.indexOf(name);
  if (active && index < 0) session.active.push(name);
  if (!active && index >= 0) session.active.splice(index, 1);
  appendLog(session, active ? "activate" : "deactivate", name, "");
}

export function dropScope(session, name) {
  if (session.scopes[name] === undefined) throw new Error(`scope 不存在：${name}`);
  delete session.scopes[name];
  const index = session.active.indexOf(name);
  if (index >= 0) session.active.splice(index, 1);
  appendLog(session, "drop", name, "");
}

/* -------------------------------------------------------------------------- */
/* 4. 输出                                                                     */
/* -------------------------------------------------------------------------- */

export function describeEntry(row) {
  const entry = row.entry;
  const item = TRACE_OPS[entry.Op];
  return {
    At: entry.At,
    Window: row.window,
    Core: entry.Core,
    Op: entry.Op,
    OpName: opName(entry.Op),
    Layer: entry.Layer,
    A0: entry.A0,
    A0Decoded: entry.Op === 16 ? hostEventName(entry.A0) : null,
    A1: entry.A1,
    Span: entry.Span,
    Parent: entry.Parent,
    A0Meaning: item?.a0 ?? null,
    A1Meaning: item?.a1 ?? null,
    Source: item?.source ?? null,
  };
}

function printRows(included, limit, json) {
  const rows = included.slice(0, limit).map(describeEntry);
  if (json) return rows;
  const lines = [];
  lines.push("At(µs)     Window      Core Op            A0           A1           Span Parent");
  for (const row of rows) {
    const suspect = row.OpName === "host-event" && typeof row.A0Decoded === "string" && row.A0Decoded.includes("非协议编号")
      ? "  [A0 非协议编号，可能是调试插桩]"
      : "";
    lines.push(
      `${String(row.At).padEnd(10)} ${String(row.Window).padEnd(11)} ${String(row.Core).padStart(4)} `
      + `${row.OpName.padEnd(12)} ${String(row.A0).padEnd(12)} ${String(row.A1).padEnd(12)} `
      + `${String(row.Span).padEnd(4)} ${String(row.Parent)}${suspect}`,
    );
  }
  return lines.join("\n");
}

export function printLegend() {
  const lines = ["Op 语义表（source 是当前工作区的源码出处）："];
  for (const [number, item] of Object.entries(TRACE_OPS)) {
    const fields = [];
    if (item.a0 !== undefined) fields.push(`A0=${item.a0}`);
    if (item.a1 !== undefined) fields.push(`A1=${item.a1}`);
    if (item.coreNote !== undefined) fields.push(item.coreNote);
    if (item.span !== undefined) fields.push(`span=${item.span}`);
    lines.push(`  ${String(number).padStart(2)} ${item.name.padEnd(16)} ${fields.join("  ")}`);
    lines.push(`      source: ${item.source}`);
  }
  lines.push("");
  lines.push("Layer 表：1 host  2 core  3 protocol  4 syscall  5 sched  6 boot");
  return lines.join("\n");
}

/**
 * 命名 scope 的执行。selector 直接按过滤器筛；task 先建任务图、算动态成员，
 * 再把记录分成 direct（记录自带任务身份）和 core-attributed（只按核心驻留近似归属）。
 * core-attributed 必须单独计数，不能和 direct 混在一起冒充精确归属。
 */
export function runNamedScope(capture, name, def, ctx) {
  const { rows, windows, schema, indexOf } = ctx;
  const base = {
    window: { kind: "all" }, core: null, op: null, stopOp: null, service: null,
    pid: null, since: null, until: null, span: null, parent: null,
  };
  if (def.kind === "selector") {
    const filters = { ...base, ...def.selector, window: def.selector.window ?? { kind: "all" } };
    const { included, excluded } = selectEntries(rows, filters, schema);
    const stopFault = selectStopsFaults(flattenStopsFaults(capture), filters, schema);
    const svcPairs = analyzeSvcPairs(rows, filters, capture);
    return {
      name, kind: "selector", def, filters, warnings: [],
      counts: { total: rows.length, included: included.length, excluded, excludedTotal: Object.values(excluded).reduce((a, b) => a + b, 0) },
      rows: included.slice(0, 200),
      matchedIndices: new Set(included.map((row) => indexOf.get(row))),
      stops: stopFault.included.filter((row) => row.kind === "stop"),
      faults: stopFault.included.filter((row) => row.kind === "fault"),
      svcPairs,
    };
  }
  if (def.kind !== "task") throw new Error(`scope 类型不认识：${def.kind}`);
  const graph = buildTaskGraph(rows);
  const rootInfo = resolveRootAlias(graph, def.task);
  if (rootInfo.pid === null) throw new Error(`task scope 认不出 root（${rootInfo.note}）`);
  const { members, warnings, source } = taskScopeMembers(graph, rootInfo.pid, def.relation);
  const windowSpec = def.window ?? { kind: "all" };
  const counts = { total: rows.length, direct: 0, coreAttributed: 0, excluded: 0, window: 0 };
  const matched = [];
  const matchedIndices = new Set();
  for (const row of rows) {
    if (!matchWindow(row, windowSpec)) {
      counts.window += 1;
      continue;
    }
    const cls = classifyTaskRow(row, graph, members);
    if (cls.match === null) {
      counts.excluded += 1;
      continue;
    }
    if (cls.match === "direct") counts.direct += 1;
    else counts.coreAttributed += 1;
    matched.push({ row, cls });
    matchedIndices.add(indexOf.get(row));
  }
  const unassignedPids = [...graph.nodes.keys()].filter((pid) => !members.includes(pid)).sort((left, right) => left - right);
  /* svc 配对按窗口算，再标注每条的成员归属，避免按成员过滤把回复滤掉。 */
  const svcPairs = analyzeSvcPairs(rows, { ...base, window: windowSpec }, capture);
  const annotate = (item) => {
    const row = rows.find((candidate) => candidate.entry.At === item.at && candidate.entry.Core === item.core && candidate.entry.Op === 1);
    const cls = row === undefined ? null : classifyTaskRow(row, graph, members);
    return { ...item, membership: cls?.match ?? "unknown", memberPid: cls?.pid ?? null };
  };
  return {
    name,
    kind: "task",
    def,
    root: { pid: rootInfo.pid, note: rootInfo.note },
    members: members.map((pid) => ({
      pid,
      parent: graph.nodes.get(pid)?.parent ?? null,
      source: source.get(pid) ?? "?",
      firstAt: graph.nodes.get(pid)?.firstAt ?? null,
      lastAt: graph.nodes.get(pid)?.lastAt ?? null,
      cores: [...(graph.nodes.get(pid)?.cores ?? [])],
      exit: graph.nodes.get(pid)?.exit ?? null,
    })),
    warnings: [...warnings, ...graph.warnings],
    counts,
    unassignedPids,
    rows: matched.slice(0, 200),
    matchedIndices,
    stops: [],
    faults: [],
    svcPairs: {
      paired: svcPairs.paired.map(annotate),
      unreplied: svcPairs.unreplied.map(annotate),
    },
  };
}

/** 活动 scope 之间的重叠：同一行被几个 scope 命中。 */
export function overlapMatrix(results) {
  const matrix = [];
  for (let left = 0; left < results.length; left += 1) {
    for (let right = left + 1; right < results.length; right += 1) {
      let both = 0;
      for (const index of results[left].matchedIndices) {
        if (results[right].matchedIndices.has(index)) both += 1;
      }
      matrix.push({ left: results[left].name, right: results[right].name, shared: both });
    }
  }
  return matrix;
}

/* -------------------------------------------------------------------------- */
/* 5. CLI                                                                      */
/* -------------------------------------------------------------------------- */

function usage() {
  return [
    "ztrace-scope：按观测域筛选 capture.json（只读，不碰产品）。",
    "",
    "用法：node Compiler/Debugger/Tools/ztrace-scope.mjs --capture <capture.json> [过滤]",
    "",
    "过滤：",
    "  --window boot|command|command:<n>|command:<文本>|all",
    "  --core <编号|范围|host>     可重复；host=-1；如 3 或 3-7",
    "  --op <名称|编号>            可重复；entries 用，名称见 --legend",
    "  --stop-op <助记符>          可重复；stops/faults 用，指令助记符文本（core/div…）",
    "  --service <编号>            可重复；匹配 svc/svc-reply/dispatch/wake 的 A0",
    "  --pid <编号>                可重复；只匹配 task-* 等带 pid 的记录",
    "  --since <At> --until <At>   会话相对微秒",
    "  --span <编号> --parent <编号> 仅 v2 记录",
    "  --limit <行数>              默认 200",
    "  --json                      机器可读",
    "  --out-file <路径>           把文本报告写到文件（UTF-8 + BOM，Windows 查看器不乱码）",
    "  --legend                    打印 Op 语义表",
    "",
    "动态 scope（会话状态，切换后对后续 capture 立即生效）：",
    "  --session <文件>            会话文件，默认 ztrace-scope-session.json",
    "  --define <名字>=<spec>      新建/覆盖 scope；spec 见下",
    "  --activate <名字>           激活（可重复）",
    "  --deactivate <名字>         停用（可重复）",
    "  --drop <名字>               删除",
    "  --list                      列出 scope 与审计日志",
    "  --show <名字>               打印 scope 定义",
    "  --scope <名字>              只跑某个命名 scope（不动会话）",
    "  --use-session               跑全部 active 的 scope，按 scope 分组并给重叠矩阵",
    "",
    "spec 语法：",
    "  选择器：window=command:3;core=3-7;service=17;op=svc;pid=4;stop-op=core;since=…;until=…",
    "  任务域：task=<pid|shell|init>;relation=self|descendants[;window=…]",
    "  注意：execChain/serviceClosure 留给 image/module/device 步，这里不猜。",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    capture: null,
    window: { kind: "all" },
    core: null,
    op: null,
    stopOp: null,
    service: null,
    pid: null,
    since: null,
    until: null,
    span: null,
    parent: null,
    limit: 200,
    json: false,
    legend: false,
    outFile: null,
    session: "ztrace-scope-session.json",
    define: [],
    activate: [],
    deactivate: [],
    drop: [],
    list: false,
    show: null,
    useSession: false,
    scope: null,
    help: false,
  };
  const values = new Set(["--capture", "--window", "--core", "--op", "--stop-op", "--service", "--pid", "--since", "--until", "--span", "--parent", "--limit", "--out-file", "--session", "--define", "--activate", "--deactivate", "--drop", "--show", "--scope"]);
  const lists = { core: [], op: [], stopOp: [], service: [], pid: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index] ?? "";
    const equal = raw.indexOf("=");
    const flag = equal >= 0 ? raw.slice(0, equal) : raw;
    if (flag === "--help") {
      options.help = true;
      continue;
    }
    if (flag === "--json") {
      options.json = true;
      continue;
    }
    if (flag === "--legend") {
      options.legend = true;
      continue;
    }
    if (flag === "--list") {
      options.list = true;
      continue;
    }
    if (flag === "--use-session") {
      options.useSession = true;
      continue;
    }
    if (!values.has(flag)) throw new Error(`未知参数 ${raw}`);
    let value;
    if (equal >= 0) {
      value = raw.slice(equal + 1);
    } else {
      value = argv[index + 1];
      if (value === undefined) throw new Error(`${flag} 缺少值`);
      index += 1;
    }
    if (flag === "--capture") options.capture = value;
    else if (flag === "--window") {
      if (value === "boot") options.window = { kind: "boot" };
      else if (value === "command") options.window = { kind: "command" };
      else if (value === "all") options.window = { kind: "all" };
      else if (/^command:(\d+)$/.test(value)) options.window = { kind: "by-index", index: Number(/^command:(\d+)$/.exec(value)[1]) };
      else if (/^command:(.+)$/.test(value)) options.window = { kind: "by-text", text: /^command:(.+)$/.exec(value)[1] };
      else throw new Error(`--window 不合法：${value}`);
    } else if (flag === "--core") lists.core.push(value);
    else if (flag === "--op") lists.op.push(value);
    else if (flag === "--stop-op") lists.stopOp.push(value);
    else if (flag === "--service") lists.service.push(value);
    else if (flag === "--pid") lists.pid.push(value);
    else if (flag === "--since") options.since = Number(value);
    else if (flag === "--until") options.until = Number(value);
    else if (flag === "--span") options.span = Number(value);
    else if (flag === "--parent") options.parent = Number(value);
    else if (flag === "--session") options.session = value;
    else if (flag === "--define") options.define.push(value);
    else if (flag === "--activate") options.activate.push(value);
    else if (flag === "--deactivate") options.deactivate.push(value);
    else if (flag === "--drop") options.drop.push(value);
    else if (flag === "--show") options.show = value;
    else if (flag === "--scope") options.scope = value;
    else if (flag === "--out-file") options.outFile = value;
    else options.limit = Number(value);
  }
  if (lists.core.length > 0) options.core = parseNumberList(lists.core, "--core");
  if (lists.op.length > 0) options.op = parseOpList(lists.op);
  if (lists.stopOp.length > 0) {
    options.stopOp = [...new Set(lists.stopOp.flatMap((value) => String(value).split(",").map((part) => part.trim()).filter((part) => part.length > 0)))];
  }
  if (lists.service.length > 0) options.service = parseNumberList(lists.service, "--service");
  if (lists.pid.length > 0) options.pid = parseNumberList(lists.pid, "--pid");
  return options;
}

export function runScope(capture, options) {
  const { rows, windows } = flatten(capture);
  const schema = detectSchema(rows.map((row) => row.entry));
  if (schema.kind === "legacy" && (options.span !== null || options.parent !== null)) {
    throw new Error(`这个 capture 是 legacy 记录（${schema.detail}），没有 Span/Parent 字段；--span/--parent 不可用`);
  }

  /* --window command:<文本> 先解析成下标列表。 */
  let windowSpec = options.window;
  if (windowSpec.kind === "by-text") {
    const matches = capture.commands
      .map((command, index) => ({ command: command.command, index }))
      .filter((item) => String(item.command).includes(windowSpec.text));
    if (matches.length === 0) throw new Error(`--window 找不到命令：${windowSpec.text}`);
    if (matches.length > 1) throw new Error(`--window 命令不唯一：${matches.map((item) => `#${item.index + 1} ${item.command}`).join(" | ")}`);
    windowSpec = { kind: "by-index", index: matches[0].index + 1 };
  }

  const filters = {
    window: windowSpec,
    core: options.core,
    op: options.op,
    stopOp: options.stopOp ?? null,
    service: options.service,
    pid: options.pid,
    since: options.since,
    until: options.until,
    span: options.span,
    parent: options.parent,
  };
  const { included, excluded } = selectEntries(rows, filters, schema);
  const stopFaultRows = flattenStopsFaults(capture);
  const stopFault = selectStopsFaults(stopFaultRows, filters, schema);
  const svcPairs = analyzeSvcPairs(rows, filters, capture);
  return { rows, windows, schema, filters, included, excluded, stopFaultRows, stopFault, svcPairs };
}

function rowJson(item) {
  if (item.entry !== undefined && item.cls === undefined) return describeEntry(item);
  const base = describeEntry(item.row);
  return { ...base, Membership: item.cls?.match ?? null, MemberPid: item.cls?.pid ?? null };
}

function printNamedScopeJson(result) {
  return {
    name: result.name,
    kind: result.kind,
    def: result.def,
    root: result.root ?? null,
    members: result.members ?? null,
    warnings: result.warnings,
    counts: result.counts,
    unassignedPids: result.unassignedPids ?? null,
    rows: result.rows.slice(0, 50).map(rowJson),
    stops: result.stops.map((row) => row.item),
    faults: result.faults.map((row) => row.item),
    svcPairs: result.svcPairs,
  };
}

function printNamedScopeText(result, limit) {
  const lines = [];
  if (result.kind === "selector") {
    lines.push(`=== scope: ${result.name}（selector）===`);
    const filterText = Object.entries(result.filters)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join("  ");
    lines.push(`过滤: ${filterText.length > 0 ? filterText : "（无）"}`);
    lines.push(`计数: 总 ${result.counts.total} 条；命中 ${result.counts.included} 条；排除 ${result.counts.excludedTotal} 条`);
    const excluded = Object.entries(result.counts.excluded).filter(([, value]) => value > 0);
    if (excluded.length > 0) lines.push(`排除明细: ${excluded.map(([key, value]) => `${key}=${value}`).join("  ")}`);
    lines.push(printRows(result.rows, limit, false));
    lines.push(`停机 ${result.stops.length} 条，故障 ${result.faults.length} 条`);
    lines.push(`svc 配对: 已配对 ${result.svcPairs.paired.length}，未回复 ${result.svcPairs.unreplied.length}`);
    for (const item of result.svcPairs.unreplied.slice(0, limit)) {
      lines.push(`  未回复 core=${item.core} service=${item.service} span=${item.span} 判读：${item.verdict}`);
    }
    return lines.join("\n");
  }
  lines.push(`=== scope: ${result.name}（task ${result.root.pid} ${result.def.relation}）===`);
  lines.push(`root: pid=${result.root.pid}（${result.root.note}）`);
  lines.push(`成员 ${result.members.length} 个（动态成员来自 task-exit/task-wait 边）：`);
  for (const member of result.members) {
    const exit = member.exit === null ? "" : ` exit@${member.exit.at} code=${member.exit.code}`;
    lines.push(`  pid=${member.pid} parent=${member.parent ?? "未知"} 来源=${member.source} 驻留核心=[${member.cores.join(",")}]${exit}`);
  }
  for (const warning of result.warnings) lines.push(`警告: ${warning}`);
  if (result.unassignedPids !== undefined && result.unassignedPids.length > 0) {
    lines.push(`未归入成员的 pid（可能是缺 task-exit 边的后代，或无关任务）：${result.unassignedPids.join(",")}`);
  }
  lines.push(`记录: direct ${result.counts.direct} 条（自带任务身份）；core-attributed ${result.counts.coreAttributed} 条（只按核心驻留，近似）；排除 ${result.counts.excluded + result.counts.window} 条`);
  lines.push("样例（direct 优先）：");
  const directRows = result.rows.filter((item) => item.cls.match === "direct");
  const coreRows = result.rows.filter((item) => item.cls.match === "core-attributed");
  for (const item of directRows.slice(0, Math.ceil(limit / 2))) {
    const row = rowJson(item);
    lines.push(`  [direct pid=${item.cls.pid}] ${row.At} ${row.Window} core=${row.Core} ${row.OpName} A0=${row.A0} A1=${row.A1}`);
  }
  for (const item of coreRows.slice(0, Math.floor(limit / 2))) {
    const row = rowJson(item);
    lines.push(`  [core-attributed pid=${item.cls.pid}] ${row.At} ${row.Window} core=${row.Core} ${row.OpName} A0=${row.A0} A1=${row.A1}`);
  }
  lines.push(`svc 配对: 已配对 ${result.svcPairs.paired.length}，未回复 ${result.svcPairs.unreplied.length}（每条标注成员归属）`);
  for (const item of result.svcPairs.unreplied.slice(0, limit)) {
    lines.push(`  未回复 core=${item.core} service=${item.service} span=${item.span} 归属=${item.membership} 判读：${item.verdict}`);
  }
  return lines.join("\n");
}

/** 文本报告写出：--out-file 时写 UTF-8 + BOM（Windows 查看器不乱码），否则打到标准输出。 */
function emitReport(options, text) {
  if (options.outFile !== null) {
    fs.writeFileSync(options.outFile, `\uFEFF${text}`);
    process.stdout.write(`报告已写入 ${options.outFile}（UTF-8 + BOM）\n`);
    return;
  }
  process.stdout.write(text);
}

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${usage()}\n`);
    return 2;
  }
  if (options.legend === true) {
    process.stdout.write(`${printLegend()}\n`);
    return 0;
  }
  const sessionOps = options.list === true || options.show !== null
    || options.define.length > 0 || options.activate.length > 0
    || options.deactivate.length > 0 || options.drop.length > 0;
  if (sessionOps === true) {
    try {
      const session = loadSession(options.session);
      for (const spec of options.define) {
        const equal = spec.indexOf("=");
        if (equal <= 0) throw new Error(`--define 要 name=spec：${spec}`);
        defineScope(session, spec.slice(0, equal), spec.slice(equal + 1));
      }
      for (const name of options.activate) setActive(session, name, true);
      for (const name of options.deactivate) setActive(session, name, false);
      for (const name of options.drop) dropScope(session, name);
      saveSession(options.session, session);
      if (options.show !== null) {
        const def = session.scopes[options.show];
        if (def === undefined) {
          process.stderr.write(`scope 不存在：${options.show}\n`);
          return 2;
        }
        process.stdout.write(`${options.show}: ${JSON.stringify(def, null, 2)}\n`);
        return 0;
      }
      const lines = [`scope 会话：${options.session}`, `active: ${session.active.length > 0 ? session.active.join(", ") : "（无）"}`];
      for (const [name, def] of Object.entries(session.scopes)) {
        const shape = def.kind === "task"
          ? `task=${def.task};relation=${def.relation}${def.window !== undefined ? `;window=${JSON.stringify(def.window)}` : ""}`
          : `selector ${JSON.stringify(def.selector)}`;
        lines.push(`  ${session.active.includes(name) ? "*" : " "} ${name}  ${shape}`);
      }
      if (session.log.length > 0) {
        lines.push("最近操作（审计）：");
        for (const item of session.log.slice(-8)) {
          lines.push(`  ${item.at} ${item.action} ${item.name}${item.note ? `  ${item.note}` : ""}`);
        }
      }
      process.stdout.write(`${lines.join("\n")}\n`);
      return 0;
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
  }
  if (options.capture === null || options.help === true) {
    process.stdout.write(`${usage()}\n`);
    return options.capture === null && options.help !== true ? 2 : 0;
  }

  let capture;
  try {
    capture = loadCapture(options.capture);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 3;
  }

  if (options.scope !== null || options.useSession === true) {
    try {
      const session = loadSession(options.session);
      const names = options.scope !== null ? [options.scope] : session.active;
      if (names.length === 0) throw new Error("没有激活的 scope；用 --activate 或 --scope <名字>");
      const flat = flatten(capture);
      const schema = detectSchema(flat.rows.map((row) => row.entry));
      const ctx = {
        rows: flat.rows,
        windows: flat.windows,
        schema,
        indexOf: new Map(flat.rows.map((row, index) => [row, index])),
      };
      const results = [];
      for (const name of names) {
        const def = session.scopes[name];
        if (def === undefined) throw new Error(`scope 不存在：${name}`);
        results.push(runNamedScope(capture, name, def, ctx));
      }
      const overlap = overlapMatrix(results);
      if (options.json === true) {
        process.stdout.write(`${JSON.stringify({ capture: options.capture, session: options.session, scopes: results.map(printNamedScopeJson), overlap }, null, 2)}\n`);
        return 0;
      }
      const lines = [`capture: ${options.capture}`, `schema:  ${schema.kind}（${schema.detail}）`, `scope 会话：${options.session}（active: ${names.join(", ")}）`, ""];
      for (const result of results) lines.push(printNamedScopeText(result, options.limit), "");
      if (overlap.length > 0) {
        lines.push("scope 重叠（同一行被多个 scope 命中）：");
        for (const item of overlap) lines.push(`  ${item.left} ∩ ${item.right} = ${item.shared}`);
      }
      emitReport(options, `${lines.join("\n")}\n`);
      return 0;
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
  }

  let result;
  try {
    result = runScope(capture, options);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 2;
  }

  const { rows, windows, schema, filters, included, excluded, stopFaultRows, stopFault, svcPairs } = result;
  const excludedTotal = Object.values(excluded).reduce((sum, value) => sum + value, 0);
  const stopRows = stopFault.included.filter((row) => row.kind === "stop");
  const faultRows = stopFault.included.filter((row) => row.kind === "fault");

  if (options.json === true) {
    process.stdout.write(`${JSON.stringify({
      capture: options.capture,
      schema,
      windows,
      filters: {
        window: filters.window,
        core: filters.core,
        op: filters.op,
        stopOp: filters.stopOp,
        service: filters.service,
        pid: filters.pid,
        since: filters.since,
        until: filters.until,
        span: filters.span,
        parent: filters.parent,
      },
      counts: {
        total: rows.length,
        included: included.length,
        excluded,
        excludedTotal,
        stops: stopRows.length,
        faults: faultRows.length,
        stopsFaultsExcluded: stopFault.excluded,
      },
      rows: included.slice(0, options.limit).map(describeEntry),
      stops: stopRows.slice(0, options.limit).map((row) => ({ ...row.item, Window: row.window, Command: row.command })),
      faults: faultRows.slice(0, options.limit).map((row) => ({ ...row.item, Window: row.window, Command: row.command })),
      svcPairs,
    }, null, 2)}\n`);
    return 0;
  }

  const lines = [];
  lines.push(`capture: ${options.capture}`);
  lines.push(`schema:  ${schema.kind}（${schema.detail}）`);
  lines.push(`窗口:    ${windows.map((item) => `${item.label}=${item.entries}条`).join("  ")}`);
  const filterText = [];
  if (filters.window.kind !== "all") filterText.push(`window=${filters.window.kind}${filters.window.index ? `:${filters.window.index}` : ""}`);
  if (filters.core !== null) filterText.push(`core=[${filters.core.join(",")}]`);
  if (filters.op !== null) filterText.push(`op=[${filters.op.map(opName).join(",")}]`);
  if (filters.stopOp !== null) filterText.push(`stop-op=[${filters.stopOp.join(",")}]`);
  if (filters.service !== null) filterText.push(`service=[${filters.service.join(",")}]`);
  if (filters.pid !== null) filterText.push(`pid=[${filters.pid.join(",")}]`);
  if (filters.since !== null) filterText.push(`since=${filters.since}`);
  if (filters.until !== null) filterText.push(`until=${filters.until}`);
  if (filters.span !== null) filterText.push(`span=${filters.span}`);
  if (filters.parent !== null) filterText.push(`parent=${filters.parent}`);
  lines.push(`过滤:    ${filterText.length > 0 ? filterText.join("  ") : "（无）"}`);
  lines.push(`计数:    总 ${rows.length} 条；命中 ${included.length} 条；排除 ${excludedTotal} 条`);
  lines.push(`排除明细: ${Object.entries(excluded).filter(([, value]) => value > 0).map(([key, value]) => `${key}=${value}`).join("  ") || "无"}`);
  if (filters.pid !== null && excluded.notPidAttributable > 0) {
    lines.push(`注意:    ${excluded.notPidAttributable} 条记录只有 Core 没有 pid（svc/exec/insn 等），不能按 pid 归属，已排除而不是猜测。`);
  }
  lines.push("");
  lines.push(printRows(included, options.limit, false));
  if (included.length > options.limit) {
    lines.push(`… 还有 ${included.length - options.limit} 条未显示（用 --limit 调整）`);
  }
  if (stopRows.length > 0 || faultRows.length > 0 || stopFault.included.length > 0) {
    lines.push("");
    lines.push(`停机点（stops）：${stopRows.length} 条`);
    for (const row of stopRows.slice(0, options.limit)) {
      const item = row.item;
      lines.push(`  At=${item.At} ${row.window} core=${item.Core} reason=${item.Reason} index=${item.Index} op=${item.Op}${item.Detail ? ` detail=${item.Detail}` : ""}`);
    }
    lines.push(`故障（faults）：${faultRows.length} 条`);
    for (const row of faultRows.slice(0, options.limit)) {
      const item = row.item;
      lines.push(`  At=${item.At} ${row.window} core=${item.Core} op=${item.Op} text=${String(item.Text ?? "").slice(0, 120)}`);
    }
    const stopFaultExcluded = Object.entries(stopFault.excluded).filter(([, value]) => value > 0);
    if (stopFaultExcluded.length > 0) {
      lines.push(`停机/故障排除明细: ${stopFaultExcluded.map(([key, value]) => `${key}=${value}`).join("  ")}`);
    }
  }
  lines.push("");
  lines.push(`svc 配对（按窗口+核心+时间；不受 --op/--service/--pid 影响，防止把回复滤掉后误判挂死）`);
  lines.push(`  已配对 ${svcPairs.paired.length} 条；未回复 ${svcPairs.unreplied.length} 条`);
  for (const item of svcPairs.unreplied.slice(0, options.limit)) {
    lines.push(`  未回复 core=${item.core} service=${item.service} span=${item.span} at=${item.at}`);
    if (item.byDesign) {
      lines.push(`      按设计无回复：${item.verdict}`);
      continue;
    }
    const switchNote = item.ambiguous
      ? "有同核任务切换证据（svcSpans 按核记账会串号/漏闭合）"
      : "没有同核任务切换证据";
    lines.push(`      ${switchNote}；判读：${item.verdict}`);
    for (const evidence of item.evidence) {
      lines.push(`      证据 At=${evidence.At} op=${evidence.Op} A0=${evidence.A0} span=${evidence.Span}`);
    }
  }
  if (svcPairs.paired.length > 0) {
    const slow = svcPairs.paired
      .map((item) => ({ ...item, dur: item.replyAt - item.at }))
      .sort((left, right) => right.dur - left.dur)
      .slice(0, 5);
    lines.push(`  已配对最慢 5 条：${slow.map((item) => `core=${item.core} service=${item.service} span=${item.span} ${(item.dur / 1000).toFixed(1)}ms`).join("  ")}`);
  }
  emitReport(options, `${lines.join("\n")}\n`);
  return 0;
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  process.exit(main(process.argv.slice(2)));
}
