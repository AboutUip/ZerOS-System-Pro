# 如何替换内存实现（无需改 Boot 源码）

1. 准备你的实现包，使其导出 **`ZerOS.Machine.Memory.ActiveMemoryProvider`**（见 `Provider.ts`），并满足 ZVHP1 + ZMP1。
2. **整体替换**本目录 `ActiveProvider/`（保留 `Provider.ts` 文件名与导出名，或按 `ProviderManifest.json`）。
3. 重新构建 / 刷新页面即可；**不要**改 `Boot/Boot.ts`。

默认内容转发仓库内 `ReferenceMemoryProvider`。
