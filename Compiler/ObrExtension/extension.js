const vscode = require("vscode");
const path = require("path");
const { ANALYSIS_EXCLUDE, collectAnalysisUris, isInstallerCopy } = require("./projectScan");
const { registerSemanticTokensProvider } = require("./semanticTokens");
const { registerZapBinary } = require("./zapBinary");
const { parseDocumentSymbols, collectCalls, callMatchesSymbol } = require("./symbols");
const { lookupObr, lookupZap, inZapBlock, lookupLibrary } = require("./hoverDocs");
const { scanLiveDiagnostics, registerCompilerLint } = require("./compilerLint");

const LANGUAGE_IDS = ["objective-r-obr", "objective-r-mr"];

/** 与 BlinkEngine 词法/解析一致（见 docs/blink/lexing.md、Parser）。 */
const KEYWORDS = [
  "deRfun",
  "import",
  "namespace",
  "return",
  "if",
  "else",
  "while",
  "for",
  "async",
  "await",
  "struct",
  "enum",
  "class",
  "new",
  "goto",
  "break",
  "continue",
  "var",
  "public",
  "private",
  "static",
  "#VERSION",
  "#LINK",
  "#DYN",
  "void",
  "boolean",
  "byte",
  "short",
  "int",
  "long",
  "float",
  "double",
  "char",
  "string",
  "true",
  "false",
  "null",
  "undefined"
];

const STD_NAMESPACE_COMPLETIONS = [];

function diagnosticsEnabled(kind) {
  const c = vscode.workspace.getConfiguration("objectiveR");
  if (c.get("diagnostics.enable") === false) return false;
  if (kind === "structural") return c.get("diagnostics.structural") !== false;
  if (kind === "workspace") return c.get("diagnostics.workspace") !== false;
  return true;
}

/**
 * 括号/方括号/圆括号匹配、块注释闭合、引号闭合（忽略行内 // 与块注释、字符串内字符）。
 */
function maskZapRegions(text) {
  const lines = text.split(/\r?\n/);
  let inZap = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (!inZap && /^\s*__zap__\b/.test(lines[i])) {
      inZap = true;
      lines[i] = lines[i].replace(/[()[\]{}"']/g, " ");
      continue;
    }
    if (!inZap) continue;
    if (lines[i].trim() === "}") {
      inZap = false;
      lines[i] = " ".repeat(lines[i].length);
      continue;
    }
    lines[i] = " ".repeat(lines[i].length);
  }
  return lines.join("\n");
}

function scanStructuralDiagnostics(text) {
  const out = [];
  const lines = maskZapRegions(text).split(/\r?\n/);
  let inBlockComment = false;
  let stringQuote = null;
  let escape = false;
  const stack = [];

  for (let li = 0; li < lines.length; li += 1) {
    const line = lines[li];
    let inLineComment = false;

    for (let ci = 0; ci < line.length; ci += 1) {
      const c = line[ci];
      const next = line[ci + 1];

      if (inLineComment) break;

      if (inBlockComment) {
        if (c === "*" && next === "/") {
          inBlockComment = false;
          ci += 1;
        }
        continue;
      }

      if (stringQuote) {
        if (escape) {
          escape = false;
          continue;
        }
        if (c === "\\") {
          escape = true;
          continue;
        }
        if (c === stringQuote) {
          stringQuote = null;
          continue;
        }
        continue;
      }

      if (c === "/" && next === "/") {
        inLineComment = true;
        break;
      }
      if (c === "/" && next === "*") {
        inBlockComment = true;
        ci += 1;
        continue;
      }

      if (c === '"' || c === "'") {
        stringQuote = c;
        continue;
      }

      if (c === "{" || c === "(" || c === "[") {
        stack.push({ ch: c, line: li, col: ci });
      } else if (c === "}" || c === ")" || c === "]") {
        const want = c === "}" ? "{" : c === ")" ? "(" : "[";
        if (!stack.length || stack[stack.length - 1].ch !== want) {
          const pos = new vscode.Position(li, ci);
          out.push(
            new vscode.Diagnostic(
              new vscode.Range(pos, pos.translate(0, 1)),
              `不匹配的括号: 期望与 '${want}' 配对，实际为 '${c}'`,
              vscode.DiagnosticSeverity.Error
            )
          );
        } else {
          stack.pop();
        }
      }
    }
  }

  if (inBlockComment) {
    const li = Math.max(0, lines.length - 1);
    const pos = new vscode.Position(li, 0);
    out.push(
      new vscode.Diagnostic(
        new vscode.Range(pos, pos),
        "未结束的块注释 /* … */",
        vscode.DiagnosticSeverity.Error
      )
    );
  }

  if (stringQuote) {
    const li = Math.max(0, lines.length - 1);
    const line = lines[li] || "";
    const pos = new vscode.Position(li, Math.max(0, line.length - 1));
    out.push(
      new vscode.Diagnostic(
        new vscode.Range(pos, pos.translate(0, 1)),
        `未闭合的字符串（起始 ${stringQuote}）`,
        vscode.DiagnosticSeverity.Error
      )
    );
  }

  for (const s of stack) {
    const pos = new vscode.Position(s.line, s.col);
    out.push(
      new vscode.Diagnostic(
        new vscode.Range(pos, pos.translate(0, 1)),
        `未闭合的 '${s.ch}'`,
        vscode.DiagnosticSeverity.Error
      )
    );
  }

  return out;
}

function buildVarSnippetCompletions() {
  const local = new vscode.CompletionItem("var 局部变量", vscode.CompletionItemKind.Snippet);
  local.insertText = new vscode.SnippetString("var[${1:int}] ${2:x} = ${3:0};");
  local.detail = "var[type] name = init;";
  local.sortText = "0_var_local";

  const st = new vscode.CompletionItem("static var", vscode.CompletionItemKind.Snippet);
  st.insertText = new vscode.SnippetString("static var[${1:int}] ${2:n} = ${3:0};");
  st.detail = "static var[type] …";
  st.sortText = "0_var_static";

  const mark = new vscode.CompletionItem("static 标记", vscode.CompletionItemKind.Snippet);
  mark.insertText = new vscode.SnippetString("static ${1:ident};");
  mark.detail = "static ident; 将已有局部标为 static";
  mark.sortText = "0_static_mark";

  return [local, st, mark];
}

class ObrIndex {
  constructor() {
    this.byFullName = new Map();
    this.byShortName = new Map();
    this.moduleNames = new Set();
    this.calls = [];
    this.workspaceReady = false;
  }

  async rebuild() {
    this.byFullName.clear();
    this.byShortName.clear();
    this.moduleNames.clear();
    this.calls = [];
    const uris = await collectAnalysisUris();
    for (const uri of uris) {
      await this.indexFile(uri);
    }
    this.workspaceReady = true;
  }

  async update(uri) {
    // For simplicity and correctness, rebuild full index.
    await this.rebuild();
  }

  async indexFile(uri) {
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const source = doc.getText();
      const relative = vscode.workspace.asRelativePath(uri, false);
      const moduleName = getModuleNameFromUri(uri);
      this.moduleNames.add(moduleName);
      const stored = [];
      for (const sym of parseDocumentSymbols(source)) {
        const item = {
          ...sym,
          line: sym.line + 1,
          endLine: sym.endLine + 1,
          source: relative,
          uri,
          moduleName
        };
        stored.push(item);
        addToMapArray(this.byFullName, item.fullName, item);
        addToMapArray(this.byShortName, item.shortName, item);
      }
      for (const call of collectCalls(source)) {
        const caller = enclosingImplementation(stored, call.line + 1);
        this.calls.push({
          ...call,
          line: call.line + 1,
          uri,
          source: relative,
          callerFullName: caller ? caller.fullName : "",
          callerLine: caller ? caller.line : 0,
          callerUri: uri
        });
      }
    } catch (_e) {
      // Ignore file parse/index failures to keep extension resilient.
    }
  }

  find(name) {
    if (!name) return [];
    if (name.includes("::")) {
      return dedupeSymbols([...(this.byFullName.get(name) || [])]);
    }
    return dedupeSymbols([...(this.byShortName.get(name) || [])]);
  }

  allSymbols() {
    const acc = [];
    for (const values of this.byFullName.values()) {
      for (const v of values) acc.push(v);
    }
    return dedupeSymbols(acc);
  }

  allModuleNames() {
    return [...this.moduleNames].sort((a, b) => a.localeCompare(b));
  }
}

function enclosingImplementation(symbols, line) {
  let best = null;
  for (const sym of symbols) {
    if (sym.kind !== "implementation") continue;
    if (line < sym.line || line > sym.endLine) continue;
    if (!best || sym.endLine - sym.line < best.endLine - best.line) best = sym;
  }
  return best;
}

function parseFunctionHeadsWithLine(text) {
  return parseDocumentSymbols(text)
    .filter((sym) => sym.kind === "declaration" || sym.kind === "implementation")
    .map((sym) => ({
      fullName: sym.fullName,
      signature: sym.signature,
      ending: sym.ending,
      line: sym.line
    }));
}

function addToMapArray(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function dedupeSymbols(symbols) {
  const seen = new Set();
  const out = [];
  for (const s of symbols) {
    const key = `${s.fullName}|${s.signature}|${s.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function stripBlockComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
}

function stripLineComment(line) {
  return line.replace(/\/\/.*$/, "");
}

function readFunctionHeader(lines, startLine) {
  let endLine = startLine;
  let merged = stripLineComment(lines[startLine] || "").trim();
  while (endLine + 1 < lines.length && !/[;{]\s*$/.test(merged)) {
    endLine += 1;
    const next = stripLineComment(lines[endLine] || "").trim();
    if (!next) continue;
    merged += ` ${next}`;
  }
  return { merged, endLine };
}

function parseFunctionFromHeader(headerText, namespaceStack) {
  const fn = headerText.match(
    /^(?:export\s+)?deRfun\s+([A-Za-z_]\w*(?:::[A-Za-z_]\w*)*)\s*\(([^)]*)\)\s*:\s*([A-Za-z_]\w*)\s*([;{])/
  );
  if (!fn) return null;
  const rawName = fn[1];
  const paramsRaw = fn[2].trim();
  const returnType = fn[3];
  const ending = fn[4];
  const fullName =
    rawName.includes("::") || namespaceStack.length === 0
      ? rawName
      : `${namespaceStack.join("::")}::${rawName}`;
  const shortName = fullName.includes("::") ? fullName.split("::").pop() : fullName;
  const params = parseParams(paramsRaw);
  const signature = `${fullName}(${params.map((p) => `[${p.type}]${p.name}`).join(", ")}):${returnType}`;
  return {
    fullName,
    shortName,
    returnType,
    params,
    signature,
    ending
  };
}

function isFunctionSymbol(sym) {
  return sym.kind === "declaration" || sym.kind === "implementation";
}

function getModuleNameFromUri(uri) {
  return path.basename(uri.fsPath, path.extname(uri.fsPath));
}

function parseParams(raw) {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part, idx) => {
      const bracket = part.match(/^\[([A-Za-z_]\w*)\]\s*([A-Za-z_]\w*)$/);
      if (bracket) return { type: bracket[1], name: bracket[2] };
      const typed = part.match(/^([A-Za-z_]\w*)(\s*\*)?\s+([A-Za-z_]\w*)$/);
      if (typed) return { type: typed[1] + (typed[2] ? "*" : ""), name: typed[3] };
      return { type: "any", name: `arg${idx + 1}` };
    });
}

function buildFunctionCompletionItem(sym) {
  const item = new vscode.CompletionItem(
    sym.fullName,
    vscode.CompletionItemKind.Function
  );
  item.detail = sym.signature;
  item.sortText = sym.fullName.includes("::") ? `1_${sym.fullName}` : `0_${sym.fullName}`;
  item.documentation = new vscode.MarkdownString(
    [
      `\`${sym.signature}\``,
      "",
      `来源: \`${sym.source}\``,
      ...(sym.annotations.length
        ? ["", `注解: \`${sym.annotations.join("`, `")}\``]
        : [])
    ].join("\n")
  );

  const snippet = new vscode.SnippetString();
  snippet.appendText(`${sym.fullName}(`);
  sym.params.forEach((p, index) => {
    if (index > 0) snippet.appendText(", ");
    snippet.appendPlaceholder(p.name || `arg${index + 1}`);
  });
  snippet.appendText(")");
  item.insertText = snippet;
  return item;
}

function buildImportCompletionItems(index) {
  return index.allModuleNames().map((name) => {
    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Module);
    item.detail = "模块";
    item.insertText = name;
    item.sortText = `00_${name}`;
    return item;
  });
}

function buildDirectiveCompletionItems() {
  const overwrite = new vscode.CompletionItem(
    "@Overwrite",
    vscode.CompletionItemKind.Snippet
  );
  overwrite.insertText = new vscode.SnippetString("@Overwrite(${1:*})");
  overwrite.filterText = "Overwrite";
  overwrite.detail = "Annotation";
  overwrite.documentation = "Restrict where this function can be implemented.";

  const callfun = new vscode.CompletionItem(
    "@Callfun",
    vscode.CompletionItemKind.Snippet
  );
  callfun.insertText = new vscode.SnippetString("@Callfun(${1:*})");
  callfun.filterText = "Callfun";
  callfun.detail = "Annotation";
  callfun.documentation = "Restrict where this function can be called.";

  const version = new vscode.CompletionItem(
    "#VERSION",
    vscode.CompletionItemKind.Snippet
  );
  version.insertText = new vscode.SnippetString("#VERSION: ${1:1.0};");
  version.detail = "Preprocessor";

  const link = new vscode.CompletionItem(
    "#LINK",
    vscode.CompletionItemKind.Snippet
  );
  link.insertText = new vscode.SnippetString("#LINK: ${1:/};");
  link.detail = "Preprocessor";

  return [overwrite, callfun, version, link];
}

function getTokenSpan(document, position) {
  const lineText = document.lineAt(position.line).text;
  if (!lineText) return null;
  const isTokenChar = (ch) => /[A-Za-z0-9_:]/.test(ch);
  let left = position.character;
  let right = position.character;
  while (left > 0 && isTokenChar(lineText[left - 1])) left -= 1;
  while (right < lineText.length && isTokenChar(lineText[right])) right += 1;
  if (left === right) return null;
  const raw = lineText.slice(left, right);
  const token = raw.replace(/^:+|:+$/g, "");
  if (!/^[A-Za-z_]\w*(?:::[A-Za-z_]\w*)*$/.test(token)) return null;
  const start = left + raw.indexOf(token);
  return { token, start, end: start + token.length };
}

function getQualifiedTokenAtPosition(document, position) {
  const span = getTokenSpan(document, position);
  return span ? span.token : null;
}

function getNamespaceQualifierBeforePosition(document, position) {
  const prefix = document.lineAt(position.line).text.slice(0, position.character);
  const m = prefix.match(/([A-Za-z_]\w*(?:::[A-Za-z_]\w*)*)::[A-Za-z_]\w*$/);
  return m ? m[1] : null;
}

function parseImportsFromDocument(document) {
  const imports = new Set(["system"]);
  const text = document.getText();
  const importRegex = /^\s*import\s+([A-Za-z_](?:\w|\.\w)*)\s*;/gm;
  let match;
  while ((match = importRegex.exec(text)) !== null) {
    imports.add(match[1]);
  }
  return imports;
}

function isImportContext(document, position) {
  const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
  return /^\s*import\s+[A-Za-z_][\w.]*$/.test(linePrefix);
}

function getImportModuleAtPosition(document, position) {
  const lineText = document.lineAt(position.line).text;
  const match = lineText.match(/^\s*import\s+([A-Za-z_](?:\w|\.\w)*)\s*;/);
  if (!match) return null;
  const moduleName = match[1];
  const tokenStart = lineText.indexOf(moduleName);
  if (tokenStart < 0) return null;
  const tokenEnd = tokenStart + moduleName.length;
  if (position.character < tokenStart || position.character > tokenEnd) return null;
  return moduleName;
}

async function findModuleUrisByName(moduleName) {
  if (!moduleName) return [];
  const [mrUris, obrUris] = await Promise.all([
    vscode.workspace.findFiles(`**/${moduleName}.mr`, ANALYSIS_EXCLUDE),
    vscode.workspace.findFiles(`**/${moduleName}.obr`, ANALYSIS_EXCLUDE)
  ]);
  return [...mrUris, ...obrUris].filter((uri) => !isInstallerCopy(uri.fsPath));
}

function collectDiagnosticsForDocument(document, index) {
  const diagnostics = [];
  if (!LANGUAGE_IDS.includes(document.languageId)) return diagnostics;

  if (diagnosticsEnabled("structural")) {
    diagnostics.push(...scanStructuralDiagnostics(document.getText()));
  }
  if (vscode.workspace.getConfiguration("objectiveR").get("diagnostics.enable") !== false) {
    diagnostics.push(...scanLiveDiagnostics(document));
  }
  if (!diagnosticsEnabled("workspace")) {
    return diagnostics;
  }

  const text = document.getText();
  const lines = text.split(/\r?\n/);
  const heads = parseFunctionHeadsWithLine(text);
  const ext = path.extname(document.uri.fsPath).toLowerCase();

  // Rule 1: duplicate signatures in same file.
  const seen = new Map();
  for (const h of heads) {
    if (!seen.has(h.signature)) {
      seen.set(h.signature, h.line);
      continue;
    }
    const lineText = lines[h.line] || "";
    const range = new vscode.Range(
      new vscode.Position(h.line, 0),
      new vscode.Position(h.line, Math.max(1, lineText.length))
    );
    diagnostics.push(
      new vscode.Diagnostic(
        range,
        `重复函数签名: ${h.signature}`,
        vscode.DiagnosticSeverity.Error
      )
    );
  }

  // Rule 2: .mr should only declare (end with ';').
  if (ext === ".mr") {
    for (const h of heads) {
      if (h.ending !== ";") {
        const lineText = lines[h.line] || "";
        const range = new vscode.Range(
          new vscode.Position(h.line, 0),
          new vscode.Position(h.line, Math.max(1, lineText.length))
        );
        diagnostics.push(
          new vscode.Diagnostic(
            range,
            "`.mr` 头文件中的 `deRfun` 必须以 `;` 结束（仅声明，不应包含实现体）。",
            vscode.DiagnosticSeverity.Error
          )
        );
      }
    }
  }

  // Rule 3: .obr should implement (end with '{').
  if (ext === ".obr") {
    for (const h of heads) {
      if (h.ending !== "{") {
        const lineText = lines[h.line] || "";
        const range = new vscode.Range(
          new vscode.Position(h.line, 0),
          new vscode.Position(h.line, Math.max(1, lineText.length))
        );
        diagnostics.push(
          new vscode.Diagnostic(
            range,
            "`.obr` 实现文件中的 `deRfun` 应以 `{` 开始函数体，而不是仅声明。",
            vscode.DiagnosticSeverity.Warning
          )
        );
      }
    }
  }

  // Rule 4: import module exists.
  const modules = new Set(index.allModuleNames());
  const importRegex = /^\s*import\s+([A-Za-z_](?:\w|\.\w)*)\s*;/gm;
  let m;
  while ((m = importRegex.exec(text)) !== null) {
    const moduleName = m[1];
    if (moduleName === "system") continue;
    if (modules.has(moduleName)) continue;
    const line = document.positionAt(m.index).line;
    const lineText = lines[line] || "";
    const range = new vscode.Range(
      new vscode.Position(line, 0),
      new vscode.Position(line, Math.max(1, lineText.length))
    );
    diagnostics.push(
      new vscode.Diagnostic(
        range,
        `未找到模块 \`${moduleName}\`（检查是否存在同名 .mr/.obr 文件）。`,
        vscode.DiagnosticSeverity.Warning
      )
    );
  }

  // Rule 4.1: duplicate import module.
  const imported = new Set();
  const importRegex2 = /^\s*import\s+([A-Za-z_](?:\w|\.\w)*)\s*;/gm;
  while ((m = importRegex2.exec(text)) !== null) {
    const moduleName = m[1];
    const line = document.positionAt(m.index).line;
    if (imported.has(moduleName)) {
      const lineText = lines[line] || "";
      diagnostics.push(
        new vscode.Diagnostic(
          new vscode.Range(
            new vscode.Position(line, 0),
            new vscode.Position(line, Math.max(1, lineText.length))
          ),
          `重复 import: \`${moduleName}\`。`,
          vscode.DiagnosticSeverity.Warning
        )
      );
    }
    imported.add(moduleName);
  }

  // Rule 4.2: annotation form. @Overwrite is not accepted by this compiler.
  for (let i = 0; i < lines.length; i += 1) {
    const line = stripLineComment(lines[i] || "").trim();
    if (!line.startsWith("@")) continue;
    if (/^@Callfun\s*\([^)]*\)\s*$/.test(line)) continue;
    diagnostics.push(
      new vscode.Diagnostic(
        new vscode.Range(
          new vscode.Position(i, 0),
          new vscode.Position(i, Math.max(1, (lines[i] || "").length))
        ),
        /^@Overwrite\b/.test(line) ? "这一版编译器不接受 @Overwrite。" : "特性只接受 @Callfun(...)。",
        vscode.DiagnosticSeverity.Error
      )
    );
  }

  // Rule 5: main.obr should define main():void
  const rel = vscode.workspace.asRelativePath(document.uri, false).replace(/\\/g, "/");
  if (rel.endsWith("/main.obr") || rel === "main.obr") {
    const hasMain = heads.some((h) => h.fullName === "main");
    if (!hasMain) {
      diagnostics.push(
        new vscode.Diagnostic(
          new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1)),
          "`main.obr` 建议包含入口函数 `deRfun main():void{...}`。",
          vscode.DiagnosticSeverity.Warning
        )
      );
    }
  }

  for (const sym of parseDocumentSymbols(text)) {
    if (sym.kind !== "implementation" || sym.async) continue;
    for (let line = sym.line; line <= sym.endLine && line < lines.length; line += 1) {
      if (!/\bawait\b/.test(stripLineComment(lines[line] || ""))) continue;
      diagnostics.push(
        new vscode.Diagnostic(
          new vscode.Range(line, 0, line, Math.max(1, (lines[line] || "").length)),
          "`await` 只能写在 async 函数里。",
          vscode.DiagnosticSeverity.Error
        )
      );
      break;
    }
  }

  return diagnostics;
}

function filterVisibleSymbols(symbols, document) {
  const imports = parseImportsFromDocument(document);
  const currentModule = getModuleNameFromUri(document.uri);
  return symbols.filter((sym) => {
    if (!sym || !sym.moduleName) return false;
    if (sym.moduleName === currentModule) return true;
    if (imports.has(sym.moduleName)) return true;
    return false;
  });
}

function resolveSymbolsForHover(index, document, position, token) {
  if (!token) return [];
  if (token.includes("::")) return index.find(token);

  const qualifier = getNamespaceQualifierBeforePosition(document, position);
  if (qualifier) {
    const qualified = filterVisibleSymbols(
      index.find(`${qualifier}::${token}`),
      document
    );
    if (qualified.length) return qualified;
  }

  return filterVisibleSymbols(index.find(token), document);
}

function toDisplayName(sym) {
  return sym.fullName.includes("::") ? sym.fullName : `${sym.fullName}`;
}

function symbolLabel(sym) {
  if (sym.kind === "enum") return "枚举";
  if (sym.kind === "enumValue") return "枚举值";
  if (sym.kind === "struct") return "结构体";
  return "函数";
}

function callerGroups(index, sym) {
  const groups = new Map();
  for (const call of index.calls) {
    if (!callMatchesSymbol(call, sym)) continue;
    const key = `${call.source}:${call.callerLine}:${call.callerFullName}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(call);
  }
  return [...groups.values()];
}

function buildHoverMarkdown(matches, index) {
  const md = new vscode.MarkdownString(undefined, true);
  const top = matches[0];
  md.appendMarkdown(`**${symbolLabel(top)}: ${toDisplayName(top)}**\n\n`);
  md.appendCodeblock(top.signature, "objective-r-obr");
  if (top.doc) {
    md.appendMarkdown(`\n\n${top.doc}\n\n`);
  }
  md.appendMarkdown(`\n\n定义: \`${top.source}:${top.line}\`\n\n`);
  if (top.annotations && top.annotations.length) {
    md.appendMarkdown(`注解: \`${top.annotations.join("`, `")}\`\n\n`);
  }

  if (isFunctionSymbol(top)) {
    const groups = callerGroups(index, top);
    if (groups.length) {
      const sites = groups.reduce((sum, group) => sum + group.length, 0);
      md.appendMarkdown(`**调用方** ${groups.length} 个函数，${sites} 处\n\n`);
      for (const group of groups.slice(0, 8)) {
        const sample = group[0];
        const who = sample.callerFullName || "顶层";
        const extra = group.length > 1 ? ` 等 ${group.length} 处` : "";
        md.appendMarkdown(`- \`${who}\` — \`${sample.source}:${sample.line}\`${extra}\n`);
      }
      if (groups.length > 8) {
        md.appendMarkdown(`\n还有 ${groups.length - 8} 个调用方。\n`);
      }
    }
  }

  if (matches.length > 1) {
    md.appendMarkdown(`\n\n**其他签名**\n\n`);
    for (const sym of matches.slice(1, 7)) {
      md.appendMarkdown(`- \`${sym.signature}\`  \n  来自 \`${sym.source}:${sym.line}\`\n`);
    }
    if (matches.length > 7) {
      md.appendMarkdown(`\n... 还有 ${matches.length - 7} 个重载。`);
    }
  }
  return md;
}

function lookupLocal(document, position, index) {
  const word = document.getWordRangeAtPosition(position, /[A-Za-z_]\w*/);
  if (!word) return null;
  const name = document.getText(word);
  const line = position.line + 1;
  const functions = index
    .allSymbols()
    .filter(
      (sym) =>
        sym.kind === "implementation" &&
        sym.uri.toString() === document.uri.toString() &&
        line >= sym.line &&
        line <= sym.endLine
    )
    .sort((a, b) => a.endLine - a.line - (b.endLine - b.line));
  const fn = functions[0];
  if (!fn) return null;
  const param = (fn.params || []).find((item) => item.name === name);
  if (param) {
    return {
      text: `参数 \`${param.type} ${param.name}\`，属于 \`${fn.fullName}\``,
      range: word
    };
  }
  const text = document.getText(new vscode.Range(new vscode.Position(fn.line - 1, 0), position));
  const decl = /(?:^|[^A-Za-z0-9_])(long|int|short|byte|float|double|boolean|char|string)\s*(\*)?\s+([A-Za-z_]\w*)/g;
  let found = null;
  let match;
  while ((match = decl.exec(text)) !== null) {
    if (match[3] === name) found = `${match[1]}${match[2] || ""} ${match[3]}`;
  }
  if (!found) return null;
  return {
    text: `局部变量 \`${found.replace(/\s+/g, " ")}\`，属于 \`${fn.fullName}\``,
    range: word
  };
}

function rankDefinitionMatches(matches, document, position) {
  const currentRel = vscode.workspace.asRelativePath(document.uri, false);
  const currentLine = position.line + 1;
  const fromObr = document.languageId === "objective-r-obr";

  const withoutSelf = matches.filter((sym) => {
    // Avoid "no move" by excluding the exact current location.
    return !(sym.source === currentRel && sym.line === currentLine);
  });
  const pool = withoutSelf.length ? withoutSelf : matches;

  const rank = (sym) => {
    const isMr = String(sym.source || "").toLowerCase().endsWith(".mr");
    const isDecl = sym.kind === "declaration";
    if (fromObr) {
      if (isMr && isDecl) return 0;
      if (isMr) return 1;
      if (isDecl) return 2;
      return 3;
    }
    if (isDecl) return 0;
    return 1;
  };

  return [...pool].sort((a, b) => rank(a) - rank(b));
}

function extractCallContext(document, position) {
  const line = document.lineAt(position.line).text.slice(0, position.character);
  const m = line.match(/([A-Za-z_]\w*(?:::[A-Za-z_]\w*)*)\s*\(([^()]*)$/);
  if (!m) return null;
  const fnName = m[1];
  const argText = m[2] || "";
  const activeParameter = argText.trim() ? argText.split(",").length - 1 : 0;
  return { fnName, activeParameter };
}

async function activate(context) {
  const index = new ObrIndex();
  await index.rebuild();
  const diagnosticCollection = vscode.languages.createDiagnosticCollection("objective-r");
  context.subscriptions.push(diagnosticCollection);
  let scheduledRefresh = null;

  const refreshDiagnosticsForAll = async () => {
    const uris = await collectAnalysisUris();
    const docs = await Promise.all(uris.map((uri) => vscode.workspace.openTextDocument(uri)));
    for (const doc of docs) {
      const diags = collectDiagnosticsForDocument(doc, index);
      diagnosticCollection.set(doc.uri, diags);
    }
  };
  const semanticTokensChangeEmitter = new vscode.EventEmitter();
  context.subscriptions.push(semanticTokensChangeEmitter);

  const scheduleIndexAndDiagnosticsRefresh = (delayMs = 250) => {
    if (scheduledRefresh) clearTimeout(scheduledRefresh);
    scheduledRefresh = setTimeout(async () => {
      scheduledRefresh = null;
      try {
        await index.rebuild();
        await refreshDiagnosticsForAll();
        semanticTokensChangeEmitter.fire();
      } catch (_e) {
        // Keep extension responsive if background refresh fails.
      }
    }, delayMs);
  };
  context.subscriptions.push(
    new vscode.Disposable(() => {
      if (scheduledRefresh) clearTimeout(scheduledRefresh);
    })
  );
  await refreshDiagnosticsForAll();
  registerZapBinary(context);

  const watcherMr = vscode.workspace.createFileSystemWatcher("**/*.mr");
  const watcherObr = vscode.workspace.createFileSystemWatcher("**/*.obr");

  const onChange = async (_uri) => {
    scheduleIndexAndDiagnosticsRefresh(180);
  };
  watcherMr.onDidChange(onChange);
  watcherMr.onDidCreate(onChange);
  watcherMr.onDidDelete(onChange);
  watcherObr.onDidChange(onChange);
  watcherObr.onDidCreate(onChange);
  watcherObr.onDidDelete(onChange);

  context.subscriptions.push(watcherMr, watcherObr);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("objectiveR")) {
        scheduleIndexAndDiagnosticsRefresh(0);
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(async (doc) => {
      if (!LANGUAGE_IDS.includes(doc.languageId)) return;
      diagnosticCollection.set(doc.uri, collectDiagnosticsForDocument(doc, index));
    }),
    vscode.workspace.onDidChangeTextDocument((evt) => {
      const doc = evt.document;
      if (!LANGUAGE_IDS.includes(doc.languageId)) return;
      diagnosticCollection.set(doc.uri, collectDiagnosticsForDocument(doc, index));
      scheduleIndexAndDiagnosticsRefresh(500);
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      diagnosticCollection.delete(doc.uri);
    })
  );

  const completionProvider = vscode.languages.registerCompletionItemProvider(
    LANGUAGE_IDS,
    {
      provideCompletionItems(document, position) {
        if (vscode.workspace.getConfiguration("objectiveR").get("completion.enable") === false) {
          return [];
        }

        const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
        if (/\bstd::\w*$/.test(linePrefix)) {
          return STD_NAMESPACE_COMPLETIONS;
        }

        const items = [];
        if (isImportContext(document, position)) {
          return buildImportCompletionItems(index);
        }

        for (const kw of KEYWORDS) {
          const item = new vscode.CompletionItem(
            kw,
            kw.startsWith("#")
              ? vscode.CompletionItemKind.Keyword
              : vscode.CompletionItemKind.Keyword
          );
          item.insertText = kw;
          item.sortText = `1_${kw}`;
          items.push(item);
        }
        items.push(...buildDirectiveCompletionItems());
        items.push(...buildVarSnippetCompletions());

        const qualifier = getNamespaceQualifierBeforePosition(document, position);
        const symbols = qualifier ? index.allSymbols() : filterVisibleSymbols(index.allSymbols(), document);
        for (const sym of symbols) {
          if (!isFunctionSymbol(sym)) continue;
          const item = buildFunctionCompletionItem(sym);
          if (qualifier) {
            const preferredPrefix = `${qualifier}::`;
            item.sortText = sym.fullName.startsWith(preferredPrefix)
              ? `0_${sym.fullName}`
              : `2_${sym.fullName}`;
          } else {
            item.sortText = `0_${sym.fullName}`;
          }
          items.push(item);
        }

        return items;
      }
    },
    ":",
    ".",
    "@",
    "#"
  );

  const hoverProvider = vscode.languages.registerHoverProvider([...LANGUAGE_IDS, "zap"], {
    async provideHover(document, position) {
      const qualified = getTokenSpan(document, position);
      if (qualified && qualified.token.includes("::")) {
        const matches = resolveSymbolsForHover(index, document, position, qualified.token);
        if (matches.length) {
          return new vscode.Hover(
            buildHoverMarkdown(matches, index),
            new vscode.Range(position.line, qualified.start, position.line, qualified.end)
          );
        }
        const library = lookupLibrary(qualified.token);
        if (library) {
          const md = new vscode.MarkdownString(library);
          md.isTrusted = false;
          return new vscode.Hover(
            md,
            new vscode.Range(position.line, qualified.start, position.line, qualified.end)
          );
        }
      }

      const word = document.getWordRangeAtPosition(
        position,
        /#VERSION|#LINK|#DYN|[A-Za-z_][\w]*(?:\.[A-Za-z0-9]+)?/
      );
      if (word) {
        const text = document.getText(word);
        const tip = inZapBlock(document, position.line) ? lookupZap(text) : lookupObr(text) || lookupLibrary(text);
        if (tip) {
          const md = new vscode.MarkdownString(tip);
          md.isTrusted = false;
          return new vscode.Hover(md, word);
        }
      }

      if (document.languageId === "zap") return null;

      const importModule = getImportModuleAtPosition(document, position);
      if (importModule) {
        const uris = await findModuleUrisByName(importModule);
        const md = new vscode.MarkdownString(undefined, true);
        md.appendMarkdown(`**模块: ${importModule}**\n\n`);
        if (!uris.length) {
          md.appendMarkdown("未找到对应模块文件（`.mr` / `.obr`）。");
        } else {
          for (const uri of uris.slice(0, 6)) {
            const rel = vscode.workspace.asRelativePath(uri, false);
            md.appendMarkdown(`- \`${rel}\`\n`);
          }
        }
        return new vscode.Hover(md);
      }

      const span = getTokenSpan(document, position);
      if (span) {
        const matches = resolveSymbolsForHover(index, document, position, span.token);
        if (matches.length) {
          const md = buildHoverMarkdown(matches, index);
          const range = new vscode.Range(
            new vscode.Position(position.line, span.start),
            new vscode.Position(position.line, span.end)
          );
          return new vscode.Hover(md, range);
        }
      }

      const local = lookupLocal(document, position, index);
      if (local) {
        const md = new vscode.MarkdownString(local.text);
        md.isTrusted = false;
        return new vscode.Hover(md, local.range);
      }
      if (qualified) {
        const library = lookupLibrary(qualified.token);
        if (library) {
          const md = new vscode.MarkdownString(library);
          md.isTrusted = false;
          return new vscode.Hover(
            md,
            new vscode.Range(position.line, qualified.start, position.line, qualified.end)
          );
        }
      }
      return null;
    }
  });

  const signatureProvider = vscode.languages.registerSignatureHelpProvider(
    LANGUAGE_IDS,
    {
      provideSignatureHelp(document, position) {
        const ctx = extractCallContext(document, position);
        if (!ctx) return null;
        const pool = ctx.fnName.includes("::") ? index.find(ctx.fnName) : filterVisibleSymbols(index.find(ctx.fnName), document);
        const matches = pool.filter(isFunctionSymbol);
        if (!matches.length) return null;

        const result = new vscode.SignatureHelp();
        result.activeParameter = ctx.activeParameter;
        result.activeSignature = 0;
        result.signatures = matches.map((sym) => {
          const note = sym.doc ? `\n\n${sym.doc}` : "";
          const info = new vscode.SignatureInformation(
            sym.signature,
            new vscode.MarkdownString(
              `来源: \`${sym.source}:${sym.line}\`${sym.annotations.length ? `\n\n注解: \`${sym.annotations.join("`, `")}\`` : ""}${note}`
            )
          );
          info.parameters = sym.params.map(
            (p) => new vscode.ParameterInformation(`[${p.type}]${p.name}`)
          );
          return info;
        });
        return result;
      }
    },
    "(",
    ","
  );

  const definitionProvider = vscode.languages.registerDefinitionProvider(
    LANGUAGE_IDS,
    {
      async provideDefinition(document, position) {
        const importModule = getImportModuleAtPosition(document, position);
        if (importModule) {
          const uris = await findModuleUrisByName(importModule);
          return uris.map((uri) => new vscode.Location(uri, new vscode.Position(0, 0)));
        }

        const token = getQualifiedTokenAtPosition(document, position);
        if (!token) return null;
        const matches = resolveSymbolsForHover(index, document, position, token);
        if (!matches.length) return null;

        const ranked = rankDefinitionMatches(matches, document, position);
        return ranked.map((sym) => {
          const targetLine = Math.max(0, (sym.line || 1) - 1);
          return new vscode.Location(sym.uri, new vscode.Position(targetLine, 0));
        });
      }
    }
  );

  const referenceProvider = vscode.languages.registerReferenceProvider(
    LANGUAGE_IDS,
    {
      async provideReferences(document, position) {
        const token = getQualifiedTokenAtPosition(document, position);
        if (!token) return [];
        const matches = resolveSymbolsForHover(index, document, position, token);
        if (!matches.length) return [];

        const names = new Set();
        for (const sym of matches) {
          names.add(sym.fullName);
          names.add(sym.shortName);
        }
        const pattern = [...names]
          .sort((a, b) => b.length - a.length)
          .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("|");
        if (!pattern) return [];

        const allUris = await collectAnalysisUris();
        const allDocs = await Promise.all(
          allUris.map((uri) => vscode.workspace.openTextDocument(uri))
        );

        const refRegex = new RegExp(`\\b(?:${pattern})\\b`, "g");
        const refs = [];
        for (const doc of allDocs) {
          const text = doc.getText();
          let m;
          while ((m = refRegex.exec(text)) !== null) {
            const start = doc.positionAt(m.index);
            const end = doc.positionAt(m.index + m[0].length);
            refs.push(new vscode.Location(doc.uri, new vscode.Range(start, end)));
          }
        }
        return refs;
      }
    }
  );

  function toCallItem(sym) {
    const start = Math.max(0, sym.line - 1);
    const end = Math.max(start, (sym.endLine || sym.line) - 1);
    return new vscode.CallHierarchyItem(
      vscode.SymbolKind.Function,
      sym.shortName,
      sym.signature,
      sym.uri,
      new vscode.Range(start, 0, end, 0),
      new vscode.Range(start, 0, start, Math.max(1, sym.shortName.length))
    );
  }

  function symbolFromItem(item) {
    return index.allSymbols().find(
      (sym) => isFunctionSymbol(sym) && sym.uri.toString() === item.uri.toString() && sym.signature === item.detail
    );
  }

  const callHierarchyProvider = vscode.languages.registerCallHierarchyProvider(LANGUAGE_IDS, {
    prepareCallHierarchy(document, position) {
      const token = getQualifiedTokenAtPosition(document, position);
      if (!token) return undefined;
      const matches = resolveSymbolsForHover(index, document, position, token).filter(isFunctionSymbol);
      if (!matches.length) return undefined;
      return matches.map(toCallItem);
    },
    provideCallHierarchyIncomingCalls(item) {
      const target = symbolFromItem(item);
      if (!target) return [];
      const result = [];
      for (const group of callerGroups(index, target)) {
        const sample = group[0];
        const caller = index.allSymbols().find(
          (sym) =>
            sym.kind === "implementation" &&
            sym.uri.toString() === sample.callerUri.toString() &&
            sym.line === sample.callerLine &&
            sym.fullName === sample.callerFullName
        );
        if (!caller) continue;
        result.push(
          new vscode.CallHierarchyIncomingCall(
            toCallItem(caller),
            group.map((call) => new vscode.Range(call.line - 1, call.start, call.line - 1, call.end))
          )
        );
      }
      return result;
    },
    provideCallHierarchyOutgoingCalls(item) {
      const caller = symbolFromItem(item);
      if (!caller || caller.kind !== "implementation") return [];
      const groups = new Map();
      for (const call of index.calls) {
        if (call.callerUri.toString() !== caller.uri.toString() || call.callerLine !== caller.line) continue;
        const key = `${call.name}:${call.argCount}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(call);
      }
      const result = [];
      for (const group of groups.values()) {
        const sample = group[0];
        const target = index.allSymbols().find((sym) => callMatchesSymbol(sample, sym));
        const ranges = group.map((call) => new vscode.Range(call.line - 1, call.start, call.line - 1, call.end));
        if (!target) {
          const range = ranges[0];
          const unresolved = new vscode.CallHierarchyItem(
            vscode.SymbolKind.Function,
            sample.name,
            "未找到声明",
            sample.uri,
            range,
            range
          );
          result.push(new vscode.CallHierarchyOutgoingCall(unresolved, ranges));
          continue;
        }
        result.push(new vscode.CallHierarchyOutgoingCall(toCallItem(target), ranges));
      }
      return result;
    }
  });

  context.subscriptions.push(
    completionProvider,
    callHierarchyProvider,
    hoverProvider,
    signatureProvider,
    definitionProvider,
    referenceProvider,
    registerSemanticTokensProvider(
      vscode,
      () => index,
      () => vscode.workspace.getConfiguration("objectiveR"),
      semanticTokensChangeEmitter.event
    )
  );

  const binaryHover = vscode.languages.registerHoverProvider(["zap-binary", "zap-library"], {
    provideHover(document, position) {
      const line = document.lineAt(position.line).text;
      const parts = [];
      const source = line.match(/源\s+(.+):(\d+)\s*(.*)$/);
      if (source) {
        parts.push(`\`${source[1]}:${source[2]}\``);
        if (source[3]) parts.push(source[3]);
      }
      const op = line.match(/^\s*[0-9A-Fa-f]+\s+([A-Za-z][\w.]*)/);
      if (op) {
        const tip = lookupZap(op[1]);
        if (tip) parts.push(tip);
      }
      if (parts.length === 0) return null;
      const md = new vscode.MarkdownString(parts.join("\n\n"));
      md.isTrusted = false;
      return new vscode.Hover(md);
    }
  });
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
  status.name = "Obr";
  context.subscriptions.push(binaryHover, status);
  registerCompilerLint(context, status);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
