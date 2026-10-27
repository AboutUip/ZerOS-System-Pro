/**
 * 与 Blink `LinkParser` 对齐：合并 #LINK 续行、解析路径项（以 `/` 开头）。
 * 供扩展做项目根与扫描范围，非解释器。
 */

function stripTrailingSpaces(s) {
  let end = s.length;
  while (end > 0) {
    const c = s.charAt(end - 1);
    if (c !== " " && c !== "\t") break;
    end--;
  }
  return s.substring(0, end);
}

function endsWithLinkCommaContinuation(lineWithoutNewline) {
  const s = stripTrailingSpaces(lineWithoutNewline);
  return s.startsWith("#LINK") && s.length > 0 && s.charAt(s.length - 1) === ",";
}

function mergeLinkContinuationLines(rawLines) {
  const out = [];
  for (let i = 0; i < rawLines.length; i += 1) {
    let line = rawLines[i];
    const t = line.replace(/^\s+/, "");
    if (!t.startsWith("#LINK")) {
      out.push(line);
      continue;
    }
    let acc = t;
    while (i + 1 < rawLines.length && endsWithLinkCommaContinuation(acc)) {
      i += 1;
      const next = rawLines[i].replace(/^\s+/, "");
      if (!next) break;
      acc += ` ${next}`;
    }
    out.push(acc);
  }
  return out;
}

function splitLinkItems(rest) {
  const parts = [];
  let start = 0;
  for (let i = 0; i <= rest.length; i += 1) {
    if (i === rest.length || rest.charAt(i) === ",") {
      parts.push(rest.substring(start, i));
      start = i + 1;
    }
  }
  return parts;
}

function normalizePathItem(raw) {
  let s = raw.replace(/\\/g, "/").trim();
  if (!s) return s;
  if (!s.startsWith("/")) s = `/${s}`;
  if (s === "/") return "/";
  while (s.length > 1 && s.endsWith("/")) {
    s = s.substring(0, s.length - 1);
  }
  return s;
}

function parseLinkLinePayload(lineStripLeading) {
  const rest = lineStripLeading.substring("#LINK".length).trim();
  if (!rest) return [];
  const items = [];
  for (const part of splitLinkItems(rest)) {
    const s = part.trim();
    if (!s) continue;
    if (s.charAt(0) !== "/") {
      throw new Error(`#LINK 路径项须以 / 开头: ${s}`);
    }
    items.push(normalizePathItem(s));
  }
  return items;
}

/**
 * @param {string} obrSource 完整 .obr 源码
 * @returns {string[]} 路径项列表，如 `['/']`、`['/main']`
 */
function parseMergedLinkItemsFromSource(obrSource) {
  const rawLines = obrSource.split(/\r\n|\r|\n/);
  const merged = mergeLinkContinuationLines(rawLines);
  const out = [];
  for (const line of merged) {
    const t = line.trimStart();
    if (t.startsWith("#LINK")) {
      out.push(...parseLinkLinePayload(t));
    }
  }
  return out;
}

module.exports = {
  parseMergedLinkItemsFromSource,
  mergeLinkContinuationLines,
  normalizePathItem
};
