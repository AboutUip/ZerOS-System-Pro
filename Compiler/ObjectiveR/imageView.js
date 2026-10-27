/**
 * ZPB1 程序映像的结构化预览。
 * 版本 1 只有指令。版本 2 在指令后带种类、导出、导入和重定位。
 * .lib 是种类 2 的动态库，布局和可执行映像相同。
 */

const { parseDebug, siteFor, formatSite } = require("./debugSidecar");

const LOAD_NAME = {
  1: "load.bit",
  3: "load.octet",
  5: "load.16",
  7: "load.32",
  9: "load.64",
  11: "load.f32",
  13: "load.f64"
};

const STORE_NAME = {
  2: "store.bit",
  4: "store.octet",
  6: "store.16",
  8: "store.32",
  10: "store.64",
  12: "store.f32",
  14: "store.f64"
};

const LDI_NAME = {
  3: "ldi.octet",
  5: "ldi.16",
  7: "ldi.32",
  9: "ldi.64",
  11: "ldi.f32",
  13: "ldi.f64"
};

const STI_NAME = {
  4: "sti.octet",
  6: "sti.16",
  8: "sti.32",
  10: "sti.64",
  12: "sti.f32",
  14: "sti.f64"
};

/** 编号、助记符、寄存器个数。place / 访存 / 跳转另算。 */
const NAMED = {
  1: ["halt", 0],
  2: ["gpu.present", 0],
  3: ["gpu.compose", 0],
  4: ["gpu.drop", 1],
  5: ["gpu.hertz", 1],
  6: ["gpu.clear", 1],
  7: ["mem.hertz", 1],
  8: ["jmp", 1],
  9: ["ret", 1],
  10: ["gpu.glyph", 2],
  11: ["gpu.metric", 2],
  12: ["gpu.load", 2],
  13: ["gpu.store", 2],
  14: ["mem.metric", 2],
  15: ["hertz", 2],
  16: ["not", 2],
  17: ["itof", 2],
  18: ["inbox", 2],
  19: ["port.state", 2],
  20: ["port.char", 3],
  21: ["xchg", 3],
  22: ["gpu.plot", 3],
  23: ["gpu.align", 3],
  24: ["gpu.paint", 3],
  25: ["add", 3],
  26: ["eq", 3],
  27: ["sub", 3],
  28: ["udiv", 3],
  29: ["umod", 3],
  30: ["mul", 3],
  31: ["div", 3],
  32: ["mod", 3],
  33: ["and", 3],
  34: ["or", 3],
  35: ["xor", 3],
  36: ["shl", 3],
  37: ["shr", 3],
  38: ["fadd", 3],
  39: ["fsub", 3],
  40: ["fmul", 3],
  41: ["fdiv", 3],
  42: ["fpow", 3],
  43: ["fmod", 3],
  44: ["lt", 3],
  45: ["le", 3],
  46: ["gt", 3],
  47: ["ge", 3],
  48: ["feq", 3],
  49: ["metric", 4],
  50: ["query", 4],
  51: ["port.byte", 4],
  52: ["gpu.character", 5],
  53: ["gpu.text", 6],
  54: ["gpu.accel", 6],
  55: ["gpu.box", 7],
  65: ["install", 3],
  66: ["schedule", 1],
  67: ["slice", 1],
  68: ["pass", 2],
  69: ["take", 2],
  70: ["svc", 2],
  71: ["bound", 3],
  72: ["gate", 0],
  73: ["release", 1],
  74: ["yield", 0],
  75: ["core", 1],
  76: ["fill", 4],
  77: ["carry", 6],
  78: ["capture", 2],
  79: ["restore", 2],
  80: ["attach", 4],
  81: ["dwell", 1],
  82: ["mmap", 4],
  83: ["munmap", 2],
  84: ["admit", 3]
};

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

function viewOf(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function readI64(bytes, offset) {
  return viewOf(bytes).getBigInt64(offset, true);
}

function readImm(bytes, offset) {
  const wide = bytes[offset] === 1;
  const view = viewOf(bytes);
  if (wide) {
    return view.getBigUint64(offset + 1, true).toString();
  }
  return view.getBigInt64(offset + 1, true).toString();
}

function need(bytes, offset, size, what) {
  if (offset + size > bytes.length) {
    throw new Error(`${what}在第 ${offset} 个字节处结束`);
  }
}

function reg(bytes, offset) {
  need(bytes, offset, 1, "寄存器");
  const value = bytes[offset];
  if (value > 7) {
    throw new Error(`寄存器编号 ${value} 超出 0 到 7`);
  }
  return `r${value}`;
}

function regs(bytes, offset, count) {
  const parts = [];
  for (let index = 0; index < count; index += 1) {
    parts.push(reg(bytes, offset + index));
  }
  return parts;
}

function memoryName(table, opcode, fallback) {
  return table[opcode] || `${fallback}.${opcode}`;
}

function decodeStep(bytes, at, index) {
  need(bytes, at, 2, "指令");
  const code = readU16(bytes, at);
  let cursor = at + 2;
  if (code === 60) {
    const destination = reg(bytes, cursor);
    need(bytes, cursor + 1, 9, "立即数");
    const data = readImm(bytes, cursor + 1);
    return { index, text: `place ${destination}, ${data}`, next: cursor + 10 };
  }
  if (code === 61 || code === 62) {
    need(bytes, cursor, 1, "访存操作码");
    const opcode = bytes[cursor];
    need(bytes, cursor + 1, 9, "立即数");
    const address = readImm(bytes, cursor + 1);
    const destination = reg(bytes, cursor + 10);
    const name = code === 61 ? memoryName(LOAD_NAME, opcode, "load") : memoryName(STORE_NAME, opcode, "store");
    return { index, text: `${name} ${destination}, ${address}`, next: cursor + 11 };
  }
  if (code === 63 || code === 64) {
    need(bytes, cursor, 1, "访存操作码");
    const opcode = bytes[cursor];
    const left = reg(bytes, cursor + 1);
    const right = reg(bytes, cursor + 2);
    const name = code === 63 ? memoryName(LDI_NAME, opcode, "ldi") : memoryName(STI_NAME, opcode, "sti");
    return { index, text: `${name} ${left}, ${right}`, next: cursor + 3 };
  }
  if (code >= 56 && code <= 59) {
    const names = { 56: "call", 57: "link", 58: "jz", 59: "jnz" };
    const destination = reg(bytes, cursor);
    need(bytes, cursor + 1, 4, "跳转编号");
    const target = readU32(bytes, cursor + 1);
    return { index, text: `${names[code]} ${destination}, ${target}`, next: cursor + 5 };
  }
  const named = NAMED[code];
  if (!named) {
    throw new Error(`指令编号 ${code} 无法识别`);
  }
  const parts = regs(bytes, cursor, named[1]);
  const text = parts.length === 0 ? named[0] : `${named[0]} ${parts.join(", ")}`;
  return { index, text, next: cursor + named[1] };
}

function readName(bytes, offset) {
  need(bytes, offset, 1, "符号名");
  const length = bytes[offset];
  if (length < 1 || length > 64) {
    throw new Error(`符号名长度 ${length} 超出 1 到 64`);
  }
  need(bytes, offset + 1, length, "符号名");
  let name = "";
  for (let index = 0; index < length; index += 1) {
    const byte = bytes[offset + 1 + index];
    if (byte < 0x21 || byte > 0x7e) {
      throw new Error("符号名含有不可见字符");
    }
    name += String.fromCharCode(byte);
  }
  need(bytes, offset + 1 + length, 4, "符号编号");
  return { name, index: readU32(bytes, offset + 1 + length), next: offset + 1 + length + 4 };
}

function readSymbols(bytes, offset, count, steps, label) {
  if (count > 256) {
    throw new Error(`${label}个数 ${count} 超过 256`);
  }
  const items = [];
  let cursor = offset;
  for (let index = 0; index < count; index += 1) {
    const item = readName(bytes, cursor);
    if (item.index >= steps) {
      throw new Error(`${label} ${item.name} 的编号 ${item.index} 越出 ${steps} 条指令`);
    }
    items.push({ name: item.name, index: item.index });
    cursor = item.next;
  }
  return { items, next: cursor };
}

function decodeLink(bytes, offset, steps) {
  need(bytes, offset, 16, "链接目录");
  const kind = readU16(bytes, offset);
  const flags = readU16(bytes, offset + 2);
  const exportCount = readU32(bytes, offset + 4);
  const importCount = readU32(bytes, offset + 8);
  const relocCount = readU32(bytes, offset + 12);
  if (kind !== 1 && kind !== 2) {
    throw new Error(`映像种类 ${kind} 无法识别`);
  }
  if (flags !== 0) {
    throw new Error(`链接标志 ${flags} 必须是 0`);
  }
  const exports = readSymbols(bytes, offset + 16, exportCount, steps, "导出");
  const imports = readSymbols(bytes, exports.next, importCount, steps, "导入");
  if (relocCount > 4096) {
    throw new Error(`重定位 ${relocCount} 条，超过 4096`);
  }
  const relocs = [];
  let cursor = imports.next;
  for (let index = 0; index < relocCount; index += 1) {
    need(bytes, cursor, 14, "重定位");
    const site = readU32(bytes, cursor);
    const field = bytes[cursor + 4];
    const pad = bytes[cursor + 5];
    const addend = readI64(bytes, cursor + 6);
    if (site >= steps || (field !== 0 && field !== 1) || pad !== 0) {
      throw new Error(`第 ${index} 条重定位无法识别`);
    }
    relocs.push({ index: site, field, addend: addend.toString() });
    cursor += 14;
  }
  return { kind, flags, symbols: exports.items, imports: imports.items, relocs, next: cursor };
}

function decodeImage(bytes) {
  const image = {
    ok: false,
    error: "",
    version: 0,
    endian: 0,
    count: 0,
    kind: 1,
    symbols: [],
    imports: [],
    relocs: [],
    steps: [],
    consumed: 12
  };
  if (bytes.length < 12) {
    image.error = "文件短于 12 个字节，没有程序头。";
    return image;
  }
  image.version = readU16(bytes, 4);
  image.endian = readU16(bytes, 6);
  image.count = readU32(bytes, 8);
  if (image.version !== 1 && image.version !== 2) {
    image.error = `版本 ${image.version} 无法识别。只接受 1 和 2。`;
    return image;
  }
  if (image.endian !== 1) {
    image.error = `字节序标记是 ${image.endian}，这份预览按小端读。`;
  }
  try {
    let cursor = 12;
    for (let index = 0; index < image.count; index += 1) {
      const step = decodeStep(bytes, cursor, index);
      image.steps.push(step);
      cursor = step.next;
    }
    image.consumed = cursor;
    if (image.version === 2) {
      const link = decodeLink(bytes, cursor, image.steps.length);
      image.kind = link.kind;
      image.symbols = link.symbols;
      image.imports = link.imports;
      image.relocs = link.relocs;
      image.consumed = link.next;
    }
    if (image.version === 1 && image.consumed !== bytes.length) {
      image.error = `版本 1 后面还有 ${bytes.length - image.consumed} 个字节。正式装入会拒绝。`;
    } else if (image.consumed !== bytes.length) {
      image.error = `链接目录后面还有 ${bytes.length - image.consumed} 个字节。`;
    }
    image.ok = image.error.length === 0;
  } catch (error) {
    image.error = error instanceof Error ? error.message : "映像读不下去";
  }
  return image;
}

function kindText(image) {
  if (image.version === 2 && image.kind === 2) {
    return "动态库";
  }
  if (image.version === 2 && image.kind === 1) {
    return "可执行程序";
  }
  return "可执行程序";
}

function notesFor(image) {
  const notes = new Map();
  const add = (index, text) => {
    const list = notes.get(index) || [];
    list.push(text);
    notes.set(index, list);
  };
  for (const item of image.symbols) {
    add(item.index, `导出 ${item.name}`);
  }
  for (const item of image.imports) {
    add(item.index, `导入 ${item.name}`);
  }
  for (const item of image.relocs) {
    const field = item.field === 0 ? "数据" : "代码";
    add(item.index, `${field}重定位 ${item.addend}`);
  }
  return notes;
}

function listing(image, debugText) {
  const notes = notesFor(image);
  const debug = parseDebug(debugText);
  const lines = [];
  for (const step of image.steps) {
    const index = String(step.index).padStart(5, " ");
    const mark = notes.get(step.index) || [];
    const site = formatSite(siteFor(debug, { index: step.index, offset: step.index }));
    if (site) mark.push(`源 ${site}`);
    const suffix = mark.length > 0 ? `    ; ${mark.join("，")}` : "";
    lines.push(`${index}  ${step.text}${suffix}`);
  }
  return lines;
}

function hexRows(bytes) {
  const rows = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const hex = [];
    let ascii = "";
    for (let column = 0; column < 16; column += 1) {
      const index = offset + column;
      if (index < bytes.length) {
        const value = bytes[index];
        hex.push(value.toString(16).toUpperCase().padStart(2, "0"));
        ascii += value >= 0x20 && value <= 0x7e ? String.fromCharCode(value) : ".";
      } else {
        hex.push("  ");
        ascii += " ";
      }
    }
    const address = offset.toString(16).toUpperCase().padStart(8, "0");
    rows.push(`${address}  ${hex.join(" ")}  |${ascii}|`);
  }
  return rows;
}

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function symbolRows(items, empty) {
  if (items.length === 0) {
    return `<p class="empty">${empty}</p>`;
  }
  const body = items
    .map((item) => `<tr><td>${escapeHtml(item.name)}</td><td class="num">${item.index}</td></tr>`)
    .join("");
  return `<table><thead><tr><th>名字</th><th>指令</th></tr></thead><tbody>${body}</tbody></table>`;
}

function relocRows(items) {
  if (items.length === 0) {
    return `<p class="empty">没有重定位。</p>`;
  }
  const body = items
    .map((item) => {
      const field = item.field === 0 ? "数据立即数" : "跳转编号";
      return `<tr><td class="num">${item.index}</td><td>${field}</td><td class="num">${escapeHtml(item.addend)}</td></tr>`;
    })
    .join("");
  return `<table><thead><tr><th>指令</th><th>字段</th><th>加数</th></tr></thead><tbody>${body}</tbody></table>`;
}

function renderImageHtml(bytes, debugText) {
  const image = decodeImage(bytes);
  const debug = parseDebug(debugText);
  const endianText = image.endian === 1 ? "小端" : `字节序标记 ${image.endian}`;
  const warning = image.error.length > 0 ? `<p class="warn">${escapeHtml(image.error)}</p>` : "";
  const link =
    image.version === 2
      ? `<section>
      <h2>导出 ${image.symbols.length}</h2>
      ${symbolRows(image.symbols, "没有导出。")}
      <h2>导入 ${image.imports.length}</h2>
      ${symbolRows(image.imports, "没有未接上的导入。")}
      <h2>重定位 ${image.relocs.length}</h2>
      ${relocRows(image.relocs)}
    </section>`
      : `<section><p class="empty">版本 1 没有链接目录。导出、导入和重定位都是空的。</p></section>`;
  const lines = listing(image, debugText);
  const listingText = lines.length > 0 ? escapeHtml(lines.join("\n")) : "; 没有解出指令";
  const hex =
    bytes.length <= 65536
      ? `<details><summary>十六进制 · ${bytes.length} 字节</summary><pre class="mono">${escapeHtml(hexRows(bytes).join("\n"))}</pre></details>`
      : `<p class="empty">文件有 ${bytes.length} 字节，十六进制折起来太长。上面的指令和链接目录是这份预览的正文。</p>`;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
<style>
  body { margin: 0; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); font-family: var(--vscode-font-family, Segoe UI, sans-serif); }
  header, section, details { padding: 16px 20px 4px; }
  h1 { margin: 0 0 8px; font-size: 18px; font-weight: 600; }
  h2 { margin: 18px 0 8px; font-size: 13px; font-weight: 600; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 8px; }
  .chip { border: 1px solid var(--vscode-widget-border, rgba(127,127,127,.35)); border-radius: 999px; padding: 2px 10px; font-size: 12px; }
  .chip.kind { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-color: transparent; }
  .warn { color: var(--vscode-errorForeground); }
  .empty { color: var(--vscode-descriptionForeground); }
  table { border-collapse: collapse; margin: 0 0 8px; font-family: var(--vscode-editor-font-family, Consolas, monospace); font-size: 13px; }
  th, td { text-align: left; padding: 3px 16px 3px 0; }
  th { color: var(--vscode-descriptionForeground); font-weight: 500; }
  .num { font-variant-numeric: tabular-nums; }
  pre.mono { font-family: var(--vscode-editor-font-family, Consolas, monospace); font-size: var(--vscode-editor-font-size, 13px); line-height: 18px; user-select: text; white-space: pre; cursor: default; }
  #tip { position: fixed; z-index: 2; max-width: 640px; padding: 6px 8px; border-radius: 4px; background: var(--vscode-editorHoverWidget-background, #252526); color: var(--vscode-editorHoverWidget-foreground, #ccc); border: 1px solid var(--vscode-editorHoverWidget-border, #454545); font: 12px var(--vscode-font-family, Segoe UI, sans-serif); pointer-events: none; white-space: pre-wrap; display: none; }
  details { padding-bottom: 24px; }
  summary { cursor: pointer; color: var(--vscode-textLink-foreground); }
</style>
</head>
<body>
  <header>
    <h1>${kindText(image)}</h1>
    <div class="chips">
      <span class="chip kind">${kindText(image)}</span>
      <span class="chip">ZPB1</span>
      <span class="chip">版本 ${image.version}</span>
      <span class="chip">${endianText}</span>
      <span class="chip">指令 ${image.steps.length}${image.count !== image.steps.length ? ` / 声明 ${image.count}` : ""}</span>
      <span class="chip">字节 ${bytes.length}</span>
      ${debug ? `<span class="chip">对照表 obr-debug ${debug.version}</span>` : `<span class="chip">没有 .debug</span>`}
    </div>
    ${warning}
    <p class="empty">悬停一条指令看导出、重定位和源位置。注释里有路径时，单击打开那一行。</p>
  </header>
  ${link}
  <section>
    <h2>指令</h2>
    <pre class="mono" id="listing">${listingText}</pre>
  </section>
  ${hex}
  <div id="tip"></div>
  <script>
    const vscode = acquireVsCodeApi();
    const listing = document.getElementById("listing");
    const tip = document.getElementById("tip");
    if (listing) {
      function lineText(event) {
        const bounds = listing.getBoundingClientRect();
        const y = event.clientY - bounds.top + listing.scrollTop;
        const index = Math.floor(y / 18);
        return (listing.textContent || "").split("\\n")[index] || "";
      }
      listing.addEventListener("mousemove", (event) => {
        const line = lineText(event);
        const mark = line.indexOf(";");
        const text = mark >= 0 ? line.slice(mark + 1).trim() : "";
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
    }
  </script>
</body>
</html>`;
}

function formatImageText(bytes, debugText) {
  const image = decodeImage(bytes);
  const debug = parseDebug(debugText);
  const lines = [
    `; ${kindText(image)}`,
    "; 魔数 ZPB1",
    `; 版本 ${image.version}`,
    image.endian === 1 ? "; 字节序 小端" : `; 字节序标记 ${image.endian}`,
    `; 指令 ${image.steps.length}`,
    `; 字节 ${bytes.length}`,
    debug ? `; 对照表 obr-debug ${debug.version}` : "; 没有 .debug"
  ];
  if (image.error.length > 0) {
    lines.push(`; ${image.error}`);
  }
  if (image.version === 2) {
    lines.push("; 导出");
    for (const item of image.symbols) {
      lines.push(`;   ${item.name} @ ${item.index}`);
    }
    lines.push("; 导入");
    for (const item of image.imports) {
      lines.push(`;   ${item.name} @ ${item.index}`);
    }
    lines.push("; 重定位");
    for (const item of image.relocs) {
      const field = item.field === 0 ? "数据" : "代码";
      lines.push(`;   [${item.index}] ${field} ${item.addend}`);
    }
  }
  lines.push("");
  lines.push(...listing(image, debugText));
  if (bytes.length <= 4096) {
    lines.push("");
    lines.push(...hexRows(bytes));
  }
  return lines.join("\n");
}

module.exports = {
  decodeImage,
  renderImageHtml,
  formatImageText
};
