# Documents/SKILLS

本目录存放协议文档写作和 ZerOS-PRO 编码规范的权威源。Obr 语法的权威源在 `.cursor/skills/obr-language/`。

| 子目录 | Skill `name` | 用途 |
|--------|--------------|------|
| [ProtocolDocumentAuthoring](./ProtocolDocumentAuthoring/) | `protocol-document-authoring` | 编写 / 修订 / 审查**对外协议文档** |
| [CodingStandards](./CodingStandards/) | `coding-standards` | **ZerOS-PRO 规范编码** |

## Cursor 挂载

Cursor 从项目根 **`.cursor/skills/`** 加载。根 `.gitignore` 忽略 `.cursor/*`，但保留 `.cursor/skills/`，所以技能随仓库走。

| Cursor 路径 | 权威源 |
|-------------|--------|
| `.cursor/skills/protocol-document-authoring/` | `Documents/SKILLS/ProtocolDocumentAuthoring/` |
| `.cursor/skills/coding-standards/` | `Documents/SKILLS/CodingStandards/` |
| `.cursor/skills/obr-language/` | 自身。Obr 语法以这份为准，不在本目录 |

协议写作和编码规范以 `Documents/SKILLS/**` 为准。Obr 语法以 `.cursor/skills/obr-language/SKILL.md` 为准。

## 使用说明

- 每个子目录必须包含 `SKILL.md`（YAML：`name`、`description`）。
- 协议文档 → `protocol-document-authoring`；`ZerOS-PRO/**` 编码 → `coding-standards`。
- 新增 Skill：PascalCase 子文件夹 → `SKILL.md` → 更新本 README → 在 `.cursor/skills/` 增加 kebab-case 挂载。

## 目录约定

```
Documents/SKILLS/                    ← 协议与编码规范的权威源
├── README.md
├── ProtocolDocumentAuthoring/
└── CodingStandards/

.cursor/skills/                      ← Cursor 加载，纳入 Git
├── protocol-document-authoring/  → Documents/.../ProtocolDocumentAuthoring
├── coding-standards/             → Documents/.../CodingStandards
└── obr-language/                 ← Obr 语法权威源
```
