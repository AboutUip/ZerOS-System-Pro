/**
 * @module ZerOS.Hardware.Motherboard.TimeChipCheck
 * @description 内置墙上时钟的读写边界自检
 */

import { ZerOS as TimeChipRoot } from "../Host/TimeChip";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      const readTime = TimeChipRoot.Hardware.Motherboard.readTime;
      const setTime = TimeChipRoot.Hardware.Motherboard.setTime;
      const checkPrefix = "[ZerOS.Hardware.Motherboard.TimeChipCheck]";

      function fail(message: string): never {
        throw new Error(`${checkPrefix} ${message}`);
      }

      export function runTimeChipCheck(): void {
        const original = readTime();
        const values = [
          -(1n << 63n),
          (1n << 63n) - 1n,
          1n << 127n,
        ];
        try {
          for (const value of values) {
            setTime(value);
            const observed = readTime();
            if (observed < value || observed - value > 100n) {
              fail("时间芯片不能读回刚设置的时间");
            }
          }
        } finally {
          setTime(original);
        }
      }
    }
  }
}
