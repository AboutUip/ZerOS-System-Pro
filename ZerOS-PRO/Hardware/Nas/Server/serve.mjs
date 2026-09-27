/**
 * 独立的 NAS 进程。
 * 不由页面、也不由 npm run dev 启动。数据目录是本文件旁的 Root。
 * 客路径 `/` 就是那个目录。
 *
 * 启动：node ZerOS-PRO/Hardware/Nas/Server/serve.mjs
 */

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createStore } from "./nas-fs.mjs";

const Host = "127.0.0.1";
const Port = 8765;
/** base64(搬运上界) 再加 JSON 外壳。超过就关掉，避免按声明长度分配。 */
const FrameMax = 402653184;
const AcceptGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function acceptKey(key) {
  return crypto.createHash("sha1").update(key + AcceptGuid).digest("base64");
}

function sendFrame(socket, opcode, payload) {
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(length, 6);
  }
  socket.write(Buffer.concat([header, payload]));
}

/**
 * 一条连接上的文本帧按顺序交给 store。
 * 客户端的帧带掩码。超过 FrameMax 就关掉，不解析半截 JSON。
 */
function readFrames(store, socket) {
  let buffer = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let length = buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) {
          return;
        }
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) {
          return;
        }
        if (buffer.readUInt32BE(2) !== 0) {
          socket.destroy();
          return;
        }
        length = buffer.readUInt32BE(6);
        offset = 10;
      }
      if (length > FrameMax) {
        socket.destroy();
        return;
      }
      const maskLength = masked ? 4 : 0;
      if (buffer.length < offset + maskLength + length) {
        return;
      }
      const payload = Buffer.alloc(length);
      const dataStart = offset + maskLength;
      if (masked) {
        const mask = buffer.subarray(offset, dataStart);
        const data = buffer.subarray(dataStart, dataStart + length);
        for (let index = 0; index < length; index += 1) {
          payload[index] = data[index] ^ mask[index & 3];
        }
      } else {
        buffer.copy(payload, 0, dataStart, dataStart + length);
      }
      buffer = buffer.subarray(dataStart + length);
      if (opcode === 0x8) {
        socket.end();
        return;
      }
      if (opcode === 0x9) {
        sendFrame(socket, 0x0a, payload);
        continue;
      }
      if (opcode !== 0x1) {
        continue;
      }
      let parsed;
      try {
        parsed = JSON.parse(payload.toString("utf8"));
      } catch {
        sendFrame(socket, 0x1, Buffer.from(JSON.stringify({ status: 13, kind: 0, size: 0, handle: 0, name: "", data: "", length: 0 }), "utf8"));
        continue;
      }
      sendFrame(socket, 0x1, Buffer.from(JSON.stringify(store.call(parsed)), "utf8"));
    }
  });
}

function attach(store, request, socket) {
  const upgrade = request.headers.upgrade;
  const key = request.headers["sec-websocket-key"];
  if (request.url !== "/fs" || typeof upgrade !== "string" || upgrade.toLowerCase() !== "websocket" || typeof key !== "string") {
    socket.destroy();
    return;
  }
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
  );
  readFrames(store, socket);
}

/**
 * 在指定端口听。端口 0 由系统分配，自检用它，避免占用 8765。
 * 正式启动固定 8765，与插头里的 ServiceUrl 相同。
 */
export function startServer(root, port) {
  const store = createStore(root);
  const sockets = new Set();
  const server = http.createServer((_request, response) => {
    response.writeHead(426, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("websocket");
  });
  server.on("upgrade", (request, socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
    attach(store, request, socket);
  });
  server.on("close", () => {
    for (const socket of sockets) {
      socket.destroy();
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, Host, () => {
      const address = server.address();
      const listening = typeof address === "object" && address !== null ? address.port : port;
      resolve({ server, port: listening, store });
    });
  });
}

function isDirectRun() {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  return pathToFileURL(path.resolve(entry)).href === pathToFileURL(fileURLToPath(import.meta.url)).href;
}

if (isDirectRun()) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../Root");
  fs.mkdirSync(root, { recursive: true });
  void startServer(root, Port).then((started) => {
    process.stdout.write(`ZNP1 NAS ws://${Host}:${String(started.port)}/fs\n${root}\n`);
  }).catch((error) => {
    const message = error instanceof Error ? error.message : "监听失败";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
