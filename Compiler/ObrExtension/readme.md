# ObjectiveR File Support

这份源码在 ZerOS 仓库的 `Compiler/ObrExtension`，是编辑器扩展。语言实现在 `Compiler/ObrCompiler`。改插件改这里，打成 VSIX 再安装。装上后在命令面板执行 `Developer: Restart Extension Host`，扩展宿主会重新读磁盘上的插件，不用重开 Cursor 窗口。

**Obr** (`.obr`) / **ModuleR** (`.mr`) / **ZAP** (`.zap`) for VS Code / Cursor.

## Features

| 能力 | 说明 |
|------|------|
| **语法着色** | TextMate + **语义高亮**（需主题开启 `editor.semanticHighlighting`）：`deRfun` 名、形参、`var` 声明与引用、已知函数调用、`ns::` 段；与 TextMate 互补 |
| **项目索引** | `objectiveR.project.scanMode`：`workspace`（全工作区）或 `mainObrAndLink`（解析 `main.obr` 的 `#LINK` 后在根下并集扫描 `.obr`/`.mr`）；键入时只在停顿 300ms 后增量更新当前文件，文件创建/删除或配置变化时才重建全索引 |
| **自动补全** | 关键字；工作区已索引的 `deRfun`。写出 `名字::` 后，未 import 的限定名也会出现。`import` 接受 `obr.ui` 这种点分名 |
| **语法检查** | 编辑时仅在停顿 500ms 后检查当前文件的括号、引号、`#VERSION` / `#DYN` / `#LINK`、`@Callfun`、`await` 等轻量规则；不跑 `obrc`，也不做工作区级检查。保存时再刷新完整文件诊断。`array` / `list` / `set` / `map` 的参数不会把函数头拆坏 |
| **动态诊断** | 仅在保存 `.obr` 后调用工作区 `Compiler/ObrCompiler/obrc.exe`（可用 `objectiveR.compiler.path` 指定），或运行命令 **ObjectiveR: 检查当前文件**；输入期间绝不启动编译。每次只把当前 `.obr` 作为编译目标，不扫描或编译其他 `.obr`；只为当前文件中显式 `import` 的模块查找 `.mr` 头文件目录（例如 `import memory;` 会找到 `Hardware/Memory/memory.mr`），再与当前文件目录一起传给编译器。当前文件若还没保存，用这份缓冲。工作区其他文件的实现和跨文件 `#LINK` 关系不属于这次单文件检查。状态栏显示通过或问题数。`objectiveR.diagnostics.compiler` 可关 |
| **悬停** | 关键字、集合类型、局部变量；`obr::os::hertz` 这类限定名优先显示签名和头文件注释，并带调用方。寄存器标出原生映像里的 `rax` 到 `r10`。`.zap`、`__zap__` 和映像里的新指令（`dwell`、`mmap`、`admit`、比例访存）也有说明 |
| **程序映像** | 无扩展名的 `ZPB1` 与 `ZNB1`，以及 `.lib`。`ZNB1` 按当前已登记的原生编码反汇编，r0 至 r7 显示成文本寄存器。旁边有 `.debug` 时，悬停看源文件、行号和函数，单击打开那一行。资源管理器里 `ZPB1` 标 `Z`，`ZNB1` 标 `N`，`.lib` 标 `L` |

设置前缀：`objectiveR.`。可单独关闭补全、结构诊断、工作区诊断、编译器诊断、语义高亮，或指定 `obrc` 路径。

反例夹具 `bad-*.obr` 故意不合法，插件只对其保留语法着色：结构检查、工作区检查、`obrc` 动态诊断全部跳过，避免满屏红淹没真问题。

本扩展不内嵌编译器。动态诊断调用工作区里的 `obrc`。装上新的 VSIX 后执行 `Developer: Restart Extension Host`，映像预览才会换成 `ZNB1`。

## Pack VSIX

```bash
npx --yes @vscode/vsce package
cursor --install-extension ./objective-r-file-support-0.7.7.vsix --force
```

然后在命令面板执行 `Developer: Restart Extension Host`。安装 VSIX 后可选将 **File Icon Theme** 设为 `ObjectiveR Icons`。

## 与语言实现

Obr 表面以 ZerOS `Compiler/ObrCompiler` 为准，ZAP 以 ZCP1 指令表为准。本扩展不嵌入编译器。改完贡献项后重新安装 VSIX，再执行 `Developer: Restart Extension Host`，图标和语法才会换上。

## 版本

- **0.7.1**：修“重复函数签名”误报。类/接口方法按 `Class::method` 限定（与编译器报错名一致），不同类的同名同签名方法不再互相判重；接口方法声明以 `;` 结束不算“应以 `{` 开始函数体”。补全对方法插入短名（`obj.method(...)`），悬停/大纲标签分出“类 / 接口 / 方法”；带 `owner` 的方法按短名配裸调用（算“可能的调用方”）。
- **0.7.0**：支持 `#VERSION 2`。`#VERSION` 校验接受 1/2；识别 `interface` / `implements` / `const` / `switch` / `case` / `default` / `fallthrough` / `in`（着色、补全、语义高亮、调用提取、悬停）；大纲新增 `class` / `interface` 符号，接口方法标成接口声明（`;` 结束不再被报“应以 `{` 开始函数体”）；补 `interface` / `implements` / `const` / `switch` 片段；`byte` 悬停文案改为 8 位无符号八位组。
- **0.6.2**：ZNB1/ZPB1 映像预览与 `.lib` 预览。
