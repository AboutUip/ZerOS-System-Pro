/**
 * @module ZerOS.Hardware.Motherboard.MetricPage
 * @description 查询指令可读的已发布整数
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 每个数值字段占一格。座位在改写记录时写入，核心直接读，不必为了读数停下绘制。
 * 字符字段不在这里。还没写过的格子保持未发布，查询仍走原来的出核心路径。
 * 不解释字段含义，也不执行查询指令。布局是实现约定，不是协议。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 格子
 *   3. 读写
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as CpuConfigRoot } from "../../Cpu/Config/CpuConfig";
import { ZerOS as ExpansionConfigRoot } from "../Config/ExpansionConfig";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      /* ---------------------------------------------------------------------- */
      /* 2. 格子                                                                 */
      /* ---------------------------------------------------------------------- */

      const CoreMax = CpuConfigRoot.Hardware.Cpu.Config.CoreCountMax;
      const PortMax = ExpansionConfigRoot.Hardware.Motherboard.ExpansionConfig.PortCount;

      /**
       * 座位 1 从字段 5 起连续 8 项：状态、Hz、已完成条数、范围起点、范围长度、下一条、停止原因、时间片。
       * 每个已挂载核心一组。
       */
      const CpuFieldCount = 8;

      /** 座位 1 的声明核心数和寄存器个数。下标忽略，各占一格。 */
      const CpuCountSlot = 2;
      const CpuRegisterSlot = 3;

      /** 每个核心一格：1 表示已经挂上。没挂上时字段 5 至 12 必须失败。 */
      const CpuMountedBase = 4;
      const CpuCoreBase = CpuMountedBase + CoreMax;
      const AfterCpu = CpuCoreBase + CoreMax * CpuFieldCount;

      /** 座位 2：已初始化、标识非空、Hz、已完成访问。 */
      const MemoryBase = AfterCpu;

      /** 座位 3：帧宽、帧高、显存字节、Hz、已完成命令。 */
      const GpuBase = MemoryBase + 4;

      /** 座位 4：面板宽、高、刷新率。 */
      const PanelBase = GpuBase + 5;

      /** 座位 5 字段 0：每个口的状态。 */
      const PortBase = PanelBase + 3;

      const SlotCount = PortBase + PortMax;

      /**
       * 数值在前，发布标记在后。
       * 标记用 Atomics，避免核心读到写了一半的 64 位。
       */
      const ValueBytes = SlotCount * 8;
      const PageBytes = ValueBytes + SlotCount * 4;

      let owned: SharedArrayBuffer | null = null;
      let values: BigInt64Array | null = null;
      let flags: Int32Array | null = null;

      function bind(buffer: SharedArrayBuffer): void {
        owned = buffer;
        values = new BigInt64Array(buffer, 0, SlotCount);
        flags = new Int32Array(buffer, ValueBytes, SlotCount);
      }

      /**
       * 这一格在页里的下标。
       * 不是已发布的数值字段时返回空，调用方继续走原来的查询。
       */
      function slotOf(seat: number, field: number, index: number): number | null {
        if (seat === 0 && (field === 0 || field === 1)) {
          return field;
        }
        if (seat === 1 && field === 0) {
          return CpuCountSlot;
        }
        if (seat === 1 && field === 1) {
          return CpuRegisterSlot;
        }
        if (seat === 1 && field >= 5 && field <= 12) {
          if (!Number.isInteger(index) || index < 0 || index >= CoreMax) {
            return null;
          }
          return CpuCoreBase + index * CpuFieldCount + (field - 5);
        }
        if (seat === 2 && field === 0) {
          return MemoryBase;
        }
        if (seat === 2 && field === 1) {
          return MemoryBase + 1;
        }
        if (seat === 2 && field === 5) {
          return MemoryBase + 2;
        }
        if (seat === 2 && field === 6) {
          return MemoryBase + 3;
        }
        if (seat === 3 && field === 0) {
          return GpuBase;
        }
        if (seat === 3 && field === 1) {
          return GpuBase + 1;
        }
        if (seat === 3 && field === 5) {
          return GpuBase + 2;
        }
        if (seat === 3 && field === 6) {
          return GpuBase + 3;
        }
        if (seat === 3 && field === 7) {
          return GpuBase + 4;
        }
        if (seat === 4 && field >= 0 && field <= 2) {
          return PanelBase + field;
        }
        if (seat === 5 && field === 0) {
          if (!Number.isInteger(index) || index < 0 || index >= PortMax) {
            return null;
          }
          return PortBase + index;
        }
        return null;
      }

      function mountedSlot(index: number): number | null {
        if (!Number.isInteger(index) || index < 0 || index >= CoreMax) {
          return null;
        }
        return CpuMountedBase + index;
      }

      /* ---------------------------------------------------------------------- */
      /* 3. 读写                                                                 */
      /* ---------------------------------------------------------------------- */

      /** 主板线程创建这一页。其它线程拿到同一块缓冲后再挂上。 */
      export function openMetricPage(): SharedArrayBuffer {
        if (owned === null) {
          bind(new SharedArrayBuffer(PageBytes));
        }
        const buffer = owned;
        if (buffer === null) {
          throw new Error("[ZerOS.Hardware.Motherboard.MetricPage] 指标页没有建立");
        }
        return buffer;
      }

      /** 核心或 CPU 线程挂上主板交来的那一块。 */
      export function attachMetricPage(buffer: SharedArrayBuffer): void {
        if (buffer.byteLength !== PageBytes) {
          return;
        }
        bind(buffer);
      }

      export type MetricRead =
        | { readonly kind: "skip" }
        | { readonly kind: "missing"; readonly reason: "core-range" | "core-unmounted" | "port" }
        | { readonly kind: "value"; readonly value: bigint };

      /**
       * 读一格已发布的数。
       * skip：这一字段不是页上的数，或还没人写过。
       * missing：是页上的数，但下标没有挂上，查询必须失败。
       */
      export function readMetric(seat: number, field: number, index: number): MetricRead {
        const words = values;
        const marks = flags;
        if (words === null || marks === null) {
          return { kind: "skip" };
        }
        if (seat === 1 && field >= 5 && field <= 12) {
          const mounted = mountedSlot(index);
          if (mounted === null) {
            return { kind: "missing", reason: "core-range" };
          }
          const declared = Atomics.load(words, CpuCountSlot);
          if (Atomics.load(marks, CpuCountSlot) !== 0 && BigInt(index) >= declared) {
            return { kind: "missing", reason: "core-range" };
          }
          if (Atomics.load(marks, mounted) === 0) {
            return { kind: "skip" };
          }
          if (Atomics.load(words, mounted) === 0n) {
            return { kind: "missing", reason: "core-unmounted" };
          }
        }
        const slot = slotOf(seat, field, index);
        if (slot === null) {
          if (seat === 5 && field === 0) {
            return { kind: "missing", reason: "port" };
          }
          if (seat === 1 && field >= 5 && field <= 12) {
            return { kind: "missing", reason: "core-range" };
          }
          return { kind: "skip" };
        }
        if (Atomics.load(marks, slot) === 0) {
          return { kind: "skip" };
        }
        return { kind: "value", value: Atomics.load(words, slot) };
      }

      /** 座位改写记录时调用。写上之后，核心下一次查询就看见这个数。 */
      export function writeMetric(seat: number, field: number, index: number, value: bigint): void {
        const words = values;
        const marks = flags;
        if (words === null || marks === null) {
          return;
        }
        const slot = slotOf(seat, field, index);
        if (slot === null) {
          return;
        }
        Atomics.store(words, slot, value);
        Atomics.store(marks, slot, 1);
      }

      /** 核心挂上或卸下。卸下后字段 5 至 12 失败，不再把旧数交出去。 */
      export function writeCoreMounted(index: number, mounted: boolean): void {
        const words = values;
        const marks = flags;
        if (words === null || marks === null) {
          return;
        }
        const slot = mountedSlot(index);
        if (slot === null) {
          return;
        }
        Atomics.store(words, slot, mounted ? 1n : 0n);
        Atomics.store(marks, slot, 1);
      }
    }
  }
}
