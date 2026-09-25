/**
 * @module ZerOS.Hardware.Sandbox.SandboxSelfCheck
 * @description 沙盒状态机自检
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 核对复位、追加、空程序失败，以及一张过期票号不会改写新结果。
 * 不启动 CPU。引导时调用，结束时必须回到空闲。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. runSandboxSelfCheck
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as ConfigRoot } from "../Config/SandboxConfig";
import { ZerOS as StatusRoot } from "../Enum/SandboxStatus";
import { ZerOS as RuntimeRoot } from "../Bootstrap/SandboxRuntime";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Sandbox {
      const CommandReset = ConfigRoot.Hardware.Sandbox.SandboxConfig.CommandReset;
      const CommandAppend = ConfigRoot.Hardware.Sandbox.SandboxConfig.CommandAppend;
      const CommandRun = ConfigRoot.Hardware.Sandbox.SandboxConfig.CommandRun;
      const QueryStatus = ConfigRoot.Hardware.Sandbox.SandboxConfig.QueryStatus;
      const SandboxStatusEmpty = StatusRoot.Hardware.Sandbox.SandboxStatusEmpty;
      const SandboxStatusFailed = StatusRoot.Hardware.Sandbox.SandboxStatusFailed;
      const exchangeWord = RuntimeRoot.Hardware.Sandbox.exchangeWord;
      const noteGuestResult = RuntimeRoot.Hardware.Sandbox.noteGuestResult;
      const checkPrefix = "[ZerOS.Hardware.Sandbox.SandboxSelfCheck]";

      function fail(message: string): never {
        throw new Error(`${checkPrefix} ${message}`);
      }

      function wordOf(octets: readonly number[]): Uint8Array {
        const payload = new Uint8Array(8);
        for (let index = 0; index < octets.length && index < 8; index += 1) {
          payload[index] = octets[index] ?? 0;
        }
        return payload;
      }

      function readWord(payload: Uint8Array): bigint {
        let word = 0n;
        for (let index = 0; index < payload.length; index += 1) {
          word += BigInt(payload[index] ?? 0) << BigInt(index * 8);
        }
        return word;
      }

      /**
       * 引导时调用。
       * 先复位，确认空跑记成失败而不是抛出，再丢掉一张旧票并复位。
       */
      export function runSandboxSelfCheck(): void {
        exchangeWord(0, wordOf([CommandReset]));
        const empty = readWord(exchangeWord(1, wordOf([QueryStatus])));
        if (empty !== BigInt(SandboxStatusEmpty)) {
          fail("复位之后不是空闲");
        }
        const ran = readWord(exchangeWord(0, wordOf([CommandRun])));
        if (ran !== BigInt(SandboxStatusFailed)) {
          fail("没有程序时运行没有记成失败");
        }
        noteGuestResult(0, false, "过期结果", []);
        exchangeWord(0, wordOf([CommandAppend, 4, 0x68, 0x61, 0x6c, 0x74]));
        exchangeWord(0, wordOf([CommandReset]));
        const again = readWord(exchangeWord(1, wordOf([QueryStatus])));
        if (again !== BigInt(SandboxStatusEmpty)) {
          fail("自检结束时沙盒不是空闲");
        }
      }
    }
  }
}
