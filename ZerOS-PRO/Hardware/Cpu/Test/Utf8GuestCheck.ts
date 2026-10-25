/**
 * @module ZerOS.Hardware.Cpu.Utf8GuestCheck
 * @description 在核心 1 上跑内核的 UTF-8 程序
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 字节来自 obrc -slot 1 编出的 Kernel/Text/utf8-check.obr。
 * 这里只解码程序映像并读 r0。解码规则在 Obr 里，宿主不再写一份。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. runUtf8GuestCheck
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as RuntimeRoot } from "../Bootstrap/CpuRuntime";
import { ZerOS as BinaryRoot } from "../Structure/ProgramBinary";
import { ZerOS as ImageRoot } from "./Utf8GuestImage";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      const runGuest = RuntimeRoot.Hardware.Cpu.runGuest;
      const decodeProgramBinary = BinaryRoot.Hardware.Cpu.decodeProgramBinary;
      const Utf8GuestImage = ImageRoot.Hardware.Cpu.Utf8GuestImage;
      const checkPrefix = "[ZerOS.Hardware.Cpu.Utf8GuestCheck]";

      function fail(message: string): never {
        throw new Error(`${checkPrefix} ${message}`);
      }

      /** 把编译器写下的 Base64 还原成程序字节。 */
      function guestBytes(): Uint8Array {
        const binary = atob(Utf8GuestImage);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }
        return bytes;
      }

      /* ---------------------------------------------------------------------- */
      /* 2. runUtf8GuestCheck                                                    */
      /* ---------------------------------------------------------------------- */

      /**
       * 核心 1 从第一条跑到停。
       * r0 为 0 表示 Utf8.md 里的那些例子都过了。别的数字是 utf8-check.obr 里的项号。
       */
      export async function runUtf8GuestCheck(): Promise<void> {
        const guest = await runGuest(1, decodeProgramBinary(guestBytes()));
        if (!guest.Ok) {
          fail(`the utf-8 program did not finish ${guest.Message}`);
        }
        const result = guest.Registers[0];
        if (result === undefined || result !== 0n) {
          fail(`the utf-8 program returned ${String(result)}`);
        }
      }
    }
  }
}
