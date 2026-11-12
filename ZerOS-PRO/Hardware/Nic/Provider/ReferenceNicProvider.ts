/**
 * @module ZerOS.Hardware.Nic.ReferenceNicProvider
 * @description 官方网卡插头
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 把 ZNC1 装成扩展口能 Bind 的插头。
 * Load 与 Boot 不连接 Rust。服务没启动时，交换返回未就绪。
 * 不解析以太网帧，也不管理连接。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. ReferenceNicProvider
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import type { ZerOS as ExpansionProviderRoot } from "../../Motherboard/Slot/Expansion/ExpansionProvider";
import { ZerOS as ConfigRoot } from "../Config/NicConfig";
import { ZerOS as StatusRoot } from "../Enum/NicStatus";
import { ZerOS as RuntimeRoot } from "../Bootstrap/NicRuntime";
import { ZerOS as SelfCheckRoot } from "../Test/NicSelfCheck";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Nic {
      const Protocol = ConfigRoot.Hardware.Nic.NicConfig.Protocol;
      const ExchangeProtocol = ConfigRoot.Hardware.Nic.NicConfig.ExchangeProtocol;
      const WordOctets = ConfigRoot.Hardware.Nic.NicConfig.WordOctets;
      const FrameMax = ConfigRoot.Hardware.Nic.NicConfig.FrameMax;
      const NicStatusOk = StatusRoot.Hardware.Nic.NicStatusOk;
      const NicStatusBadArgument = StatusRoot.Hardware.Nic.NicStatusBadArgument;
      const control = RuntimeRoot.Hardware.Nic.control;
      const sendFrame = RuntimeRoot.Hardware.Nic.sendFrame;
      const receiveFrame = RuntimeRoot.Hardware.Nic.receiveFrame;
      const runNicSelfCheck = SelfCheckRoot.Hardware.Nic.runNicSelfCheck;

      /** 官方参考网卡。Boot 只跑不访问网络的本地自检。 */
      export const ReferenceNicProvider: ExpansionProviderRoot.Hardware.Motherboard.Slot.ExpansionProvider = {
        ProviderId: "ZerOS-Reference-Nic",
        ProviderVendor: "ZerOS-Team",
        ActiveProtocol: ExchangeProtocol,
        DeviceProtocol: Protocol,
        Load(): void {
          return;
        },
        Boot(): void {
          runNicSelfCheck();
        },
        Exchange(direction: number, payload: Uint8Array): Uint8Array | Promise<Uint8Array> {
          if (direction !== 0 || payload.length !== WordOctets) {
            throw new Error("[ZerOS.Hardware.Nic.ReferenceNicProvider] 控制字方向或长度不合法");
          }
          return control(direction, payload);
        },
        Offer(request: Uint8Array, replyMax: number): Promise<{ readonly status: number; readonly bytes: Uint8Array }> {
          if (!Number.isInteger(replyMax) || replyMax < 0 || replyMax > FrameMax) {
            return Promise.resolve({ status: NicStatusBadArgument, bytes: new Uint8Array(0) });
          }
          return sendFrame(request).then((status) => ({ status, bytes: new Uint8Array(0) }));
        },
        Carry(handle: number, offset: number, count: number): Promise<{ readonly status: number; readonly bytes: Uint8Array }> {
          if (handle !== 0 || offset !== 0 || !Number.isInteger(count) || count < 0) {
            return Promise.resolve({ status: NicStatusBadArgument, bytes: new Uint8Array(0) });
          }
          return receiveFrame(count).then((reply) => ({
            status: reply.status === NicStatusOk ? NicStatusOk : reply.status,
            bytes: reply.bytes,
          }));
        },
      };
    }
  }
}
