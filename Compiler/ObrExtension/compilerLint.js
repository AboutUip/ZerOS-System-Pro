/**
 * 只把当前编辑的 .obr 交给 obrc，避免为单文件诊断扫描或编译整个工作区。
 */

const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");
const { ANALYSIS_EXCLUDE, isInstallerCopy, isBadFixture } = require("./projectScan");

const SOURCE = "Obr";

function maskStrings(line) {
  return line.replace(/"(\\.|[^"\\])*"/g, '""').replace(/'(\\.|[^'\\])*'/g, "''");
}

/**
 * 剥掉行注释与跨行块注释，同时把字符串字面量掩成空白，保留行数与列位一致。
 * 字符串整体消费：字符串里的 //、/* 不会截断或吞掉后续行；注释里的引号也不会开串。
 */
function stripComments(lines) {
  const out = [];
  let inBlock = false;
  for (const line of lines) {
    let res = "";
    let i = 0;
    while (i < line.length) {
      if (inBlock) {
        const end = line.indexOf("*/", i);
        if (end < 0) break;
        inBlock = false;
        i = end + 2;
        continue;
      }
      if (line[i] === "/" && line[i + 1] === "*") {
        inBlock = true;
        i += 2;
        continue;
      }
      if (line[i] === "/" && line[i + 1] === "/") break;
      const quote = line[i];
      if (quote === '"' || quote === "'") {
        let j = i + 1;
        while (j < line.length) {
          if (line[j] === "\\") {
            j += 2;
            continue;
          }
          if (line[j] === quote) break;
          j += 1;
        }
        res += quote + " ".repeat(Math.max(0, j - i - 1)) + (j < line.length ? quote : "");
        i = j + 1;
        continue;
      }
      res += line[i];
      i += 1;
    }
    out.push(res);
  }
  return out;
}

/**
 * M0–M5 局部语法检查：版本门槛、析构规则、@Friend 参数。
 * 版本只在显式 #VERSION 1 时收紧——不写 #VERSION 的文件可能与版本 2 同编译单元，不猜。
 */
function scanSyntaxRules(lines, diagnostics) {
  const src = stripComments(lines);
  let version = 0;
  for (const raw of src) {
    const m = raw.trim().match(/^#VERSION\s+(\S+)/);
    if (m) version = Number(m[1]);
  }
  const strictV1 = version === 1;
  const blockStack = [];
  let pendingClass = null;
  const dtorCount = new Map();
  let pending = new Set();
  const innermostClass = () => {
    for (let i = blockStack.length - 1; i >= 0; i -= 1) {
      if (blockStack[i]) return blockStack[i];
    }
    return null;
  };
  const annsOf = (text) => {
    const found = new Set();
    for (const m of text.matchAll(/@(Overwrite|Destruct|Fails)\b/g)) found.add(m[1]);
    return found;
  };
  /* 类/块栈照常维护：class 名归属紧随的 {，其余 { 压 null。 */
  const updateBlocks = (text) => {
    const classRe = /\bclass\s+([A-Za-z_]\w*)/y;
    let i = 0;
    while (i < text.length) {
      classRe.lastIndex = i;
      const cm = classRe.exec(text);
      if (cm) {
        pendingClass = cm[1];
        i += cm[0].length;
        continue;
      }
      if (text[i] === "{") {
        blockStack.push(pendingClass);
        pendingClass = null;
      } else if (text[i] === "}") {
        blockStack.pop();
      }
      i += 1;
    }
  };
  for (let index = 0; index < src.length; index += 1) {
    const raw = lines[index] || "";
    const line = src[index].trim();
    const range = new vscode.Range(index, 0, index, Math.max(1, raw.length));

    const masked = maskStrings(line);
    const anns = annsOf(masked);
    if (strictV1) {
      const v2 = [...anns].join("、");
      if (v2) {
        diagnostics.push(new vscode.Diagnostic(range, `${v2} 需要 #VERSION 2。`, vscode.DiagnosticSeverity.Error));
      }
      if (/\b(throw|try|catch)\b/.test(masked)) {
        diagnostics.push(new vscode.Diagnostic(range, "throw / try / catch 需要 #VERSION 2。", vscode.DiagnosticSeverity.Error));
      }
      if (/\bfail\s*\.\s*of\s*\(/.test(masked) || /\bcatch\s*\(\s*fail\b/.test(masked)) {
        diagnostics.push(new vscode.Diagnostic(range, "失败值需要 #VERSION 2。", vscode.DiagnosticSeverity.Error));
      }
    }

    for (const m of masked.matchAll(/@Friend\(([^)]*)\)/g)) {
      const args = m[1].split(",").map((s) => s.trim()).filter(Boolean);
      if (args.length === 0 || args.some((a) => !/^[A-Za-z_]\w*$/.test(a))) {
        diagnostics.push(new vscode.Diagnostic(range, "@Friend 只接受类名列表：@Friend(类名[, 类名...])。", vscode.DiagnosticSeverity.Error));
      }
    }

    /* M-A：sizeof/offsetof/alignof 保留给编译期内建，函数/常量声明同名即报（Sema 同口径）。 */
    for (const m of masked.matchAll(/\bdeRfun\s+(?:[A-Za-z_]\w*::)*(sizeof|offsetof|alignof)\b|\bconst\s+[^=]*\b(sizeof|offsetof|alignof)\s*=/g)) {
      const name = m[1] || m[2];
      diagnostics.push(new vscode.Diagnostic(range, `${name} 保留给编译期内建，不能用作函数名或常量名。`, vscode.DiagnosticSeverity.Error));
    }

    /* M-B：span[T] 元素类型只接受标量和指针（Sema 同口径）；void/string/集合/嵌套 span 静态报错。
       结构体/接口/类名要靠符号表，编译器管（regress 钉入）。 */
    for (const m of masked.matchAll(/\bspan\[\s*(void|string|array|list|set|map|span)\b/g)) {
      diagnostics.push(new vscode.Diagnostic(range, "span 的元素类型只接受标量和指针。", vscode.DiagnosticSeverity.Error));
    }

    /* M-C：out/ref 出参形参的表面检查（Sema 同口径）：只修饰参数类型、非 void、一层指针。
       out/ref 识别按「修饰词 + 类型 + 参数名」形态，变量名 out/ref 与 obr::print::out 不误报。 */
    for (const m of masked.matchAll(/\b(?:out|ref)\s+void\b/g)) {
      diagnostics.push(new vscode.Diagnostic(range, "out/ref 形参不能是 void。", vscode.DiagnosticSeverity.Error));
    }
    for (const m of masked.matchAll(/\b(?:out|ref)\s+[A-Za-z_]\w*(?:\[[^\]]*\])?(?:\s*\*){2,}/g)) {
      diagnostics.push(new vscode.Diagnostic(range, "out/ref 形参只接受一层指针，不能写 T**。", vscode.DiagnosticSeverity.Error));
    }
    if (/\bdeRfun\b[^;{]*\)\s*:\s*(?:out|ref)\b/.test(masked)) {
      diagnostics.push(new vscode.Diagnostic(range, "out/ref 只修饰参数类型，返回类型不带修饰词。", vscode.DiagnosticSeverity.Error));
    }
    if (/^\s*(?:out|ref)\s+[A-Za-z_]\w*(?:\[[^\]]*\])?\*?\s+[A-Za-z_]\w*\s*[;=]/.test(masked)) {
      diagnostics.push(new vscode.Diagnostic(range, "out/ref 只修饰参数类型，字段和变量声明不带修饰词。", vscode.DiagnosticSeverity.Error));
    }

    /* M-D：volatile 指针的表面检查（Sema 同口径）：只修饰指针（`volatile T*`）、
       点类型只接受单字标量。结构体/类名点类型要靠符号表，编译器管（regress 钉入）。 */
    for (const m of masked.matchAll(/\bvolatile\s+([A-Za-z_]\w*(?:\[[^\]]*\])?)\s*(\**)/g)) {
      if (m[2] === "") {
        diagnostics.push(new vscode.Diagnostic(range, "volatile 只能修饰指针类型，要写 volatile T*。", vscode.DiagnosticSeverity.Error));
      }
    }
    for (const m of masked.matchAll(/\bvolatile\s+(?:string|void)\b|\bvolatile\s+(?:array|list|set|map|span)\s*\[/g)) {
      diagnostics.push(new vscode.Diagnostic(range, "volatile 指针的点类型只能是单字标量（byte/short/int/long/float/double/boolean/char）。", vscode.DiagnosticSeverity.Error));
    }

    /* M-E：内存序三档标注参数（Sema 同口径）。MemoryOrder::X 只有 Acquire/Release/SeqCst；
       relaxed 不存在（枚举没有这个值）。 */
    for (const m of masked.matchAll(/\bMemoryOrder::([A-Za-z_]\w*)/g)) {
      if (m[1] !== "Acquire" && m[1] !== "Release" && m[1] !== "SeqCst") {
        diagnostics.push(new vscode.Diagnostic(range, `内存序只有 Acquire/Release/SeqCst 三档，没有 ${m[1]}。`, vscode.DiagnosticSeverity.Error));
      }
    }

    /* 一行多声明按 deRfun 出现位置切段：注解只归属紧随其后的那个声明；
       段间文本照常维护类/块栈，构造与析构同行时 owner 计数仍对得上。 */
    const declRe = /\bdeRfun\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*:\s*([A-Za-z_]\w*(?:\[[^\]]*\])?)/g;
    let cursor = 0;
    let carry = pending;
    pending = new Set();
    let decl;
    while ((decl = declRe.exec(masked)) !== null) {
      const region = masked.slice(cursor, decl.index);
      updateBlocks(region);
      const active = new Set([...carry, ...annsOf(region)]);
      carry = new Set();
      const name = decl[1];
      const params = decl[2];
      const ret = decl[3];
      if (active.has("Destruct") && active.has("Overwrite")) {
        diagnostics.push(new vscode.Diagnostic(range, "@Destruct 不能同时 @Overwrite。", vscode.DiagnosticSeverity.Error));
      }
      if (active.has("Destruct") && active.has("Fails")) {
        diagnostics.push(new vscode.Diagnostic(range, "@Fails 不能标在析构上。", vscode.DiagnosticSeverity.Error));
      }
      if (active.has("Destruct")) {
        if (params.trim() !== "") {
          diagnostics.push(new vscode.Diagnostic(range, `@Destruct 必须没有参数 ${name}。`, vscode.DiagnosticSeverity.Error));
        }
        if (ret !== "void") {
          diagnostics.push(new vscode.Diagnostic(range, `@Destruct 必须返回 void ${name}。`, vscode.DiagnosticSeverity.Error));
        }
        const owner = innermostClass();
        if (owner) {
          if (name === owner) {
            diagnostics.push(new vscode.Diagnostic(range, "@Destruct 不能写在构造上。", vscode.DiagnosticSeverity.Error));
          }
          const count = (dtorCount.get(owner) || 0) + 1;
          dtorCount.set(owner, count);
          if (count > 1) {
            diagnostics.push(new vscode.Diagnostic(range, `类 ${owner} 每类至多一个 @Destruct。`, vscode.DiagnosticSeverity.Error));
          }
        }
      }
      cursor = decl.index + decl[0].length;
    }
    const tail = masked.slice(cursor);
    updateBlocks(tail);
    const tailAnns = annsOf(tail);
    if (tailAnns.size > 0) pending = tailAnns;
  }
}

function scanLiveDiagnostics(document) {
  const diagnostics = [];
  if (document.languageId !== "objective-r-obr" && document.languageId !== "objective-r-mr") {
    return diagnostics;
  }
  const lines = document.getText().split(/\r?\n/);
  const sourceLines = stripComments(lines);
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] || "";
    const line = (sourceLines[index] || "").trim();
    const range = new vscode.Range(index, 0, index, Math.max(1, raw.length));
    const version = line.match(/^#VERSION\b(.*)$/);
    if (version && version[1].trim() !== "1" && version[1].trim() !== "2") {
      diagnostics.push(
        new vscode.Diagnostic(range, "#VERSION 只接受语言版本 1 或 2。", vscode.DiagnosticSeverity.Error)
      );
    }
    const dyn = line.match(/^#DYN\b(.*)$/);
    if (dyn && dyn[1].trim() !== "") {
      diagnostics.push(new vscode.Diagnostic(range, "#DYN 不接受参数。", vscode.DiagnosticSeverity.Error));
    }
    if (line.startsWith("#LINK")) {
      const rest = line.slice("#LINK".length);
      for (const part of rest.split(",")) {
        const item = part.trim();
        if (item && !item.startsWith("/")) {
          diagnostics.push(
            new vscode.Diagnostic(range, `#LINK 项必须以 / 开头：${item}`, vscode.DiagnosticSeverity.Error)
          );
        }
      }
    }
  }
  scanSyntaxRules(lines, diagnostics);
  return diagnostics;
}

function findCompiler(folders) {
  const configured = vscode.workspace.getConfiguration("objectiveR").get("compiler.path");
  if (typeof configured === "string" && configured.trim()) {
    const given = configured.trim();
    if (fs.existsSync(given)) return given;
  }
  const names = ["obrc.exe", "obrc"];
  for (const folder of folders || []) {
    for (const name of names) {
      const candidate = path.join(folder.uri.fsPath, "Compiler", "ObrCompiler", name);
      if (fs.existsSync(candidate)) return candidate;
      const built = path.join(folder.uri.fsPath, "Compiler", "ObrCompiler", "build", name);
      if (fs.existsSync(built)) return built;
    }
  }
  return "";
}

async function findImportedHeaderDirectories(text, document, compiler) {
  const imported = new Set();
  for (const line of stripComments(text.split(/\r?\n/))) {
    const match = line.trim().match(/^import\s+([A-Za-z_][\w.]*)\s*;/);
    if (match) imported.add(match[1]);
  }
  if (imported.size === 0) return [];

  const sourceDir = path.resolve(path.dirname(document.uri.fsPath)).toLowerCase();
  const executableDir = path.dirname(compiler);
  const builtinDirs = new Set([
    path.resolve(executableDir, "lib").toLowerCase(),
    path.resolve(executableDir, "..", "lib").toLowerCase()
  ]);
  const matches = await Promise.all(
    [...imported].map(async (name) => vscode.workspace.findFiles(`**/${name}.mr`, ANALYSIS_EXCLUDE))
  );
  const directories = new Set();
  for (const uris of matches) {
    for (const uri of uris) {
      const directory = path.resolve(path.dirname(uri.fsPath));
      const normalized = directory.toLowerCase();
      if (normalized === sourceDir || builtinDirs.has(normalized)) continue;
      directories.add(directory);
    }
  }
  return [...directories];
}

function place(message, files) {
  const numbered = message.match(/第\s*(\d+)\s*行/);
  const id = message.match(/([A-Za-z_][\w:]*)\s*$/);
  const needle = id ? id[1] : "";
  if (numbered) {
    const line = Math.max(0, Number(numbered[1]) - 1);
    const owner = files.find((item) => item.text.split(/\r?\n/).length > line) || files[0];
    return { uri: owner.uri, line };
  }
  if (needle) {
    for (const item of files) {
      const lines = item.text.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        if (lines[index].includes(needle)) return { uri: item.uri, line: index };
      }
    }
  }
  return { uri: files[0].uri, line: 0 };
}

function runCompiler(exe, args, onStart) {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { windowsHide: true });
    if (onStart) onStart(child);
    let output = "";
    const take = (chunk) => {
      output += chunk.toString();
      if (output.length > 16000) output = output.slice(0, 16000);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    const timer = setTimeout(() => {
      child.kill();
    }, 30000);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: 1, output: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code == null ? 1 : code, output });
    });
  });
}

function registerCompilerLint(context, status) {
  const collection = vscode.languages.createDiagnosticCollection("objective-r-compiler");
  let generation = 0;
  let activeCompiler = null;
  let lastUris = [];
  context.subscriptions.push(collection);

  async function lint(document) {
    if (activeCompiler && !activeCompiler.killed) activeCompiler.kill();
    const current = ++generation;
    if (!document || (document.languageId !== "objective-r-obr" && document.languageId !== "objective-r-mr")) {
      return;
    }
    for (const uri of lastUris) collection.delete(uri);
    lastUris = [];
    collection.delete(document.uri);
    if (vscode.workspace.getConfiguration("objectiveR").get("diagnostics.compiler") === false) {
      collection.clear();
      status.text = "";
      status.hide();
      return;
    }
    if (document.languageId !== "objective-r-obr") {
      collection.delete(document.uri);
      return;
    }
    /* 反例夹具只着色：不跑 obrc，也不在状态栏显示错误计数。 */
    if (isBadFixture(document.uri.fsPath)) {
      collection.delete(document.uri);
      status.text = "";
      status.hide();
      return;
    }
    if (isInstallerCopy(document.uri.fsPath)) {
      collection.delete(document.uri);
      status.text = "";
      status.hide();
      return;
    }
    const folders = vscode.workspace.workspaceFolders || [];
    const exe = findCompiler(folders);
    if (!exe) {
      status.text = "Obr 未找到 obrc";
      status.show();
      return;
    }
    status.text = "Obr 检查中";
    status.show();
    const temp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "obr-lint-"));
    const output = path.join(temp, "lint-out");
    let compilerForRun = null;
    try {
      const sourcePath = document.isDirty
        ? path.join(temp, path.basename(document.uri.fsPath))
        : document.uri.fsPath;
      if (document.isDirty) await fs.promises.writeFile(sourcePath, document.getText(), "utf8");
      if (current !== generation) return;
      const includeDirectories = await findImportedHeaderDirectories(document.getText(), document, exe);
      if (current !== generation) return;
      const args = [
        sourcePath,
        "-I",
        path.dirname(document.uri.fsPath)
      ];
      for (const directory of includeDirectories) args.push("-I", directory);
      args.push("-slot", "0", "-o", output);
      const item = { uri: document.uri, text: document.getText(), fsPath: document.uri.fsPath };
      const result = await runCompiler(exe, args, (child) => {
        compilerForRun = child;
        activeCompiler = child;
      });
      if (current !== generation) return;
      for (const uri of lastUris) collection.delete(uri);
      lastUris = [];
      if (result.code === 0) {
        status.text = "Obr 通过";
        return;
      }
      const messages = result.output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("用法:"));
      const shown = messages.slice(0, 30);
      const diagnostics = [];
      for (const message of shown) {
        if (message === "没有 main" && !/\bdeRfun\s+main\s*\(/.test(item.text)) continue;
        const at = place(message, [item]);
        const lineText = document.lineAt(Math.min(at.line, document.lineCount - 1)).text;
        const range = new vscode.Range(at.line, 0, at.line, Math.max(1, lineText.length));
        const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
        diagnostic.source = SOURCE;
        diagnostics.push(diagnostic);
      }
      if (diagnostics.length) collection.set(document.uri, diagnostics);
      lastUris.push(document.uri);
      status.text = shown.length ? `Obr ${shown.length} 个问题` : "Obr 未通过";
    } catch (error) {
      if (current !== generation) return;
      status.text = "Obr 检查失败";
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 1),
        error instanceof Error ? error.message : "obrc 没有跑起来",
        vscode.DiagnosticSeverity.Warning
      );
      diagnostic.source = SOURCE;
      collection.set(document.uri, [diagnostic]);
    } finally {
      if (activeCompiler === compilerForRun) activeCompiler = null;
      await fs.promises.rm(temp, { recursive: true, force: true }).catch(() => {});
    }
  }

  function invalidate() {
    generation += 1;
    if (activeCompiler && !activeCompiler.killed) activeCompiler.kill();
    for (const uri of lastUris) collection.delete(uri);
    lastUris = [];
    status.text = "";
    status.hide();
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.languageId === "objective-r-obr" || event.document.languageId === "objective-r-mr") {
        invalidate();
      }
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (document.languageId === "objective-r-obr") void lint(document);
    }),
    vscode.workspace.onDidCloseTextDocument((document) => collection.delete(document.uri)),
    vscode.commands.registerCommand("objectiveR.checkCurrentFile", () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) return lint(editor.document);
      return undefined;
    }),
    new vscode.Disposable(() => {
      if (activeCompiler && !activeCompiler.killed) activeCompiler.kill();
    })
  );
}

module.exports = {
  scanLiveDiagnostics,
  scanSyntaxRules,
  registerCompilerLint
};
