/**
 * @module ZerOS.Hardware.Sandbox.ReferenceSandboxProvider
 * @description 官方沙盒插头
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 把 ZSP1 包成扩展口能 Bind 的插头。
 * 运行命令若留下启动请求，就交给 CPU 的客程序入口。失败留在沙盒状态里。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. ReferenceSandboxProvider
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import type { ZerOS as ExpansionProviderRoot } from "../../Motherboard/Slot/Expansion/ExpansionProvider";
import { ZerOS as CpuSeatRoot } from "../../Motherboard/Seat/CpuSeat";
import { ZerOS as ConfigRoot } from "../Config/SandboxConfig";
import { ZerOS as RuntimeRoot } from "../Bootstrap/SandboxRuntime";
import { ZerOS as SelfCheckRoot } from "../Test/SandboxSelfCheck";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Sandbox {
      const Protocol = ConfigRoot.Hardware.Sandbox.SandboxConfig.Protocol;
      const ExchangeProtocol = ConfigRoot.Hardware.Sandbox.SandboxConfig.ExchangeProtocol;
      const GuestCore = ConfigRoot.Hardware.Sandbox.SandboxConfig.GuestCore;
      const exchangeWord = RuntimeRoot.Hardware.Sandbox.exchangeWord;
      const takeLaunch = RuntimeRoot.Hardware.Sandbox.takeLaunch;
      const noteGuestResult = RuntimeRoot.Hardware.Sandbox.noteGuestResult;
      const runSandboxSelfCheck = SelfCheckRoot.Hardware.Sandbox.runSandboxSelfCheck;
      const startGuest = CpuSeatRoot.Hardware.Motherboard.startGuest;

      /**
       * 官方参考沙盒。
       * Boot 先做状态机自检。自检不启动客程序，所以不会碰正在画的引导画面。
       */
      export const ReferenceSandboxProvider: ExpansionProviderRoot.Hardware.Motherboard.Slot.ExpansionProvider = {
        ProviderId: "ZerOS-Reference-Sandbox",
        ProviderVendor: "ZerOS-Team",
        ActiveProtocol: ExchangeProtocol,
        DeviceProtocol: Protocol,
        Load(): void {
          return;
        },
        Boot(): void {
          runSandboxSelfCheck();
        },
        Exchange(direction: number, payload: Uint8Array): Uint8Array {
          const result = exchangeWord(direction, payload);
          const pending = takeLaunch();
          if (pending !== null) {
            try {
              startGuest(GuestCore, pending.lines, pending.ticket);
            } catch (error: unknown) {
              const message = error instanceof Error ? error.message : "[ZerOS.Hardware.Sandbox] 客程序没有启动";
              noteGuestResult(pending.ticket, false, message, []);
            }
          }
          return result;
        },
      };
    }
  }
}
