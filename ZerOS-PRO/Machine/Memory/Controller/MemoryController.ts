/**
 * @module ZerOS.Machine.Memory.Controller
 * @description 内存总控（MemoryController）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 仅承载 MemoryController 类：Units 关联表、总控 Exceptions、构造与 RNG。
 * 索引 ID、冻结 Map、异常结构/枚举已拆至独立文件。
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
import { ZerOS as UnitIndexIdRoot } from "../Structure/UnitIndexId";
import { ZerOS as FreezeUnitMapRoot } from "./FreezeUnitMap";
import { ZerOS as MemoryExceptionRoot } from "../Structure/MemoryException";
import { ZerOS as ExceptionCategoryRoot } from "../Enum/ExceptionCategory";
import { ZerOS as ExceptionCodeRoot } from "../Enum/ExceptionCode";

export namespace ZerOS {
  export namespace Machine {
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
          UnitIndexIdRoot.Machine.Memory.UnitIndexId,
          MemoryUnitRoot.Machine.Memory.MemoryUnit
        >;

        /**
         * 总控级异常数组：元素为 MemoryException。
         */
        public readonly Exceptions: MemoryExceptionRoot.Machine.Memory.MemoryException[];

        /**
         * 构造总控：
         *   (0) 空 Exceptions
         *   (1) 检查 UnitCount
         *   (2) 填工作 Map（碰撞可处理重抽）
         *   (3) 断言 size === UnitCount
         *   (4) freezeUnitMap
         */
        public constructor() {
          this.Exceptions = [];

          const count: MemoryConfigRoot.Machine.Memory.UnitCount =
            MemoryConfigRoot.Machine.Memory.Config.UnitCount;
          if (!Number.isInteger(count) || count < 1) {
            this.Units = FreezeUnitMapRoot.Machine.Memory.freezeUnitMap(
              new Map(),
            );
            this.recordAndThrow({
              ExceptionCode:
                ExceptionCodeRoot.Machine.Memory.ExceptionCodeValue
                  .IllegalUnitCount,
              ExceptionCategory:
                ExceptionCategoryRoot.Machine.Memory.ExceptionCategoryCode
                  .Abort,
              ExceptionSummary: `非法颗粒数量 UnitCount=${String(count)}，须为正整数`,
              ExceptionChain: {
                Source: "ZerOS.Machine.Memory.MemoryController.constructor",
                Field: "UnitCount",
                Value: count,
              },
            });
          }

          const working = new Map<
            UnitIndexIdRoot.Machine.Memory.UnitIndexId,
            MemoryUnitRoot.Machine.Memory.MemoryUnit
          >();

          while (working.size < count) {
            try {
              const id: UnitIndexIdRoot.Machine.Memory.UnitIndexId =
                this.generateUnitIndexId();
              if (working.has(id)) {
                continue;
              }
              working.set(
                id,
                new MemoryUnitRoot.Machine.Memory.MemoryUnit(),
              );
            } catch (caught: unknown) {
              const alreadyRecorded: boolean = this.Exceptions.length > 0;
              if (!alreadyRecorded) {
                this.Units =
                  FreezeUnitMapRoot.Machine.Memory.freezeUnitMap(working);
                this.recordAndThrow({
                  ExceptionCode:
                    ExceptionCodeRoot.Machine.Memory.ExceptionCodeValue
                      .Unspecified,
                  ExceptionCategory:
                    ExceptionCategoryRoot.Machine.Memory.ExceptionCategoryCode
                      .Abort,
                  ExceptionSummary: "总控构造循环中发生不可处理异常",
                  ExceptionChain: {
                    Source:
                      "ZerOS.Machine.Memory.MemoryController.constructor",
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

          if (working.size !== count) {
            this.Units =
              FreezeUnitMapRoot.Machine.Memory.freezeUnitMap(working);
            this.recordAndThrow({
              ExceptionCode:
                ExceptionCodeRoot.Machine.Memory.ExceptionCodeValue
                  .IllegalUnitCount,
              ExceptionCategory:
                ExceptionCategoryRoot.Machine.Memory.ExceptionCategoryCode
                  .Abort,
              ExceptionSummary: `关联表大小 ${String(working.size)} 必须等于 UnitCount=${String(count)}`,
              ExceptionChain: {
                Source: "ZerOS.Machine.Memory.MemoryController.constructor",
                WorkingSize: working.size,
                UnitCount: count,
              },
            });
          }

          this.Units =
            FreezeUnitMapRoot.Machine.Memory.freezeUnitMap(working);
        }

        /**
         * 内置 RNG：产出定长 UnitIndexId（拒绝采样；非 ZMP1 MemoryId）。
         */
        private generateUnitIndexId(): UnitIndexIdRoot.Machine.Memory.UnitIndexId {
          const alphabet: string =
            UnitIndexIdRoot.Machine.Memory.UnitIndexIdAlphabet;
          const alphabetLength: number = alphabet.length;
          if (alphabetLength < 2) {
            this.recordAndThrow({
              ExceptionCode:
                ExceptionCodeRoot.Machine.Memory.ExceptionCodeValue
                  .UnitIndexAlphabetInvalid,
              ExceptionCategory:
                ExceptionCategoryRoot.Machine.Memory.ExceptionCategoryCode
                  .Abort,
              ExceptionSummary: "索引 ID 字符表非法（长度须 ≥ 2）",
              ExceptionChain: {
                Source:
                  "ZerOS.Machine.Memory.MemoryController.generateUnitIndexId",
                AlphabetLength: alphabetLength,
              },
            });
          }

          const cryptoApi: Crypto = globalThis.crypto;
          if (typeof cryptoApi.getRandomValues !== "function") {
            this.recordAndThrow({
              ExceptionCode:
                ExceptionCodeRoot.Machine.Memory.ExceptionCodeValue
                  .CryptoUnavailable,
              ExceptionCategory:
                ExceptionCategoryRoot.Machine.Memory.ExceptionCategoryCode
                  .Abort,
              ExceptionSummary:
                "环境缺少 crypto.getRandomValues，无法生成颗粒索引 ID",
              ExceptionChain: {
                Source:
                  "ZerOS.Machine.Memory.MemoryController.generateUnitIndexId",
              },
            });
          }

          const chars: string[] = [];
          const rejectionLimit: number =
            Math.floor(256 / alphabetLength) * alphabetLength;
          const idLength: number =
            UnitIndexIdRoot.Machine.Memory.UnitIndexIdLength;

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
         * 不可处理异常末路：先写入 MemoryException，再 throw。
         */
        private recordAndThrow(params: {
          readonly ExceptionCode: number;
          readonly ExceptionCategory: ExceptionCategoryRoot.Machine.Memory.ExceptionCategory;
          readonly ExceptionSummary: string;
          readonly ExceptionChain: object;
        }): never {
          const built: MemoryExceptionRoot.Machine.Memory.MemoryException | null =
            MemoryExceptionRoot.Machine.Memory.createMemoryException(params);
          if (built !== null) {
            this.Exceptions.push(built);
          } else {
            const fallback: MemoryExceptionRoot.Machine.Memory.MemoryException | null =
              MemoryExceptionRoot.Machine.Memory.createMemoryException({
                ExceptionCode:
                  ExceptionCodeRoot.Machine.Memory.ExceptionCodeValue
                    .Unspecified,
                ExceptionCategory:
                  ExceptionCategoryRoot.Machine.Memory.ExceptionCategoryCode
                    .Severe,
                ExceptionSummary:
                  "MemoryException 形态校验失败，已拒绝原始上报",
                ExceptionChain: {
                  Source:
                    "ZerOS.Machine.Memory.MemoryController.recordAndThrow",
                  Rejected: params,
                },
              });
            if (fallback !== null) {
              this.Exceptions.push(fallback);
            }
          }

          throw new Error(
            `[ZerOS.Machine.Memory.MemoryController] ${params.ExceptionSummary}`,
          );
        }
      }
    }
  }
}
