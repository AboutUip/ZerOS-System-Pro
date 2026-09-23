/**
 * @module ZerOS.Hardware.Memory.Block
 * @description 浅切内存块及其子块（MemoryBlock）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 承载 MemoryBlock：BlockIndex、ChildIndex、NestingDepth、BitLength、Children，
 * 以及块内位元端口 ReadBit / WriteBit 和加深方法 Deepen。
 * 位元跨度的除法在 Structure/BlockSpan。本文件不保存 Cells，也不生成颗粒序号。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 浅切初始嵌套深度
 *   3. 构造参数
 *   4. MemoryBlock 类
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as Uint32Root } from "../Structure/Uint32";
import { ZerOS as BlockSpanRoot } from "../Structure/BlockSpan";
import { ZerOS as OctetValueRoot } from "../Structure/OctetValue";
import { ZerOS as IntegerWidthRoot } from "../Enum/IntegerWidth";
import { ZerOS as LittleEndianRoot } from "../Structure/LittleEndian";
import type { ZerOS as BitValueRoot } from "../Enum/BitValue";
import { ZerOS as ExceptionCategoryRoot } from "../Enum/ExceptionCategory";
import { ZerOS as ExceptionCodeRoot } from "../Enum/ExceptionCode";
import type { ZerOS as MemoryUnitRoot } from "../Unit/MemoryUnit";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      /* -------------------------------------------------------------------- */
      /* 2. 浅切完成时的嵌套深度：协议初值 1                                   */
      /* -------------------------------------------------------------------- */

      /**
       * 浅切刚完成时，每一块的 NestingDepth 必须为 1（ZMP1 §4.16）。
       * 1 表示这块占住第一层。子块的深度由 Deepen 写成父深度 + 1，不用本常量。
       */
      export const NestingDepthAtShallowCut: Uint32Root.Hardware.Memory.Uint32 =
        Uint32Root.Hardware.Memory.uint32OrThrow(
          1,
          "ZerOS.Hardware.Memory.NestingDepthAtShallowCut",
        );

      /* -------------------------------------------------------------------- */
      /* 3. 构造参数：协议字段以外的绑定由总控注入                              */
      /* -------------------------------------------------------------------- */

      /**
       * 总控或父块在端口失败时已经写好的异常参数。
       * 记录落在总控的 Exceptions 上，因为块本身没有异常数组。
       */
      export interface PortFailure {
        readonly ExceptionCode: number;
        readonly ExceptionCategory: ExceptionCategoryRoot.Hardware.Memory.ExceptionCategory;
        readonly ExceptionSummary: string;
        readonly ExceptionChain: object;
      }

      /**
       * 建立一块所需的全部输入。
       * StartLinear、CellCounts 与两个回调不是协议字段，只供本实现把偏移走回颗粒。
       */
      export interface MemoryBlockParams {
        readonly BlockIndex: Uint32Root.Hardware.Memory.Uint32;
        readonly NestingDepth: Uint32Root.Hardware.Memory.Uint32;
        readonly ChildIndex: Uint32Root.Hardware.Memory.Uint32 | null;
        readonly BitLength: Uint32Root.Hardware.Memory.Uint32;
        readonly StartLinear: bigint;
        readonly ShallowDimension: Uint32Root.Hardware.Memory.Uint32;
        readonly DeepDimension: Uint32Root.Hardware.Memory.Uint32;
        readonly CellCounts: readonly Uint32Root.Hardware.Memory.Uint32[];
        unitAt(
          unitOrdinal: Uint32Root.Hardware.Memory.Uint32,
        ): MemoryUnitRoot.Hardware.Memory.MemoryUnit | null;
        fail(params: PortFailure): never;
        deepened(
          blockIndex: Uint32Root.Hardware.Memory.Uint32,
          childDepth: Uint32Root.Hardware.Memory.Uint32,
        ): void;
      }

      /* -------------------------------------------------------------------- */
      /* 4. MemoryBlock                                                        */
      /* -------------------------------------------------------------------- */

      /**
       * 浅切产生的一枚内存块，或 Deepen 产生的一枚子块。
       *
       * 块不复制存储体。ReadBit / WriteBit 把块内偏移换成线性下标，再交给那一颗的位元端口。
       * 浅切根的 ChildIndex 为 null。子块的 BlockIndex 仍是所属浅切根的下标。
       */
      export class MemoryBlock {
        /**
         * 所属浅切根的下标（ZMP1 §4.16 / §4.21）。
         * 根块：0 ≤ BlockIndex < ShallowDimension。
         * 子块：抄父块的 BlockIndex，不另占一个全局下标。
         */
        public readonly BlockIndex: Uint32Root.Hardware.Memory.Uint32;

        /**
         * 子块在父块 Children 里的下标（ZMP1 §4.21）。
         * 浅切根没有这个身份，官方用 null 表示协议上的「不适用」。
         */
        public readonly ChildIndex: Uint32Root.Hardware.Memory.Uint32 | null;

        /**
         * 当前嵌套深度（ZMP1 §4.16）。
         * 浅切根为 1。子块为父深度 + 1，并且不得超过 DeepDimension。
         * Deepen 不改写本字段。
         */
        public readonly NestingDepth: Uint32Root.Hardware.Memory.Uint32;

        /**
         * 本块覆盖的位元个数（ZMP1 §4.20）。
         * 必须是 Uint32。浅切时若有一块更长，整次浅切失败，不会留下半截序列。
         */
        public readonly BitLength: Uint32Root.Hardware.Memory.Uint32;

        /**
         * 直接子块（ZMP1 §4.21）。浅切完成时为空。
         * Deepen 成功后长度等于 ShallowDimension，并按 ChildIndex 升序冻结。
         */
        public Children: readonly MemoryBlock[];

        /**
         * 浅切根的主人（ZMP1 §4.26）。null 表示还没有人领取。
         * 子块不单独领取，始终保持 null。
         */
        public Owner: Uint32Root.Hardware.Memory.Uint32 | null;

        /**
         * 本块在整机位元线上的起点。不是协议字段。
         * 可以大于 Uint32，所以用 bigint，不收成 number。
         */
        private readonly StartLinear: bigint;

        private readonly ShallowDimension: Uint32Root.Hardware.Memory.Uint32;

        private readonly DeepDimension: Uint32Root.Hardware.Memory.Uint32;

        private readonly CellCounts: readonly Uint32Root.Hardware.Memory.Uint32[];

        private readonly unitAt: MemoryBlockParams["unitAt"];

        private readonly fail: MemoryBlockParams["fail"];

        private readonly deepened: MemoryBlockParams["deepened"];

        /**
         * 建立一块。深度、下标和位元长度都由调用方算好。
         * 本构造不检查深度上限；浅切路径和 Deepen 在调用前各自检查。
         */
        public constructor(params: MemoryBlockParams) {
          this.BlockIndex = params.BlockIndex;
          this.ChildIndex = params.ChildIndex;
          this.NestingDepth = params.NestingDepth;
          this.BitLength = params.BitLength;
          this.Children = Object.freeze([]);
          this.Owner = null;
          this.StartLinear = params.StartLinear;
          this.ShallowDimension = params.ShallowDimension;
          this.DeepDimension = params.DeepDimension;
          this.CellCounts = params.CellCounts;
          this.unitAt = (
            unitOrdinal: Uint32Root.Hardware.Memory.Uint32,
          ): MemoryUnitRoot.Hardware.Memory.MemoryUnit | null =>
            params.unitAt(unitOrdinal);
          this.fail = (failure: PortFailure): never => params.fail(failure);
          this.deepened = (
            blockIndex: Uint32Root.Hardware.Memory.Uint32,
            childDepth: Uint32Root.Hardware.Memory.Uint32,
          ): void => {
            params.deepened(blockIndex, childDepth);
          };
        }

        /**
         * 读取本块内的一个位元（ZMP1 §4.20 规范方法名 `ReadBit`）。
         * 偏移先过本块的 BitLength；通过之后才转交颗粒，颗粒再检查自己是否 0x4。
         */
        public ReadBit(
          BlockBitOffset: Uint32Root.Hardware.Memory.Uint32,
        ): BitValueRoot.Hardware.Memory.BitValue {
          const place: BlockSpanRoot.Hardware.Memory.LinearPlace =
            this.locate(BlockBitOffset, "ZerOS.Hardware.Memory.MemoryBlock.ReadBit");
          const unit: MemoryUnitRoot.Hardware.Memory.MemoryUnit | null =
            this.unitAt(place.UnitOrdinal);
          if (unit === null) {
            this.fail({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.Unspecified,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
              ExceptionSummary: `块内偏移落到序号 ${String(place.UnitOrdinal)}，但没有这颗颗粒`,
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryBlock.ReadBit",
                Field: "UnitOrdinal",
                Value: place.UnitOrdinal,
              },
            });
          }
          return unit.ReadBit(place.CellIndex);
        }

        /**
         * 写入本块内的一个位元（ZMP1 §4.20 规范方法名 `WriteBit`）。
         * 只改映射到的那一位。偏移非法时存储体不变，异常记在总控上。
         */
        public WriteBit(
          BlockBitOffset: Uint32Root.Hardware.Memory.Uint32,
          BitValue: number,
        ): void {
          const place: BlockSpanRoot.Hardware.Memory.LinearPlace =
            this.locate(BlockBitOffset, "ZerOS.Hardware.Memory.MemoryBlock.WriteBit");
          const unit: MemoryUnitRoot.Hardware.Memory.MemoryUnit | null =
            this.unitAt(place.UnitOrdinal);
          if (unit === null) {
            this.fail({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.Unspecified,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
              ExceptionSummary: `块内偏移落到序号 ${String(place.UnitOrdinal)}，但没有这颗颗粒`,
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryBlock.WriteBit",
                Field: "UnitOrdinal",
                Value: place.UnitOrdinal,
              },
            });
          }
          unit.WriteBit(place.CellIndex, BitValue);
        }

        /**
         * 把本块再切一刀（ZMP1 §4.21 规范方法名 `Deepen`）。
         *
         * 检查顺序：先看深度是否已经到顶，再看是否已经有子块。
         * 成功时父块的 NestingDepth 与 BitLength 都不变，存储体也不变。
         * 子块个数等于 ShallowDimension，跨度用同一套向下取整均分父块的 BitLength。
         */
        public Deepen(): void {
          if (this.NestingDepth >= this.DeepDimension) {
            this.fail({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                  .NestingAtCeiling,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
              ExceptionSummary: `NestingDepth=${String(this.NestingDepth)} 已达到 DeepDimension=${String(this.DeepDimension)}，不能再加深`,
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryBlock.Deepen",
                Field: "NestingDepth",
                Value: this.NestingDepth,
                DeepDimension: this.DeepDimension,
              },
            });
          }

          if (this.Children.length !== 0) {
            this.fail({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                  .AlreadyDeepened,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
              ExceptionSummary: `BlockIndex=${String(this.BlockIndex)} 已经有 ${String(this.Children.length)} 个子块`,
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryBlock.Deepen",
                Field: "Children",
                ChildCount: this.Children.length,
              },
            });
          }

          const parentLength = BigInt(this.BitLength);
          const built: MemoryBlock[] = [];
          let index = 0;
          while (index < this.ShallowDimension) {
            const childIndex: Uint32Root.Hardware.Memory.Uint32 | null =
              Uint32Root.Hardware.Memory.toUint32(index);
            const nextDepth: Uint32Root.Hardware.Memory.Uint32 | null =
              Uint32Root.Hardware.Memory.toUint32(this.NestingDepth + 1);
            if (childIndex === null || nextDepth === null) {
              this.fail({
                ExceptionCode:
                  ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                    .IllegalDeepDimension,
                ExceptionCategory:
                  ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode
                    .Abort,
                ExceptionSummary: `无法为子块 ${String(index)} 分配深度或下标`,
                ExceptionChain: {
                  Source: "ZerOS.Hardware.Memory.MemoryBlock.Deepen",
                  Field: "ChildIndex",
                  Value: index,
                },
              });
            }

            // 父块长度当作这一刀的「总位元数」，块数仍是浅维度。公式与浅切相同。
            const range: { readonly Start: bigint; readonly Length: bigint } =
              BlockSpanRoot.Hardware.Memory.rangeOfBlock(
                childIndex,
                this.ShallowDimension,
                parentLength,
              );
            const bitLength: Uint32Root.Hardware.Memory.Uint32 | null =
              BlockSpanRoot.Hardware.Memory.bitLengthAsUint32(range.Length);
            if (bitLength === null) {
              this.fail({
                ExceptionCode:
                  ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                    .BlockSpanExceedsUint32,
                ExceptionCategory:
                  ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode
                    .Abort,
                ExceptionSummary: `子块 ${String(childIndex)} 的位元跨度不能落入 Uint32`,
                ExceptionChain: {
                  Source: "ZerOS.Hardware.Memory.MemoryBlock.Deepen",
                  Field: "BitLength",
                  Value: range.Length.toString(),
                },
              });
            }

            built.push(
              new MemoryBlock({
                BlockIndex: this.BlockIndex,
                NestingDepth: nextDepth,
                ChildIndex: childIndex,
                BitLength: bitLength,
                StartLinear: this.StartLinear + range.Start,
                ShallowDimension: this.ShallowDimension,
                DeepDimension: this.DeepDimension,
                CellCounts: this.CellCounts,
                unitAt: this.unitAt,
                fail: this.fail,
                deepened: this.deepened,
              }),
            );
            index += 1;
          }

          if (built.length !== this.ShallowDimension) {
            this.fail({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                  .IllegalShallowDimension,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
              ExceptionSummary: `加深后的子块数 ${String(built.length)} 必须等于 ShallowDimension=${String(this.ShallowDimension)}`,
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryBlock.Deepen",
                ChildCount: built.length,
                ShallowDimension: this.ShallowDimension,
              },
            });
          }

          this.Children = Object.freeze(built);
          const childDepth: Uint32Root.Hardware.Memory.Uint32 | null =
            Uint32Root.Hardware.Memory.toUint32(this.NestingDepth + 1);
          if (childDepth !== null) {
            this.deepened(this.BlockIndex, childDepth);
          }
        }

        /**
         * 读取块内一个八位组（ZMP1 §4.25 规范方法名 `ReadOctet`）。
         * 这一组是块内连续 8 个位元，位元 0 是最低有效位。不必对齐颗粒的八位组边界。
         */
        public ReadOctet(
          BlockOctetIndex: Uint32Root.Hardware.Memory.Uint32,
        ): OctetValueRoot.Hardware.Memory.OctetValue {
          const offsets: readonly Uint32Root.Hardware.Memory.Uint32[] =
            this.requireBlockOctetBits(BlockOctetIndex, 1);
          let value = 0;
          let bit = 0;
          while (bit < offsets.length) {
            const offset = offsets[bit];
            if (offset !== undefined && this.ReadBit(offset) === 1) {
              value |= 1 << bit;
            }
            bit += 1;
          }
          const octet: OctetValueRoot.Hardware.Memory.OctetValue | null =
            OctetValueRoot.Hardware.Memory.toOctetValue(value);
          if (octet === null) {
            this.fail({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.Unspecified,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
              ExceptionSummary: "块内八位组无法收成 0–255",
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryBlock.ReadOctet",
              },
            });
          }
          return octet;
        }

        /**
         * 写入块内一个八位组（ZMP1 §4.25 规范方法名 `WriteOctet`）。
         * 先确认 8 个位元都落在块内，再改它们。非法值不改存储体。
         */
        public WriteOctet(
          BlockOctetIndex: Uint32Root.Hardware.Memory.Uint32,
          OctetValue: number,
        ): void {
          const gated: OctetValueRoot.Hardware.Memory.OctetValue | null =
            OctetValueRoot.Hardware.Memory.toOctetValue(OctetValue);
          const offsets: readonly Uint32Root.Hardware.Memory.Uint32[] =
            this.requireBlockOctetBits(BlockOctetIndex, 1);
          if (gated === null) {
            this.fail({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.IllegalOctetValue,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
              ExceptionSummary: `OctetValue=${String(OctetValue)} 不是 0–255 的整数`,
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryBlock.WriteOctet",
                Field: "OctetValue",
                Value: OctetValue,
              },
            });
          }
          let bit = 0;
          while (bit < offsets.length) {
            if (offsets[bit] === undefined) {
              this.fail({
                ExceptionCode:
                  ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.BlockOctetIndexOutOfRange,
                ExceptionCategory:
                  ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
                ExceptionSummary: "块内八位组的位元偏移没有收齐，一个位元都没写",
                ExceptionChain: {
                  Source: "ZerOS.Hardware.Memory.MemoryBlock.WriteOctet",
                },
              });
            }
            bit += 1;
          }
          bit = 0;
          while (bit < offsets.length) {
            const offset: Uint32Root.Hardware.Memory.Uint32 | undefined = offsets[bit];
            if (offset === undefined) {
              this.fail({
                ExceptionCode:
                  ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.BlockOctetIndexOutOfRange,
                ExceptionCategory:
                  ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
                ExceptionSummary: "块内八位组的位元偏移没有收齐，一个位元都没写",
                ExceptionChain: {
                  Source: "ZerOS.Hardware.Memory.MemoryBlock.WriteOctet",
                },
              });
            }
            const bitValue: number = (gated >> bit) & 1;
            this.WriteBit(offset, bitValue);
            bit += 1;
          }
        }

        /**
         * 读取块内一个小端整数（ZMP1 §4.25 规范方法名 `ReadInteger`）。
         * 宽度 2、4、8，按块内八位组计，最低下标是最低有效字节。
         */
        public ReadInteger(
          BlockOctetIndex: Uint32Root.Hardware.Memory.Uint32,
          OctetWidth: number,
        ): bigint {
          const width: IntegerWidthRoot.Hardware.Memory.IntegerWidth | null =
            IntegerWidthRoot.Hardware.Memory.toIntegerWidth(OctetWidth);
          if (width === null) {
            this.fail({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.IllegalIntegerWidth,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
              ExceptionSummary: `OctetWidth=${String(OctetWidth)} 不是 2、4 或 8`,
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryBlock.ReadInteger",
              },
            });
          }
          if (BigInt(BlockOctetIndex) + BigInt(width) > BigInt(this.BitLength) / 8n) {
            this.fail({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.IntegerSpanOutOfRange,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
              ExceptionSummary: "块内整数跨度越出完整八位组",
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryBlock.ReadInteger",
              },
            });
          }
          const octets: number[] = [];
          let step = 0;
          while (step < width) {
            const index: Uint32Root.Hardware.Memory.Uint32 | null =
              Uint32Root.Hardware.Memory.toUint32(BlockOctetIndex + step);
            if (index === null) {
              this.fail({
                ExceptionCode:
                  ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.IntegerSpanOutOfRange,
                ExceptionCategory:
                  ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
                ExceptionSummary: "块内整数下标不是 Uint32",
                ExceptionChain: {
                  Source: "ZerOS.Hardware.Memory.MemoryBlock.ReadInteger",
                },
              });
            }
            octets.push(this.ReadOctet(index));
            step += 1;
          }
          return LittleEndianRoot.Hardware.Memory.packLittleEndian(octets);
        }

        /**
         * 写入块内一个小端整数（ZMP1 §4.25 规范方法名 `WriteInteger`）。
         * 跨度或值不合法时不改存储体。
         */
        public WriteInteger(
          BlockOctetIndex: Uint32Root.Hardware.Memory.Uint32,
          OctetWidth: number,
          IntegerValue: bigint,
        ): void {
          const width: IntegerWidthRoot.Hardware.Memory.IntegerWidth | null =
            IntegerWidthRoot.Hardware.Memory.toIntegerWidth(OctetWidth);
          if (width === null) {
            this.fail({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.IllegalIntegerWidth,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
              ExceptionSummary: `OctetWidth=${String(OctetWidth)} 不是 2、4 或 8`,
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryBlock.WriteInteger",
              },
            });
          }
          if (BigInt(BlockOctetIndex) + BigInt(width) > BigInt(this.BitLength) / 8n) {
            this.fail({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.IntegerSpanOutOfRange,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
              ExceptionSummary: "块内整数跨度越出完整八位组",
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryBlock.WriteInteger",
              },
            });
          }
          const unpacked: number[] | null =
            LittleEndianRoot.Hardware.Memory.unpackLittleEndian(IntegerValue, width);
          if (unpacked === null) {
            this.fail({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.IllegalIntegerValue,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
              ExceptionSummary: "IntegerValue 超出该宽度",
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryBlock.WriteInteger",
              },
            });
          }
          const indexes: Uint32Root.Hardware.Memory.Uint32[] = [];
          let step = 0;
          while (step < unpacked.length) {
            const index: Uint32Root.Hardware.Memory.Uint32 | null =
              Uint32Root.Hardware.Memory.toUint32(BlockOctetIndex + step);
            if (unpacked[step] === undefined || index === null) {
              this.fail({
                ExceptionCode:
                  ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.IntegerSpanOutOfRange,
                ExceptionCategory:
                  ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
                ExceptionSummary: "块内整数的八位组没有收齐，一个八位组都没写",
                ExceptionChain: {
                  Source: "ZerOS.Hardware.Memory.MemoryBlock.WriteInteger",
                },
              });
            }
            indexes.push(index);
            step += 1;
          }
          step = 0;
          while (step < indexes.length) {
            const octet: number | undefined = unpacked[step];
            const index: Uint32Root.Hardware.Memory.Uint32 | undefined = indexes[step];
            if (octet === undefined || index === undefined) {
              this.fail({
                ExceptionCode:
                  ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.IntegerSpanOutOfRange,
                ExceptionCategory:
                  ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
                ExceptionSummary: "块内整数的八位组没有收齐，一个八位组都没写",
                ExceptionChain: {
                  Source: "ZerOS.Hardware.Memory.MemoryBlock.WriteInteger",
                },
              });
            }
            this.WriteOctet(index, octet);
            step += 1;
          }
        }

        /**
         * 确认从块内八位组下标起的 width 个八位组都有完整的 8 个位元。
         * 返回这些位元的块内偏移，供读写使用。
         */
        private requireBlockOctetBits(
          blockOctetIndex: Uint32Root.Hardware.Memory.Uint32,
          octetWidth: number,
        ): readonly Uint32Root.Hardware.Memory.Uint32[] {
          const index: Uint32Root.Hardware.Memory.Uint32 | null =
            Uint32Root.Hardware.Memory.toUint32(blockOctetIndex);
          if (
            index === null ||
            BigInt(index) + BigInt(octetWidth) > BigInt(this.BitLength) / 8n
          ) {
            this.fail({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                  .BlockOctetIndexOutOfRange,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
              ExceptionSummary: `BlockOctetIndex=${String(blockOctetIndex)} 越出块内完整八位组`,
              ExceptionChain: {
                Source: "ZerOS.Hardware.Memory.MemoryBlock.requireBlockOctetBits",
                Field: "BlockOctetIndex",
                Value: blockOctetIndex,
              },
            });
          }
          const offsets: Uint32Root.Hardware.Memory.Uint32[] = [];
          let bit = 0;
          const bitCount: number = octetWidth * 8;
          while (bit < bitCount) {
            const offset: Uint32Root.Hardware.Memory.Uint32 | null =
              Uint32Root.Hardware.Memory.toUint32(Number(BigInt(index) * 8n + BigInt(bit)));
            if (offset === null) {
              this.fail({
                ExceptionCode:
                  ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                    .BlockOctetIndexOutOfRange,
                ExceptionCategory:
                  ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
                ExceptionSummary: "块内八位组的位元偏移不是 Uint32",
                ExceptionChain: {
                  Source: "ZerOS.Hardware.Memory.MemoryBlock.requireBlockOctetBits",
                },
              });
            }
            this.locate(offset, "ZerOS.Hardware.Memory.MemoryBlock.requireBlockOctetBits");
            offsets.push(offset);
            bit += 1;
          }
          return offsets;
        }

        /**
         * 块内偏移 → 颗粒落点。
         * 偏移不是 Uint32，或 ≥ BitLength 时，异常记在总控，标号 BlockBitOffsetOutOfRange。
         */
        private locate(
          blockBitOffset: Uint32Root.Hardware.Memory.Uint32,
          source: string,
        ): BlockSpanRoot.Hardware.Memory.LinearPlace {
          const offset: Uint32Root.Hardware.Memory.Uint32 | null =
            Uint32Root.Hardware.Memory.toUint32(blockBitOffset);
          if (offset === null || offset >= this.BitLength) {
            this.fail({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue
                  .BlockBitOffsetOutOfRange,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
              ExceptionSummary: `BlockBitOffset=${String(blockBitOffset)} 越出 BitLength=${String(this.BitLength)}`,
              ExceptionChain: {
                Source: source,
                Field: "BlockBitOffset",
                Value: blockBitOffset,
                BitLength: this.BitLength,
              },
            });
          }

          const place: BlockSpanRoot.Hardware.Memory.LinearPlace | null =
            BlockSpanRoot.Hardware.Memory.locateLinear(
              this.StartLinear + BigInt(offset),
              this.CellCounts,
            );
          if (place === null) {
            this.fail({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.Unspecified,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
              ExceptionSummary: `块内偏移 ${String(offset)} 无法落到任何颗粒`,
              ExceptionChain: {
                Source: source,
                Field: "BlockBitOffset",
                Value: offset,
              },
            });
          }
          return place;
        }
      }
    }
  }
}
