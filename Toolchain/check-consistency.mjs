/**
 * 核对协议页眉、目录索引、Cursor 链接、本机路径，以及 obrc 的输出位置。
 * 只使用 Node 自带模块。--sync 把 .cursor 里的技能和规则接成指向 Documents 的目录联接。
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolchainDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolchainDir, "..");
const failures = [];

function fail(message) {
  failures.push(message);
}

function readText(rel) {
  return readFileSync(path.join(repoRoot, rel), "utf8");
}

function relPosix(full) {
  return path.relative(repoRoot, full).split(path.sep).join("/");
}

function mentions(text, id) {
  return new RegExp(`(?:^|[^A-Z0-9])${id}(?:[^A-Z0-9]|$)`).test(text);
}

/** Cursor 路径只是本地联接。左边是仓库里维护的那一份。 */
const cursorLinks = [
  ["Documents/SKILLS/ProtocolDocumentAuthoring", ".cursor/skills/protocol-document-authoring"],
  ["Documents/SKILLS/CodingStandards", ".cursor/skills/coding-standards"],
  ["Documents/SKILLS/ObrLanguage", ".cursor/skills/obr-language"],
  ["Documents/RULES", ".cursor/rules"],
];

function syncCursorLinks() {
  for (const [src, dest] of cursorLinks) {
    const from = path.join(repoRoot, src);
    const to = path.join(repoRoot, dest);
    if (!existsSync(from)) {
      fail(`缺少权威源 ${src}`);
      continue;
    }
    rmSync(to, { recursive: true, force: true });
    mkdirSync(path.dirname(to), { recursive: true });
    symlinkSync(from, to, "junction");
  }
}

function checkCursorLinks() {
  for (const [src, dest] of cursorLinks) {
    const from = path.join(repoRoot, src);
    const to = path.join(repoRoot, dest);
    if (!existsSync(from)) {
      fail(`缺少权威源 ${src}`);
      continue;
    }
    if (!existsSync(to)) {
      fail(`${dest} 还没有接到 ${src}。在 Toolchain 执行 npm run skills:sync`);
      continue;
    }
    const linked = lstatSync(to);
    if (!linked.isSymbolicLink()) {
      fail(`${dest} 是实体目录，不是指向 ${src} 的链接`);
      continue;
    }
    if (realpathSync(to) !== realpathSync(from)) {
      fail(`${dest} 没有指向 ${src}`);
    }
  }
}

function protocolBodies() {
  const root = path.join(repoRoot, "Documents/Protocol");
  const out = [];
  const walk = (current) => {
    for (const name of readdirSync(current)) {
      const full = path.join(current, name);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/^Z[A-Z0-9]+\.md$/.test(name)) {
        out.push(full);
      }
    }
  };
  walk(root);
  out.sort();
  return out;
}

function checkProtocols() {
  const rootReadme = readText("README.md");
  const protocolReadmePath = "Documents/Protocol/README.md";
  const hardwareReadmePath = "Documents/Protocol/PhysicalHardware/README.md";
  if (!existsSync(path.join(repoRoot, protocolReadmePath))) {
    fail(`缺少 ${protocolReadmePath}`);
  }
  if (!existsSync(path.join(repoRoot, hardwareReadmePath))) {
    fail(`缺少 ${hardwareReadmePath}`);
  }
  const protocolReadme = existsSync(path.join(repoRoot, protocolReadmePath)) ? readText(protocolReadmePath) : "";
  const hardwareReadme = existsSync(path.join(repoRoot, hardwareReadmePath)) ? readText(hardwareReadmePath) : "";
  if (!protocolReadme.includes("Kernel/README.md")) {
    fail("Documents/Protocol/README.md 没有链到内核文本索引");
  }
  const bodies = protocolBodies();
  if (bodies.length === 0) {
    fail("Documents/Protocol 下没有协议正文");
  }
  for (const full of bodies) {
    const rel = relPosix(full);
    const id = path.basename(full, ".md");
    const lines = readFileSync(full, "utf8").split(/\r?\n/).slice(0, 16).map((line) => line.trimEnd());
    const required = [
      `> 文档路径：\`${rel}\``,
      "> 规范状态：**规范性（Normative）**",
      `> 协议标识字符串（唯一）：\`${id}\``,
    ];
    for (const line of required) {
      if (!lines.includes(line)) {
        fail(`${rel} 页眉缺少：${line}`);
      }
    }
    if (!mentions(rootReadme, id)) {
      fail(`根 README 没有列出 ${id}`);
    }
    if (!mentions(protocolReadme, id)) {
      fail(`Documents/Protocol/README.md 没有列出 ${id}`);
    }
    if (rel.startsWith("Documents/Protocol/PhysicalHardware/") && !mentions(hardwareReadme, id)) {
      fail(`Documents/Protocol/PhysicalHardware/README.md 没有列出 ${id}`);
    }
  }
}

function checkCompilerOutput() {
  const cmake = readText("Compiler/Obr/CMakeLists.txt");
  const vite = readText("Toolchain/vite.config.ts");
  if (!vite.includes('path.resolve(repoRoot, "Compiler/Obr", fileName)')) {
    fail("vite.config.ts 不再从 Compiler/Obr 读取 obrc");
  }
  const configs = ["", "_DEBUG", "_RELEASE", "_RELWITHDEBINFO", "_MINSIZEREL"];
  for (const config of configs) {
    const line = `RUNTIME_OUTPUT_DIRECTORY${config} "\${CMAKE_CURRENT_SOURCE_DIR}"`;
    if (!cmake.includes(line)) {
      fail(`CMakeLists.txt 缺少 ${line}`);
    }
  }
}

function checkExamples() {
  const dir = path.join(repoRoot, "Compiler/Obr/examples");
  if (existsSync(path.join(dir, "ui-meter-bad.obr"))) {
    fail("ui-meter-bad.obr 仍在。运行时失败的例子不能使用 bad- 前缀");
  }
  const runtime = path.join(dir, "ui-meter-runtime.obr");
  if (!existsSync(runtime)) {
    fail("缺少 examples/ui-meter-runtime.obr");
  } else {
    const text = readFileSync(runtime, "utf8");
    if (!text.includes("运行时")) {
      fail("ui-meter-runtime.obr 没有写明这是运行时失败");
    }
    if (text.includes("编译应当失败")) {
      fail("ui-meter-runtime.obr 被写成了编译期失败");
    }
  }
  for (const name of readdirSync(dir)) {
    if (!name.startsWith("bad-") || !name.endsWith(".obr")) {
      continue;
    }
    const text = readFileSync(path.join(dir, name), "utf8");
    if (!text.includes("编译应当失败")) {
      fail(`${name} 使用了 bad- 前缀，但没有写明编译应当失败`);
    }
  }
}

function checkDrivePaths() {
  const roots = ["ZerOS-PRO", "Compiler", "Toolchain", "Documents", "Driver", ".cursor", ".github"];
  const extensions = new Set([".ts", ".tsx", ".mjs", ".js", ".cjs", ".cpp", ".hpp", ".h", ".obr", ".mr", ".md", ".yml", ".yaml"]);
  const driveRe = /(?:^|[^A-Za-z])([A-Za-z]:[\\/][^\s"'`)\]}]*)/g;
  const walk = (current) => {
    for (const name of readdirSync(current)) {
      const full = path.join(current, name);
      const rel = relPosix(full);
      if (statSync(full).isDirectory()) {
        if (name === "node_modules" || name === "Dist" || name === "build" || name === ".git") {
          continue;
        }
        if (rel === "ZerOS-PRO/Hardware/Nas/Root" || rel.startsWith("ZerOS-PRO/Hardware/Nas/Root/")) {
          continue;
        }
        walk(full);
        continue;
      }
      if (name === "package-lock.json") {
        continue;
      }
      const ext = path.extname(name);
      if (!extensions.has(ext) && name !== "CMakeLists.txt") {
        continue;
      }
      const text = readFileSync(full, "utf8");
      driveRe.lastIndex = 0;
      let match = driveRe.exec(text);
      while (match !== null) {
        const found = match[1] ?? "";
        // NAS 自检把 C:/windows 当作必须拒绝的客路径，不是本机文件。其它盘符路径都算写死。
        if (found !== "C:/windows") {
          fail(`${rel} 写死了本机路径 ${found}`);
        }
        match = driveRe.exec(text);
      }
    }
  };
  for (const root of roots) {
    const full = path.join(repoRoot, root);
    if (existsSync(full)) {
      walk(full);
    }
  }
}

if (process.argv.includes("--sync")) {
  syncCursorLinks();
}
checkCursorLinks();
checkProtocols();
checkCompilerOutput();
checkExamples();
checkDrivePaths();

if (failures.length > 0) {
  for (const message of failures) {
    process.stderr.write(`${message}\n`);
  }
  process.exit(1);
}
process.stdout.write("consistency ok\n");
