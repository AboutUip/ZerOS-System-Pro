# Documents/Skills

本目录是技能正文。规则正文在 [Documents/Rules](../Rules/)。`.cursor` 不进版本库，里面只有指回这里的本地链接。

| 子目录 | Cursor 链接 | Skill `name` | 用途 |
|--------|-------------|--------------|------|
| [ProtocolDocumentAuthoring](./ProtocolDocumentAuthoring/) | `.cursor/skills/protocol-document-authoring/` | `protocol-document-authoring` | 编写 / 修订 / 审查对外协议文档 |
| [CodingStandards](./CodingStandards/) | `.cursor/skills/coding-standards/` | `coding-standards` | ZerOS-PRO 规范编码 |
| [ObrLanguage](./ObrLanguage/) | `.cursor/skills/obr-language/` | `obr-language` | Obr 语法 |

规则目录整份接到 `.cursor/rules/`：

| 文件 | 作用 |
|------|------|
| [preview-server.mdc](../Rules/preview-server.mdc) | 预览只用 5173 |
| [obr-kernel-os.mdc](../Rules/obr-kernel-os.mdc) | 内核与操作系统只用 Obr |
| [boot-fault-english.mdc](../Rules/boot-fault-english.mdc) | 字体面打开前的失败说明用英文 |

克隆之后在 `Toolchain` 执行 `npm run skills:sync`，接上这些链接。`npm test` 只确认链接指向本目录和 `Documents/Rules`，不再保留第二份副本。改技能或规则时改这里，不要在 `.cursor` 里另存一份。

## 使用说明

- 每个技能子目录必须包含 `SKILL.md`（YAML：`name`、`description`）。
- 协议文档用 `protocol-document-authoring`。`ZerOS-PRO/**` 编码用 `coding-standards`。改 Obr 表面时用 `obr-language`。
- 新增技能：在本目录建 PascalCase 子文件夹和 `SKILL.md`，更新本 README，再把对应的 kebab-case 链接加进 `Toolchain/check-consistency.mjs` 的 `cursorLinks`。
- 新增规则：把 `.mdc` 放进 `Documents/Rules/`。`.cursor/rules` 是整个目录的链接，不用再单独接。
