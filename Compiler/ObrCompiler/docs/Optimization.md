# obrc 优化设计与兼容边界

## 基线与范围

实现基线是 upstream `main` 的 `7bf78874240d695ff384cbf75efc1a3198036677`。优化只修改编译器、构建测试和语言说明；CPU、内存控制器、调度器、协议正文、布局常量和运行时依赖不变。`ZPB1` v1/v2、`ZNB1` v1 及 `obr-debug` v1/v2 的结构不变。

`-O0` 保留既有 lowering 和固定宽度 native 立即数，关闭新 pass，但不撤销明确的正确性修复。修复了两处原有选择失败：PIE/shared/import 程序不再生成只能写入 native 的 scaled 中间指令；native 无法表达的寄存器返回或未对齐绝对访问可以回退到既有 ZAP 映像。原来编译失败的这些输入不属于逐字节基线。

默认 `-O1` 启用保守前向传播、私有栈槽装入转发、CFG 活跃性删除和紧凑 native 编码。`-O2` 在此基础上允许有界的小叶函数多调用内联。它没有新增 SSA、全局寄存器分配、循环展开、native PIE 或新 opcode。

## 中间表示与 pass

发射阶段保留原有文本接口。进入 Peephole 时，每一行解析成共用的机器 IR：原文本、寄存器编号、带符号立即数、标号/操作数以及 `DebugSite`。前向分析和 CFG 使用同一解析结果；新生成的常量/复制指令重新构造 IR。优化迭代不重复分词。写入器仍负责标签展开、链接目录、编码和最终 debug 地址。

这是一层机器指令 IR，不是全新前端 typed SSA。内存别名和调用效应未证明时采取保守路径；完整的跨函数寄存器分配留待独立设计。

默认顺序是 `forward,dce`，其中 `forward` 在一次扫描中合并折叠与装入转发以控制编译成本。机器 IR pass 使用共享的有类型注册表；`-passes fold,load-forward,dce` 可将两项前向变换分开，任意排序、重复，最多八项。例如 `load-forward,fold` 可继续折叠装入转发产生的值，反过来则需要再运行一次 fold。各自仍受 `-fno-fold` / `-fno-load-forward` / `-fno-dce` 约束。`-O0` 和 `-fno-peephole` 跳过整条机器 IR 流水线。

AST 内联、lowering 与最终编码属于不同表示阶段，不能把二进制编码放到 AST/机器 IR 之前运行。它们的 feature flag 保持独立；同一表示上的机器 IR 变换才接受 `-passes` 排序。此阶段约束是接口的一部分，不能把 backend 开关描述成可任意重排的 IR pass。

| 开关 | 作用 |
|---|---|
| `-fno-fold` | 禁用小整数折叠及复制/恒等运算改写 |
| `-fno-load-forward` | 禁用私有帧槽的装入转发 |
| `-fno-dce` | 禁用 CFG 活跃性删除 |
| `-fno-native-compact` | native 恢复固定 movabs 和原有零位移形式 |
| `-fno-scaled` | O1/O2 使用通用访存 lowering |
| `-fno-inline-small` | O2 不扩展多调用小叶函数；既有单调用内联保留 |

### 活跃性与返回边界

`halt` 的 `r0` 是可观察的结果，必须保持活跃。除零、移位和访存等可能失败的操作不按“结果未使用”删除。未知操作与原样汇编按全寄存器边界处理。

`ret` 同样保守保持全部文本寄存器。编译单元含有 UI/集合/字体等手写例程、多寄存器返回和内联路径，不能仅根据 `DebugSite` 是否有文件名就推断调用效应。没有可靠的跨函数 clobber 摘要前，按普通高层返回值仅保留 `r0/r7` 会删掉仍被调用方使用的状态。测试包含有源码归属及无源码归属的返回；浏览器回归包含 Logo 与连续 shell 命令。

CFG 的后向活跃性按块逆序迭代到不动点，再决定删除；不动点不收敛时保留代码。每条效果只计算一次。标签、可能失败的操作和未知效果都保留。

### 数字目标与原样汇编

`__zap__` 的指令带内部 opaque 标记，标记不进入 `.debug` 格式。前向分析在此清空事实，DCE 保留其效果。

存在数字 `jz/jnz/call/link/icall` 或寄存器间接 `jmp` 的整个编译单元不删行。数字目标依赖原始全局下标，任意寄存器也可能保存代码下标；没有对应重定位证明时不能随意调整。这里优先保持已有手写汇编行为，代价是这类单元只获得后端编码收益。

### 内存与重定位

只转发编译器自身的 `kSp/kFrame/kHeapPtr` 单元，以及能证明整个访问区间位于私有栈区的数值地址。仅从当前帧/栈指针字加载所得的符号值没有实际范围证明，保持真实间接读取；窄加载也不能继承指针的私有属性。地址算术离开私有区后撤销资格，完整访问跨越边界时同样不转发。任意用户指针、设备和共享区的读取保持真实读取。未知指针写入、重叠窄写入、调用和未知效果使相关内存事实失效。地址和值分别跟踪；重定位来源分类不是互斥地址空间，分类不同且无法证明不重叠时保守失效。

小整数折叠的输入及结果限定在数据重定位下限以内，拒绝把需重定位的大立即数或算出来的大普通整数互相替换。`65536 * 64` 不能折成会被 PIE 装入器当成地址的 `4194304`。算术检查不依赖 `__int128`，也不执行 C++ 有符号溢出。

### 字符装箱与分配

基线的 `'A' + "b"` / `"a" + 'B'` 在 `boxChar` 中覆盖另一字符串操作数：右操作数 `r2` 被长度字常量 1 覆盖，或左操作数 `r1` 被字符码点覆盖，随后 `sconcat` 解引用错误地址。通用 `bump` 还在帧寻址覆盖 `r4` 后用它推进堆指针。

修复按左右操作数选择字符寄存器，长度字使用地址暂存寄存器；分配器以仍在 `r0` 的原堆指针推进，并保留私有写入/读取的失败顺序。没有额外占用寄存器或增加临时槽峰值。这是各优化级别共同的正确性修复；对应输入不承诺 O0 与旧编译器逐字节相同。UTF-8 字符、左右拼接和完整 `libmore` 示例参与回归，后者应返回 73。性能统计不把旧编译器未完成的故障执行当作有效基线。

## native 编码与覆盖报告

保持原有八个文本寄存器映射，`r11` 仍只用于绝对地址临时值。不分配 `rbx/rbp/r12..r15`，遵守现有 CallingConvention，无需调整保存/恢复协议。

立即数根据**位型**选择已登记的编码：

- `0..0xffffffff`：`B8+rd imm32`，按需带 REX.B，高 32 位清零。
- `0xffffffff80000000..0xffffffffffffffff`：`REX.W C7 /0 imm32`，符号扩展。
- 其余：原有 `REX.W B8+rd imm64`。

不以 `xor` 代替 `mov 0`，避免改变 flags。入口 rsp、每条 plan、绝对访问、相对跳转、call、导出和 debug 地址均使用真实长度，不假定 prologue 长十字节。

scaled 编码支持 disp8/disp32，已知零位移且基址允许时省略位移。AST 新增的大位移匹配只用于可证明对齐、无额外求值/溢出歧义的常量地址表达式；不明确的表达式沿用通用路径。已有的未知基址仍保留对齐检查。PIE/shared/import 以及无法整段 native 的程序保留通用访存；不把 scaled 中间指令泄漏给 ZPB1。

`-native-report 文件` 输出宿主 TSV 覆盖报告：选择限制、可编码行数、总行数、失败行下标/原因/指令。资格检查包括操作数、返回寄存器、比例/位移、目标范围和对齐；不只检查 mnemonic/元数。整段回退机制保留，禁止通过新增 opcode 或 native PIE 扩大覆盖。未登记 native 的 GPU 节点指令等仍需 ZAP，报告必须显示这些限制。

## 内联预算

既有单调用、不递归、无原样汇编的函数继续在调用点展开。O2 额外考虑小叶函数：没有调用/new/await/地址逃逸、循环/goto/标签/static，至多八条语句、64 个成本单位，调用点不超过 96。成本包括表达式节点、字符串长度和结构体字数，避免把巨型表达式或字符串当成一条廉价语句。

只对非 exported 函数扩展多调用内联。新增重复体按 `(调用点数 - 1) * 函数成本` 计费；每函数至多 128，整个单元预算为 `min(512, floor(原成本 / 5))`，不加一单位宽限。小于五单位的单元没有扩展预算。黄金检查覆盖成本 0..2600 的边界，真实编译/执行检查覆盖旧实现会膨胀 33.3% 的小单元和恰好消耗 20% 预算的正例。叶函数限制阻止级联复制。这个上限是编译器内部成本，不是对最终镜像字节增加比例的承诺；最终字节和各程序退化由 benchmark 单独报告。

## 测试与复现

先在仓库安装既有 Toolchain 依赖，使用 C++20 构建宿主编译器。基线编译器必须由固定提交、相同 Release 工具链生成，保持不可变。`node Compiler/ObrCompiler/tests/build-baseline.mjs` 从 Git archive 单独构建基线，拒绝覆盖已有输出；可用 `OBRC_CMAKE` 指向本机 CMake。测试不修改产品 CPU 或 NAS 源码。

```sh
cmake -S Compiler/BuildSystem -B Toolchain/CompilerBuild -DCMAKE_BUILD_TYPE=Release
cmake --build Toolchain/CompilerBuild --parallel 4
ctest --test-dir Toolchain/CompilerBuild --output-on-failure
OBRC_BASELINE=/absolute/path/to/baseline-obrc node Compiler/ObrCompiler/tests/check-compiler.mjs
node Compiler/ObrCompiler/tests/check-contracts.mjs
node Compiler/ObrCompiler/tests/check-integration-probe.mjs
OBRC_TEST_PASSES=dce,load-forward,fold,dce OBRC_CHECK_OUT=Toolchain/CompilerCheck/pass-order OBRC_BASELINE=/absolute/path/to/baseline-obrc node Compiler/ObrCompiler/tests/check-compiler.mjs
OBRC_BASELINE=/absolute/path/to/baseline-obrc node Compiler/ObrCompiler/tests/benchmark.mjs
node ZerOS-PRO/Hardware/Nas/Server/build-guest.mjs
node ZerOS-PRO/Hardware/Nas/Server/check.mjs
npm --prefix Toolchain test
npm --prefix Toolchain run build
```

执行器测试直接打包产品 `NativeRun`、`CoreDispatch`、`CpuRuntime` 与 `ProgramBinary`，使用真实 MessageChannel。测试内存稀疏分配，只有明确列出的设备应答；未支持的设备操作直接失败。native 代码装在数据窗口之外，避免测试器把代码与示例共享内存重叠。动态库与 PIE 通过原有 install/attach 装入另一颗独立模块状态的核心。

逻辑 ZAP 访存计数是测试 bundle 的只读观测钩子，覆盖成功的私有缓存和主板访存；产品源文件不变。主板物理请求、八位组数和 native 取指八位组单列，不能混成同一“访存次数”。native debug 地址逐个用产品解码器校验指令边界。返回值、共享内存、设备事件与错误结果参与差分，时间/计数不作为业务输出比较。

benchmark 先冻结两份编译器并记录 SHA256。真实语料 manifest 对应 build-guest 的 kernel/start、init、sh、session、idle、pulse 和全部 /bin。每个样本记录首次运行与随后 N 次独立进程编译时间、中位数、镜像格式/字节、最终指令数和 debug 大小。首次运行不等同清空操作系统磁盘缓存。完整浏览器启动和命令 smoke 另行记录，不能用微基准结果声称整机 FPS 或输入到显示延迟。

## 回退

任何定位先用 `-O0` 与单 pass 开关。O0 保留正确性修复；要逐字节复现旧缺陷，应使用从固定提交构建的基线编译器。产品构建路径不变，可用显式 `-O0` 编译器包装器重新生成固件和 NAS。回退不需要 CPU、loader、内核或镜像版本升级。临时编译产物在 `Toolchain/CompilerBuild/` 与 `Toolchain/CompilerCheck/`，不提交 NAS Root、Dist 或 node_modules。
