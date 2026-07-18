# Documents/SKILLS

本目录存放 ZerOS-System-Pro **项目级 Agent Skills** 的**权威源码**（供人阅读与修订）。

| 子目录 | Skill `name` | 用途 |
|--------|--------------|------|
| [ProtocolDocumentAuthoring](./ProtocolDocumentAuthoring/) | `protocol-document-authoring` | 编写 / 修订 / 审查**对外协议文档** |
| [CodingStandards](./CodingStandards/) | `coding-standards` | **ZerOS-PRO 规范编码** |

## Cursor 挂载

Cursor 从项目根 **`.cursor/skills/`** 加载 Skills（该目录已被根 `.gitignore` 全面排除，仅本机使用）。

本机可用 Junction 挂载（示例）：

| Cursor 路径 | 指向 |
|-------------|------|
| `.cursor/skills/protocol-document-authoring/` | `Documents/SKILLS/ProtocolDocumentAuthoring/` |
| `.cursor/skills/coding-standards/` | `Documents/SKILLS/CodingStandards/` |

权威源与协作以 `Documents/SKILLS/**` 为准（纳入 Git）。

## 使用说明

- 每个子目录必须包含 `SKILL.md`（YAML：`name`、`description`）。
- 协议文档 → `protocol-document-authoring`；`ZerOS-PRO/**` 编码 → `coding-standards`。
- 新增 Skill：PascalCase 子文件夹 → `SKILL.md` → 更新本 README → 在 `.cursor/skills/` 增加 kebab-case 挂载。

## 目录约定

```
Documents/SKILLS/                    ← 权威源
├── README.md
├── ProtocolDocumentAuthoring/
└── CodingStandards/

.cursor/skills/                      ← Cursor 挂载点
├── protocol-document-authoring/  → Documents/.../ProtocolDocumentAuthoring
└── coding-standards/             → Documents/.../CodingStandards
```
