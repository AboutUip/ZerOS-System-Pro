/**
 * 客根下的文件树。
 * 状态码与 ZNP1 一致：0 成功，2 没有，3 不是目录，4 是目录，5 句柄不行，
 * 6 名字非法，7 超出上界，8 内部失败，11 已存在，12 目录非空，13 参数不行。
 * 客路径 `/` 就是调用者给出的根目录，不是宿主操作系统的根。
 */

import fs from "node:fs";
import path from "node:path";

const PathMax = 240;
const TransferCeil = 268435456;
const HandleMax = 32;

const StatusOk = 0;
const StatusNotFound = 2;
const StatusNotDirectory = 3;
const StatusIsDirectory = 4;
const StatusBadHandle = 5;
const StatusBadName = 6;
const StatusTooLong = 7;
const StatusIo = 8;
const StatusExists = 11;
const StatusNotEmpty = 12;
const StatusBadArgument = 13;

const KindFile = 1;
const KindDirectory = 2;

function emptyReply(status) {
  return { status, kind: 0, size: 0, handle: 0, name: "", data: "", length: 0 };
}

function mapError(error) {
  const code = typeof error === "object" && error !== null ? error.code : "";
  if (code === "ENOENT") {
    return StatusNotFound;
  }
  if (code === "ENOTDIR") {
    return StatusNotDirectory;
  }
  if (code === "EISDIR") {
    return StatusIsDirectory;
  }
  if (code === "EEXIST") {
    return StatusExists;
  }
  if (code === "ENOTEMPTY") {
    return StatusNotEmpty;
  }
  if (code === "EINVAL" || code === "ENAMETOOLONG") {
    return StatusBadName;
  }
  return StatusIo;
}

/**
 * 把客路径折进根目录。
 * `..` 不能离开根。`\` 和 `:` 是非法名字，避免宿主路径把它们当成分隔符。
 */
function resolveGuest(root, guestPath) {
  if (typeof guestPath !== "string") {
    return { status: StatusBadArgument };
  }
  const encoded = Buffer.from(guestPath, "utf8");
  if (encoded.length > PathMax) {
    return { status: StatusTooLong };
  }
  if (guestPath.includes("\0") || guestPath.includes("\\") || guestPath.includes(":")) {
    return { status: StatusBadName };
  }
  const parts = [];
  for (const segment of guestPath.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (parts.length === 0) {
        return { status: StatusBadName };
      }
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  const target = path.resolve(root, ...parts);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return { status: StatusBadName };
  }
  return { path: target };
}

function look(target) {
  let info;
  try {
    info = fs.lstatSync(target);
  } catch (error) {
    return { status: mapError(error) };
  }
  if (info.isSymbolicLink()) {
    return { status: StatusIo };
  }
  if (info.isDirectory()) {
    return { status: StatusOk, kind: KindDirectory, size: 0, info };
  }
  if (info.isFile()) {
    if (info.size > 0xffffffff) {
      return { status: StatusTooLong };
    }
    return { status: StatusOk, kind: KindFile, size: info.size, info };
  }
  return { status: StatusIo };
}

export function createStore(root) {
  const base = path.resolve(root);
  fs.mkdirSync(base, { recursive: true });
  const handles = new Map();

  function allocHandle(fd, mode) {
    if (handles.size >= HandleMax) {
      return 0;
    }
    for (let id = 1; id <= HandleMax; id += 1) {
      if (!handles.has(id)) {
        handles.set(id, { fd, mode });
        return id;
      }
    }
    return 0;
  }

  function takeHandle(id, writing) {
    if (typeof id !== "number" || !Number.isInteger(id)) {
      return { status: StatusBadHandle };
    }
    const open = handles.get(id);
    if (open === undefined) {
      return { status: StatusBadHandle };
    }
    const canRead = open.mode === 0 || open.mode === 2;
    const canWrite = open.mode === 1 || open.mode === 2 || open.mode === 3;
    if (writing && !canWrite) {
      return { status: StatusBadHandle };
    }
    if (!writing && !canRead) {
      return { status: StatusBadHandle };
    }
    return { status: StatusOk, open };
  }

  function call(request) {
    if (typeof request !== "object" || request === null) {
      return emptyReply(StatusBadArgument);
    }
    const op = request.op;
    if (op === "ping") {
      return emptyReply(StatusOk);
    }
    if (op === "stat" || op === "mkdir" || op === "remove" || op === "open" || op === "readdir") {
      const located = resolveGuest(base, request.path);
      if (located.status !== undefined) {
        return emptyReply(located.status);
      }
      if (op === "stat") {
        const seen = look(located.path);
        if (seen.status !== StatusOk) {
          return emptyReply(seen.status);
        }
        return { ...emptyReply(StatusOk), kind: seen.kind, size: seen.size };
      }
      if (op === "mkdir") {
        try {
          fs.mkdirSync(located.path);
        } catch (error) {
          return emptyReply(mapError(error));
        }
        return emptyReply(StatusOk);
      }
      if (op === "remove") {
        const seen = look(located.path);
        if (seen.status !== StatusOk) {
          return emptyReply(seen.status);
        }
        try {
          if (seen.kind === KindDirectory) {
            fs.rmdirSync(located.path);
          } else {
            fs.unlinkSync(located.path);
          }
        } catch (error) {
          return emptyReply(mapError(error));
        }
        return emptyReply(StatusOk);
      }
      if (op === "readdir") {
        const seen = look(located.path);
        if (seen.status !== StatusOk) {
          return emptyReply(seen.status);
        }
        if (seen.kind !== KindDirectory) {
          return emptyReply(StatusNotDirectory);
        }
        const index = request.index;
        if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
          return emptyReply(StatusBadArgument);
        }
        let names;
        try {
          names = fs.readdirSync(located.path, { withFileTypes: true });
        } catch (error) {
          return emptyReply(mapError(error));
        }
        const listed = [];
        for (const entry of names) {
          if (entry.isSymbolicLink()) {
            continue;
          }
          if (!entry.isFile() && !entry.isDirectory()) {
            continue;
          }
          listed.push(entry.name);
        }
        listed.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
        const name = listed[index];
        if (name === undefined) {
          return emptyReply(StatusNotFound);
        }
        if (Buffer.byteLength(name) > PathMax) {
          return emptyReply(StatusTooLong);
        }
        return { ...emptyReply(StatusOk), name, length: Buffer.byteLength(name) };
      }
      const mode = request.mode;
      if (typeof mode !== "number" || !Number.isInteger(mode) || mode < 0 || mode > 3) {
        return emptyReply(StatusBadArgument);
      }
      const seen = look(located.path);
      if (seen.status === StatusOk && seen.kind === KindDirectory) {
        return emptyReply(StatusIsDirectory);
      }
      if (mode === 0 && seen.status !== StatusOk) {
        return emptyReply(seen.status);
      }
      if (seen.status !== StatusOk && seen.status !== StatusNotFound) {
        return emptyReply(seen.status);
      }
      const flag = mode === 0 ? "r" : mode === 1 ? "w" : mode === 2 ? (seen.status === StatusNotFound ? "w+" : "r+") : "a";
      let fd;
      try {
        fd = fs.openSync(located.path, flag);
      } catch (error) {
        return emptyReply(mapError(error));
      }
      const id = allocHandle(fd, mode);
      if (id === 0) {
        fs.closeSync(fd);
        return emptyReply(StatusTooLong);
      }
      return { ...emptyReply(StatusOk), handle: id };
    }
    if (op === "close") {
      const open = handles.get(request.handle);
      if (open === undefined) {
        return emptyReply(StatusBadHandle);
      }
      handles.delete(request.handle);
      try {
        fs.closeSync(open.fd);
      } catch (error) {
        return emptyReply(mapError(error));
      }
      return emptyReply(StatusOk);
    }
    if (op === "read" || op === "write") {
      const taken = takeHandle(request.handle, op === "write");
      if (taken.status !== StatusOk) {
        return emptyReply(taken.status);
      }
      const open = taken.open;
      if (op === "read") {
        const offset = request.offset;
        const length = request.length;
        if (typeof offset !== "number" || typeof length !== "number" || !Number.isInteger(offset) || !Number.isInteger(length)) {
          return emptyReply(StatusBadArgument);
        }
        if (offset < 0 || length < 0 || length > TransferCeil) {
          return emptyReply(length > TransferCeil ? StatusTooLong : StatusBadArgument);
        }
        const buffer = Buffer.alloc(length);
        let filled = 0;
        try {
          while (filled < length) {
            const got = fs.readSync(open.fd, buffer, filled, length - filled, offset + filled);
            if (got === 0) {
              break;
            }
            filled += got;
          }
        } catch (error) {
          return emptyReply(mapError(error));
        }
        return { ...emptyReply(StatusOk), data: buffer.subarray(0, filled).toString("base64"), length: filled };
      }
      const offset = request.offset;
      const encoded = typeof request.data === "string" ? request.data : "";
      let bytes;
      try {
        bytes = Buffer.from(encoded, "base64");
      } catch {
        return emptyReply(StatusIo);
      }
      if (bytes.length > TransferCeil) {
        return emptyReply(StatusTooLong);
      }
      if (typeof offset !== "number" || !Number.isInteger(offset) || offset < 0) {
        return emptyReply(StatusBadArgument);
      }
      let filled = 0;
      try {
        while (filled < bytes.length) {
          const wrote = open.mode === 3
            ? fs.writeSync(open.fd, bytes, filled, bytes.length - filled)
            : fs.writeSync(open.fd, bytes, filled, bytes.length - filled, offset + filled);
          if (wrote <= 0) {
            return emptyReply(StatusIo);
          }
          filled += wrote;
        }
      } catch (error) {
        return emptyReply(mapError(error));
      }
      return { ...emptyReply(StatusOk), length: filled };
    }
    if (op === "rename") {
      const source = resolveGuest(base, request.from);
      if (source.status !== undefined) {
        return emptyReply(source.status);
      }
      const dest = resolveGuest(base, request.to);
      if (dest.status !== undefined) {
        return emptyReply(dest.status);
      }
      const fromSeen = look(source.path);
      if (fromSeen.status !== StatusOk) {
        return emptyReply(fromSeen.status);
      }
      const toSeen = look(dest.path);
      if (toSeen.status !== StatusOk && toSeen.status !== StatusNotFound) {
        return emptyReply(toSeen.status);
      }
      if (toSeen.status === StatusOk) {
        if (fromSeen.kind !== toSeen.kind) {
          return emptyReply(StatusIo);
        }
        try {
          if (toSeen.kind === KindDirectory) {
            fs.rmdirSync(dest.path);
          } else {
            fs.unlinkSync(dest.path);
          }
        } catch (error) {
          return emptyReply(mapError(error));
        }
      }
      try {
        fs.renameSync(source.path, dest.path);
      } catch (error) {
        return emptyReply(mapError(error));
      }
      return emptyReply(StatusOk);
    }
    return emptyReply(StatusBadArgument);
  }

  function closeAll() {
    for (const open of handles.values()) {
      try {
        fs.closeSync(open.fd);
      } catch {
        /* 自检收尾，关闭失败不影响已经做完的断言。 */
      }
    }
    handles.clear();
  }

  return { call, closeAll };
}
