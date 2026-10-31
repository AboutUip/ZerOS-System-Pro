/**
 * @module ZerOS.Hardware.Diagnostics.TraceOp
 * @description trace 的事件码和名字
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只把事件码、层和报告用的名字放在一处。记录里存数字，报告里再换成名字。
 * 不解释事件语义；语义由写入方决定。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 层
 *   2. 事件
 *   3. 名字
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Diagnostics {
      /* ------------------------------------------------------------------ */
      /* 1. 层                                                               */
      /* ------------------------------------------------------------------ */

      export const TraceLayer = {
        Host: 1,
        Core: 2,
        Protocol: 3,
        Syscall: 4,
        Sched: 5,
        Boot: 6,
      } as const;

      /* ------------------------------------------------------------------ */
      /* 2. 事件                                                             */
      /* ------------------------------------------------------------------ */

      export const TraceOp = {
        Svc: 1,
        SvcReply: 2,
        Exchange: 3,
        ExchangeReply: 4,
        CoreStop: 5,
        Prompt: 6,
        Command: 7,
        CommandEnd: 8,
        Install: 9,
        InstallEnd: 10,
        Port: 11,
        PortEnd: 12,
        Dispatch: 13,
        Gpu: 14,
        GpuEnd: 15,
        HostEvent: 16,
        Frame: 17,
        FrameEnd: 18,
        Exec: 19,
        Insn: 20,
        Wake: 21,
        HostMessage: 22,
        HostReject: 23,
        Worker: 24,
        TaskWait: 25,
        TaskExit: 26,
        TaskSleep: 27,
        TaskWake: 28,
        Input: 29,
        KeyConsumed: 30,
        PointerConsumed: 31,
      } as const;

      /* ------------------------------------------------------------------ */
      /* 3. 名字                                                             */
      /* ------------------------------------------------------------------ */

      export const TraceOpName: Readonly<Record<number, string>> = {
        [TraceOp.Svc]: "svc",
        [TraceOp.SvcReply]: "svc-reply",
        [TraceOp.Exchange]: "exchange",
        [TraceOp.ExchangeReply]: "exchange-reply",
        [TraceOp.CoreStop]: "core-stop",
        [TraceOp.Prompt]: "prompt",
        [TraceOp.Command]: "command",
        [TraceOp.CommandEnd]: "command-end",
        [TraceOp.Install]: "install",
        [TraceOp.InstallEnd]: "install-end",
        [TraceOp.Port]: "port",
        [TraceOp.PortEnd]: "port-end",
        [TraceOp.Dispatch]: "dispatch",
        [TraceOp.Gpu]: "gpu",
        [TraceOp.GpuEnd]: "gpu-end",
        [TraceOp.HostEvent]: "host-event",
        [TraceOp.Frame]: "frame",
        [TraceOp.FrameEnd]: "frame-end",
        [TraceOp.Exec]: "exec",
        [TraceOp.Insn]: "insn",
        [TraceOp.Wake]: "wake",
        [TraceOp.HostMessage]: "host-message",
        [TraceOp.HostReject]: "host-reject",
        [TraceOp.Worker]: "worker",
        [TraceOp.TaskWait]: "task-wait",
        [TraceOp.TaskExit]: "task-exit",
        [TraceOp.TaskSleep]: "task-sleep",
        [TraceOp.TaskWake]: "task-wake",
        [TraceOp.Input]: "input",
        [TraceOp.KeyConsumed]: "key-consumed",
        [TraceOp.PointerConsumed]: "pointer-consumed",
      };

      /** 拒绝路径的来源与原因；都是诊断编号，不是协议。 */
      export const TraceRejectSource = {
        Inbox: 1,
        Pointer: 2,
        Frame: 3,
        Exchange: 4,
        Debug: 5,
        Unknown: 6,
        Buffer: 7,
        Page: 8,
        Worker: 9,
      } as const;

      export const TraceRejectReason = {
        Shape: 1,
        Overflow: 2,
        Unknown: 3,
        Buffer: 4,
        Timeout: 5,
        Invalid: 6,
        Clone: 7,
      } as const;

      /** 宿主工作线程的种类。与阶段一起编码进 Worker 事件的 A0。 */
      export const TraceWorkerKind = {
        Board: 1,
        Cpu: 2,
        Core: 3,
        Gpu: 4,
        Memory: 5,
      } as const;

      /** 工作线程的生命周期阶段。只记一次性的创建/就绪/错误，不记逐条消息。 */
      export const TraceWorkerPhase = {
        Spawn: 1,
        Ready: 2,
        Error: 3,
        MessageError: 4,
      } as const;

      /** Worker 事件的 A0：高 8 位是种类，低 8 位是阶段。 */
      export function traceWorkerCode(kind: number, phase: number): number {
        return ((kind & 0xff) << 8) | (phase & 0xff);
      }

      /** 板级生命周期消息的稳定编号；只用于诊断，不是协议。 */
      export const TraceBoardKind = {
        Power: 1,
        Fault: 2,
        Bind: 3,
        Go: 4,
        Ready: 5,
        Checked: 6,
        Trace: 7,
        TracePage: 8,
        Panel: 9,
        DebugRun: 10,
        DebugSwitch: 11,
        DebugResult: 12,
        FaultLog: 13,
        BootMark: 14,
      } as const;

      /** 宿主事件的 A0 取值。 */
      export const TraceHostEvent = {
        Pointer: 1,
        Inbox: 2,
        Debug: 3,
        Panel: 4,
        Keyboard: 5,
        PointerDevice: 6,
        Fault: 7,
        Clock: 8,
        Sandbox: 9,
        Display: 10,
        SandboxResult: 11,
        KeyboardPage: 12,
        PointerPage: 13,
      } as const;

      /** 内核服务号。没有列出的号在报告里写成 `svc N`。 */
      export const TraceServiceName: Readonly<Record<number, string>> = {
        1: "yield",
        2: "alloc",
        3: "free",
        4: "stat",
        5: "open",
        6: "close",
        7: "read",
        8: "write",
        9: "readdir",
        10: "mkdir",
        11: "unlink",
        12: "load",
        13: "unload",
        14: "chmod",
        15: "chown",
        16: "chdir",
        17: "spawn",
        18: "kill",
        19: "sigtake",
        20: "pipe",
        21: "wait",
        22: "loadlib",
        23: "devio",
        24: "dup",
        25: "dup2",
        26: "font",
        27: "compat",
        28: "exit",
        29: "getcwd",
        30: "clock",
        31: "utime",
        32: "ident",
        33: "task",
        34: "list",
        35: "prompt",
        36: "command",
      };

      /** 报告里使用的事件名。 */
      export function traceOpName(op: number): string {
        return TraceOpName[op] ?? `op ${String(op)}`;
      }

      /** 报告里使用的服务名。 */
      export function traceServiceName(service: number): string {
        return TraceServiceName[service] ?? `svc ${String(service)}`;
      }
    }
  }
}
