# Registry + Index 拆分模板

与 [SKILL.md](SKILL.md)「专一拆分」配套。复制后替换 `{Topic}` / `{ProtocolId}` / 路径。

## 目录内文件

```
{ProtocolDir}/
├── README.md                 # 列出正文 + 全部 Registry/Index；写明优先级
├── {ProtocolId}.md           # 协议正文（摘要 + 链接）
├── {Topic}Registry.md        # 权威登记
└── {Topic}Index.md           # 专一索引
```

冲突优先级（必须写明）：

```
Registry > Index > 协议正文摘要
```

---

## `{Topic}Registry.md` 骨架

```markdown
# {ProtocolId} {主题中文名}登记表（{Topic} Registry）

> 路径：`…/{Topic}Registry.md`  
> 所属协议：`{ProtocolId}`（见 [{ProtocolId}.md](./{ProtocolId}.md) §x.y）  
> 规范状态：**规范性（登记）**  
> 配套索引：[{Topic}Index.md](./{Topic}Index.md)

## 0. 文档定位
- 约束对象：声称兼容 {ProtocolId} 的实现
- 作用：固化已遇到/已采纳的编码与语义
- 非目标：…（明确不写什么）

## 1. 编码规则（必须遵守）
| 规则 | 要求 |
|------|------|
| 空间 / 起点 / 分配 / 记法 / 升版 | … |

## 2. 登记表
| 取值或标号 | 规范短名 | 语义 | 状态 |
|------------|----------|------|------|
| … | … | … | 已登记 |

## 3. 预留与待登记
| 号段 | 说明 |
|------|------|
| … | 尚未登记，禁止冒充已定义含义 |

## 4. 登记流程（追加时）
1. 改本表 2. 改 Index 3. 必要时改协议正文与修订记录 4. 更新目录 README

## 5. 修订记录
| 日期 | 变更 |
|------|------|
| YYYY-MM-DD | … |
```

---

## `{Topic}Index.md` 骨架

```markdown
# {ProtocolId} {主题中文名}索引（{Topic} Index）

> 路径：`…/{Topic}Index.md`  
> 所属协议：`{ProtocolId}`（见 [{ProtocolId}.md](./{ProtocolId}.md) §x.y）  
> 规范状态：**索引（冲突以登记表为准）**  
> 编码登记册：[{Topic}Registry.md](./{Topic}Registry.md)

## 0. 文档定位
权威在 Registry；本文只做多维检索。

## 1. 按取值 / 标号索引
## 2. 按规范短名索引
## 3. 按类别或生命周期索引（若适用）
## 4. 按主题词索引
## 5. 快速核对清单
## 6. 修订记录
```

每条索引项**必须**能链回 Registry 对应行；**禁止**出现 Registry 未登记的取值。

---

## 协议正文中的摘要写法（示例）

```markdown
### 4.x {主题}

字段/对象约束摘要……

权威完整登记与检索：

- 编码登记：[{Topic}Registry.md](./{Topic}Registry.md)
- 专一索引：[{Topic}Index.md](./{Topic}Index.md)

| 取值 | 规范短名（摘要） |
|------|------------------|
| … | … |
```
