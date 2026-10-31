/**
 * 校验 ztrace capture.json 的最小结构。
 *
 * 用法：
 *   node Documents/Debug/Tools/ztrace-check.mjs --file dev/Debug/ztrace-test/capture.json
 *
 * 只检查结构和字段类型，不解释 trace 语义；语义由 TraceReport 负责。
 * 没有外部依赖，不修改输入文件。
 */
import fs from "node:fs";

function fail(message) {
  console.error(`ztrace-check: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  let file = "";
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index] ?? "";
    if (raw === "--file") {
      file = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (raw.startsWith("--file=")) {
      file = raw.slice("--file=".length);
      continue;
    }
    fail(`未知参数 ${JSON.stringify(raw)}`);
  }
  if (file.length < 1) {
    fail("缺少 --file <capture.json>");
  }
  return file;
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function checkStops(stops, label) {
  if (!Array.isArray(stops)) {
    fail(`${label} 不是数组`);
  }
  for (let index = 0; index < stops.length; index += 1) {
    const stop = stops[index];
    if (stop === null || typeof stop !== "object") {
      fail(`${label}[${String(index)}] 不是对象`);
    }
    for (const key of ["Core", "Reason", "Index"]) {
      if (!isNumber(stop[key])) {
        fail(`${label}[${String(index)}].${key} 不是数字`);
      }
    }
    for (const key of ["Op", "Detail"]) {
      if (typeof stop[key] !== "string") {
        fail(`${label}[${String(index)}].${key} 不是字符串`);
      }
    }
    if (stop.Snapshot === null) {
      continue;
    }
    const snapshot = stop.Snapshot;
    if (snapshot === undefined || typeof snapshot !== "object") {
      fail(`${label}[${String(index)}].Snapshot 不是对象或 null`);
    }
    if (!Array.isArray(snapshot.Registers) || snapshot.Registers.some((item) => typeof item !== "string")) {
      fail(`${label}[${String(index)}].Snapshot.Registers 不是字符串数组`);
    }
    for (const key of ["Pc", "StackPointer", "StackStart", "StackEnd"]) {
      if (typeof snapshot[key] !== "string") {
        fail(`${label}[${String(index)}].Snapshot.${key} 不是字符串`);
      }
    }
  }
}

function checkEntries(entries, label) {
  if (!Array.isArray(entries)) {
    fail(`${label} 不是数组`);
  }
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry === null || typeof entry !== "object") {
      fail(`${label}[${String(index)}] 不是对象`);
    }
    for (const key of ["Op", "Layer", "Core", "At", "A0", "A1", "Span", "Parent"]) {
      if (!isNumber(entry[key])) {
        fail(`${label}[${String(index)}].${key} 不是数字`);
      }
    }
  }
}

const file = parseArgs(process.argv.slice(2));
let capture;
try {
  capture = JSON.parse(fs.readFileSync(file, "utf8"));
} catch (error) {
  fail(`读取失败：${error instanceof Error ? error.message : String(error)}`);
}

if (capture?.schema !== "zeros.ztrace.capture/1") {
  fail("schema 不是 zeros.ztrace.capture/1");
}
if (capture.debug !== true) {
  fail("debug 不是 true");
}
if (typeof capture.url !== "string" || capture.url.length < 1) {
  fail("url 缺失");
}
if (typeof capture.startedAt !== "string" || capture.startedAt.length < 1) {
  fail("startedAt 缺失");
}
if (capture.git === undefined || capture.git === null || typeof capture.git.commit !== "string") {
  fail("git 元数据缺失");
}
if (capture.environment === undefined || capture.environment === null || typeof capture.environment.node !== "string") {
  fail("environment 元数据缺失");
}
if (capture.boot === undefined || capture.boot === null || typeof capture.boot.report !== "string") {
  fail("boot.report 缺失");
}
checkEntries(capture.boot.entries, "boot.entries");
if (!Array.isArray(capture.boot.faults)) {
  fail("boot.faults 不是数组");
}
checkStops(capture.boot.stops, "boot.stops");
if (!Array.isArray(capture.commands)) {
  fail("commands 不是数组");
}

const commands = capture.commands;
for (let index = 0; index < commands.length; index += 1) {
  const command = commands[index];
  if (command === null || typeof command !== "object") {
    fail(`commands[${String(index)}] 不是对象`);
  }
  if (typeof command.command !== "string") {
    fail(`commands[${String(index)}].command 缺失`);
  }
  if (!isNumber(command.elapsedMs)) {
    fail(`commands[${String(index)}].elapsedMs 不是数字`);
  }
  if (command.status === null || typeof command.status !== "object") {
    fail(`commands[${String(index)}].status 缺失`);
  }
  for (const key of ["Records", "Pending", "Dropped", "Prompts"]) {
    if (!isNumber(command.status[key])) {
      fail(`commands[${String(index)}].status.${key} 不是数字`);
    }
  }
  checkStops(command.stops, `commands[${String(index)}].stops`);
  if (command.error !== undefined) {
    if (typeof command.error !== "string") {
      fail(`commands[${String(index)}].error 不是字符串`);
    }
    continue;
  }
  if (!Array.isArray(command.faults)) {
    fail(`commands[${String(index)}].faults 不是数组`);
  }
  if (typeof command.report !== "string" || command.report.length < 1) {
    fail(`commands[${String(index)}].report 缺失`);
  }
  checkEntries(command.entries, `commands[${String(index)}].entries`);
}

console.log(
  `ztrace-check ok: commands=${String(commands.length)} bootRecords=${String(capture.boot.status?.Records ?? 0)} schema=${capture.schema} commit=${capture.git.commit.slice(0, 7)}`,
);
