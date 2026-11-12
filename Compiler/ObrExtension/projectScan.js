/**
 * 工作区分析文件列表：`workspace` 全量，或 `main.obr` + `#LINK` 路径并集（与 Blink 项目根概念对齐）。
 * 安装器把整棵源码拷进 work/，out/ 是安装产物。这两处不参与索引，否则同名 .mr 会被报成两个头文件。
 */

const vscode = require("vscode");
const { parseMergedLinkItemsFromSource } = require("./linkParse");

const ANALYSIS_EXCLUDE =
  "{**/node_modules/**,**/.git/**,**/dev/**,**/pristine/**,**/BuildSystem/Installer/work/**,**/BuildSystem/Installer/out/**}";

function isInstallerCopy(fsPath) {
  const text = String(fsPath || "").replace(/\\/g, "/").toLowerCase();
  return text.includes("/buildsystem/installer/work/") || text.includes("/buildsystem/installer/out/");
}

/* 反例夹具（bad-*.obr）故意不合法。对它们跑诊断只会满屏红、淹没真问题，
   所以插件只保留语法着色：结构检查、live 扫描、obrc lint 统一在这里短路。 */
function isBadFixture(fsPath) {
  const name = String(fsPath || "").replace(/\\/g, "/").split("/").pop().toLowerCase();
  return name.startsWith("bad-") && name.endsWith(".obr");
}

function dedupeUris(arr) {
  const m = new Map();
  for (const u of arr) {
    if (isInstallerCopy(u.fsPath)) continue;
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

  if (mode !== "mainObrAndLink") {
    return dedupeUris(await vscode.workspace.findFiles("**/*.{obr,mr}", ANALYSIS_EXCLUDE));
  }

  const main = await vscode.workspace.findFiles("**/main.obr", ANALYSIS_EXCLUDE, 1);
  if (!main.length) {
    return dedupeUris(await vscode.workspace.findFiles("**/*.{obr,mr}", ANALYSIS_EXCLUDE));
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
    const found = await vscode.workspace.findFiles(pattern, ANALYSIS_EXCLUDE);
    for (const u of found) {
      out.push(u);
    }
  }
  return dedupeUris(out);
}

module.exports = {
  ANALYSIS_EXCLUDE,
  isInstallerCopy,
  isBadFixture,
  collectAnalysisUris
};
