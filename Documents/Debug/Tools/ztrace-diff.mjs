/**
 * 对比两份 ztrace capture.json 的结构。
 *
 * 用法：
 *   node Documents/Debug/Tools/ztrace-diff.mjs --base dev/Debug/base/capture.json --head dev/Debug/head/capture.json --check
 *
 * 默认只打印差异；--check 时结构差异会让进程返回 1。
 * 不比较耗时、记录条数等会随调度漂移的数值。
 */
import fs from "node:fs";

const CAPTURE_SCHEMA = "zeros.ztrace.capture/1";

class CliError extends Error {}

function usage() {
  return [
    "ZerOS trace 结构对比",
    "",
    "用法：",
    "  node Documents/Debug/Tools/ztrace-diff.mjs --base <capture.json> --head <capture.json> [选项]",
    "",
    "选项：",
    "  --base <file>   基线 capture.json",
    "  --head <file>   新 capture.json",
    "  --check         有结构差异时返回 1，用于 CI 门禁",
    "  --json          把差异写成 JSON",
    "  --help          显示本说明",
  ].join("\n");
}

function parseArgs(argv) {
  const options = { base: "", head: "", check: false, json: false, help: false };
  const valueFlags = new Set(["--base", "--head"]);
  const noValueFlags = new Set(["--check", "--json", "--help"]);
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index] ?? "";
    const equal = raw.indexOf("=");
    const flag = equal >= 0 ? raw.slice(0, equal) : raw;
    if (!valueFlags.has(flag) && !noValueFlags.has(flag)) {
      throw new CliError(`未知参数 ${JSON.stringify(raw)}`);
    }
    if (noValueFlags.has(flag)) {
      if (equal >= 0) throw new CliError(`${flag} 不接受值`);
      if (flag === "--check") options.check = true;
      else if (flag === "--json") options.json = true;
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
    if (flag === "--base") options.base = value;
    else options.head = value;
  }
  if (!options.help && (options.base.length < 1 || options.head.length < 1)) {
    throw new CliError("必须给出 --base 和 --head");
  }
  return options;
}

function readCapture(file, label) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new CliError(`${label} 读取失败：${error instanceof Error ? error.message : String(error)}`);
  }
  if (value?.schema !== CAPTURE_SCHEMA) {
    throw new CliError(`${label} 的 schema 不是 ${CAPTURE_SCHEMA}`);
  }
  if (!Array.isArray(value.commands)) {
    throw new CliError(`${label} 的 commands 不是数组`);
  }
  return value;
}

/** 顶层和两级缩进的标题行；只保留名字，不保留数值。 */
function reportSections(report) {
  const names = new Set();
  if (typeof report !== "string") {
    return [];
  }
  for (const line of report.split(/\r?\n/)) {
    const match = /^ {0,4}([A-Za-z][A-Za-z0-9 /_-]*):/.exec(line);
    if (match !== null) {
      const name = match[1].trim();
      if (name.length > 0) {
        names.add(name);
      }
    }
  }
  return [...names].sort();
}

function entryOps(entries) {
  const ops = new Set();
  if (!Array.isArray(entries)) {
    return [];
  }
  for (const entry of entries) {
    if (entry !== null && typeof entry === "object" && Number.isFinite(entry.Op)) {
      ops.add(entry.Op);
    }
  }
  return [...ops].sort((left, right) => left - right);
}

function stopSignature(stops) {
  if (!Array.isArray(stops)) {
    return [];
  }
  return stops
    .map((stop) => {
      const hasSnapshot = stop !== null && typeof stop === "object" && stop.Snapshot !== null && stop.Snapshot !== undefined;
      return `${String(stop?.Core)}:${String(stop?.Reason)}:${hasSnapshot ? "snapshot" : "no-snapshot"}`;
    })
    .sort();
}

function commandSignature(record) {
  if (record === null || typeof record !== "object") {
    return { error: "missing", stops: [] };
  }
  const error = typeof record.error === "string" ? record.error : "";
  return {
    error: error.length === 0 ? "" : (/^timeout after \d+ms$/.test(error) ? "timeout" : "error"),
    stops: stopSignature(record.stops),
  };
}

function captureOps(capture) {
  const ops = new Set();
  const reports = [];
  if (capture?.boot !== null && typeof capture?.boot === "object") {
    for (const op of entryOps(capture.boot.entries)) {
      ops.add(op);
    }
    if (typeof capture.boot.report === "string") {
      reports.push(capture.boot.report);
    }
  }
  for (const item of capture.commands) {
    if (item === null || typeof item !== "object") {
      continue;
    }
    for (const op of entryOps(item.entries)) {
      ops.add(op);
    }
    if (typeof item.report === "string") {
      reports.push(item.report);
    }
  }
  const sections = new Set();
  for (const report of reports) {
    for (const name of reportSections(report)) {
      sections.add(name);
    }
  }
  return {
    ops: [...ops].sort((left, right) => left - right),
    sections: [...sections].sort(),
  };
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function difference(kind, command, detail) {
  return { kind, command, detail };
}

function compare(base, head) {
  const differences = [];
  if (base.schema !== head.schema) {
    differences.push(difference("schema", "", `${String(base.schema)} -> ${String(head.schema)}`));
  }
  if (base.debug !== head.debug) {
    differences.push(difference("debug", "", `${String(base.debug)} -> ${String(head.debug)}`));
  }
  const baseCommands = base.commands.map((item) => (item !== null && typeof item === "object" ? String(item.command ?? "") : ""));
  const headCommands = head.commands.map((item) => (item !== null && typeof item === "object" ? String(item.command ?? "") : ""));
  if (!arraysEqual(baseCommands, headCommands)) {
    const baseSet = new Set(baseCommands);
    const headSet = new Set(headCommands);
    const removed = baseCommands.filter((item) => !headSet.has(item));
    const added = headCommands.filter((item) => !baseSet.has(item));
    differences.push(
      difference("commands", "", `removed=[${removed.join(", ")}] added=[${added.join(", ")}] order=${String(arraysEqual(baseCommands, headCommands))}`),
    );
  }
  const baseShape = captureOps(base);
  const headShape = captureOps(head);
  if (!arraysEqual(baseShape.ops, headShape.ops)) {
    differences.push(difference("entries", "", `ops ${baseShape.ops.join(",")} -> ${headShape.ops.join(",")}`));
  }
  if (!arraysEqual(baseShape.sections, headShape.sections)) {
    differences.push(difference("report", "", `sections ${baseShape.sections.join(",")} -> ${headShape.sections.join(",")}`));
  }
  const byCommand = new Map();
  for (let index = 0; index < base.commands.length; index += 1) {
    const item = base.commands[index];
    if (item !== null && typeof item === "object" && typeof item.command === "string") {
      byCommand.set(item.command, item);
    }
  }
  for (const item of head.commands) {
    if (item === null || typeof item !== "object" || typeof item.command !== "string") {
      continue;
    }
    const previous = byCommand.get(item.command);
    if (previous === undefined) {
      continue;
    }
    const left = commandSignature(previous);
    const right = commandSignature(item);
    if (left.error !== right.error) {
      differences.push(difference("error", item.command, `${left.error || "ok"} -> ${right.error || "ok"}`));
    }
    if (!arraysEqual(left.stops, right.stops)) {
      differences.push(difference("stops", item.command, `${left.stops.join(",")} -> ${right.stops.join(",")}`));
    }
  }
  return differences;
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`ztrace-diff: ${error instanceof Error ? error.message : String(error)}\n\n${usage()}\n`);
    return 2;
  }
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  let base;
  let head;
  try {
    base = readCapture(options.base, "base");
    head = readCapture(options.head, "head");
  } catch (error) {
    process.stderr.write(`ztrace-diff: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  const differences = compare(base, head);
  if (options.json) {
    process.stdout.write(`${JSON.stringify({
      schema: "zeros.ztrace.diff/1",
      base: options.base,
      head: options.head,
      differences,
      passed: differences.length === 0,
    }, null, 2)}\n`);
  } else if (differences.length === 0) {
    process.stdout.write(`ztrace-diff ok: commands=${String(head.commands.length)} head=${options.head}\n`);
  } else {
    process.stdout.write(`ztrace-diff: ${String(differences.length)} structural difference(s)\n`);
    for (const item of differences) {
      const where = item.command.length > 0 ? ` ${item.command}` : "";
      process.stdout.write(`  ${item.kind.padEnd(8)}${where}  ${item.detail}\n`);
    }
  }
  return options.check && differences.length > 0 ? 1 : 0;
}

process.exitCode = main();
