/**
 * 文档语义 token：函数名、形参、局部 var 声明与引用、限定名命名空间段、调用处函数名。
 * 与 TextMate 互补；不替代 Blink 语义绑定。
 */

const path = require("path");
const { ScopeTracker } = require("./symbols");

const TYPE_KEYWORDS = new Set([
  "void",
  "boolean",
  "byte",
  "short",
  "int",
  "long",
  "float",
  "double",
  "char",
  "string"
]);

const STMT_KEYWORDS = new Set([
  "deRfun",
  "import",
  "export",
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
  "true",
  "false",
  "null",
  "undefined"
]);

function stripBlockComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
}

function stripLineComment(line) {
  return line.replace(/\/\/.*$/, "");
}

function maskLineStrings(line) {
  let out = "";
  let inStr = null;
  let esc = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inStr) {
      if (esc) {
        esc = false;
        out += " ";
        continue;
      }
      if (c === "\\") {
        esc = true;
        out += " ";
        continue;
      }
      if (c === inStr) {
        inStr = null;
        out += c;
        continue;
      }
      out += " ";
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      out += c;
      continue;
    }
    out += c;
  }
  return out;
}

function maskLineForIdents(line) {
  let s = maskLineStrings(line);
  const idx = s.indexOf("//");
  if (idx >= 0) {
    s = s.slice(0, idx) + " ".repeat(s.length - idx);
  }
  return s;
}

function maskLineForBraces(line) {
  return maskLineForIdents(line);
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
    /^deRfun\s+([A-Za-z_]\w*(?:::[A-Za-z_]\w*)*)\s*\(([^)]*)\)\s*:\s*([A-Za-z_]\w*)\s*([;{])/
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
  return {
    fullName,
    shortName,
    returnType,
    params,
    ending
  };
}

function parseParams(raw) {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part, idx) => {
      const m = part.match(/^\[([A-Za-z_]\w*)\]\s*([A-Za-z_]\w*)$/);
      if (m) return { type: m[1], name: m[2] };
      return { type: "any", name: `arg${idx + 1}` };
    });
}

function findBraceBodyRange(lines, fromLine) {
  let depth = 0;
  let started = false;
  let startLine = -1;
  for (let i = fromLine; i < lines.length; i += 1) {
    const masked = maskLineForBraces(lines[i]);
    for (let j = 0; j < masked.length; j += 1) {
      const c = masked[j];
      if (c === "{") {
        depth += 1;
        if (!started) {
          started = true;
          startLine = i;
        }
      } else if (c === "}") {
        depth -= 1;
        if (started && depth === 0) {
          return { startLine, endLine: i };
        }
      }
    }
  }
  return null;
}

function parseVarDeclaratorNames(segment) {
  const names = [];
  const parts = segment.split(",");
  for (const part of parts) {
    const p = part.trim();
    if (!p) continue;
    const eq = p.indexOf("=");
    const left = (eq >= 0 ? p.slice(0, eq) : p).trim();
    const m = left.match(/^([A-Za-z_]\w*)/);
    if (m) names.push(m[1]);
  }
  return names;
}

/**
 * @param {import('vscode')} vscode
 */
function buildSemanticTokens(vscode, document, obrIndex, legend) {
  const text = document.getText();
  const lines = text.split(/\r\n|\r|\n/);
  const ext = path.extname(document.uri.fsPath).toLowerCase();
  const builder = new vscode.SemanticTokensBuilder(legend);

  const T = { function: 0, parameter: 1, variable: 2, namespace: 3 };
  const DECL = 1;

  const pushRange = (line, startCol, endCol, typeIdx, mod = 0) => {
    if (startCol >= endCol) return;
    const len = endCol - startCol;
    builder.push(line, startCol, len, typeIdx, mod);
  };

  const indexFnNames = new Set();
  try {
    for (const sym of obrIndex.allSymbols()) {
      if (sym && sym.shortName) indexFnNames.add(sym.shortName);
      if (sym && sym.fullName) {
        indexFnNames.add(sym.fullName.split("::").pop());
      }
    }
  } catch (_e) {
    /* ignore */
  }

  if (ext === ".mr") {
    const scope = new ScopeTracker();
    for (let i = 0; i < lines.length; i += 1) {
      scope.feed(lines[i]);
      let line = stripLineComment(lines[i]).trim();
      if (/^namespace\s+/.test(line)) continue;
      if (/^deRfun\b/.test(line)) {
        const { merged, endLine } = readFunctionHeader(lines, i);
        const parsed = parseFunctionFromHeader(merged, scope.namespaces);
        if (parsed) {
          const hdrLine = lines[i];
          const mName = hdrLine.match(/deRfun\s+([A-Za-z_:]\w*)/);
          if (mName) {
            const start = hdrLine.indexOf(mName[1]);
            pushRange(i, start, start + mName[1].length, T.function, DECL);
          }
          const inner = merged.match(/\(([^)]*)\)/);
          if (inner) {
            const pr = inner[1];
            const re = /\[([A-Za-z_]\w*)\]\s*([A-Za-z_]\w*)/g;
            let pm;
            while ((pm = re.exec(pr)) !== null) {
              const name = pm[2];
              const sub = hdrLine.indexOf(name);
              if (sub >= 0) {
                pushRange(i, sub, sub + name.length, T.parameter, DECL);
              }
            }
          }
        }
        while (i < endLine) {
          i += 1;
          scope.feed(lines[i]);
        }
      }
    }
    return builder.build();
  }

  if (ext !== ".obr") {
    return builder.build();
  }

  const strippedBlock = stripBlockComments(text);
  const slines = strippedBlock.split(/\r\n|\r|\n/);
  const scope = new ScopeTracker();

  for (let i = 0; i < lines.length; ) {
    scope.feed(lines[i]);
    let line = stripLineComment(lines[i]).trim();
    if (/^namespace\s+/.test(line)) {
      i += 1;
      continue;
    }

    if (/^__zap__\b/.test(line)) {
      i += 1;
      while (i < lines.length && lines[i].trim() !== "}") i += 1;
      i += 1;
      continue;
    }

    if (/^(?:export\s+)?deRfun\b/.test(line)) {
      const { merged, endLine } = readFunctionHeader(lines, i);
      const parsed = parseFunctionFromHeader(merged, scope.namespaces);
      if (!parsed) {
        while (i < endLine) {
          i += 1;
          scope.feed(lines[i]);
        }
        i = endLine + 1;
        continue;
      }

      const hdrLine = lines[i];
      const mName = hdrLine.match(/deRfun\s+([A-Za-z_:]\w*)/);
      if (mName) {
        const start = hdrLine.indexOf(mName[1]);
        pushRange(i, start, start + mName[1].length, T.function, DECL);
      }

      const inner = merged.match(/\(([^)]*)\)/);
      if (inner) {
        const pr = inner[1];
        const re = /\[([A-Za-z_]\w*)\]\s*([A-Za-z_]\w*)/g;
        let pm;
        while ((pm = re.exec(pr)) !== null) {
          const name = pm[2];
          const li = i;
          const hl = lines[li];
          const sub = hl.indexOf(name);
          if (sub >= 0) {
            pushRange(li, sub, sub + name.length, T.parameter, DECL);
          }
        }
      }

      if (parsed.ending === "{") {
        const bodyRange = findBraceBodyRange(slines, i);
        if (bodyRange) {
          const paramSet = new Set(parsed.params.map((p) => p.name));
          const scopeStack = [new Set()];
          let braceDepth = 0;

          for (let li = bodyRange.startLine; li <= bodyRange.endLine; li += 1) {
            const raw = lines[li];
            const masked = maskLineForIdents(raw);

            const braceLine = maskLineForBraces(raw);
            for (let j = 0; j < braceLine.length; j += 1) {
              const c = braceLine[j];
              if (c === "{") {
                braceDepth += 1;
                if (braceDepth >= 2) scopeStack.push(new Set());
              } else if (c === "}") {
                if (braceDepth >= 2 && scopeStack.length > 1) scopeStack.pop();
                braceDepth = Math.max(0, braceDepth - 1);
              }
            }

            if (/\bvar\s*\[/.test(masked)) {
              const varM = masked.match(/\bvar\s*\[([^\]]+)\]\s*(.+?)\s*;/);
              if (varM) {
                const decl = varM[2].trim();
                const names = parseVarDeclaratorNames(decl);
                const ix = masked.indexOf("]");
                const tail = ix >= 0 ? masked.slice(ix + 1) : "";
                for (const nm of names) {
                  scopeStack[scopeStack.length - 1].add(nm);
                  const rel = tail.indexOf(nm);
                  if (rel >= 0 && ix >= 0) {
                    const col = ix + 1 + rel;
                    pushRange(li, col, col + nm.length, T.variable, DECL);
                  }
                }
              }
            }

            const idRe = /\b([A-Za-z_]\w*)\b/g;
            let im;
            while ((im = idRe.exec(masked)) !== null) {
              const nm = im[1];
              const col = im.index;
              if (STMT_KEYWORDS.has(nm) || TYPE_KEYWORDS.has(nm)) continue;

              if (paramSet.has(nm)) {
                pushRange(li, col, col + nm.length, T.parameter, 0);
                continue;
              }

              let inScope = false;
              for (let s = scopeStack.length - 1; s >= 0; s -= 1) {
                if (scopeStack[s].has(nm)) {
                  inScope = true;
                  break;
                }
              }
              if (inScope) {
                pushRange(li, col, col + nm.length, T.variable, 0);
                continue;
              }

              if (indexFnNames.has(nm)) {
                const rest = masked.slice(col + nm.length);
                if (/^\s*\(/.test(rest)) {
                  pushRange(li, col, col + nm.length, T.function, 0);
                }
              }
            }

            const qualRe = /([A-Za-z_]\w*)::([A-Za-z_]\w*)/g;
            let qm;
            while ((qm = qualRe.exec(masked)) !== null) {
              const c0 = qm.index;
              const nsPart = qm[1];
              pushRange(li, c0, c0 + nsPart.length, T.namespace, 0);
            }
          }
        }
      }

      while (i < endLine) {
        i += 1;
        scope.feed(lines[i]);
      }
      i = endLine + 1;
      continue;
    }

    i += 1;
  }

  return builder.build();
}

/**
 * @param {import('vscode')} vscode
 * @param {() => any} getIndex
 * @param {() => import('vscode').WorkspaceConfiguration} getConfig
 * @param {import('vscode').Event<void> | undefined} onDidChangeSemanticTokens
 */
function registerSemanticTokensProvider(vscode, getIndex, getConfig, onDidChangeSemanticTokens) {
  const legend = new vscode.SemanticTokensLegend(
    ["function", "parameter", "variable", "namespace"],
    ["declaration"]
  );

  const opts = onDidChangeSemanticTokens ? { onDidChangeSemanticTokens } : undefined;

  return vscode.languages.registerDocumentSemanticTokensProvider(
    [{ language: "objective-r-obr" }, { language: "objective-r-mr" }],
    {
      provideDocumentSemanticTokens(document) {
        const cfg = getConfig();
        if (cfg.get("semanticHighlighting.enable") === false) {
          return null;
        }
        const index = getIndex();
        if (!index || !index.workspaceReady) {
          return new vscode.SemanticTokens(new Uint32Array(0));
        }
        return buildSemanticTokens(vscode, document, index, legend);
      }
    },
    legend,
    opts
  );
}

module.exports = {
  registerSemanticTokensProvider,
  buildSemanticTokens
};
