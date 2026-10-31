/**
 * 把内核和用户态编进 NAS 的客根。
 * 在仓库根目录执行：node ZerOS-PRO/Hardware/Nas/Server/build-guest.mjs
 *
 * 入口是 -slot 2 的原生映像。会装到核心 4 至 7 的程序是 -pie -slot 0。
 * Resource/Bin 里带 main 的每个 .obr 编成 /bin/同名文件，并链上 arg.obr 与 obr.proc.obr。
 * Resource/App 的每个子目录是一个程序：带 main 的那份是入口，同目录其余 .obr 链进去。
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
    path.resolve(kernel, "Sched/sched.obr"),
    path.resolve(kernel, "Fs/vfs.obr"),
    path.resolve(kernel, "Fs/pipe.obr"),
    path.resolve(kernel, "Fs/dev.obr"),
    path.resolve(kernel, "Fs/console.obr"),
    path.resolve(kernel, "Fs/comm.obr"),
    path.resolve(kernel, "Exec/exec.obr"),
    path.resolve(kernel, "Exec/boot.obr"),
    path.resolve(kernel, "Exec/spawn.obr"),
    path.resolve(kernel, "Font/font.obr"),
    path.resolve(kernel, "Text/utf8.obr"),
    path.resolve(kernel, "Test/suite.obr"),
    path.resolve(lib, "obr.nas.obr"),
  ],
  path.resolve(root, "kernel/start"),
  [...(debugMaps ? ["-debug"] : []), "-slot", "2", ...kernelIncludes.flatMap((dir) => ["-I", dir]), "-I", memory, "-I", board],
);

const userIncludes = ["-pie", "-slot", "0", "-I", memory, "-I", board];
const proc = path.resolve(lib, "obr.proc.obr");
const text = path.resolve(lib, "obr.text.obr");

compile(
  [path.resolve(product, "System/Init/init.obr"), proc, text],
  path.resolve(root, "kernel/init"),
  userIncludes,
);
const appRoot = path.resolve(product, "Resource/App");
for (const entry of fs.readdirSync(appRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) {
    continue;
  }
  const dir = path.resolve(appRoot, entry.name);
  const obrs = fs.readdirSync(dir).filter((name) => name.endsWith(".obr"));
  const checks = obrs.filter((name) => name.endsWith("-check.obr"));
  const bodies = obrs.filter((name) => !name.endsWith("-check.obr"));
  let mainFile = null;
  const extras = [];
  for (const name of bodies) {
    const full = path.resolve(dir, name);
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
    compile([mainFile, ...extras, proc], guest, [...debug, ...userIncludes, "-I", dir]);
  }
  for (const name of checks) {
    const checkDir = fs.mkdtempSync(path.join(os.tmpdir(), "zeros-app-"));
    try {
      compile(
        [path.resolve(dir, name), ...extras],
        path.resolve(checkDir, name.slice(0, -4)),
        ["-I", dir, "-I", memory],
      );
    } finally {
      fs.rmSync(checkDir, { recursive: true, force: true });
    }
  }
}
compile(
  [path.resolve(product, "System/Session/session.obr"), proc],
  path.resolve(root, "os/session"),
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

const bin = path.resolve(product, "Resource/Bin");
const arg = path.resolve(bin, "arg.obr");
const names = fs.readdirSync(bin).filter((name) => name.endsWith(".obr") && name !== "arg.obr");
for (const name of names) {
  const source = fs.readFileSync(path.resolve(bin, name), "utf8");
  if (!source.includes("deRfun main")) {
    continue;
  }
  const guest = name.slice(0, -4);
  compile(
    [path.resolve(bin, name), arg, proc],
    path.resolve(root, "bin", guest),
    [...userIncludes, "-I", bin],
  );
}

const provision = spawnSync(process.execPath, [path.resolve(here, "provision.mjs")], { encoding: "utf8" });
if (provision.status !== 0) {
  const detail = (provision.stderr || provision.stdout || provision.error?.message || "provision 失败").trim();
  throw new Error(detail);
}
