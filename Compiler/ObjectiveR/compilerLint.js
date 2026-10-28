/**
 * 键入后先做本地检查，停手后再用工作区里的 obrc 编一遍当前程序。
 * 编译器报错没有行号时，按消息末尾的名字在源文件里落点。
 * import 的头文件只有声明时，把同目录、同名的 .obr 一起交给 obrc。
 * 否则 obr.nas::ready 这种有实现文件的库函数会被报成「没有函数」。
 */

const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");
const { ANALYSIS_EXCLUDE, isInstallerCopy } = require("./projectScan");

const SOURCE = "Obr";

function stripLineComment(line) {
  return line.replace(/\/\/.*$/, "");
}

function scanLiveDiagnostics(document) {
  const diagnostics = [];
  if (document.languageId !== "objective-r-obr" && document.languageId !== "objective-r-mr") {
    return diagnostics;
  }
  const lines = document.getText().split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] || "";
    const line = stripLineComment(raw).trim();
    const range = new vscode.Range(index, 0, index, Math.max(1, raw.length));
    const version = line.match(/^#VERSION\b(.*)$/);
    if (version && version[1].trim() !== "1") {
      diagnostics.push(
        new vscode.Diagnostic(range, "#VERSION 只接受语言版本 1。", vscode.DiagnosticSeverity.Error)
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
  return diagnostics;
}

function linkNames(text) {
  const names = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = stripLineComment(raw).trim();
    if (!line.startsWith("#LINK")) continue;
    for (const part of line.slice("#LINK".length).split(",")) {
      const item = part.trim().replace(/\\/g, "/");
      if (!item.startsWith("/")) continue;
      const base = item.split("/").pop();
      if (base && base.endsWith(".obr")) names.push(base);
    }
  }
  return names;
}

function importsOf(text) {
  const names = [];
  const pattern = /^\s*import\s+([A-Za-z_][\w.]*)\s*;/gm;
  let match;
  while ((match = pattern.exec(text)) !== null) names.push(match[1]);
  return names;
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
      const candidate = path.join(folder.uri.fsPath, "Compiler", "Obr", name);
      if (fs.existsSync(candidate)) return candidate;
      const built = path.join(folder.uri.fsPath, "Compiler", "Obr", "build", name);
      if (fs.existsSync(built)) return built;
    }
  }
  return "";
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

function runCompiler(exe, args) {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { windowsHide: true });
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
  let timer = null;
  let lastUris = [];
  context.subscriptions.push(collection);

  async function lint(document) {
    const current = ++generation;
    if (!document || (document.languageId !== "objective-r-obr" && document.languageId !== "objective-r-mr")) {
      return;
    }
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
    const obrs = await vscode.workspace.findFiles("**/*.obr", ANALYSIS_EXCLUDE);
    if (current !== generation) return;
    const texts = new Map();
    const byBase = new Map();
    for (const uri of obrs) {
      if (isInstallerCopy(uri.fsPath)) continue;
      let text = "";
      if (uri.toString() === document.uri.toString()) text = document.getText();
      else {
        try {
          text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
        } catch (_error) {
          continue;
        }
      }
      texts.set(uri.toString(), { uri, text, fsPath: uri.fsPath });
      const base = path.basename(uri.fsPath).toLowerCase();
      if (!byBase.has(base)) byBase.set(base, []);
      byBase.get(base).push(uri.toString());
    }
    if (!texts.has(document.uri.toString())) {
      texts.set(document.uri.toString(), {
        uri: document.uri,
        text: document.getText(),
        fsPath: document.uri.fsPath
      });
    }
    const links = new Map();
    for (const [key, item] of texts) links.set(key, linkNames(item.text));
    const seen = new Set([document.uri.toString()]);
    const queue = [document.uri.toString()];
    while (queue.length > 0 && seen.size < 40) {
      const key = queue.pop();
      const item = texts.get(key);
      if (!item) continue;
      const base = path.basename(item.fsPath).toLowerCase();
      const neighbors = new Set(links.get(key) || []);
      for (const [otherKey, names] of links) {
        if (names.some((name) => name.toLowerCase() === base)) neighbors.add(path.basename(texts.get(otherKey).fsPath));
      }
      for (const name of neighbors) {
        for (const other of byBase.get(name.toLowerCase()) || []) {
          if (seen.has(other) || seen.size >= 40) continue;
          seen.add(other);
          queue.push(other);
        }
      }
    }
    const group = [...seen].map((key) => texts.get(key)).filter(Boolean);
    const byPath = new Map();
    for (const item of texts.values()) {
      byPath.set(path.normalize(item.fsPath).toLowerCase(), item);
    }
    const include = new Set(group.map((item) => path.dirname(item.fsPath)));
    const headers = await vscode.workspace.findFiles("**/*.mr", ANALYSIS_EXCLUDE);
    let attached = true;
    while (attached) {
      attached = false;
      const imported = new Set();
      for (const item of group) {
        for (const name of importsOf(item.text)) imported.add(name);
      }
      if (imported.size === 0) continue;
      for (const header of headers) {
        if (isInstallerCopy(header.fsPath)) continue;
        const base = path.basename(header.fsPath, ".mr");
        if (!imported.has(base)) continue;
        include.add(path.dirname(header.fsPath));
        const sibling = path.join(path.dirname(header.fsPath), base + ".obr");
        const body = byPath.get(path.normalize(sibling).toLowerCase());
        if (!body) continue;
        const key = body.uri.toString();
        if (seen.has(key)) continue;
        seen.add(key);
        group.push(body);
        attached = true;
      }
    }
    if (current !== generation) return;
    const temp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "obr-lint-"));
    const output = path.join(temp, "lint-out");
    const args = [];
    try {
      for (const item of group) {
        if (item.uri.toString() === document.uri.toString() && document.isDirty) {
          const copy = path.join(temp, path.basename(item.fsPath));
          await fs.promises.writeFile(copy, document.getText(), "utf8");
          args.push(copy);
        } else {
          args.push(item.fsPath);
        }
      }
      for (const dir of include) {
        if (isInstallerCopy(dir)) continue;
        args.push("-I", dir);
      }
      args.push("-slot", "0", "-o", output);
      const result = await runCompiler(exe, args);
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
      const bucket = new Map();
      const shown = messages.slice(0, 30);
      for (const message of shown) {
        if (message === "没有 main" && !group.some((item) => /\bdeRfun\s+main\s*\(/.test(item.text))) continue;
        const at = place(message, group);
        const key = at.uri.toString();
        if (!bucket.has(key)) bucket.set(key, { uri: at.uri, items: [] });
        const lineText = at.uri.toString() === document.uri.toString() ? document.lineAt(Math.min(at.line, document.lineCount - 1)).text : "";
        const range = new vscode.Range(at.line, 0, at.line, Math.max(1, lineText.length));
        const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
        diagnostic.source = SOURCE;
        bucket.get(key).items.push(diagnostic);
      }
      for (const entry of bucket.values()) {
        collection.set(entry.uri, entry.items);
        lastUris.push(entry.uri);
      }
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
      await fs.promises.rm(temp, { recursive: true, force: true }).catch(() => {});
    }
  }

  function schedule(document) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void lint(document);
    }, 900);
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => schedule(event.document)),
    vscode.workspace.onDidSaveTextDocument((document) => schedule(document)),
    vscode.workspace.onDidOpenTextDocument((document) => schedule(document)),
    vscode.workspace.onDidCloseTextDocument((document) => collection.delete(document.uri)),
    new vscode.Disposable(() => {
      if (timer) clearTimeout(timer);
    })
  );

  const active = vscode.window.activeTextEditor;
  if (active) schedule(active.document);
}

module.exports = {
  scanLiveDiagnostics,
  registerCompilerLint
};
