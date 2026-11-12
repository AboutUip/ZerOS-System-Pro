/**
 * 五件套一键门禁（Toolchain/gate.mjs，Toolchain 下 npm run gate）。
 *
 * 五件套是什么（顺序即执行顺序，任一失败立即以非 0 退出并标注是哪一件）：
 *   ① 编译器回归：dev/Debug/plan2/regress.mjs——examples/ 全量正例 + bad-* 负例
 *      （97 正例 + 26 负例量级），与 dev/Debug/plan2/regress-baseline.json 对照；
 *   ② Toolchain npm test：check-consistency + ztrace-corpus 语料表 + repo-checks
 *      （含 extension-lint-probe）+ lint-SKILL 单源一致性；
 *   ③ 客根映像：node ZerOS-PRO/Hardware/Nas/Server/build-guest.mjs；
 *   ④ m2d 探针 9 例：dev/Debug/plan2/m2d-record-probe.mjs
 *      （影子析构记录链 + __dtor_sweep 清扫，reap(task) 协议编译器侧）；
 *   ⑤ 扩展 lint 探针（例数以脚本为准）：dev/Debug/plan2/extension-lint-probe.mjs。
 *
 * 何时必须跑：任何编译器（Compiler/ObrCompiler）、内核（ZerOS-PRO/Kernel 等）、宿主
 * （ZerOS-PRO/Hardware/Nas/Server 等）改动后，合入前必须五件套全绿。语言表面变更还要
 * 同一轮同步插件（tmLanguage / semanticTokens / hoverDocs / compilerLint）与
 * SKILL / README，再跑本门禁。
 *
 * 用法：
 *   node Toolchain/gate.mjs           顺序跑全部五件；
 *   node Toolchain/gate.mjs --only 1,3  只跑子集（回归定位用），编号 1-5，逗号分隔；
 *   node Toolchain/gate.mjs --list      只列五件的编号与命令，不执行。
 * 退出码：全过 0；任一失败非 0；参数错误 2。
 */
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

/** 五件套的命令清单。cwd 除②在 Toolchain 外都是仓库根。 */
const STEPS = [
  {
    id: 1,
    name: "编译器回归（正例 + bad-* 负例 vs regress-baseline.json）",
    run: () => ({ file: process.execPath, args: ["dev/Debug/plan2/regress.mjs"], cwd: repoRoot })
  },
  {
    id: 2,
    name: "Toolchain npm test（consistency + 语料表 + repo-checks + lint-SKILL 一致性）",
    run: () => npmTest()
  },
  {
    id: 3,
    name: "客根映像 build-guest.mjs",
    run: () => ({ file: process.execPath, args: ["ZerOS-PRO/Hardware/Nas/Server/build-guest.mjs"], cwd: repoRoot })
  },
  {
    id: 4,
    name: "m2d 探针 9 例（影子析构记录链 + __dtor_sweep）",
    run: () => ({ file: process.execPath, args: ["dev/Debug/plan2/m2d-record-probe.mjs"], cwd: repoRoot })
  },
  {
    id: 5,
    name: "extension-lint-probe",
    run: () => ({ file: process.execPath, args: ["dev/Debug/plan2/extension-lint-probe.mjs"], cwd: repoRoot })
  }
];

/** ② 跑真 npm test：npm run 里用 npm_execpath 直调，独立执行退回 PATH 上的 npm。 */
function npmTest() {
  const exec = process.env.npm_execpath;
  if (exec && /\.(c|m)?js$/.test(exec)) {
    return { file: process.execPath, args: [exec, "test"], cwd: here };
  }
  return { file: process.platform === "win32" ? "npm.cmd" : "npm", args: ["test"], cwd: here, shell: true };
}

function parseOnly(argv) {
  const at = argv.indexOf("--only");
  if (at < 0) return null;
  const spec = argv[at + 1];
  if (!spec) {
    process.stderr.write("--only 需要编号列表，例如 --only 1,3\n");
    process.exit(2);
  }
  const picked = [];
  for (const part of spec.split(",")) {
    const n = Number(part.trim());
    if (!Number.isInteger(n) || n < 1 || n > STEPS.length) {
      process.stderr.write(`--only 里的编号 ${part} 不在 1-${STEPS.length}\n`);
      process.exit(2);
    }
    if (!picked.includes(n)) picked.push(n);
  }
  return picked;
}

const argv = process.argv.slice(2);
if (argv.includes("--list")) {
  for (const step of STEPS) {
    console.log(`${step.id}  ${step.name}`);
  }
  process.exit(0);
}
const only = parseOnly(argv);
const chosen = only ? STEPS.filter((step) => only.includes(step.id)) : STEPS;

function seconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

const results = [];
for (const step of chosen) {
  process.stdout.write(`\n▶ [${step.id}/${STEPS.length}] ${step.name}\n`);
  const started = Date.now();
  const cmd = step.run();
  const proc = spawnSync(cmd.file, cmd.args, {
    cwd: cmd.cwd || repoRoot,
    stdio: "inherit",
    shell: cmd.shell === true
  });
  const ms = Date.now() - started;
  const ok = proc.status === 0;
  results.push({ step, ms, ok, status: proc.status, error: proc.error });
  if (!ok) {
    if (proc.error) process.stderr.write(`启动失败：${proc.error.message}\n`);
    process.stderr.write(`\n✗ [${step.id}] 第 ${step.id} 件「${step.name}」失败` +
      `（${proc.error ? "启动失败" : `退出码 ${String(proc.status)}`}，耗时 ${seconds(ms)}）\n`);
    break;
  }
  process.stdout.write(`✓ [${step.id}] 通过（${seconds(ms)}）\n`);
}

process.stdout.write("\n门禁汇总：\n");
for (const { step, ms, ok } of results) {
  process.stdout.write(`  ${ok ? "过" : "挂"}  [${step.id}] ${step.name}  ${seconds(ms)}\n`);
}
const failed = results.find((item) => !item.ok);
if (failed) {
  process.stderr.write(`门禁失败：第 ${failed.step.id} 件「${failed.step.name}」\n`);
  process.exit(1);
}
process.stdout.write(`五件套全过（本次跑了 ${results.length}/${STEPS.length} 件）\n`);
