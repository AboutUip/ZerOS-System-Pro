/**
 * ztrace-scope 的自证测试。
 *
 * 只用已有 capture 断言已知事实，防止筛选工具制造错误结论：
 *   - schema 识别必须与真实字段一致（v2 有 Layer/Span/Parent，legacy 没有）；
 *   - 旧的“第一条外部命令卡死”必须能被精确复现（core 3 停在 core 指令 25）；
 *   - 旧的 xargs 卡死必须表现为 spawn 无回复，而修复后的 capture 必须有回复；
 *   - boot 自检故障不能混进命令窗口；
 *   - --pid 只匹配带 pid 的记录，svc/exec 不能被悄悄算进去；
 *   - 计数必须闭合：included + excluded == 总数。
 *
 * 用法：node Compiler/Debugger/Tools/ztrace-scope-test.mjs
 */
import fs from "node:fs";
import {
  TRACE_OPS,
  detectSchema,
  flatten,
  flattenStopsFaults,
  loadCapture,
  runScope,
  selectStopsFaults,
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

function capture(path) {
  if (!fs.existsSync(path)) {
    check(`capture 存在：${path}`, false, "文件不存在");
    throw new Error(`missing capture ${path}`);
  }
  return loadCapture(path);
}

function scopeOf(json, patch) {
  return runScope(json, {
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
    ...patch,
  });
}

/* -------------------------------------------------------------------------- */
/* 1. 字段语义必须有出处                                                       */
/* -------------------------------------------------------------------------- */

check("op 34 (process-exit) 注明 Core 是核心号而非 pid",
  typeof TRACE_OPS[34].coreNote === "string" && TRACE_OPS[34].coreNote.includes("核心号"));
check("op 26 (task-exit) 注明 A0 是 子pid<<16|退出码",
  TRACE_OPS[26].a0.includes("子 pid<<16"));
check("每条语义都带 source",
  Object.values(TRACE_OPS).every((item) => typeof item.source === "string" && item.source.length > 0));

/* -------------------------------------------------------------------------- */
/* 2. schema 识别（含合成 legacy，避免依赖任何旧采集）                          */
/* -------------------------------------------------------------------------- */

const fixedPath = "dev/Debug/ztrace-corpus-sched2/capture.json";
const hangLsPath = "dev/Debug/ztrace-current-ls/capture.json";
const hangXargsPath = "dev/Debug/ztrace-xargs-deep/capture.json";

const fixed = capture(fixedPath);
const hangLs = capture(hangLsPath);
const hangXargs = capture(hangXargsPath);

check("sched2 capture 是 v2 schema", detectSchema(fixed.commands[0].entries).kind === "v2");

const legacyEntry = { At: 1, Core: 3, Op: 1, A0: 2, A1: 0, A2: 0, A3: 0 };
check("合成 legacy 记录识别为 legacy", detectSchema([legacyEntry]).kind === "legacy");
const legacyCapture = {
  boot: { entries: [legacyEntry], stops: [], faults: [] },
  commands: [{ command: "legacy", entries: [legacyEntry], stops: [], faults: [], status: { Records: 1 } }],
};
let legacyRefused = false;
let legacyMessage = "";
try {
  scopeOf(legacyCapture, { span: 1 });
} catch (error) {
  legacyMessage = String(error.message);
  legacyRefused = /legacy/.test(legacyMessage);
}
check("legacy capture 上用 --span 会被明确拒绝（不是静默忽略）", legacyRefused, legacyMessage);

/* -------------------------------------------------------------------------- */
/* 3. 旧回归 A：第一条外部命令卡死（core 3 停在 core 指令 25）                  */
/* -------------------------------------------------------------------------- */

const lsResult = scopeOf(hangLs, { window: { kind: "by-index", index: 1 }, core: [3], op: [5] });
check("旧 ls 卡死：core 3 的 core-stop 记录恰好 1 条", lsResult.included.length === 1, `命中 ${lsResult.included.length}`);
const lsStop = lsResult.included[0]?.entry;
check("旧 ls 卡死：reason=1(yield) index=25",
  lsStop !== undefined && lsStop.A0 === 1 && lsStop.A1 === 25, `A0=${lsStop?.A0} A1=${lsStop?.A1}`);

const lsStops = selectStopsFaults(flattenStopsFaults(hangLs), {
  window: { kind: "by-index", index: 1 }, core: [3], stopOp: ["core"], pid: null, since: null, until: null, span: null, parent: null,
}, detectSchema(hangLs.commands[0].entries)).included;
check("旧 ls 卡死：stops 数组里指令助记符 core、index=25 对上",
  lsStops.length === 1 && lsStops[0].item.Op === "core" && lsStops[0].item.Index === 25,
  JSON.stringify(lsStops.map((row) => row.item)));

const afterStop = scopeOf(hangLs, {
  window: { kind: "by-index", index: 1 },
  core: [3],
  op: [2],
  since: lsStop?.At ?? 0,
});
check("旧 ls 卡死：停机之后 core 3 没有任何 svc-reply", afterStop.included.length === 0, `命中 ${afterStop.included.length}`);

/* -------------------------------------------------------------------------- */
/* 4. 旧回归 B：xargs 同核派生后 spawn 无回复                                   */
/* -------------------------------------------------------------------------- */

const xargsOld = scopeOf(hangXargs, {
  window: { kind: "by-index", index: 1 },
  core: [3],
  op: [1, 2],
  service: [17],
});
const xargsOldSvc = xargsOld.included.filter((row) => row.entry.Op === 1);
const xargsOldReply = xargsOld.included.filter((row) => row.entry.Op === 2);
check("旧 xargs 卡死：core 3 有 spawn 请求", xargsOldSvc.length === 1, `svc=${xargsOldSvc.length}`);
check("旧 xargs 卡死：core 3 没有 spawn 回复", xargsOldReply.length === 0, `reply=${xargsOldReply.length}`);

/* -------------------------------------------------------------------------- */
/* 5. 修复后：命令真实成功；trace 的同核 svc 记账缺口必须被标注而不是误判挂死    */
/* -------------------------------------------------------------------------- */

const xargsCommandIndex = fixed.commands.findIndex((command) => String(command.command).startsWith("xargs echo <"));
check("sched2 里能找到 xargs 命令窗口", xargsCommandIndex >= 0, `index=${xargsCommandIndex + 1}`);
const xargsCommand = fixed.commands[xargsCommandIndex];
check("修复后：xargs 命令真实成功（采集器事实：无 error 且提示符>=1 且退出码=0）",
  xargsCommand.error === undefined && Number(xargsCommand.status?.Prompts ?? 0) >= 1 && xargsCommand.exitCode === 0,
  `error=${xargsCommand.error} prompts=${xargsCommand.status?.Prompts} exit=${xargsCommand.exitCode}`);

const xargsPairs = scopeOf(fixed, {
  window: { kind: "by-index", index: xargsCommandIndex + 1 },
  core: [3],
}).svcPairs;
const sameCoreUnreplied = xargsPairs.unreplied.filter((item) => item.service === 17);
check("修复后：同核 spawn 的 svc-reply 在 trace 里确实缺失（记账缺口，如实暴露）",
  sameCoreUnreplied.length === 1, `unreplied=${sameCoreUnreplied.length}`);
check("修复后：该缺口带同核任务切换证据",
  sameCoreUnreplied.length === 1 && sameCoreUnreplied[0].ambiguous === true);
check("修复后：判读为“命令已成功 → 更像记账缺口”，不是挂死",
  sameCoreUnreplied.length === 1 && String(sameCoreUnreplied[0].verdict).includes("记账缺口"),
  sameCoreUnreplied[0]?.verdict ?? "");
check("修复后：spawn 的未回复不是“按设计无回复”",
  sameCoreUnreplied.length === 1 && sameCoreUnreplied[0].byDesign === false);
const exitUnreplied = xargsPairs.unreplied.filter((item) => item.service === 28);
check("服务 28 (exit) 未回复被标为按设计无回复（不误判成缺口/挂死）",
  exitUnreplied.length >= 1 && exitUnreplied.every((item) => item.byDesign === true),
  exitUnreplied.map((item) => `span=${item.span}`).join(","));

const oldPairs = scopeOf(hangXargs, {
  window: { kind: "by-index", index: 1 },
  core: [3],
}).svcPairs;
const oldUnreplied = oldPairs.unreplied.filter((item) => item.service === 17);
check("旧 xargs：同核 spawn 同样缺 svc-reply",
  oldUnreplied.length === 1 && oldUnreplied[0].ambiguous === true);
check("旧 xargs：命令真实失败 → 判读为“才值得怀疑真没回复”",
  oldUnreplied.length === 1 && String(oldUnreplied[0].verdict).includes("才值得怀疑"),
  oldUnreplied[0]?.verdict ?? "");

/* 配对不受 --op/--service/--pid 影响：即使只筛 svc，回复仍能被找到。 */
const pairedDespiteFilter = scopeOf(fixed, {
  window: { kind: "by-index", index: xargsCommandIndex + 1 },
  op: [1],
}).svcPairs.paired;
check("svc 配对不受 --op 过滤影响（不会把回复滤掉后误判）",
  pairedDespiteFilter.length >= 2, `paired=${pairedDespiteFilter.length}`);

/* -------------------------------------------------------------------------- */
/* 6. boot 自检故障不进命令窗口                                                 */
/* -------------------------------------------------------------------------- */

const fixedStopFaults = flattenStopsFaults(fixed);
const bootFaults = fixedStopFaults.filter((row) => row.kind === "fault" && row.window === "boot");
const commandFaults = fixedStopFaults.filter((row) => row.kind === "fault" && row.window !== "boot");
check("sched2：boot 窗口确有自检故障", bootFaults.length >= 1, `boot faults=${bootFaults.length}`);
check("sched2：命令窗口没有故障", commandFaults.length === 0, `command faults=${commandFaults.length}`);
check("sched2：每个命令窗口 faults 数组为空",
  fixed.commands.every((command) => !Array.isArray(command.faults) || command.faults.length === 0));

/* -------------------------------------------------------------------------- */
/* 7. --pid 不猜：svc/exec 不能被算进 pid 归属                                  */
/* -------------------------------------------------------------------------- */

const pidScope = scopeOf(fixed, { pid: [28676] });
const pidOps = [...new Set(pidScope.included.map((row) => row.entry.Op))];
check("--pid 只命中带 pid 的记录",
  pidOps.every((op) => [25, 26, 27, 28].includes(op)),
  `命中 op=[${pidOps.join(",")}]`);
check("--pid 明确统计“不可按 pid 归属”的记录",
  pidScope.excluded.notPidAttributable > 0, `notPidAttributable=${pidScope.excluded.notPidAttributable}`);

/* -------------------------------------------------------------------------- */
/* 8. 计数完整性：不排除静默丢失                                                */
/* -------------------------------------------------------------------------- */

const flat = flatten(fixed);
check("sched2：摊平条数等于 boot+各命令条数",
  flat.rows.length === fixed.boot.entries.length + fixed.commands.reduce((sum, command) => sum + command.entries.length, 0),
  `rows=${flat.rows.length}`);
const countsMatch = fixed.commands.every((command) => command.entries.length <= (command.status?.Records ?? Infinity));
check("sched2：每条命令 entries 不超过 status.Records", countsMatch);
let ordered = true;
for (const command of fixed.commands) {
  for (let index = 1; index < command.entries.length; index += 1) {
    if (command.entries[index].At < command.entries[index - 1].At) {
      ordered = false;
      break;
    }
  }
}
check("sched2：每条命令窗口 At 单调不减", ordered);

const allScope = scopeOf(fixed, {});
const excludedSum = Object.values(allScope.excluded).reduce((sum, value) => sum + value, 0);
check("无过滤时 included+excluded 等于总数（不静默丢）",
  allScope.included.length + excludedSum === flat.rows.length,
  `${allScope.included.length}+${excludedSum}=${flat.rows.length}`);

/* -------------------------------------------------------------------------- */

process.stdout.write(`\n结果：${passed} 通过，${failed} 失败\n`);
process.exit(failed === 0 ? 0 : 1);
