# 运行手册（当前实现）

> 这是 `Implementation/` 层：当前 runner 的操作说明，不是实验标准。
> 实验设计、重复和证据口径见 `../Standard/Experiments.md` 与 `../Standard/Evidence.md`。
> 文中的批次和命令是验证载荷，不是调试目标。

## 1. 前置

- 工作目录：仓库根目录（`ZerOS-System-Pro`）
- 首次准备：`Toolchain` 下 `npm install`；`Compiler/ObrCompiler/obrc(.exe)` 已存在（没有时按根 README 构建）
- 开关：`ZerOS-PRO/Hardware/Nas/Root/boot/debug` 为字节 `1`
- 预览：`http://localhost:5173/` 返回 `200`
- NAS：`http://127.0.0.1:8765/` 返回 `426`
- 工具链检查通过：`Toolchain` 下 `npm run check`
- 改了 `.obr` 或编译器库：先跑 `node ZerOS-PRO\Hardware\Nas\Server\build-guest.mjs`
- 需要 B2 源行映射时，显式跑 `node ZerOS-PRO\Hardware\Nas\Server\build-guest.mjs --debug-maps`；普通构建不会生成 `.debug`，并会删除旧的 `.debug`

`ztrace.mjs` 和普查 runner 的 preflight 都检查 5173/8765；前者还检查 `boot/debug` 字节。缺失时直接失败，不绕过。

## 2. 启动服务

Vite 和 NAS 都可能被系统回收。每次跑批次前先检查；失败时先启动，再重试。

```powershell
function Test-Http($url, $code) {
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    return ($r.StatusCode -eq $code)
  } catch {
    if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq $code) { return $true }
    return $false
  }
}

"vite=" + (Test-Http 'http://localhost:5173/' 200)
"nas=" + (Test-Http 'http://127.0.0.1:8765/' 426)
```

启动服务（两个终端）：

```powershell
# 终端 1
cd Toolchain
npm run dev

# 终端 2，仓库根目录
node ZerOS-PRO/Hardware/Nas/Server/serve.mjs
```

日志写到 `%TEMP%\opencode\vite-*.txt` 和 `nas-*.txt`。启动后等 HTTP 检查通过，不靠固定睡眠。

## 3. 跑一次采集

### 3.1 自包含 capture CLI

`Documents/Debug/Tools/ztrace.mjs` 是仓库内的宿主侧采集工具，只依赖 Node 22+ 自带的 `fetch` 和 `WebSocket`，不安装外部包。它以 `ZerOSDebug.trace.status().Prompts` 的增量为命令完成信号，不以固定睡眠判断结束。

前置与第 1 节相同，另外要求：

- Node 22 或更高；`fetch`、`WebSocket` 是全局对象
- 本机有 Chrome 或 Edge；也可用 `--chrome` 指定浏览器可执行文件
- headless Chrome 没有 WebGPU 适配器时会停在 `board`；用 `--chrome` 指定 Edge，或确认 SwiftShader 开关生效
- 工具在清空 trace 后等 800ms 再打字，避免抢在 shell 读循环就绪之前
- `ZerOS-PRO/Hardware/Nas/Root/boot/debug` 是单个字节 `01`；工具只读检查，不打开、不改写
- 预览 `http://localhost:5173/` 返回 `200`，NAS `http://127.0.0.1:8765/` 返回 `426`

只抓启动报告：

```powershell
node Documents\Debug\Tools\ztrace.mjs --out dev\Debug\ztrace-boot
```

抓一条命令：

```powershell
node Documents\Debug\Tools\ztrace.mjs --command "seq 1 5" --out dev\Debug\ztrace-test --key-delay 200 --timeout 60000
```

抓多条命令：

```powershell
node Documents\Debug\Tools\ztrace.mjs --command "id" --command "pwd" --out dev\Debug\ztrace-basic
```

超时后继续下一条（后续样本可能受未完成命令影响）：

```powershell
node Documents\Debug\Tools\ztrace.mjs --command "sleep 10" --command "pwd" --timeout 5000 --keep-going
```

| 选项 | 默认 | 说明 |
|------|------|------|
| `--command <text>` | 无 | 要输入的命令，可重复；省略时只抓启动报告 |
| `--out <dir>` | `./ztrace-out` | 输出目录，相对当前工作目录 |
| `--timeout <ms>` | `120000` | 每条命令的硬超时；包含输入、等提示符和采集 |
| `--key-delay <ms>` | `500` | 每个字符的按键间隔 |
| `--url <url>` | `http://localhost:5173/` | 预览地址 |
| `--chrome <path>` | 自动查找 | Chrome/Edge 可执行文件 |
| `--keep-going` | 关闭 | 命令超时或出错后继续；默认中止 |

退出码：`0` 成功；`1` 采集或命令失败；`2` preflight 失败。命令失败时即使加了 `--keep-going`，最终仍返回 `1`。preflight 失败时保留 `capture.log`，不写 `capture.json`，也不改 `boot/debug`。

连接后先等 `__zerosBoot` 出现 `term-up`、`ZerOSDebug` 可用，再等壳的第一条提示符（`status().Prompts > 0`）。这条前置等待避免把启动期提示符误当成第一条命令的完成信号。

每条命令执行前调用 `trace.clear()`，记录基线 `Prompts`，按 `--key-delay` 发送按键并回车，然后轮询 `status()`，直到 `Prompts` 大于基线。超时把 `error` 写进命令对象；默认中止，`--keep-going` 时继续。

输入只支持可打印 ASCII。遇到未映射字符会直接报错，不做隐藏的文本插入。

### 3.2 本地普查 runner

`survey-a0.mjs` 是本地工具，`dev/` 不进入 Git；它不是仓库交付物，也不被 `ztrace.mjs` 依赖。

```powershell
node dev\Debug\tools\survey-a0.mjs 6
```

批次定义在 runner 文件内。当前常用：

| 批次 | 内容 | 用途 |
|------|------|------|
| 6 | `sleep 1 → id → pwd` | 最小功能与树结构 |
| 8 | 10 次 `seq 1 5` | 滚屏/写路径回归 |
| 9 | `clear` + `seq` 交替 | 区分滚屏与单次写 |
| 10 | 文件重定向 + `cat` + 管道 | 长命令记录量和环容量验证 |

输出：

- `dev/Debug/batch-N.json`
- `dev/Debug/batch-N.md`
- `dev/Debug/run-batch-N.log`（实时进度）

runner 以提示符事件为完成信号，不用固定等待时间判断命令结束。每条命令有硬超时；超时即中止并保留日志。

## 4. 读一次结果

### 4.1 ztrace 采集

- `capture.log`：带时间戳的进度，包含 preflight、浏览器、启动、每条命令和清理。
- `capture.json`：`schema` 为 `zeros.ztrace.capture/1`；含 `url`、`startedAt`、`debug`、`git`、`environment`、`sourceMaps`、`boot`、`commands`、`log`。`boot` 和每条命令都含 `status`、`report`、`entries`、`faults`；`boot.entries` 是启动期原始记录，`faults` 是 `ZerOSDebug.faults()` 的结构化快照。
- `report.txt`：启动报告和每条命令报告的文本拼接。
- `capture.json` 可用仓库内校验器检查结构：

```powershell
node Documents\Debug\Tools\ztrace-check.mjs --file dev\Debug\ztrace-check\capture.json
```

校验器只检查 schema/字段类型/每条命令的 status/report/entries/faults，不解释 trace 语义。

`faults` 是 `ZerOSDebug.faults()` 保留的故障历史，不保证只属于当前命令；启动自检留下的故障也会出现在 `boot.faults`。看 `Core/Index/Op/Stack/Window`，不要只看数量。

命令报告里的 `task waits`、`task sleeps`、`input spans` 分别对应进程等待、调度睡眠、页面按键到客侧 key ring。`input spans` 使用 ZKP1 第 7 字唯一关联号，`Input.A0` 与 `KeyConsumed.A0` 应逐条相等；`pointer spans` 只在 BIOS 设置页消费指针时出现。

`Keys.obr` 在写 key ring 次数前写 6592。没有这次写，槽数据和次数可能乱序可见，终端收不到按键；排查“输入没反应”时先确认构建包含这次写，并且没有写到 7296 或 7360。固件扫描键盘口按 `ZKP1` 匹配；设备也用 `ZKP1`。键盘线格式以 `Documents/Protocol/PhysicalHardware/Keyboard/ZKP1.md` 为准。

每条成功命令的对象含 `command`、`elapsedMs`、`status`、`report`、`entries`。`entries` 是 `trace.dump()` 的原始记录数组；`status` 是采集结束时的 `Records/Pending/Dropped/Prompts`。失败命令另有 `error`，此时 `report` 为空、`entries` 为空，`status` 是最后一次成功读到的值或 `null`。

`capture.log` 不写 `report` 正文，也不写 `entries` 明细；大对象只进 `capture.json`。

### 4.2 本地普查批次

先看 `run-batch-N.log` 的每条命令：

```text
records=  dropped=  pending=  prompts=
total=... top=...
```

再看 `batch-N.md` 的树：

1. `command` 总时长。
2. `svc` 的 `queue` 和执行时长。
3. 子 span：`install`、`port`、`gpu.present`。
4. `memory batches` 全局计数。
5. `core stops` 和 `dropped`。

`pending` 为 1 通常表示提示符 svc 的回复尚未写回；不要仅凭 `pending` 判定命令未完成。

`source maps` 是异步加载的，而且表是**可选调试工件**：

- `source maps: core 2, core 6`：两份对照表已可用。
- `source maps: not started/loading`：普通构建没有生成 `.debug`，或页面还没读完。需要源行时用 `--debug-maps` 重编，再重载。
- `.debug` 必须和当前客映像同一次构建；旧表比没有表更危险，会给出错误源行。
- core 7 的外部命令没有 `.debug` 表，会显示 `#地址`，这是预期。

## 5. 开关关闭测试

只在确认不影响当前会话时做：

1. 把 `boot/debug` 写成字节 `0`。
2. 重新加载页面。
3. 确认调试入口被摘掉，执行一条简单命令。
4. 恢复字节 `1`，重新加载。

关闭状态下不应出现新的 trace 页、记录或时钟读取。若仍能看到 `ZerOSDebug.trace`，说明开关落点没有生效，先修开关，不继续测性能。

## 6. 失败处理

| 现象 | 处理 |
|------|------|
| preflight 失败 | 启动 5173/8765，重新检查；不改 runner 绕过 |
| `ztrace` 报 debug 开关不是单个 `0x01` 字节 | 按提示把 `boot/debug` 写成字节 `01`，重载预览；不要改成让工具自动打开 |
| `ztrace` 等 `term-up` 或 `ZerOSDebug` 超时 | 看 `capture.log`；确认开关是字节 `01`、预览已重载、页面没有断 |
| `ztrace` 报没有按键映射 | 命令含非可打印 ASCII；换命令，不要改成隐藏插入 |
| `ztrace` 找不到浏览器 | 安装 Chrome/Edge，或用 `--chrome` 指定可执行文件 |
| 提示符超时 | 看 `run-batch-N.log` 最后一条；看 `records`/`pending`；不要先加大超时 |
| `dropped > 0` | 样本不完整；减少命令数或缩短单条命令，再跑 |
| `check` 失败 | 先修类型/lint，不跑批次 |
| 树里出现 `other spans` | 正常。没有父的 span 不强行归档；先确认它是否在命令窗口内 |
| `queue` 很高 | 先查监督核调度，不要先改服务实现 |
| 子 span 合计远小于父 | 父里仍有未记账执行段；写「未定位」，不要编原因 |

## 7. 回归

修复后：

1. 同一批次、同一命令、同一节流重跑。
2. 记录修复前后范围，不只记录最好的一次；`time=` 至少 3 次才用于排序。
3. 单次 `time=` 只作线索；批次间差异大于差值时，判定为「无可辨识收益」。
3. `npm run check`、`npm test` 通过。
4. 改了 `.obr` 要重编客映像。
5. 原始输出留在 `--out` 目录，不写入 `Documents/Debug`。

## 8. 禁止

- 无人值守长时间跑批次。必须有日志、硬超时和明确的结束条件。
- 用单次最快值证明优化。
- 为了让报告好看而改 runner 的完成信号或超时。
- 在开关关闭时继续读旧 trace 页并当作当前样本。
