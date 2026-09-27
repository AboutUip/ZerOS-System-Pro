/**
 * @module ZerOS.Hardware.Nas.ReferenceNasProvider
 * @description 官方 NAS 插头
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 把 ZNP1 装成扩展口能 Bind 的插头。
 * Load 与 Boot 不连接 Node。服务没启动时，交换返回未就绪。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. ReferenceNasProvider
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import type { ZerOS as ExpansionProviderRoot } from "../../Motherboard/Slot/Expansion/ExpansionProvider";
import { ZerOS as ConfigRoot } from "../Config/NasConfig";
import { ZerOS as RuntimeRoot } from "../Bootstrap/NasRuntime";
import { ZerOS as SelfCheckRoot } from "../Test/NasSelfCheck";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Nas {
      const Protocol = ConfigRoot.Hardware.Nas.NasConfig.Protocol;
      const ExchangeProtocol = ConfigRoot.Hardware.Nas.NasConfig.ExchangeProtocol;
      const exchangeWord = RuntimeRoot.Hardware.Nas.exchangeWord;
      const drainPull = RuntimeRoot.Hardware.Nas.drainPull;
      const readHandle = RuntimeRoot.Hardware.Nas.readHandle;
      const runNasSelfCheck = SelfCheckRoot.Hardware.Nas.runNasSelfCheck;

      /**
       * 官方参考 NAS。
       * Boot 只跑不访问网络的会话自检。Node 进程要另开终端启动。
       */
      export const ReferenceNasProvider: ExpansionProviderRoot.Hardware.Motherboard.Slot.ExpansionProvider = {
        ProviderId: "ZerOS-Reference-Nas",
        ProviderVendor: "ZerOS-Team",
        ActiveProtocol: ExchangeProtocol,
        DeviceProtocol: Protocol,
        Load(): void {
          return;
        },
        Boot(): void {
          runNasSelfCheck();
        },
        Exchange(direction: number, payload: Uint8Array): Promise<Uint8Array> {
          return exchangeWord(direction, payload);
        },
        Drain(max: number): { readonly status: number; readonly bytes: Uint8Array } {
          return drainPull(max);
        },
        Carry(handle: number, offset: number, count: number): Promise<{ readonly status: number; readonly bytes: Uint8Array }> {
          return readHandle(handle, offset, count);
        },
      };
    }
  }
}
