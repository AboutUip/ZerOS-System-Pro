/**
 * @module ZerOS.Hardware.Motherboard.QueuedWorker
 * @description 先接上消息，再装入硬件模块
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 模块 Worker 在依赖图还在下载时，事件循环已经能把消息投递掉。
 * 那时 onmessage 还没装上，第一条消息就丢了。内存信箱的绑定就是这样超时的。
 * 这里用一段没有静态导入的经典脚本先把消息排进队列，再动态装入真正的调度模块。
 * 调度模块装完之后才向父线程回报就绪。父线程在这之前不把信箱交出去。
 * 同一个打开口顺手记下 Worker 的 spawn，并挂 ready/error/messageerror 监听；这是宿主诊断，不参与消息调度。
 * 调度模块仍按原文件拆开。这段脚本不包含硬件逻辑。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 引导脚本
 *   3. 主板线程与内存线程
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as MailboxRoot } from "./Mailbox";
import { ZerOS as WorkerTraceRoot } from "../../Diagnostics/Host/WorkerTrace";
import { ZerOS as TraceOpRoot } from "../../Diagnostics/Enum/TraceOp";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      const readyKind = JSON.stringify(MailboxRoot.Hardware.Motherboard.MailMessage.Ready);
      const faultKind = JSON.stringify(MailboxRoot.Hardware.Motherboard.MailMessage.Fault);
      const traceWorker = WorkerTraceRoot.Hardware.Diagnostics.traceWorker;
      const observeWorker = WorkerTraceRoot.Hardware.Diagnostics.observeWorker;
      const TraceWorkerKind = TraceOpRoot.Hardware.Diagnostics.TraceWorkerKind;
      const TraceWorkerPhase = TraceOpRoot.Hardware.Diagnostics.TraceWorkerPhase;

      /**
       * 经典引导脚本。
       * acceptLookup 是调度模块上的函数路径，只由下面两个函数传入。
       */
      function openQueued(moduleUrl: string, acceptLookup: string, name: string, kind: number, detail = 0): Worker {
        const source = [
          "const pending = [];",
          "let accept = null;",
          "globalThis.onmessage = (event) => {",
          "  const data = event.data;",
          "  if (accept === null) {",
          "    pending.push(data);",
          "    return;",
          "  }",
          "  accept(data);",
          "};",
          `import(${JSON.stringify(moduleUrl)}).then((mod) => {`,
          `  const deliver = ${acceptLookup};`,
          "  accept = deliver;",
          "  const queued = pending.splice(0, pending.length);",
          "  for (const data of queued) {",
          "    deliver(data);",
          "  }",
          `  globalThis.postMessage({ kind: ${readyKind} });`,
          "}, (error) => {",
          "  const text = error instanceof Error ? error.message : String(error);",
          `  globalThis.postMessage({ kind: ${faultKind}, message: text });`,
          "});",
        ].join("\n");
        const blob = new Blob([source], { type: "text/javascript" });
        const worker = new Worker(URL.createObjectURL(blob), { name });
        /* 创建线程可能还没有 trace 页；写入端会直接返回。只记低频生命周期，不记消息内容。 */
        traceWorker(kind, TraceWorkerPhase.Spawn, detail);
        observeWorker(worker, kind, detail);
        return worker;
      }

      /**
       * 把相对本模块的地址解析成绝对地址。
       * 不把字面量直接写进 `new URL(..., import.meta.url)`，避免工具链把它当成静态资源原文拷走。
       * 开发时相对本文件。构建时工具链把下面两个字符串改成产物目录里的脚本名。
       */
      function resolveModuleUrl(relative: string): string {
        const href = import.meta.url;
        const query = href.indexOf("?");
        const clean = query === -1 ? href : href.slice(0, query);
        const slash = clean.lastIndexOf("/");
        const directory = clean.slice(0, slash + 1);
        return new URL(relative, directory).href;
      }

      /**
       * 打开主板线程。
       * 开发时装本目录的 BoardDispatch.ts。构建后装同目录的 BoardDispatch.js。
       */
      export function openBoardWorker(): Worker {
        /* 查询用来躲开上一次主板线程的模块缓存。改了座位上的搬运就要把数字加一。 */
        const moduleUrl = `${resolveModuleUrl("./BoardDispatch.ts")}?board=29`;
        return openQueued(
          moduleUrl,
          "mod.ZerOS.Hardware.Motherboard.acceptBoardMessage",
          "ZerOS.Hardware.Motherboard",
          TraceWorkerKind.Board,
        );
      }

      /**
       * 打开内存线程。
       * 只把地址交给引导脚本。主板线程不执行内存实现。
       */
      export function openMemoryWorker(): Worker {
        const moduleUrl = `${resolveModuleUrl("../../Memory/Host/MemoryDispatch.ts")}?mem=5`;
        return openQueued(
          moduleUrl,
          "mod.ZerOS.Hardware.Memory.acceptMemoryMessage",
          "ZerOS.Hardware.Memory",
          TraceWorkerKind.Memory,
        );
      }

      /** 打开 CPU 主体线程。核心 Worker 另开，不在这里创建。 */
      export function openCpuWorker(): Worker {
        /* 查询只用来躲开浏览器对上一次核心图的缓存。改了 CpuDispatch 的依赖就要把数字加一。 */
        const moduleUrl = `${resolveModuleUrl("../../Cpu/Host/CpuDispatch.ts")}?cpu=81`;
        return openQueued(
          moduleUrl,
          "mod.ZerOS.Hardware.Cpu.acceptCpuMessage",
          "ZerOS.Hardware.Cpu",
          TraceWorkerKind.Cpu,
        );
      }

      /** 打开一个核心线程。主板每挂载一个核心调用一次。 */
      export function openCoreWorker(ordinal: number): Worker {
        /* 和 CPU 主体一样，查询用来躲开上一次核心线程的模块缓存。 */
        const moduleUrl = `${resolveModuleUrl("../../Cpu/Host/CoreDispatch.ts")}?core=16`;
        return openQueued(
          moduleUrl,
          "mod.ZerOS.Hardware.Cpu.acceptCoreMessage",
          "ZerOS.Hardware.Cpu.Core",
          TraceWorkerKind.Core,
          ordinal,
        );
      }

      /** 打开显卡线程。帧存储在那条线程里，不在主板线程里。 */
      export function openGpuWorker(): Worker {
        /* 查询用来躲开上一次显卡线程的模块缓存。改了呈现记账就要把数字加一。 */
        const moduleUrl = `${resolveModuleUrl("../../Gpu/Host/GpuDispatch.ts")}?gpu=11`;
        return openQueued(
          moduleUrl,
          "mod.ZerOS.Hardware.Gpu.acceptGpuMessage",
          "ZerOS.Hardware.Gpu",
          TraceWorkerKind.Gpu,
        );
      }
    }
  }
}
