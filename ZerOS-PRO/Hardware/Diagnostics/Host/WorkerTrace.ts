/**
 * @module ZerOS.Hardware.Diagnostics.WorkerTrace
 * @description 宿主工作线程的生命周期与页面投递失败点
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 把工作线程的创建、就绪、错误和消息反序列化失败写成低频事件。
 * 观察发生在创建线程上：页面观察主板线程，主板观察 CPU/核心/显卡/内存线程。
 * 只用 addEventListener，不换 onmessage，也不接管现有的 waitMessage/fault 路径。
 * 没有挂上 trace 页时直接返回，不留下看起来有覆盖、实际没写进去的假象。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 写入
 *   3. 观察
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as PageRoot } from "./TracePage";
import { ZerOS as OpRoot } from "../Enum/TraceOp";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Diagnostics {
      const traceInstant = PageRoot.Hardware.Diagnostics.traceInstant;
      const traceEnabled = PageRoot.Hardware.Diagnostics.traceEnabled;
      const TraceOp = OpRoot.Hardware.Diagnostics.TraceOp;
      const TraceLayer = OpRoot.Hardware.Diagnostics.TraceLayer;
      const TraceWorkerPhase = OpRoot.Hardware.Diagnostics.TraceWorkerPhase;
      const traceWorkerCode = OpRoot.Hardware.Diagnostics.traceWorkerCode;
      const TraceRejectSource = OpRoot.Hardware.Diagnostics.TraceRejectSource;
      const TraceRejectReason = OpRoot.Hardware.Diagnostics.TraceRejectReason;

      /* ------------------------------------------------------------------ */
      /* 2. 写入                                                             */
      /* ------------------------------------------------------------------ */

      /** 记录一次工作线程生命周期。detail 只放核号等小整数，不放消息正文。 */
      export function traceWorker(kind: number, phase: number, detail = 0): void {
        if (!traceEnabled()) {
          return;
        }
        traceInstant(TraceOp.Worker, TraceLayer.Host, -1, traceWorkerCode(kind, phase), detail);
      }

      /** 记录一次宿主投递拒绝。只写来源和原因编号，不存 payload。 */
      export function traceHostReject(source: number, reason: number): void {
        if (!traceEnabled()) {
          return;
        }
        traceInstant(TraceOp.HostReject, TraceLayer.Host, -1, source, reason);
      }

      /* ------------------------------------------------------------------ */
      /* 3. 观察                                                             */
      /* ------------------------------------------------------------------ */

      function asRecord(data: unknown): Record<string, unknown> | null {
        if (typeof data !== "object" || data === null || Array.isArray(data)) {
          return null;
        }
        return data as Record<string, unknown>;
      }

      /**
       * 在创建线程上观察一个工作线程。
       * ready 只看引导脚本的那一条消息；fault 仍由现有等待和失败记录处理，不在这里重复。
       * error/messageerror 只留原因编号；onError 给创建方清自己的等待状态。
       */
      export function observeWorker(
        worker: Worker,
        kind: number,
        detail = 0,
        onError?: () => void,
      ): void {
        const onMessage = (event: MessageEvent): void => {
          const record = asRecord(event.data as unknown);
          if (record?.["kind"] !== "ready") {
            return;
          }
          /* 引导脚本只报一次就绪；收完之后不再逐条看这个线程的消息。 */
          worker.removeEventListener("message", onMessage);
          traceWorker(kind, TraceWorkerPhase.Ready, detail);
        };
        worker.addEventListener("message", onMessage);
        worker.addEventListener("error", (): void => {
          traceWorker(kind, TraceWorkerPhase.Error, detail);
          traceHostReject(TraceRejectSource.Worker, TraceRejectReason.Unknown);
          onError?.();
        });
        worker.addEventListener("messageerror", (): void => {
          traceWorker(kind, TraceWorkerPhase.MessageError, detail);
          traceHostReject(TraceRejectSource.Worker, TraceRejectReason.Shape);
        });
      }
    }
  }
}
