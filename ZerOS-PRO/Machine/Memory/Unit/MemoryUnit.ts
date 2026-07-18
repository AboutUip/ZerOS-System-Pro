/**
 * @module ZerOS.Machine.Memory.Unit
 * @description 单颗内存颗粒单元（MemoryUnit）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 仅承载 MemoryUnit 类：Cells、InitState、Events / Signals / Exceptions。
 * 枚举量与结构已拆至 Enum/、Structure/ 等子目录。
 *
 * 异常策略（实现侧约定，非 ZMP1 强制）：
 *   优先写入 Exceptions；先检查 → 再 try；可处理自消化；不可处理再抛。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 配置面 / 枚举量 / 结构 / 异常工厂导入
 *   2. MemoryUnit 类
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as MemoryConfigRoot } from "../Config/MemoryConfig";
import { ZerOS as UnitInitStateRoot } from "../Enum/UnitInitState";
import { ZerOS as MemoryEventRoot } from "../Structure/MemoryEvent";
import { ZerOS as MemorySignalRoot } from "../Structure/MemorySignal";
import { ZerOS as MemoryExceptionRoot } from "../Structure/MemoryException";
import { ZerOS as ExceptionCategoryRoot } from "../Enum/ExceptionCategory";
import { ZerOS as ExceptionCodeRoot } from "../Enum/ExceptionCode";

// 引用模块锚点，避免结构文件被判定为纯类型导出后无法值导入
void MemoryEventRoot.Machine.Memory.MemoryEventModule;
void MemorySignalRoot.Machine.Memory.MemorySignalModule;

export namespace ZerOS {
  export namespace Machine {
    export namespace Memory {
      /* -------------------------------------------------------------------- */
      /* 2. MemoryUnit                                                         */
      /* -------------------------------------------------------------------- */

      /**
       * MemoryUnit：单颗内存颗粒实例。
       *
       * 总控负责关联；本类是存储本体 + 事件/信号/异常侧信道。
       * 不提供业务读写方法。
       */
      export class MemoryUnit {
        /**
         * 一维高性能存储：正常时长度 = UnitSizeBytes；槽位语义 BitValue。
         * 若构造期检测到非法颗粒大小且自行降级，则长度可为 0。
         */
        public readonly Cells: Uint8Array;

        /**
         * 初始化状态（ZMP1 §4.12）。默认 0x0；构造失败自行处理后可为 0x2。
         */
        public InitState: UnitInitStateRoot.Machine.Memory.UnitInitState;

        /**
         * 事件数组（ZMP1 §4.13）：元素为 MemoryEvent 壳。
         */
        public readonly Events: MemoryEventRoot.Machine.Memory.MemoryEvent[];

        /**
         * 信号数组（ZMP1 §4.13）：元素为 MemorySignal 壳。
         */
        public readonly Signals: MemorySignalRoot.Machine.Memory.MemorySignal[];

        /**
         * 异常数组（ZMP1 §4.13）：元素为 MemoryException。
         */
        public readonly Exceptions: MemoryExceptionRoot.Machine.Memory.MemoryException[];

        /**
         * 构造一颗内存单元。
         *
         * 流水线：
         *   (1) 先建立三个空数组与默认 InitState
         *   (2) 检查 UnitSizeBytes
         *   (3) 合法则 try 分配 Cells；失败则写入异常并降级
         *   (4) 非法则写入 Abort 异常，降级为空 Cells + InitFault
         */
        public constructor() {
          // —— (1) 侧信道与状态先就位 ——
          this.Events = [];
          this.Signals = [];
          this.Exceptions = [];
          this.InitState =
            UnitInitStateRoot.Machine.Memory.UnitInitStateCode.InvalidPending;

          const size: MemoryConfigRoot.Machine.Memory.UnitSizeBytes =
            MemoryConfigRoot.Machine.Memory.Config.UnitSizeBytes;

          // —— (2) 先检查：非法大小 ——
          if (!Number.isInteger(size) || size < 1) {
            this.recordExceptionOrAbort({
              ExceptionCode:
                ExceptionCodeRoot.Machine.Memory.ExceptionCodeValue
                  .IllegalUnitSizeBytes,
              ExceptionCategory:
                ExceptionCategoryRoot.Machine.Memory.ExceptionCategoryCode
                  .Abort,
              ExceptionSummary: `非法颗粒大小 UnitSizeBytes=${String(size)}，须为正整数`,
              ExceptionChain: {
                Source: "ZerOS.Machine.Memory.MemoryUnit.constructor",
                Field: "UnitSizeBytes",
                Value: size,
              },
            });
            this.Cells = new Uint8Array(0);
            this.InitState =
              UnitInitStateRoot.Machine.Memory.UnitInitStateCode.InitFault;
            return;
          }

          // —— (3) try：分配可能失败 ——
          try {
            this.Cells = new Uint8Array(size);
            this.InitState =
              UnitInitStateRoot.Machine.Memory.UnitInitStateCode.InvalidPending;
          } catch (caught: unknown) {
            this.recordExceptionOrAbort({
              ExceptionCode:
                ExceptionCodeRoot.Machine.Memory.ExceptionCodeValue
                  .Unspecified,
              ExceptionCategory:
                ExceptionCategoryRoot.Machine.Memory.ExceptionCategoryCode
                  .Severe,
              ExceptionSummary: `分配 Cells 失败（请求长度=${String(size)}）`,
              ExceptionChain: {
                Source: "ZerOS.Machine.Memory.MemoryUnit.constructor",
                Cause:
                  caught instanceof Error
                    ? { Name: caught.name, Message: caught.message }
                    : { Raw: String(caught) },
              },
            });
            this.Cells = new Uint8Array(0);
            this.InitState =
              UnitInitStateRoot.Machine.Memory.UnitInitStateCode.InitFault;
          }
        }

        /**
         * 将异常写入本单元 Exceptions。
         * 工厂失败则兜底 Unspecified/Severe；兜底仍失败则抛出。
         */
        private recordExceptionOrAbort(params: {
          readonly ExceptionCode: number;
          readonly ExceptionCategory: ExceptionCategoryRoot.Machine.Memory.ExceptionCategory;
          readonly ExceptionSummary: string;
          readonly ExceptionChain: object;
        }): void {
          const built: MemoryExceptionRoot.Machine.Memory.MemoryException | null =
            MemoryExceptionRoot.Machine.Memory.createMemoryException(params);
          if (built !== null) {
            this.Exceptions.push(built);
            return;
          }

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
                  "ZerOS.Machine.Memory.MemoryUnit.recordExceptionOrAbort",
                Rejected: params,
              },
            });
          if (fallback !== null) {
            this.Exceptions.push(fallback);
            return;
          }

          throw new Error(
            `[ZerOS.Machine.Memory.MemoryUnit] 无法写入合规 MemoryException，构造中止`,
          );
        }
      }
    }
  }
}
