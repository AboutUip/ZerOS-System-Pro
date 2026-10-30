# ObrCompiler 优化与严格复核报告

2026-10-30，需求 v1.0。**当前提交作为 Draft PR：尚未满足全部 MUST，不能合并或标为严格验收完成。** 本轮新增的管道 native fault 是阻断项，测试 agent 继续定位。性能期望按需求第13节处理；没有新增格式、native PIE、opcode、布局或产品CPU/内核变更。

## 候选、基线与实现

源基线为 upstream main `7bf78874240d695ff384cbf75efc1a3198036677`，提交前重新fetch确认未变。基线Release编译器SHA为 `f4c5697da8ac93094f3176e8b7acbabfa68b683fd22b44df04bebc01a41dca3c`；最终候选为 `b0de7d58b86698b8afcef1c8b9fe9dc628d2b926ce5397251222cc8446a23efb`。源码HEAD与未提交C++补丁SHA、工具脚本SHA、全部输入与参数、每次时间和镜像SHA保存在 [benchmark.json](measurements/benchmark.json)。宿主哈希受构建环境影响，不承诺跨机器一致。

实现包括默认O1、O0回退、O2有界内联、结构化机器IR/CFG、独立可排序重复的forward/fold/load-forward/dce、私有槽转发、native紧凑立即数/disp32、覆盖诊断和DebugSite维护。内联预算严格为min(512,floor(cost/5))，修正小单元原先可增长33.3%的缺陷。最终前向流水线转移未改写Line的所有权，减少token/DebugSite深拷贝；没有因此改变发射语义。完整设计与表示阶段约束见 [Optimization.md](Optimization.md)。未实现完整前端SSA、全局寄存器分配或循环优化，不能把机器IR描述为这些工作已完成。

Apple M1 Pro/arm64，macOS26.1(25B78)/Darwin25.1.0，Node24.21.0，AppleClang17；Chrome实际运行版本155.0.8059.40。安装目录中的更新版本不作为运行版本。共59个真实输入：53个/bin入口与6个kernel/os程序，历史附件的54命令/旧字节数不作为本次基线。

## 最终静态、编译时间与内存

编译各记录一次首次进程、随后N5交错轮换运行，后五次中位数；首次进程未清空OS缓存。RSS通过额外的`time -l`进程采样，不混入墙钟计时；Darwin原始单位为字节，所有原始stderr均保留。

| 输入 | 基线 | O1 | O2 |
|---|---:|---:|---:|
| kernel/start 镜像字节 | 672,933 | 504,898 (-24.97%) | 500,745 (-25.59%) |
| kernel/start 编译ms | 2464.79 | 2534.63 (+2.83%) | 2545.68 (+3.28%) |
| kernel/start 峰值RSS MiB | 48.80 | 82.62 | 82.75 |
| os/sh 镜像字节 | 391,860 | 373,307 (-4.73%) | 370,920 (-5.34%) |
| os/sh 编译ms | 379.57 | 413.89 (+9.04%) | 414.76 (+9.27%) |
| os/sh 峰值RSS MiB | 22.84 | 50.33 | 53.02 |

两个指定大输入的最终O1/O2均在+10%门槛内；小输入不保证+10%，所有59项均披露在 [Tables.md](measurements/Tables.md)。58个真实ZPB1镜像中位变化O1 -5.31%、O2 -6.28%，未达到-20%的期望。真实非PIE仅kernel/start，native覆盖1/1；其余PIE保持ZPB1，不代表任意非PIE合法输入都能native。

之前候选b671的全59轮中，sh为+10.20%/+10.88%，该失败轮完整保留在 [benchmark-before-move.json](measurements/benchmark-before-move.json)。此前独立N5虽通过，也不能取代这一失败轮。移除冗余深拷贝后再跑完整59项，才得到上表最终值；宿主内存仍高于原编译器，作为代价披露。

## 动态计量与通过的检查

旧逻辑访存-9.55%漏掉私有缓存的ldi/sti，已经撤回。校准fixture的直接和间接私有访问均明确为1次load、1次store、返回42，物理请求另列。相同旧队列34对正常ZAP执行的修正访存中位-13.90%；扩展校准队列36对为-13.34%，步数-5.63%。两队列不混同，见 [logical-counter-cohorts.json](measurements/logical-counter-cohorts.json)。Native35对的步数中位-6.73%、数据八位组-8.63%；不是访存指令次数，不与ZAP单位混用。只比较双方同格式且正常halt的配对，不把修复旧故障的短路径当作性能收益。

- 默认差分480组合、323732断言、0失败；重排`dce,load-forward,fold,dce`480组合、324508断言、0失败。
- 契约221项通过；slot0..7、PIE/shared、attach/import/export、参数块、递归/ABI、shell editor、sandbox、CLI与debug等具名样本见原始记录。
- CMake/CTest3/3通过；`Toolchain npm test`、`npm run build`（含typecheck/lint）、build-guest、NAS check及diff检查通过。原有Vite大chunk提示仍存在。
- 独立agent重新构建、检查多行fault/source映射、40个alias/call/loop语义探针及内联预算/计数校准；最终move候选经静态move生命周期审查。59×O0/O1/O2的NAS binary/debug及9固件/3信号binary/debug共378项与真实浏览器被测文件逐字节相同，身份记录保留。身份相同也意味着管道fault尚未修复。

有限测试不等于对所有程序的完备证明。O0保留字符拼接等正确性修复，旧缺陷的逐字节基线须使用固定原编译器；差分框架的具名旧故障修复例外均保留。

## 真实Chrome与严格失败

独立校验器当前4040检查，**46项严格失败**；39/39命令变体有最新完整记录，36正常完成、3管道超时。失败分解为：26项原始NAS轨迹差异、18项管道超时导致的状态/输出/退出/轨迹失败、2项优化版新增public fault。不将这些改写成全绿。

26项NAS差异经manifest、实际SHA/长度、完整连续读取和分块/handle/close严格证明均为可执行装载，应用文件请求在这个明确诊断抽象后零差异。原始差异仍然存在；需求字面“NAS请求完全一致”的边界需维护者审阅，诊断不是豁免。真实退出码通过wait21的成功状态写回和pid回复关联；没有把halt时r0当成OS退出码。

`cat /boot/compiler-input | xargs echo`三种版本都超时。静态与raw指向基线管道EOF写端继承问题；**但O1/O2额外出现native instruction failed，baseline没有，属于未关闭的优化相关回归。** bundle栈已定位到NativeCore的stepNative结果fault分支，仍未确定触发的指令/优化pass。错误文本中的旧at=4/op=div可能来自残留格式化状态，不能当作精确kernel故障位置。测试agent继续追踪；合并前必须关闭。

额外`xargs echo < /boot/compiler-input`三版本均输出alpha beta。真实信号fixture三版本均输出signal-ok10/12/0，svc18/19回复按64位ABI核验，wait0。第一版max-long PID样本触发PIE装载错误，旧失败、原源码和manifest保留为测试诊断，不计成功。CPU/GPU真实鼠标切页及ArrowUp键盘切页的原始画布与isTrusted输入已经独立核对；不据此声称60FPS或物理输入延迟。

启动计时为单独稀疏观察器、真实Power至提示符present ACK的N5：首轮baseline9691.68ms，O19072.48ms(-6.39%)，O27525.49ms(-22.35%)。第二独立轮N5分别8728.56/8280.14/6765.18ms，另列，不合成N10；其中后台条件不同。两轮原始样本保留，镜像身份经验证可归到当前相同来宾产物；宿主编译时间不能借用旧候选数字。不是光子延迟或帧率。

public Faults为250ms轮询、数量变化时上报；barrier证明已上报事件的完整前缀，不能证明最后一瞬间重新读取了Faults。最终报告明确这个快照新鲜度限制。完整机制、复现和检查边界见 [Integration.md](Integration.md)。

## 仍阻断严格完成的事项

1. 关闭上述优化版管道native fault，并加真实回归；基线EOF问题不得靠修改范围外内核来掩盖。
2. 历史Starting根因仍未复现：20个可达历史提交没有启用后的失败版本；7bf只接通旧peel的kernel-only对照实际能启动。当前ret/halt/raw/alias等确有已修缺陷，但不能冒称历史唯一根因。
3. NAS原始请求的装载差异需要明确验收解释；没有维护者批准，不宣称满足其字面零差异。
4. 独立软件agent复核不能冒称维护者/第三方人类验收；合并前需要维护者复现。跨Windows/Linux和持续60FPS未验证，也不作为本报告已交付指标。

所有浏览器原始记录逐run gzip归档，包含历史失败、暂停和手动设备记录，不筛掉失败。`browser-records.mjs unpack`恢复后验证原始JSON逐字节SHA；相关manifest、观察器版本、校验结果与旧轮数据均保留。未提交NAS运行目录、Dist、宿主可执行文件或node_modules。回退用-O0或各feature flag；不新增协议/格式版本。

个人目的：在现有语言、ABI和协议边界内提供可回滚的编译优化与可复核证据，向上游提交明确披露阻断项的Draft PR，并继续定位真实系统回归。
