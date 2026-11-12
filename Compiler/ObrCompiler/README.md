# Obr 编译器

## 源码布局

编译器按独立子项目管理：类声明进头文件，实现按任务域分文件，单一职责、单一任务一文件（组）。

| 目录 / 文件 | 任务域 |
|---|---|
| `src/obrc.cpp` | 驱动入口（命令行、编译流水线调度） |
| `src/Lexer.{hpp,cpp}`、`src/token/Token.hpp` | 词法：Token 表与扫描 |
| `src/Parser.hpp`、`src/parse/ParserImpl.hpp` + `Parser{Core,Type,Decl,Stmt,Expr}.cpp` | 语法：`Parser` 类声明在 `ParserImpl.hpp`；Core=词流与前瞻决策、Type=类型语法、Decl=顶层与类/接口/结构体/枚举声明、Stmt=语句、Expr=表达式 |
| `src/Sema.{hpp,cpp}`、`src/sema/Checker.hpp` + `Checker{Core,Const,Type,Decl,Generic,Stmt,Expr,Atomic}.cpp` | 语义：`Checker` 类声明在 `Checker.hpp`；Core=驱动与作用域、Const=常量折叠、Type=类型解析与布局、Decl=声明/可见性/析构/失败校验、Generic=泛型单态化、Stmt/Expr=语句与表达式检查、Atomic=obr::atomic / memory::fence 调用的编译期校验（M-E） |
| `src/type/` | 类型模型（TypeKind、类型工具） |
| `src/intrinsic/` | 内建函数与操作码表 |
| `src/codegen/Generator.hpp` + `Generate/Emit/Fold/Peephole/Runtime/Collect/Inline/Math/Font.cpp` | 代码生成：`Generator` 类声明在 `Generator.hpp`；Generate=程序入口与 main、Emit=印行与帧基址、Fold=常量指针收绝对地址、Peephole=窥孔优化、Runtime=字符串运行时、Collect=集合堆运行时与例程发射、Inline=单次/小函数展开、Math=`obr.math` 收成、Font=`obr.font` 收成 |
| `src/codegen/Lower{Util,Dtor,Fail,Struct,Span,Call,Expr,Stmt,Atomic}.cpp` | 语句/表达式降级的任务域拆分：Util=寻址、Dtor=析构记录链与清扫、Fail=失败通道、Struct=结构体值语义、Span=`span[T]` 切片（构造/子切片直写、下标越界失败值、八位组密度元素读写，M-B）、Call=派发调用、Expr=表达式（`gen`/`genCall` 等按任务域再拆成 genNew/genCast/genUnary/genUpdate/genAssign 等）、Stmt=语句（`emitStmt` 按语句域再拆成 emitStmtDecl/Switch/ForIn/While/For/Return/Try）、Atomic=atomic/fence 发射（M-E，运行时动作余量） |
| `src/codegen/Ui.cpp` + `UiLayout.hpp` + `Ui{Util,Layout,Value,Draw,State}.cpp` + `UiRoutine{Draw,State}.cpp` | UI 任务域（163/39/103/286/205/137/82/518/266 行）：Ui.cpp=调度（`emitUi` 按函数名分派、`emitUiRoutines` 按需求标志分派，只分派不收成）、UiLayout.hpp=例程单元槽位、UiUtil=共享辅助（uiKeep/uiDrop/uiPlant/uiAccel/uiChannel 等）、UiLayout=布局域调用点（pad/span/alignStart/alignCenter/alignEnd/align/advance/textWidth/title/below/hit）、UiValue=数值/颜色域（lerp/ease/rgb/meter）、UiDraw=绘制控件域（shape/bar/glyph/text/clear/clip/unclip/shift/present）、UiState=状态/输入域（save/translate/restore/frame/key/enter/query/shadow/noshadow）、UiRoutineDraw/State=运行时例程族发射（uichan/uiink/uibox/uimeter/uibar/uiglyph/uitext/uipass；uiclip/uiclear/uikey/uienter/uisave/uitranslate/uirestore/uiframe/uifault） |
| `tools/` | 拆分与度量脚本：`method-meter.mjs`（方法行数盘点，>200 行方法即退出码 1，可作门禁；带防重跑护栏 + 首次运行写 `pristine/` 原始输入备份）、`golden-check.mjs`（`examples/` 编译产物逐字节门禁，与 `tools/golden/examples-sha256.json` 比对）、`split-ui.mjs`/`split-methods.mjs`（巨型方法拆分的一次性结构重构脚本，方法体逐字搬移，已拆过的单元自动跳过） |
| `src/image/` | 映像写出（ZAP 文本、原生映像、调试信息） |

约束：巨型单文件视为结构缺陷；任何单一方法 >200 行视为结构缺陷（`tools/method-meter.mjs` 度量：剥离注释与字符串后大括号配对量行跨度，门禁退出码非 0 即仍有超长方法）；新增任务域先建文件组再落代码；方法体跨文件须在头文件声明，嵌套类型返回值写全限定（如 `Parser::ParsedType`）。

本目录是宿主编译器 `obrc`。编辑器扩展在 `Compiler/ObrExtension`。

语法规则写在 `Documents/Skills/ObrLanguage/SKILL.md`。Cursor 经 `.cursor/skills/obr-language/SKILL.md` 读到同一份。改语言表面时，编译器、该技能和本文一起改。

`examples/` 里以 `bad-` 开头的源文件应当在编译期被拒绝。运行时才失败的例子不用这个前缀。`ui-meter-runtime.obr` 能通过编译；`meter` 的最大值小于 1 时在运行时失败。

宿主编译器，把语言版本 1 或 2 的 `.obr` 编成程序。`-version` 缺省是 2。默认只写无扩展名二进制，CPU 直接解码。能整段编成已登记的原生指令、又不是 `-pie` 或 `-shared`、也没有导入和重定位时，这份二进制是原生指令映像，魔数 `5A 4E 42 31`。文本寄存器 `r0` 至 `r7` 编成 `rax`、`rdi`、`rsi`、`rdx`、`rcx`、`r8`、`r9`、`r10`。返回值在 `rax`。前六个整数参数依次在 `rdi`、`rsi`、`rdx`、`rcx`、`r8`、`r9`，第 7 个起在软件栈。`rbx`、`rbp`、`r12` 至 `r15` 不分配。`call` 时 `rsp` 按 16 个八位组对齐，没有红色区。`*(long*)(基址 + 变址 * 步长)` 在步长是 8、16、32 或 64 位时收成一条带比例的访存；基址仍是位地址，低 3 位不是 0 时停机。其余仍是原来的程序映像，魔数 `5A 50 42 31`。按比例的那一行写不进原来的映像。`-zap` 才在旁边写 `.zap`，内容是同一段程序的文本，用来对照调试。`-o` 以 `.zap` 结尾时，二进制写在去掉这个后缀的路径上。写入前会展开标号和 `call`。沙盒仍只接受 ZAP 文本。阶段分开：

| 文件 | 职责 |
|------|------|
| `token/Token.hpp` | 词法记号 |
| `Lexer.cpp` | 词法，含注释、`#VERSION`、`#LINK` 和 `#DYN` |
| `Parser.cpp` | 语法 |
| `type/` | 类型提升、加宽、标号名 |
| `Sema.cpp` | 作用域和语句检查 |
| `intrinsic/Intrinsic.cpp` | 一次调用对应一条已有 ZAP 的指令表，以及 `obr.math` 的识别 |
| `codegen/Math.cpp` | 把 `obr.math` 的 `int` / `long` 调用收成比较、分支和减法 |
| `codegen/Layout.hpp` | 栈、帧、静态区和堆的位地址 |
| `codegen/Emit.cpp` | 印出一行，并记住帧基址还在不在 `r4` |
| `codegen/Fold.cpp` | 常量指针收成绝对地址 |
| `codegen/Inline.cpp` | 只调用一次的函数在那一处展开；没有循环、连同嵌进去的小函数不超过 8 条语句、调用不超过 96 处的也在每一处展开 |
| `codegen/Lower{Util,Dtor,Fail,Struct,Span,Call,Expr,Stmt}.cpp` | 表达式和语句落到寄存器（按任务域拆分；Span=`span[T]` 切片降级） |
| `codegen/Runtime.cpp` | 字符串复制和拼接 |
| `codegen/Collect.cpp` | 数组、列表、集合和映射的堆运行时 |
| `codegen/Generate.cpp` | 程序入口和 `main` |
| `image/Write.cpp` | 能编成原生指令时写原生映像，否则把展开后的 ZAP 写成原来的二进制。`-debug` 时在旁边再写 `.debug`，不改这串字节 |
| `image/Native.cpp` | 写出已登记的原生整数编码和 `0F 3F` 样例，并在启动时核对样例字节 |
| `image/NativeImage.cpp` | 把展开后的行编成原生指令。有一行编不了就整份退回原来的二进制 |
| `obrc.cpp` | 读文件。默认只写无扩展名二进制。`-zap` 才写旁边的文本。`-debug` 写对照表。`-shared` 编动态库，`-pie` 编可重定位程序 |

## 这一版接受

`obrc -slot N` 把栈、帧、静态区和堆加上 `N × 268435456`。`N` 是 `0` 至 `7`。不写或写 `0` 时仍是核心 0 的地址。用户源码里小于 `1048576` 的立即数不会跟着加。

`#DYN` 写在文件开头，不带参数。这个文件 `import` 的头文件里，没有函数体、也不是指令的声明变成导入：调用先跳到 `halt`，等 `attach` 改到库里符号相同的导出。符号把函数名里的 `::` 写成 `_`。导入项依次是符号名、模块名和指令编号。模块名就是 `import` 的名字。操作系统在进入 `main` 之前把每个模块装成 `/lib/模块名.zdll`，同一个模块只装一次。`obrc -shared` 编动态库，必须 `-slot 0`，不能有 `main`，至少导出一个函数。二进制后缀是 `.zdll`；`-o` 不以 `.zdll` 结尾时，在去掉 `.zap` 之后的路径后面补上。不小于 `1048576` 的立即数记成数据重定位，装入时会加上目标核心的窗口位移，所以它不是普通整数。长度、掩码和上界要拆成小于 `1048576` 的数再乘。接近有符号 64 位上限的字面量加上位移后超出范围，整段程序装不进去。`obrc -pie` 编可重定位的可执行程序，也必须 `-slot 0`，不能和 `-shared` 一起写。它只记数据重定位，装入时按目标核心加上窗口位移。没有导出、导入，也没有 `-pie` 的程序仍是版本 1。动态库、带导入的程序和 `-pie` 的程序是版本 3：文件头 16 个八位组，第 12 个起是指令区字节数，链接目录紧跟这些指令。版本 2 没有这个长度，目录仍在逐条指令之后。

`obrc -version` 缺省是 `2`，也是当前最高语言版本。源文件没写 `#VERSION` 时按这次的 `-version` 编译。写出的 `#VERSION` 必须小于或等于 `-version`；`-version 2` 仍能单独编译 `#VERSION 1`。`#VERSION 2` 启用对象头、`interface` 和 `implements`。版本 2 的类在偏移 0 放 64 位对象头（class ID），字段从 64 位开始；版本 1 的类布局不变。同一个编译单元不能混用 1 和 2。接口声明写成 `interface 名字 { deRfun 方法(参数): 返回; ... }`，类写成 `class 名字 : 基类 implements 接口1, 接口2 { ... }`；类必须实现全部接口方法。接口变量是 64 位引用，通过对象头 class ID 查 itable 并间接 call；原生映像用 `itable.call`，链接程序和 `-pie` 回退仍用 class ID 比较链。

### ABI 版本记录

- 语言/对象 ABI 1：类字段从偏移 0 开始，没有对象头；单继承按基类字段在前排列。
- 语言/对象 ABI 2：类对象在偏移 0 放 64 位 class ID，字段从 +64 开始；接口和 `implements` 必须使用 ABI 2。
- class ID 用来查接口方法表；原生映像用 `itable.call` 间接调用，链接/PIE 回退比较链。
- 同一个编译单元禁止混用 ABI 1 和 ABI 2；旧二进制继续按 ABI 1 运行，重编到 ABI 2 时字段偏移整体后移 64 位，不能把两边的原始对象内存直接互换。
- `#VERSION` 只控制本次编译单元；没有单独的语言版本、二进制版本、ABI 版本字段时，以这份记录为准。

`deRfun`、`import`、`.mr` 函数头、`namespace` 与 `::`、多个 `.obr` 一次链接。某个 `.obr` 写了 `import` 时，和已导入头文件签名相同的 `deRfun` 是该声明的实现；对不上头文件的函数仍属于本文件。没有 `import` 的文件仍可单独编译，函数只在该文件内可见。`.mr` 里还可以写 `struct`、`enum` 和 `const`，导入后与源文件里的类型/常量放在一起，名字不能重复。头文件常量先于源文件常量求值，所以源文件常量可以引用头文件常量；头文件常量不能引用源文件常量。

不递归、不含 `__zap__` 的函数，只被调用一次时在那一处展开，不另输出函数体。没有循环、没有 `goto` 和标号、没有 `static`、调用不超过 96 处，连同嵌进去的小函数合计不超过 8 条语句的，每次调用都展开。更长或带循环、又被调用多次的，只输出一份，调用处用 `call`。`main` 和 `export` 的函数始终输出。

`byte` / `short` / `int` / `long` / `float` / `double` / `boolean` / `char` / `string` / `void`、一层 `类型*` 指针、`array[元素]` / `list[元素]` / `set[元素]` / `map[键, 值]`、`&` 取变量地址、`*` 读写真值、`(long*)4096` 以及 `(结构体*)地址`、`(枚举*)地址` 这种把整数当成位地址的转换（来源必须是整数），`(类名*)引用` 这种类引用强转（来源必须是类引用：派生→基类免检，基类→派生按对象头 class ID 运行时检查，检查失败停机且 `rax` 是 -1，无关两类拒绝，版本 1 的类没有对象头不能做，`null` 通过；声明里的 `类名*` 仍拒绝）、`(int)` / `(long)` / `(short)` / `(byte)` / `(float)` / `(double)` / `(char)` / `(boolean)` 标量显式转换、`if` / `else`、`while`、`switch` / `case` / `default` / `fallthrough`、`break` / `continue`、`goto 标号` 与单独成句的 `标号:`（同一函数内，可向前或向后跳）、`?:`、赋值和复合赋值、`++` / `--`、算术、关系、相等、位运算、移位、`**`、逻辑短路、字符串拼接和引用相等、`length(字符串)` 与 `length(集合)`、`字符串[下标]`（一个码点，结果是 `char`；`length` 计标量，堆上从 +64 位起每 32 位一个小端标量，源文件按 UTF-8 解开）、数组和列表的下标、`static` 变量、`const` 标量常量、`var[类型]`、超过 6 个的参数（从第 7 个起放在栈上）、浮点 `%`（`fmod`）、递归、`0x` 整数字面量（放不进 `int` 或带 `L` 时是 `long`）。

`const 类型 名字 = 初值;` 当前支持 `byte`、`short`、`int`、`long`、`float`、`double`、`boolean`、`char`。初值可为字面量、枚举、已定义常量、一元 `+` / `-` / `~` / `!`、二元算术/比较/逻辑/位运算/移位、三元表达式和标量显式转换；常量在 Sema 阶段替换，不分配运行时槽，不能取地址或赋值。整数常量按声明类型检查范围，溢出报错；需要截断时写显式转换。文件级常量在当前编译单元内可见，`.mr` 常量随 `import` 进入编译单元。`const string` 只接受字符串字面量或已定义字符串常量；内容进入单元级只读字符串表，启动时写到堆起点前，并把堆指针移到表后。`const 结构体` / `const 类` 使用聚合字面量 `Pair { a = 1, b = 2 }` / `Point { x = 1, y = 2 }`，字段名必须齐全且类型一致；结构体目前只支持标量/字符串字段。类常量静态分配对象，按类布局写字段，`#VERSION 2` 类会写对象头 class ID，可用于接口派发；聚合字面量不调用构造函数。动态库暂不支持 `const string`、`const 结构体` 和 `const 类`。常量字符串可以用 `+` 拼接字符串字面量、已定义字符串常量和 `char`。\n\n标量显式转换按目标位宽截断：`int` 保留低 32 位并按有符号解释，`short` 保留低 16 位，`byte` 保留低 8 位，`char` 保留低 21 位并拒绝超出 `U+10FFFF` 的值，`boolean` 按非零为真。浮点转整数向零截断，NaN、Inf 或超出 64 位范围运行时停机。当前后端把 `float` 和 `double` 都存成二进制 64，两者之间的显式转换不改变位型。

`sizeof(T)`、`offsetof(T, 字段名)`、`alignof(T)` 是编译期内建调用，不新增关键字、不新增 CPU 指令：解析期特判（类型实参复用 `parseType()`，`offsetof` 第二参是字段名标识符），Sema 期折成 `long` 的 `LitInt`，普通表达式与常量上下文（`const` 初值、`case` 标签、枚举值、聚合字面量）同一结果，零运行时。单位是位（bit），与 `field.offset`、`home + 128` 这类手算布局同一尺。三个名字保留（同 `__dtor_` 先例）：用户函数、常量同名在 Sema 拒绝；参数是类型不是表达式，普通调用形态本就无法解析，不做可遮蔽设计。语义：sizeof = 存储跨度（槽粒度）——标量/指针/引用 64 位一槽，struct = 字段数×64，class =（对象头 + 字段数）×64（`new` 的分配跨度；`#VERSION 2` 含 1 字对象头、`#VERSION 1` 无头），字符串/集合是引用宽 64，`sizeof(void)` 等非法形态拒绝；offsetof = 字段位偏移（class 含对象头，仅直接字段名）；alignof = 八位组区自然宽度——byte 8/short 16/int 32/char 32/boolean 8/long/float/double/指针/引用 64，struct/class = 各字段最大值。sizeof 是槽跨度（`byte` 的 sizeof=64），alignof 是值自然宽度（`byte` 的 alignof=8），两把尺分别对应槽密度与八位组区。折叠管道：布局（`layoutStructs`/`layoutClasses`）先算，文件级 `const` 折叠挪到布局之后（布局不读常量，无循环依赖；常量引用常量仍按声明序，头文件常量先于源文件常量），枚举值折值再排在常量之前（含跨枚举 DFS）；泛型模板内 `sizeof(T)` 经单态化文本替换通道（`typeArgsText`）随实例化替成实参形态（`T*` 保留星号成指针宽），实例化后按实例布局求值。

`array`、`list`、`set`、`map` 不是关键字。`new array[long](长度)` 在堆上分配，长度是负数时运行时停机。`new list[string]()`、`new set[long]()`、`new map[string, long]()` 不要参数。它们都是一个 64 位引用，可以作参数、返回值和字段，`==` 比的是引用，`null` 可以赋给它们。结构体元素按值存取（装箱副本）；集合的键不能是结构体（`set[Pair]`、`map[Pair, ...]` 编译失败），集合后面再写 `*` 会拒绝。列表用 `push` / `pop`，集合用 `has` / `add` / `remove`，映射用 `has` / `put` / `get` / `remove`。已有的键再 `add` 不变，`put` 只换值。没有这个键时 `get` 停机，`remove` 则什么都不做。没有垃圾回收。

`span[T]` 是两字切片值类型（元素位地址 + 元素个数），零分配、无对象头、不进任务结构（M-B）。类型表示走集合同一形状的五元组：`TypeKind::Span` + `typeName` = 元素描述（`span[byte]` → typeName `byte`），泛型替换（`span[T]` → 实例化）走 `substText` 同一文本通道。解析：`parseType` 的 `span[` 分支（`ParserType.cpp`，与单元素集合同形）+ `parsePrimary` 的构造特判（`span[T](地址, 个数)` 收成 Call 负标记 -10；只认裸「span[」形态，`obr::ui::span`/`obr::text::span` 等调用不受牵连，`looksLikeDecl`/`scanTypeAt` 消歧同集合先例）。语义：元素步长 = M-A 的 `alignof`（值宽度：byte 8/short 16/int·char 32/long·float·double·指针 64 位），元素按八位组密度用 `ldi/sti.octet/16/32/64/f64` 存取（`byte` 读出 `and 255` 压回 0..255，与 `obr::oct` 同口径）；`s.sub(起, 个数)` 收成 -11；`.data`/`.count` 读两字（只读）；下标/子切片越界造 Plan 2 失败值（code 1 = 下标越界，与容器同一失败面）进 `emitFailCheck` 归宿链（try → @Fails → 未接住终止 `rax = -code`），不 halt、不另设停机。值语义完全复用结构体通道：传参展平两字、返回走 `retSlot` 隐藏目的槽（`Function.retSlot`，与结构体返回同一机制）、赋值/初值两字拷贝（`emitStructValueTo` 直写目的块），`sizeof(span[T])` = 128。降级集中在 `codegen/LowerSpan.cpp`（构造/子切片直写、下标元素地址带越界检查、元素读写）。槽密度区不用 span：array/list/set/map 元素槽是一字（含装箱引用），已有下标语义，集合元素/类字段不收 span；接口方法不按值收 span（同结构体），`out`/`ref` 形参收 span 走一个地址字（见下节，M-C 已启用）。span 保留给切片类型（类/结构体/枚举/接口同名拒绝，函数名不受限）。

**迁移余量（M-B 库侧收口后待办）**：`Compiler/ObrCompiler/lib/` 已完成 `obr.oct` 的 `copy/get/put/eq` span 形态（copy/eq 旧签名转调新实现、逐字节一致；get/put 单地址形态保留原实现，其 span 形态标 `@Fails`）、`memory::copy/fill/eq` 包装层 span 形态（声明面随 `obr.oct.mr` 发布——`memory.mr` 本体在 `ZerOS-PRO/Hardware/Memory`，是纯指令声明头，声明面并入它属 ZerOS-PRO 侧余量）、`obr.nas` 的 `read/write/readdir/readdirAt/readdirCached` 缓冲 span 形态（旧签名全部转调新实现）。按清表六批，Resource 侧第 1 批（83 文件 487 处 `copySpan`）与第 5-6 批（设备环/字体标量区、内核 vfs `bytes(home)` 搬运）本轮未动，属并行任务持锁面；`obr.os` 的 `bound/mmap/munmap/install/admit/attach` (address,length) span 形态需新名（指令名不能同名重载），随 Resource/内核批一起评估。

`__zap__ {` 与 `}` 之间的每一行原样成为 ZAP。`export deRfun` 的标号把函数名里的 `::` 写成 `_`，`__zap__` 里可以 `call` 这个标号。普通 Obr 调用仍按函数解析，不增加新的 CPU 指令。`main` 的函数体如果只有一条 `__zap__`，这段指令原样放在开头，其余函数仍会输出，没有 `call main` 和栈帧。

头文件里名字与参数和下面这张表一致的声明，调用时收成一条已有指令，不建栈帧，也不能再写函数体：`gpu::box`、`gpu::text`、`gpu::align`、`gpu::paint`、`gpu::glyph`、`gpu::character`、`gpu::drop`、`gpu::compose`、`gpu::present`、`gpu::accel`、`port::state`、`port::char`、`query`、`xchg`、`bulk`、`carry`、`offer`、`halt`、`obr::os::schedule`、`obr::os::slice`、`obr::os::pass`、`obr::os::take`、`obr::os::svc`、`obr::os::bound`、`obr::os::gate`、`obr::os::release`、`obr::os::yield`、`obr::os::dwell`、`obr::os::mmap`、`obr::os::munmap`、`obr::os::core`、`obr::os::install`、`obr::os::admit`、`obr::os::hertz`、`obr::os::capture`、`obr::os::restore`、`obr::os::attach`，以及 `memory::loadOctet`、`memory::load16`、`memory::load32`、`memory::load64`、`memory::loadFloat32`、`memory::loadFloat64`、`memory::storeOctet`、`memory::store16`、`memory::store32`、`memory::store64`、`memory::storeFloat32`、`memory::storeFloat64`、`memory::hertz`、`memory::metric`。除 `memory::loadFloat64` 返回 `double`、`memory::storeFloat64` 的第一个参数是 `double`、`gpu::accel` 的后四个参数是 `double` 以外，参数都是 `long`。读出的数在 `r0`，地址在 `r1`。写入时值在 `r0`、地址在 `r1`，对应 `sti` 的值、地址顺序。`memory::loadFloat32` 读回的是二进制 32 的位型，仍放在 `long` 里。`inbox(long* word): long` 发出 `inbox`，把读到的字写进指针，返回是否读到。`obr::os::dwell(long milliseconds): void` 发出 `dwell r0`。寄存器里的毫秒必须是 `0` 至 `1000`，等待时核心保持执行中。`obr::os::mmap(long port, long handle, long length): long` 发出 `mmap r0, r1, r2, r3`，返回的起始位地址在 `r0`。`obr::os::munmap(long address, long length): void` 发出 `munmap r0, r1`。客核心执行这两条失败。六个输入的 `gpu::box` 把新编号放进 `r6` 再拷回 `r0`，因为 `r0` 到 `r5` 已被输入占满。`gpu::accel(long op, double a, double b, double c, double d): long` 同样把结果放进 `r6` 再拷回 `r0`，发出 `gpu.accel r6, r0, r1, r2, r3, r4`。`gpu::character(long x, long y, long code, long foreground, long background): void` 发出 `gpu.character r0, r1, r2, r3, r4`，直接改帧上的 8×8 字形。整数字面量配到 `double` 参数时先 `itof`，不再把整数本身当成位型。`char` 可以加宽成 `int` 或 `long`，用来把字符交给 `gpu::glyph`。寄存器之间的拷贝用一条 `or rD, rS, rS`。帧基址还在 `r4` 里时不再从固定地址重读。立即数和不会冲掉 `r1`–`r3` 的参数直接放进指令用的寄存器。常量指针直接用 `load` / `store` 的绝对地址，不再先放进栈槽再间接读写。只被调用一次、不递归、不含 `__zap__` 的函数在那一处展开，不再另外输出一份函数体。没有循环、没有 `goto` 和标号、没有 `static`、调用不超过 96 处，连同嵌进去的小函数合计不超过 8 条语句的，每次调用都展开。更长或带循环、又被调用多次的，只输出一份，调用处用 `call`。`main` 和 `export` 的函数始终输出。

`struct 名字 { 字段; }` 是值。每个标量字段占 64 位，嵌套结构体就地排开，局部变量是连续栈槽，未写的字段为 0。`变量.字段` 按偏移读写。整份赋值和初值按值拷贝（右边可以是变量、字段、下标或调用结果），拷贝后互不影响。参数展平成字传入（超过 6 个字的部分走软件栈），返回走隐藏目的槽（返回一份拷贝，接口方法不能返回结构体）；集合元素存装箱副本，取回再拷一份（键不能是结构体）。三元表达式不能选结构体值，结构体之间不支持 `==`。结构体没有方法、不能继承、不能 `new`、不能 `static`，也不能把自身嵌进自身。`结构体*` 是指针，字段写成 `指针.字段`。类字段不能内嵌结构体。

`enum 名字 { 甲, 乙 = 4 }` 的底层类型默认是 `int`。`enum 名字: long { 甲 }` 的底层类型是 `long`。没写的值从 0 递增。`= 值` 是常量表达式（字面量、`名字::值`、本枚举里更早的裸名值、`sizeof` / `offsetof` / `alignof` 与它们的常量运算），解析期存初始化式、Sema 按声明序折值；跨枚举引用先折被引用的枚举（DFS），成环报「枚举值循环引用」。`int` 枚举不能直接写 `L` 后缀的 long 字面量，也不能超出 `int`。枚举值表达式不引用文件级 `const`（枚举先于常量求值）。`名字::值` 是这个整数常量，编译期变成立即数。同一枚举可以互相赋值；枚举和相同或更宽的整数可以互相赋值；不同枚举不能互相赋值。

`for (初始; 条件; 步进) 语句` 和 `while` 一样，`continue` 先做步进。`for (var[类型] 名字 in array/list)` 或 `for (已有变量 in array/list)` 先求值集合一次，再按下标遍历；空集合直接跳过，`continue` 进入下一次下标，`break` 跳出循环。array 长度固定，元素写入对后续迭代可见；list 在循环开始时记下长度，循环中 push 不扩展本次遍历，pop 等缩短后按当前长度提前结束，不越界。类或接口实现 `Iterable`（`hasNext(): boolean`、`next(): 元素类型`）时，`for-in` 改用 `hasNext`/`next`，每轮重新调用，body 内修改迭代器状态会影响后续迭代；`Iterable` 需要 `#VERSION 2`，没有泛型时 `next` 通常返回 `long`。循环变量类型必须和元素类型一致；null 集合是运行时错误。`switch` 的选择子必须是整数或枚举；`case` 常量必须整数/枚举且不能重复，最多一个 `default`。空 case 共享下一段 case/default 体；非空 case 执行完默认跳出，不隐式 fallthrough，需要时写 `fallthrough;`。`break` 跳出最近循环或 switch，`continue` 只作用于循环。原生映像里，4 个以上 case 且范围不超过 256、密度不低于一半的整数 switch 生成 `switch.table` 跳转表；空洞、越界和没有 `default` 的情况都落到默认目标。链接程序、`-pie` 和 ZPB1 回退仍生成比较链。`class` 里可以写字段和 `deRfun`。`class 派生 : 基类` 把基类字段放在偏移 0，派生字段排在后面，所以一份派生对象也能按基类的字段位置来读。方法按变量声明的类型往基类找；没有 `@Overwrite` 的槽保持静态直呼，没有虚函数表开销。`@Overwrite` 写在派生类方法前声明覆盖基类同签名方法：基类链上必须有同签名方法（参数类型序列、返回类型完全一致，含指针指向），否则报「覆盖签名不一致」或「没有可覆盖的方法」；需要 `#VERSION 2`，只能写在类方法前。槽里有一个覆盖后，解析到这个槽的调用（含方法内裸调用、具体类型调用）都按对象头 class ID 走方法表派发（原生映像 `itable.call`，链接程序和 `-pie` 回退 class ID 比较链），进最深的覆盖实现；同槽同签名的未标注方法按最近实现进表（C++ 虚函数语义）。`@Destruct` 标注析构方法（零参、`: void`、每类至多一个，不能同时 `@Overwrite`、不能写在构造上、需要 `#VERSION 2`）：带析构的所有权变量（`new` 直接初始化，绑定构造出来的那只对象，变量重赋值不转移所有权）在作用域退出和 `return` 时按 LIFO 析构，`break`/`continue` 跳出前也析构；**循环体是每轮的作用域**（体里的所有权变量每轮构造、每轮析构）；参数、别名、集合元素不析构。基类析构自动链（派生先、基类后，含提前 `return`；自己调基类析构报「析构不能自己调用基类析构」）；按对象头 class ID 动态派发，基类引用装派生对象时跑派生析构。带析构变量的函数里不能写 `goto`。没有析构的类型零代码。任务被放弃（`await` 后不再继续）时由映像里的 `__dtor_sweep` 清扫入口析构（清扫后正常任务退出；运行时放弃任务时把恢复 PC 换到该入口，不占任务结构）。清扫入口的标号由映像入口单元写在 kUi+158 单元；运行时放弃清扫时（reap 变体，放回 普通槽+256 的槽号）从该槽的私有字节取这个标号换恢复 PC，不从活窗口按地址读——同核共享换回后窗口那一格会被另一任务的私有整份替换盖住。没有析构记录的映像没有入口：变体保持停机、摘掉程序，下一次扫表按「清扫已停」收尾。`fail` 是内置失败值对象（`code`/`cause`/`note`，`fail.of(状态[, 备注])` 构造，同名局部变量可遮蔽）；`@Fails` 标注可失败函数（不能标析构；接口方法、构造可标——接口实现失败性须一致，基类构造可失败时派生构造也要标，需要 `#VERSION 2`）；`throw`/`try { } catch (fail e) { }`/`f()?` 降级为普通早退和 goto。失败归宿：最近的 try 跳 catch（原样绑定）；否则沿返回通道上抛（跨帧包装原因：code 沿用、cause 指向子失败，throw 的失败值原样出本帧）；否则未接住即终止（rax = -code）。`?` 必须有归宿，后面紧跟 `; ) ] , } :` 才是传播（表达式中间要括号）；可失败构造的 `new` 也是可失败操作。构造失败时销毁已建成的基类链（自类不析构）；构造里 try 接住则建造照常完成。容器错误是同一种失败：越界 code=1、空弹出 code=2、缺键 code=3（版本 2）；除零、地址错误仍停机。失败路径析构照跑。类/接口引用的 `==` 是引用相等、可与 null 比较。`public`/`private` 可写在类/结构体成员前（缺省 public，存量行为不变）；`private` 真实检查访问——只有声明类自己的方法能碰，`@Friend(类名[, 类名...])` 写在类声明前（授权整类）或成员前（授权该成员）授权别的类，未授权访问报「访问私有成员 类::成员」（含派生类碰基类 private、自由函数、private 构造的外部 new）；friend 不继承，列出的必须是类。泛型（单态化）：`class Name[T]`、`deRfun name[T](...)`（顶层函数与类方法均可），`Name[int]`/`new Name[int]()`/`name[int](...)`/`对象.f[int](...)` 显式实例化，`class Sub : Base[int]` 可作基类；泛型接口 `interface I[T]`（`implements I[int]`，泛型类可 `implements I[T]`）；约束 `T : 基类或接口`（不满足报「泛型实参不满足约束」）；每个实参组合一份实例，实例即普通类/函数/接口。接口方法不能自带类型参数。派生类引用可以直接当基类引用用（赋值、返回、实参、集合元素四处都隐式加宽）；拿基类引用取回派生对象必须写 `(派生类*)引用`，运行时按对象头 class ID 检查，检查失败停机、`rax` 是 -1。`class C : A, B` 会拒绝，因为两个基类不能同时从偏移 0 开始。`new 类名(参数)` 在堆上分配并把全部字段清零。类里同名的 `deRfun` 是构造，清零后按参数调用；没有构造时只能写 `new 类名()`。构造链按明确规则跑：派生构造的第一条语句写 `基类(参数)` 显式链式调用直接基类构造（写在别的位置报「基类构造必须是派生构造的第一条语句」，调祖父构造报「构造链只能调用直接基类的构造」）；漏写时自动调用基类无参构造，沿链逐级先基类后自己；基类有构造但没有无参构造时报「派生构造没有调用基类构造，基类也没有无参构造」。类没有自己的构造时 `new` 只分配清零，不跑构造链。构造不能被 `@Overwrite` 覆盖。字段按 64 位排列。`对象.字段` 读写字段，`对象.方法()` 把对象当作第一个参数。类方法里写字段名，就是在写这份对象。`@Callfun(文件.obr)` 只允许列出的源文件调用；`@Callfun(!*)` 禁止用户代码调用；不写则谁都能调。`async deRfun` 里才能写 `await 调用()`。调用完成后发出已有的 `yield`，这颗核心停在下一条，停止原因是 1，寄存器、栈和 `r0` 里的返回值都留着。监督核再按时间片把它调度回来。这些都落成已有 ZAP，没有新的 CPU 指令。

`#VERSION` 可以不写；不写时用 `obrc -version`，缺省 `2`。显式的 `1` 或 `2` 不能高于 `-version`。同一个编译单元不能混用 1 和 2。`#LINK` 用 `/` 或 `/文件名.obr` 限制跨文件调用，按调用方的文件名匹配，行尾的回车不参与匹配。未写初值的局部变量置 0。`undefined` 可以赋给基础类型，布尔上下文为假；`null` 在布尔上下文为假。`static` 变量只在第一次执行到声明时赋初值，之后保持原值。指针只有一层，值是 ZMP1 线性位地址。`int**` 会在编译期拒绝。

## 出参 out / ref（M-C）

`deRfun stat(string path, out long kind, out long size): long`、`deRfun bump(ref long total, long by): void`：`out` / `ref` 是形参修饰词，`out` = 只写（调用前不必初始化）、`ref` = 读写（实参调用前必须已初始化）。**ABI 逐位等于 `long*` + `&x`**（一个地址字槽，与存量 `T*` 参数同槽互调，`&x` 交 `T*` 形参、`*p` 当 out/ref 实参都走同一槽），不进任务结构、零新指令、ABI 只加法。多返回值 = 多个 `out`（状态返回 + 结果出参），不引入元组返回。

实现管道：

- 解析（`parse/ParserCore.cpp` + `ParserDecl.cpp`）：`Parser::takeParamModifier` 在参数位前瞻识别 `out`/`ref`——只认「修饰词 + 类型 + 参数名」形态（类型关键字、集合/span、限定名、`名字*`、`名字 名字`），叫 out/ref 的类型名、变量名、`obr::print::out` 都不受牵连；修饰词存 `Param.mode`（`Ast.hpp` 的 `ParamMode`）。
- 签名与 mangling（`type/Type.cpp` 的 `typeText`、`Sema.cpp` 的 `paramSignature`、`codegen/Generate.cpp` 的 `paramSymbol`）：修饰词与指针指向都进类型文本（`out long` / `ref long` / `long` 三形不同文）。**并修既有碰撞面**：`long*` 与 `string*` 不再同符号（过去都渲染「指针」），`Pair` 与 `Pair*` 也分开——pointee 进 `typeText` 是消除隐患不是改语义。接口签名比对两份实现同轮改（`Checker::sameMethodSignature`、`Checker::sameOverrideSignature` 与 `Generator::findMethodIndex` 都加修饰词比较）。**mangling 变更需全库重编**：同名导出/导入多于一份时的 `__` 参数符号会变（`long*`/`string*` 形参的 `.zdll` 符号名与旧编译产物不再对齐）；符号是编译器私有命名，M-J 才升承诺。存量 examples 无此碰撞面，golden 106 例逐字节不变。
- 语义（`sema/`）：`fits` / `identicalArg` / `pickOverload` 区分 out/ref/无修饰——out/ref 实参必须是可赋值左值（变量/字段/下标/`*指针`，`assignableLValue` 与赋值目标同形）且类型逐位一致（写回通道不加宽；裸指针按 pointee 区分）；`f(out long)`、`f(ref long)`、`f(long)` 是三个函数，同一左值两形对倒按多义拒绝。out 形参名的只写检查是 `checkOutUse` 收尾遍历（`CheckerStmt.cpp`）：写位链（`x = v`、`x.字段 = v`）、`&x`、out/ref 实参位转发放行，取值位拒绝「out 形参只能写，不能读」。out/ref 形参函数禁止内联（`Inline.cpp` zap 护栏，同结构体展平 ABI）；`@Fails` + out 的失败路径不写出参（失败发射本就不写，文档口径 = 值保持调用前、调用方不得依赖）。
- 降级（`codegen/`）：out/ref 形参在被调方序言就是一个普通地址字槽（`LowerStmt.cpp` 展平 1 字，复用 `Function.retSlot` 隐藏字参数先例）；实参位置发射走 `emitArgAddress`（`LowerUtil.cpp`：变量槽地址、`emitAddress` 左值链、集合/span 元素地址），被调方读写走 `emitIndirectLoad` / `emitIndirectStore`（与 `*p = v` 同一指令形状），`&x` 对 out/ref 形参给出槽里的地址字；调用点按形参修饰分流（`LowerExpr.cpp` 的 genCall/genCallStruct/genNew、`LowerCall.cpp` 的接口/覆盖派发）。上限沿既有约束：普通调用 out 参数与参数共用参数字上限，itable 派发方法含 out 总字数 ≤5。
- `out span[byte]` 已启用（M-B 决定 3 的出参形态）：一个地址字指向调用方两字切片，被调方整值写回；`ref span[byte]` 还可按元素读写。

**窗口槽登记表**（M-C 决定 5）：svc 窗口 = 本核界限起点 `home`；+128..+320 是 per-service 的描述符与个数槽。**新增服务必须登记**；现存约定（`obr::proc::open` 的 fd@+192 等）不动、如实记录。服务号与内核入口一致，返回值就是内核状态（0 = 成功）。

| 服务 | 名字 | 入参槽 | 出参槽 |
| --- | --- | --- | --- |
| 2 | alloc | +0 位数 | 返回值即块地址 |
| 3 | free | +0 块地址、+64 位数 | — |
| 4 | stat | 路径 +16384 | +128 种类、+192 大小、+256 权限、+320 属主；+384 属组、+448 访问时间、+576 修改时间、+640 状态时间 |
| 5 | open | +128 标志、路径 +16384 | +192 描述符 |
| 6 | close | +128 描述符 | — |
| 7 | read | +128 描述符、+192 偏移、+256 个数 | +320 实际个数（字节 +131072） |
| 8 | write | +128 描述符、+192 偏移、+256 个数 | +320 实际个数（字节 +131072） |
| 9 | readdir | +128 下标、+192 容量、路径 +16384 | +256 名字个数（名字 +131072） |
| 10 | mkdir | 路径 +16384 | — |
| 11 | unlink | 路径 +16384 | — |
| 12 | load | +0 核心号 | 返回值即装上的核心 |
| 13 | unload | +0 核心号 | — |
| 14 | chmod | +128 权限、路径 +16384 | — |
| 15 | chown | +128 属主、+192 属组、路径 +16384 | — |
| 16 | chdir | 路径 +16384 | — |
| 17 | spawn | +128 核心 | +192 pid、+256 实际核心 |
| 18 | kill | +128 pid、+192 信号号 | — |
| 19 | sigtake | — | — |
| 20 | pipe | — | +128 读端、+192 写端 |
| 21 | wait | +128 pid | +192 退出码 |
| 22 | loadlib | 路径 +16384 | +192 入口地址 |
| 23 | devio | +128 方向、+256 个数 | +320 实际个数（字节 +131072） |
| 24 | dup | +128 旧描述符 | +192 新描述符 |
| 25 | dup2 | +128 旧描述符、+192 目标描述符 | — |
| 26 | font | +128 下标 | +128 引导时在不在、+192 八位组数、+512 路径 |
| 28 | exit | +128 退出码 | — |
| 29 | getcwd | — | +256 路径长度（路径 +131072） |
| 30 | clock | — | +128 毫秒 |
| 31 | utime | +128 setAccess、+192 setModify、+256 access、+320 modify、路径 +16384 | — |
| 32 | ident | — | +128 uid、+192 gid、+256 euid、+320 egid |
| 33 | task | +128 起始下标 | +192 本下标、+320 下一下标 |
| 34 | list | +128 起始下标、+192 容量 | +256 条数、+320 八位组数（记录 +131072） |
| 35 | prompt | — | — |
| 36 | command | — | — |
| 37 | frame | — | — |
| 38 | frameWait | — | — |
| 39 | present | — | — |
| 40 | feed | — | — |

窗口里不属 +128..+320 的既有约定：+0 / +64 归分配释放装入卸下（服务 2/3/12/13），+384 / +448 / +576 / +640 归 stat 与 task 的属组与时间戳，+512 只给服务 26 回写字体路径，+12288 附近是调用帧，+16384 请求路径（计数字符串），+131072 读写与目录项八位组区（相邻隔 8 位）。+384 及以后归新服务顺序分配，编译器不管理、文档管理。

## volatile 与原子访问（M-D/M-E）

`volatile T*` 是指向 volatile 的指针（点类型只接受单字标量），经 `*p` 的每次读写都是 volatile 访问。
Ast 六处类型记录（Expr/Stmt/Param/Field/ConstDecl/Function.ret）各带一个 `volatilePointee` 位；
`parseType` 收 `volatile T*`（`volatileQualifier` 前瞻识别，叫 volatile 的类型/变量仍可用）；
转换规则：volatile↔普通指针隐式互转拒绝（赋值/初值/实参/返回），同点类型显式转换（`(volatile long*)p`、
`(long*)vp`）才放行，涉及 volatile 的转换只在同点类型之间放行（无关指针互转拒绝）。

**Peephole volatile 规则**：volatile 访问以 `vld.` / `vst.` 未登记助记符面发射（`image/Write.cpp` 与
`image/NativeImage.cpp` 里是 `ldi.` / `sti.` 的同编码别名，不是新指令）。四个危险优化对 volatile 全关：
重复 load 合并（`takeLoad`/`holds`）、常量匹配删读（`holds` 常量条件）、store→load 转发（`rememberStore`）、
常量指针折叠（`Fold::knownAddr_`，volatile 指针不进 `remember`、`constantPtr` 拒绝 volatile）。
`vld.`/`vst.` 在 `liveOf` 按未知助记符 `Keep+Clobber`、`forward` 里 `clearAll`——多条 volatile 访问逐条保留，
内联展开不跨 volatile 合并。**没有重排器**：`forward()` 只删或原位替换、从不交换顺序，「不可重排」今天已成立；
将来若加重排器，volatile 面是硬约束。`peel()` 维持关闭（M-D 规则落地是它重启的前提，重启见余量清单）。

**atomic/fence 编译期管道**：`lib/obr.atomic.mr` 声明 `obr::atomic::load/store/cas/fetchAdd` 与
`memory::fence()`，外加 `obr::atomic::MemoryOrder` 枚举（Acquire/Release/SeqCst，没有 relaxed）。
签名面由 `intrinsic/Intrinsic.cpp` 的 `libraryFunction` 认证（地址参数必须是 `volatile long*`，
cas/fetchAdd 返回旧值）；`sema/CheckerAtomic.cpp` 做编译期校验（常量位址 64 位对齐、内存序必须写
MemoryOrder 常量）；发射在 `codegen/LowerAtomic.cpp`：atomic.load/store 发 `vld.64`/`vst.64`（可跑），
内存序是编译期标注参数（不进运行时、不占指令）。插件同步见 `Compiler/ObrExtension/`
（tmLanguage/semanticTokens/hoverDocs/compilerLint）与 `Toolchain/lint-skill-consistency.mjs` 规则表。

**运行时余量清单**（本轮不实现，等内核/客根验证空窗后收口；语义与验收口径见
`dev/Plan/Obr-Language-Upgrade-3.md` §3「M-D/M-E 设计冻结」）：

| 余量 | 内容 | 落地前的行为 |
| --- | --- | --- |
| 内核 MMIO volatile 化 | Bios 共享字（5952/6272/6336/6208/6528/6592/4352/4416/8128）、pulse 放行字轮询、start/console 键环、Keys 发布栅栏改写 `volatile long*` + `memory::fence()` | 存量 `memory::load64/store64` 照旧可跑（raw 访存仍可优化），迁移是纯改写 |
| 信箱服务 | atomic.cas/fetchAdd 经监督核信箱服务序列化（新 svc 号段 + 窗口槽登记表登记），单字 64 位对齐 store 原子升语义 | 调用编译成停机桩（不可恢复停机，同 imported「先跳 halt」约定） |
| fence svc | `memory::fence()` 编译为一次轻量 svc（ping 服务，回复 0；原生面走 escape 既有 flush 路径），不加 CPU 指令 | 同上停机桩；fence 的编译期全屏障语义（对窥孔不可穿透）已生效 |
| acquire/release 动作 | atomic.load 的丢本核读缓存、atomic.store 的写后发布（固件缓存模型 keptOctets/dirtyOctets/readCache） | 只发 volatile 访存面；`touchesSharedFirmware` 白名单与 NativeCore 魔法地址钩子不动（双轨保险） |
| 窥孔重启 | `peel()` 默认开启，`tools/pristine/src` 快照做语义回归（97 例逐字节 + 内核引导到提示符 + 全量语料零回归） | 维持关闭（内核 MMIO volatile 标记先行是前提） |
| 运行时行为例 | atomic 真并发/cas 正确性/fence 顺序的行为例（等信箱服务与 fence svc 落地） | 正例 `volatile-poll` / `atomic-signature` / `fence-order` 只证编译期面（RUNTIME_READY/FENCE_READY 门收住未落地调用） |

## 指令对照表

`obrc -debug` 在程序二进制旁边再写一份对照表。二进制和没有 `-debug` 时逐字节相同，版本也不变。CPU 不读对照表。`-zap` 仍然只写助记符，不把对照写进 `.zap`。这不是 Obr 语法，也不是新的 CPU 指令。

文件名是二进制路径加上 `.debug`。`-o Bios` 得到 `Bios` 和 `Bios.debug`。`-o program.zap` 时二进制是 `program`，对照表是 `program.debug`。

对照表是 UTF-8 文本，每一行以 LF 结束。原来的映像第一行是 `obr-debug 1`。原生映像第一行是 `obr-debug 2`，第一列改成该条指令的起始位地址，按映像放在位地址 0 计算，含 12 个八位组的文件头。后面每条最终指令一行，四个字段用一个制表符分开：

```text
指令编号	源文件	行号	函数名
```

`obr-debug 1` 的第一列从 0 起，和 CPU 取指用的编号相同。`obr-debug 2` 的第一列是起始位地址，不是这个编号。标号不算指令。`call` 展开成 `link`，`ret` 展开成 `jmp`，各算一条。一行 `chars` 展开出的多条指令共用这一行的位置。源文件是交给 obrc 的路径。行号从 1 起。函数名是 `main` 或 `名字::方法`。展开进调用处的函数，指令仍记下那个函数自己的文件、行号和名字。`main` 外面的启动指令没有语句，行号是 0，源文件和函数名留空。函数入口的建帧和结尾补上的拆帧记下这个函数的文件和名字，行号用 `deRfun` 那一行。运行时例程同样没有源行。空字段留空，不要写成占位词。源文件和函数名里没有制表符，也没有换行。

## 还没有

`system.mr`、`std::rout`、宏。集合没有垃圾回收，集合和映射也没有下标。语言没有 JSON 类型，也没有硬件随机数。
atomic.cas/fetchAdd 的信箱服务、memory::fence 的 svc 下限与窥孔重启是运行时余量（调用现为停机桩，清单见「volatile 与原子访问」）。

一次编译多个源文件：

```text
obrc main.obr math.obr -o program.zap
```

`import math;` 会在这些 `.obr` 所在目录、`-I` 目录，以及编译器旁的 `lib/` 里找唯一的 `math.mr`。模块名可以带点。`import obr.math;` 只读 `lib/obr.math.mr`。`obr::math::abs`、`min`、`max`、`clamp` 各有 `int` 和 `long` 重载，参数与结果类型相同，由编译器在调用处写成比较、分支和减法，没有对应的 `.obr` 函数体。`clamp` 小于 `low` 得到 `low`，大于 `high` 得到 `high`，否则得到原值。用户写的同名函数也按参数类型或个数区分。实参完全一致的那一份优先；没有完全一致时，只有一个可以加宽的候选才选用，多个就编译失败。返回类型不参与选择。接口方法同样按参数区分。`export` 和 `.zdll` 里同名多于一份时，符号在名字后面接 `__` 和参数类型，单独一份仍用原来的符号。

`import obr.nas;` 读 `lib/obr.nas.mr`，函数体在 `lib/obr.nas.obr`。使用时要把这个 `.obr` 和程序一起交给编译器，并让 `board.mr`、`memory.mr` 处在搜索路径里。查看、打开、关闭、列目录、创建、删除和改名各用 `offer` 一次做完。列目录记住这一窗，并记下每一项的字节偏移，接着要下一项时不再访问扩展口，也不从应答开头重扫。同一窗里要下一个下标时，`readdirCached` 只核对下标是否落在这一窗，不再把路径逐字节比一遍；这一窗没有该下标时返回 1，调用方再走 `readdirAt`。这一窗里刚取出的修改时间由 `readdirStamp` 读出，上一次查看的修改时间由 `statStamp` 读出，都是 Unix 纪元毫秒。按句柄读取仍用 `carry`，读回的字节直接写到位元线。写入和探活仍用 `xchg`。路径是 `string`，或已经放在位元线上的计数字符串（`statAt`、`openAt`、`readdirAt`、`mkdirAt`、`unlinkAt`、`renameAt`）。`rename` 的两条路径分别放进槽 0 和槽 1。读写缓冲区是线性位地址，相邻八位组相隔 8 位。一次读取从 262144 个八位组起，搬满则加倍，最多 268435456。比这更短的对象一次读完。写入仍走阶段缓冲。一次执行至多 65535，因为应答长度是 16 位；更长的请求由库拆开重复，合计最多 268435456。后面一截失败时，已经写下的前缀留在结果里，这次返回 0。官方库使用扩展口 2，这是标定，不是协议。

`import obr.ui;` 只读 `lib/obr.ui.mr`。`pad`、`span`、`alignStart`、`alignCenter`、`alignEnd`、`align`、`advance`、`textWidth`、`lerp`、`ease`、`rgb` 在调用处收成整数运算。`meter` 用跨度、当前值和最大值算出填充像素，最大值小于 1 或跨度小于 0 时失败。`bar` 先画轨道，再从左边盖上这段填充，宽度和 `meter` 是同一段计算。`Align` 是 `long` 枚举，`Start`、`Center`、`End` 分别是 0、1、2。`rect`、`round`、`ellipse`、`bar`、`glyph`、`text`、`clear`、`clip`、`unclip` 收成 `gpu.accel`，`present` 收成 `gpu.present`。`shift(源 y, 目的 y, 高, 宽)` 收成加速操作 43，把颜色目标里一条横带从源 y 抄到目的 y。四个参数都是整数，调用前转成精确浮点。宽为 0 时用整帧宽。高为 0 时成功且不改像素。负数或越出颜色目标时失败且不改像素。源和目的重叠时按调用前的像素抄写。空出来的像素保持原样。`width` 和 `height` 收成 `query`，座位 3 的字段 0 和 1，读已经发布的帧宽和帧高，不提交绘制。`save`、`translate`、`restore` 维护绘制原点，栈深 32，空栈恢复会失败。`frame` 是帧计数。`key` 读新的按下或重复，`enter` 判断键位名是不是 Enter。屏幕坐标左上为原点，y 向下，绘制会加上当前原点。字号小于 2 时字形步进是 1，否则是字号除以 2 再加 1。多出的 1 像素是字与字之间的空隙，墨仍只占字号的一半。字距使步进小于 1 时失败。`shadow` 给之后的 `text` 和 `glyph` 加 1 到 8 层偏移阴影，越远越淡。`noshadow` 关掉它。`title(字号)` 是标题栏高度，字号小于 1 时失败，否则是字号加 8。`below(顶, 字号)` 是下沿。`hit` 判断点是否在矩形内，宽或高小于 1 时是 0。这三份是整数运算，客程序可以调用。没有对应的 `.obr` 函数体，也不新增中央处理器指令。

`import obr.font;` 只读 `lib/obr.font.mr`。`face`、`select`、`draw` 收成已有的 `gpu.accel`，操作码分别是 40、41、42。整数先 `itof`。`face` 的结果在 `r0`。不解码 UTF-8，也不走固件的 8×8 点阵。没有对应的 `.obr` 函数体。

`import obr.widget;` 读 `lib/obr.widget.mr`，函数体在 `lib/obr.widget.obr`。使用时要把这个 `.obr` 和程序一起交给编译器。`obr::widget::bar` 画闭合的一条选择器，高 28，圆角 6，`open` 不是 0 时用强调色铺底，右侧写 `v`。`obr::widget::row` 画下拉列表的一行，高 26，`on` 不是 0 时铺强调色。宽小于 1 时两条都不画。它们不保存当前项，也不改分辨率。点中与否由调用方用 `obr::ui::hit` 判断。

`import obr.text;`、`import obr.proc;`、`import obr.con;` 的函数体在同名 `.obr`。使用时和程序一起交给编译器，并让 `board.mr`、`memory.mr` 处在搜索路径里。这三份不进内核链接。计数字符串是长度字加从 `+64` 起、隔 8 位的八位组，整段最长 8192。`obr::text::same` 按码点比较，相同是 1。`span` 是 UTF-8 八位组数。`encode` 写成隔 8 位的 UTF-8。`next` 取出一个标量。`from` 没有函数体，编译器把 `array[long]` 的前若干个码点收成字符串，不合法时停机。`decode` 解开 UTF-8，用 `*ok` 表示成败。`put` 按 UTF-8 写计数字符串，长度字是八位组数。`obr::proc::home` 是本核心的界限。`obr::proc::path` 是请求路径的起点。`obr::proc::args` 是参数块的起点，界限起点之后 512 KiB。`obr::proc::list(home, index)` 是服务 34。路径仍在 `+16384`。它从下标起把这一层放得进字节区的记录一次交回，容量请求 131072 个八位组。`+256` 是条数，`+320` 是八位组数。每条先是 9 个字：名字长度、种类、大小、权限、属主、属组、访问时间、修改时间、状态时间，随后是名字。下一条紧跟名字。下标越过末尾时状态是 2。服务 9 的 `readdir` 仍一次交回一个名字。文件、等待、派生和管道的参数放在这个窗口：`+128`、`+192`、`+256`、`+320`，请求路径在 `+16384`，读写字节在 `+131072`，一次最多 262144 个八位组，`+512` 只给服务 26 回写字体路径。分配、释放、装入和卸下用窗口开头。`obr::con::open` 以只写打开 `/dev/con`，`obr::con::write` 一次最多 4096 个八位组，只把字节放进设备环。`obr::proc::feed` 是服务 40，把环里的字节收成格子，不呈现。`obr::proc::present` 是服务 39。`import obr.print;` 读 `lib/obr.print.mr`，函数体编成 `/lib/obr.print.zdll`，不和程序链在一起。`obr::print::out` 追加八位组，`byte` 追加一个八位组，`text` 追加字符串，`fill` 重复同一个八位组，`flush` 把还留在库里的字节写到描述符 1。缓冲最多 4096 个八位组。换行、缓冲满、`flush`，或 `obr::proc::frame` 和上次记下的拍不同，都会交出已有字节。诊断仍直接写描述符 2。`obr::proc::font` 是服务 26：下标 `-1` 回复系统字体份数，否则 `+128` 是在不在，`+192` 是八位组数，`+512` 是路径。`obr::proc::exit` 是服务 28，交出状态后不再返回。`obr::proc::getcwd` 是服务 29，绝对路径写到字节区，长度在 `+256`。`obr::proc::clock` 是服务 30，`+128` 是从 Unix 纪元起的毫秒。`obr::proc::utime` 是服务 31，按给出的标志改访问时间和修改时间。`obr::proc::ident` 是服务 32，uid、gid、euid、egid 写在 `+128`、`+192`、`+256`、`+320`。`obr::proc::prompt` 是服务 35，只回 0；宿主在 svc 边界记 prompt 事件。`obr::proc::command` 是服务 36，只回 0；宿主在 svc 边界开命令 span。`obr::proc::frame` 是服务 37，返回宿主显示器已经走完的拍，还没发布时是 0。`obr::proc::frameWait` 是服务 38，睡到下一拍并返回那一拍；已经有一份在等则返回 -1。`obr::proc::present` 是服务 39，呈现已经画进命令的那一帧，没有脏行时成功且不交画面。`obr::proc::task` 是服务 33，从给出的下标起找下一个任务。没有更多时回复 2。找到时 `+192` 是这份下标，`+320` 是下一份，字节区前 12 个字是 pid、ppid、状态、核心、uid、gid、euid、egid、地址空间起点、长度、档和名字长度，名字最多 32 个八位组。命令名不在任务的 19 个字里。`stat` 在五个字之后把三个时间放在 `+448`、`+576`、`+640`。返回值就是内核状态，`0` 是成功。

`import obr.oct;`、`import obr.path;`、`import obr.line;` 读编译器旁的同名头文件，函数体分别是 `/lib/obr.oct.zdll`、`/lib/obr.path.zdll`、`/lib/obr.line.zdll`。调用的文件写 `#DYN`，不把这三份 `.obr` 链进程序。不导入它们的程序仍直接调用内核服务搬字节。`obr::oct::get` 读一个八位组，`put` 按序号写入，`copy` 搬运一段，`eq` 和字符串比较。相邻八位组隔 8 位。M-B 起四个函数都有 `span[byte]` 形态（缓冲 = 元素位地址 + 元素个数两字）：`copy/eq` 的旧 `(address, count)` 签名转调 span 新实现（逐字节一致），`get(span[byte] buf, long index)` / `put(span[byte] buf, long index, long value)` 标 `@Fails`（下标越界是失败值 code 1），单地址旧形态保留原实现。`memory::copy/fill/eq` 是 memory:: 的 (address, count) 包装层 span 形态，随这份头文件发布。`obr::path::norm` 把当前目录和相对路径收成绝对路径，成功返回 0，超过 512 个八位组返回 7，不访问文件系统。`obr::line::editFeed` 往调用方给的一行状态里送一个八位组：0 继续，1 提交，2 空行 Ctrl-D，3 Ctrl-C，4 Ctrl-L，5 制表符。`editInit` 清状态。它不读键盘，也不写屏幕。

`import obr.base;`、`import obr.hash;`、`import obr.rand;`、`import obr.json;` 的函数体在同名 `.obr`，和程序一起交给编译器，不进内核链接。`text` / `read` 做 2 到 16 进制，`hex` 写两位十六进制，`b64` / `unb64` 做 Base64。`mix` 是 djb2。`rand` 是模 4294967296 的线性同余，种子 0 当成 1。`parse` 成功返回 1，一次留一棵树。只接受对象、数组、字符串、整数、`true`、`false`、`null`，不接受小数和 `\u`。
