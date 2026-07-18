# ZMP1 内存异常索引（Exception Index）

> 路径：`Documents/Protocol/PhysicalHardware/Memory/ExceptionIndex.md`  
> 所属协议：`ZMP1`（见 [ZMP1.md](./ZMP1.md) §4.11）  
> 规范状态：**索引（与登记表一致；冲突以登记表为准）**  
> 编码登记册：[ExceptionCodeRegistry.md](./ExceptionCodeRegistry.md)

## 0. 文档定位

本文提供对**已登记**内存异常的多维检索，便于实现者与审查者按短名、标号或类别意图快速定位。

- 标号的权威定义以 [ExceptionCodeRegistry.md](./ExceptionCodeRegistry.md) 为准。
- 类别五档的权威定义以 [ZMP1.md](./ZMP1.md) §4.11.2 为准。
- 异常如何处理/是否写入数组等**不在**协议规定（见 [ZMP1.md](./ZMP1.md) §2.2）。
- 若本文与登记表冲突，**以登记表为准**，并应立即修正本文。

## 1. 按异常标号索引

| 标号 | 规范短名 | 登记状态 | 跳转 |
|------|----------|----------|------|
| `0x0000` | `Unspecified` | 已登记 | [登记表](./ExceptionCodeRegistry.md#2-登记表) |
| `0x0001` | `IllegalUnitSizeBytes` | 已登记 | [登记表](./ExceptionCodeRegistry.md#2-登记表) |
| `0x0002` | `IllegalUnitCount` | 已登记 | [登记表](./ExceptionCodeRegistry.md#2-登记表) |
| `0x0003` | `CryptoUnavailable` | 已登记 | [登记表](./ExceptionCodeRegistry.md#2-登记表) |
| `0x0004` | `UnitIndexAlphabetInvalid` | 已登记 | [登记表](./ExceptionCodeRegistry.md#2-登记表) |

## 2. 按规范短名索引

| 规范短名 | 标号 | 一句话 |
|----------|------|--------|
| `Unspecified` | `0x0000` | 未细分通用占位异常 |
| `IllegalUnitSizeBytes` | `0x0001` | 非法 `UnitSizeBytes` |
| `IllegalUnitCount` | `0x0002` | 非法 `UnitCount` 或关联表大小不一致 |
| `CryptoUnavailable` | `0x0003` | 缺少 `crypto.getRandomValues` |
| `UnitIndexAlphabetInvalid` | `0x0004` | 索引 ID 字符表非法 |

## 3. 按异常类别档位索引（选型参考）

类别取值固定为五档（`0x00`–`0x04`）。下表说明「何时倾向选哪一档」；**具体上报必须仍携带合法 `ExceptionCode`**。

| 类别取值 | 规范档名 | 适用意图（索引） | 与已登记标号的关系 |
|----------|----------|------------------|--------------------|
| `0x00` | `Ignorable` | 可忽略、仅记录 | `0x0000` 可搭配本档 |
| `0x01` | `Advisory` | 提示、默认不中断 | `0x0000` 可搭配本档 |
| `0x02` | `Recoverable` | 可恢复后继续 | `0x0000` 可搭配本档 |
| `0x03` | `Severe` | 当前操作失败，不得当作可忽略 | `0x0000` 可搭配本档 |
| `0x04` | `Abort` | 强制终止相关内存操作路径 | `0x0001`–`0x0004` 默认建议本档；`0x0000` 亦可 |

## 4. 按主题词索引（已遇到）

| 主题词 | 相关标号 | 说明 |
|--------|----------|------|
| 未细分 / 通用 / 占位 | `0x0000` | 尚无更具体标号时的通用项 |
| 非法颗粒大小 | `0x0001` | `UnitSizeBytes` |
| 非法颗粒数量 / 关联表大小 | `0x0002` | `UnitCount` |
| 加密随机源 / crypto | `0x0003` | `getRandomValues` 不可用 |
| 索引字符表 | `0x0004` | 实现层 `UnitIndexId` 字母表 |
| 越界 | （待登记） | 预留主题；标号未分配 |
| 初始化 | （待登记） | 预留主题；标号未分配 |
| 总容量未就绪 | （待登记） | 预留主题；标号未分配 |

## 5. 快速核对清单（报告异常时）

报告 ZMP1 内存异常前，确认：

- [ ] 对象形态为 `MemoryException` 四属性齐全  
- [ ] `ExceptionCode` 已在 [ExceptionCodeRegistry.md](./ExceptionCodeRegistry.md) 登记（或仅为文档允许的占位用法且不伪称未定义含义）  
- [ ] `ExceptionCategory` ∈ {`0x00`,`0x01`,`0x02`,`0x03`,`0x04`}  
- [ ] `ExceptionSummary` 码点长度严格小于 256  
- [ ] `ExceptionChain` 为非 `null` 的 object  

## 6. 修订记录

| 日期 | 变更 |
|------|------|
| 2026-07-18 | 首版：建立标号 / 短名 / 类别 / 主题词四维索引；收录 `0x0000 Unspecified` |
| 2026-07-18 | 收录 `0x0001`–`0x0004` |
| 2026-07-18 | 移除对异常处理流程的核对项（协议明确不规定） |
