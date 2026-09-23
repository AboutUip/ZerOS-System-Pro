/**
 * @module ZerOS.Hardware.Memory.Capacity
 * @description 已存在八位组的合计（TotalSizeBytes 的公式）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * TotalSizeBytes 等于各颗 Cells.length 之和。失败颗粒的长度是 0。
 * 不生成 MemoryId，也不发布总控。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. totalOctetCount
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      /**
       * 按颗粒序号顺序，把每一颗实际存在的八位组个数加起来。
       * 和可以超过 2^53，所以用 bigint。
       */
      export function totalOctetCount(octetLengths: readonly number[]): bigint {
        let total = 0n;
        for (const length of octetLengths) {
          total += BigInt(length);
        }
        return total;
      }
    }
  }
}
