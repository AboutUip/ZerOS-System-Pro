/**
 * 跑 v1 全命令语料。
 *
 * 用法：
 *   node Documents/Debug/Tools/ztrace-corpus.mjs --out dev/Debug/ztrace-corpus
 *
 * 一份语料只验证命令能回到提示符，不比较标准输出文本。
 * 采集仍由 ztrace.mjs 完成；本脚本只负责清单覆盖校验、进程级硬超时和结果汇总。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../../..");
const CORPUS_PATH = path.join(SCRIPT_DIR, "ztrace-corpus.json");
const ZTRACE_PATH = path.join(SCRIPT_DIR, "ztrace.mjs");
const BIN_DIR = path.join(REPO_ROOT, "ZerOS-PRO", "Resource", "Bin");
const CORPUS_SCHEMA = "zeros.ztrace.corpus/1";
const RESULT_SCHEMA = "zeros.ztrace.corpus-result/1";
const EXPECTED_COMMANDS = 54;

class CliError extends Error {}

function usage() {
  return [
    "ZerOS 全命令语料",
    "",
    "用法：",
    "  node Documents/Debug/Tools/ztrace-corpus.mjs [选项]",
    "",
    "选项：",
    "  --out <dir>           输出目录，默认 ./ztrace-corpus",
    "  --url <url>           预览地址，默认 http://localhost:5173/",
    "  --timeout <ms>        每条命令的硬超时，默认 45000",
    "  --total-timeout <ms>  整个语料进程的硬超时，默认按条数推算",
    "  --key-delay <ms>      每个字符的按键间隔，默认 120；低于 100 容易丢回车",
    "  --chrome <path>       浏览器可执行文件；省略时由 ztrace 自动查找",
    "  --only <name,...>     只跑指定命令，用于定位；结果会标 incomplete",
    "  --list                只列出语料，不启动浏览器",
    "  --help                显示本说明",
    "",
    "输出：capture.json、report.txt、capture.log、corpus-summary.json、corpus-summary.txt",
  ].join("\n");
}

function parseInteger(value, flag, min) {
  if (!/^\d+$/.test(value)) {
    throw new CliError(`${flag} 需要非负整数，收到 ${JSON.stringify(value)}`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min) {
    throw new CliError(`${flag} 超出范围，收到 ${JSON.stringify(value)}`);
  }
  return number;
}

function parseArgs(argv) {
  const options = {
    out: path.resolve(process.cwd(), "ztrace-corpus"),
    url: "http://localhost:5173/",
    timeoutMs: 45000,
    totalTimeoutMs: 0,
    keyDelay: 120,
    chrome: null,
    only: [],
    list: false,
    help: false,
  };
  const valueFlags = new Set(["--out", "--url", "--timeout", "--total-timeout", "--key-delay", "--chrome", "--only"]);
  const noValueFlags = new Set(["--list", "--help"]);
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index] ?? "";
    const equal = raw.indexOf("=");
    const flag = equal >= 0 ? raw.slice(0, equal) : raw;
    if (!valueFlags.has(flag) && !noValueFlags.has(flag)) {
      throw new CliError(`未知参数 ${JSON.stringify(raw)}`);
    }
    if (noValueFlags.has(flag)) {
      if (equal >= 0) throw new CliError(`${flag} 不接受值`);
      if (flag === "--list") options.list = true;
      else options.help = true;
      continue;
    }
    let value;
    if (equal >= 0) {
      value = raw.slice(equal + 1);
    } else {
      value = argv[index + 1];
      if (value === undefined) throw new CliError(`${flag} 缺少值`);
      index += 1;
    }
    if (flag === "--out") {
      if (value.length < 1) throw new CliError("--out 不能为空");
      options.out = path.resolve(process.cwd(), value);
    } else if (flag === "--url") {
      options.url = value;
    } else if (flag === "--timeout") {
      options.timeoutMs = parseInteger(value, "--timeout", 1);
    } else if (flag === "--total-timeout") {
      options.totalTimeoutMs = parseInteger(value, "--total-timeout", 1);
    } else if (flag === "--key-delay") {
      options.keyDelay = parseInteger(value, "--key-delay", 0);
    } else if (flag === "--chrome") {
      options.chrome = value;
    } else if (flag === "--only") {
      options.only = value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
    }
  }
  if (options.totalTimeoutMs === 0) {
    options.totalTimeoutMs = options.timeoutMs * EXPECTED_COMMANDS + 120000;
  }
  return options;
}

function readCorpus() {
  let corpus;
  try {
    corpus = JSON.parse(fs.readFileSync(CORPUS_PATH, "utf8"));
  } catch (error) {
    throw new CliError(`读取语料失败：${error instanceof Error ? error.message : String(error)}`);
  }
  if (corpus?.schema !== CORPUS_SCHEMA) {
    throw new CliError(`语料 schema 不是 ${CORPUS_SCHEMA}`);
  }
  if (!Array.isArray(corpus.commands)) {
    throw new CliError("语料 commands 不是数组");
  }
  const seen = new Set();
  for (let index = 0; index < corpus.commands.length; index += 1) {
    const item = corpus.commands[index];
    if (item === null || typeof item !== "object") {
      throw new CliError(`commands[${String(index)}] 不是对象`);
    }
    if (typeof item.name !== "string" || item.name.length < 1) {
      throw new CliError(`commands[${String(index)}].name 缺失`);
    }
    if (typeof item.command !== "string" || item.command.length < 1) {
      throw new CliError(`commands[${String(index)}].command 缺失`);
    }
    if (seen.has(item.name)) {
      throw new CliError(`语料里重复的命令名 ${JSON.stringify(item.name)}`);
    }
    seen.add(item.name);
  }
  return corpus;
}

function binNames() {
  if (!fs.existsSync(BIN_DIR)) {
    throw new CliError(`找不到命令目录 ${BIN_DIR}`);
  }
  return new Set(
    fs.readdirSync(BIN_DIR)
      .filter((name) => name.endsWith(".obr"))
      .map((name) => name.slice(0, -4))
      .filter((name) => name !== "arg"),
  );
}

function validateCoverage(corpus) {
  const expected = binNames();
  const actual = new Set(corpus.commands.map((item) => item.name));
  const missing = [...expected].filter((name) => !actual.has(name)).sort();
  const extra = [...actual].filter((name) => !expected.has(name)).sort();
  if (corpus.commands.length !== EXPECTED_COMMANDS) {
    throw new CliError(`语料应有 ${String(EXPECTED_COMMANDS)} 条，实际 ${String(corpus.commands.length)} 条`);
  }
  if (missing.length > 0 || extra.length > 0) {
    throw new CliError(`语料与 /bin 不一致；缺少 ${missing.join(", ") || "-"}；多出 ${extra.join(", ") || "-"}`);
  }
}

function selectCorpus(corpus, only) {
  if (only.length < 1) {
    return corpus.commands;
  }
  const wanted = new Set(only);
  const selected = corpus.commands.filter((item) => wanted.has(item.name));
  const unknown = only.filter((name) => !corpus.commands.some((item) => item.name === name));
  if (unknown.length > 0) {
    throw new CliError(`--only 里有未知命令 ${unknown.join(", ")}`);
  }
  return selected;
}

function buildZtraceArgs(options, commands) {
  const args = [
    ZTRACE_PATH,
    "--out", options.out,
    "--url", options.url,
    "--timeout", String(options.timeoutMs),
    "--key-delay", String(options.keyDelay),
    "--keep-going",
  ];
  if (options.chrome !== null) {
    args.push("--chrome", options.chrome);
  }
  for (const item of commands) {
    args.push("--command", item.command);
  }
  return args;
}

function runZtrace(options, commands) {
  return new Promise((resolve, reject) => {
    const args = buildZtraceArgs(options, commands);
    const child = spawn(process.execPath, args, {
      cwd: REPO_ROOT,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      try {
        child.kill();
      } catch {
        /* 已经退出 */
      }
    }, options.totalTimeoutMs);
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      process.stderr.write(text);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, killed, stdout, stderr });
    });
  });
}

function readCapture(outDir) {
  const file = path.join(outDir, "capture.json");
  let capture;
  try {
    capture = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new CliError(`读取 capture.json 失败：${error instanceof Error ? error.message : String(error)}`);
  }
  if (capture?.schema !== "zeros.ztrace.capture/1") {
    throw new CliError("capture.json 的 schema 不是 zeros.ztrace.capture/1");
  }
  if (!Array.isArray(capture.commands)) {
    throw new CliError("capture.json 的 commands 不是数组");
  }
  return capture;
}

function resultOf(item, record) {
  if (record === undefined) {
    return {
      name: item.name,
      command: item.command,
      passed: false,
      timeout: false,
      error: "capture 里没有这条命令",
      elapsedMs: 0,
      records: 0,
      stops: 0,
    };
  }
  const error = typeof record.error === "string" ? record.error : "";
  const timeout = /^timeout after \d+ms$/.test(error);
  const prompts = record.status !== null && typeof record.status === "object" ? Number(record.status.Prompts) : 0;
  const passed = error.length === 0
    && prompts >= 1
    && typeof record.report === "string"
    && record.report.length > 0
    && Array.isArray(record.entries)
    && Array.isArray(record.stops);
  return {
    name: item.name,
    command: item.command,
    passed,
    timeout,
    error,
    elapsedMs: Number.isFinite(record.elapsedMs) ? record.elapsedMs : 0,
    records: Array.isArray(record.entries) ? record.entries.length : 0,
    stops: Array.isArray(record.stops) ? record.stops.length : 0,
    prompts,
  };
}

function buildSummary(corpus, selected, capture, run, options) {
  const byCommand = new Map();
  for (const record of capture.commands) {
    if (record !== null && typeof record === "object" && typeof record.command === "string") {
      byCommand.set(record.command, record);
    }
  }
  const results = selected.map((item) => resultOf(item, byCommand.get(item.command)));
  const failed = results.filter((item) => !item.passed);
  const timeouts = results.filter((item) => item.timeout);
  return {
    schema: RESULT_SCHEMA,
    corpusSchema: corpus.schema,
    startedAt: new Date().toISOString(),
    complete: selected.length === corpus.commands.length,
    expected: corpus.commands.length,
    selected: selected.length,
    passed: results.length - failed.length,
    failed: failed.length,
    timeouts: timeouts.length,
    processExit: run.code,
    killedByWatchdog: run.killed,
    totalTimeoutMs: options.totalTimeoutMs,
    commandTimeoutMs: options.timeoutMs,
    capture: path.join(options.out, "capture.json"),
    results,
  };
}

function writeSummary(options, summary) {
  const jsonPath = path.join(options.out, "corpus-summary.json");
  const textPath = path.join(options.out, "corpus-summary.txt");
  fs.writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`);
  const lines = [];
  lines.push(`corpus: ${String(summary.passed)}/${String(summary.selected)} passed  failed=${String(summary.failed)}  timeouts=${String(summary.timeouts)}  complete=${String(summary.complete)}`);
  lines.push(`process: exit=${String(summary.processExit)}  watchdog=${String(summary.killedByWatchdog)}  commandTimeout=${String(summary.commandTimeoutMs)}ms  totalTimeout=${String(summary.totalTimeoutMs)}ms`);
  lines.push("");
  for (const item of summary.results) {
    const state = item.passed ? "ok  " : "FAIL";
    const tail = item.error.length > 0 ? `  ${item.error}` : "";
    lines.push(`${state} ${item.name.padEnd(10)} ${String(Math.round(item.elapsedMs)).padStart(7)}ms  records=${String(item.records)}  stops=${String(item.stops)}${tail}`);
  }
  lines.push("");
  fs.writeFileSync(textPath, `${lines.join("\n")}\n`);
  process.stdout.write(`${lines.join("\n")}\n`);
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`ztrace-corpus: ${error instanceof Error ? error.message : String(error)}\n\n${usage()}\n`);
    return 2;
  }
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  let corpus;
  let selected;
  try {
    corpus = readCorpus();
    validateCoverage(corpus);
    selected = selectCorpus(corpus, options.only);
  } catch (error) {
    process.stderr.write(`ztrace-corpus: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  if (options.list) {
    for (const item of selected) {
      process.stdout.write(`${item.name.padEnd(10)} ${item.command}\n`);
    }
    return 0;
  }
  try {
    fs.mkdirSync(options.out, { recursive: true });
  } catch (error) {
    process.stderr.write(`ztrace-corpus: 无法建立输出目录：${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  const run = await runZtrace(options, selected);
  let capture;
  try {
    capture = readCapture(options.out);
  } catch (error) {
    process.stderr.write(`ztrace-corpus: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  const summary = buildSummary(corpus, selected, capture, run, options);
  writeSummary(options, summary);
  return summary.failed === 0 && summary.complete && run.code === 0 && !run.killed ? 0 : 1;
}

main().then((code) => {
  process.exitCode = code;
}).catch((error) => {
  process.stderr.write(`ztrace-corpus: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
