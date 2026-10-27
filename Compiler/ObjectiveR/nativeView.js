/**
 * ZNB1 原生映像。魔数 5A 4E 42 31。
 * 编码和 Compiler/Obr/src/image/NativeImage.cpp 一致：
 * 入口 10 个八位组把 rsp 设到界面区，随后是已登记的原生指令。
 * 文本寄存器 r0–r7 对应 rax、rdi、rsi、rdx、rcx、r8、r9、r10。
 */

const { parseDebug, siteFor, formatSite } = require("./debugSidecar");

const MAGIC = [0x5a, 0x4e, 0x42, 0x31];

const WIDE = {
  0x01: ["add", 3],
  0x02: ["sub", 3],
  0x03: ["and", 3],
  0x04: ["or", 3],
  0x05: ["xor", 3],
  0x06: ["mul", 3],
  0x07: ["div", 3],
  0x08: ["mod", 3],
  0x09: ["udiv", 3],
  0x0a: ["umod", 3],
  0x0b: ["shl", 3],
  0x0c: ["shr", 3],
  0x0d: ["eq", 3],
  0x0e: ["lt", 3],
  0x0f: ["le", 3],
  0x10: ["gt", 3],
  0x11: ["ge", 3],
  0x12: ["not", 2],
  0x13: ["itof", 2],
  0x14: ["fadd", 3],
  0x15: ["fsub", 3],
  0x16: ["fmul", 3],
  0x17: ["fdiv", 3],
  0x18: ["fpow", 3],
  0x19: ["fmod", 3],
  0x1a: ["feq", 3]
};

const INDIRECT = {
  0x20: "ldi.64",
  0x21: "sti.64",
  0x22: "ldi.octet",
  0x23: "sti.octet",
  0x24: "ldi.16",
  0x25: "sti.16",
  0x26: "ldi.32",
  0x27: "sti.32",
  0x28: "ldi.f64",
  0x29: "sti.f64",
  0x2a: "ldi.f32",
  0x2b: "sti.f32"
};

const ESCAPE = {
  0x02: ["gate", 0],
  0x0a: ["yield", 0],
  0x11: ["gpu.present", 0],
  0x01: ["core", 1],
  0x06: ["schedule", 1],
  0x07: ["release", 1],
  0x09: ["slice", 1],
  0x1b: ["dwell", 1],
  0x03: ["pass", 2],
  0x04: ["take", 2],
  0x05: ["svc", 2],
  0x0d: ["capture", 2],
  0x0e: ["restore", 2],
  0x0f: ["hertz", 2],
  0x1c: ["inbox", 2],
  0x16: ["port.state", 2],
  0x1a: ["munmap", 2],
  0x08: ["bound", 3],
  0x0c: ["install", 3],
  0x1e: ["admit", 3],
  0x14: ["xchg", 3],
  0x17: ["port.char", 3],
  0x0b: ["query", 4],
  0x10: ["attach", 4],
  0x19: ["mmap", 4],
  0x1d: ["fill", 4],
  0x18: ["port.byte", 4],
  0x12: ["gpu.character", 5],
  0x13: ["gpu.accel", 6],
  0x15: ["carry", 6]
};

function isNativeImage(bytes) {
  return (
    bytes &&
    bytes.length >= 12 &&
    bytes[0] === MAGIC[0] &&
    bytes[1] === MAGIC[1] &&
    bytes[2] === MAGIC[2] &&
    bytes[3] === MAGIC[3]
  );
}

function readU16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32(bytes, offset) {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

function readI32(bytes, offset) {
  return readU32(bytes, offset) | 0;
}

function readU64(bytes, offset) {
  let value = 0n;
  for (let index = 0; index < 8; index += 1) {
    value |= BigInt(bytes[offset + index]) << BigInt(index * 8);
  }
  return value;
}

function formatImm(value) {
  const sign = 1n << 63n;
  if (value >= sign) return (value - (1n << 64n)).toString();
  return value.toString();
}

function hexOffset(value) {
  const text = (Number(value) >>> 0).toString(16).toUpperCase();
  return text.padStart(8, "0");
}

function hexByte(value) {
  return `0x${(value & 0xff).toString(16).toUpperCase().padStart(2, "0")}`;
}

function regName(hw) {
  if (hw === 0) return "r0";
  if (hw === 7) return "r1";
  if (hw === 6) return "r2";
  if (hw === 2) return "r3";
  if (hw === 1) return "r4";
  if (hw === 8) return "r5";
  if (hw === 9) return "r6";
  if (hw === 10) return "r7";
  if (hw === 4) return "rsp";
  if (hw === 11) return "r11";
  return `hw${hw}`;
}

function step(offset, size, text, extra) {
  return Object.assign({ offset, next: offset + size, text, unknown: false }, extra);
}

function decodeOne(bytes, at, end) {
  const left = end - at;
  if (left <= 0) return step(at, 0, ".byte", { unknown: true });
  if (
    left >= 4 &&
    bytes[at] === 0x48 &&
    bytes[at + 1] === 0x83 &&
    bytes[at + 2] === 0xec &&
    bytes[at + 3] === 0x08
  ) {
    return step(at, 4, "rsp.bias");
  }
  if (
    left >= 4 &&
    bytes[at] === 0x48 &&
    bytes[at + 1] === 0x83 &&
    bytes[at + 2] === 0xc4 &&
    bytes[at + 3] === 0x08
  ) {
    return step(at, 4, "rsp.restore");
  }
  if (bytes[at] === 0xf4) return step(at, 1, "halt");
  if (bytes[at] === 0xc3) return step(at, 1, "ret");
  if (bytes[at] === 0xe8 && left >= 5) {
    const target = at + 5 + readI32(bytes, at + 1);
    return step(at, 5, `call ${hexOffset(target)}`, { target });
  }
  if (left >= 12 && bytes[at] === 0x4d && bytes[at + 1] === 0x31 && bytes[at + 2] === 0xdb) {
    const rex = bytes[at + 3];
    const modrm = bytes[at + 5];
    const cond = bytes[at + 7];
    if (
      (rex === 0x4c || rex === 0x4d) &&
      bytes[at + 4] === 0x39 &&
      (modrm & 0xf8) === 0xd8 &&
      bytes[at + 6] === 0x0f &&
      (cond === 0x84 || cond === 0x85)
    ) {
      const reg = (modrm & 7) | (rex === 0x4d ? 8 : 0);
      const target = at + 12 + readI32(bytes, at + 8);
      const name = cond === 0x84 ? "jz" : "jnz";
      return step(at, 12, `${name} ${regName(reg)}, ${hexOffset(target)}`, { target });
    }
  }
  if (left >= 5) {
    const rex = bytes[at];
    const opcode = bytes[at + 1];
    const modrm = bytes[at + 2];
    if (
      rex >= 0x48 &&
      rex <= 0x4f &&
      (opcode === 0x8d || opcode === 0x8b || opcode === 0x89) &&
      (modrm & 0xc7) === 0x44
    ) {
      const sib = bytes[at + 3];
      let disp = bytes[at + 4];
      if (disp >= 128) disp -= 256;
      const reg = ((modrm >> 3) & 7) | (rex & 0x04 ? 8 : 0);
      const index = ((sib >> 3) & 7) | (rex & 0x02 ? 8 : 0);
      const base = (sib & 7) | (rex & 0x01 ? 8 : 0);
      const scale = 1 << (sib >> 6);
      const name = opcode === 0x89 ? "store.scale" : opcode === 0x8b ? "load.scale" : "lea";
      return step(at, 5, `${name} ${regName(reg)}, ${regName(base)}, ${regName(index)}, ${scale}, ${disp}`);
    }
  }
  if (left >= 6 && bytes[at] === 0x0f && bytes[at + 1] === 0x3e) {
    const opcode = bytes[at + 2];
    const dest = regName(bytes[at + 3]);
    const leftReg = regName(bytes[at + 4]);
    const right = regName(bytes[at + 5]);
    const indirect = INDIRECT[opcode];
    if (indirect) return step(at, 6, `${indirect} ${dest}, ${leftReg}`);
    const wide = WIDE[opcode];
    if (wide) {
      const text = wide[1] === 2 ? `${wide[0]} ${dest}, ${leftReg}` : `${wide[0]} ${dest}, ${leftReg}, ${right}`;
      return step(at, 6, text);
    }
    return step(at, 6, `wide ${hexByte(opcode)} ${dest}, ${leftReg}, ${right}`, { unknown: true });
  }
  if (left >= 3 && bytes[at] === 0x0f && bytes[at + 1] === 0x3f) {
    const opcode = bytes[at + 2];
    const form = ESCAPE[opcode];
    if (form && left >= 3 + form[1]) {
      const parts = [];
      for (let index = 0; index < form[1]; index += 1) {
        parts.push(regName(bytes[at + 3 + index]));
      }
      const text = parts.length === 0 ? form[0] : `${form[0]} ${parts.join(", ")}`;
      return step(at, 3 + form[1], text);
    }
    return step(at, 3, `escape ${hexByte(opcode)}`, { unknown: true });
  }
  if (left >= 10 && (bytes[at] === 0x48 || bytes[at] === 0x49)) {
    const opcode = bytes[at + 1];
    if (opcode >= 0xb8 && opcode <= 0xbf) {
      const reg = opcode - 0xb8 + (bytes[at] === 0x49 ? 8 : 0);
      return step(at, 10, `place ${regName(reg)}, ${formatImm(readU64(bytes, at + 2))}`);
    }
  }
  return step(at, 1, `.byte ${hexByte(bytes[at])}`, { unknown: true });
}

function readName(bytes, offset) {
  if (offset >= bytes.length) return null;
  const length = bytes[offset];
  if (length < 1 || length > 64 || offset + 1 + length + 4 > bytes.length) return null;
  let name = "";
  for (let index = 0; index < length; index += 1) {
    const byte = bytes[offset + 1 + index];
    if (byte < 0x21 || byte > 0x7e) return null;
    name += String.fromCharCode(byte);
  }
  return { name, index: readU32(bytes, offset + 1 + length), next: offset + 1 + length + 4 };
}

function decodeNative(bytes) {
  const image = {
    ok: false,
    error: "",
    version: 0,
    flags: 0,
    codeBytes: 0,
    steps: [],
    symbols: [],
    unknown: 0
  };
  if (!bytes || bytes.length < 12) {
    image.error = "文件短于 12 个字节，没有程序头。";
    return image;
  }
  image.version = readU16(bytes, 4);
  image.flags = readU16(bytes, 6);
  image.codeBytes = readU32(bytes, 8);
  if (image.version !== 1) image.error = `原生映像版本 ${image.version} 无法识别。只接受 1。`;
  const codeEnd = Math.min(bytes.length, 12 + image.codeBytes);
  if (12 + image.codeBytes > bytes.length) image.error = "代码长度超出文件。";
  let cursor = 12;
  let guard = 0;
  while (cursor < codeEnd && guard < 2000000) {
    const item = decodeOne(bytes, cursor, codeEnd);
    if (item.next <= cursor) break;
    image.steps.push(item);
    if (item.unknown) image.unknown += 1;
    cursor = item.next;
    guard += 1;
  }
  if (cursor !== codeEnd && image.error.length === 0) {
    image.error = `代码在第 ${cursor} 个字节处提前结束。`;
  }
  let symbolAt = 12 + image.codeBytes;
  if (symbolAt + 4 <= bytes.length && image.error.length === 0) {
    const count = readU32(bytes, symbolAt);
    symbolAt += 4;
    if (count > 256) {
      image.error = `导出 ${count} 个，超过 256。`;
    } else {
      for (let index = 0; index < count; index += 1) {
        const item = readName(bytes, symbolAt);
        if (!item) {
          image.error = "导出表读不下去。";
          break;
        }
        image.symbols.push(item);
        symbolAt = item.next;
      }
      if (image.error.length === 0 && symbolAt + 8 <= bytes.length) {
        const imports = readU32(bytes, symbolAt);
        const relocs = readU32(bytes, symbolAt + 4);
        symbolAt += 8;
        if (imports !== 0 || relocs !== 0) image.error = "原生映像不带导入或重定位。";
      }
      if (image.error.length === 0 && symbolAt !== bytes.length) {
        image.error = `导出表后面还有 ${bytes.length - symbolAt} 个字节。`;
      }
    }
  } else if (symbolAt !== bytes.length && image.error.length === 0) {
    image.error = `代码后面还有 ${bytes.length - symbolAt} 个字节。`;
  }
  image.ok = image.error.length === 0 && image.unknown === 0;
  return image;
}

function annotate(image, debug) {
  const byOffset = new Map();
  for (const item of image.steps) byOffset.set(item.offset, item);
  for (const item of image.steps) {
    item.site = formatSite(siteFor(debug, item));
    if (item.target === undefined) continue;
    const target = byOffset.get(item.target);
    const name = target ? formatSite(siteFor(debug, target)) : "";
    const fn = name.split("  ").pop();
    if (fn && fn !== name) item.text += `  -> ${fn}`;
    else if (name && !name.includes(":")) item.text += `  -> ${name}`;
  }
}

function listingLines(image, debug) {
  annotate(image, debug);
  const lines = [];
  for (const item of image.steps) {
    const gutter = hexOffset(item.offset);
    const note = item.site ? `    ; 源 ${item.site}` : "";
    lines.push(`${gutter}  ${item.text}${note}`);
  }
  return lines;
}

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderNativeHtml(bytes, debugText) {
  const image = decodeNative(bytes);
  const debug = parseDebug(debugText);
  const lines = listingLines(image, debug);
  const warning = image.error.length > 0 ? `<p class="warn">${escapeHtml(image.error)}</p>` : "";
  const unknown =
    image.unknown > 0
      ? `<p class="warn">有 ${image.unknown} 条编码对不上当前已登记的原生指令。对照表仍按字节对齐的部分标出。</p>`
      : "";
  const debugChip = debug
    ? `<span class="chip">对照表 obr-debug ${debug.version} · ${debug.sites.length} 行</span>`
    : `<span class="chip">没有 .debug</span>`;
  const symbols =
    image.symbols.length === 0
      ? `<p class="empty">没有导出。</p>`
      : `<table><thead><tr><th>名字</th><th>代码偏移</th></tr></thead><tbody>${image.symbols
          .map((item) => `<tr><td>${escapeHtml(item.name)}</td><td class="num">${hexOffset(12 + item.index)}</td></tr>`)
          .join("")}</tbody></table>`;
  const body = lines.length > 0 ? escapeHtml(lines.join("\n")) : "; 没有解出指令";
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
<style>
  body { margin: 0; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); font-family: var(--vscode-font-family, Segoe UI, sans-serif); }
  header, section { padding: 16px 20px 4px; }
  h1 { margin: 0 0 8px; font-size: 18px; font-weight: 600; }
  h2 { margin: 18px 0 8px; font-size: 13px; font-weight: 600; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 8px; }
  .chip { border: 1px solid var(--vscode-widget-border, rgba(127,127,127,.35)); border-radius: 999px; padding: 2px 10px; font-size: 12px; }
  .chip.kind { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-color: transparent; }
  .warn { color: var(--vscode-errorForeground); }
  .empty, .hint { color: var(--vscode-descriptionForeground); }
  table { border-collapse: collapse; margin: 0 0 8px; font-family: var(--vscode-editor-font-family, Consolas, monospace); font-size: 13px; }
  th, td { text-align: left; padding: 3px 16px 3px 0; }
  th { color: var(--vscode-descriptionForeground); font-weight: 500; }
  .num { font-variant-numeric: tabular-nums; }
  pre.mono { margin: 0; padding: 0 0 24px; font-family: var(--vscode-editor-font-family, Consolas, monospace); font-size: var(--vscode-editor-font-size, 13px); line-height: 18px; user-select: text; white-space: pre; cursor: default; }
  #tip { position: fixed; z-index: 2; max-width: 640px; padding: 6px 8px; border-radius: 4px; background: var(--vscode-editorHoverWidget-background, #252526); color: var(--vscode-editorHoverWidget-foreground, #ccc); border: 1px solid var(--vscode-editorHoverWidget-border, #454545); font: 12px var(--vscode-font-family, Segoe UI, sans-serif); pointer-events: none; white-space: pre-wrap; display: none; }
</style>
</head>
<body>
  <header>
    <h1>原生程序</h1>
    <div class="chips">
      <span class="chip kind">ZNB1</span>
      <span class="chip">版本 ${image.version}</span>
      <span class="chip">代码 ${image.codeBytes} 字节</span>
      <span class="chip">指令 ${image.steps.length}</span>
      <span class="chip">文件 ${bytes.length} 字节</span>
      ${debugChip}
    </div>
    <p class="hint">悬停一条指令看源位置。注释里有路径时，单击打开那一行。r0 至 r7 是 rax、rdi、rsi、rdx、rcx、r8、r9、r10。</p>
    ${warning}
    ${unknown}
  </header>
  <section>
    <h2>导出 ${image.symbols.length}</h2>
    ${symbols}
    <h2>指令</h2>
    <pre class="mono" id="listing">${body}</pre>
  </section>
  <div id="tip"></div>
  <script>
    const vscode = acquireVsCodeApi();
    const listing = document.getElementById("listing");
    const tip = document.getElementById("tip");
    function lineText(event) {
      const bounds = listing.getBoundingClientRect();
      const y = event.clientY - bounds.top + listing.scrollTop;
      const index = Math.floor(y / 18);
      const lines = listing.textContent.split("\\n");
      return lines[index] || "";
    }
    listing.addEventListener("mousemove", (event) => {
      const line = lineText(event);
      const mark = line.indexOf(";");
      const text = mark >= 0 ? line.slice(mark + 1).trim() : line.trim();
      if (!text) { tip.style.display = "none"; return; }
      tip.textContent = text;
      tip.style.display = "block";
      tip.style.left = Math.min(event.clientX + 12, window.innerWidth - 360) + "px";
      tip.style.top = (event.clientY + 16) + "px";
    });
    listing.addEventListener("mouseleave", () => { tip.style.display = "none"; });
    listing.addEventListener("click", (event) => {
      const line = lineText(event);
      const mark = line.match(/源\\s+(.+):(\\d+)/);
      if (!mark) return;
      vscode.postMessage({ kind: "open", file: mark[1], line: Number(mark[2]) });
    });
  </script>
</body>
</html>`;
}

function formatNativeText(bytes, debugText) {
  const image = decodeNative(bytes);
  const debug = parseDebug(debugText);
  const lines = [
    "; 原生程序",
    "; 魔数 ZNB1",
    `; 版本 ${image.version}`,
    `; 代码 ${image.codeBytes} 字节`,
    `; 指令 ${image.steps.length}`,
    `; 文件 ${bytes.length} 字节`,
    debug ? `; 对照表 obr-debug ${debug.version}` : "; 没有 .debug"
  ];
  if (image.error.length > 0) lines.push(`; ${image.error}`);
  if (image.unknown > 0) lines.push(`; 未识别 ${image.unknown}`);
  lines.push("; 导出");
  for (const item of image.symbols) lines.push(`;   ${item.name} @ ${hexOffset(12 + item.index)}`);
  lines.push("");
  lines.push(...listingLines(image, debug));
  return lines.join("\n");
}

module.exports = {
  isNativeImage,
  decodeNative,
  renderNativeHtml,
  formatNativeText
};
