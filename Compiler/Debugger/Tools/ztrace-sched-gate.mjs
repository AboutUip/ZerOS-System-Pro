/**
 * 调度门禁。
 *
 * 全命令语料只看提示符和退出码。它发现不了这两件事：
 * 开机后的第二条外部命令，以及同核再派生之后的下一次调用。
 * 这两种都会让客核心停在 svc 里，监督核随后不再取调用，轨迹里只剩固件。
 *
 * 用法：
 *   node Compiler/Debugger/Tools/ztrace-sched-gate.mjs --capture <capture.json>
 *   node Compiler/Debugger/Tools/ztrace-sched-gate.mjs --suite --out dev/Debug/ztrace-sched-suite
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../../..");
const ZTRACE_PATH = path.join(SCRIPT_DIR, "ztrace.mjs");
const SVC = 1;
const SVC_REPLY = 2;
const DISPATCH = 13;
const QUIET_TAIL = 40;

/** 开机后立刻连着跑。54 条语料里 pwd 不在第二条，xargs 也不挨着第一条。 */
const SUITE = [
  { name: "echo", command: "echo ok", exit: 0 },
  { name: "pwd", command: "pwd", exit: 0 },
  { name: "xargs", command: "xargs echo < /home/test.txt", exit: 0 },
  { name: "yes", command: "yes --help", exit: 1 },
];

class CliError extends Error {}

function usage() {
  return [
    "ZerOS 调度门禁",
    "",
    "用法：",
    "  node Compiler/Debugger/Tools/ztrace-sched-gate.mjs --capture <capture.json>",
    "  node Compiler/Debugger/Tools/ztrace-sched-gate.mjs --suite --out <dir>",
    "",
    "判定：客核心的系统调用还没有回复，之后的记录里监督核不再出现，只剩固件。",
    "套件固定为 echo、紧接着的 pwd、xargs 重定向、yes --help。",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    capture: null,
    suite: false,
    out: path.resolve(process.cwd(), "ztrace-sched-suite"),
    url: "http://localhost:5173/",
    timeoutMs: 20000,
    keyDelay: 80,
    help: false,
  };
  const valueFlags = new Set(["--capture", "--out", "--url", "--timeout", "--key-delay"]);
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index] ?? "";
    const equal = raw.indexOf("=");
    const flag = equal >= 0 ? raw.slice(0, equal) : raw;
    if (flag === "--help") {
      options.help = true;
      continue;
    }
    if (flag === "--suite") {
      options.suite = true;
      continue;
    }
    if (!valueFlags.has(flag)) {
      throw new CliError(`未知参数 ${JSON.stringify(raw)}`);
    }
    let value;
    if (equal >= 0) {
      value = raw.slice(equal + 1);
    } else {
      value = argv[index + 1];
      if (value === undefined) throw new CliError(`${flag} 缺少值`);
      index += 1;
    }
    if (flag === "--capture") options.capture = path.resolve(process.cwd(), value);
    else if (flag === "--out") options.out = path.resolve(process.cwd(), value);
    else if (flag === "--url") options.url = value;
    else if (flag === "--timeout") options.timeoutMs = Number(value);
    else options.keyDelay = Number(value);
  }
  if (!options.help && !options.suite && options.capture === null) {
    throw new CliError("需要 --capture 或 --suite");
  }
  return options;
}

function readCapture(file) {
  const capture = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(capture?.commands)) {
    throw new CliError("capture.json 的 commands 不是数组");
  }
  return capture;
}

function lastSupervisor(entries) {
  let index = -1;
  for (let cursor = 0; cursor < entries.length; cursor += 1) {
    if (entries[cursor]?.Core === 2) index = cursor;
  }
  return index;
}

/** 监督核已经从记录里消失，后面只剩固件在采样。 */
function supervisorQuiet(entries) {
  const last = lastSupervisor(entries);
  const tail = entries.slice(last + 1);
  if (tail.length < QUIET_TAIL) return false;
  let firmware = 0;
  for (const entry of tail) {
    const core = entry?.Core;
    if (core !== 0 && core !== -1) return false;
    if (core === 0) firmware += 1;
  }
  return firmware >= QUIET_TAIL;
}

function unrepliedUserSvc(entries, until) {
  const open = [];
  const limit = until < 0 ? entries.length : until;
  for (let index = 0; index < limit; index += 1) {
    const entry = entries[index];
    if (entry === null || typeof entry !== "object") continue;
    const core = entry.Core;
    if (typeof core !== "number" || core < 3 || core > 7) continue;
    if (entry.Op === SVC) {
      open.push({ core, service: entry.A0, at: entry.At });
      continue;
    }
    if (entry.Op !== SVC_REPLY) continue;
    for (let slot = 0; slot < open.length; slot += 1) {
      if (open[slot].core === core && open[slot].service === entry.A0) {
        open.splice(slot, 1);
        break;
      }
    }
  }
  return open;
}

function commandFailed(record) {
  const error = typeof record?.error === "string" ? record.error : "";
  const prompts = record?.status !== null && typeof record?.status === "object" ? Number(record.status.Prompts) : 0;
  return error.length > 0 || !(prompts >= 1);
}

/** 失败的命令里，客调用已经交出，但之后既没有分发也没有回复。监督核还在采样时也能看出来。 */
function neverTaken(entries) {
  const waiting = [];
  const pending = [];
  for (const entry of entries) {
    if (entry === null || typeof entry !== "object") continue;
    const core = entry.Core;
    if (typeof core !== "number" || core < 3 || core > 7) continue;
    if (entry.Op === SVC) {
      pending.push({ core, service: entry.A0, at: entry.At });
      continue;
    }
    if (entry.Op !== SVC_REPLY && entry.Op !== DISPATCH) continue;
    for (let slot = 0; slot < pending.length; slot += 1) {
      if (pending[slot].core === core && pending[slot].service === entry.A0) {
        if (entry.Op === SVC_REPLY) pending.splice(slot, 1);
        else pending.splice(slot, 1);
        break;
      }
    }
  }
  for (const call of pending) {
    waiting.push(`core ${call.core} svc ${call.service} was never dispatched`);
  }
  return waiting;
}

/**
 * 一条命令是否把调用晾在监督核外面。
 * 提示符已经回来、监督核仍在采样时不判失败：下一次读键盘本来就会停在 svc 上。
 * 命令没回来时，调用交出后既没有分发也没有回复，同样算晾住。
 */
export function abandonedSyscall(record) {
  const entries = Array.isArray(record?.entries) ? record.entries : [];
  if (supervisorQuiet(entries)) {
    const open = unrepliedUserSvc(entries, lastSupervisor(entries));
    if (open.length > 0) {
      return open.map((call) => `core ${call.core} svc ${call.service} has no reply`);
    }
    const stops = Array.isArray(record?.stops) ? record.stops : [];
    const firstAt = entries.length > 0 && typeof entries[0]?.At === "number" ? entries[0].At : 0;
    const waiting = stops.filter((stop) => stop?.Reason === 2 && stop?.Op === "svc" && stop?.Core >= 3 && stop?.Core <= 7 && !(typeof stop.At === "number" && stop.At < firstAt));
    if (waiting.length > 0) {
      return waiting.map((stop) => `core ${stop.Core} still in svc at ${stop.Index}`);
    }
  }
  if (!commandFailed(record)) return null;
  const missed = neverTaken(entries);
  if (missed.length > 0) return missed;
  /* 环把调用本身冲掉时，停机快照还在。失败命令上，这次停机之后没有分发也没有回复。 */
  const stops = Array.isArray(record?.stops) ? record.stops : [];
  const firstAt = entries.length > 0 && typeof entries[0]?.At === "number" ? entries[0].At : 0;
  const parked = [];
  for (const stop of stops) {
    if (typeof stop?.At === "number" && stop.At < firstAt) continue;
    if (stop?.Reason !== 2 || stop?.Op !== "svc" || stop?.Core < 3 || stop?.Core > 7) continue;
    const taken = entries.some((entry) => entry?.Core === stop.Core
      && entry.At >= stop.At
      && (entry.Op === DISPATCH || entry.Op === SVC_REPLY));
    if (!taken) parked.push(`core ${stop.Core} svc at ${stop.Index} was never dispatched`);
  }
  return parked.length > 0 ? parked : null;
}

export function gateCapture(capture) {
  const findings = [];
  for (const record of capture.commands) {
    if (record === null || typeof record !== "object") continue;
    const reason = abandonedSyscall(record);
    if (reason === null) continue;
    findings.push({
      command: typeof record.command === "string" ? record.command : "",
      reason,
    });
  }
  return findings;
}

function writeFindings(findings) {
  if (findings.length < 1) {
    process.stdout.write("sched-gate: ok\n");
    return;
  }
  process.stdout.write(`sched-gate: ${String(findings.length)} abandoned\n`);
  for (const finding of findings) {
    process.stdout.write(`FAIL ${finding.command}\n`);
    for (const line of finding.reason) {
      process.stdout.write(`  ${line}\n`);
    }
  }
}

function runSuite(options) {
  return new Promise((resolve, reject) => {
    const args = [
      ZTRACE_PATH,
      "--out", options.out,
      "--url", options.url,
      "--timeout", String(options.timeoutMs),
      "--key-delay", String(options.keyDelay),
      "--keep-going",
    ];
    for (const item of SUITE) args.push("--command", item.command);
    fs.mkdirSync(options.out, { recursive: true });
    const child = spawn(process.execPath, args, { cwd: REPO_ROOT, windowsHide: true, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

function suiteExitMismatch(capture) {
  const lines = [];
  for (const item of SUITE) {
    const record = capture.commands.find((command) => command?.command === item.command);
    if (record === undefined) {
      lines.push(`${item.name} missing from capture`);
      continue;
    }
    if (typeof record.error === "string" && record.error.length > 0) {
      lines.push(`${item.name} ${record.error}`);
    }
    if (record.exitCode !== item.exit) {
      lines.push(`${item.name} exit ${record.exitCode === undefined ? "?" : String(record.exitCode)}/${String(item.exit)}`);
    }
  }
  return lines;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`ztrace-sched-gate: ${error instanceof Error ? error.message : String(error)}\n\n${usage()}\n`);
    return 2;
  }
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  if (options.suite) {
    await runSuite(options);
    options.capture = path.join(options.out, "capture.json");
  }
  const capture = readCapture(options.capture);
  const findings = gateCapture(capture);
  writeFindings(findings);
  if (options.suite) {
    const mismatch = suiteExitMismatch(capture);
    for (const line of mismatch) process.stdout.write(`FAIL ${line}\n`);
    if (mismatch.length > 0 || findings.length > 0) return 1;
    return 0;
  }
  return findings.length > 0 ? 1 : 0;
}

const invoked = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`ztrace-sched-gate: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
