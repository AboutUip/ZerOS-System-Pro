# ZMP1 · PhysicalHardware / Memory 协议文档索引

本目录存放 **ZerOS Memory Protocol（ZMP1）** 正文及**专一登记 / 索引**附属文档。权威冲突时：登记表 > 索引 > 正文摘要。

| 文档 | 类型 | 说明 |
|------|------|------|
| [ZMP1.md](./ZMP1.md) | 协议正文 | 配置、异常、单元状态、颗粒存储体、端口、浅切、加深、线性地址、小端整数、块内八位组、所有权、内存频率、初始化前测试、侧信道；可插拔见 [ZVHP1](../PluggableVirtualHardware/ZVHP1.md) |
| [TestCaseRegistry.md](./TestCaseRegistry.md) | 专一登记 | `Test` 必选用例的规范名、顺序与通过条件 |
| [TestCaseIndex.md](./TestCaseIndex.md) | 专一索引 | 用例按顺序 / 规范名 / 主题词检索 |
| [ExceptionCodeRegistry.md](./ExceptionCodeRegistry.md) | 专一登记 | `ExceptionCode` 标号编码 |
| [ExceptionIndex.md](./ExceptionIndex.md) | 专一索引 | 异常按标号 / 短名 / 类别 / 主题词检索 |
| [EventCodeRegistry.md](./EventCodeRegistry.md) | 专一登记 | `EventCode` 标号编码 |
| [EventCodeIndex.md](./EventCodeIndex.md) | 专一索引 | 事件按标号 / 短名 / 挂载处检索 |
| [SignalCodeRegistry.md](./SignalCodeRegistry.md) | 专一登记 | `SignalCode` 标号编码 |
| [SignalCodeIndex.md](./SignalCodeIndex.md) | 专一索引 | 信号按标号 / 短名 / 电平检索 |
| [InitStateRegistry.md](./InitStateRegistry.md) | 专一登记 | `InitState` 六档编码 |
| [InitStateIndex.md](./InitStateIndex.md) | 专一索引 | 初始化状态按取值 / 短名 / 生命周期 / 主题词检索 |

## 约定

- **登记（Registry）**：编码与语义的权威表；新增「已遇到」项必须先改登记表。
- **索引（Index）**：多维检索视图；必须与对应登记表同步，不得单独发明取值。
- 实现代码不是规范来源；第三方只读本目录文档即可裁决兼容性。
