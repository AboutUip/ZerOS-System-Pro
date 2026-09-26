# 规范编码自检清单

对 `ZerOS-PRO/**` 的每次改动，结果只能是 **通过 / 不通过**。

## A. 约定边界

- [ ] 未实现用户未明确要求的方法 / API / 行为
- [ ] 字段名与协议规范名逐字一致（若涉及协议）
- [ ] 无「先写着以后再说」的协议外语义

## B. 结构与命名

- [ ] 文件位于 `ZerOS-PRO/`，未污染进 `Toolchain` 业务逻辑
- [ ] 文件夹 / 文件 PascalCase
- [ ] 使用 `ZerOS.…` 命名空间且与子系统根目录对应
- [ ] 文件头含中文「职责」与「组织顺序」
- [ ] **未**在子系统根目录平铺枚举/结构/类（Memory 须落在 `Config|Enum|Structure|Unit|Controller|Bootstrap`）
- [ ] 枚举量在 `Enum/`（或同构目录）、结构/工厂在 `Structure/`（或同构目录），一责一文件
- [ ] 跨子目录引用路径正确

## C. 注释

- [ ] 注释为中文
- [ ] 文件头含职责、概念分层（若需要）、组织顺序
- [ ] 模块分段有中文分隔注释（与组织顺序对应）
- [ ] 类型、字段、常量有说明；协议字段与实现约定已区分
- [ ] 函数 / 方法内部对关键步骤有「为何」级注释（非平凡逻辑不得空白）
- [ ] 无空洞注释

## D. 严格质量

- [ ] `cd Toolchain && npm run check` 通过
- [ ] 无 `any` / unsafe / `@ts-ignore` / `@ts-nocheck`
- [ ] 导出函数有显式返回类型（若存在函数）
- [ ] `verbatimModuleSyntax` 下正确使用 `import` / `import type`

## E. 工具链

- [ ] 未在 `ZerOS-PRO` 新增 `package.json` / `node_modules` / `Dist`
- [ ] 依赖与构建仍只在 `Toolchain`
