# ObjectiveR File Support

这份源码在 ZerOS 仓库的 `Compiler/ObrExtension`，是编辑器扩展。语言实现在 `Compiler/ObrCompiler`。改插件改这里，打成 VSIX 再安装。装上后在命令面板执行 `Developer: Restart Extension Host`，扩展宿主会重新读磁盘上的插件，不用重开 Cursor 窗口。

**Obr** (`.obr`) / **ModuleR** (`.mr`) / **ZAP** (`.zap`) for VS Code / Cursor.

## Features

| 能力 | 说明 |
|------|------|
| **语法着色** | TextMate + **语义高亮**（需主题开启 `editor.semanticHighlighting`）：`deRfun` 名、形参、`var` 声明与引用、已知函数调用、`ns::` 段；与 TextMate 互补 |
| **项目索引** | `objectiveR.project.scanMode`：`workspace`（全工作区）或 `mainObrAndLink`（解析 `main.obr` 的 `#LINK` 后在根下并集扫描 `.obr`/`.mr`）；任意 `.obr`/`.mr` 变更会防抖重建索引与语义 |
| **自动补全** | 关键字；工作区已索引的 `deRfun`。写出 `名字::` 后，未 import 的限定名也会出现。`import` 接受 `obr.ui` 这种点分名 |
| **语法检查** | 键入时检查括号、引号、`#VERSION` / `#DYN` / `#LINK`、`@Callfun`、`await` 是否在 `async` 函数里。`array` / `list` / `set` / `map` 的参数不会把函数头拆坏 |
| **动态诊断** | 停手约一秒后调用工作区 `Compiler/ObrCompiler/obrc.exe`（可用 `objectiveR.compiler.path` 指定）。当前文件若还没保存，用这份缓冲。`#LINK` 连到的 `.obr` 一起编。`import` 的头文件若只有声明，同目录的同名 `.obr` 也一起编，避免把 `obr::nas::ready` 报成没有这个函数。安装器 `work/` 和 `out/` 里的源码副本不参与索引，也不交给 `obrc`，避免同名头文件被报成两个模块。状态栏显示通过或问题数。`objectiveR.diagnostics.compiler` 可关 |
| **悬停** | 关键字、集合类型、局部变量；`obr::os::hertz` 这类限定名优先显示签名和头文件注释，并带调用方。寄存器标出原生映像里的 `rax` 到 `r10`。`.zap`、`__zap__` 和映像里的新指令（`dwell`、`mmap`、`admit`、比例访存）也有说明 |
| **程序映像** | 无扩展名的 `ZPB1` 与 `ZNB1`，以及 `.lib`。`ZNB1` 按当前已登记的原生编码反汇编，r0 至 r7 显示成文本寄存器。旁边有 `.debug` 时，悬停看源文件、行号和函数，单击打开那一行。资源管理器里 `ZPB1` 标 `Z`，`ZNB1` 标 `N`，`.lib` 标 `L` |

设置前缀：`objectiveR.`。可单独关闭补全、结构诊断、工作区诊断、编译器诊断、语义高亮，或指定 `obrc` 路径。

本扩展不内嵌编译器。动态诊断调用工作区里的 `obrc`。装上新的 VSIX 后执行 `Developer: Restart Extension Host`，映像预览才会换成 `ZNB1`。

## Pack VSIX

```bash
npx --yes @vscode/vsce package
cursor --install-extension ./objective-r-file-support-0.6.2.vsix --force
```

然后在命令面板执行 `Developer: Restart Extension Host`。安装 VSIX 后可选将 **File Icon Theme** 设为 `ObjectiveR Icons`。

## 与语言实现

Obr 表面以 ZerOS `Compiler/ObrCompiler` 为准，ZAP 以 ZCP1 指令表为准。本扩展不嵌入编译器。改完贡献项后重新安装 VSIX，再执行 `Developer: Restart Extension Host`，图标和语法才会换上。
