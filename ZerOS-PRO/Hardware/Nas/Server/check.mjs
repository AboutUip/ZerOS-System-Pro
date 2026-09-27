/**
 * 核对客根不能逃出，以及读写真的落在给出的目录里。
 * 运行：node ZerOS-PRO/Hardware/Nas/Server/check.mjs
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createStore } from "./nas-fs.mjs";
import { startServer } from "./serve.mjs";

let failed = 0;

function expect(condition, message) {
  if (!condition) {
    process.stderr.write(`${message}\n`);
    failed += 1;
  }
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "zeros-nas-"));
const store = createStore(temp);

expect(store.call({ op: "ping" }).status === 0, "ping 没有成功");
expect(store.call({ op: "mkdir", path: "/../outside" }).status === 6, "路径逃出客根仍被接受");
expect(store.call({ op: "mkdir", path: "/docs" }).status === 0, "创建目录失败");
expect(store.call({ op: "mkdir", path: "/docs" }).status === 11, "重复创建没有报已存在");

const opened = store.call({ op: "open", path: "/docs/note.txt", mode: 1 });
expect(opened.status === 0 && opened.handle > 0, "创建文件失败");
const written = store.call({
  op: "write",
  handle: opened.handle,
  offset: 0,
  data: Buffer.from("hello", "utf8").toString("base64"),
});
expect(written.status === 0 && written.length === 5, "写入长度不是 5");
expect(store.call({ op: "close", handle: opened.handle }).status === 0, "关闭失败");

const reading = store.call({ op: "open", path: "/docs/note.txt", mode: 0 });
const data = store.call({ op: "read", handle: reading.handle, offset: 0, length: 16 });
expect(data.status === 0 && Buffer.from(data.data, "base64").toString("utf8") === "hello", "读回的内容不是 hello");
expect(store.call({ op: "close", handle: reading.handle }).status === 0, "读句柄关闭失败");

const listed = store.call({ op: "readdir", path: "/docs", index: 0 });
expect(listed.status === 0 && listed.name === "note.txt", "目录第一项不是 note.txt");
expect(store.call({ op: "readdir", path: "/docs", index: 1 }).status === 2, "目录末尾之后不是未找到");

const seen = store.call({ op: "stat", path: "/docs/note.txt" });
expect(seen.status === 0 && seen.kind === 1 && seen.size === 5, "查看文件的种类或大小不对");
expect(store.call({ op: "stat", path: "/docs" }).kind === 2, "目录种类不是 2");

expect(store.call({ op: "rename", from: "/docs/note.txt", to: "/docs/moved.txt" }).status === 0, "改名失败");
expect(store.call({ op: "stat", path: "/docs/moved.txt" }).status === 0, "改名后的路径不存在");
expect(store.call({ op: "remove", path: "/docs/moved.txt" }).status === 0, "删除文件失败");
expect(store.call({ op: "remove", path: "/docs" }).status === 0, "删除空目录失败");
expect(fs.existsSync(path.join(temp, "docs")) === false, "客根里还留着 docs");
expect(store.call({ op: "open", path: "C:/windows", mode: 0 }).status === 6, "盘符路径被接受");

store.closeAll();

const started = await startServer(temp, 0);
const body = await new Promise((resolve, reject) => {
  const socket = new WebSocket(`ws://127.0.0.1:${String(started.port)}/fs`);
  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ op: "ping" }));
  });
  socket.addEventListener("message", (event) => {
    try {
      resolve(JSON.parse(String(event.data)));
    } catch (error) {
      reject(error instanceof Error ? error : new Error("json"));
    }
    socket.close();
  });
  socket.addEventListener("error", () => {
    reject(new Error("websocket"));
  });
});
expect(body.status === 0, "WebSocket ping 没有成功");
started.store.closeAll();
await new Promise((resolve, reject) => {
  started.server.close((error) => {
    if (error instanceof Error) {
      reject(error);
      return;
    }
    resolve();
  });
});
fs.rmSync(temp, { recursive: true, force: true });

if (failed > 0) {
  process.stderr.write(`${String(failed)} 项没通过\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("nas fs ok\n");
}
