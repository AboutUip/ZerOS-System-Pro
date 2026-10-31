# 真实浏览器差分与独立校验

这套测试构建隔离的 NAS、固件和前端包，使用仓库原有 CPU、GPU、内核、loader 与 NAS 服务。`IntegrationProbe.mjs` 仅在测试打包时加入观察点；不改产品 TypeScript、Obr 内核、协议或来宾镜像。生产 `vite build` 不加载该插件。

## 复现

先按 [Optimization.md](Optimization.md) 构建 Release 编译器及固定提交的基线，再在仓库根目录执行：

```sh
OBRC_BASELINE=Toolchain/CompilerCheck/baseline-built/obrc \
OBRC_INTEGRATION_OUT=Toolchain/CompilerCheck/integration-strict \
node Compiler/ObrCompiler/tests/build-integration.mjs

OBRC_BASELINE=Toolchain/CompilerCheck/baseline-built/obrc \
OBRC_INTEGRATION_OUT=Toolchain/CompilerCheck/integration-strict \
node Compiler/ObrCompiler/tests/build-signal-smoke.mjs

OBRC_INTEGRATION_OUT=Toolchain/CompilerCheck/integration-strict \
node Compiler/ObrCompiler/tests/serve-integration.mjs
```

在 Chrome 打开 `http://127.0.0.1:5290/`，依次运行真实命令、xargs 输入重定向、真实信号 ABI。NAS 使用本机端口 8765，不能同时运行另一个占用该端口的预览。每例清空专用测试输出文件、重建 VM，使用同一份 `alpha\nbeta\n` 输入；不覆盖产品 `Nas/Root`。脚本快照被测可执行文件和镜像 SHA。输入通过产品键盘发布路径送入；命令采集本身不等于校验通过。

计时按钮单独运行 baseline/O1/O2 各五次，交错并轮换顺序。计时定义为真实 `Board.Power()` 到包含提示符的 `nativePresent` 完成通知。它不是物理屏幕扫描延迟、帧率或鼠标输入到发光时间。每例重新创建 VM、HTTP 禁用缓存；不清空 OS 文件缓存。计时构建不发送详细 syscall/访存事件，避免把完整日志开销混入启动测量。

## 离线复核已提交的原始记录

以下 v5/v3 是 `7bf7887` 产品源码及候选 `b0de7d58…` 的历史流程，必须在该检查点对应的独立源码树重建；当前 `28ae11e` 与新编译器的产物不能用来代替。原始记录恢复和 SHA 校验可直接进行，实际镜像一致性检查则会拒绝跨候选替换。最新检查点的输入与产物身份另见后续报告。

`browser-records.mjs unpack` 仅恢复并验证原始 JSON；完整独立校验还会读取实际 NAS/固件/信号镜像，不能只放 manifest 冒充镜像存在。先完成上面的两个构建脚本，无需启动服务；然后在仓库根目录执行以下准备步骤。`OBRC_ARCHIVE_IMAGE_ROOT` 指向刚构建的隔离产物目录；归档中的旧 manifest 保留不变，校验器会将重建镜像的实际 SHA 与两个历史版本分别核对。若工具链变化导致字节不一致，应保留失败，不能替换归档 manifest。

```sh
OBRC_ARCHIVE_IMAGE_ROOT=Toolchain/CompilerCheck/integration-strict python3 - <<'PY'
import os, pathlib, shutil
images = pathlib.Path(os.environ['OBRC_ARCHIVE_IMAGE_ROOT'])
saved = pathlib.Path('Compiler/ObrCompiler/docs/measurements')
review = pathlib.Path('Toolchain/CompilerCheck/archive-review')
review.mkdir(parents=True, exist_ok=False)
for version in ('v3', 'v5'):
    dest, original = review / version, saved / ('browser-' + version)
    for variant in ('baseline', 'O1', 'O2'):
        target = dest / variant
        target.mkdir(parents=True)
        for folder in ('NasRoot', 'firmware'):
            shutil.copytree(images / variant / folder, target / folder)
        shutil.copy2(original / variant / 'manifest.json', target / 'manifest.json')
for name in ('known-incomplete-runs.json', 'documented-historical-runs.json'):
    shutil.copy2(saved / 'browser-v5' / name, review / 'v5' / name)
signal = review / 'v5' / 'signal-build'
signal.mkdir()
shutil.copy2(saved / 'browser-v5/signal-build/manifest.json', signal / 'manifest.json')
shutil.copytree(images / 'signal-build/source', signal / 'source')
PY

node Compiler/ObrCompiler/tests/browser-records.mjs unpack \
  Compiler/ObrCompiler/docs/measurements/browser-v5/index.json \
  Toolchain/CompilerCheck/archive-review/v5/browser-results.json
node Compiler/ObrCompiler/tests/browser-records.mjs unpack \
  Compiler/ObrCompiler/docs/measurements/browser-v3/index.json \
  Toolchain/CompilerCheck/archive-review/v3/browser-results.json
node Compiler/ObrCompiler/tests/verify-browser-results.mjs \
  Toolchain/CompilerCheck/archive-review/v5/browser-results.json \
  Toolchain/CompilerCheck/archive-review/report.json \
  Toolchain/CompilerCheck/archive-review/v3/browser-results.json --historical-public-faults
```

准备目录必须是新目录，避免混入上次复核文件；重复复核应选新目录。已记录的结果是 **4040 检查、46 失败、退出码 1**，不是预期全绿。该流程重查原始采集证据，没有运行新的浏览器样本。v5/v3 原始 SHA、完整性与失败详情复核见 [archive-reverification-20261031.json](measurements/archive-reverification-20261031.json)。

## 采集完整性与可观察结果

完整功能采集要求页面、主板、内存、CPU 和八个核心共十二个 producer。每个 producer 带独立序号，barrier 发出时插入原始 watermark，等截止序号前的 HTTP 批次全部确认后才 ACK。独立校验器重新检查 producer 集合、原始事件无缺号/重复、watermark 与 ACK 的精确对应；不是仅相信页面上的“完成”。

当前功能轮在页面处理 barrier 时，重新调用公开 `Faults()` / `LastFault()`，紧接着记录该 producer 的 watermark。校验器默认强制验证这份全量快照、token、来源及截止序号；结果 JSON 缺失或关闭 `faultsAtBarrierRequired` 字段不能豁免。`node Compiler/ObrCompiler/tests/check-public-fault-barrier.mjs` 覆盖迟到故障、重复 barrier、getter 失败、错误截止点及自报标志绕过的负例。它不读取指令内存，不证明各个 worker 全局同时静止，也不保证该公开采样点之后不会新增故障。

只有复核 v5 等旧归档时才显式使用 `--historical-public-faults`；报告会标明仅支持旧轮最后已观察快照，不能用该模式证明当前候选的新鲜度。上面的 4040/46 是原校验器历史结果，新校验器额外字段和检查应另存为新报告。

校验内容包括真实绘制文本、独立 fixture golden、文件副作用、原始 NAS 请求、syscall、fault、实际 OS wait 状态以及原始 PNG。PNG 被独立解码成像素，只排除最终提示符后的一个 8×16 闪烁光标格；完整原始 PNG 一并保留。

退出状态由真实 `wait21 → 监督核成功写入 parentHome+192 → positive pid reply` 关联，保留实际写入 token。`halt` 的 r0 只作为返回寄存器快照，不能当作 OS 退出码。信号 fixture 通过现有 svc18/19 验证送达、去重、顺序、无效信号和不存在 PID，并检查实际 wait 状态。回复必须先验证 64 位范围，再按现有寄存器 ABI 解释有符号值。

NAS 原始差异始终保留。镜像变小必然可能改变 loader 的读长度/分块；诊断分类器只在 manifest、实际文件 SHA/长度、连续全文件覆盖、标准分块和 close/handle 都吻合时，将该事务标为可执行文件装载。应用文件 I/O 不接受这种抽象。这个诊断不等于原文“原始 NAS 请求逐字段一致”已经满足。

`report-browser-counts.mjs` 可以导出装入至 svc28/halt 的核心区间计数。v5 未观察 capture/restore，因此不能据此证明这些区间仅包含一个进程，也不能与隔离微基准混合成统一的动态性能数字。

## 设备与失败记录

BIOS 设备模式使用合成 F12 作为进入设置的测试准备，后续截图仅记录 `isTrusted` 的真实鼠标/键盘事件。功能证据是点击 CPU/GPU 后内容改变，以及方向键切页；不把静态截图当作 60 FPS 验收。手动停止或用户暂停的用例单列为 incomplete，不能算编译器故障，也不算完整功能采集通过。

当前基线的 `cat /boot/compiler-input | xargs echo` 及两个优化版本均超时；O1/O2额外出现监督核native instruction failed，是未关闭的优化相关回归，不能全部归为基线EOF问题。原始失败不删除；`xargs echo < /boot/compiler-input` 是额外的成功覆盖，不能把它写成原管道已经修复。信号第一版样本用最大 long 作为缺失 PID，被现有 PIE 规则重定位后装载失败；修正为下限以内的 `999999` 后重跑，旧失败与旧源码/manifest 仍留作测试环境诊断。

`build-legacy-peel.mjs` 从固定原始提交构建只接通旧 peel 的对照编译器。kernel-only 对照可以启动，不能声称它复现了历史 `Starting` 故障。固件分项对照属于故障定位实验，与正式候选的功能矩阵分开记录。

完整结果、独立复核的范围与尚未关闭的需求见 [Benchmark.md](Benchmark.md) 和 [Requirements.md](Requirements.md)。个人目的：提供可核查、可重跑的编译器优化证据，保留失败与计量边界，便于维护者审阅。
