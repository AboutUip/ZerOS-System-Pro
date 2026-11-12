/**
 * @module ZerOS.Hardware.Nic.NicSelfCheck
 * @description ZNC1 宿主侧自检
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 核对协议常量、能力字的编解码和短答复规则。
 * 不访问 Rust 服务。引导时调用，服务没启动也不许失败。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. runNicSelfCheck
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as ConfigRoot } from "../Config/NicConfig";
import { ZerOS as StatusRoot } from "../Enum/NicStatus";
import { ZerOS as RuntimeRoot } from "../Bootstrap/NicRuntime";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Nic {
      const Protocol: string = ConfigRoot.Hardware.Nic.NicConfig.Protocol;
      const FrameMax: number = ConfigRoot.Hardware.Nic.NicConfig.FrameMax;
      const QueueDepth: number = ConfigRoot.Hardware.Nic.NicConfig.QueueDepth;
      const WordOctets = ConfigRoot.Hardware.Nic.NicConfig.WordOctets;
      const NicStatusOk = StatusRoot.Hardware.Nic.NicStatusOk;
      const NicStatusNotReady = StatusRoot.Hardware.Nic.NicStatusNotReady;
      const decodeInfo = RuntimeRoot.Hardware.Nic.decodeInfo;
      const encodeInfo = RuntimeRoot.Hardware.Nic.encodeInfo;
      const checkPrefix = "[ZerOS.Hardware.Nic.NicSelfCheck]";

      function fail(message: string): never {
        throw new Error(`${checkPrefix} ${message}`);
      }

      /** 引导时调用。只用内存里的字，不打开套接字。 */
      export function runNicSelfCheck(): void {
        if (Protocol !== "ZNC1") {
          fail("协议标识不是 ZNC1");
        }
        if (FrameMax < 1500) {
          fail("帧上界小于最小以太网帧");
        }
        if (QueueDepth < 1) {
          fail("接收队列深度不是正数");
        }
        const sample = encodeInfo({
          status: NicStatusOk,
          frameMax: 9000,
          queueDepth: 8,
          wireKind: 1,
        });
        if (sample.length !== WordOctets) {
          fail("能力字不是 8 个八位组");
        }
        const decoded = decodeInfo(sample);
        if (decoded.status !== NicStatusOk
          || decoded.frameMax !== 9000
          || decoded.queueDepth !== 8
          || decoded.wireKind !== 1) {
          fail("能力字来回不一致");
        }
        const short = decodeInfo(Uint8Array.of(NicStatusOk, 0, 0, 0));
        if (short.status !== NicStatusNotReady) {
          fail("短答复没有按未就绪处理");
        }
      }
    }
  }
}
