# 需求 v1.0 验证矩阵

当前作为 Draft PR，尚未满足全部 Definition of Done。最终候选为 `b0de7d58b86698b8afcef1c8b9fe9dc628d2b926ce5397251222cc8446a23efb`。真实管道路径发现 O1/O2 新增 native fault，历史 Starting 根因仍未闭环；不能将有限通过解读为全部 MUST 已验收。

实现基线、测量方法、未达项及风险见 [Benchmark.md](Benchmark.md)；实现边界见 [Optimization.md](Optimization.md)。以下“通过”仅覆盖明确列出的检查，不是对任意程序正确性的数学证明。性能期望按需求第 13 节的回答处理；未新增镜像、native PIE、协议或运行时变更。

| 条目 | 本地状态 | 证据/边界 |
|---|---|---|
| R-COMP-01 | 阻断 | 480组合有限差分通过；Chrome39正式例中36正常、3管道超时，O1/O2还新增public native fault。26项原始NAS差异诊断为可执行装载，应用I/O零差异，但不豁免原始差异 |
| R-COMP-02 | 通过 | contracts：slot 0..7、PIE/shared/debug/zap/I/o；拒绝非法组合，默认不写 zap |
| R-COMP-03/04 | 通过 | 直接使用未修改的产品 loader/CPU；格式和重定位契约不变；NativeOpcodeRegistry 检查及真实解码 |
| R-COMP-05 | 通过所列用例 | #LINK/@Callfun 拒绝检查，#DYN/import/export，真实 loadlib/attach/PIE install，core 1/4 参数块 |
| R-COMP-06 | 通过 | 所有 bad-*，baseline/O0/O1/O2 两种模式均拒绝，诊断逐字相同 |
| R-COMP-07 | 同平台通过，跨平台未测 | O1 重编/开关 debug 的二进制逐字节检查；未在 Windows/Linux 编译执行 |
| R-COMPACT-01 | 有收益，未达期望 | 58 个真实 ZPB1 中位数 O1 -5.31%、O2 -6.28%，期望 -20% |
| R-COMPACT-02 | 通过真实 native 语料 | kernel/start O1 -24.97%、O2 -25.59%，本次真实分母为 1 |
| R-COMPACT-03 | 已修正并独立复测 | 小叶函数成本、每函数 128、单元 min(512,floor(cost/5))；删除原先 +1 宽限，防止小单元增长 33.3%；221 契约及独立执行检查；不承诺二进制字节单调 |
| R-COMPACT-04 | 已实现保守子集 | 私有槽转发、常量/复制传播、CFG DCE；无全局帧消除 |
| R-COMPACT-05 | 未采用 | 未批准新格式/压缩，保留现有编码 |
| R-PERF-01/02 | 有收益，计数已校准 | 旧 -9.55% 漏计私有 ldi/sti，已撤回。旧队列34对执行、32对有效访存比例，中位 -13.90%；扩展队列36对执行、34对有效访存比例，中位 -13.34%，36对步数中位 -5.63%；基线零访存的比例未定义，不纳入访存比例中位数。两队列分别披露，真实命令子进程计数待汇总 |
| R-PERF-03 | 最终全59项N5中指定大输入通过 | kernel/start O1 +2.83% / O2 +3.28%；os/sh +9.04% / +9.27%；完整RSS与小输入披露。上一候选sh +10.20%/+10.88%的失败轮保留 |
| R-PERF-04 | 示例可测，真实热路径待扩展 | 算术/循环/字符串/集合与 Logo 参数轨迹；NAS/UI 完整性能尚未定量 |
| R-PERF-05 | 检查通过 | 受检算术避免 C++ UB；对齐失败、别名、重定位、opcode 边界样本；不分配未授权寄存器 |
| R-IR-01 | 部分实现 | 共用结构化机器 IR + CFG + liveness；没有前端 typed SSA/全局寄存器分配 |
| R-IR-02/03 | 已实现并测试 | forward/fold/load-forward/dce 有类型注册表，独立开关、排序、重复最多八次；AST内联/lowering/最终编码有表示阶段约束，feature flags独立；PeepholeCheck、native-encode-check、221 contracts |
| R-IR-04 | 检查通过 | DebugSite 随删除/改写同步；全部行源范围和 native 解码边界、故障 fixture 实际语句 |
| R-IR-05 | 已实现 | O0 关新优化；正确性修复保留，旧缺陷逐字节基线使用 Git archive 编译器 |
| R-PEEL-01 | 部分完成，历史根因未闭环 | 当前 halt/ret/raw/数字目标/别名等缺陷有回归。7bf接通旧窥孔的 kernel-only 对照实际能启动。全部20个可达历史提交中没有历史启用失败版本，109bc7c首次加入窥孔时已关闭；不能声称确认历史 Starting 根因 |
| R-PEEL-02 | 通过 | 黄金源映射、差分 debug 行、故障位置、native 边界 |
| R-PEEL-03 | 保守子集 | 前向传播、私有读转发、DCE、小立即数/位移；未做通用 store 删除和激进分支/别名折叠 |
| R-PEEL-04 | 已实现 | 每行一次解析和共享操作数、效果缓存；保留文本发射接口，边界见设计 |
| R-NATIVE-01 | 真实非 PIE 语料 1/1 | kernel/start；所有 PIE 仍 ZPB1；任意非 PIE 程序不保证 native |
| R-NATIVE-02/03 | 已实现并测试 | imm32 零扩展、C7 符号扩展、movabs，disp8/disp32/零位移；计划、跳转、debug 长度同步 |
| R-NATIVE-04 | 评估后保留现约定 | CallingConvention 禁止分配 callee-saved；保持八文本寄存器和 r11 临时值，验证未破坏保存寄存器 |
| R-NATIVE-05/06 | 通过 | 已登记 opcode；native-report 输出资格限制、失败行/原因；全段回退 |
| R-NATIVE-07 | 明确不支持 | native PIE/shared/动态重定位未获批准 |
| R-STRUCT-01 | 部分实现 | AST → 文本发射 → 一次解析机器 IR → 优化 → 原写入器；非完整前端 typed IR |
| R-STRUCT-02 | 所测路径通过 | main/import/runtime、collect/font/UI、Logo、完整生产启动；额外修复字符拼接；未知 effects 保守 |
| R-STRUCT-03 | 沿用已有模块 | kSp/kFrame/kStack/kHeap 等仍从 Layout.hpp 使用；未调整布局常量或重设计帧 |
| R-STRUCT-04 | 通过范围检查 | 语言表面/协议/产品 CPU/内核未变；优化参数只属宿主工具 |
| R-BENCH-01/02 | 脚本和数据交付，明确边界 | examples/fixtures动态 +59真实NAS N5；字节/格式/发射行/debug/RSS/编译计时及Chrome启动N5。真实命令核心区间未证明capture/restore隔离 |
| R-BENCH-03 | 有限差分通过，真实回归阻断 | 默认480/323732/0，重排480/324508/0；Chrome4040检查/46严格失败，全部披露，不把采集完成当差分通过 |
| R-BENCH-04 | 宿主和Chrome各N5，限定定义 | Chrome155；两轮N5分别报告，不混N10；VM重建与HTTP no-store，未清OS缓存；Power至提示符present ACK，不是光子延迟 |
| R-BENCH-05 | 已提交 Draft PR | scripts、measurements JSON 和全部逐程序表已提交至 [PR #2](https://github.com/AboutUip/ZerOS-System-Pro/pull/2)；仍有合并阻断项，未标记为完成验收 |
| R-DOC-01..04 | 已交付 | README、语言 skill、设计、基准、验证矩阵；未把参考观测写成协议常量 |

键盘、鼠标、显示、NAS与sandbox有具名smoke；设备原图和可信事件已独立检查，不代表持续60FPS。跨版本、多宿主与维护者验收未完成。public Faults只保证最后观察快照，不证明barrier终点新鲜度。新增native fault阻断合并，历史Starting限制和指标边界见Benchmark。

2026-10-31 [归档复核](measurements/archive-reverification-20261031.json)：从已提交的 v5/v3 逐 run gzip 归档恢复全部原始 JSON，原文件 SHA256 均一致；独立校验再次得到 4040 项检查、46 项失败，失败详情与已提交报告逐项一致。这是对既有采集结果的可复核性检查，没有新增浏览器运行样本，也没有关闭上述阻断项。
