/**
 * 不启动浏览器的仓库检查。
 * 快照要看见宿主在外面新增和改名。
 * 语料夹具要能种进一个空的客根。
 * 没有 .cursor 的目录不是一致性失败。
 * 扩展 lint 探针（16 例）也在这里跑，npm test 一并覆盖。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createStore } from "../ZerOS-PRO/Hardware/Nas/Server/nas-fs.mjs";
import { plantCorpusHome } from "../Compiler/Debugger/Tools/ztrace-home.mjs";
import { inspectCursorLinks } from "./check-consistency.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function namesAt(store, dir) {
  const names = [];
  for (let index = 0; index < 64; index += 1) {
    const reply = store.call({ op: "readdir", path: dir, index });
    if (reply.status === 2) {
      return names;
    }
    if (reply.status !== 0 || typeof reply.name !== "string") {
      fail(`列 ${dir} 下标 ${String(index)} 失败，状态 ${String(reply.status)}`);
      return names;
    }
    names.push(reply.name);
  }
  fail(`列 ${dir} 超过 64 项`);
  return names;
}

function same(left, right) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function checkSnapshot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zeros-snap-"));
  const store = createStore(root);
  try {
    fs.writeFileSync(path.join(root, "a.txt"), "a\n");
    const first = namesAt(store, "/");
    if (!same(first, ["a.txt"])) {
      fail(`初始名单是 ${first.join(", ")}`);
      return;
    }
    fs.writeFileSync(path.join(root, "b.txt"), "b\n");
    const added = namesAt(store, "/");
    if (!same(added, ["a.txt", "b.txt"])) {
      fail(`外部新增后是 ${added.join(", ")}`);
      return;
    }
    fs.renameSync(path.join(root, "a.txt"), path.join(root, "c.txt"));
    const renamed = namesAt(store, "/");
    if (!same(renamed, ["b.txt", "c.txt"])) {
      fail(`外部改名后是 ${renamed.join(", ")}`);
    }
  } finally {
    store.closeAll();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function checkPlant() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zeros-home-"));
  try {
    plantCorpusHome(root);
    const text = fs.readFileSync(path.join(root, "temp", "test", "test.txt"), "utf8");
    if (!text.startsWith("Hello\n")) {
      fail("夹具 /temp/test/test.txt 不是 Hello");
    }
    const packed = fs.readFileSync(path.join(root, "temp", "test", "zz.Z"));
    if (packed[0] !== 31 || packed[1] !== 157) {
      fail("夹具 /temp/test/zz.Z 没有 compress 头");
    }
    if (!fs.existsSync(path.join(root, "temp", "test", "lib.a"))) {
      fail("夹具没有 /temp/test/lib.a");
    }
    if (!fs.existsSync(path.join(root, "share", "man", "ls"))) {
      fail("夹具没有 /share/man/ls");
    }
    if (fs.existsSync(path.join(root, "home"))) {
      fail("夹具播种不许碰 /home（留给未来用户家目录）");
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/**
 * 目录政策防回归：语料与 Resource 测试面不得引用 /home/。
 * /home 保留给未来用户家目录（/home/<用户>），测试夹具与测试输出一律走 /temp/test。
 * 违反即门禁失败。
 */
function checkNoHomePaths() {
  const repo = path.join(here, "..");
  const targets = [
    "Compiler/Debugger/Tools/ztrace-corpus.json",
    "Compiler/Debugger/Tools/ztrace-home.mjs",
    "Compiler/Debugger/Tools/ztrace-corpus.mjs",
    "Compiler/Debugger/Tools/ztrace-sched-gate.mjs"
  ];
  const resourceDir = path.join(repo, "ZerOS-PRO", "Resource");
  const stack = [resourceDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith("check.obr")) {
        targets.push(path.relative(repo, full).replaceAll("\\", "/"));
      }
    }
  }
  for (const rel of targets) {
    const full = path.join(repo, rel);
    if (!fs.existsSync(full)) {
      fail(`目录政策检查找不到 ${rel}`);
      continue;
    }
    const text = fs.readFileSync(full, "utf8");
    const line = text.split(/\r?\n/).findIndex((row) => row.includes("/home/"));
    if (line !== -1) {
      fail(`目录政策：${rel} 第 ${String(line + 1)} 行还引用 /home/（/home 留给用户，测试用 /temp/test）`);
    }
  }
}

function checkFreshCursor() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zeros-cursor-"));
  try {
    const absent = inspectCursorLinks(root);
    if (absent.length !== 0) {
      fail(`没有 .cursor 仍报 ${absent.join("; ")}`);
    }
    fs.mkdirSync(path.join(root, ".cursor"));
    const present = inspectCursorLinks(root);
    if (present.length === 0) {
      fail("有 .cursor 但没有接到权威源时应当失败");
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/**
 * 扩展插件 lint 探针：compilerLint.scanSyntaxRules 的 16 例实测（正例零诊断、反例命中）。
 * 探针从仓库根找 Compiler/ObrExtension，只用 node，不依赖 obrc。
 */
function checkLintProbe() {
  const probe = path.join(here, "..", "dev", "Debug", "plan2", "extension-lint-probe.mjs");
  const run = spawnSync(process.execPath, [probe], {
    cwd: path.join(here, ".."),
    encoding: "utf8"
  });
  const output = `${run.stdout || ""}${run.stderr || ""}`;
  const summary = output.trim().split(/\r?\n/).pop() || "";
  if (run.status !== 0) {
    fail(`extension-lint-probe 失败（退出码 ${String(run.status)}）\n${output.trim()}`);
    return;
  }
  process.stdout.write(`extension-lint-probe ${summary}\n`);
}

checkSnapshot();
checkPlant();
checkNoHomePaths();
checkFreshCursor();
checkLintProbe();
if (process.exitCode === 1) {
  process.stderr.write("repo-checks failed\n");
} else {
  process.stdout.write(`repo-checks ok ${here}\n`);
}
