/**
 * @module ZerOS.Hardware.Cpu.LocalStraightCheck
 * @description 同一种本地整数运算连成一段时的结果
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 在 0 号核心上跑很短的序列。每种运算连续两条，从而走进直循环，而不是只走单条路径。
 * 除零、无符号操作数不合法、移位越界必须停在那一条：目的寄存器保持原值，后面的赋值不做。
 * 单条除零再走一遍，确认没进直循环的那条路径也是同样的停法。
 * 不测耗时，也不把长循环放进上电自检。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. runLocalStraightCheck
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as RuntimeRoot } from "../Bootstrap/CpuRuntime";
import { ZerOS as LinesRoot } from "./GuestLines";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      const runGuest = RuntimeRoot.Hardware.Cpu.runGuest;
      const guestLines = LinesRoot.Hardware.Cpu.guestLines;
      const checkPrefix = "[ZerOS.Hardware.Cpu.LocalStraightCheck]";

      function fail(message: string): never {
        throw new Error(`${checkPrefix} ${message}`);
      }

      function at(registers: readonly bigint[], index: number): bigint {
        const value = registers[index];
        if (value === undefined) {
          fail(`did not read r${String(index)}`);
        }
        return value;
      }

      /**
       * 跑完一段并核对若干寄存器。
       * 目的寄存器事先写成 99。运算没跑到时，留下的就是 99，不会和真结果混在一起。
       */
      async function expectValue(title: string, lines: readonly string[], expect: readonly (readonly [number, bigint])[]): Promise<void> {
        const guest = await runGuest(0, guestLines(lines));
        if (!guest.Ok) {
          fail(`${title} did not finish ${guest.Message}`);
        }
        for (const [index, want] of expect) {
          const got = at(guest.Registers, index);
          if (got !== want) {
            fail(`${title} r${String(index)} is ${got.toString()}, expected ${want.toString()}`);
          }
        }
      }

      /**
       * 失败的那一条不写目的寄存器，紧跟着的赋值也不执行。
       * 连续两条同一种运算走直循环；只有一条时仍走逐条路径。两种都要停住。
       */
      async function expectStop(title: string, lines: readonly string[], snippet: string): Promise<void> {
        const guest = await runGuest(0, guestLines(lines));
        if (guest.Ok || !guest.Message.includes(snippet)) {
          fail(`${title} did not stop on the expected fault ${guest.Message}`);
        }
        if (at(guest.Registers, 0) !== 9n || at(guest.Registers, 3) !== 8n) {
          fail(`${title} changed registers from before the fault`);
        }
      }

      /** 0 号核心在调用前处于停止。这里只使用它，结束时程序自己 halt。 */
      export async function runLocalStraightCheck(): Promise<void> {
        /* (1) 加减乘除和求余。20 与 3 的商向零截成 6，余数是 2。 */
        await expectValue("integer arithmetic", [
          "place r0, 99",
          "place r4, 99",
          "place r5, 99",
          "place r6, 99",
          "place r7, 99",
          "place r1, 20",
          "place r2, 3",
          "add r0, r1, r2",
          "add r0, r1, r2",
          "sub r4, r1, r2",
          "sub r4, r1, r2",
          "mul r5, r2, r2",
          "mul r5, r2, r2",
          "div r6, r1, r2",
          "div r6, r1, r2",
          "mod r7, r1, r2",
          "mod r7, r1, r2",
          "halt",
        ], [[0, 23n], [4, 17n], [5, 9n], [6, 6n], [7, 2n]]);
        /* (2) 无符号除法和位运算。20 与 7 的与、或、异或互不相同，避免一种没跑却碰巧等于另一种。 */
        await expectValue("unsigned and bitwise", [
          "place r0, 99",
          "place r4, 99",
          "place r5, 99",
          "place r6, 99",
          "place r7, 99",
          "place r1, 20",
          "place r2, 7",
          "udiv r0, r1, r2",
          "udiv r0, r1, r2",
          "umod r4, r1, r2",
          "umod r4, r1, r2",
          "and r5, r1, r2",
          "and r5, r1, r2",
          "or r6, r1, r2",
          "or r6, r1, r2",
          "xor r7, r1, r2",
          "xor r7, r1, r2",
          "halt",
        ], [[0, 2n], [4, 6n], [5, 4n], [6, 23n], [7, 19n]]);
        /* (3) 移位是算术右移。-8 右移 1 位仍是 -4。相等比较写成 1 或 0。 */
        await expectValue("shift and equality", [
          "place r0, 99",
          "place r5, 99",
          "place r6, 99",
          "place r7, 99",
          "place r1, 1",
          "place r2, 4",
          "shl r0, r1, r2",
          "shl r0, r1, r2",
          "place r3, -8",
          "place r4, 1",
          "shr r5, r3, r4",
          "shr r5, r3, r4",
          "eq r6, r2, r2",
          "eq r6, r2, r2",
          "place r7, 99",
          "eq r7, r1, r2",
          "eq r7, r1, r2",
          "halt",
        ], [[0, 16n], [5, -4n], [6, 1n], [7, 0n]]);
        /* (4) 比较按数学整数序。取反没有位宽，0 的反是 -1，再反一次回到 0。 */
        await expectValue("compare and not", [
          "place r0, 99",
          "place r4, 99",
          "place r5, 99",
          "place r6, 99",
          "place r7, 3",
          "place r1, -1",
          "place r2, 2",
          "place r3, -1",
          "lt r5, r1, r2",
          "lt r5, r1, r2",
          "le r6, r1, r3",
          "le r6, r1, r3",
          "gt r7, r1, r2",
          "gt r7, r1, r2",
          "ge r4, r2, r2",
          "ge r4, r2, r2",
          "place r1, 0",
          "not r0, r1",
          "not r3, r0",
          "halt",
        ], [[0, -1n], [3, 0n], [4, 1n], [5, 1n], [6, 1n], [7, 0n]]);
        const stopHead = [
          "place r0, 9",
          "place r3, 8",
          "place r1, 1",
          "place r2, 0",
        ];
        /* (5) 连续两条除零走直循环。后面的 place 若被做掉，r3 会变成 4。 */
        await expectStop("two divisions by zero", [
          ...stopHead,
          "div r0, r1, r2",
          "div r0, r1, r2",
          "place r3, 4",
          "halt",
        ], "divisor is 0");
        await expectStop("one division by zero", [
          ...stopHead,
          "div r0, r1, r2",
          "place r3, 4",
          "halt",
        ], "divisor is 0");
        await expectStop("two remainders by zero", [
          ...stopHead,
          "mod r0, r1, r2",
          "mod r0, r1, r2",
          "place r3, 4",
          "halt",
        ], "divisor is 0");
        await expectStop("unsigned dividend is negative", [
          "place r0, 9",
          "place r3, 8",
          "place r1, -1",
          "place r2, 2",
          "udiv r0, r1, r2",
          "udiv r0, r1, r2",
          "place r3, 4",
          "halt",
        ], "unsigned division operand is illegal");
        await expectStop("unsigned divisor is zero", [
          ...stopHead,
          "umod r0, r1, r2",
          "umod r0, r1, r2",
          "place r3, 4",
          "halt",
        ], "unsigned division operand is illegal");
        await expectStop("shift left is out of range", [
          "place r0, 9",
          "place r3, 8",
          "place r1, 1",
          "place r2, 64",
          "shl r0, r1, r2",
          "shl r0, r1, r2",
          "place r3, 4",
          "halt",
        ], "shift count is outside 0 to 63");
        await expectStop("shift right is out of range", [
          "place r0, 9",
          "place r3, 8",
          "place r1, 1",
          "place r2, -1",
          "shr r0, r1, r2",
          "shr r0, r1, r2",
          "place r3, 4",
          "halt",
        ], "shift count is outside 0 to 63");
      }
    }
  }
}
