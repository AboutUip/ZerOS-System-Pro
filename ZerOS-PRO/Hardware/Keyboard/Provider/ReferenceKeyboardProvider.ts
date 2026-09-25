/**
 * @module ZerOS.Hardware.Keyboard.ReferenceKeyboardProvider
 * @description 官方键盘插头
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 把 ZKP1 的装配包成扩展口能 Bind 的插头。
 * 替换键盘实现时改 ActiveProvider，不改这个文件的调用方路径。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. ReferenceKeyboardProvider
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import type { ZerOS as ExpansionProviderRoot } from "../../Motherboard/Slot/Expansion/ExpansionProvider";
import { ZerOS as ConfigRoot } from "../Config/KeyboardConfig";
import { ZerOS as RuntimeRoot } from "../Bootstrap/KeyboardRuntime";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Keyboard {
      const Protocol = ConfigRoot.Hardware.Keyboard.KeyboardConfig.Protocol;
      const ExchangeProtocol = ConfigRoot.Hardware.Keyboard.KeyboardConfig.ExchangeProtocol;
      const exchangeWord = RuntimeRoot.Hardware.Keyboard.exchangeWord;

      /**
       * 官方参考键盘。
       * Load 与 Boot 不额外做事：协议状态由扩展口推进，事件只在 Exchange 里装配。
       */
      export const ReferenceKeyboardProvider: ExpansionProviderRoot.Hardware.Motherboard.Slot.ExpansionProvider = {
        ProviderId: "ZerOS-Reference-Keyboard",
        ProviderVendor: "ZerOS-Team",
        ActiveProtocol: ExchangeProtocol,
        DeviceProtocol: Protocol,
        Load(): void {
          return;
        },
        Boot(): void {
          return;
        },
        Exchange(direction: number, payload: Uint8Array): Uint8Array {
          return exchangeWord(direction, payload);
        },
      };
    }
  }
}
