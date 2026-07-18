/**
 * ZerOS-PRO 仓库根 · ESLint 扁平配置
 *
 * 必须位于仓库根，ESLint 才能检查 ZerOS-PRO（不以配置目录之外为默认范围）。
 * 依赖仍安装在 Toolchain/node_modules，通过绝对路径导入，避免污染 ZerOS-PRO。
 *
 * 目标：教学级超严约束——禁止 any、禁止不安全操作、禁止敷衍式忽略类型。
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const toolchainNodeModules = path.join(repoRoot, "Toolchain", "node_modules");
const toolchainDir = path.join(repoRoot, "Toolchain");

const { default: eslint } = await import(
  pathToFileURL(path.join(toolchainNodeModules, "@eslint/js/src/index.js")).href
);
const tseslint = await import(
  pathToFileURL(path.join(toolchainNodeModules, "typescript-eslint/dist/index.js")).href
);

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "Toolchain/Dist/**",
      "Toolchain/vite.config.ts",
      "eslint.config.js",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: ["ZerOS-PRO/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: [path.join(toolchainDir, "tsconfig.json")],
        tsconfigRootDir: toolchainDir,
      },
    },
    rules: {
      // —— 类型安全：零 any / 零 unsafe ——
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-enum-comparison": "error",

      // —— 禁止敷衍逃逸 ——
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-expect-error": "allow-with-description",
          "ts-ignore": true,
          "ts-nocheck": true,
          "ts-check": false,
          minimumDescriptionLength: 12,
        },
      ],
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-non-null-asserted-optional-chain": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",

      // —— 风格与可维护性（教学可读） ——
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/consistent-type-definitions": ["error", "interface"],
      "@typescript-eslint/explicit-function-return-type": [
        "error",
        {
          allowExpressions: false,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
        },
      ],
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/prefer-readonly": "error",
      "@typescript-eslint/strict-boolean-expressions": [
        "error",
        {
          allowString: false,
          allowNumber: false,
          allowNullableObject: false,
          allowNullableBoolean: false,
          allowNullableString: false,
          allowNullableNumber: false,
          allowAny: false,
        },
      ],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      // 本项目以 ZerOS.Machine.* 命名空间组织硬件层，允许 namespace
      "@typescript-eslint/no-namespace": "off",
      eqeqeq: ["error", "always"],
      "no-var": "error",
      "prefer-const": "error",
      // 教学观察台 / 宿主日志允许 console；业务逻辑仍受类型规则约束
      "no-console": "off",
    },
  },
);
