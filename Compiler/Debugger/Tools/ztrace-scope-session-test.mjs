/**
 * ztrace-scope 第 2 步自证：动态 scope（会话状态 + 任务域动态成员）。
 *
 * 断言重点：
 *   1. 诊断字必须反解才能当 pid（a/b 字段在位 16..19 重叠）；
 *   2. 任务图缺边要如实报告，不能默认“没有子任务”；
 *   3. 会话的定义/激活/停用/审计日志能落盘并原样读回；
 *   4. 切换 active 后对下一份 capture 立即生效；
 *   5. direct 与 core-attributed 分开计数，近似归属不冒充精确归属。
 *
 * 用法：node Compiler/Debugger/Tools/ztrace-scope-session-test.mjs
 */
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import {
  buildTaskGraph,
  classifyTaskRow,
  decodeTaskIdentity,
  defineScope,
  detectSchema,
  emptySession,
  flatten,
  loadSession,
  overlapMatrix,
  resolveRootAlias,
  runNamedScope,
  saveSession,
  setActive,
  taskScopeMembers,
} from "./ztrace-scope.mjs";

let passed = 0;
let failed = 0;

function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    process.stdout.write(`PASS  ${name}${detail ? `  (${detail})` : ""}\n`);
  } else {
    failed += 1;
    process.stdout.write(`FAIL  ${name}${detail ? `  (${detail})` : ""}\n`);
  }
}

const fixedPath = "dev/Debug/ztrace-corpus-sched2/capture.json";
const hangLsPath = "dev/Debug/ztrace-current-ls/capture.json";
const sessionFile = "dev/Debug/ztrace-scope-session-test.json";

/* -------------------------------------------------------------------------- */
/* 1. 诊断字反解：A0 不是 pid                                                   */
/* -------------------------------------------------------------------------- */

const sleepEntry = { Op: 27, Layer: 5, Core: -1, At: 1, A0: 28676, A1: 7, Span: 0, Parent: 0 };
const sleepIdentity = decodeTaskIdentity(sleepEntry);
check("task-sleep A0=28676 A1=7 反解为 pid=4 core=7",
  sleepIdentity !== null && sleepIdentity.pid === 4 && sleepIdentity.core === 7 && sleepIdentity.trustworthy === true,
  JSON.stringify(sleepIdentity));
check("task-sleep 原始字段和反解字段都在（不覆盖原始记录）",
  sleepIdentity.raw.a === 28676 && sleepIdentity.raw.b === 7);

const wakeEntry = { Op: 28, Layer: 5, Core: -1, At: 1, A0: 24579, A1: 6, Span: 0, Parent: 0 };
const wakeIdentity = decodeTaskIdentity(wakeEntry);
check("task-wake A0=24579 A1=6 反解为 pid=3 core=6",
  wakeIdentity !== null && wakeIdentity.pid === 3 && wakeIdentity.core === 6);

const exitEntry = { Op: 26, Layer: 5, Core: -1, At: 1, A0: 1077477376, A1: 4, Span: 0, Parent: 0 };
const exitIdentity = decodeTaskIdentity(exitEntry);
check("task-exit 反解为 child=57 parent=4 code=0",
  exitIdentity !== null && exitIdentity.child === 57 && exitIdentity.parent === 4 && exitIdentity.code === 0,
  JSON.stringify(exitIdentity));

const badEntry = { Op: 27, Layer: 5, Core: -1, At: 1, A0: 28676, A1: 9, Span: 0, Parent: 0 };
check("core=9 的 sleep 反解标记为不可信（不拿它当身份）",
  decodeTaskIdentity(badEntry)?.trustworthy === false);

check("非任务事件没有任务身份",
  decodeTaskIdentity({ Op: 1, Layer: 4, Core: 3, At: 1, A0: 8, A1: 0, Span: 0, Parent: 0 }) === null);

/* -------------------------------------------------------------------------- */
/* 2. 任务图：缺边要报告                                                        */
/* -------------------------------------------------------------------------- */

const fixed = JSON.parse(fs.readFileSync(fixedPath, "utf8"));
const flat = flatten(fixed);
const graph = buildTaskGraph(flat.rows);
check("任务图里 shell pid=4 存在", graph.nodes.has(4));
check("任务图里 display pid=3 存在", graph.nodes.has(3));
check("xargs pid=57 的父任务是 4", graph.nodes.get(57)?.parent === 4, `parent=${graph.nodes.get(57)?.parent}`);
check("任务图有缺边警告（不默认“没有子任务”）",
  graph.warnings.some((text) => text.includes("没有任何 task-exit/task-wait 边")),
  graph.warnings[0] ?? "无警告");

const shellInfo = resolveRootAlias(graph, "shell");
check("shell 别名按 task-exit 边最多解析到 pid=4", shellInfo.pid === 4, shellInfo.note);
check("init 别名固定 pid=1", resolveRootAlias(graph, "init").pid === 1);

const tree = taskScopeMembers(graph, 4, "descendants");
check("descendants 包含命令子任务 5 和 xargs 57",
  tree.members.includes(5) && tree.members.includes(57), `members=${tree.members.length}`);
check("descendants 不包含 display pid=3", !tree.members.includes(3));
check("self 关系只有 root", taskScopeMembers(graph, 4, "self").members.length === 1);

/* -------------------------------------------------------------------------- */
/* 3. direct / core-attributed 分开                                              */
/* -------------------------------------------------------------------------- */

const session = emptySession();
defineScope(session, "xargs-tree", "task=shell;relation=descendants");
defineScope(session, "core3", "core=3;window=command:53");
const ctx = {
  rows: flat.rows,
  windows: flat.windows,
  schema: detectSchema(flat.rows.map((row) => row.entry)),
  indexOf: new Map(flat.rows.map((row, index) => [row, index])),
};
const taskResult = runNamedScope(fixed, "xargs-tree", session.scopes["xargs-tree"], ctx);
check("任务域：direct 与 core-attributed 分开计数",
  taskResult.counts.direct > 0 && taskResult.counts.coreAttributed > 0,
  `direct=${taskResult.counts.direct} core-attributed=${taskResult.counts.coreAttributed}`);
check("任务域：direct 行标注 memberPid，core-attributed 不冒充 direct",
  taskResult.rows.every((item) => (item.cls.match === "direct" && item.cls.pid >= 0) || item.cls.match === "core-attributed"));
const classifySample = taskResult.rows.find((item) => item.cls.match === "core-attributed");
check("core-attributed 只按核心驻留近似（成员曾驻留该核心且在时间段内）",
  classifySample !== undefined && classifyTaskRow(classifySample.row, graph, tree.members).match === "core-attributed");

const selectorResult = runNamedScope(fixed, "core3", session.scopes["core3"], ctx);
check("选择器 scope 命中 core 3 的 xargs 窗口记录",
  selectorResult.counts.included > 0, `included=${selectorResult.counts.included}`);

/* -------------------------------------------------------------------------- */
/* 4. 会话落盘、审计、切换立即生效                                               */
/* -------------------------------------------------------------------------- */

if (fs.existsSync(sessionFile)) fs.rmSync(sessionFile);
const live = emptySession("2026-11-05T00:00:00.000Z");
defineScope(live, "xargs-tree", "task=shell;relation=descendants");
defineScope(live, "core3", "core=3;window=command:53");
setActive(live, "xargs-tree", true);
saveSession(sessionFile, live);
const loaded = loadSession(sessionFile);
check("会话落盘后原样读回（schema/active/scopes）",
  loaded.schema === "zeros.ztrace.scope-session/1" && loaded.active.length === 1 && loaded.scopes["xargs-tree"] !== undefined);
check("会话有审计日志（define/activate 都记）",
  loaded.log.filter((item) => item.action === "define").length === 2 && loaded.log.some((item) => item.action === "activate"));

setActive(loaded, "xargs-tree", false);
setActive(loaded, "core3", true);
saveSession(sessionFile, loaded);
const switched = loadSession(sessionFile);
check("切换后 active 立即改变（xargs-tree 停用、core3 激活）",
  switched.active.length === 1 && switched.active[0] === "core3", `active=${switched.active.join(",")}`);

/* 端到端：CLI 用同一个会话文件跑两份 capture，输出必须跟着 active 走。 */
const runCli = (capturePath) => spawnSync(process.execPath, [
  "Compiler/Debugger/Tools/ztrace-scope.mjs",
  "--session", sessionFile,
  "--use-session",
  "--capture", capturePath,
  "--limit", "4",
], { encoding: "utf8" });
const fixedRun = runCli(fixedPath);
check("CLI：active=core3 时输出 core3 scope",
  fixedRun.status === 0 && fixedRun.stdout.includes("scope: core3") && !fixedRun.stdout.includes("scope: xargs-tree"),
  `status=${fixedRun.status}`);

const overlap = overlapMatrix([taskResult, selectorResult]);
check("重叠矩阵有输出（多 scope 可重叠，逐对计数）",
  overlap.length === 1 && typeof overlap[0].shared === "number",
  JSON.stringify(overlap));

const both = emptySession();
defineScope(both, "a", "core=3");
defineScope(both, "b", "op=svc");
setActive(both, "a", true);
setActive(both, "b", true);
saveSession(sessionFile, both);
const bothRun = runCli(fixedPath);
check("CLI：两个 active scope 都输出且有重叠行",
  bothRun.status === 0 && bothRun.stdout.includes("scope: a") && bothRun.stdout.includes("scope: b") && bothRun.stdout.includes("重叠"),
  `status=${bothRun.status}`);

/* 切换立即生效：换 active 集合，跑另一份 capture。hangLs 只有 sleep/wake，
   认不出 shell 别名，所以这里用显式 pid=4；别名拒绝猜测本身也要测。 */
const hangFlat = flatten(JSON.parse(fs.readFileSync(hangLsPath, "utf8")));
const hangGraph = buildTaskGraph(hangFlat.rows);
check("没有 task-exit 边时 shell 别名拒绝猜测（不硬编 pid）",
  resolveRootAlias(hangGraph, "shell").pid === null,
  resolveRootAlias(hangGraph, "shell").note);
check("hangLs 任务图有 pid=4（sleep/wake 里的壳）", hangGraph.nodes.has(4));

const switching = emptySession();
defineScope(switching, "core3", "core=3;window=command:1");
defineScope(switching, "shell-self", "task=4;relation=self");
setActive(switching, "core3", true);
saveSession(sessionFile, switching);
const firstRun = runCli(hangLsPath);
check("CLI：active=core3 时输出 core3 scope",
  firstRun.status === 0 && firstRun.stdout.includes("scope: core3") && !firstRun.stdout.includes("scope: shell-self"),
  `status=${firstRun.status}`);
setActive(switching, "core3", false);
setActive(switching, "shell-self", true);
saveSession(sessionFile, switching);
const secondRun = runCli(hangLsPath);
check("CLI：切换 active 后对下一份 capture 立即生效（换 scope 就换输出）",
  secondRun.status === 0 && secondRun.stdout.includes("scope: shell-self") && !secondRun.stdout.includes("scope: core3"),
  `status=${secondRun.status} err=${secondRun.stderr.trim().slice(0, 80)}`);

fs.rmSync(sessionFile, { force: true });

/* --out-file 写 UTF-8 + BOM：Windows 查看器按 ANSI 打开也不该乱码。 */
const outFile = "dev/Debug/ztrace-scope-outfile-test.txt";
const outRun = spawnSync(process.execPath, [
  "Compiler/Debugger/Tools/ztrace-scope.mjs",
  "--capture", fixedPath,
  "--window", "boot",
  "--core", "3",
  "--limit", "3",
  "--out-file", outFile,
], { encoding: "utf8" });
const outBytes = fs.readFileSync(outFile);
check("--out-file 写出 UTF-8 + BOM（EF BB BF）",
  outRun.status === 0 && outBytes[0] === 0xef && outBytes[1] === 0xbb && outBytes[2] === 0xbf,
  `status=${outRun.status} bytes=${[...outBytes.subarray(0, 3)].map((value) => value.toString(16)).join(" ")}`);
check("--out-file 内容是合法 UTF-8 中文（去掉 BOM 同时含中文标题）",
  outBytes.toString("utf8").replace(/^\uFEFF/, "").includes("计数"));
fs.rmSync(outFile, { force: true });

process.stdout.write(`\n结果：${passed} 通过，${failed} 失败\n`);
process.exit(failed === 0 ? 0 : 1);
