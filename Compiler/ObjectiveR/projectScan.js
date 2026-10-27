/**
 * 工作区分析文件列表：`workspace` 全量，或 `main.obr` + `#LINK` 路径并集（与 Blink 项目根概念对齐）。
 */

const vscode = require("vscode");
const { parseMergedLinkItemsFromSource } = require("./linkParse");

function dedupeUris(arr) {
  const m = new Map();
  for (const u of arr) {
    m.set(u.toString(), u);
  }
  return [...m.values()];
}

/**
 * @param {import('vscode').WorkspaceFolder[] | undefined} _folders unused
 */
async function collectAnalysisUris() {
  const cfg = vscode.workspace.getConfiguration("objectiveR");
  const mode = cfg.get("project.scanMode") || "workspace";
  const exclude = "**/node_modules/**";

  if (mode !== "mainObrAndLink") {
    return vscode.workspace.findFiles("**/*.{obr,mr}", exclude);
  }

  const main = await vscode.workspace.findFiles("**/main.obr", exclude, 1);
  if (!main.length) {
    return vscode.workspace.findFiles("**/*.{obr,mr}", exclude);
  }

  const mainUri = main[0];
  const doc = await vscode.workspace.openTextDocument(mainUri);
  let items = [];
  try {
    items = parseMergedLinkItemsFromSource(doc.getText());
  } catch (_e) {
    items = ["/"];
  }
  if (!items.length) {
    items = ["/"];
  }

  const projectRoot = vscode.Uri.joinPath(mainUri, "..");
  const roots = new Map();
  const addRoot = (u) => roots.set(u.toString(), u);

  for (const item of items) {
    if (item === "/") {
      addRoot(projectRoot);
    } else {
      const sub = item.replace(/^\//, "");
      addRoot(vscode.Uri.joinPath(projectRoot, sub));
    }
  }

  const out = [];
  for (const root of roots.values()) {
    const pattern = new vscode.RelativePattern(root, "**/*.{obr,mr}");
    const found = await vscode.workspace.findFiles(pattern, exclude);
    for (const u of found) {
      out.push(u);
    }
  }
  return dedupeUris(out);
}

module.exports = {
  collectAnalysisUris
};
