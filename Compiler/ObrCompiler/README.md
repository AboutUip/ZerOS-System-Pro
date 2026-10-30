# Obr 编译器

本分支处于严格复核/Draft阶段：管道路径新增native fault尚未关闭，不能据此标为完整验收或合并。当前结果与回退边界见 [严格报告](docs/Benchmark.md)。

本目录是宿主编译器 `obrc`。编辑器扩展在 `Compiler/ObrExtension`。

默认使用 `-O1`。`-O0` 关闭新优化并保留旧生成路径（保留字符装箱等正确性修复）；`-O2` 额外允许有界小叶函数的多调用内联。`-fno-peephole`、`-fno-fold`、`-fno-load-forward`、`-fno-dce`、`-fno-native-compact`、`-fno-scaled` 和 `-fno-inline-small` 可独立定位；`-passes` 接受 `forward`、`fold`、`load-forward`、`dce`，可排序和重复最多八项，默认 `forward,dce` 将前向折叠和装入转发合为一次扫描；`-native-report 文件` 输出逐行 native 覆盖诊断。默认不生成 `.zap` 的行为不变。设计、预算、保守边界、测试命令与回退方法见 [优化说明](docs/Optimization.md)。

固定提交的实测、原始数据、未达期望和现有系统问题见 [优化基准报告](docs/Benchmark.md)及[需求验证矩阵](docs/Requirements.md)。内核镜像 O1 缩小 24.97%，真实 PIE 语料中位数缩小 5.31%；这不是对整机帧率或任意程序性能的保证。

语法规则写在 `Documents/Skills/ObrLanguage/SKILL.md`。Cursor 经 `.cursor/skills/obr-language/SKILL.md` 读到同一份。改语言表面时，编译器、该技能和本文一起改。

`examples/` 里以 `bad-` 开头的源文件应当在编译期被拒绝。运行时才失败的例子不用这个前缀。`ui-meter-runtime.obr` 能通过编译；`meter` 的最大值小于 1 时在运行时失败。

宿主编译器，把语言版本 1 的 `.obr` 编成程序。默认只写无扩展名二进制，CPU 直接解码。能整段编成已登记的原生指令、又不是 `-pie` 或 `-shared`、也没有导入和重定位时，这份二进制是原生指令映像，魔数 `5A 4E 42 31`。文本寄存器 `r0` 至 `r7` 编成 `rax`、`rdi`、`rsi`、`rdx`、`rcx`、`r8`、`r9`、`r10`。返回值在 `rax`。前六个整数参数依次在 `rdi`、`rsi`、`rdx`、`rcx`、`r8`、`r9`，第 7 个起在软件栈。`rbx`、`rbp`、`r12` 至 `r15` 不分配。`call` 时 `rsp` 按 16 个八位组对齐，没有红色区。`*(long*)(基址 + 变址 * 步长)` 在步长是 8、16、32 或 64 位时收成一条带比例的访存；基址仍是位地址，低 3 位不是 0 时停机。其余仍是原来的程序映像，魔数 `5A 50 42 31`。按比例的那一行写不进原来的映像。`-zap` 才在旁边写 `.zap`，内容是同一段程序的文本，用来对照调试。`-o` 以 `.zap` 结尾时，二进制写在去掉这个后缀的路径上。写入前会展开标号和 `call`。沙盒仍只接受 ZAP 文本。阶段分开：

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
| `codegen/Inline.cpp` | 既有单调用内联；O2 有成本上限的小叶函数多调用内联 |
| `codegen/Lower.cpp` | 表达式和语句落到寄存器 |
| `codegen/Runtime.cpp` | 字符串复制和拼接 |
| `codegen/Collect.cpp` | 数组、列表、集合和映射的堆运行时 |
| `codegen/Generate.cpp` | 程序入口和 `main` |
| `image/Write.cpp` | 能编成原生指令时写原生映像，否则把展开后的 ZAP 写成原来的二进制。`-debug` 时在旁边再写 `.debug`，不改这串字节 |
| `image/Native.cpp` | 写出已登记的原生整数编码和 `0F 3F` 样例，并在启动时核对样例字节 |
| `image/NativeImage.cpp` | 把展开后的行编成原生指令。有一行编不了就整份退回原来的二进制 |
| `obrc.cpp` | 读文件。默认只写无扩展名二进制。`-zap` 才写旁边的文本。`-debug` 写对照表。`-shared` 编动态库，`-pie` 编可重定位程序 |

## 这一版接受

`obrc -slot N` 把栈、帧、静态区和堆加上 `N × 268435456`。`N` 是 `0` 至 `7`。不写或写 `0` 时仍是核心 0 的地址。用户源码里小于 `1048576` 的立即数不会跟着加。

`#DYN` 写在文件开头，不带参数。这个文件 `import` 的头文件里，没有函数体、也不是指令的声明变成导入：调用先跳到 `halt`，等 `attach` 改到库里的同名导出。`obrc -shared` 编动态库，必须 `-slot 0`，不能有 `main`，至少导出一个函数。不小于 `1048576` 的立即数记成数据重定位。`obrc -pie` 编可重定位的可执行程序，也必须 `-slot 0`，不能和 `-shared` 一起写。它只记数据重定位，装入时按目标核心加上窗口位移。没有导出、导入，也没有 `-pie` 的程序仍是版本 1。动态库、带导入的程序和 `-pie` 的程序是版本 2。

`deRfun`、`import`、`.mr` 函数头、`namespace` 与 `::`、多个 `.obr` 一次链接。某个 `.obr` 写了 `import` 时，和已导入头文件签名相同的 `deRfun` 是该声明的实现；对不上头文件的函数仍属于本文件。没有 `import` 的文件仍可单独编译，函数只在该文件内可见。`.mr` 里还可以写 `struct` 和 `enum`，导入后与源文件里的类型放在一起，名字不能重复。

不递归、不含 `__zap__` 的函数，只被调用一次时在那一处展开，不另输出函数体。`-O2` 可进一步展开无循环、无调用/new/await/地址逃逸、无 goto/标号/static 的小叶函数；至多 8 条语句、64 成本单位、96 个调用点，每函数增加成本不超过 128，整单元不超过 20% 且至多 512。预算计入字符串长度和结构体字数，exported 函数不做这一扩展。更长或带循环、又被调用多次的，只输出一份，调用处用 `call`。`main` 和 `export` 的函数始终输出。

`byte` / `short` / `int` / `long` / `float` / `double` / `boolean` / `char` / `string` / `void`、一层 `类型*` 指针、`array[元素]` / `list[元素]` / `set[元素]` / `map[键, 值]`、`&` 取变量地址、`*` 读写真值、`(long*)4096` 以及 `(结构体*)地址`、`(枚举*)地址` 这种把整数当成位地址的转换（来源必须是整数；类名不能再加 `*`）、`if` / `else`、`while`、`break` / `continue`、`goto 标号` 与单独成句的 `标号:`（同一函数内，可向前或向后跳）、`?:`、赋值和复合赋值、`++` / `--`、算术、关系、相等、位运算、移位、`**`、逻辑短路、字符串拼接和引用相等、`length(字符串)` 与 `length(集合)`、`字符串[下标]`（一个码点，结果是 `char`；`length` 计标量，堆上从 +64 位起每 32 位一个小端标量，源文件按 UTF-8 解开）、数组和列表的下标、`static` 变量、`var[类型]`、超过 6 个的参数（从第 7 个起放在栈上）、浮点 `%`（`fmod`）、递归、`0x` 整数字面量（放不进 `int` 或带 `L` 时是 `long`）。

`array`、`list`、`set`、`map` 不是关键字。`new array[long](长度)` 在堆上分配，长度是负数时运行时停机。`new list[string]()`、`new set[long]()`、`new map[string, long]()` 不要参数。它们都是一个 64 位引用，可以作参数、返回值和字段，`==` 比的是引用，`null` 可以赋给它们。结构体不能当元素，集合后面再写 `*` 会拒绝。列表用 `push` / `pop`，集合用 `has` / `add` / `remove`，映射用 `has` / `put` / `get` / `remove`。已有的键再 `add` 不变，`put` 只换值。没有这个键时 `get` 停机，`remove` 则什么都不做。没有垃圾回收。

`__zap__ {` 与 `}` 之间的每一行原样成为 ZAP。`export deRfun` 的标号就是函数名，`__zap__` 里可以 `call` 这个名字。普通 Obr 调用仍按函数解析，不增加新的 CPU 指令。`main` 的函数体如果只有一条 `__zap__`，这段指令原样放在开头，其余函数仍会输出，没有 `call main` 和栈帧。

头文件里名字与参数和下面这张表一致的声明，调用时收成一条已有指令，不建栈帧，也不能再写函数体：`gpu::box`、`gpu::text`、`gpu::align`、`gpu::paint`、`gpu::glyph`、`gpu::character`、`gpu::drop`、`gpu::compose`、`gpu::present`、`gpu::accel`、`port::state`、`port::char`、`query`、`xchg`、`bulk`、`carry`、`halt`、`obr::os::schedule`、`obr::os::slice`、`obr::os::pass`、`obr::os::take`、`obr::os::svc`、`obr::os::bound`、`obr::os::gate`、`obr::os::release`、`obr::os::yield`、`obr::os::dwell`、`obr::os::mmap`、`obr::os::munmap`、`obr::os::core`、`obr::os::install`、`obr::os::admit`、`obr::os::hertz`、`obr::os::capture`、`obr::os::restore`、`obr::os::attach`，以及 `memory::loadOctet`、`memory::load16`、`memory::load32`、`memory::load64`、`memory::loadFloat32`、`memory::loadFloat64`、`memory::storeOctet`、`memory::store16`、`memory::store32`、`memory::store64`、`memory::storeFloat32`、`memory::storeFloat64`、`memory::hertz`、`memory::metric`。除 `memory::loadFloat64` 返回 `double`、`memory::storeFloat64` 的第一个参数是 `double`、`gpu::accel` 的后四个参数是 `double` 以外，参数都是 `long`。读出的数在 `r0`，地址在 `r1`。写入时值在 `r0`、地址在 `r1`，对应 `sti` 的值、地址顺序。`memory::loadFloat32` 读回的是二进制 32 的位型，仍放在 `long` 里。`inbox(long* word): long` 发出 `inbox`，把读到的字写进指针，返回是否读到。`obr::os::dwell(long milliseconds): void` 发出 `dwell r0`。寄存器里的毫秒必须是 `0` 至 `1000`，等待时核心保持执行中。`obr::os::mmap(long port, long handle, long length): long` 发出 `mmap r0, r1, r2, r3`，返回的起始位地址在 `r0`。`obr::os::munmap(long address, long length): void` 发出 `munmap r0, r1`。客核心执行这两条失败。六个输入的 `gpu::box` 把新编号放进 `r6` 再拷回 `r0`，因为 `r0` 到 `r5` 已被输入占满。`gpu::accel(long op, double a, double b, double c, double d): long` 同样把结果放进 `r6` 再拷回 `r0`，发出 `gpu.accel r6, r0, r1, r2, r3, r4`。`gpu::character(long x, long y, long code, long foreground, long background): void` 发出 `gpu.character r0, r1, r2, r3, r4`，直接改帧上的 8×8 字形。整数字面量配到 `double` 参数时先 `itof`，不再把整数本身当成位型。`char` 可以加宽成 `int` 或 `long`，用来把字符交给 `gpu::glyph`。寄存器之间的拷贝用一条 `or rD, rS, rS`。帧基址还在 `r4` 里时不再从固定地址重读。立即数和不会冲掉 `r1`–`r3` 的参数直接放进指令用的寄存器。常量指针直接用 `load` / `store` 的绝对地址，不再先放进栈槽再间接读写。只被调用一次、不递归、不含 `__zap__` 的函数在那一处展开，不再另外输出一份函数体。O0/O1 被调用两次或以上的函数只输出一份，调用处用 `call`；O2 受上述小叶函数预算限制。`main` 和 `export` 的函数始终输出。

`struct 名字 { 字段; }` 是值。每个标量字段占 64 位，嵌套结构体就地排开，局部变量是连续栈槽，未写的字段为 0。`变量.字段` 按偏移读写。整份赋值只在两个同类型变量之间复制这些槽。结构体没有方法、不能继承、不能 `new`、不能作参数或返回值、不能 `static`、不能写在声明初值里，也不能把自身嵌进自身。`结构体*` 是指针，字段写成 `指针.字段`。类字段不能内嵌结构体。

`enum 名字 { 甲, 乙 = 4 }` 的底层类型默认是 `int`。`enum 名字: long { 甲 }` 的底层类型是 `long`。没写的值从 0 递增。`名字::值` 是这个整数常量，编译期变成立即数。同一枚举可以互相赋值；枚举和相同或更宽的整数可以互相赋值；不同枚举不能互相赋值。`int` 枚举不接受 `L` 后缀。

`for (初始; 条件; 步进) 语句` 和 `while` 一样，`continue` 先做步进。`class` 里可以写字段和 `deRfun`。`class 派生 : 基类` 把基类字段放在偏移 0，派生字段排在后面，所以一份派生对象也能按基类的字段位置来读。方法按变量声明的类型往基类找，没有虚函数表。`class C : A, B` 会拒绝，因为两个基类不能同时从偏移 0 开始。`new 类名(参数)` 在堆上分配并把全部字段清零。类里同名的 `deRfun` 是构造，清零后按参数调用；没有构造时只能写 `new 类名()`。基类构造不会自动跑，要在派生构造里自己调用。字段按 64 位排列。`对象.字段` 读写字段，`对象.方法()` 把对象当作第一个参数。类方法里写字段名，就是在写这份对象。`@Callfun(文件.obr)` 只允许列出的源文件调用；`@Callfun(!*)` 禁止用户代码调用；不写则谁都能调。`async deRfun` 里才能写 `await 调用()`。调用完成后发出已有的 `yield`，这颗核心停在下一条，停止原因是 1，寄存器、栈和 `r0` 里的返回值都留着。监督核再按时间片把它调度回来。这些都落成已有 ZAP，没有新的 CPU 指令。

`#VERSION` 缺省或写 `1`。`#LINK` 用 `/` 或 `/文件名.obr` 限制跨文件调用，按调用方的文件名匹配，行尾的回车不参与匹配。未写初值的局部变量置 0。`undefined` 可以赋给基础类型，布尔上下文为假；`null` 在布尔上下文为假。`static` 变量只在第一次执行到声明时赋初值，之后保持原值。指针只有一层，值是 ZMP1 线性位地址。`int**` 会在编译期拒绝。

## 指令对照表

`obrc -debug` 在程序二进制旁边再写一份对照表。二进制和没有 `-debug` 时逐字节相同，版本也不变。CPU 不读对照表。`-zap` 仍然只写助记符，不把对照写进 `.zap`。这不是 Obr 语法，也不是新的 CPU 指令。

文件名是二进制路径加上 `.debug`。`-o Bios` 得到 `Bios` 和 `Bios.debug`。`-o program.zap` 时二进制是 `program`，对照表是 `program.debug`。

对照表是 UTF-8 文本，每一行以 LF 结束。原来的映像第一行是 `obr-debug 1`。原生映像第一行是 `obr-debug 2`，第一列改成该条指令的起始位地址，按映像放在位地址 0 计算，含 12 个八位组的文件头。后面每条最终指令一行，四个字段用一个制表符分开：

```text
指令编号	源文件	行号	函数名
```

`obr-debug 1` 的第一列从 0 起，和 CPU 取指用的编号相同。`obr-debug 2` 的第一列是起始位地址，不是这个编号。标号不算指令。`call` 展开成 `link`，`ret` 展开成 `jmp`，各算一条。一行 `chars` 展开出的多条指令共用这一行的位置。源文件是交给 obrc 的路径。行号从 1 起。函数名是 `main` 或 `名字::方法`。展开进调用处的函数，指令仍记下那个函数自己的文件、行号和名字。`main` 外面的启动指令没有语句，行号是 0，源文件和函数名留空。函数入口的建帧和结尾补上的拆帧记下这个函数的文件和名字，行号用 `deRfun` 那一行。运行时例程同样没有源行。空字段留空，不要写成占位词。源文件和函数名里没有制表符，也没有换行。

## 还没有

`@Overwrite`、`system.mr`、`std::rout`、宏。集合没有垃圾回收，不能放下结构体，集合和映射也没有下标。语言没有 JSON 类型，也没有硬件随机数。

一次编译多个源文件：

```text
obrc main.obr math.obr -o program.zap
```

`import math;` 会在这些 `.obr` 所在目录、`-I` 目录，以及编译器旁的 `lib/` 里找唯一的 `math.mr`。模块名可以带点。`import obr.math;` 只读 `lib/obr.math.mr`。`obr::math::abs`、`min`、`max`、`clamp` 各有 `int` 和 `long` 重载，参数与结果类型相同，由编译器在调用处写成比较、分支和减法，没有对应的 `.obr` 函数体。`clamp` 小于 `low` 得到 `low`，大于 `high` 得到 `high`，否则得到原值。

`import obr.nas;` 读 `lib/obr.nas.mr`，函数体在 `lib/obr.nas.obr`。使用时要把这个 `.obr` 和程序一起交给编译器，并让 `board.mr`、`memory.mr` 处在搜索路径里。会话字仍由扩展口上的 `xchg` 组成。按句柄读取用 `carry` 一次做完，读回的字节直接写到位元线。路径是 `string`，或已经放在位元线上的计数字符串（`statAt`、`openAt`、`readdirAt`、`mkdirAt`、`unlinkAt`、`renameAt`）。`rename` 的两条路径分别放进槽 0 和槽 1。读写缓冲区是线性位地址，相邻八位组相隔 8 位。一次读取从 262144 个八位组起，搬满则加倍，最多 268435456。比这更短的对象一次读完。写入仍走阶段缓冲。一次执行至多 65535，因为应答长度是 16 位；更长的请求由库拆开重复，合计最多 268435456。后面一截失败时，已经写下的前缀留在结果里，这次返回 0。官方库使用扩展口 2，这是标定，不是协议。

`import obr.ui;` 只读 `lib/obr.ui.mr`。`pad`、`span`、`alignStart`、`alignCenter`、`alignEnd`、`align`、`advance`、`textWidth`、`lerp`、`ease`、`rgb` 在调用处收成整数运算。`meter` 用跨度、当前值和最大值算出填充像素，最大值小于 1 或跨度小于 0 时失败。`bar` 先画轨道，再从左边盖上这段填充，宽度和 `meter` 是同一段计算。`Align` 是 `long` 枚举，`Start`、`Center`、`End` 分别是 0、1、2。`rect`、`round`、`ellipse`、`bar`、`glyph`、`text`、`clear`、`clip`、`unclip` 收成 `gpu.accel`，`present` 收成 `gpu.present`。`width` 和 `height` 收成 `query`，座位 3 的字段 0 和 1，读已经发布的帧宽和帧高，不提交绘制。`save`、`translate`、`restore` 维护绘制原点，栈深 32，空栈恢复会失败。`frame` 是帧计数。`key` 读新的按下或重复，`enter` 判断键位名是不是 Enter。屏幕坐标左上为原点，y 向下，绘制会加上当前原点。字号小于 2 时字形步进是 1，否则是字号除以 2 再加 1。多出的 1 像素是字与字之间的空隙，墨仍只占字号的一半。字距使步进小于 1 时失败。`shadow` 给之后的 `text` 和 `glyph` 加 1 到 8 层偏移阴影，越远越淡。`noshadow` 关掉它。`title(字号)` 是标题栏高度，字号小于 1 时失败，否则是字号加 8。`below(顶, 字号)` 是下沿。`hit` 判断点是否在矩形内，宽或高小于 1 时是 0。这三份是整数运算，客程序可以调用。没有对应的 `.obr` 函数体，也不新增中央处理器指令。

`import obr.font;` 只读 `lib/obr.font.mr`。`face`、`select`、`draw` 收成已有的 `gpu.accel`，操作码分别是 40、41、42。整数先 `itof`。`face` 的结果在 `r0`。不解码 UTF-8，也不走固件的 8×8 点阵。没有对应的 `.obr` 函数体。

`import obr.widget;` 读 `lib/obr.widget.mr`，函数体在 `lib/obr.widget.obr`。使用时要把这个 `.obr` 和程序一起交给编译器。`obr::widget::bar` 画闭合的一条选择器，高 28，圆角 6，`open` 不是 0 时用强调色铺底，右侧写 `v`。`obr::widget::row` 画下拉列表的一行，高 26，`on` 不是 0 时铺强调色。宽小于 1 时两条都不画。它们不保存当前项，也不改分辨率。点中与否由调用方用 `obr::ui::hit` 判断。

`import obr.text;`、`import obr.proc;`、`import obr.con;` 的函数体在同名 `.obr`。使用时和程序一起交给编译器，并让 `board.mr`、`memory.mr` 处在搜索路径里。这三份不进内核链接。计数字符串是长度字加从 `+64` 起、隔 8 位的八位组，整段最长 8192。`obr::text::same` 按码点比较，相同是 1。`obr::proc::home` 是本核心的界限。`obr::proc::path` 是请求路径的起点。文件、等待、派生和管道的参数放在这个窗口：`+128`、`+192`、`+256`、`+320`，请求路径在 `+16384`，读写字节在 `+131072`，一次最多 262144 个八位组，`+512` 只给服务 26 回写字体路径。分配、释放、装入和卸下用窗口开头。`obr::con::open` 以只写打开 `/dev/con`，`obr::con::write` 一次最多 4096 个八位组。`obr::proc::font` 是服务 26：下标 `-1` 回复系统字体份数，否则 `+128` 是在不在，`+192` 是八位组数，`+512` 是路径。`obr::proc::exit` 是服务 28，交出状态后不再返回。`obr::proc::getcwd` 是服务 29，绝对路径写到字节区，长度在 `+256`。`obr::proc::clock` 是服务 30，`+128` 是从 Unix 纪元起的毫秒。`obr::proc::utime` 是服务 31，按给出的标志改访问时间和修改时间。`obr::proc::ident` 是服务 32，uid、gid、euid、egid 写在 `+128`、`+192`、`+256`、`+320`。`obr::proc::task` 是服务 33，从给出的下标起找下一个任务。没有更多时回复 2。找到时 `+192` 是这份下标，`+320` 是下一份，字节区前 12 个字是 pid、ppid、状态、核心、uid、gid、euid、egid、地址空间起点、长度、档和名字长度，名字最多 32 个八位组。命令名不在任务的 19 个字里。`stat` 在五个字之后把三个时间放在 `+448`、`+576`、`+640`。返回值就是内核状态，`0` 是成功。

`import obr.base;`、`import obr.hash;`、`import obr.rand;`、`import obr.json;` 的函数体在同名 `.obr`，和程序一起交给编译器，不进内核链接。`text` / `read` 做 2 到 16 进制，`hex` 写两位十六进制，`b64` / `unb64` 做 Base64。`mix` 是 djb2。`rand` 是模 4294967296 的线性同余，种子 0 当成 1。`parse` 成功返回 1，一次留一棵树。只接受对象、数组、字符串、整数、`true`、`false`、`null`，不接受小数和 `\u`。
