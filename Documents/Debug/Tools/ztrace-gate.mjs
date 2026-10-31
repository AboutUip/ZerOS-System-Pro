/**
 * v1 trace 验收入口。
 *
 * 用法：
 *   node Documents/Debug/Tools/ztrace-gate.mjs --file dev/Debug/ztrace-acceptance/capture.json --require-features
 *   node Documents/Debug/Tools/ztrace-gate.mjs --file dev/Debug/ztrace-corpus/capture.json --require-corpus --baseline dev/Debug/ztrace-corpus-base/capture.json
 *
 * 只读 capture.json 和语料清单，不启动浏览器。
 * 结构校验复用 ztrace-check.mjs，结构对比复用 ztrace-diff.mjs。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../../..");
const CORPUS_PATH = path.join(SCRIPT_DIR, "ztrace-corpus.json");
const CHECK_PATH = path.join(SCRIPT_DIR, "ztrace-check.mjs");
const DIFF_PATH = path.join(SCRIPT_DIR, "ztrace-diff.mjs");
const CAPTURE_SCHEMA = "zeros.ztrace.capture/1";
const GATE_SCHEMA = "zeros.ztrace.gate/1";

class CliError extends Error {}

function usage() {
  return [
    "ZerOS trace v1 验收门禁",
    "",
    "用法：",
    "  node Documents/Debug/Tools/ztrace-gate.mjs --file <capture.json> [选项]",
    "",
    "选项：",
    "  --file <file>        要验收的 capture.json",
    "  --baseline <file>    结构对比基线；给出时调用 ztrace-diff --check",
    "  --require-features   要求报告里出现 v1 新增的内存、GPU、快照段落",
    "  --require-corpus     要求命令恰好覆盖 54 条语料且无超时",
    "  --out <file>         门禁结果 JSON；默认与 capture 同目录 gate.json",
    "  --help               显示本说明",
  ].join("\n");
}

function parseArgs(argv) {
  const options = { file: "", baseline: "", requireFeatures: false, requireCorpus: false, out: "", help: false };
  const valueFlags = new Set(["--file", "--baseline", "--out"]);
  const noValueFlags = new Set(["--require-features", "--require-corpus", "--help"]);
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index] ?? "";
    const equal = raw.indexOf("=");
    const flag = equal >= 0 ? raw.slice(0, equal) : raw;
    if (!valueFlags.has(flag) && !noValueFlags.has(flag)) {
      throw new CliError(`未知参数 ${JSON.stringify(raw)}`);
    }
    if (noValueFlags.has(flag)) {
      if (equal >= 0) throw new CliError(`${flag} 不接受值`);
      if (flag === "--require-features") options.requireFeatures = true;
      else if (flag === "--require-corpus") options.requireCorpus = true;
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
    if (flag === "--file") options.file = value;
    else if (flag === "--baseline") options.baseline = value;
    else options.out = value;
  }
  if (!options.help && options.file.length < 1) {
    throw new CliError("缺少 --file <capture.json>");
  }
  return options;
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new CliError(`${label} 读取失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

function allReports(capture) {
  const reports = [];
  if (capture?.boot !== null && typeof capture?.boot === "object" && typeof capture.boot.report === "string") {
    reports.push(capture.boot.report);
  }
  for (const item of capture.commands) {
    if (item !== null && typeof item === "object" && typeof item.report === "string") {
      reports.push(item.report);
    }
  }
  return reports;
}

function allStops(capture) {
  const stops = [];
  if (capture?.boot !== null && typeof capture?.boot === "object" && Array.isArray(capture.boot.stops)) {
    stops.push(...capture.boot.stops);
  }
  for (const item of capture.commands) {
    if (item !== null && typeof item === "object" && Array.isArray(item.stops)) {
      stops.push(...item.stops);
    }
  }
  return stops;
}

function check(name, passed, detail) {
  return { name, passed, detail };
}

function runNode(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout.trim() : "",
    stderr: typeof result.stderr === "string" ? result.stderr.trim() : "",
  };
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`ztrace-gate: ${error instanceof Error ? error.message : String(error)}\n\n${usage()}\n`);
    return 2;
  }
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const file = path.resolve(process.cwd(), options.file);
  let capture;
  try {
    capture = readJson(file, "capture");
  } catch (error) {
    process.stderr.write(`ztrace-gate: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  const checks = [];
  checks.push(check("schema", capture?.schema === CAPTURE_SCHEMA, String(capture?.schema ?? "missing")));
  checks.push(check("debug", capture?.debug === true, String(capture?.debug ?? "missing")));
  checks.push(check("stops-array", Array.isArray(capture?.boot?.stops), "boot.stops"));

  const commands = Array.isArray(capture.commands) ? capture.commands : [];
  const errors = commands.filter((item) => item !== null && typeof item === "object" && typeof item.error === "string");
  const timeouts = errors.filter((item) => /^timeout after \d+ms$/.test(item.error));
  checks.push(check("no-command-errors", errors.length === 0, `${String(errors.length)} error(s), ${String(timeouts.length)} timeout(s)`));

  const report = allReports(capture).join("\n");
  if (options.requireFeatures) {
    checks.push(check("memory-batches", /^memory batches: \d+/m.test(report), "memory batches"));
    checks.push(check("memory-by-service", /^\s{2}by service:$/m.test(report), "memory by service"));
    checks.push(check("memory-by-core", /^\s{2}core \d+  count=\d+/m.test(report), "memory by core"));
    checks.push(check("gpu-stages", /^gpu stages: presents=\d+/m.test(report), "gpu stages"));
    checks.push(check("gpu-phases", /^\s{2}phases:$/m.test(report) && /^\s{4}capture\s/m.test(report) && /^\s{4}compose\s/m.test(report) && /^\s{4}accel\s/m.test(report), "capture/compose/accel"));
    checks.push(check("latest-stops", /^latest stops:$/m.test(report), "latest stops"));
    const stops = allStops(capture);
    const snapshots = stops.filter((item) => item !== null && typeof item === "object" && item.Snapshot !== null && item.Snapshot !== undefined);
    checks.push(check("fault-snapshot", snapshots.length > 0, `${String(snapshots.length)} snapshot(s)`));
  }
  if (options.requireCorpus) {
    let corpus;
    try {
      corpus = readJson(CORPUS_PATH, "corpus");
    } catch (error) {
      process.stderr.write(`ztrace-gate: ${error instanceof Error ? error.message : String(error)}\n`);
      return 2;
    }
    const expected = new Set(corpus.commands.map((item) => item.command));
    const actual = new Set(commands.map((item) => (item !== null && typeof item === "object" ? item.command : undefined)));
    const missing = [...expected].filter((item) => !actual.has(item));
    checks.push(check("corpus-count", commands.length === corpus.commands.length, `${String(commands.length)}/${String(corpus.commands.length)}`));
    checks.push(check("corpus-coverage", missing.length === 0, missing.length === 0 ? "all commands present" : `missing=${missing.join(", ")}`));
  }

  const checkRun = runNode(CHECK_PATH, ["--file", file]);
  checks.push(check("ztrace-check", checkRun.status === 0, checkRun.status === 0 ? checkRun.stdout : (checkRun.stderr || checkRun.stdout)));

  if (options.baseline.length > 0) {
    const baseline = path.resolve(process.cwd(), options.baseline);
    const diffRun = runNode(DIFF_PATH, ["--base", baseline, "--head", file, "--check"]);
    checks.push(check("ztrace-diff", diffRun.status === 0, diffRun.status === 0 ? diffRun.stdout : (diffRun.stderr || diffRun.stdout)));
  }

  const failed = checks.filter((item) => !item.passed);
  const summary = {
    schema: GATE_SCHEMA,
    file,
    baseline: options.baseline.length > 0 ? path.resolve(process.cwd(), options.baseline) : "",
    startedAt: new Date().toISOString(),
    passed: failed.length === 0,
    checks,
  };
  const out = options.out.length > 0 ? path.resolve(process.cwd(), options.out) : path.join(path.dirname(file), "gate.json");
  fs.writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
  for (const item of checks) {
    process.stdout.write(`${item.passed ? "ok  " : "FAIL"} ${item.name.padEnd(20)} ${item.detail}\n`);
  }
  process.stdout.write(`${summary.passed ? "ztrace-gate ok" : "ztrace-gate failed"}: checks=${String(checks.length)} failed=${String(failed.length)} out=${out}\n`);
  return summary.passed ? 0 : 1;
}

process.exitCode = main();
