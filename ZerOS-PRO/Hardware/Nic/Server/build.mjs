/**
 * 编 Rust 网卡。零外部依赖，只用 cargo。
 * Windows 默认用 x86_64-pc-windows-gnu；本机缺 MSVC link.exe 时也能编。
 * 用法：
 *   node ZerOS-PRO/Hardware/Nic/Server/build.mjs
 *   node ZerOS-PRO/Hardware/Nic/Server/build.mjs --run
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const windows = process.platform === "win32";
const target = windows ? "x86_64-pc-windows-gnu" : null;
const args = ["build", "--release"];
if (target !== null) {
  args.push("--target", target);
}

const built = spawnSync("cargo", args, {
  cwd: here,
  encoding: "utf8",
  stdio: "inherit",
});
if (built.status !== 0) {
  if (windows) {
    process.stderr.write("cargo build 失败。Windows 需要 x86_64-pc-windows-gnu target：rustup target add x86_64-pc-windows-gnu\n");
  }
  process.exit(built.status ?? 1);
}

const binary = target === null
  ? path.join(here, "target", "release", "zeros-nic")
  : path.join(here, "target", target, "release", windows ? "zeros-nic.exe" : "zeros-nic");
if (!fs.existsSync(binary)) {
  process.stderr.write(`没有找到 ${binary}\n`);
  process.exit(1);
}
process.stdout.write(`${binary}\n`);

if (process.argv.includes("--run")) {
  const run = spawnSync(binary, process.argv.slice(process.argv.indexOf("--run") + 1), {
    cwd: here,
    stdio: "inherit",
  });
  process.exit(run.status ?? 0);
}
