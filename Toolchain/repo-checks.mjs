/**
 * 不启动浏览器的仓库检查。
 * 快照要看见宿主在外面新增和改名。
 * 语料夹具要能种进一个空的客根。
 * 没有 .cursor 的目录不是一致性失败。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
    const text = fs.readFileSync(path.join(root, "home", "test.txt"), "utf8");
    if (!text.startsWith("Hello\n")) {
      fail("夹具 /home/test.txt 不是 Hello");
    }
    const packed = fs.readFileSync(path.join(root, "home", "zz.Z"));
    if (packed[0] !== 31 || packed[1] !== 157) {
      fail("夹具 /home/zz.Z 没有 compress 头");
    }
    if (!fs.existsSync(path.join(root, "home", "lib.a"))) {
      fail("夹具没有 /home/lib.a");
    }
    if (!fs.existsSync(path.join(root, "share", "man", "ls"))) {
      fail("夹具没有 /share/man/ls");
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
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

checkSnapshot();
checkPlant();
checkFreshCursor();
if (process.exitCode === 1) {
  process.stderr.write("repo-checks failed\n");
} else {
  process.stdout.write(`repo-checks ok ${here}\n`);
}
