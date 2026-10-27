# ZerOS Installer ISO

把 Debian netinst 改造成自动安装盘：

- 自动分区、安装 Debian 13；
- 在目标系统里从源码构建 `obrc`；
- 构建 `Toolchain/Dist`、Boot 固件、内核、`/os`、`/bin`；
- 安装 Chromium、Xorg、LightDM、Mesa lavapipe、nginx、open-vm-tools；
- 配置 kiosk、NAS、Web、Chromium 策略、GRUB；
- 成功后自动关机。

ISO 是安装介质，不是 live 系统。安装完成后从硬盘启动，所有数据落在 ext4。

## 三个变体

| 变体 | 构建脚本 | 宿主机预构建 | 目标机安装阶段 | 产物 |
|---|---|---|---|---|
| **快速包** | `./build-fast-iso.sh` | `obrc`、`Dist`、`Nas/Root` | 只装 Debian 依赖、Node、nginx；解压预构建 payload；不编译 ZerOS | `out/zeros-fast-amd64.iso` |
| **标准版** | `./build-iso.sh` | 无 | 从源码包构建全部 | `out/zeros-standard-amd64.iso` |
| **轻量版** | `./build-lite-iso.sh` | 无 | 装 git、clone 仓库、应用小型 overlay、再走标准构建 | `out/zeros-lite-amd64.iso` |

快速包用 nginx 服务宿主机预构建的 `Dist`；Vite 只在宿主机做构建，不在目标机运行 dev server。  
轻量版默认从 `https://github.com/AboutUip/ZerOS-System-Pro.git` 的 `main` 拉取；尚未进 git 的构建文件由 `work/lite/zeros/lite-overlay.tar.gz` 补齐。仓库推完整后，overlay 可以缩小甚至去掉。

## 构建

在 Linux/WSL 里：

```bash
sudo apt-get install -y --no-install-recommends xorriso curl openssl
./build-iso.sh
```

脚本会：

- 从清华镜像下载 Debian 13 netinst；失败时依次尝试 `cdimage.debian.org`、`deb.debian.org`；
- 用 `SHA256SUMS` 校验 netinst；已有文件校验失败会删除重下；
- 把仓库源码（不含构建产物、`node_modules`、`Nas/Root`）打成 `work/zeros/src.tar.gz`；
- 检查源包必须包含目标安装脚本、编译器构建脚本、`build-guest.mjs`、`/bin/pwd`、字体、`package-lock.json` 等；
- 检查源包没有混入 `node_modules`、`Dist`、`Nas/Root`、构建目录；
- 写入 `preseed.cfg`，替换密码占位符，并检查目标脚本路径；
- 修改 isolinux 和 GRUB 菜单，默认 5 秒进入自动安装；
- 用 `xorriso` 重制 ISO；`replay` 失败或启动目录不完整时，自动改用 `-boot_image any keep`；
- 校验 BIOS + UEFI 启动目录、注入的 preseed、启动配置和源包；
- 输出 `out/zeros-install-amd64.iso` 和 `.sha256`。

产物：

```text
out/zeros-standard-amd64.iso
```

## 安装时的理想行为

1. ISO 启动，5 秒后自动进入安装。
2. 自动使用 DHCP（VMware NAT 即可，不需要密码）。
3. 自动选择第一块磁盘（`list-devices disk`，找不到时退回 `/dev/sda`），分区、安装 Debian 基础系统。
4. 在目标系统里执行 `Compiler/BuildSystem/Installer/target-install.sh`：
   - 安装构建工具和运行时；apt 失败会先重试，再自动把清华源切到 `deb.debian.org`；
   - `Compiler/BuildSystem/build.sh` 构建 `obrc`；测试失败会退回 `--no-test` 只构建；
   - `npm ci` 失败会退回 `npm install`；
   - `npm run build` 失败会退回 `node_modules/.bin/vite build`（跳过 typecheck/lint）；
   - `build-guest.mjs` 带重试，构建内核和用户态；
   - 安装并启用 kiosk 服务。
5. 校验 `/opt/zeros/web/index.html`、`/opt/zeros/nas/Root/kernel/start`、`obrc`。
6. 成功则自动关机。

失败时安装器会停在最后阶段并保留日志，不会自动进入一个半成品系统。

## 测试虚拟机

| 项目 | 建议 |
|---|---|
| 固件 | BIOS（ISO 也支持 UEFI） |
| 磁盘 | 40GB，精简置备 |
| 磁盘控制器 | **LSI Logic SAS 或 SATA** 最稳；安装器会自动识别第一块磁盘，NVMe 也可尝试 |
| 网络 | NAT，启动时连接 |
| 3D 加速 | 关闭，WebGPU 用 lavapipe |
| 内存 | 安装阶段 8GB 更稳 |
| CPU | 4–8 vCPU |

安装完成后：

1. 断开/弹出 ISO；
2. 硬盘设为第一启动项；
3. 开机。

## 开机自检与第二条路线

安装完成后，LightDM 之前会运行 `zeros-selfcheck.service`：

- 检查 `/opt/zeros/web/index.html`、`/opt/zeros/nas/Root/kernel/start`、`obrc`；
- 检查 `nginx -t`、`127.0.0.1:8080`、`127.0.0.1:8765`；
- 用 `vulkaninfo` 检查 lavapipe；
- 写 `/var/log/zeros-selfcheck.log`。

失败处理：

- 关键文件或 Web/NAS 端口失败：写 `/run/zeros/selfcheck.fail`，kiosk 改用本地 `file:///opt/zeros/fallback.html` 诊断页；
- lavapipe 不可用：写 `/run/zeros/no-lavapipe`，Chromium 会话自动改用 SwiftShader 作为第二条 WebGPU 路线；
- 自检本身不会阻止 LightDM，方便通过 GRUB 恢复模式排查。

## 日志

- 安装器控制台；
- 目标系统 `/var/log/zeros-build.log`；
- 开机自检 `/var/log/zeros-selfcheck.log`；
- `vulkaninfo` 输出 `/var/log/zeros-vulkan.log`；
- 安装器在构建失败时会 `sleep 600`，留时间查看日志。

## 已知限制

- 快速包不在目标机运行 Vite；Vite 只在宿主机构建 `Dist`，目标机用 nginx 服务它。预编译 payload 与宿主机当前源码绑定，源码变了要重打快速包。
- 轻量版默认从 GitHub `main` 拉取，加上 `Compiler/BuildSystem`、`Installer`、`Resource/Bin`、`build-guest.mjs` 的小 overlay。当前仓库里未提交的 shell/kernel/CpuRuntime 改动不在 git 中，轻量版不会包含；要完全一致，先 commit/push，或扩大 overlay。
- 轻量版需要能访问 GitHub；不能访问时改 `lite-bootstrap.sh` 的 `GIT_URL`/`GIT_REF`，或先在镜像里放替代源。
- 分区默认自动选第一块磁盘；多磁盘机器仍建议先用 LSI/SATA 单盘验证。
- Debian 镜像默认清华 `tuna`；apt 失败会切到 `deb.debian.org`，netinst 下载失败会尝试官方 CDN。
- 目前 GRUB 保留 3 秒菜单，方便维护/测试；还没有加 GRUB 密码。
- 安装脚本只做 `vulkaninfo` 校验；真正的 WebGPU adapter 和页面要等 kiosk 启动后确认。
- `F12` 进虚拟 BIOS 可能被 Chromium 截获，还没做透传。
- kiosk 内没有 getty/ssh/sudo；维护入口是 GRUB 的恢复模式。
- 没有 overlay、没有重启还原；重装 ISO 才会清空磁盘。
