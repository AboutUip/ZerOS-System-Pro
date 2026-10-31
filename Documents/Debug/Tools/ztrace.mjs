/**
 * ZerOS trace capture CLI。
 *
 * 用法：
 *   node Documents/Debug/Tools/ztrace.mjs [选项]
 *
 * 只依赖 Node 22+ 自带的 fetch / WebSocket，不引入外部包。
 * 从预览页读取 ZerOSDebug.trace 的报告、原始记录和状态，按命令写出 capture.json。
 * 不改 /boot/debug，不改客程序，也不生成 .debug。
 *
 * 主题：preflight -> 启动无头浏览器 -> CDP -> 等 term-up 和调试入口 -> 逐条命令抓取 -> 清理。
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../../..");
const DEBUG_REL = "ZerOS-PRO/Hardware/Nas/Root/boot/debug";
const DEBUG_PATH = path.join(REPO_ROOT, ...DEBUG_REL.split("/"));
const NAS_URL = "http://127.0.0.1:8765/";
const SCHEMA = "zeros.ztrace.capture/1";
const BOOT_TIMEOUT_MS = 120000;
const SURFACE_TIMEOUT_MS = 30000;
const PROMPT_TIMEOUT_MS = 30000;
const TARGET_TIMEOUT_MS = 30000;
const COLLECT_TIMEOUT_MS = 60000;

/* -------------------------------------------------------------------------- */
/* 入口                                                                       */
/* -------------------------------------------------------------------------- */

class CliError extends Error {}

class PreflightError extends Error {}

class TimeoutError extends Error {
  constructor(ms, label) {
    super(`timeout after ${ms}ms: ${label}`);
    this.name = "TimeoutError";
    this.timedOut = true;
  }
}

function usage() {
  return [
    "ZerOS trace capture",
    "",
    "用法：",
    "  node Documents/Debug/Tools/ztrace.mjs [选项]",
    "",
    "选项：",
    "  --command <text>   要输入的命令，可重复；省略时只抓启动报告",
    "  --out <dir>        输出目录，默认 ./ztrace-out（相对当前目录）",
    "  --timeout <ms>     每条命令的硬超时，默认 120000",
    "  --key-delay <ms>   每个字符的按键间隔，默认 500",
    "  --url <url>        预览地址，默认 http://localhost:5173/",
    "  --chrome <path>    浏览器可执行文件；省略时自动找 Chrome/Edge",
    "  --keep-going       命令超时或出错后继续下一条；默认中止",
    "  --help             显示本说明",
    "",
    "前置：",
    "  预览返回 200，NAS 返回 426，boot/debug 是单个字节 0x01",
    "",
    "示例：",
    '  node Documents/Debug/Tools/ztrace.mjs --out dev/Debug/ztrace-boot',
    '  node Documents/Debug/Tools/ztrace.mjs --command "seq 1 5" --out dev/Debug/ztrace-test --key-delay 200 --timeout 60000',
    '  node Documents/Debug/Tools/ztrace.mjs --command "id" --command "pwd"',
    "",
    "输出：capture.json、report.txt、capture.log",
  ].join("\n");
}

function parseInteger(value, flag, min) {
  if (!/^\d+$/.test(value)) {
    throw new CliError(`${flag} 需要非负整数，收到 ${JSON.stringify(value)}`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min) {
    throw new CliError(`${flag} 超出范围，收到 ${JSON.stringify(value)}`);
  }
  return number;
}

function parseArgs(argv) {
  const options = {
    commands: [],
    out: path.resolve(process.cwd(), "ztrace-out"),
    timeoutMs: 120000,
    keyDelay: 500,
    url: "http://localhost:5173/",
    chrome: null,
    keepGoing: false,
    help: false,
  };
  const valueFlags = new Set(["--command", "--out", "--timeout", "--key-delay", "--url", "--chrome"]);
  const noValueFlags = new Set(["--keep-going", "--help"]);

  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index] ?? "";
    const equal = raw.indexOf("=");
    const flag = equal >= 0 ? raw.slice(0, equal) : raw;
    if (!valueFlags.has(flag) && !noValueFlags.has(flag)) {
      throw new CliError(`未知参数 ${JSON.stringify(raw)}`);
    }
    if (noValueFlags.has(flag)) {
      if (equal >= 0) {
        throw new CliError(`${flag} 不接受值`);
      }
      if (flag === "--keep-going") options.keepGoing = true;
      else options.help = true;
      continue;
    }
    let value;
    if (equal >= 0) {
      value = raw.slice(equal + 1);
    } else {
      const next = argv[index + 1];
      if (next === undefined || (next.startsWith("--") && (valueFlags.has(next.split("=")[0]) || noValueFlags.has(next.split("=")[0])))) {
        throw new CliError(`${flag} 缺少值`);
      }
      value = next;
      index += 1;
    }
    if (flag === "--command") {
      options.commands.push(value);
    } else if (flag === "--out") {
      if (value.length === 0) throw new CliError("--out 不能为空");
      options.out = path.resolve(process.cwd(), value);
    } else if (flag === "--timeout") {
      options.timeoutMs = parseInteger(value, "--timeout", 1);
    } else if (flag === "--key-delay") {
      options.keyDelay = parseInteger(value, "--key-delay", 0);
    } else if (flag === "--url") {
      options.url = value;
    } else if (flag === "--chrome") {
      options.chrome = value;
    }
  }

  let parsed;
  try {
    parsed = new URL(options.url);
  } catch {
    throw new CliError(`--url 不是合法地址：${JSON.stringify(options.url)}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new CliError(`--url 只接受 http/https：${options.url}`);
  }
  return options;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function clip(text, limit = 400) {
  const oneLine = String(text).replace(/\s+/g, " ").trim();
  if (oneLine.length <= limit) return oneLine;
  return `${oneLine.slice(0, limit)}...`;
}

function displayPath(full) {
  const relative = path.relative(process.cwd(), full);
  if (relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.split(path.sep).join("/");
  }
  return full;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfAborted(signal) {
  if (signal?.aborted === true) {
    throw signal.reason instanceof Error ? signal.reason : new Error("aborted");
  }
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(ms, label));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/* -------------------------------------------------------------------------- */
/* preflight                                                                  */
/* -------------------------------------------------------------------------- */

async function checkHttp(url, expected, label) {
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  } catch (error) {
    throw new PreflightError(`${label} ${url} 不可达：${errorMessage(error)}`);
  }
  try {
    await response.body?.cancel();
  } catch {
    /* 只关心状态码，读不读正文都不影响。 */
  }
  if (response.status !== expected) {
    throw new PreflightError(`${label} ${url} 返回 ${String(response.status)}，需要 ${String(expected)}`);
  }
}

function checkDebugByte() {
  let stat;
  try {
    stat = fs.statSync(DEBUG_PATH);
  } catch (error) {
    throw new PreflightError(
      `debug 开关文件不可读：${DEBUG_REL}（${errorMessage(error)}）。请把它写成单个字节 0x01 后重试；本工具不会代为修改。`,
    );
  }
  if (!stat.isFile()) {
    throw new PreflightError(`debug 开关不是普通文件：${DEBUG_REL}。请把它写成单个字节 0x01；本工具不会代为修改。`);
  }
  let bytes;
  try {
    bytes = fs.readFileSync(DEBUG_PATH);
  } catch (error) {
    throw new PreflightError(`读取 debug 开关失败：${DEBUG_REL}（${errorMessage(error)}）`);
  }
  if (bytes.length !== 1 || bytes[0] !== 1) {
    const current =
      bytes.length === 0
        ? "空文件"
        : `长度 ${String(bytes.length)}，首字节 0x${(bytes[0] ?? 0).toString(16).padStart(2, "0")}`;
    throw new PreflightError(
      `debug 开关不是单个 0x01 字节（${current}）：${DEBUG_REL}。请把文件内容改成单个字节 01 后重试；本工具不会代为修改，也不会自动打开调试。`,
    );
  }
}

async function runPreflight(options, log) {
  await checkHttp(options.url, 200, "preview");
  await checkHttp(NAS_URL, 426, "NAS");
  checkDebugByte();
  log("preflight ok: preview=200 nas=426 debug=0x01");
}

/* -------------------------------------------------------------------------- */
/* 浏览器                                                                     */
/* -------------------------------------------------------------------------- */

function findOnPath(names) {
  const entries = (process.env.PATH ?? "").split(path.delimiter).filter((item) => item.length > 0);
  for (const directory of entries) {
    for (const name of names) {
      const full = path.join(directory, name);
      try {
        if (fs.statSync(full).isFile()) return full;
      } catch {
        /* 继续找。 */
      }
    }
  }
  return null;
}

function browserCandidates() {
  const candidates = [];
  const programFiles = process.env.ProgramFiles ?? process.env.PROGRAMFILES;
  const programFilesX86 = process.env["ProgramFiles(x86)"] ?? process.env["PROGRAMFILES(X86)"];
  const localAppData = process.env.LOCALAPPDATA;
  if (process.platform === "win32") {
    for (const base of [programFiles, programFilesX86, localAppData]) {
      if (base === undefined || base.length === 0) continue;
      candidates.push(path.join(base, "Google", "Chrome", "Application", "chrome.exe"));
      candidates.push(path.join(base, "Microsoft", "Edge", "Application", "msedge.exe"));
      candidates.push(path.join(base, "Chromium", "Application", "chrome.exe"));
    }
  } else if (process.platform === "darwin") {
    candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    candidates.push("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge");
    candidates.push("/Applications/Chromium.app/Contents/MacOS/Chromium");
  } else {
    candidates.push("/usr/bin/google-chrome");
    candidates.push("/usr/bin/google-chrome-stable");
    candidates.push("/usr/bin/chromium");
    candidates.push("/usr/bin/chromium-browser");
    candidates.push("/usr/bin/microsoft-edge");
    candidates.push("/usr/bin/microsoft-edge-stable");
  }
  return candidates;
}

function findBrowser(explicit) {
  if (explicit !== null) {
    if (!explicit.includes("/") && !explicit.includes("\\")) {
      const names = process.platform === "win32" ? [explicit, `${explicit}.exe`] : [explicit];
      const found = findOnPath(names);
      if (found !== null) return found;
    }
    const resolved = path.resolve(explicit);
    try {
      if (fs.statSync(resolved).isFile()) return resolved;
    } catch {
      /* 下面统一报错。 */
    }
    throw new Error(`--chrome 不存在或不是文件：${explicit}`);
  }

  for (const candidate of browserCandidates()) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* 继续找下一个。 */
    }
  }
  const names =
    process.platform === "win32"
      ? ["chrome.exe", "msedge.exe", "chromium.exe"]
      : ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "microsoft-edge-stable"];
  const found = findOnPath(names);
  if (found !== null) return found;
  throw new Error("找不到 Chrome/Edge；请用 --chrome 指定浏览器可执行文件");
}

function createTempUserDataDir() {
  const bases = [process.env.TEMP, process.env.TMP, os.tmpdir()].filter(
    (item) => typeof item === "string" && item.length > 0,
  );
  for (const base of bases) {
    const preferred = path.join(base, "opencode");
    try {
      fs.mkdirSync(preferred, { recursive: true });
      return fs.mkdtempSync(path.join(preferred, "zeros-ztrace-"));
    } catch {
      /* 换下一个临时目录。 */
    }
  }
  return fs.mkdtempSync(path.join(os.tmpdir(), "zeros-ztrace-"));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => {
          reject(new Error("无法分配浏览器调试端口"));
        });
        return;
      }
      const port = address.port;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

function startBrowser(browser, args, state) {
  const child = spawn(browser, args, {
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => {
    state.stderr = `${state.stderr}${chunk}`.slice(-4096);
  });
  child.on("error", (error) => {
    state.exited = true;
    state.spawnError = error;
  });
  child.on("exit", (code, signal) => {
    state.exited = true;
    state.exitCode = code;
    state.signal = signal;
  });
  return child;
}

function browserStateText(state) {
  if (state.spawnError !== null) return errorMessage(state.spawnError);
  const exit = state.signal === null ? `code=${String(state.exitCode)}` : `signal=${state.signal}`;
  const tail = state.stderr.length > 0 ? `；stderr: ${clip(state.stderr, 600)}` : "";
  return `浏览器已退出（${exit}）${tail}`;
}

function targetOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

async function waitForTarget(port, url, state) {
  const expected = targetOrigin(url);
  const endpoint = `http://127.0.0.1:${String(port)}/json/list`;
  const deadline = Date.now() + TARGET_TIMEOUT_MS;
  let lastError = "还没有调试目标";
  while (Date.now() < deadline) {
    if (state.exited) {
      throw new Error(browserStateText(state));
    }
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(1500) });
      if (!response.ok) {
        lastError = `调试端点返回 ${String(response.status)}`;
      } else {
        const list = await response.json();
        const pages = Array.isArray(list)
          ? list.filter((item) => item?.type === "page" && typeof item.webSocketDebuggerUrl === "string")
          : [];
        const preferred = pages.find((item) => {
          try {
            return new URL(item.url).origin === expected;
          } catch {
            return false;
          }
        });
        const target = preferred ?? pages[0];
        if (target !== undefined) return target;
        lastError = "没有 page 目标";
      }
    } catch (error) {
      lastError = errorMessage(error);
    }
    await sleep(200);
  }
  throw new Error(`等待浏览器调试目标超时（${String(TARGET_TIMEOUT_MS)}ms）：${clip(lastError)}`);
}

function connectWebSocket(wsUrl) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        socket.close();
      } catch {
        /* 已经失败，关闭只是尽力。 */
      }
      reject(new Error("连接 CDP WebSocket 超时"));
    }, 10000);
    socket.addEventListener(
      "open",
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(socket);
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      (event) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const detail = event?.message ?? event?.error?.message ?? "";
        reject(new Error(`CDP WebSocket 连接失败${detail.length > 0 ? `：${clip(detail)}` : ""}`));
      },
      { once: true },
    );
  });
}

function wsText(data) {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  return String(data);
}

function createCdp(socket) {
  let nextId = 1;
  let closed = false;
  const pending = new Map();

  function rejectPending(message) {
    for (const entry of pending.values()) {
      entry.cleanup();
      entry.reject(new Error(message));
    }
    pending.clear();
  }

  function settle(message) {
    const entry = pending.get(message.id);
    if (entry === undefined) return;
    pending.delete(message.id);
    entry.cleanup();
    if (message.error !== undefined) {
      const detail = message.error?.message ?? JSON.stringify(message.error);
      entry.reject(new Error(`${entry.method}: ${clip(detail)}`));
      return;
    }
    entry.resolve(message.result);
  }

  function handleText(text) {
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof message.id === "number") {
      settle(message);
    }
  }

  socket.addEventListener("message", (event) => {
    const data = event.data;
    if (typeof data === "string" || data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
      handleText(wsText(data));
      return;
    }
    if (data !== null && typeof data === "object" && typeof data.text === "function") {
      void data
        .text()
        .then(handleText)
        .catch(() => {
          /* 非文本消息不参与 CDP 请求应答。 */
        });
      return;
    }
    handleText(wsText(data));
  });

  socket.addEventListener("close", () => {
    closed = true;
    rejectPending("CDP 连接已关闭");
  });
  socket.addEventListener("error", () => {
    closed = true;
    rejectPending("CDP 连接出错");
  });

  function send(method, params = {}, signal) {
    return new Promise((resolve, reject) => {
      if (closed) {
        reject(new Error("CDP 连接已关闭"));
        return;
      }
      if (signal?.aborted === true) {
        reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
        return;
      }
      const id = nextId;
      nextId += 1;
      const onAbort = () => {
        if (!pending.delete(id)) return;
        reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
      };
      const cleanup = () => {
        signal?.removeEventListener("abort", onAbort);
      };
      pending.set(id, { method, resolve, reject, cleanup });
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        pending.delete(id);
        cleanup();
        reject(error);
      }
    });
  }

  async function evaluate(expression, signal) {
    const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, signal);
    if (response?.exceptionDetails !== undefined) {
      const detail = response.exceptionDetails;
      const description = detail.exception?.description ?? detail.text ?? "页面求值异常";
      throw new Error(`页面求值失败：${clip(description, 500)}`);
    }
    const remote = response?.result;
    if (remote === undefined || remote === null) {
      throw new Error("Runtime.evaluate 没有返回结果");
    }
    if (remote.type === "undefined") return undefined;
    if (typeof remote.unserializableValue === "string") {
      throw new Error(`Runtime.evaluate 返回不可序列化的值：${remote.unserializableValue}`);
    }
    if (!Object.prototype.hasOwnProperty.call(remote, "value")) {
      throw new Error(`Runtime.evaluate 没有可返回值（type=${String(remote.type)}）`);
    }
    return remote.value;
  }

  async function close() {
    rejectPending("CDP 连接正在关闭");
    if (closed) return;
    closed = true;
    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, 1000);
      socket.addEventListener("close", finish, { once: true });
      try {
        socket.close();
      } catch {
        finish();
      }
    });
  }

  return { send, evaluate, close };
}

/* -------------------------------------------------------------------------- */
/* 页面求值                                                                   */
/* -------------------------------------------------------------------------- */

const TRACE_SURFACE = `(() => {
  const api = globalThis.ZerOSDebug;
  if (api === null || typeof api !== "object") return null;
  const trace = api.trace;
  if (trace === null || typeof trace !== "object") return null;
  return {
    report: typeof trace.report,
    dump: typeof trace.dump,
    clear: typeof trace.clear,
    status: typeof trace.status,
  };
})()`;

const TRACE_STATUS = `(() => {
  const api = globalThis.ZerOSDebug;
  if (api === null || typeof api !== "object" || api.trace === null || typeof api.trace !== "object") return null;
  if (typeof api.trace.status !== "function") return null;
  return api.trace.status();
})()`;

const TRACE_REPORT = `(() => {
  const api = globalThis.ZerOSDebug;
  if (api === null || typeof api !== "object" || api.trace === null || typeof api.trace !== "object") {
    throw new Error("ZerOSDebug.trace.report 不可用");
  }
  return api.trace.report();
})()`;

const TRACE_DUMP = `(() => {
  const api = globalThis.ZerOSDebug;
  if (api === null || typeof api !== "object" || api.trace === null || typeof api.trace !== "object") {
    throw new Error("ZerOSDebug.trace.dump 不可用");
  }
  return api.trace.dump();
})()`;

const DEBUG_FAULTS = `(() => {
  const api = globalThis.ZerOSDebug;
  if (api === null || typeof api !== "object" || typeof api.faults !== "function") {
    throw new Error("ZerOSDebug.faults 不可用");
  }
  return api.faults();
})()`;

const TRACE_CLEAR = `(() => {
  const api = globalThis.ZerOSDebug;
  if (api === null || typeof api !== "object" || api.trace === null || typeof api.trace !== "object") {
    throw new Error("ZerOSDebug.trace.clear 不可用");
  }
  api.trace.clear();
  return true;
})()`;

const PAGE_HEALTH = `(() => {
  const boot = globalThis.__zerosBoot;
  const api = globalThis.ZerOSDebug;
  const booted = Array.isArray(boot) && boot.some((item) => item !== null && typeof item === "object" && item.Name === "term-up");
  return booted && api !== null && typeof api === "object" && api.trace !== null && typeof api.trace === "object";
})()`;

function normalizeStatus(value) {
  if (value === null || typeof value !== "object") {
    throw new Error("trace.status() 没有返回对象");
  }
  const keys = ["Records", "Pending", "Dropped", "Prompts"];
  const status = {};
  for (const key of keys) {
    const number = Number(value[key]);
    if (!Number.isFinite(number)) {
      throw new Error(`trace.status().${key} 不是数字`);
    }
    status[key] = number;
  }
  return status;
}

async function readStatus(cdp, signal) {
  const value = await cdp.evaluate(TRACE_STATUS, signal);
  if (value === null) throw new Error("ZerOSDebug.trace.status 不可用");
  return normalizeStatus(value);
}

async function readReport(cdp, signal) {
  const value = await cdp.evaluate(TRACE_REPORT, signal);
  if (typeof value !== "string") throw new Error("ZerOSDebug.trace.report() 没有返回文本");
  return value;
}

async function readDump(cdp, signal) {
  const value = await cdp.evaluate(TRACE_DUMP, signal);
  if (!Array.isArray(value)) throw new Error("ZerOSDebug.trace.dump() 没有返回数组");
  return value;
}

async function readFaults(cdp, signal) {
  const value = await cdp.evaluate(DEBUG_FAULTS, signal);
  if (!Array.isArray(value)) throw new Error("ZerOSDebug.faults() 没有返回数组");
  return value;
}

async function clearTrace(cdp, signal) {
  const value = await cdp.evaluate(TRACE_CLEAR, signal);
  if (value !== true) throw new Error("ZerOSDebug.trace.clear() 没有成功");
}

async function assertPage(cdp, signal) {
  const healthy = await cdp.evaluate(PAGE_HEALTH, signal);
  if (healthy !== true) {
    throw new Error("页面已丢失，或 ZerOSDebug 入口被摘掉；重新加载预览后再跑");
  }
}

async function waitForBoot(cdp) {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  let lastError = "";
  while (Date.now() < deadline) {
    let marks;
    try {
      marks = await withTimeout(
        cdp.evaluate(`(() => {
          const marks = globalThis.__zerosBoot;
          if (!Array.isArray(marks)) return null;
          return marks.map((item) => String(item && item.Name ? item.Name : ""));
        })()`),
        5000,
        "boot probe",
      );
    } catch (error) {
      lastError = errorMessage(error);
      marks = null;
    }
    if (Array.isArray(marks) && marks.includes("term-up")) return marks;
    await sleep(250);
  }
  throw new Error(
    `等待 __zerosBoot 出现 term-up 超时（${String(BOOT_TIMEOUT_MS)}ms）${lastError.length > 0 ? `：${clip(lastError)}` : ""}`,
  );
}

async function waitForSurface(cdp) {
  const deadline = Date.now() + SURFACE_TIMEOUT_MS;
  let lastError = "";
  let sawReport = false;
  while (Date.now() < deadline) {
    let surface;
    try {
      surface = await withTimeout(cdp.evaluate(TRACE_SURFACE), 5000, "surface probe");
    } catch (error) {
      lastError = errorMessage(error);
      surface = null;
    }
    if (surface !== null && typeof surface === "object") {
      sawReport = surface.report === "function";
      if (surface.dump !== "function") {
        throw new Error("ZerOSDebug.trace.dump 不可用；当前预览不是带 dump 的实现，先更新页面代码");
      }
      if (surface.report === "function" && surface.clear === "function" && surface.status === "function") {
        return;
      }
    }
    await sleep(200);
  }
  const hint = sawReport
    ? "trace 入口在，但 dump/clear/status 不完整"
    : "没有 ZerOSDebug；确认 /boot/debug 是字节 1 且页面已重新加载";
  throw new Error(`等待 ZerOSDebug 超时（${String(SURFACE_TIMEOUT_MS)}ms）：${hint}${lastError.length > 0 ? `：${clip(lastError)}` : ""}`);
}

/**
 * 等壳自己的第一条提示符。
 * term-up 可能早于提示符事件；不等这一条，启动期的提示符会在第一条命令的
 * clear 之后到达，把 Prompts 增量误当成命令完成。
 */
async function waitForInitialPrompt(cdp) {
  const deadline = Date.now() + PROMPT_TIMEOUT_MS;
  let lastError = "";
  while (Date.now() < deadline) {
    let status;
    try {
      status = await withTimeout(readStatus(cdp), 5000, "initial prompt probe");
    } catch (error) {
      lastError = errorMessage(error);
      status = null;
    }
    if (status !== null && status.Prompts > 0) return status;
    await sleep(100);
  }
  throw new Error(
    `等待初始提示符超时（${String(PROMPT_TIMEOUT_MS)}ms）：status().Prompts 仍为 0${lastError.length > 0 ? `；${clip(lastError)}` : ""}`,
  );
}

/* -------------------------------------------------------------------------- */
/* 键盘                                                                       */
/* -------------------------------------------------------------------------- */

const SHIFTED = {
  "!": ["Digit1", 49],
  "@": ["Digit2", 50],
  "#": ["Digit3", 51],
  "$": ["Digit4", 52],
  "%": ["Digit5", 53],
  "^": ["Digit6", 54],
  "&": ["Digit7", 55],
  "*": ["Digit8", 56],
  "(": ["Digit9", 57],
  ")": ["Digit0", 48],
  "_": ["Minus", 189],
  "+": ["Equal", 187],
  "{": ["BracketLeft", 219],
  "}": ["BracketRight", 221],
  "|": ["Backslash", 220],
  ":": ["Semicolon", 186],
  '"': ["Quote", 222],
  "<": ["Comma", 188],
  ">": ["Period", 190],
  "?": ["Slash", 191],
  "~": ["Backquote", 192],
};

const PLAIN = {
  " ": ["Space", 32],
  "-": ["Minus", 189],
  "=": ["Equal", 187],
  "[": ["BracketLeft", 219],
  "]": ["BracketRight", 221],
  "\\": ["Backslash", 220],
  ";": ["Semicolon", 186],
  "'": ["Quote", 222],
  ",": ["Comma", 188],
  ".": ["Period", 190],
  "/": ["Slash", 191],
  "`": ["Backquote", 192],
};

function keyInfo(character) {
  if (character >= "a" && character <= "z") {
    return { key: character, code: `Key${character.toUpperCase()}`, keyCode: character.toUpperCase().charCodeAt(0), shift: false };
  }
  if (character >= "A" && character <= "Z") {
    return { key: character, code: `Key${character}`, keyCode: character.charCodeAt(0), shift: true };
  }
  if (character >= "0" && character <= "9") {
    return { key: character, code: `Digit${character}`, keyCode: character.charCodeAt(0), shift: false };
  }
  const shifted = SHIFTED[character];
  if (shifted !== undefined) {
    return { key: character, code: shifted[0], keyCode: shifted[1], shift: true };
  }
  const plain = PLAIN[character];
  if (plain !== undefined) {
    return { key: character, code: plain[0], keyCode: plain[1], shift: false };
  }
  return null;
}

async function dispatchKey(cdp, type, info, signal) {
  await cdp.send(
    "Input.dispatchKeyEvent",
    {
      type,
      key: info.key,
      code: info.code,
      windowsVirtualKeyCode: info.keyCode,
      nativeVirtualKeyCode: info.keyCode,
      modifiers: info.shift ? 8 : 0,
    },
    signal,
  );
}

async function typeText(cdp, text, keyDelay, signal) {
  for (const character of Array.from(text)) {
    throwIfAborted(signal);
    const info = keyInfo(character);
    if (info === null) {
      const code = (character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0");
      throw new Error(`没有按键映射：U+${code}（${JSON.stringify(character)}）；当前只支持可打印 ASCII`);
    }
    await dispatchKey(cdp, "rawKeyDown", info, signal);
    await dispatchKey(cdp, "keyUp", info, signal);
    if (keyDelay > 0) await sleep(keyDelay, signal);
  }
}

async function pressEnter(cdp, signal) {
  const info = { key: "Enter", code: "Enter", keyCode: 13, shift: false };
  await dispatchKey(cdp, "rawKeyDown", info, signal);
  await dispatchKey(cdp, "keyUp", info, signal);
}

/* -------------------------------------------------------------------------- */
/* 命令                                                                       */
/* -------------------------------------------------------------------------- */

async function captureCommand(cdp, command, options, index, total) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new TimeoutError(options.timeoutMs, `command ${String(index + 1)}/${String(total)}`));
  }, options.timeoutMs);
  const signal = controller.signal;
  let lastStatus = null;

  try {
    await assertPage(cdp, signal);
    await clearTrace(cdp, signal);
    /* 清空之后 shell 可能还停在上一轮读循环的尾部；先让终端回到读状态再打字。 */
    await sleep(800, signal);
    const baseline = await readStatus(cdp, signal);
    lastStatus = baseline;
    await typeText(cdp, command, options.keyDelay, signal);
    await pressEnter(cdp, signal);

    let polls = 0;
    for (;;) {
      throwIfAborted(signal);
      const current = await readStatus(cdp, signal);
      lastStatus = current;
      if (current.Prompts > baseline.Prompts) break;
      polls += 1;
      /* 计数器在清空/并发写时可能落后；每秒用环里的 Prompt/CommandEnd 兜底。 */
      if (polls % 5 === 0) {
        const entries = await readDump(cdp, signal);
        if (entries.some((entry) => entry.Op === 6 || entry.Op === 8)) break;
      }
      await sleep(200, signal);
    }

    const report = await readReport(cdp, signal);
    const entries = await readDump(cdp, signal);
    const status = await readStatus(cdp, signal);
    const faults = await readFaults(cdp, signal);
    return {
      command,
      elapsedMs: Date.now() - started,
      status,
      report,
      entries,
      faults,
    };
  } catch (error) {
    const timedOut = error instanceof TimeoutError || error?.timedOut === true;
    return {
      command,
      elapsedMs: Date.now() - started,
      status: lastStatus,
      report: "",
      entries: [],
      faults: [],
      error: timedOut ? `timeout after ${String(options.timeoutMs)}ms` : clip(errorMessage(error), 800),
    };
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------------- */
/* 输出                                                                       */
/* -------------------------------------------------------------------------- */

function gitText(args) {
  const result = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", windowsHide: true });
  if (result.status !== 0 || typeof result.stdout !== "string") {
    return "";
  }
  return result.stdout.trim();
}

/** 采集头：版本、环境和源行表状态。没有 git/表时写空值，不编造。 */
function captureMetadata(browser, bootReport) {
  const dirty = gitText(["status", "--porcelain"]);
  const maps = /^  source maps: (.+)$/m.exec(bootReport);
  return {
    git: {
      commit: gitText(["rev-parse", "HEAD"]),
      describe: gitText(["describe", "--tags", "--always"]),
      dirty: dirty.length > 0,
    },
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      browser: path.basename(browser),
    },
    sourceMaps: maps === null ? "unknown" : maps[1].trim(),
  };
}

function buildReportText(capture) {
  const lines = [];
  lines.push("# boot");
  lines.push("");
  lines.push(capture.boot.report.trimEnd());
  for (let index = 0; index < capture.commands.length; index += 1) {
    const item = capture.commands[index];
    lines.push("");
    lines.push(`# command ${String(index + 1)}: ${item.command}`);
    lines.push("");
    if (typeof item.error === "string") {
      lines.push(`error: ${item.error}`);
      lines.push("");
    }
    lines.push(item.report.trimEnd());
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`ztrace: ${errorMessage(error)}\n\n${usage()}\n`);
    return 2;
  }
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor < 22 || typeof fetch !== "function" || typeof WebSocket !== "function") {
    process.stderr.write(`ztrace: 需要 Node 22 或更高版本（当前 ${process.versions.node}）\n`);
    return 1;
  }

  const startedAt = new Date().toISOString();
  let outDir;
  try {
    outDir = path.resolve(options.out);
    fs.mkdirSync(outDir, { recursive: true });
  } catch (error) {
    process.stderr.write(`ztrace: 无法建立输出目录 ${displayPath(options.out)}：${errorMessage(error)}\n`);
    return 1;
  }
  const logPath = path.join(outDir, "capture.log");
  try {
    fs.writeFileSync(logPath, "");
  } catch (error) {
    process.stderr.write(`ztrace: 无法写 capture.log：${errorMessage(error)}\n`);
    return 1;
  }

  const logLines = [];
  function log(message) {
    const line = `${new Date().toISOString()} ${message}`;
    logLines.push(line);
    try {
      fs.appendFileSync(logPath, `${line}\n`);
    } catch {
      /* 日志已进内存；最后还会整份重写。 */
    }
    process.stdout.write(`${line}\n`);
  }

  log(`ztrace start url=${options.url} out=${displayPath(outDir)}`);
  try {
    await runPreflight(options, log);
  } catch (error) {
    log(`preflight failed: ${clip(errorMessage(error), 800)}`);
    return 2;
  }

  let cdp = null;
  let child = null;
  let browserState = null;
  let userDataDir = null;
  let capture = null;
  let exitCode = 0;

  async function shutdown() {
    if (cdp !== null) {
      log("closing CDP");
      try {
        await cdp.close();
      } catch {
        /* 已经断开。 */
      }
      cdp = null;
    }
    if (child !== null && browserState !== null && !browserState.exited) {
      log("stopping browser");
      if (process.platform === "win32" && typeof child.pid === "number") {
        try {
          spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        } catch {
          /* 下面还会等退出。 */
        }
      } else {
        try {
          child.kill("SIGTERM");
        } catch {
          /* 下面还会等退出。 */
        }
      }
      const deadline = Date.now() + 3000;
      while (!browserState.exited && Date.now() < deadline) {
        await sleep(100);
      }
      if (!browserState.exited && process.platform !== "win32") {
        try {
          child.kill("SIGKILL");
        } catch {
          /* 尽力。 */
        }
        const forceDeadline = Date.now() + 1000;
        while (!browserState.exited && Date.now() < forceDeadline) {
          await sleep(100);
        }
      }
      if (!browserState.exited) log("warning: 浏览器进程没有在超时内退出");
    }
    if (userDataDir !== null) {
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        log("removed temp browser profile");
      } catch (error) {
        log(`warning: 临时浏览器目录未删除（${path.basename(userDataDir)}）：${clip(errorMessage(error), 300)}`);
      }
      userDataDir = null;
    }
  }

  let interrupted = false;
  const onSignal = () => {
    if (interrupted) return;
    interrupted = true;
    const line = `${new Date().toISOString()} interrupted by signal`;
    logLines.push(line);
    try {
      fs.appendFileSync(logPath, `${line}\n`);
    } catch {
      /* 尽力。 */
    }
    process.stderr.write(`${line}\n`);
    if (child !== null && browserState !== null && !browserState.exited) {
      if (process.platform === "win32" && typeof child.pid === "number") {
        try {
          spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        } catch {
          /* 尽力。 */
        }
      } else {
        try {
          child.kill("SIGKILL");
        } catch {
          /* 尽力。 */
        }
      }
    }
    if (userDataDir !== null) {
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      } catch {
        /* 尽力。 */
      }
    }
    process.exit(130);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    const browser = findBrowser(options.chrome);
    log(`browser=${path.basename(browser)}`);
    const port = await freePort();
    userDataDir = createTempUserDataDir();
    log(`temp profile=${path.basename(userDataDir)}`);
    browserState = { exited: false, exitCode: null, signal: null, stderr: "", spawnError: null };
    const args = [
      "--headless=new",
      `--remote-debugging-port=${String(port)}`,
      `--remote-allow-origins=*`,
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      /* 无 GPU 的 headless 环境用软件适配器；不改变页面看到的 VM 行为。 */
      "--enable-unsafe-swiftshader",
      "--enable-unsafe-webgpu",
      "--window-size=1280,800",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      options.url,
    ];
    child = startBrowser(browser, args, browserState);
    log(`browser launched pid=${String(child.pid ?? "?")} port=${String(port)}`);

    const target = await waitForTarget(port, options.url, browserState);
    const targetUrl = String(target.url ?? "");
    log(`target=${targetUrl}`);
    const socket = await connectWebSocket(target.webSocketDebuggerUrl);
    cdp = createCdp(socket);
    await withTimeout(cdp.send("Runtime.enable"), 10000, "Runtime.enable");
    await withTimeout(cdp.send("Page.enable"), 10000, "Page.enable");
    let sameUrl = false;
    try {
      sameUrl = new URL(targetUrl).href === new URL(options.url).href;
    } catch {
      sameUrl = false;
    }
    if (!sameUrl) {
      log(`navigating target to ${options.url}`);
      await withTimeout(cdp.send("Page.navigate", { url: options.url }), 10000, "Page.navigate");
    }
    log("CDP attached; waiting for boot");

    const marks = await waitForBoot(cdp);
    log(`boot term-up ok marks=${String(marks.length)}; waiting for ZerOSDebug`);
    await waitForSurface(cdp);
    log("debug surface ready; waiting for the initial prompt");
    await waitForInitialPrompt(cdp);

    const bootStatus = await withTimeout(readStatus(cdp), COLLECT_TIMEOUT_MS, "boot status");
    const bootReport = await withTimeout(readReport(cdp), COLLECT_TIMEOUT_MS, "boot report");
    const bootEntries = await withTimeout(readDump(cdp), COLLECT_TIMEOUT_MS, "boot entries");
    const bootFaults = await withTimeout(readFaults(cdp), COLLECT_TIMEOUT_MS, "boot faults");
    log(
      `boot report captured records=${String(bootStatus.Records)} prompts=${String(bootStatus.Prompts)} entries=${String(bootEntries.length)} faults=${String(bootFaults.length)} reportChars=${String(bootReport.length)}`,
    );

    const commands = [];
    const total = options.commands.length;
    for (let index = 0; index < total; index += 1) {
      const command = options.commands[index];
      log(`[${String(index + 1)}/${String(total)}] type ${JSON.stringify(command)}`);
      const result = await captureCommand(cdp, command, options, index, total);
      commands.push(result);
      if (typeof result.error === "string") {
        log(`[${String(index + 1)}/${String(total)}] ERROR ${result.error}`);
        exitCode = 1;
        if (!options.keepGoing) {
          log("aborting after command error; use --keep-going to continue");
          break;
        }
      } else {
        log(
          `[${String(index + 1)}/${String(total)}] done in ${String(result.elapsedMs)}ms records=${String(result.status?.Records ?? 0)} dropped=${String(result.status?.Dropped ?? 0)} pending=${String(result.status?.Pending ?? 0)} entries=${String(result.entries.length)} prompts=${String(result.status?.Prompts ?? 0)}`,
        );
      }
    }

    const metadata = captureMetadata(browser, bootReport);
    capture = {
      schema: SCHEMA,
      url: options.url,
      startedAt,
      debug: true,
      git: metadata.git,
      environment: metadata.environment,
      sourceMaps: metadata.sourceMaps,
      boot: { status: bootStatus, report: bootReport, entries: bootEntries, faults: bootFaults },
      commands,
      log: logLines,
    };
    log(
      `capture complete commands=${String(commands.length)} errors=${String(commands.filter((item) => typeof item.error === "string").length)}`,
    );
  } catch (error) {
    log(`capture failed: ${clip(errorMessage(error), 1000)}`);
    exitCode = 1;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await shutdown();
  }

  if (capture !== null) {
    log(`writing capture -> ${displayPath(outDir)}`);
    capture.log = logLines;
    try {
      fs.writeFileSync(path.join(outDir, "capture.json"), `${JSON.stringify(capture, null, 2)}\n`);
      fs.writeFileSync(path.join(outDir, "report.txt"), buildReportText(capture));
      fs.writeFileSync(logPath, `${logLines.join("\n")}\n`);
    } catch (error) {
      process.stderr.write(`ztrace: 写输出失败：${errorMessage(error)}\n`);
      exitCode = 1;
    }
  } else {
    try {
      fs.writeFileSync(logPath, `${logLines.join("\n")}\n`);
    } catch {
      /* 上面已经报过输出目录错误。 */
    }
  }

  return exitCode;
}

const code = await main();
process.exitCode = code;
