/**
 * ZerOS-PRO 工具链 · Vite 配置
 *
 * 职责：仅服务编译 / 开发服 / 产物输出。
 * 产品源码在 ../ZerOS-PRO，禁止把依赖与 Dist 写入产品树。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const toolchainDir: string = path.dirname(fileURLToPath(import.meta.url));
const repoRoot: string = path.resolve(toolchainDir, "..");
const productRoot: string = path.resolve(repoRoot, "ZerOS-PRO");

export default defineConfig({
  root: toolchainDir,
  resolve: {
    alias: {
      "@ZerOS-PRO": productRoot,
    },
  },
  server: {
    fs: {
      allow: [repoRoot, productRoot, toolchainDir],
    },
  },
  build: {
    outDir: path.resolve(toolchainDir, "Dist"),
    emptyOutDir: true,
  },
});
