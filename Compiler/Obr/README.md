# Obr 编译器

宿主编译器，把语言版本 1 的 `.obr` 编成 ZAP。阶段分开：

| 文件 | 职责 |
|------|------|
| `Lexer.cpp` | 词法，含注释、`#VERSION` 和 `#LINK` |
| `Parser.cpp` | 语法 |
| `Sema.cpp` | 类型 |
| `Codegen.cpp` | 按调用约定生成 ZAP |
| `obrc.cpp` | 读文件、写 `.zap` |

## 这一版接受

`deRfun`、`import`、`.mr` 函数头、`namespace` 与 `::`、多个 `.obr` 一次链接。某个 `.obr` 写了 `import` 时，它的每个 `deRfun` 必须和已导入头文件里的一条函数头一致。没有 `import` 的文件仍可单独编译，函数只在该文件内可见。

`byte` / `short` / `int` / `long` / `float` / `double` / `boolean` / `char` / `string` / `void`、一层 `类型*` 指针、`&` 取变量地址、`*` 读写真值、`(long*)4096` 这种把整数当成位地址的转换、`if` / `else`、`while`、`break` / `continue`、`goto 标号` 与单独成句的 `标号:`（同一函数内，可向前或向后跳）、`?:`、赋值和复合赋值、`++` / `--`、算术、关系、相等、位运算、移位、`**`、逻辑短路、字符串拼接和引用相等、`length(字符串)`、`字符串[下标]`（一个码点，结果是 `char`）、`static` 变量、`var[类型]`、超过 3 个的参数（从第 4 个起放在栈上）、浮点 `%`（`fmod`）、递归、`0x` 整数字面量（放不进 `int` 或带 `L` 时是 `long`）。

`__zap__ {` 与 `}` 之间的每一行原样成为 ZAP。`export deRfun` 的标号就是函数名，`__zap__` 里可以 `call` 这个名字。普通 Obr 调用仍按函数解析，不增加新的 CPU 指令。`main` 的函数体如果只有一条 `__zap__`，这段指令原样放在开头，其余函数仍会输出，没有 `call main` 和栈帧。

头文件里名字与参数和下面这张表一致的声明，调用时收成一条已有指令，不建栈帧，也不能再写函数体：`gpu::box`、`gpu::text`、`gpu::align`、`gpu::paint`、`gpu::glyph`、`gpu::drop`、`gpu::compose`、`gpu::present`、`port::state`、`port::char`、`query`、`xchg`、`halt`，以及 `memory::loadOctet`、`memory::load16`、`memory::load32`、`memory::load64`、`memory::loadFloat32`、`memory::loadFloat64`、`memory::storeOctet`、`memory::store16`、`memory::store32`、`memory::store64`、`memory::storeFloat32`、`memory::storeFloat64`、`memory::hertz`、`memory::metric`。除 `memory::loadFloat64` 返回 `double`、`memory::storeFloat64` 的第一个参数是 `double` 以外，参数都是 `long`。读出的数在 `r0`，地址在 `r1`。写入时值在 `r0`、地址在 `r1`，对应 `sti` 的值、地址顺序。`memory::loadFloat32` 读回的是二进制 32 的位型，仍放在 `long` 里。`inbox(long* word): long` 发出 `inbox`，把读到的字写进指针，返回是否读到。六个输入的 `gpu::box` 把新编号放进 `r6` 再拷回 `r0`，因为 `r0` 到 `r5` 已被输入占满。`char` 可以加宽成 `int` 或 `long`，用来把字符交给 `gpu::glyph`。寄存器之间的拷贝用一条 `or rD, rS, rS`。帧基址还在 `r4` 里时不再从固定地址重读。立即数和不会冲掉 `r1`–`r3` 的参数直接放进指令用的寄存器。常量指针直接用 `load` / `store` 的绝对地址，不再先放进栈槽再间接读写。不递归、不含 `__zap__` 的函数在调用处展开，省掉一层栈帧。

`#VERSION` 缺省或写 `1`。`#LINK` 用 `/` 或 `/文件名.obr` 限制跨文件调用。未写初值的局部变量置 0。`undefined` 可以赋给基础类型，布尔上下文为假；`null` 在布尔上下文为假。`static` 变量只在第一次执行到声明时赋初值，之后保持原值。指针只有一层，值是 ZMP1 线性位地址。`int**` 会在编译期拒绝。

## 还没有

`@Overwrite`、`@Callfun`、`system.mr`、`std::rout`、宏。

一次编译多个源文件：

```text
obrc main.obr math.obr -o program.zap
```

`import math;` 会在这些 `.obr` 所在目录和 `-I` 目录里找唯一的 `math.mr`。
