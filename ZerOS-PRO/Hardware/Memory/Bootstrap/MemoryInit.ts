/**
 * @module ZerOS.Hardware.Memory.Init
 * @description 内存初始化入口（MemoryInit）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 提供 ZMP1 §4.14 / §4.22 规范名 `MemoryInit`：挂在 `MachineMemory.MemoryInit`。
 * 本文件不认识 Boot、Kernel 或主板。谁来调用由坐座的主机决定。
 *
 * `Test` 是统一测试入口：无参数，一次跑完登记表里的全部用例，不发布总控。
 * `Initialize` 只在最近一次 `Test` 全部通过之后才把总控挂到 `MachineMemory.MemoryController`。
 * 总控已经挂上时，再次 `Initialize` 直接返回，不再复查测试。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. MemoryInit 接口
 *   3. 入口实例（Test / Initialize）
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as MemoryControllerRoot } from "../Controller/MemoryController";
import { ZerOS as MachineMemoryRoot } from "./MachineMemory";
import { ZerOS as TestVerdictRoot } from "../Enum/TestVerdict";
import { ZerOS as ExceptionCodeRoot } from "../Enum/ExceptionCode";
import { ZerOS as ExceptionCategoryRoot } from "../Enum/ExceptionCategory";
import { ZerOS as MemoryExceptionRoot } from "../Structure/MemoryException";
import { ZerOS as MemoryTestReportRoot } from "../Structure/MemoryTestReport";
import { ZerOS as MemoryTestSuiteRoot } from "../Test/MemoryTestSuite";
import { ZerOS as MemoryConfigRoot } from "../Config/MemoryConfig";
import { ZerOS as CapacityRoot } from "../Structure/Capacity";
import { ZerOS as MemoryIdDrawRoot } from "../Structure/MemoryIdDraw";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      /* -------------------------------------------------------------------- */
      /* 2. MemoryInit                                                         */
      /* -------------------------------------------------------------------- */

      /**
       * MemoryInit 入口（ZMP1 §4.14、§4.22）。
       * 规范方法只有 `Test` 与 `Initialize`，都无参数、无返回值。
       */
      export interface MemoryInit {
        /**
         * 实现内品牌标记：标明此对象为 MemoryInit 入口。
         * 非 ZMP1 互操作必选字段。
         */
        readonly __MemoryInitBrand: "MemoryInit";

        /**
         * 最近一次完整 `Test` 的裁定。
         * 尚未调用时为 `0x0`。只有 `0x1` 才允许尚未发布的 `Initialize` 继续。
         */
        readonly TestVerdict: TestVerdictRoot.Hardware.Memory.TestVerdict;

        /**
         * 最近一次完整 `Test` 的报告。
         * 尚未调用时 `Cases` 为空，`AllPassed` 为 `0`。
         */
        readonly TestReport: MemoryTestReportRoot.Hardware.Memory.MemoryTestReport;

        /**
         * 放行失败时追加的异常。用例本身的失败写在 `TestReport`，不写这里。
         */
        readonly Exceptions: readonly MemoryExceptionRoot.Hardware.Memory.MemoryException[];

        /**
         * 统一测试入口（ZMP1 §4.22 规范方法名 `Test`）。
         * 按登记表顺序跑完每一个用例。不写入 `MachineMemory.MemoryController`。
         */
        Test(): void;

        /**
         * 执行内存初始化（ZMP1 §4.14 规范方法名 `Initialize`）。
         *
         * 语义：
         *   (1) 若 MachineMemory.MemoryController 已非 null → 直接返回（幂等，不重抽 MemoryId）
         *   (2) 若 TestVerdict 不是 0x1 → 记下 0x0011 并中止，不发布总控
         *   (3) new MemoryController，此时还不发布
         *   (4) 各颗 Cells.length 之和小于 1 → 记下 0x0012，不改配置面，不发布
         *   (5) 抽不出已启用的 MemoryId → 记下 0x0003，不改配置面，不发布
         *   (6) 先写 TotalSizeBytes 与 MemoryId，再把总控写入 MachineMemory.MemoryController
         */
        Initialize(): void;
      }

      /* -------------------------------------------------------------------- */
      /* 3. 入口实例                                                           */
      /* -------------------------------------------------------------------- */

      let testVerdict: TestVerdictRoot.Hardware.Memory.TestVerdict =
        TestVerdictRoot.Hardware.Memory.TestVerdictCode.NotRun;
      let testReport: MemoryTestReportRoot.Hardware.Memory.MemoryTestReport =
        MemoryTestReportRoot.Hardware.Memory.MemoryTestReportNotRun;
      let testRunning = false;
      const gateExceptions: MemoryExceptionRoot.Hardware.Memory.MemoryException[] = [];

      /**
       * 总控已经造出来，但是不能发布。
       * 配置面保持禁用，MachineMemory.MemoryController 保持空。
       */
      function refusePublish(exceptionCode: number, summary: string): never {
        const exception = MemoryExceptionRoot.Hardware.Memory.createMemoryException({
          ExceptionCode: exceptionCode,
          ExceptionCategory:
            ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
          ExceptionSummary: summary,
          ExceptionChain: {},
        });
        if (exception !== null) {
          gateExceptions.push(exception);
        }
        throw new Error(`[ZerOS.Hardware.Memory.MemoryInit] ${summary}`);
      }

      /**
       * 内存初始化入口实例（供 MachineMemory.MemoryInit 挂载）。
       * 发布目标是 MachineMemory.MemoryController，不是别的子系统。
       */
      export const MemoryInitInstance: MemoryInit = {
        __MemoryInitBrand: "MemoryInit",

        get TestVerdict(): TestVerdictRoot.Hardware.Memory.TestVerdict {
          return testVerdict;
        },

        get TestReport(): MemoryTestReportRoot.Hardware.Memory.MemoryTestReport {
          return testReport;
        },

        get Exceptions(): readonly MemoryExceptionRoot.Hardware.Memory.MemoryException[] {
          return gateExceptions;
        },

        Test(): void {
          // 嵌套调用不能把外层正在形成的裁定写成通过。
          if (testRunning) {
            throw new Error(
              `[ZerOS.Hardware.Memory.MemoryInit] Test 正在执行，嵌套调用不能改写裁定`,
            );
          }

          testRunning = true;
          try {
            const report = MemoryTestSuiteRoot.Hardware.Memory.runMemoryTestSuite();
            testReport = report;
            testVerdict =
              report.AllPassed === 1
                ? TestVerdictRoot.Hardware.Memory.TestVerdictCode.Passed
                : TestVerdictRoot.Hardware.Memory.TestVerdictCode.Failed;
          } catch (caught: unknown) {
            // 套件自身崩溃也必须撤销放行，不能留下上一次的通过。
            testVerdict = TestVerdictRoot.Hardware.Memory.TestVerdictCode.Failed;
            testReport = MemoryTestReportRoot.Hardware.Memory.memoryTestReportAborted(
              caught instanceof Error ? caught.message : String(caught),
            );
            throw new Error(
              `[ZerOS.Hardware.Memory.MemoryInit] Test 未能完成全部用例`,
            );
          } finally {
            testRunning = false;
          }
        },

        Initialize(): void {
          // —— (1) 幂等：已挂载则不再新建，也不再复查测试 ——
          if (MachineMemoryRoot.Hardware.Memory.MachineMemory.MemoryController !== null) {
            return;
          }

          // —— (2) 最近一次完整测试未全部通过：不构造、不发布 ——
          if (testVerdict !== TestVerdictRoot.Hardware.Memory.TestVerdictCode.Passed) {
            const exception = MemoryExceptionRoot.Hardware.Memory.createMemoryException({
              ExceptionCode:
                ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.TestsNotPassed,
              ExceptionCategory:
                ExceptionCategoryRoot.Hardware.Memory.ExceptionCategoryCode.Abort,
              ExceptionSummary: "初始化前测试尚未全部通过",
              ExceptionChain: {},
            });
            if (exception === null) {
              throw new Error(
                `[ZerOS.Hardware.Memory.MemoryInit] 无法写入合规 MemoryException，初始化中止`,
              );
            }
            gateExceptions.push(exception);
            throw new Error(
              `[ZerOS.Hardware.Memory.MemoryInit] 初始化前测试尚未全部通过`,
            );
          }

          // —— (3) 造出总控，但先不发布 ——
          const controller: MemoryControllerRoot.Hardware.Memory.MemoryController =
            new MemoryControllerRoot.Hardware.Memory.MemoryController();
          const lengths: number[] = [];
          for (const unit of controller.Units.values()) {
            lengths.push(unit.Cells.length);
          }
          const total: bigint = CapacityRoot.Hardware.Memory.totalOctetCount(lengths);
          if (total < 1n) {
            refusePublish(
              ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.NoUsableStorage,
              "没有可发布的八位组，总容量不能就绪",
            );
          }
          const memoryId: string | null = MemoryIdDrawRoot.Hardware.Memory.drawMemoryId(
            MemoryConfigRoot.Hardware.Memory.Config.MemoryIdByteLength,
          );
          if (memoryId === null) {
            refusePublish(
              ExceptionCodeRoot.Hardware.Memory.ExceptionCodeValue.CryptoUnavailable,
              "环境缺少 crypto.getRandomValues，无法生成 MemoryId",
            );
          }

          // —— (4) 先写配置面，再把总控挂到内存自己的门面上 ——
          MemoryConfigRoot.Hardware.Memory.Config.publishCapacity(total, memoryId);
          MachineMemoryRoot.Hardware.Memory.publishMemoryController(controller);
        },
      };
    }
  }
}
