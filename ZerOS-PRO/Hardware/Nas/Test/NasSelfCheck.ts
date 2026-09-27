/**
 * @module ZerOS.Hardware.Nas.NasSelfCheck
 * @description ZNP1 会话自检
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 核对开始、路径上界、执行答复和复位。
 * 不访问 Node 服务。引导时调用，服务没启动也不许失败。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. runNasSelfCheck
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as OpcodeRoot } from "../Enum/NasOpcode";
import { ZerOS as StatusRoot } from "../Enum/NasStatus";
import { ZerOS as VerbRoot } from "../Enum/NasVerb";
import type { ZerOS as MessageRoot } from "../Structure/NasMessage";
import { ZerOS as RuntimeRoot } from "../Bootstrap/NasRuntime";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Nas {
      const NasOpcodeReset = OpcodeRoot.Hardware.Nas.NasOpcodeReset;
      const NasOpcodePathAppend = OpcodeRoot.Hardware.Nas.NasOpcodePathAppend;
      const NasOpcodePathKeep = OpcodeRoot.Hardware.Nas.NasOpcodePathKeep;
      const NasOpcodeSetHandle = OpcodeRoot.Hardware.Nas.NasOpcodeSetHandle;
      const NasOpcodeSetRange = OpcodeRoot.Hardware.Nas.NasOpcodeSetRange;
      const NasOpcodeExec = OpcodeRoot.Hardware.Nas.NasOpcodeExec;
      const NasOpcodePull = OpcodeRoot.Hardware.Nas.NasOpcodePull;
      const NasOpcodeBegin = OpcodeRoot.Hardware.Nas.NasOpcodeBegin;
      const NasOpcodeEnd = OpcodeRoot.Hardware.Nas.NasOpcodeEnd;
      const NasStatusOk = StatusRoot.Hardware.Nas.NasStatusOk;
      const NasStatusNotReady = StatusRoot.Hardware.Nas.NasStatusNotReady;
      const NasStatusBadName = StatusRoot.Hardware.Nas.NasStatusBadName;
      const NasStatusTooLong = StatusRoot.Hardware.Nas.NasStatusTooLong;
      const NasStatusBusy = StatusRoot.Hardware.Nas.NasStatusBusy;
      const NasStatusNoSession = StatusRoot.Hardware.Nas.NasStatusNoSession;
      const NasStatusBadArgument = StatusRoot.Hardware.Nas.NasStatusBadArgument;
      const NasVerbStat = VerbRoot.Hardware.Nas.NasVerbStat;
      const NasVerbOpen = VerbRoot.Hardware.Nas.NasVerbOpen;
      const NasVerbRead = VerbRoot.Hardware.Nas.NasVerbRead;
      const createNasSession = RuntimeRoot.Hardware.Nas.createNasSession;
      const exchangePrepared = RuntimeRoot.Hardware.Nas.exchangePrepared;
      const planNasWord = RuntimeRoot.Hardware.Nas.planNasWord;
      const checkPrefix = "[ZerOS.Hardware.Nas.NasSelfCheck]";

      type NasReply = MessageRoot.Hardware.Nas.NasReply;
      type NasSession = ReturnType<typeof createNasSession>;

      function fail(message: string): never {
        throw new Error(`${checkPrefix} ${message}`);
      }

      function octets(values: readonly number[]): Uint8Array {
        const payload = new Uint8Array(8);
        for (let index = 0; index < values.length && index < 8; index += 1) {
          payload[index] = values[index] ?? 0;
        }
        return payload;
      }

      function answered(status: number, kind = 0, size = 0, handle = 0, name = "", data = "", length = 0): NasReply {
        return { status, kind, size, handle, name, data, length };
      }

      function drive(session: NasSession, payload: Uint8Array, fetched: NasReply | null = null): Uint8Array {
        return exchangePrepared(session, 0, payload, fetched);
      }

      /**
       * 引导时调用。
       * 只用内存里的会话，不打开套接字。
       */
      export function runNasSelfCheck(): void {
        const session = createNasSession();
        let rejected = false;
        try {
          drive(session, octets([NasOpcodeBegin]).subarray(0, 4));
        } catch {
          rejected = true;
        }
        if (!rejected) {
          fail("短载荷没有拒绝");
        }
        rejected = false;
        try {
          exchangePrepared(session, 1, octets([NasOpcodeBegin]), null);
        } catch {
          rejected = true;
        }
        if (!rejected) {
          fail("方向 1 没有拒绝");
        }
        if ((drive(session, octets([NasOpcodePathAppend, 1, 0x61]))[0] ?? 0) !== NasStatusNoSession) {
          fail("没有会话时追加路径仍被接受");
        }
        if ((drive(session, octets([NasOpcodeBegin]))[0] ?? 0) !== NasStatusOk) {
          fail("开始会话失败");
        }
        if ((drive(session, octets([NasOpcodeBegin]))[0] ?? 0) !== NasStatusBusy) {
          fail("重复开始没有报忙");
        }
        if ((drive(session, octets([NasOpcodePathAppend, 2, 0x61, 0x62]))[0] ?? 0) !== NasStatusOk) {
          fail("追加路径失败");
        }
        if ((drive(session, octets([NasOpcodePathAppend, 1, 0x5c]))[0] ?? 0) !== NasStatusBadName) {
          fail("反斜杠没有拒绝");
        }
        if ((drive(session, octets([NasOpcodePathKeep, 0]))[0] ?? 0) !== NasStatusOk) {
          fail("收存路径失败");
        }
        const planned = planNasWord(session, 0, octets([NasOpcodeExec, NasVerbStat, 0]));
        if (planned.kind !== "fetch" || planned.request.op !== "stat" || planned.request.path !== "ab") {
          fail("查看没有带上路径 ab");
        }
        const stat = drive(session, octets([NasOpcodeExec, NasVerbStat, 0]), answered(NasStatusOk, 1, 4));
        if ((stat[0] ?? 0) !== NasStatusOk || (stat[1] ?? 0) !== 1 || (stat[2] ?? 0) !== 4) {
          fail("查看答复没有按小端放回种类和大小");
        }
        if ((drive(session, octets([NasOpcodeEnd]))[0] ?? 0) !== NasStatusOk) {
          fail("结束会话失败");
        }
        if ((drive(session, octets([NasOpcodeBegin]))[0] ?? 0) !== NasStatusOk) {
          fail("结束后不能再开始");
        }
        const chunk = octets([NasOpcodePathAppend, 6, 0x61, 0x61, 0x61, 0x61, 0x61, 0x61]);
        for (let index = 0; index < 40; index += 1) {
          if ((drive(session, chunk)[0] ?? 0) !== NasStatusOk) {
            fail("240 个八位组以内的路径被拒绝");
          }
        }
        if ((drive(session, octets([NasOpcodePathAppend, 1, 0x61]))[0] ?? 0) !== NasStatusTooLong) {
          fail("超出 240 仍收下了片段");
        }
        const reset = drive(session, octets([NasOpcodeReset]), null);
        if ((reset[0] ?? 0) !== NasStatusNotReady) {
          fail("没有服务答复时复位不是未就绪");
        }
        if ((drive(session, octets([NasOpcodeBegin]))[0] ?? 0) !== NasStatusOk) {
          fail("复位没有解除会话");
        }
        if ((drive(session, octets([NasOpcodeExec, 99, 0]), answered(NasStatusOk))[0] ?? 0) !== NasStatusBadArgument) {
          fail("未知动词没有拒绝");
        }
        if ((drive(session, octets([NasOpcodeSetHandle, 4, 0]))[0] ?? 0) !== NasStatusOk) {
          fail("设置句柄失败");
        }
        if ((drive(session, octets([NasOpcodeSetRange, 0, 0, 0, 0, 2, 0]))[0] ?? 0) !== NasStatusOk) {
          fail("设置窗口失败");
        }
        const opened = drive(session, octets([NasOpcodeExec, NasVerbOpen, 0]), answered(NasStatusOk, 0, 0, 7));
        if ((opened[0] ?? 0) !== NasStatusOk || (opened[2] ?? 0) !== 7) {
          fail("打开没有放回句柄");
        }
        const read = drive(
          session,
          octets([NasOpcodeExec, NasVerbRead, 0]),
          answered(NasStatusOk, 0, 0, 0, "", btoa("AB"), 2),
        );
        if ((read[0] ?? 0) !== NasStatusOk || (read[2] ?? 0) !== 2) {
          fail("读取没有报告 2 个八位组");
        }
        const pulled = drive(session, octets([NasOpcodePull]));
        if ((pulled[0] ?? 0) !== NasStatusOk || (pulled[1] ?? 0) !== 2 || (pulled[2] ?? 0) !== 0x41 || (pulled[3] ?? 0) !== 0x42) {
          fail("拉回的不是 AB");
        }
        if ((drive(session, octets([NasOpcodePull]))[1] ?? 0) !== 0) {
          fail("拉完之后仍有剩余");
        }
        if ((drive(session, octets([NasOpcodeEnd]))[0] ?? 0) !== NasStatusOk) {
          fail("自检结束时会话没有解除");
        }
      }
    }
  }
}
