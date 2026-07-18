/**
 * 在仓库根 cwd 下调用 ESLint，使根目录 eslint.config.js 能覆盖 ZerOS-PRO。
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolchainDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolchainDir, "..");
const eslintCli = path.join(toolchainDir, "node_modules", "eslint", "bin", "eslint.js");

const result = spawnSync(
  process.execPath,
  [eslintCli, "ZerOS-PRO", "--max-warnings", "0"],
  {
    cwd: repoRoot,
    stdio: "inherit",
  },
);

process.exit(result.status === null ? 1 : result.status);
