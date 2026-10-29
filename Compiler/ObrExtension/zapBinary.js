const vscode = require("vscode");
const path = require("path");
const { renderImageHtml, formatImageText } = require("./imageView");
const { isNativeImage, renderNativeHtml, formatNativeText } = require("./nativeView");

const VIEW_TYPE = "objective-r.zapBinary";
const LIB_VIEW = "objective-r.libPreview";
const SCHEME = "zap-binary";
const MAGIC = [0x5a, 0x50, 0x42, 0x31];

function isZapBinary(bytes) {
  return (
    bytes.length >= 12 &&
    bytes[0] === MAGIC[0] &&
    bytes[1] === MAGIC[1] &&
    bytes[2] === MAGIC[2] &&
    bytes[3] === MAGIC[3]
  );
}

function isProgramImage(bytes) {
  return isZapBinary(bytes) || isNativeImage(bytes);
}

async function readSidecar(uri) {
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(`${uri.fsPath}.debug`));
    return Buffer.from(bytes).toString("utf8");
  } catch (_error) {
    return "";
  }
}

/** 只读预览。文本编辑器会拒绝含空字节的文件，所以不走那条路径。 */
function renderHtml(bytes, debugText) {
  if (isNativeImage(bytes)) return renderNativeHtml(bytes, debugText);
  if (isZapBinary(bytes)) return renderImageHtml(bytes, debugText);
  return `<!DOCTYPE html><html><body><p>这不是 ZPB1 或 ZNB1 程序映像。</p></body></html>`;
}

function formatPreview(bytes, debugText) {
  if (isNativeImage(bytes)) return formatNativeText(bytes, debugText);
  if (isZapBinary(bytes)) return formatImageText(bytes, debugText);
  return "; 这不是 ZPB1 或 ZNB1 程序映像\n";
}

function extensionOf(uri) {
  return path.extname(uri.fsPath).toLowerCase();
}

function isPreviewFile(uri) {
  const ext = extensionOf(uri);
  return ext === "" || ext === ".lib";
}

function isPreviewView(viewType) {
  return viewType === VIEW_TYPE || viewType === LIB_VIEW;
}

function viewTypeFor(uri) {
  return extensionOf(uri) === ".lib" ? LIB_VIEW : VIEW_TYPE;
}

function fileUriOf(uri) {
  if (!(uri instanceof vscode.Uri) || uri.scheme !== "file") {
    return undefined;
  }
  if (!isPreviewFile(uri)) {
    return undefined;
  }
  return uri;
}

function tabFileUri(tab) {
  const input = tab.input;
  if (!input || !input.uri || input.uri.scheme !== "file") {
    return undefined;
  }
  if (isPreviewView(input.viewType)) {
    return undefined;
  }
  return input.uri;
}

function registerZapBinary(context) {
  const decorationEmitter = new vscode.EventEmitter();
  const opening = new Set();
  const decorationCache = new Map();
  const virtualToFile = new Map();

  const decorations = {
    onDidChangeFileDecorations: decorationEmitter.event,
    async provideFileDecoration(uri) {
      const file = fileUriOf(uri);
      if (file === undefined) {
        return undefined;
      }
      const key = file.fsPath;
      if (decorationCache.has(key)) {
        return decorationCache.get(key) || undefined;
      }
      let stat;
      try {
        stat = await vscode.workspace.fs.stat(file);
      } catch (_error) {
        return undefined;
      }
      if (stat.type !== vscode.FileType.File || stat.size < 12) {
        decorationCache.set(key, null);
        return undefined;
      }
      const bytes = await vscode.workspace.fs.readFile(file);
      if (!isProgramImage(bytes)) {
        decorationCache.set(key, null);
        return undefined;
      }
      const library = extensionOf(file) === ".lib";
      const native = isNativeImage(bytes);
      const badge = library
        ? new vscode.FileDecoration("L", "动态库", new vscode.ThemeColor("charts.blue"))
        : native
          ? new vscode.FileDecoration("N", "原生程序映像", new vscode.ThemeColor("charts.purple"))
          : new vscode.FileDecoration("Z", "ZAP 程序二进制", new vscode.ThemeColor("charts.green"));
      decorationCache.set(key, badge);
      return badge;
    }
  };

  const editor = {
    async openCustomDocument(uri) {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const debug = await readSidecar(uri);
      return {
        uri,
        bytes,
        debug,
        dispose() {}
      };
    },
    resolveCustomEditor(document, webviewPanel) {
      webviewPanel.webview.options = { enableFindWidget: true, enableScripts: true };
      const paint = (bytes, debug) => {
        webviewPanel.webview.html = renderHtml(bytes, debug);
      };
      paint(document.bytes, document.debug);
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(path.dirname(document.uri.fsPath)), path.basename(document.uri.fsPath))
      );
      const reload = async () => {
        try {
          const bytes = await vscode.workspace.fs.readFile(document.uri);
          paint(bytes, await readSidecar(document.uri));
        } catch (_error) {
          /* 文件暂时读不到时保留上一帧。 */
        }
      };
      watcher.onDidChange(reload);
      webviewPanel.onDidDispose(() => watcher.dispose());
      webviewPanel.webview.onDidReceiveMessage(async (message) => {
        if (!message || message.kind !== "open" || typeof message.file !== "string") return;
        const line = Math.max(0, Number(message.line || 1) - 1);
        try {
          const target = await vscode.workspace.openTextDocument(vscode.Uri.file(message.file));
          const position = new vscode.Position(Math.min(line, Math.max(0, target.lineCount - 1)), 0);
          await vscode.window.showTextDocument(target, {
            preview: true,
            selection: new vscode.Range(position, position)
          });
        } catch (_error) {
          void vscode.window.showWarningMessage(`打不开源文件 ${message.file}`);
        }
      });
    }
  };

  const textProvider = {
    onDidChange: decorationEmitter.event,
    provideTextDocumentContent(uri) {
      const file = virtualToFile.get(uri.toString());
      if (file === undefined) {
        return "; 找不到对应的二进制\n";
      }
      return vscode.workspace.fs.readFile(file).then(async (bytes) => {
        if (!isProgramImage(bytes)) {
          return "; 这不是 ZPB1 或 ZNB1 程序映像\n";
        }
        return formatPreview(bytes, await readSidecar(file));
      });
    }
  };

  function isPlainFileTab(tab, file) {
    const input = tab.input;
    if (!input || !input.uri) {
      return false;
    }
    if (isPreviewView(input.viewType)) {
      return false;
    }
    return input.uri.scheme === "file" && input.uri.toString() === file.toString();
  }

  async function closePlainTabs(file) {
    const tabs = [];
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (isPlainFileTab(tab, file)) {
          tabs.push(tab);
        }
      }
    }
    if (tabs.length > 0) {
      await vscode.window.tabGroups.close(tabs);
    }
  }

  async function openTextFallback(file) {
    const virtual = file.with({ scheme: SCHEME });
    virtualToFile.set(virtual.toString(), file);
    const document = await vscode.workspace.openTextDocument(virtual);
    if (document.languageId !== "zap-binary") {
      await vscode.languages.setTextDocumentLanguage(document, "zap-binary");
    }
    await vscode.window.showTextDocument(document, { preview: false });
  }

  async function openDump(uri, announce) {
    if (!(uri instanceof vscode.Uri) || uri.scheme !== "file") {
      return;
    }
    if (!announce && !isPreviewFile(uri)) {
      return;
    }
    const key = uri.toString();
    if (opening.has(key)) {
      return;
    }
    opening.add(key);
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type !== vscode.FileType.File) {
        return;
      }
      const bytes = await vscode.workspace.fs.readFile(uri);
      if (!isProgramImage(bytes)) {
        if (announce) {
          void vscode.window.showInformationMessage("这不是 ZPB1 或 ZNB1 程序映像。");
        }
        return;
      }
      const already = vscode.window.tabGroups.all.some((group) =>
        group.tabs.some((tab) => {
          const input = tab.input;
          return input && isPreviewView(input.viewType) && input.uri && input.uri.toString() === key;
        })
      );
      if (!already) {
        try {
          await vscode.commands.executeCommand("vscode.openWith", uri, viewTypeFor(uri));
        } catch (_error) {
          await openTextFallback(uri);
        }
      }
      const virtualKey = uri.with({ scheme: SCHEME }).toString();
      const shown = vscode.window.tabGroups.all.some((group) =>
        group.tabs.some((tab) => {
          const input = tab.input;
          if (!input || !input.uri) {
            return false;
          }
          if (isPreviewView(input.viewType) && input.uri.toString() === key) {
            return true;
          }
          return input.uri.toString() === virtualKey;
        })
      );
      if (shown) {
        await closePlainTabs(uri);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "打不开这份二进制";
      void vscode.window.showErrorMessage(message);
    } finally {
      opening.delete(key);
    }
  }

  function considerTab(tab) {
    const uri = tabFileUri(tab);
    if (uri === undefined) {
      return;
    }
    void openDump(uri, false);
  }

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, editor, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.window.registerCustomEditorProvider(LIB_VIEW, editor, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, textProvider),
    vscode.window.registerFileDecorationProvider(decorations),
    vscode.commands.registerCommand("objectiveR.openZapBinary", (uri) => {
      const target = uri instanceof vscode.Uri ? uri : vscode.window.activeTextEditor?.document.uri;
      if (target === undefined) {
        return;
      }
      return openDump(target, true);
    }),
    vscode.window.tabGroups.onDidChangeTabs((event) => {
      for (const tab of event.opened) {
        considerTab(tab);
      }
    }),
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (fileUriOf(document.uri) === undefined) {
        return;
      }
      void openDump(document.uri, false);
    }),
    decorationEmitter
  );

  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      considerTab(tab);
    }
  }
}

module.exports = {
  registerZapBinary,
  isZapBinary,
  isProgramImage
};
