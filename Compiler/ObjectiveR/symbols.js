/**
 * 从 .obr / .mr 文本里抽出函数、枚举和调用。
 * 花括号按嵌套计数。enum、struct 和函数体里的 } 不会退出 namespace。
 */

const CALL_SKIP = new Set([
  "deRfun",
  "if",
  "else",
  "while",
  "for",
  "return",
  "namespace",
  "enum",
  "struct",
  "class",
  "new",
  "import",
  "export",
  "async",
  "await",
  "goto",
  "break",
  "continue"
]);

class ScopeTracker {
  constructor() {
    this.namespaces = [];
    this.flags = [];
    this.pending = null;
  }

  feed(line) {
    const code = stripLineComment(maskStrings(line));
    const ns = code.trim().match(/^namespace\s+([A-Za-z_]\w*)\b/);
    if (ns) this.pending = ns[1];
    for (const ch of code) {
      if (ch === "{") {
        if (this.pending) {
          this.namespaces.push(this.pending);
          this.flags.push(true);
          this.pending = null;
        } else {
          this.flags.push(false);
        }
      } else if (ch === "}") {
        if (this.flags.pop()) this.namespaces.pop();
      }
    }
  }
}

function maskStrings(line) {
  return line
    .replace(/"(?:\\.|[^"\\])*"/g, (chunk) => " ".repeat(chunk.length))
    .replace(/'(?:\\.|[^'\\])*'/g, (chunk) => " ".repeat(chunk.length));
}

function stripLineComment(line) {
  const masked = maskStrings(line);
  const idx = masked.indexOf("//");
  if (idx < 0) return line;
  return line.slice(0, idx);
}

function blankBlockComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));
}

function qualify(namespaces, name) {
  if (!name) return name;
  if (name.includes("::") || namespaces.length === 0) return name;
  return `${namespaces.join("::")}::${name}`;
}

function shortNameOf(fullName) {
  const parts = fullName.split("::");
  return parts[parts.length - 1] || fullName;
}

function parseParams(raw) {
  if (!raw) return [];
  const parts = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index <= raw.length; index += 1) {
    const ch = raw[index];
    if (ch === "[") depth += 1;
    else if (ch === "]") depth = Math.max(0, depth - 1);
    else if (index === raw.length || (ch === "," && depth === 0)) {
      parts.push(raw.slice(start, index));
      start = index + 1;
    }
  }
  const typePattern = /^(array\[[^\]]+\]|list\[[^\]]+\]|set\[[^\]]+\]|map\[[^\]]+\]|[A-Za-z_]\w*(?:::[A-Za-z_]\w*)*(?:\s*\*)?)\s+([A-Za-z_]\w*)$/;
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part, idx) => {
      const bracket = part.match(/^\[([A-Za-z_]\w*(?:\s*\*)?)\]\s*([A-Za-z_]\w*)$/);
      if (bracket) return { type: bracket[1].replace(/\s+/g, ""), name: bracket[2] };
      const typed = part.match(typePattern);
      if (typed) return { type: typed[1].replace(/\s+/g, ""), name: typed[2] };
      return { type: "any", name: `arg${idx + 1}` };
    });
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

function parseFunctionFromHeader(headerText, namespaces) {
  const typePattern = "(?:array|list|set|map)\\[[^\\]]+\\]|[A-Za-z_]\\w*(?:::[A-Za-z_]\\w*)*(?:\\s*\\*)?";
  const fn = headerText.match(
    new RegExp(
      `^(?:(?:export|public|private|static|async)\\s+)*deRfun\\s+([A-Za-z_]\\w*(?:::[A-Za-z_]\\w*)*)\\s*\\((.*)\\)\\s*:\\s*(${typePattern})\\s*([;{])\\s*$`
    )
  );
  if (!fn) return null;
  const fullName = qualify(namespaces, fn[1]);
  const params = parseParams(fn[2].trim());
  const returnType = fn[3].replace(/\s+/g, "");
  const ending = fn[4];
  const signature = `${fullName}(${params.map((p) => `[${p.type}]${p.name}`).join(", ")}):${returnType}`;
  return {
    fullName,
    shortName: shortNameOf(fullName),
    returnType,
    params,
    signature,
    ending,
    async: /(?:^|\s)async(?=\s)/.test(headerText)
  };
}

function findBraceEnd(lines, fromLine) {
  let depth = 0;
  let started = false;
  for (let i = fromLine; i < lines.length; i += 1) {
    const code = stripLineComment(maskStrings(lines[i]));
    for (const ch of code) {
      if (ch === "{") {
        depth += 1;
        started = true;
      } else if (ch === "}") {
        depth -= 1;
        if (started && depth === 0) return i;
      }
    }
  }
  return fromLine;
}

function precedingDoc(rawLines, index) {
  let i = index - 1;
  while (i >= 0) {
    const trimmed = rawLines[i].trim();
    if (trimmed === "" || /^@(Overwrite|Callfun)\b/.test(trimmed)) {
      i -= 1;
      continue;
    }
    break;
  }
  if (i < 0) return "";
  const trimmed = rawLines[i].trim();
  if (trimmed.startsWith("//")) {
    const notes = [];
    while (i >= 0 && rawLines[i].trim().startsWith("//")) {
      notes.unshift(rawLines[i].trim().replace(/^\/\/\s?/, ""));
      i -= 1;
    }
    return notes.join(" ");
  }
  if (trimmed.endsWith("*/")) {
    const end = i;
    while (i >= 0 && !rawLines[i].includes("/*")) i -= 1;
    if (i < 0) return "";
    return rawLines
      .slice(i, end + 1)
      .join(" ")
      .replace(/\/\*+/, "")
      .replace(/\*+\//, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  return "";
}

function precedingAnnotations(rawLines, index) {
  const found = [];
  let i = index - 1;
  while (i >= 0) {
    const trimmed = rawLines[i].trim();
    if (
      trimmed === "" ||
      trimmed.startsWith("//") ||
      trimmed.startsWith("/*") ||
      trimmed.startsWith("*") ||
      trimmed.endsWith("*/")
    ) {
      i -= 1;
      continue;
    }
    const ann = trimmed.match(/^@(Overwrite|Callfun)\s*\(([^)]*)\)\s*$/);
    if (!ann) break;
    found.unshift(`${ann[1]}(${ann[2] || ""})`);
    i -= 1;
  }
  return found;
}

function readBalanced(lines, startLine) {
  let depth = 0;
  let started = false;
  let endLine = startLine;
  let body = "";
  for (let i = startLine; i < lines.length; i += 1) {
    const code = stripLineComment(maskStrings(lines[i]));
    body += `${code}\n`;
    for (const ch of code) {
      if (ch === "{") {
        depth += 1;
        started = true;
      } else if (ch === "}") {
        depth -= 1;
      }
    }
    endLine = i;
    if (started && depth === 0) break;
  }
  return { body, endLine };
}

function parseEnumValues(body) {
  const inner = body.slice(body.indexOf("{") + 1, body.lastIndexOf("}"));
  const values = [];
  let next = 0;
  for (const part of inner.split(",")) {
    const piece = part.replace(/\/\/.*$/, "").trim();
    if (!piece) continue;
    const named = piece.match(/^([A-Za-z_]\w*)\s*(?:=\s*(-?\d+)\s*)?$/);
    if (!named) continue;
    const value = named[2] !== undefined ? Number(named[2]) : next;
    values.push({ name: named[1], value });
    next = value + 1;
  }
  return values;
}

function parseDocumentSymbols(text) {
  const rawLines = text.split(/\r?\n/);
  const structural = blankBlockComments(text).split(/\r?\n/);
  const scope = new ScopeTracker();
  const symbols = [];

  for (let i = 0; i < structural.length; i += 1) {
    scope.feed(structural[i]);
    const line = stripLineComment(structural[i]).trim();
    if (!line) continue;

    const enumHead = line.match(/^enum\s+([A-Za-z_]\w*)\s*(?::\s*([A-Za-z_]\w*))?\s*\{/);
    if (enumHead) {
      const { body, endLine } = readBalanced(structural, i);
      const typeName = enumHead[1];
      const underlying = enumHead[2] || "int";
      const fullName = qualify(scope.namespaces, typeName);
      const doc = precedingDoc(rawLines, i);
      symbols.push({
        fullName,
        shortName: typeName,
        kind: "enum",
        signature: `enum ${fullName}: ${underlying}`,
        doc,
        params: [],
        annotations: [],
        ending: ";",
        line: i,
        endLine
      });
      for (const value of parseEnumValues(body)) {
        const valueName = `${fullName}::${value.name}`;
        symbols.push({
          fullName: valueName,
          shortName: value.name,
          kind: "enumValue",
          signature: `${valueName} = ${value.value}`,
          doc: `${fullName} 的枚举值，底层 ${underlying}。`,
          params: [],
          annotations: [],
          ending: ";",
          line: i,
          endLine
        });
      }
      while (i < endLine) {
        i += 1;
        scope.feed(structural[i] || "");
      }
      continue;
    }

    const structHead = line.match(/^struct\s+([A-Za-z_]\w*)\s*\{/);
    if (structHead) {
      const { endLine } = readBalanced(structural, i);
      const fullName = qualify(scope.namespaces, structHead[1]);
      symbols.push({
        fullName,
        shortName: structHead[1],
        kind: "struct",
        signature: `struct ${fullName}`,
        doc: precedingDoc(rawLines, i),
        params: [],
        annotations: [],
        ending: ";",
        line: i,
        endLine
      });
      while (i < endLine) {
        i += 1;
        scope.feed(structural[i] || "");
      }
      continue;
    }

    if (/^(?:(?:export|public|private|static|async)\s+)*deRfun\b/.test(line)) {
      const { merged, endLine: headerEnd } = readFunctionHeader(structural, i);
      const parsed = parseFunctionFromHeader(merged, scope.namespaces);
      if (!parsed) continue;
      const endLine = parsed.ending === "{" ? findBraceEnd(structural, i) : headerEnd;
      symbols.push({
        ...parsed,
        kind: parsed.ending === ";" ? "declaration" : "implementation",
        doc: precedingDoc(rawLines, i),
        annotations: precedingAnnotations(rawLines, i),
        line: i,
        endLine
      });
      while (i < endLine) {
        i += 1;
        scope.feed(structural[i] || "");
      }
    }
  }

  return symbols;
}

function maskZapBlocks(lines) {
  const out = lines.slice();
  let depth = 0;
  let inside = false;
  for (let i = 0; i < out.length; i += 1) {
    if (!inside && /^\s*__zap__\b/.test(out[i])) {
      inside = true;
      depth = 0;
    }
    if (!inside) continue;
    const code = stripLineComment(maskStrings(out[i]));
    for (const ch of code) {
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
    }
    if (i > 0 || depth > 0) out[i] = " ".repeat(out[i].length);
    if (inside && depth <= 0 && code.includes("}")) {
      inside = false;
      out[i] = " ".repeat(lines[i].length);
    }
  }
  return out;
}

function maskCode(text) {
  const structural = blankBlockComments(text).split(/\r?\n/);
  const noZap = maskZapBlocks(structural);
  return noZap
    .map((line) => {
      const noString = maskStrings(line);
      const commentAt = noString.indexOf("//");
      if (commentAt < 0) return noString;
      return noString.slice(0, commentAt) + " ".repeat(noString.length - commentAt);
    })
    .join("\n");
}

function argumentCount(text, openParen) {
  let depth = 0;
  let count = 0;
  let seen = false;
  for (let i = openParen; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "(") {
      depth += 1;
      continue;
    }
    if (ch === ")") {
      depth -= 1;
      if (depth === 0) return seen ? count + 1 : 0;
      continue;
    }
    if (ch === "," && depth === 1) count += 1;
    if (depth === 1 && !/\s/.test(ch)) seen = true;
  }
  return seen ? count + 1 : 0;
}

function collectCalls(text) {
  const masked = maskCode(text);
  const lines = masked.split("\n");
  const calls = [];
  const pattern = /([A-Za-z_]\w*(?:::[A-Za-z_]\w*)*)\s*\(/g;
  for (let line = 0; line < lines.length; line += 1) {
    const row = lines[line];
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(row)) !== null) {
      const name = match[1];
      if (CALL_SKIP.has(name)) continue;
      const before = row.slice(0, match.index);
      if (/(?:deRfun|namespace|enum|struct|class|import)\s+$/.test(before)) continue;
      const openParen = match.index + match[0].lastIndexOf("(");
      calls.push({
        name,
        line,
        start: match.index,
        end: match.index + name.length,
        argCount: argumentCount(masked, lineStart(lines, line) + openParen)
      });
    }
  }
  return calls;
}

function lineStart(lines, line) {
  let offset = 0;
  for (let i = 0; i < line; i += 1) offset += lines[i].length + 1;
  return offset;
}

function callMatchesSymbol(call, symbol) {
  if (symbol.kind !== "declaration" && symbol.kind !== "implementation") return false;
  if (!symbol.params || call.argCount !== symbol.params.length) return false;
  if (call.name === symbol.fullName) return true;
  if (call.name.includes("::")) return false;
  return call.name === symbol.shortName && !symbol.fullName.includes("::");
}

module.exports = {
  ScopeTracker,
  parseDocumentSymbols,
  collectCalls,
  callMatchesSymbol,
  parseFunctionFromHeader
};
