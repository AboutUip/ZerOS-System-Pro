/**
 * @module ZerOS.Hardware.Memory.Controller
 * @description 内存总控（MemoryController）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 仅承载 MemoryController 类：Units 关联表、按序号排列的颗粒、浅切 Blocks、
 * 总控 Exceptions、跨颗粒端口，以及在浅切完成之后将成功颗粒推进至正式可用（0x4）。
 * 索引 ID、冻结 Map、异常结构/枚举已拆至独立文件。
 *
 * 概念分层（InitState · ZMP1 §4.12 主路径）：
 *   - MemoryUnit 实例化：0x0 → 0x1 → 0x3（成功）/ 0x2（失败）/ 0x5（无法恢复）
 *   - MemoryController（本文件）：颗粒关联完成后做浅切（Blocks），
 *       然后仅将 0x3 更新为 0x4；0x2 / 0x5 保持不动
 *   - 仅 0x4 在 ZMP1 中算正式可用
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 依赖导入
 *   2. MemoryController 类
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as MemoryConfigRoot } from "../Config/MemoryConfig";
import { ZerOS as MemoryUnitRoot } from "../Unit/MemoryUnit";
import { ZerOS as MemoryBlockRoot } from "../Block/MemoryBlock";
import { ZerOS as Uint32Root } from "../Structure/Uint32";
import { ZerOS as UnitOrdinalRoot } from "../Structure/UnitOrdinal";
import { ZerOS as BlockSpanRoot } from "../Structure/BlockSpan";
import type { ZerOS as OctetValueRoot } from "../Structure/OctetValue";
import type { ZerOS as BitValueRoot } from "../Enum/BitValue";
import { ZerOS as UnitInitStateRoot } from "../Enum/UnitInitState";
import { ZerOS as UnitIndexIdRoot } from "../Structure/UnitIndexId";
import { ZerOS as FreezeUnitMapRoot } from "./FreezeUnitMap";
import { ZerOS as MemoryExceptionRoot } from "../Structure/MemoryException";
import { ZerOS as ExceptionCategoryRoot } from "../Enum/ExceptionCategory";
import { ZerOS as ExceptionCodeRoot } from "../Enum/ExceptionCode";
import { ZerOS as EventCodeRoot } from "../Enum/EventCode";
import { ZerOS as SignalCodeRoot } from "../Enum/SignalCode";
import type { ZerOS as MemoryEventRoot } from "../Structure/MemoryEvent";
import type { ZerOS as MemorySignalRoot } from "../Structure/MemorySignal";
import { ZerOS as SideChannelRoot } from "../Structure/SideChannel";
import { ZerOS as Uint64Root } from "../Structure/Uint64";
import { ZerOS as FloatBitsRoot } from "../Structure/FloatBits";
import { ZerOS as LittleEndianRoot } from "../Structure/LittleEndian";
import { ZerOS as IntegerWidthRoot } from "../Enum/IntegerWidth";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      /* -------------------------------------------------------------------- */
      /* 2. MemoryController                                                   */
      /* -------------------------------------------------------------------- */

      /**
       * MemoryController：内存总控。
       *
       * 建立并持有「索引 ID → 颗粒」关联；不负责 ZMP1 MemoryId。
       * 条目数强制等于 Config.UnitCount；键由内置 RNG 动态生成。
       */
      export class MemoryController {
        /**
         * 颗粒关联表：UnitIndexId → MemoryUnit（构造后冻结条目）。
         */
        public readonly Units: ReadonlyMap<
          UnitIndexIdRoot.Hardware.Memory.UnitIndexId,
          MemoryUnitRoot.Hardware.Memory.MemoryUnit
        >;

        /**
         * 按 UnitOrdinal 排好的颗粒。下标就是序号。
         * 不是协议字段；协议可见的序号在每一颗的 UnitOrdinal 上。
         * Units 的键仍是实现自己的 UnitIndexId。
         */
        private readonly UnitsByOrdinal: readonly MemoryUnitRoot.Hardware.Memory.MemoryUnit[];

        /**
         * 浅切所得的内存块序列（ZMP1 §4.16 / §4.20）。
         * 长度必须等于 ShallowDimension。每一块用 BitLength 覆盖位元线上的一段。
         * 不是「第 i 块等于第 i 颗」。
         */
        public readonly Blocks: readonly MemoryBlockRoot.Hardware.Memory.MemoryBlock[];

        /**
         * 总控级异常数组：元素为 MemoryException。
         */
        public readonly Exceptions: MemoryExceptionRoot.Hardware.Memory.MemoryException[];

        /**
         * 总控级事件。浅切、加深、领取、归还记在这里。
         */
        public readonly Events: MemoryEventRoot.Hardware.Memory.MemoryEvent[];

        /**
         * 总控级信号。Ready 表示至少有一颗颗粒已经正式可用。
         */
        public readonly Signals: MemorySignalRoot.Hardware.Memory.MemorySignal[];

        /**
         * 构造总控（ZMP1 主路径阶段 D：全部初始化完成后正式可用）：
         *   (0) 空 Exceptions，空序号表
         *   (1) 检查 UnitCount（1 .. 4294967296）
         *   (2) 填工作 Map（new MemoryUnit(序号)：实例化内完成 0x0→0x1→0x3|0x2|0x5）
         *   (3) 断言 size === UnitCount
         *   (4) freezeUnitMap
         *   (5) 浅切：Blocks 长度 = ShallowDimension，每块 NestingDepth = 1，并写入 BitLength
         *   (6) 成功路径：InitComplete(0x3) → Active(0x4)。不改 Cells / CellCount / UnitOrdinal / Blocks
         */
        public constructor() {
          this.Exceptions = [];
          this.Events = [];
          this.Signals = [];
          this.UnitsByOrdinal = [];

          const count: MemoryConfigRoot.Hardware.Memory.UnitCount =
            MemoryConfigRoot.Hardware.Memory.Config.UnitCount;
          const maxCount: number = UnitOrdinalRoot.Hardware.Memory.MaxUnitCount;
          if (!Number.isInteger(count) || count < 1 || count > maxCount) {
            this.Units = FreezeUnitMapRoot.Hardware.Memory.freezeUnitMap(
              new Map(),
            );
            this.recordAndThrow({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                  .IllegalUnitCount,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode
                  .Abort,
              ExceptionSummary: `非法颗粒数量 UnitCount=${String(count)}，须为 1 至 ${String(maxCount)} 的整数`,
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryController.constructor",
                Field: "UnitCount",
                Value: count,
              },
            });
          }

          const working = new Map<
            UnitIndexIdRoot.Hardware.Memory.UnitIndexId,
            MemoryUnitRoot.Hardware.Memory.MemoryUnit
          >();

          const byOrdinal: MemoryUnitRoot.Hardware.Memory.MemoryUnit[] = [];

          const InitComplete: UnitInitStateRoot.Hardware.Memory.UnitInitState =
            UnitInitStateRoot.Hardware.Memory.UnitInitStateCode.InitComplete;
          const Active: UnitInitStateRoot.Hardware.Memory.UnitInitState =
            UnitInitStateRoot.Hardware.Memory.UnitInitStateCode.Active;

          // —— (2) 建关联：颗粒实例化由 MemoryUnit 完成主路径 A→B→C ——
          while (working.size < count) {
            try {
              const id: UnitIndexIdRoot.Hardware.Memory.UnitIndexId =
                this.generateUnitIndexId();
              if (working.has(id)) {
                continue;
              }
              const ordinal: Uint32Root.Hardware.Memory.Uint32 | null =
                Uint32Root.Hardware.Memory.toUint32(working.size);
              if (ordinal === null) {
                this.Units =
                  FreezeUnitMapRoot.Hardware.Memory.freezeUnitMap(working);
                this.recordAndThrow({
                  ExceptionCode:
                    ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                      .IllegalUnitCount,
                  ExceptionCategory:
                    ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode
                      .Abort,
                  ExceptionSummary: `颗粒序号 ${String(working.size)} 不是 Uint32`,
                  ExceptionChain: {
                    Source:
                      "ZerOS.Hardware.Memory.MemoryController.constructor",
                    Field: "UnitOrdinal",
                    Value: working.size,
                  },
                });
              }
              const unit: MemoryUnitRoot.Hardware.Memory.MemoryUnit =
                new MemoryUnitRoot.Hardware.Memory.MemoryUnit(ordinal);
              working.set(id, unit);
              byOrdinal.push(unit);
            } catch (caught: unknown) {
              const alreadyRecorded: boolean = this.Exceptions.length > 0;
              this.Blocks = Object.freeze([]);
              if (!alreadyRecorded) {
                this.Units =
                  FreezeUnitMapRoot.Hardware.Memory.freezeUnitMap(working);
                this.recordAndThrow({
                  ExceptionCode:
                    ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                      .Unspecified,
                  ExceptionCategory:
                    ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode
                      .Abort,
                  ExceptionSummary: "总控构造循环中发生不可处理异常",
                  ExceptionChain: {
                    Source:
                      "ZerOS.Hardware.Memory.MemoryController.constructor",
                    Cause:
                      caught instanceof Error
                        ? { Name: caught.name, Message: caught.message }
                        : { Raw: String(caught) },
                  },
                });
              }
              throw caught;
            }
          }

          // —— (3) 数量必须与标定一致 ——
          if (working.size !== count) {
            this.Units =
              FreezeUnitMapRoot.Hardware.Memory.freezeUnitMap(working);
            this.recordAndThrow({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                  .IllegalUnitCount,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode
                  .Abort,
              ExceptionSummary: `关联表大小 ${String(working.size)} 必须等于 UnitCount=${String(count)}`,
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryController.constructor",
                WorkingSize: working.size,
                UnitCount: count,
              },
            });
          }

          // —— (4) 冻结条目结构。序号表与 Map 装的是同一批颗粒 ——
          this.Units =
            FreezeUnitMapRoot.Hardware.Memory.freezeUnitMap(working);
          this.UnitsByOrdinal = Object.freeze(byOrdinal);

          // —— (5) 浅切必须先完成，才允许进入阶段 D ——
          // 块数 = ShallowDimension。跨度按各颗 CellCount 拼接后均分。
          this.Blocks = this.cutShallowBlocks();

          // —— (6) 阶段 D：全部初始化完成 → 仅 0x3 升为 0x4（正式可用）——
          // 0x2 / 0x5 禁止冒充正式可用。
          // 本步只改 InitState；禁止改写 Cells / CellCount / UnitOrdinal / Blocks。
          let ready: SignalCodeRoot.Hardware.Memory.SignalLevel = 0;
          for (const unit of this.Units.values()) {
            if (unit.InitState === InitComplete) {
              unit.promoteToActive();
            }
            if (unit.InitState === Active) {
              ready = 1;
            }
          }
          const shallowSubject: Uint32Root.Hardware.Memory.Uint32 | null =
            Uint32Root.Hardware.Memory.toUint32(this.Blocks.length);
          if (shallowSubject !== null) {
            SideChannelRoot.Hardware.Memory.appendEvent(
              this.Events,
              EventCodeRoot.Hardware.Memory.EventCodeValue.ShallowCutCompleted,
              shallowSubject,
              Uint32Root.Hardware.Memory.Uint32Zero,
            );
          }
          SideChannelRoot.Hardware.Memory.upsertSignal(
            this.Signals,
            SignalCodeRoot.Hardware.Memory.SignalCodeValue.Ready,
            ready,
            Uint32Root.Hardware.Memory.Uint32Zero,
          );
        }

        /**
         * 按浅维度切出内存块（ZMP1 §4.16）。
         *
         * 块数必须等于 ShallowDimension。每块 NestingDepth 固定为 1，
         * 并且必须 ≤ DeepDimension。失败时 Abort 并抛出，调用方得不到序列。
         */
        private cutShallowBlocks(): readonly MemoryBlockRoot.Hardware.Memory.MemoryBlock[] {
          const rawShallow: number =
            MemoryConfigRoot.Hardware.Memory.Config.ShallowDimension;
          const shallow: Uint32Root.Hardware.Memory.Uint32 | null =
            Uint32Root.Hardware.Memory.toUint32(rawShallow);
          if (shallow === null || shallow < 1) {
            this.recordAndThrow({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                  .IllegalShallowDimension,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode
                  .Abort,
              ExceptionSummary: `非法浅维度 ShallowDimension=${String(rawShallow)}，须为 1 至 4294967295 的整数`,
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryController.cutShallowBlocks",
                Field: "ShallowDimension",
                Value: rawShallow,
              },
            });
          }

          const rawDeep: number =
            MemoryConfigRoot.Hardware.Memory.Config.DeepDimension;
          const deep: Uint32Root.Hardware.Memory.Uint32 | null =
            Uint32Root.Hardware.Memory.toUint32(rawDeep);
          if (deep === null || deep < 1) {
            this.recordAndThrow({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                  .IllegalDeepDimension,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode
                  .Abort,
              ExceptionSummary: `非法深维度 DeepDimension=${String(rawDeep)}，须为 1 至 4294967295 的整数`,
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryController.cutShallowBlocks",
                Field: "DeepDimension",
                Value: rawDeep,
              },
            });
          }

          const cellCounts: Uint32Root.Hardware.Memory.Uint32[] = [];
          for (const unit of this.UnitsByOrdinal) {
            cellCounts.push(unit.CellCount);
          }
          const frozenCounts: readonly Uint32Root.Hardware.Memory.Uint32[] =
            Object.freeze(cellCounts);
          // 总和可以超过 Uint32。bigint 除法才是协议里的向下取整。
          const totalBits: bigint =
            BlockSpanRoot.Hardware.Memory.totalBitCount(frozenCounts);
          const fail: MemoryBlockRoot.Hardware.Memory.MemoryBlockParams["fail"] =
            (params): never => this.recordAndThrow(params);
          const unitAt: MemoryBlockRoot.Hardware.Memory.MemoryBlockParams["unitAt"] =
            (unitOrdinal): MemoryUnitRoot.Hardware.Memory.MemoryUnit | null => {
              const gated: Uint32Root.Hardware.Memory.Uint32 | null =
                Uint32Root.Hardware.Memory.toUint32(unitOrdinal);
              if (gated === null || gated >= this.UnitsByOrdinal.length) {
                return null;
              }
              return this.UnitsByOrdinal[gated] ?? null;
            };

          const blocks: MemoryBlockRoot.Hardware.Memory.MemoryBlock[] = [];
          let index = 0;
          while (index < shallow) {
            const blockIndex: Uint32Root.Hardware.Memory.Uint32 | null =
              Uint32Root.Hardware.Memory.toUint32(index);
            if (blockIndex === null) {
              this.recordAndThrow({
                ExceptionCode:
                  ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                    .IllegalShallowDimension,
                ExceptionCategory:
                  ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode
                    .Abort,
                ExceptionSummary: `浅切下标 ${String(index)} 不是 Uint32`,
                ExceptionChain: {
                  Source:
                    "ZerOS.Hardware.Memory.MemoryController.cutShallowBlocks",
                  Field: "BlockIndex",
                  Value: index,
                },
              });
            }

            const range: { readonly Start: bigint; readonly Length: bigint } =
              BlockSpanRoot.Hardware.Memory.rangeOfBlock(
                blockIndex,
                shallow,
                totalBits,
              );
            const bitLength: Uint32Root.Hardware.Memory.Uint32 | null =
              BlockSpanRoot.Hardware.Memory.bitLengthAsUint32(range.Length);
            if (bitLength === null) {
              this.recordAndThrow({
                ExceptionCode:
                  ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                    .BlockSpanExceedsUint32,
                ExceptionCategory:
                  ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode
                    .Abort,
                ExceptionSummary: `BlockIndex=${String(blockIndex)} 的位元跨度 ${range.Length.toString()} 超出 Uint32`,
                ExceptionChain: {
                  Source:
                    "ZerOS.Hardware.Memory.MemoryController.cutShallowBlocks",
                  Field: "BitLength",
                  BlockIndex: blockIndex,
                  BitLength: range.Length.toString(),
                },
              });
            }

            const block: MemoryBlockRoot.Hardware.Memory.MemoryBlock =
              new MemoryBlockRoot.Hardware.Memory.MemoryBlock({
                BlockIndex: blockIndex,
                NestingDepth:
                  MemoryBlockRoot.Hardware.Memory.NestingDepthAtShallowCut,
                ChildIndex: null,
                BitLength: bitLength,
                StartLinear: range.Start,
                ShallowDimension: shallow,
                DeepDimension: deep,
                CellCounts: frozenCounts,
                unitAt,
                fail,
                deepened: (
                  blockIndex: Uint32Root.Hardware.Memory.Uint32,
                  childDepth: Uint32Root.Hardware.Memory.Uint32,
                ): void => {
                  SideChannelRoot.Hardware.Memory.appendEvent(
                    this.Events,
                    EventCodeRoot.Hardware.Memory.EventCodeValue.Deepened,
                    blockIndex,
                    childDepth,
                  );
                },
              });
            const depth: Uint32Root.Hardware.Memory.Uint32 = block.NestingDepth;
            if (
              depth < 1 ||
              depth > deep ||
              block.Children.length !== 0
            ) {
              this.recordAndThrow({
                ExceptionCode:
                  ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                    .IllegalDeepDimension,
                ExceptionCategory:
                  ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode
                    .Abort,
                ExceptionSummary: `浅切后 NestingDepth=${String(depth)} 必须为 1 且不超过 DeepDimension=${String(deep)}，并且还没有子块`,
                ExceptionChain: {
                  Source:
                    "ZerOS.Hardware.Memory.MemoryController.cutShallowBlocks",
                  Field: "NestingDepth",
                  Value: depth,
                  DeepDimension: deep,
                },
              });
            }
            blocks.push(block);
            index += 1;
          }

          if (blocks.length !== shallow) {
            this.recordAndThrow({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                  .IllegalShallowDimension,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode
                  .Abort,
              ExceptionSummary: `浅切块数 ${String(blocks.length)} 必须等于 ShallowDimension=${String(shallow)}`,
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryController.cutShallowBlocks",
                BlockCount: blocks.length,
                ShallowDimension: shallow,
              },
            });
          }

          // 冻结根序列：禁止增删浅切根。Deepen 只改某一块自己的 Children。
          return Object.freeze(blocks);
        }

        /**
         * 跨颗粒读取一个位元（ZMP1 §4.19）。
         * 序号先检查。序号合法之后，失败由那一颗自己记入它的 Exceptions。
         */
        public ReadBit(
          UnitOrdinal: Uint32Root.Hardware.Memory.Uint32,
          CellIndex: Uint32Root.Hardware.Memory.Uint32,
        ): BitValueRoot.Hardware.Memory.BitValue {
          const unit: MemoryUnitRoot.Hardware.Memory.MemoryUnit =
            this.requireUnit(UnitOrdinal);
          return unit.ReadBit(CellIndex);
        }

        /**
         * 跨颗粒写入一个位元（ZMP1 §4.19）。
         * 序号越界时不调用颗粒，存储体保持原样。
         */
        public WriteBit(
          UnitOrdinal: Uint32Root.Hardware.Memory.Uint32,
          CellIndex: Uint32Root.Hardware.Memory.Uint32,
          BitValue: number,
        ): void {
          const unit: MemoryUnitRoot.Hardware.Memory.MemoryUnit =
            this.requireUnit(UnitOrdinal);
          unit.WriteBit(CellIndex, BitValue);
        }

        /**
         * 跨颗粒读取一个八位组（ZMP1 §4.19）。
         */
        public ReadOctet(
          UnitOrdinal: Uint32Root.Hardware.Memory.Uint32,
          OctetIndex: Uint32Root.Hardware.Memory.Uint32,
        ): OctetValueRoot.Hardware.Memory.OctetValue {
          const unit: MemoryUnitRoot.Hardware.Memory.MemoryUnit =
            this.requireUnit(UnitOrdinal);
          return unit.ReadOctet(OctetIndex);
        }

        /**
         * 跨颗粒写入一个八位组（ZMP1 §4.19）。
         * 写入值是否落在 0–255，由颗粒上的 WriteOctet 判定。
         */
        public WriteOctet(
          UnitOrdinal: Uint32Root.Hardware.Memory.Uint32,
          OctetIndex: Uint32Root.Hardware.Memory.Uint32,
          OctetValue: number,
        ): void {
          const unit: MemoryUnitRoot.Hardware.Memory.MemoryUnit =
            this.requireUnit(UnitOrdinal);
          unit.WriteOctet(OctetIndex, OctetValue);
        }

        /**
         * 跨颗粒读取一个小端整数（ZMP1 §4.24）。
         * 序号合法之后，宽度和跨度由那一颗自己判定。
         */
        public ReadInteger(
          UnitOrdinal: Uint32Root.Hardware.Memory.Uint32,
          OctetIndex: Uint32Root.Hardware.Memory.Uint32,
          OctetWidth: number,
        ): bigint {
          const unit: MemoryUnitRoot.Hardware.Memory.MemoryUnit =
            this.requireUnit(UnitOrdinal);
          return unit.ReadInteger(OctetIndex, OctetWidth);
        }

        /**
         * 跨颗粒写入一个小端整数（ZMP1 §4.24）。
         * 整数不得跨出这一颗。
         */
        public WriteInteger(
          UnitOrdinal: Uint32Root.Hardware.Memory.Uint32,
          OctetIndex: Uint32Root.Hardware.Memory.Uint32,
          OctetWidth: number,
          IntegerValue: bigint,
        ): void {
          const unit: MemoryUnitRoot.Hardware.Memory.MemoryUnit =
            this.requireUnit(UnitOrdinal);
          unit.WriteInteger(OctetIndex, OctetWidth, IntegerValue);
        }

        /**
         * 按整机位元线读取一个位元（ZMP1 §4.23 规范方法名 `ReadLinearBit`）。
         * 地址 = 前面各颗 CellCount 之和 + 目标位元下标。
         */
        public ReadLinearBit(LinearBitIndex: bigint): BitValueRoot.Hardware.Memory.BitValue {
          const place: BlockSpanRoot.Hardware.Memory.LinearPlace =
            this.requireLinearBit(LinearBitIndex);
          return this.requireUnit(place.UnitOrdinal).ReadBit(place.CellIndex);
        }

        /**
         * 按整机位元线写入一个位元（ZMP1 §4.23 规范方法名 `WriteLinearBit`）。
         */
        public WriteLinearBit(LinearBitIndex: bigint, BitValue: number): void {
          const place: BlockSpanRoot.Hardware.Memory.LinearPlace =
            this.requireLinearBit(LinearBitIndex);
          this.requireUnit(place.UnitOrdinal).WriteBit(place.CellIndex, BitValue);
        }

        /**
         * 按整机八位组线读取一个小端整数（ZMP1 §4.24 规范方法名 `ReadLinearInteger`）。
         * 可以跨过颗粒边界。最低的线性八位组是最低有效字节。
         */
        public ReadLinearInteger(LinearOctetIndex: bigint, OctetWidth: number): bigint {
          const octets: readonly number[] = this.readLinearOctets(LinearOctetIndex, OctetWidth);
          return LittleEndianRoot.Hardware.Memory.signedFromLittleEndian(octets);
        }

        /**
         * 按整机八位组线写入一个小端整数（ZMP1 §4.24 规范方法名 `WriteLinearInteger`）。
         * 跨度或值不合法时不改存储体。
         */
        public WriteLinearInteger(
          LinearOctetIndex: bigint,
          OctetWidth: number,
          IntegerValue: bigint,
        ): void {
          const width: IntegerWidthRoot.Hardware.Memory.IntegerWidth | null =
            IntegerWidthRoot.Hardware.Memory.toIntegerWidth(OctetWidth);
          if (width === null) {
            this.recordAndThrow({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.IllegalIntegerWidth,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
              ExceptionSummary: `OctetWidth=${String(OctetWidth)} 不是 2、4 或 8`,
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryController.WriteLinearInteger",
              },
            });
          }
          const unpacked: number[] | null =
            LittleEndianRoot.Hardware.Memory.unpackLittleEndian(IntegerValue, width);
          if (unpacked === null) {
            this.recordAndThrow({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.IllegalIntegerValue,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
              ExceptionSummary: "IntegerValue 超出该宽度",
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryController.WriteLinearInteger",
              },
            });
          }
          const places: readonly BlockSpanRoot.Hardware.Memory.LinearPlace[] =
            this.requireLinearOctets(LinearOctetIndex, width);
          // 先收齐每一个落点。中途对不上就 Abort，此时一个八位组都还没写。
          const planned: {
            readonly unitOrdinal: Uint32Root.Hardware.Memory.Uint32;
            readonly octetIndex: Uint32Root.Hardware.Memory.Uint32;
            readonly octet: number;
          }[] = [];
          let step = 0;
          while (step < places.length) {
            const place: BlockSpanRoot.Hardware.Memory.LinearPlace | undefined = places[step];
            const octet: number | undefined = unpacked[step];
            const octetIndex: Uint32Root.Hardware.Memory.Uint32 | null =
              place === undefined ? null : Uint32Root.Hardware.Memory.toUint32(place.CellIndex / 8);
            if (
              place === undefined ||
              octet === undefined ||
              octetIndex === null ||
              place.CellIndex % 8 !== 0
            ) {
              this.recordAndThrow({
                ExceptionCode:
                  ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.IntegerSpanOutOfRange,
                ExceptionCategory:
                  ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
                ExceptionSummary: "线性整数的落点在写入前对不上八位组",
                ExceptionChain: {
                  Source: "ZerOS.Hardware.Memory.MemoryController.WriteLinearInteger",
                },
              });
            }
            planned.push({
              unitOrdinal: place.UnitOrdinal,
              octetIndex,
              octet,
            });
            step += 1;
          }
          for (const item of planned) {
            this.requireUnit(item.unitOrdinal).WriteOctet(item.octetIndex, item.octet);
          }
        }

        /**
         * 读一个有限浮点（ZMP1 §4.28）。
         * 八位组先按补码整数读出，再按该宽度的浮点格式交回有限数。
         */
        public ReadLinearFloat(LinearOctetIndex: bigint, OctetWidth: number): number {
          const width = FloatBitsRoot.Hardware.Memory.toFloatWidth(OctetWidth);
          if (width === null) {
            this.recordAndThrow({
              ExceptionCode: ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.IllegalIntegerWidth,
              ExceptionCategory: ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
              ExceptionSummary: `OctetWidth=${String(OctetWidth)} 不是 4 或 8`,
              ExceptionChain: { Source: "ZerOS.Hardware.Memory.MemoryController.ReadLinearFloat" },
            });
          }
          const bits = this.ReadLinearInteger(LinearOctetIndex, width);
          const value = FloatBitsRoot.Hardware.Memory.signedBitsToFloat(bits, width);
          if (value === null) {
            this.recordAndThrow({
              ExceptionCode: ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.IllegalIntegerValue,
              ExceptionCategory: ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
              ExceptionSummary: "浮点位型不是有限数",
              ExceptionChain: { Source: "ZerOS.Hardware.Memory.MemoryController.ReadLinearFloat" },
            });
          }
          return value;
        }

        /**
         * 写一个有限浮点（ZMP1 §4.28）。
         * 先收成补码位型，再交给已经有的小端整数写入。失败时存储体不变。
         */
        public WriteLinearFloat(LinearOctetIndex: bigint, OctetWidth: number, Value: number): void {
          const width = FloatBitsRoot.Hardware.Memory.toFloatWidth(OctetWidth);
          if (width === null) {
            this.recordAndThrow({
              ExceptionCode: ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.IllegalIntegerWidth,
              ExceptionCategory: ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
              ExceptionSummary: `OctetWidth=${String(OctetWidth)} 不是 4 或 8`,
              ExceptionChain: { Source: "ZerOS.Hardware.Memory.MemoryController.WriteLinearFloat" },
            });
          }
          const bits = FloatBitsRoot.Hardware.Memory.floatToSignedBits(Value, width);
          if (bits === null) {
            this.recordAndThrow({
              ExceptionCode: ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.IllegalIntegerValue,
              ExceptionCategory: ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
              ExceptionSummary: "浮点不是该宽度能表示的有限数",
              ExceptionChain: { Source: "ZerOS.Hardware.Memory.MemoryController.WriteLinearFloat" },
            });
          }
          this.WriteLinearInteger(LinearOctetIndex, width, bits);
        }

        /**
         * 领取一枚浅切根（ZMP1 §4.26 规范方法名 `Claim`）。
         * 不改存储体。已经有主人时拒绝。
         */
        public Claim(
          BlockIndex: Uint32Root.Hardware.Memory.Uint32,
          Owner: Uint32Root.Hardware.Memory.Uint32,
        ): void {
          const block: MemoryBlockRoot.Hardware.Memory.MemoryBlock =
            this.requireRoot(BlockIndex);
          const owner: Uint32Root.Hardware.Memory.Uint32 | null =
            Uint32Root.Hardware.Memory.toUint32(Owner);
          if (owner === null) {
            this.recordAndThrow({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.OwnerMismatch,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
              ExceptionSummary: "Owner 不是 Uint32",
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryController.Claim",
              },
            });
          }
          if (block.Owner !== null) {
            this.recordAndThrow({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.AlreadyClaimed,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
              ExceptionSummary: `BlockIndex=${String(BlockIndex)} 已经有主人`,
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryController.Claim",
              },
            });
          }
          block.Owner = owner;
          SideChannelRoot.Hardware.Memory.appendEvent(
            this.Events,
            EventCodeRoot.Hardware.Memory.EventCodeValue.Claimed,
            block.BlockIndex,
            owner,
          );
        }

        /**
         * 归还一枚浅切根（ZMP1 §4.26 规范方法名 `Release`）。
         * 主人一致时，清掉这块覆盖的全部位元，再把 Owner 放回 null。
         */
        public Release(
          BlockIndex: Uint32Root.Hardware.Memory.Uint32,
          Owner: Uint32Root.Hardware.Memory.Uint32,
        ): void {
          const block: MemoryBlockRoot.Hardware.Memory.MemoryBlock =
            this.requireRoot(BlockIndex);
          const owner: Uint32Root.Hardware.Memory.Uint32 | null =
            Uint32Root.Hardware.Memory.toUint32(Owner);
          if (owner === null || block.Owner === null) {
            this.recordAndThrow({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.NotClaimed,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
              ExceptionSummary: `BlockIndex=${String(BlockIndex)} 还没有主人`,
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryController.Release",
              },
            });
          }
          if (block.Owner !== owner) {
            this.recordAndThrow({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.OwnerMismatch,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
              ExceptionSummary: `BlockIndex=${String(BlockIndex)} 的主人不一致`,
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryController.Release",
              },
            });
          }
          const counts: Uint32Root.Hardware.Memory.Uint32[] = [];
          for (const unit of this.UnitsByOrdinal) {
            counts.push(unit.CellCount);
          }
          const range: { readonly Start: bigint; readonly Length: bigint } =
            BlockSpanRoot.Hardware.Memory.rangeOfBlock(
              block.BlockIndex,
              Uint32Root.Hardware.Memory.uint32OrThrow(
                this.Blocks.length,
                "ZerOS.Hardware.Memory.MemoryController.Release",
              ),
              BlockSpanRoot.Hardware.Memory.totalBitCount(counts),
            );
          this.clearLinear(range.Start, range.Length, counts);
          block.Owner = null;
          SideChannelRoot.Hardware.Memory.appendEvent(
            this.Events,
            EventCodeRoot.Hardware.Memory.EventCodeValue.Released,
            block.BlockIndex,
            owner,
          );
        }

        /**
         * 序号必须是 Uint32，并且 0 ≤ UnitOrdinal < UnitCount。
         * 失败记在总控 Exceptions，标号 UnitOrdinalOutOfRange。
         */
        private requireUnit(
          unitOrdinal: Uint32Root.Hardware.Memory.Uint32,
        ): MemoryUnitRoot.Hardware.Memory.MemoryUnit {
          const count: number =
            MemoryConfigRoot.Hardware.Memory.Config.UnitCount;
          const gated: Uint32Root.Hardware.Memory.Uint32 | null =
            Uint32Root.Hardware.Memory.toUint32(unitOrdinal);
          const unit: MemoryUnitRoot.Hardware.Memory.MemoryUnit | undefined =
            gated === null ? undefined : this.UnitsByOrdinal[gated];
          if (
            gated === null ||
            gated >= count ||
            unit?.UnitOrdinal !== gated
          ) {
            this.recordAndThrow({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                  .UnitOrdinalOutOfRange,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode
                  .Abort,
              ExceptionSummary: `UnitOrdinal=${String(unitOrdinal)} 越出 0 至 ${String(count)} 之前`,
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryController.requireUnit",
                Field: "UnitOrdinal",
                Value: unitOrdinal,
                UnitCount: count,
              },
            });
          }
          return unit;
        }

        /**
         * 内置 RNG：产出定长 UnitIndexId（拒绝采样；非 ZMP1 MemoryId）。
         */
        private generateUnitIndexId(): UnitIndexIdRoot.Hardware.Memory.UnitIndexId {
          const alphabet: string =
            UnitIndexIdRoot.Hardware.Memory.UnitIndexIdAlphabet;
          const alphabetLength: number = alphabet.length;
          if (alphabetLength < 2) {
            this.recordAndThrow({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                  .UnitIndexAlphabetInvalid,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode
                  .Abort,
              ExceptionSummary: "索引 ID 字符表非法（长度须 ≥ 2）",
              ExceptionChain: {
                Source:
                  "ZerOS.Hardware.Memory.MemoryController.generateUnitIndexId",
                AlphabetLength: alphabetLength,
              },
            });
          }

          const cryptoApi: Crypto = globalThis.crypto;
          if (typeof cryptoApi.getRandomValues !== "function") {
            this.recordAndThrow({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                  .CryptoUnavailable,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode
                  .Abort,
              ExceptionSummary:
                "环境缺少 crypto.getRandomValues，无法生成颗粒索引 ID",
              ExceptionChain: {
                Source:
                  "ZerOS.Hardware.Memory.MemoryController.generateUnitIndexId",
              },
            });
          }

          const chars: string[] = [];
          const rejectionLimit: number =
            Math.floor(256 / alphabetLength) * alphabetLength;
          const idLength: number =
            UnitIndexIdRoot.Hardware.Memory.UnitIndexIdLength;

          while (chars.length < idLength) {
            const bucket = new Uint8Array(1);
            cryptoApi.getRandomValues(bucket);
            const sample: number | undefined = bucket[0];
            if (sample === undefined || sample >= rejectionLimit) {
              continue;
            }
            const pick: number = sample % alphabetLength;
            const ch: string | undefined = alphabet[pick];
            if (ch === undefined) {
              continue;
            }
            chars.push(ch);
          }

          return chars.join("");
        }

        /**
         * 线性位元地址必须是 Uint64，并且落在位元线内。
         */
        private requireLinearBit(
          linearBitIndex: bigint,
        ): BlockSpanRoot.Hardware.Memory.LinearPlace {
          const gated: Uint64Root.Hardware.Memory.Uint64 | null =
            Uint64Root.Hardware.Memory.toUint64(linearBitIndex);
          const counts: Uint32Root.Hardware.Memory.Uint32[] = [];
          for (const unit of this.UnitsByOrdinal) {
            counts.push(unit.CellCount);
          }
          const place: BlockSpanRoot.Hardware.Memory.LinearPlace | null =
            gated === null
              ? null
              : BlockSpanRoot.Hardware.Memory.locateLinear(gated, counts);
          if (place === null) {
            this.recordAndThrow({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                  .LinearBitIndexOutOfRange,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
              ExceptionSummary: "LinearBitIndex 越出整机位元线",
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryController.requireLinearBit",
              },
            });
          }
          return place;
        }

        /**
         * 线性八位组必须按 8 位对齐落在某一颗上，并且连续 width 个都存在。
         */
        private requireLinearOctets(
          linearOctetIndex: bigint,
          width: IntegerWidthRoot.Hardware.Memory.IntegerWidth,
        ): readonly BlockSpanRoot.Hardware.Memory.LinearPlace[] {
          const gated: Uint64Root.Hardware.Memory.Uint64 | null =
            Uint64Root.Hardware.Memory.toUint64(linearOctetIndex);
          if (gated === null) {
            this.recordAndThrow({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.IntegerSpanOutOfRange,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
              ExceptionSummary: "LinearOctetIndex 不是 Uint64",
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryController.requireLinearOctets",
              },
            });
          }
          const counts: Uint32Root.Hardware.Memory.Uint32[] = [];
          for (const unit of this.UnitsByOrdinal) {
            counts.push(unit.CellCount);
          }
          const places: BlockSpanRoot.Hardware.Memory.LinearPlace[] = [];
          let step = 0;
          while (step < width) {
            const bit: bigint = (gated + BigInt(step)) * 8n;
            const place: BlockSpanRoot.Hardware.Memory.LinearPlace | null =
              BlockSpanRoot.Hardware.Memory.locateLinear(bit, counts);
            if (place === null || place.CellIndex % 8 !== 0) {
              this.recordAndThrow({
                ExceptionCode:
                  ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                    .IntegerSpanOutOfRange,
                ExceptionCategory:
                  ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
                ExceptionSummary: "线性整数跨度越出整机八位组",
                ExceptionChain: {
                  Source: "ZerOS.Hardware.Memory.MemoryController.requireLinearOctets",
                },
              });
            }
            places.push(place);
            step += 1;
          }
          return places;
        }

        /**
         * 读出线性整数要用的八位组。宽度非法时先拒绝，避免读一半。
         */
        private readLinearOctets(linearOctetIndex: bigint, octetWidth: number): readonly number[] {
          const width: IntegerWidthRoot.Hardware.Memory.IntegerWidth | null =
            IntegerWidthRoot.Hardware.Memory.toIntegerWidth(octetWidth);
          if (width === null) {
            this.recordAndThrow({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.IllegalIntegerWidth,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
              ExceptionSummary: `OctetWidth=${String(octetWidth)} 不是 2、4 或 8`,
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryController.readLinearOctets",
              },
            });
          }
          const places: readonly BlockSpanRoot.Hardware.Memory.LinearPlace[] =
            this.requireLinearOctets(linearOctetIndex, width);
          const octets: number[] = [];
          for (const place of places) {
            const octetIndex: Uint32Root.Hardware.Memory.Uint32 | null =
              Uint32Root.Hardware.Memory.toUint32(place.CellIndex / 8);
            if (octetIndex === null) {
              this.recordAndThrow({
                ExceptionCode:
                  ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.IntegerSpanOutOfRange,
                ExceptionCategory:
                  ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
                ExceptionSummary: "线性八位组下标不是 Uint32",
                ExceptionChain: {
                  Source: "ZerOS.Hardware.Memory.MemoryController.readLinearOctets",
                },
              });
            }
            octets.push(this.requireUnit(place.UnitOrdinal).ReadOctet(octetIndex));
          }
          return octets;
        }

        /**
         * 浅切根下标必须落在 Blocks 里。
         */
        private requireRoot(
          blockIndex: Uint32Root.Hardware.Memory.Uint32,
        ): MemoryBlockRoot.Hardware.Memory.MemoryBlock {
          const gated: Uint32Root.Hardware.Memory.Uint32 | null =
            Uint32Root.Hardware.Memory.toUint32(blockIndex);
          const block: MemoryBlockRoot.Hardware.Memory.MemoryBlock | undefined =
            gated === null ? undefined : this.Blocks[gated];
          if (gated === null || block?.BlockIndex !== gated) {
            this.recordAndThrow({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.BlockIndexOutOfRange,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
              ExceptionSummary: `BlockIndex=${String(blockIndex)} 越出浅切根`,
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryController.requireRoot",
              },
            });
          }
          return block;
        }

        /**
         * 把线性区间里的位元写成 0。
         * 先走完整段落点，任何一处对不上就 Abort，此时存储体还是原样。
         * 第二遍才改八位组。调用方因此可以在本方法返回之后再放下 Owner。
         * 对齐的 8 位直接清八位组；边上的余位只清那一位。
         */
        private clearLinear(
          start: bigint,
          length: bigint,
          counts: readonly Uint32Root.Hardware.Memory.Uint32[],
        ): void {
          this.walkClear(start, length, counts, false);
          this.walkClear(start, length, counts, true);
        }

        /**
         * 沿同一段线性区间走一遍。
         * apply 为 false 时只核对落点；为 true 时按已经核对过的公式清零。
         */
        private walkClear(
          start: bigint,
          length: bigint,
          counts: readonly Uint32Root.Hardware.Memory.Uint32[],
          apply: boolean,
        ): void {
          let offset = 0n;
          while (offset < length) {
            const at: bigint = start + offset;
            const wide: boolean = at % 8n === 0n && offset + 8n <= length;
            const site: {
              readonly unit: MemoryUnitRoot.Hardware.Memory.MemoryUnit;
              readonly octetIndex: number;
              readonly bit: number;
            } = this.requireClearSite(at, counts);
            if (wide && site.bit !== 0) {
              this.recordAndThrow({
                ExceptionCode:
                  ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.LinearBitIndexOutOfRange,
                ExceptionCategory:
                  ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
                ExceptionSummary: "对齐清零的落点不是八位组起点",
                ExceptionChain: {
                  Source: "ZerOS.Hardware.Memory.MemoryController.walkClear",
                },
              });
            }
            if (apply && wide) {
              site.unit.Cells[site.octetIndex] = 0;
            } else if (apply) {
              const current: number = site.unit.Cells[site.octetIndex] ?? 0;
              site.unit.Cells[site.octetIndex] = current & (0xff ^ (1 << site.bit));
            }
            offset += wide ? 8n : 1n;
          }
        }

        /**
         * 线性位元必须落到某一颗已有的八位组上。对不上就 Abort，不改存储体。
         */
        private requireClearSite(
          linearBit: bigint,
          counts: readonly Uint32Root.Hardware.Memory.Uint32[],
        ): {
          readonly unit: MemoryUnitRoot.Hardware.Memory.MemoryUnit;
          readonly octetIndex: number;
          readonly bit: number;
        } {
          const place: BlockSpanRoot.Hardware.Memory.LinearPlace | null =
            BlockSpanRoot.Hardware.Memory.locateLinear(linearBit, counts);
          const unit: MemoryUnitRoot.Hardware.Memory.MemoryUnit | undefined =
            place === null ? undefined : this.UnitsByOrdinal[place.UnitOrdinal];
          const octetIndex: number = place === null ? -1 : Math.floor(place.CellIndex / 8);
          if (place === null || unit === undefined || octetIndex < 0 || octetIndex >= unit.Cells.length) {
            this.recordAndThrow({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.LinearBitIndexOutOfRange,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
              ExceptionSummary: "清零时线性位元落不到颗粒上的八位组",
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryController.requireClearSite",
              },
            });
          }
          return {
            unit,
            octetIndex,
            bit: place.CellIndex % 8,
          };
        }

        /**
         * 不可处理异常末路：先写入 MemoryException，再 throw。
         */
        private recordAndThrow(params: {
          readonly ExceptionCode: number;
          readonly ExceptionCategory: ExceptionCategoryRoot.Hardware.Memory.ExceptionCategory;
          readonly ExceptionSummary: string;
          readonly ExceptionChain: object;
        }): never {
          const built: MemoryExceptionRoot.Hardware.Memory.MemoryException | null =
            MemoryExceptionRoot.Hardware.Memory.createMemoryException(params);
          if (built !== null) {
            this.Exceptions.push(built);
          } else {
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
                    "ZerOS.Hardware.Memory.MemoryController.recordAndThrow",
                  Rejected: params,
                },
              });
            if (fallback !== null) {
              this.Exceptions.push(fallback);
            }
          }

          throw new Error(
            `[ZerOS.Hardware.Memory.MemoryController] ${params.ExceptionSummary}`,
          );
        }
      }
    }
  }
}
