/**
 * @module ZerOS.Hardware.Memory.LittleEndian
 * @description 小端整数的拼装与拆开
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 最低下标的八位组是最低有效字节。不访问颗粒。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 拼装 / 拆开 / 值域
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as IntegerWidthRoot } from "../Enum/IntegerWidth";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      /**
       * 把已经按低到高排好的八位组拼成整数。
       * 下标 0 的权重是 1。
       */
      export function packLittleEndian(octets: readonly number[]): bigint {
        let value = 0n;
        let index = 0;
        while (index < octets.length) {
          const octet = octets[index] ?? 0;
          value += BigInt(octet) << (BigInt(index) * 8n);
          index += 1;
        }
        return value;
      }

      /**
       * 把整数拆成 width 个八位组，下标 0 是最低有效字节。
       * 值不在该宽度里时返回 null，调用方不得写入。
       */
      export function unpackLittleEndian(
        value: bigint,
        width: IntegerWidthRoot.Hardware.Memory.IntegerWidth,
      ): number[] | null {
        if (value < 0n || value > IntegerWidthRoot.Hardware.Memory.integerValueMax(width)) {
          return null;
        }
        const octets: number[] = [];
        let rest = value;
        let index = 0;
        while (index < width) {
          octets.push(Number(rest & 0xffn));
          rest >>= 8n;
          index += 1;
        }
        return octets;
      }
    }
  }
}
