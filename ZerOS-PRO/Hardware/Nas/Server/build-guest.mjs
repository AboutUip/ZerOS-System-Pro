/**
 * 把内核和用户态编进 NAS 的客根。
 * 在仓库根目录执行：node ZerOS-PRO/Hardware/Nas/Server/build-guest.mjs
 *
 * 入口是 -slot 2 的原生映像。会装到核心 4 至 7 的程序是 -pie -slot 0。
 * Resource/Bin 里带 main 的每个 .obr 编成 /bin/同名文件，并链上 arg.obr 与 obr.proc.obr。
 * obr.print、obr.oct、obr.path、obr.line 分别编成 /lib 下的同名 .zdll，不链进这些程序。
 * Driver/Nic/niclib 编成 /lib/nic.zdll；Driver/Time/time 编成 /lib/time.zdll；
 * Driver/Nic/niccore 链接进内核。离线时区数据库由 provision.mjs 安装。
 * Resource/App 的每个子目录是一个程序：带 main 的那份是入口，目录树里其余 .obr 都链进去。
 * sh 的客路径仍是 /os/sh。其它程序写成 /app/目录名。*-check.obr 只在宿主编过，不装进客根。
 * 不写 .zap。编完再跑 provision.mjs，已有的 /boot/display 和 /boot/debug 不覆盖。
 * 默认不生成 .debug；需要 B2 源行映射时显式加 --debug-maps。
 * 普通构建会删除旧的 kernel/start.debug 和 os/sh.debug，避免用旧表错误归属源行。
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const product = path.resolve(repo, "ZerOS-PRO");
const root = path.resolve(here, "../Root");
const compiler = path.resolve(repo, "Compiler/ObrCompiler", process.platform === "win32" ? "obrc.exe" : "obrc");
const lib = path.resolve(repo, "Compiler/ObrCompiler/lib");
const memory = path.resolve(product, "Hardware/Memory");
const board = path.resolve(product, "Hardware/Motherboard");
const nicDriver = path.resolve(repo, "Driver/Nic");
const timeDriver = path.resolve(repo, "Driver/Time");
const debugMaps = process.argv.includes("--debug-maps");
const debugFiles = [
  path.resolve(root, "kernel/start.debug"),
  path.resolve(root, "os/sh.debug"),
];
if (!debugMaps) {
  for (const file of debugFiles) {
    fs.rmSync(file, { force: true });
  }
}

const kernelIncludes = [
  "Init",
  "Proc",
  "Mm",
  "Sched",
  "Fs",
  "Exec",
  "Font",
  "Text",
  "Test",
].map((name) => path.resolve(product, "Kernel", name));

function run(args) {
  const result = spawnSync(compiler, args, { encoding: "utf8" });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || result.error?.message || "obrc 失败").trim();
    throw new Error(detail);
  }
}

function compile(sources, output, extra) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  try {
    run([...sources, ...extra, "-o", output]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${sources[0]}\n${detail}`);
  }
}

if (!fs.existsSync(compiler)) {
  throw new Error(`找不到宿主编译器 ${compiler}`);
}

const kernel = path.resolve(product, "Kernel");
compile(
  [
    path.resolve(kernel, "Init/start.obr"),
    path.resolve(kernel, "Proc/task.obr"),
    path.resolve(kernel, "Proc/pool.obr"),
    path.resolve(kernel, "Proc/sig.obr"),
    path.resolve(kernel, "Mm/mm.obr"),
    path.resolve(kernel, "Mm/window.obr"),
    path.resolve(kernel, "Sched/sched.obr"),
    path.resolve(kernel, "Fs/vfs.obr"),
    path.resolve(kernel, "Fs/pipe.obr"),
    path.resolve(kernel, "Fs/dev.obr"),
    path.resolve(kernel, "Fs/console.obr"),
    path.resolve(kernel, "Fs/frame.obr"),
    path.resolve(kernel, "Fs/comm.obr"),
    path.resolve(kernel, "Exec/exec.obr"),
    path.resolve(kernel, "Exec/flat.obr"),
    path.resolve(kernel, "Exec/drv.obr"),
    path.resolve(kernel, "Exec/boot.obr"),
    path.resolve(kernel, "Exec/spawn.obr"),
    path.resolve(product, "System/Loader/loader.obr"),
    path.resolve(kernel, "Font/font.obr"),
    path.resolve(kernel, "Text/utf8.obr"),
    path.resolve(kernel, "Test/suite.obr"),
    path.resolve(lib, "obr.nas.obr"),
    path.resolve(nicDriver, "niccore.obr"),
  ],
  path.resolve(root, "kernel/start"),
  [...(debugMaps ? ["-debug"] : []), "-slot", "2", ...kernelIncludes.flatMap((dir) => ["-I", dir]), "-I", path.resolve(product, "System/Loader"), "-I", memory, "-I", board, "-I", nicDriver],
);

const userIncludes = ["-pie", "-slot", "0", "-I", memory, "-I", board, "-I", nicDriver, "-I", timeDriver];
const proc = path.resolve(lib, "obr.proc.obr");
const text = path.resolve(lib, "obr.text.obr");
const base = path.resolve(lib, "obr.base.obr");

compile(
  [path.resolve(product, "System/Init/init.obr"), proc, text],
  path.resolve(root, "kernel/init"),
  userIncludes,
);
function walkFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.resolve(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
}

function includeArgs(dir) {
  const dirs = [];
  function visit(current) {
    dirs.push(current);
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        visit(path.resolve(current, entry.name));
      }
    }
  }
  visit(dir);
  return dirs.flatMap((item) => ["-I", item]);
}

const appRoot = path.resolve(product, "Resource/App");
const guestLibs = ["obr.line.obr", "obr.path.obr", "obr.oct.obr"].map((name) => path.resolve(lib, name));
for (const entry of fs.readdirSync(appRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) {
    continue;
  }
  const dir = path.resolve(appRoot, entry.name);
  const files = [];
  walkFiles(dir, files);
  const obrs = files.filter((full) => full.endsWith(".obr"));
  const checks = obrs.filter((full) => path.basename(full).endsWith("-check.obr"));
  const bodies = obrs.filter((full) => !path.basename(full).endsWith("-check.obr"));
  let mainFile = null;
  const extras = [];
  for (const full of bodies) {
    const source = fs.readFileSync(full, "utf8");
    if (source.includes("deRfun main")) {
      if (mainFile !== null) {
        throw new Error(`${entry.name} 里有两份 main`);
      }
      mainFile = full;
    } else {
      extras.push(full);
    }
  }
  if (mainFile !== null) {
    const guest = entry.name === "sh" ? path.resolve(root, "os/sh") : path.resolve(root, "app", entry.name);
    const debug = debugMaps && entry.name === "sh" ? ["-debug"] : [];
    compile([mainFile, ...extras, proc], guest, [...debug, ...userIncludes, ...includeArgs(dir)]);
  }
  for (const full of checks) {
    const checkDir = fs.mkdtempSync(path.join(os.tmpdir(), "zeros-app-"));
    try {
      compile(
        [full, ...extras, ...guestLibs],
        path.resolve(checkDir, path.basename(full).slice(0, -4)),
        [...includeArgs(dir), "-I", memory],
      );
    } finally {
      fs.rmSync(checkDir, { recursive: true, force: true });
    }
  }
}
compile(
  [path.resolve(product, "System/Session/session.obr"), proc, text],
  path.resolve(root, "os/session"),
  userIncludes,
);
compile(
  [path.resolve(product, "System/Display/display.obr"), proc],
  path.resolve(root, "os/display"),
  userIncludes,
);
compile(
  [path.resolve(kernel, "Idle/idle.obr")],
  path.resolve(root, "kernel/idle"),
  userIncludes,
);
compile(
  [path.resolve(kernel, "Drv/pulse.obr")],
  path.resolve(root, "kernel/drv/pulse"),
  userIncludes,
);

compile(
  [path.resolve(lib, "obr.print.obr"), proc],
  path.resolve(root, "lib/obr.print"),
  ["-shared", "-slot", "0", "-I", memory, "-I", board],
);
for (const name of ["obr.oct", "obr.path", "obr.line"]) {
  compile(
    [path.resolve(lib, `${name}.obr`)],
    path.resolve(root, "lib", name),
    ["-shared", "-slot", "0", "-I", memory, "-I", board],
  );
}
compile(
  [path.resolve(nicDriver, "niclib.obr")],
  path.resolve(root, "lib/nic"),
  ["-shared", "-slot", "0", "-I", nicDriver, "-I", memory, "-I", board],
);
compile(
  [path.resolve(nicDriver, "niclib.obr")],
  path.resolve(root, "lib/nicflat"),
  ["-shared", "-flat", "-slot", "0", "-I", nicDriver, "-I", memory, "-I", board],
);
compile(
  [path.resolve(timeDriver, "time.obr"), proc],
  path.resolve(root, "lib/time"),
  ["-shared", "-slot", "0", "-I", timeDriver, "-I", memory, "-I", board],
);
/* 网卡热驱动测试程序。.zo 是标准 Obr PIE；版本放在文件名里。 */
const zoDir = path.resolve(root, "drivers");
fs.mkdirSync(zoDir, { recursive: true });
const zoV1 = path.resolve(zoDir, "nic-v1.zo");
const zoV2 = path.resolve(zoDir, "nic-v2.zo");
compile([path.resolve(nicDriver, "niczo.obr")], zoV1, [...userIncludes, "-flat"]);
fs.copyFileSync(zoV1, zoV2);
fs.chmodSync(zoV1, 0o755);
fs.chmodSync(zoV2, 0o755);
compile(
  [path.resolve(nicDriver, "flatmark.obr")],
  path.resolve(zoDir, "flat-v1.zo"),
  [...userIncludes, "-flat"],
);
fs.chmodSync(path.resolve(zoDir, "flat-v1.zo"), 0o755);
/* 150 任务运行红测的工作负载：flat yield 循环，跑完即退。 */
const zoLoop = path.resolve(zoDir, "flatloop.zo");
compile([path.resolve(nicDriver, "flatloop.obr")], zoLoop, [...userIncludes, "-flat"]);
fs.chmodSync(zoLoop, 0o755);
compile([path.resolve(nicDriver, "handover.obr")], path.resolve(zoDir, "handover.zo"), [...userIncludes, "-flat"]);
fs.chmodSync(path.resolve(zoDir, "handover.zo"), 0o755);
compile([path.resolve(nicDriver, "holdover.obr")], path.resolve(zoDir, "holdover.zo"), [...userIncludes, "-flat"]);
fs.chmodSync(path.resolve(zoDir, "holdover.zo"), 0o755);
compile([path.resolve(nicDriver, "inputdev.obr")], path.resolve(zoDir, "inputdev.zo"), [...userIncludes, "-flat"]);
fs.chmodSync(path.resolve(zoDir, "inputdev.zo"), 0o755);
compile([path.resolve(nicDriver, "kbd.obr")], path.resolve(zoDir, "kbd.zo"), [...userIncludes, "-flat"]);
fs.chmodSync(path.resolve(zoDir, "kbd.zo"), 0o755);
compile([path.resolve(nicDriver, "mouse.obr")], path.resolve(zoDir, "mouse.zo"), [...userIncludes, "-flat"]);
compile([path.resolve(nicDriver, "gpu.obr")], path.resolve(zoDir, "gpu.zo"), [...userIncludes, "-flat"]);
compile([path.resolve(nicDriver, "gpuflat.obr")], path.resolve(zoDir, "gpuflat.zo"), [...userIncludes, "-flat"]);
compile([path.resolve(nicDriver, "flatwrite.obr")], path.resolve(zoDir, "flatwrite.zo"), [...userIncludes, "-flat"]);
fs.chmodSync(path.resolve(zoDir, "flatwrite.zo"), 0o755);
fs.chmodSync(path.resolve(zoDir, "gpuflat.zo"), 0o755);
fs.chmodSync(path.resolve(zoDir, "gpu.zo"), 0o755);
fs.chmodSync(path.resolve(zoDir, "mouse.zo"), 0o755);
for (const plain of ["plaina", "plainb", "plainc", "bad", "depbad", "capbad"]) {
  compile([path.resolve(nicDriver, `${plain}.obr`)], path.resolve(zoDir, `${plain}.zo`), [...userIncludes, "-flat"]);
  fs.chmodSync(path.resolve(zoDir, `${plain}.zo`), 0o755);
}

const bin = path.resolve(product, "Resource/Bin");
const arg = path.resolve(bin, "arg.obr");
const names = fs.readdirSync(bin).filter((name) => name.endsWith(".obr") && name !== "arg.obr");
for (const name of names) {
  const source = fs.readFileSync(path.resolve(bin, name), "utf8");
  if (!source.includes("deRfun main")) {
    continue;
  }
  const guest = name.slice(0, -4);
  const extra = [];
  if (source.includes("import obr.text")) {
    extra.push(text);
  }
  if (source.includes("import obr.base")) {
    extra.push(base);
  }
  /* Bin/lib 下的公共源：按 import 追加，老命令不 import 就不进编译单元。
     同一公共源可能被多条 import 规则命中（如 binutil+nqslib），去重防重复定义。 */
  const binlib = path.resolve(bin, "lib", "binutil.obr");
  if (source.includes("import binutil") || source.includes("import terminfo") || source.includes("import sccslib") || source.includes("import nqslib")) {
    extra.push(binlib);
  }
  if (source.includes("import terminfo")) {
    extra.push(path.resolve(bin, "lib", "terminfo.obr"));
  }
  if (source.includes("import nqslib")) {
    extra.push(path.resolve(bin, "lib", "nqslib.obr"));
  }
  if (source.includes("import editlib")) {
    extra.push(path.resolve(bin, "lib", "editlib.obr"));
  }
  if (source.includes("import sccslib")) {
    extra.push(path.resolve(bin, "lib", "sccslib.obr"));
  }
  compile(
    [path.resolve(bin, name), arg, proc, ...extra],
    path.resolve(root, "bin", guest),
    [...userIncludes, "-I", bin],
  );
}

const provision = spawnSync(process.execPath, [path.resolve(here, "provision.mjs")], { encoding: "utf8" });
if (provision.status !== 0) {
  const detail = (provision.stderr || provision.stdout || provision.error?.message || "provision 失败").trim();
  throw new Error(detail);
}
