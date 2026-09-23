/**
 * @module ZerOS.Hardware.Memory.Unit
 * @description 单颗内存颗粒单元（MemoryUnit）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 仅承载 MemoryUnit 类：Cells、CellCount、UnitOrdinal、InitState、
 * Events / Signals / Exceptions，以及颗粒内端口 ReadBit / WriteBit / ReadOctet / WriteOctet。
 * 枚举量、Uint32 门闩、八位组门闩与 CellCount 推导已拆至 Enum/、Structure/。
 * 不提供跨颗粒地址（那在总控上）。本颗上的多八位组整数是小端，并且不得跨出本颗。
 *
 * 异常策略（实现侧约定，非 ZMP1 强制）：
 *   优先写入 Exceptions；先检查 → 再 try；可处理自消化；不可处理再抛。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 配置面 / Uint32 / 八位组 / CellCount / 位元 / 枚举量 / 结构 / 异常工厂导入
 *   2. MemoryUnit 类
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as MemoryConfigRoot } from "../Config/MemoryConfig";
import { ZerOS as Uint32Root } from "../Structure/Uint32";
import { ZerOS as OctetValueRoot } from "../Structure/OctetValue";
import { ZerOS as CellCountRoot } from "../Structure/CellCount";
import type { ZerOS as BitValueRoot } from "../Enum/BitValue";
import { ZerOS as UnitInitStateRoot } from "../Enum/UnitInitState";
import type { ZerOS as MemoryEventRoot } from "../Structure/MemoryEvent";
import type { ZerOS as MemorySignalRoot } from "../Structure/MemorySignal";
import { ZerOS as MemoryExceptionRoot } from "../Structure/MemoryException";
import { ZerOS as ExceptionCategoryRoot } from "../Enum/ExceptionCategory";
import { ZerOS as ExceptionCodeRoot } from "../Enum/ExceptionCode";
import { ZerOS as EventCodeRoot } from "../Enum/EventCode";
import { ZerOS as SignalCodeRoot } from "../Enum/SignalCode";
import { ZerOS as SideChannelRoot } from "../Structure/SideChannel";
import { ZerOS as IntegerWidthRoot } from "../Enum/IntegerWidth";
import { ZerOS as LittleEndianRoot } from "../Structure/LittleEndian";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      /* -------------------------------------------------------------------- */
      /* 2. MemoryUnit                                                         */
      /* -------------------------------------------------------------------- */

      /**
       * MemoryUnit：单颗内存颗粒实例。
       *
       * 总控负责关联；本类是存储本体 + 事件/信号/异常侧信道。
       * 端口是 ReadBit / WriteBit / ReadOctet / WriteOctet，且仅在 InitState 为 0x4 时成功。
       * UnitOrdinal 由总控在创建时指定，本类不分配序号。
       */
      export class MemoryUnit {
        /**
         * 八位组序列（ZMP1 §4.15 规范字段名 `Cells`）。
         *
         * 成功实例化：长度 = UnitSizeBytes，每个八位组为整数 0（从而 8 个位元全为 0）。
         * 失败实例化：长度 = 0。
         * 八位组是位元的紧凑载体，元素值 0–255 不是位元取值。
         * 位序：下标 0 为首八位组；八位组内位偏移 0 是最低有效位。
         * 改一位的端口是 WriteBit，改整组的端口是 WriteOctet。对下标直接赋值不是协议写端口。
         */
        public readonly Cells: Uint8Array;

        /**
         * 位元个数（ZMP1 §4.15 规范字段名 `CellCount`）。
         *
         * 成功实例化：必须等于 UnitSizeBytes × BitsPerByte，且为 Uint32。
         * 失败实例化：必须为 0。
         */
        public readonly CellCount: Uint32Root.Hardware.Memory.Uint32;

        /**
         * 颗粒序号（ZMP1 §4.19 规范字段名 `UnitOrdinal`）。
         *
         * 由总控按创建顺序指定：0 起、连续、不重复，且小于 UnitCount。
         * 阶段 D 升到 0x4 时不得改写。它不是 UnitIndexId，也不是 MemoryId。
         */
        public readonly UnitOrdinal: Uint32Root.Hardware.Memory.Uint32;

        /**
         * 初始化状态（ZMP1 §4.12 主路径）。
         * 本类（实例化）：操作前 0x0 → 进行中 0x1 → 成功 0x3 / 失败 0x2 / Abort 0x5。
         * 总控在全部初始化逻辑完成后：成功路径 0x3 → 0x4（正式可用）。
         */
        public InitState: UnitInitStateRoot.Hardware.Memory.UnitInitState;

        /**
         * 事件数组（ZMP1 §4.13）：元素为 MemoryEvent 壳。
         */
        public readonly Events: MemoryEventRoot.Hardware.Memory.MemoryEvent[];

        /**
         * 信号数组（ZMP1 §4.13）：元素为 MemorySignal 壳。
         */
        public readonly Signals: MemorySignalRoot.Hardware.Memory.MemorySignal[];

        /**
         * 异常数组（ZMP1 §4.13）：元素为 MemoryException。
         */
        public readonly Exceptions: MemoryExceptionRoot.Hardware.Memory.MemoryException[];

        /**
         * 构造一颗内存单元（ZMP1 主路径阶段 A→B→C）。
         *
         * 流水线：
         *   (1) 侧信道空数组；InitState = 0x0（未执行任何操作前）
         *   (2) InitState = 0x1（进入实例化）
         *   (3) UnitOrdinal 必须已是 Uint32；否则空存储体 + Abort + 0x5
         *   (4) UnitSizeBytes 重新过 Uint32 门闩且 ≥ 1；否则空存储体 + Abort + 0x5
         *   (5) CellCount = UnitSizeBytes × BitsPerByte 必须仍是 Uint32；否则同上
         *   (6) 分配八位组并清零；成功 → 0x3；分配失败 → 空存储体 + 异常 + 0x2
         */
        public constructor(unitOrdinal: Uint32Root.Hardware.Memory.Uint32) {
          // —— (1) 侧信道就位；操作前必须为 0x0 ——
          this.Events = [];
          this.Signals = [];
          this.Exceptions = [];
          this.InitState =
            UnitInitStateRoot.Hardware.Memory.UnitInitStateCode.InvalidPending;

          // —— (2) 进入实例化：必须为 0x1 ——
          this.InitState =
            UnitInitStateRoot.Hardware.Memory.UnitInitStateCode.Preparing;

          // —— (3) 序号先钉死。非法序号不能冒充第 0 颗去占存储体 ——
          const gatedOrdinal: Uint32Root.Hardware.Memory.Uint32 | null =
            Uint32Root.Hardware.Memory.toUint32(unitOrdinal);
          this.UnitOrdinal =
            gatedOrdinal ?? Uint32Root.Hardware.Memory.Uint32Zero;
          if (gatedOrdinal === null) {
            this.Cells = new Uint8Array(0);
            this.CellCount = Uint32Root.Hardware.Memory.Uint32Zero;
            this.recordExceptionOrAbort({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.Unspecified,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
              ExceptionSummary: `UnitOrdinal=${String(unitOrdinal)} 不是 Uint32，颗粒无法编号`,
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryUnit.constructor",
                Field: "UnitOrdinal",
                Value: unitOrdinal,
              },
            });
            this.InitState =
              UnitInitStateRoot.Hardware.Memory.UnitInitStateCode.Unrecoverable;
            this.recordLifecycle();
            return;
          }

          const rawSize: number =
            MemoryConfigRoot.Hardware.Memory.Config.UnitSizeBytes;
          const size: Uint32Root.Hardware.Memory.Uint32 | null =
            Uint32Root.Hardware.Memory.toUint32(rawSize);
          const maxUnitSize: Uint32Root.Hardware.Memory.Uint32 =
            CellCountRoot.Hardware.Memory.MaxUnitSizeBytes;

          // —— (4) 先检查：非 Uint32 或小于 1（Abort → 无法恢复终局 0x5）——
          // 存储体先置空，再记异常：异常工厂若抛出，字段也已经赋值。
          if (size === null || size < 1) {
            this.Cells = new Uint8Array(0);
            this.CellCount = Uint32Root.Hardware.Memory.Uint32Zero;
            this.recordExceptionOrAbort({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                  .IllegalUnitSizeBytes,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode
                  .Abort,
              ExceptionSummary: `非法颗粒大小 UnitSizeBytes=${String(rawSize)}，须为 1 至 ${String(maxUnitSize)} 的整数`,
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryUnit.constructor",
                Field: "UnitSizeBytes",
                Value: rawSize,
              },
            });
            this.InitState =
              UnitInitStateRoot.Hardware.Memory.UnitInitStateCode.Unrecoverable;
            this.recordLifecycle();
            return;
          }

          // —— (5) 位元数必须精确落入 Uint32；超出则颗粒无法形成 ——
          const cellCount: Uint32Root.Hardware.Memory.Uint32 | null =
            CellCountRoot.Hardware.Memory.cellCountFromUnitSize(size);
          if (cellCount === null) {
            this.Cells = new Uint8Array(0);
            this.CellCount = Uint32Root.Hardware.Memory.Uint32Zero;
            this.recordExceptionOrAbort({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                  .IllegalUnitSizeBytes,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode
                  .Abort,
              ExceptionSummary: `非法颗粒大小 UnitSizeBytes=${String(size)}，展开后的 CellCount 超出 Uint32`,
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryUnit.constructor",
                Field: "UnitSizeBytes",
                Value: size,
                BitsPerByte:
                  MemoryConfigRoot.Hardware.Memory.Config.BitsPerByte,
              },
            });
            this.InitState =
              UnitInitStateRoot.Hardware.Memory.UnitInitStateCode.Unrecoverable;
            this.recordLifecycle();
            return;
          }

          // —— (6) 分配八位组并清零：成功 → 0x3；失败 → 空存储体 + 0x2 ——
          // 局部变量承接分配结果，避免 catch 路径对 readonly 字段二次赋值。
          let allocated: Uint8Array;
          try {
            allocated = new Uint8Array(size);
            allocated.fill(0);
          } catch (caught: unknown) {
            this.Cells = new Uint8Array(0);
            this.CellCount = Uint32Root.Hardware.Memory.Uint32Zero;
            this.recordExceptionOrAbort({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                  .Unspecified,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode
                  .Severe,
              ExceptionSummary: `分配 Cells 失败（请求八位组数=${String(size)}）`,
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryUnit.constructor",
                Cause:
                  caught instanceof Error
                    ? { Name: caught.name, Message: caught.message }
                    : { Raw: String(caught) },
              },
            });
            this.InitState =
              UnitInitStateRoot.Hardware.Memory.UnitInitStateCode.InitFault;
            this.recordLifecycle();
            return;
          }

          this.Cells = allocated;
          this.CellCount = cellCount;
          this.InitState =
            UnitInitStateRoot.Hardware.Memory.UnitInitStateCode.InitComplete;
          this.recordLifecycle();
        }

        /**
         * 阶段 D 只把 0x3 升到 0x4。
         * 存储体、序号都不改。同时记下 BecameActive，并把 Usable 电平拉高。
         */
        public promoteToActive(): void {
          const complete: UnitInitStateRoot.Hardware.Memory.UnitInitState =
            UnitInitStateRoot.Hardware.Memory.UnitInitStateCode.InitComplete;
          if (this.InitState !== complete) {
            return;
          }
          this.InitState =
            UnitInitStateRoot.Hardware.Memory.UnitInitStateCode.Active;
          this.recordLifecycle();
        }

        /**
         * 将异常写入本单元 Exceptions。
         * 工厂失败则兜底 Unspecified/Severe；兜底仍失败则抛出。
         */
        private recordExceptionOrAbort(params: {
          readonly ExceptionCode: number;
          readonly ExceptionCategory: ExceptionCategoryRoot.Hardware.Memory.ExceptionCategory;
          readonly ExceptionSummary: string;
          readonly ExceptionChain: object;
        }): void {
          const built: MemoryExceptionRoot.Hardware.Memory.MemoryException | null =
            MemoryExceptionRoot.Hardware.Memory.createMemoryException(params);
          if (built !== null) {
            this.Exceptions.push(built);
            return;
          }

          const fallback: MemoryExceptionRoot.Hardware.Memory.MemoryException | null =
            MemoryExceptionRoot.Hardware.Memory.createMemoryException({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                  .Unspecified,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode
                  .Severe,
              ExceptionSummary:
                "MemoryException 形态校验失败，已拒绝原始上报",
              ExceptionChain: {
                Source:
                  "ZerOS.Hardware.Memory.MemoryUnit.recordExceptionOrAbort",
                Rejected: params,
              },
            });
          if (fallback !== null) {
            this.Exceptions.push(fallback);
            return;
          }

          throw new Error(
            `[ZerOS.Hardware.Memory.MemoryUnit] 无法写入合规 MemoryException，构造中止`,
          );
        }

        /**
         * 读取一个位元（ZMP1 §4.17 规范方法名 `ReadBit`）。
         *
         * 成功时返回 0 或 1。失败时先写入本单元 Exceptions，再抛出，
         * 因此不会用返回值冒充成功。检查顺序：正式可用 → 下标。
         */
        public ReadBit(
          CellIndex: Uint32Root.Hardware.Memory.Uint32,
        ): BitValueRoot.Hardware.Memory.BitValue {
          this.requireActiveForPort();
          const place: BitPlace | null = this.locateBit(CellIndex);
          if (place === null) {
            this.failPort({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                  .BitIndexOutOfRange,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode
                  .Abort,
              ExceptionSummary: `CellIndex=${String(CellIndex)} 越出位元范围 CellCount=${String(this.CellCount)}`,
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryUnit.ReadBit",
                Field: "CellIndex",
                Value: CellIndex,
                CellCount: this.CellCount,
              },
            });
          }

          const octet: number | undefined = this.Cells[place.OctetIndex];
          if (octet === undefined) {
            this.failPort({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                  .BitIndexOutOfRange,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode
                  .Abort,
              ExceptionSummary: `八位组下标 ${String(place.OctetIndex)} 没有载体`,
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryUnit.ReadBit",
                Field: "OctetIndex",
                Value: place.OctetIndex,
              },
            });
          }

          // 协议观察式：整数商再对 2 取余。权重是 2^BitOffset，偏移 0 为最低有效位。
          const extracted: number =
            Math.floor(octet / place.Weight) % 2;
          if (extracted === 0) {
            return 0;
          }
          if (extracted === 1) {
            return 1;
          }
          this.failPort({
            ExceptionCode:
              ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.Unspecified,
            ExceptionCategory:
              ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
            ExceptionSummary: `位元观察结果 ${String(extracted)} 不是 0 或 1`,
            ExceptionChain: {
              Source: "ZerOS.Hardware.Memory.MemoryUnit.ReadBit",
              Field: "BitValue",
              Value: extracted,
            },
          });
        }

        /**
         * 写入一个位元（ZMP1 §4.17 规范方法名 `WriteBit`）。
         *
         * 只改目标位。失败时存储体保持调用前的样子，并先记异常再抛出。
         * 检查顺序：正式可用 → 下标 → 位元值。
         */
        public WriteBit(
          CellIndex: Uint32Root.Hardware.Memory.Uint32,
          BitValue: number,
        ): void {
          this.requireActiveForPort();
          const place: BitPlace | null = this.locateBit(CellIndex);
          if (place === null) {
            this.failPort({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                  .BitIndexOutOfRange,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode
                  .Abort,
              ExceptionSummary: `CellIndex=${String(CellIndex)} 越出位元范围 CellCount=${String(this.CellCount)}`,
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryUnit.WriteBit",
                Field: "CellIndex",
                Value: CellIndex,
                CellCount: this.CellCount,
              },
            });
          }

          if (BitValue !== 0 && BitValue !== 1) {
            this.failPort({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                  .IllegalBitValue,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode
                  .Abort,
              ExceptionSummary: `BitValue=${String(BitValue)} 不是 0 或 1`,
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryUnit.WriteBit",
                Field: "BitValue",
                Value: BitValue,
              },
            });
          }

          const octet: number | undefined = this.Cells[place.OctetIndex];
          if (octet === undefined) {
            this.failPort({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                  .BitIndexOutOfRange,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode
                  .Abort,
              ExceptionSummary: `八位组下标 ${String(place.OctetIndex)} 没有载体`,
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryUnit.WriteBit",
                Field: "OctetIndex",
                Value: place.OctetIndex,
              },
            });
          }

          // 清位用 0xFF 异或权重，避免对八位组做有符号取反。置位只打开这一位。
          const cleared: number = octet & (0xff ^ place.Weight);
          const next: number = BitValue === 0 ? cleared : cleared | place.Weight;
          this.Cells[place.OctetIndex] = next & 0xff;
        }

        /**
         * 读取一个八位组（ZMP1 §4.18 规范方法名 `ReadOctet`）。
         *
         * 成功时返回 0–255 的整数，也就是该载体里 8 个位元的当前打包值。
         * 失败时先写入本单元 Exceptions，再抛出。检查顺序：正式可用 → 下标。
         */
        public ReadOctet(
          OctetIndex: Uint32Root.Hardware.Memory.Uint32,
        ): OctetValueRoot.Hardware.Memory.OctetValue {
          this.requireActiveForPort();
          const index: number | null = this.locateOctet(OctetIndex);
          if (index === null) {
            this.failPort({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                  .OctetIndexOutOfRange,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode
                  .Abort,
              ExceptionSummary: `OctetIndex=${String(OctetIndex)} 越出八位组范围 length=${String(this.Cells.length)}`,
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryUnit.ReadOctet",
                Field: "OctetIndex",
                Value: OctetIndex,
                OctetCount: this.Cells.length,
              },
            });
          }

          const octet: number | undefined = this.Cells[index];
          const gated: OctetValueRoot.Hardware.Memory.OctetValue | null =
            octet === undefined
              ? null
              : OctetValueRoot.Hardware.Memory.toOctetValue(octet);
          if (gated === null) {
            this.failPort({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                  .Unspecified,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode
                  .Abort,
              ExceptionSummary: `八位组下标 ${String(index)} 的载体不是 0–255`,
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryUnit.ReadOctet",
                Field: "OctetIndex",
                Value: index,
              },
            });
          }
          return gated;
        }

        /**
         * 写入一个八位组（ZMP1 §4.18 规范方法名 `WriteOctet`）。
         *
         * 这一下改掉该组里的全部 8 个位元，其它八位组保持不变。
         * 检查顺序：正式可用 → 下标 → 写入值。失败时不写入。
         */
        public WriteOctet(
          OctetIndex: Uint32Root.Hardware.Memory.Uint32,
          OctetValue: number,
        ): void {
          this.requireActiveForPort();
          const index: number | null = this.locateOctet(OctetIndex);
          if (index === null) {
            this.failPort({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                  .OctetIndexOutOfRange,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode
                  .Abort,
              ExceptionSummary: `OctetIndex=${String(OctetIndex)} 越出八位组范围 length=${String(this.Cells.length)}`,
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryUnit.WriteOctet",
                Field: "OctetIndex",
                Value: OctetIndex,
                OctetCount: this.Cells.length,
              },
            });
          }

          const gated: OctetValueRoot.Hardware.Memory.OctetValue | null =
            OctetValueRoot.Hardware.Memory.toOctetValue(OctetValue);
          if (gated === null) {
            this.failPort({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                  .IllegalOctetValue,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode
                  .Abort,
              ExceptionSummary: `OctetValue=${String(OctetValue)} 不是 0–255 的整数`,
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryUnit.WriteOctet",
                Field: "OctetValue",
                Value: OctetValue,
              },
            });
          }

          this.Cells[index] = gated;
        }

        /**
         * 读取一个小端整数（ZMP1 §4.24 规范方法名 `ReadInteger`）。
         * 宽度只允许 2、4、8。跨度必须整段落在本颗里面。
         * 检查顺序：正式可用 → 宽度 → 跨度。
         */
        public ReadInteger(
          OctetIndex: Uint32Root.Hardware.Memory.Uint32,
          OctetWidth: number,
        ): bigint {
          const width: IntegerWidthRoot.Hardware.Memory.IntegerWidth | null =
            this.requireIntegerSpan(OctetIndex, OctetWidth);
          const octets: number[] = [];
          let step = 0;
          while (step < width) {
            const index: Uint32Root.Hardware.Memory.Uint32 =
              Uint32Root.Hardware.Memory.uint32OrThrow(
                OctetIndex + step,
                "ZerOS.Hardware.Memory.MemoryUnit.ReadInteger",
              );
            octets.push(this.ReadOctet(index));
            step += 1;
          }
          return LittleEndianRoot.Hardware.Memory.packLittleEndian(octets);
        }

        /**
         * 写入一个小端整数（ZMP1 §4.24 规范方法名 `WriteInteger`）。
         * 最低下标的八位组是最低有效字节。失败时一个八位组都不改。
         * 检查顺序：正式可用 → 宽度 → 跨度 → 值。
         */
        public WriteInteger(
          OctetIndex: Uint32Root.Hardware.Memory.Uint32,
          OctetWidth: number,
          IntegerValue: bigint,
        ): void {
          const width: IntegerWidthRoot.Hardware.Memory.IntegerWidth | null =
            this.requireIntegerSpan(OctetIndex, OctetWidth);
          const octets: number[] | null =
            LittleEndianRoot.Hardware.Memory.unpackLittleEndian(IntegerValue, width);
          if (octets === null) {
            this.failPort({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                  .IllegalIntegerValue,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
              ExceptionSummary: `IntegerValue 超出宽度 ${String(width)} 的八位组`,
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryUnit.WriteInteger",
                Field: "IntegerValue",
              },
            });
          }
          let step = 0;
          while (step < octets.length) {
            if (octets[step] === undefined) {
              this.failPort({
                ExceptionCode:
                  ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.IllegalIntegerValue,
                ExceptionCategory:
                  ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
                ExceptionSummary: "小端拆开的八位组不完整，一个八位组都没写",
                ExceptionChain: {
                  Source: "ZerOS.Hardware.Memory.MemoryUnit.WriteInteger",
                  Field: "IntegerValue",
                },
              });
            }
            step += 1;
          }
          step = 0;
          while (step < octets.length) {
            const octet: number | undefined = octets[step];
            if (octet === undefined) {
              this.failPort({
                ExceptionCode:
                  ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.IllegalIntegerValue,
                ExceptionCategory:
                  ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
                ExceptionSummary: "小端拆开的八位组不完整，一个八位组都没写",
                ExceptionChain: {
                  Source: "ZerOS.Hardware.Memory.MemoryUnit.WriteInteger",
                  Field: "IntegerValue",
                },
              });
            }
            const index: Uint32Root.Hardware.Memory.Uint32 =
              Uint32Root.Hardware.Memory.uint32OrThrow(
                OctetIndex + step,
                "ZerOS.Hardware.Memory.MemoryUnit.WriteInteger",
              );
            this.WriteOctet(index, octet);
            step += 1;
          }
        }

        /**
         * 整数端口的共同门闩。通过之后宽度一定是 2、4 或 8，跨度也落在本颗里。
         */
        private requireIntegerSpan(
          octetIndex: Uint32Root.Hardware.Memory.Uint32,
          octetWidth: number,
        ): IntegerWidthRoot.Hardware.Memory.IntegerWidth {
          this.requireActiveForPort();
          const width: IntegerWidthRoot.Hardware.Memory.IntegerWidth | null =
            IntegerWidthRoot.Hardware.Memory.toIntegerWidth(octetWidth);
          if (width === null) {
            this.failPort({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                  .IllegalIntegerWidth,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
              ExceptionSummary: `OctetWidth=${String(octetWidth)} 不是 2、4 或 8`,
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryUnit.requireIntegerSpan",
                Field: "OctetWidth",
                Value: octetWidth,
              },
            });
          }
          if (BigInt(octetIndex) + BigInt(width) > BigInt(this.Cells.length)) {
            this.failPort({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                  .IntegerSpanOutOfRange,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
              ExceptionSummary: `从八位组 ${String(octetIndex)} 起的 ${String(width)} 个八位组越出本颗`,
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryUnit.requireIntegerSpan",
                Field: "OctetIndex",
                Value: octetIndex,
              },
            });
          }
          return width;
        }

        /**
         * 状态落到 0x2 / 0x3 / 0x4 / 0x5 时记一条事件，并刷新 Usable / Fault。
         * 0x0 与 0x1 是过渡态，不记。
         */
        private recordLifecycle(): void {
          const faultState: UnitInitStateRoot.Hardware.Memory.UnitInitState =
            UnitInitStateRoot.Hardware.Memory.UnitInitStateCode.InitFault;
          const complete: UnitInitStateRoot.Hardware.Memory.UnitInitState =
            UnitInitStateRoot.Hardware.Memory.UnitInitStateCode.InitComplete;
          const active: UnitInitStateRoot.Hardware.Memory.UnitInitState =
            UnitInitStateRoot.Hardware.Memory.UnitInitStateCode.Active;
          const unrecoverable: UnitInitStateRoot.Hardware.Memory.UnitInitState =
            UnitInitStateRoot.Hardware.Memory.UnitInitStateCode.Unrecoverable;
          const usable: SignalCodeRoot.Hardware.Memory.SignalLevel =
            this.InitState === active ? 1 : 0;
          const fault: SignalCodeRoot.Hardware.Memory.SignalLevel =
            this.InitState === faultState || this.InitState === unrecoverable ? 1 : 0;
          SideChannelRoot.Hardware.Memory.upsertSignal(
            this.Signals,
            SignalCodeRoot.Hardware.Memory.SignalCodeValue.Usable,
            usable,
            this.UnitOrdinal,
          );
          SideChannelRoot.Hardware.Memory.upsertSignal(
            this.Signals,
            SignalCodeRoot.Hardware.Memory.SignalCodeValue.Fault,
            fault,
            this.UnitOrdinal,
          );
          let eventCode: EventCodeRoot.Hardware.Memory.EventCode | null = null;
          if (this.InitState === complete) {
            eventCode = EventCodeRoot.Hardware.Memory.EventCodeValue.Instantiated;
          } else if (this.InitState === active) {
            eventCode = EventCodeRoot.Hardware.Memory.EventCodeValue.BecameActive;
          } else if (this.InitState === faultState) {
            eventCode = EventCodeRoot.Hardware.Memory.EventCodeValue.InitFailed;
          } else if (this.InitState === unrecoverable) {
            eventCode = EventCodeRoot.Hardware.Memory.EventCodeValue.BecameUnrecoverable;
          }
          if (eventCode === null) {
            return;
          }
          SideChannelRoot.Hardware.Memory.appendEvent(
            this.Events,
            eventCode,
            this.UnitOrdinal,
            Uint32Root.Hardware.Memory.Uint32Zero,
          );
        }

        /**
         * 存储端口只在正式可用时开门。其它 InitState 一律 UnitNotActive，
         * 即使下标同时越界，也不改报成越界。位元端口与八位组端口共用这一道门。
         */
        private requireActiveForPort(): void {
          const active: UnitInitStateRoot.Hardware.Memory.UnitInitState =
            UnitInitStateRoot.Hardware.Memory.UnitInitStateCode.Active;
          if (this.InitState === active) {
            return;
          }
          this.failPort({
            ExceptionCode:
              ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                .UnitNotActive,
            ExceptionCategory:
              ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
            ExceptionSummary: `存储端口要求 InitState=0x4，当前为 ${String(this.InitState)}`,
            ExceptionChain: {
              Source: "ZerOS.Hardware.Memory.MemoryUnit.requireActiveForPort",
              Field: "InitState",
              Value: this.InitState,
            },
          });
        }

        /**
         * 把 CellIndex 拆成八位组下标与位权重。
         * 下标不是 Uint32，或 ≥ CellCount 时返回 null，由调用方记越界。
         */
        private locateBit(
          cellIndex: Uint32Root.Hardware.Memory.Uint32,
        ): BitPlace | null {
          const gated: Uint32Root.Hardware.Memory.Uint32 | null =
            Uint32Root.Hardware.Memory.toUint32(cellIndex);
          if (gated === null || gated >= this.CellCount) {
            return null;
          }

          const bitsPerByte: MemoryConfigRoot.Hardware.Memory.BitsPerByte =
            MemoryConfigRoot.Hardware.Memory.Config.BitsPerByte;
          // CellIndex 落在 Uint32 内，除以 8 仍是精确整数，不经过舍入。
          const octetIndex: number =
            (gated - (gated % bitsPerByte)) / bitsPerByte;
          const bitOffset: number = gated % bitsPerByte;
          if (
            !Number.isInteger(octetIndex) ||
            !Number.isInteger(bitOffset) ||
            bitOffset < 0 ||
            bitOffset > 7
          ) {
            return null;
          }

          let weight = 1;
          let step = 0;
          while (step < bitOffset) {
            weight *= 2;
            step += 1;
          }
          return {
            OctetIndex: octetIndex,
            Weight: weight,
          };
        }

        /**
         * 八位组下标必须是 Uint32，并且小于 Cells 的长度。
         * 失败颗粒长度为 0，因此没有任何合法下标。
         */
        private locateOctet(
          octetIndex: Uint32Root.Hardware.Memory.Uint32,
        ): number | null {
          const gated: Uint32Root.Hardware.Memory.Uint32 | null =
            Uint32Root.Hardware.Memory.toUint32(octetIndex);
          if (gated === null || gated >= this.Cells.length) {
            return null;
          }
          return gated;
        }

        /**
         * 端口失败：Exceptions 先记下 Abort，再抛出，调用方拿不到成功返回。
         * 抛出是官方实现的宿主映射；协议要求的是不得正常返回成功值。
         */
        private failPort(params: {
          readonly ExceptionCode: number;
          readonly ExceptionCategory: ExceptionCategoryRoot.Hardware.Memory.ExceptionCategory;
          readonly ExceptionSummary: string;
          readonly ExceptionChain: object;
        }): never {
          this.recordExceptionOrAbort(params);
          throw new Error(
            `[ZerOS.Hardware.Memory.MemoryUnit] ${params.ExceptionSummary}`,
          );
        }
      }

      /**
       * 位元在八位组载体中的位置。Weight = 2^BitOffset，且 BitOffset 0 是最低有效位。
       * 只在本文件的端口实现里使用，不是协议字段。
       */
      interface BitPlace {
        readonly OctetIndex: number;
        readonly Weight: number;
      }
    }
  }
}
