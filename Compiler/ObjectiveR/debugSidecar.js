/**
 * obrc -debug 写在二进制旁边的 .debug。
 * obr-debug 1 的第一列是指令编号。obr-debug 2 的第一列是位地址，含 12 个八位组的文件头。
 */

function parseDebug(text) {
  if (!text) return null;
  const lines = String(text).replace(/^\uFEFF/, "").split("\n");
  const head = (lines[0] || "").replace(/\r$/, "").trim();
  const match = head.match(/^obr-debug\s+([12])$/);
  if (!match) return null;
  const version = Number(match[1]);
  const sites = [];
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index].replace(/\r$/, "");
    if (!line) continue;
    const parts = line.split("\t");
    const at = Number(parts[0]);
    if (!Number.isFinite(at)) continue;
    sites.push({
      at,
      offset: version === 2 ? Math.trunc(at / 8) : at,
      file: parts[1] || "",
      line: Number(parts[2] || 0) || 0,
      fn: parts[3] || ""
    });
  }
  return { version, sites };
}

function siteFor(debug, step) {
  if (!debug || !step) return null;
  if (debug.version === 1) {
    const site = debug.sites[step.index];
    return site || null;
  }
  const sites = debug.sites;
  let lo = 0;
  let hi = sites.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sites[mid].offset <= step.offset) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found < 0) return null;
  const site = sites[found];
  const next = sites[found + 1];
  if (next && step.offset >= next.offset) return null;
  return site;
}

function formatSite(site) {
  if (!site) return "";
  if (!site.file && !site.line && !site.fn) return "";
  const place = site.file ? `${site.file}:${site.line || 0}` : "";
  return [place, site.fn].filter(Boolean).join("  ");
}

module.exports = {
  parseDebug,
  siteFor,
  formatSite
};
