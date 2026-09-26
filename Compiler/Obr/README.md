# Obr 编译器

语法规则写在 `.cursor/skills/obr-language/SKILL.md`。改语言表面时，编译器、该技能和本文一起改。

宿主编译器，把语言版本 1 的 `.obr` 编成程序。默认写出无扩展名二进制，CPU 直接解码。同一次编译会在旁边写 `.zap`，内容是同一段程序的文本，用来对照调试。`-o` 以 `.zap` 结尾时，二进制写在去掉这个后缀的路径上。写入前会展开标号和 `call`。这份二进制不是 ZCP1 机器码。沙盒仍只接受 ZAP 文本。阶段分开：

| 文件 | 职责 |
|------|------|
| `token/Token.hpp` | 词法记号 |
| `Lexer.cpp` | 词法，含注释、`#VERSION` 和 `#LINK` |
| `Parser.cpp` | 语法 |
| `type/` | 类型提升、加宽、标号名 |
| `Sema.cpp` | 作用域和语句检查 |
| `intrinsic/Intrinsic.cpp` | 一次调用对应一条已有 ZAP 的指令表，以及 `obr.math` 的识别 |
| `codegen/Math.cpp` | 把 `obr.math` 的 `int` / `long` 调用收成比较、分支和减法 |
| `codegen/Layout.hpp` | 栈、帧、静态区和堆的位地址 |
| `codegen/Emit.cpp` | 印出一行，并记住帧基址还在不在 `r4` |
| `codegen/Fold.cpp` | 常量指针收成绝对地址 |
| `codegen/Inline.cpp` | 只调用一次的函数在那一处展开 |
| `codegen/Lower.cpp` | 表达式和语句落到寄存器 |
| `codegen/Runtime.cpp` | 字符串复制和拼接 |
| `codegen/Generate.cpp` | 程序入口和 `main` |
| `image/Write.cpp` | 把展开后的 ZAP 写成无扩展名二进制 |
| `obrc.cpp` | 读文件。默认写无扩展名二进制，并写出旁边的 `.zap` |

## 这一版接受

`deRfun`、`import`、`.mr` 函数头、`namespace` 与 `::`、多个 `.obr` 一次链接。某个 `.obr` 写了 `import` 时，和已导入头文件签名相同的 `deRfun` 是该声明的实现；对不上头文件的函数仍属于本文件。没有 `import` 的文件仍可单独编译，函数只在该文件内可见。`.mr` 里还可以写 `struct` 和 `enum`，导入后与源文件里的类型放在一起，名字不能重复。

`byte` / `short` / `int` / `long` / `float` / `double` / `boolean` / `char` / `string` / `void`、一层 `类型*` 指针、`&` 取变量地址、`*` 读写真值、`(long*)4096` 这种把整数当成位地址的转换、`if` / `else`、`while`、`break` / `continue`、`goto 标号` 与单独成句的 `标号:`（同一函数内，可向前或向后跳）、`?:`、赋值和复合赋值、`++` / `--`、算术、关系、相等、位运算、移位、`**`、逻辑短路、字符串拼接和引用相等、`length(字符串)`、`字符串[下标]`（一个码点，结果是 `char`）、`static` 变量、`var[类型]`、超过 3 个的参数（从第 4 个起放在栈上）、浮点 `%`（`fmod`）、递归、`0x` 整数字面量（放不进 `int` 或带 `L` 时是 `long`）。

`__zap__ {` 与 `}` 之间的每一行原样成为 ZAP。`export deRfun` 的标号就是函数名，`__zap__` 里可以 `call` 这个名字。普通 Obr 调用仍按函数解析，不增加新的 CPU 指令。`main` 的函数体如果只有一条 `__zap__`，这段指令原样放在开头，其余函数仍会输出，没有 `call main` 和栈帧。

头文件里名字与参数和下面这张表一致的声明，调用时收成一条已有指令，不建栈帧，也不能再写函数体：`gpu::box`、`gpu::text`、`gpu::align`、`gpu::paint`、`gpu::glyph`、`gpu::drop`、`gpu::compose`、`gpu::present`、`gpu::accel`、`port::state`、`port::char`、`query`、`xchg`、`halt`，以及 `memory::loadOctet`、`memory::load16`、`memory::load32`、`memory::load64`、`memory::loadFloat32`、`memory::loadFloat64`、`memory::storeOctet`、`memory::store16`、`memory::store32`、`memory::store64`、`memory::storeFloat32`、`memory::storeFloat64`、`memory::hertz`、`memory::metric`。除 `memory::loadFloat64` 返回 `double`、`memory::storeFloat64` 的第一个参数是 `double`、`gpu::accel` 的后四个参数是 `double` 以外，参数都是 `long`。读出的数在 `r0`，地址在 `r1`。写入时值在 `r0`、地址在 `r1`，对应 `sti` 的值、地址顺序。`memory::loadFloat32` 读回的是二进制 32 的位型，仍放在 `long` 里。`inbox(long* word): long` 发出 `inbox`，把读到的字写进指针，返回是否读到。六个输入的 `gpu::box` 把新编号放进 `r6` 再拷回 `r0`，因为 `r0` 到 `r5` 已被输入占满。`gpu::accel(long op, double a, double b, double c, double d): long` 同样把结果放进 `r6` 再拷回 `r0`，发出 `gpu.accel r6, r0, r1, r2, r3, r4`。整数字面量配到 `double` 参数时先 `itof`，不再把整数本身当成位型。`char` 可以加宽成 `int` 或 `long`，用来把字符交给 `gpu::glyph`。寄存器之间的拷贝用一条 `or rD, rS, rS`。帧基址还在 `r4` 里时不再从固定地址重读。立即数和不会冲掉 `r1`–`r3` 的参数直接放进指令用的寄存器。常量指针直接用 `load` / `store` 的绝对地址，不再先放进栈槽再间接读写。只被调用一次、不递归、不含 `__zap__` 的函数在那一处展开，不再另外输出一份函数体。被调用两次或以上的函数只输出一份，调用处用 `call`。`main` 和 `export` 的函数始终输出。

`struct 名字 { 字段; }` 是值。每个标量字段占 64 位，嵌套结构体就地排开，局部变量是连续栈槽，未写的字段为 0。`变量.字段` 按偏移读写。整份赋值只在两个同类型变量之间复制这些槽。结构体没有方法、不能继承、不能 `new`、不能作参数或返回值、不能 `static`、不能写在声明初值里，也不能把自身嵌进自身。`结构体*` 是指针，字段写成 `指针.字段`。类字段不能内嵌结构体。

`enum 名字 { 甲, 乙 = 4 }` 的底层类型默认是 `int`。`enum 名字: long { 甲 }` 的底层类型是 `long`。没写的值从 0 递增。`名字::值` 是这个整数常量，编译期变成立即数。同一枚举可以互相赋值；枚举和相同或更宽的整数可以互相赋值；不同枚举不能互相赋值。`int` 枚举不接受 `L` 后缀。

`for (初始; 条件; 步进) 语句` 和 `while` 一样，`continue` 先做步进。`class` 里可以写字段和 `deRfun`。`class 派生 : 基类` 把基类字段放在偏移 0，派生字段排在后面，所以一份派生对象也能按基类的字段位置来读。方法按变量声明的类型往基类找，没有虚函数表。`class C : A, B` 会拒绝，因为两个基类不能同时从偏移 0 开始。`new 类名(参数)` 在堆上分配并把全部字段清零。类里同名的 `deRfun` 是构造，清零后按参数调用；没有构造时只能写 `new 类名()`。基类构造不会自动跑，要在派生构造里自己调用。字段按 64 位排列。`对象.字段` 读写字段，`对象.方法()` 把对象当作第一个参数。类方法里写字段名，就是在写这份对象。`@Callfun(文件.obr)` 只允许列出的源文件调用；`@Callfun(!*)` 禁止用户代码调用；不写则谁都能调。`async deRfun` 里才能写 `await 调用()`，它现在就是一次普通调用，不挂起核心。这些都落成已有 ZAP，没有新的 CPU 指令。

`#VERSION` 缺省或写 `1`。`#LINK` 用 `/` 或 `/文件名.obr` 限制跨文件调用。未写初值的局部变量置 0。`undefined` 可以赋给基础类型，布尔上下文为假；`null` 在布尔上下文为假。`static` 变量只在第一次执行到声明时赋初值，之后保持原值。指针只有一层，值是 ZMP1 线性位地址。`int**` 会在编译期拒绝。

## 还没有

`@Overwrite`、`system.mr`、`std::rout`、宏。`await` 还不会把函数挂起。

一次编译多个源文件：

```text
obrc main.obr math.obr -o program.zap
```

`import math;` 会在这些 `.obr` 所在目录、`-I` 目录，以及编译器旁的 `lib/` 里找唯一的 `math.mr`。模块名可以带点。`import obr.math;` 只读 `lib/obr.math.mr`。`obr::math::abs`、`min`、`max`、`clamp` 各有 `int` 和 `long` 重载，参数与结果类型相同，由编译器在调用处写成比较、分支和减法，没有对应的 `.obr` 函数体。`clamp` 小于 `low` 得到 `low`，大于 `high` 得到 `high`，否则得到原值。

`import obr.ui;` 只读 `lib/obr.ui.mr`。`pad`、`span`、`alignStart`、`alignCenter`、`alignEnd`、`align`、`advance`、`textWidth`、`lerp`、`ease`、`rgb` 在调用处收成整数运算。`meter` 用跨度、当前值和最大值算出填充像素，最大值小于 1 或跨度小于 0 时失败。`bar` 先画轨道，再从左边盖上这段填充，宽度和 `meter` 是同一段计算。`Align` 是 `long` 枚举，`Start`、`Center`、`End` 分别是 0、1、2。`rect`、`round`、`ellipse`、`bar`、`glyph`、`text`、`clear`、`clip`、`unclip`、`width`、`height` 收成 `gpu.accel`，`present` 收成 `gpu.present`。`save`、`translate`、`restore` 维护绘制原点，栈深 32，空栈恢复会失败。`frame` 是帧计数。`key` 读新的按下或重复，`enter` 判断键位名是不是 Enter。屏幕坐标左上为原点，y 向下，绘制会加上当前原点。字号小于 2 时字形步进是 1，否则是字号除以 2。字距使步进小于 1 时失败。`shadow` 给之后的 `text` 和 `glyph` 加 1 到 8 层偏移阴影，越远越淡。`noshadow` 关掉它。没有对应的 `.obr` 函数体，也不新增中央处理器指令。
