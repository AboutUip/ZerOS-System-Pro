/**
 * @module ZerOS.Hardware.Nas.NasRuntime
 * @description ZNP1 会话与参考服务
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 把 8 个八位组收成一次路径或文件操作。
 * 需要服务时用一条 WebSocket 询问官方 Node 进程。服务没启动只返回未就绪。
 * 句柄表在服务进程里，不在客程序的地址空间里。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 会话
 *   3. 交换
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as ConfigRoot } from "../Config/NasConfig";
import { ZerOS as KindRoot } from "../Enum/NasKind";
import { ZerOS as OpcodeRoot } from "../Enum/NasOpcode";
import { ZerOS as StatusRoot } from "../Enum/NasStatus";
import { ZerOS as VerbRoot } from "../Enum/NasVerb";
import type { ZerOS as MessageRoot } from "../Structure/NasMessage";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Nas {
      const WordOctets = ConfigRoot.Hardware.Nas.NasConfig.WordOctets;
      const PathMax = ConfigRoot.Hardware.Nas.NasConfig.PathMax;
      const TransferCeil = ConfigRoot.Hardware.Nas.NasConfig.TransferCeil;
      const ServiceUrl = ConfigRoot.Hardware.Nas.NasConfig.ServiceUrl;
      const ServiceTimeoutMs = ConfigRoot.Hardware.Nas.NasConfig.ServiceTimeoutMs;
      const ModeRead = ConfigRoot.Hardware.Nas.NasConfig.ModeRead;
      const ModeAppend = ConfigRoot.Hardware.Nas.NasConfig.ModeAppend;
      const NasKindFile = KindRoot.Hardware.Nas.NasKindFile;
      const NasKindDirectory = KindRoot.Hardware.Nas.NasKindDirectory;
      const NasOpcodeReset = OpcodeRoot.Hardware.Nas.NasOpcodeReset;
      const NasOpcodePathAppend = OpcodeRoot.Hardware.Nas.NasOpcodePathAppend;
      const NasOpcodePathKeep = OpcodeRoot.Hardware.Nas.NasOpcodePathKeep;
      const NasOpcodeSetHandle = OpcodeRoot.Hardware.Nas.NasOpcodeSetHandle;
      const NasOpcodeSetRange = OpcodeRoot.Hardware.Nas.NasOpcodeSetRange;
      const NasOpcodeStage = OpcodeRoot.Hardware.Nas.NasOpcodeStage;
      const NasOpcodeExec = OpcodeRoot.Hardware.Nas.NasOpcodeExec;
      const NasOpcodePull = OpcodeRoot.Hardware.Nas.NasOpcodePull;
      const NasOpcodeBegin = OpcodeRoot.Hardware.Nas.NasOpcodeBegin;
      const NasOpcodeEnd = OpcodeRoot.Hardware.Nas.NasOpcodeEnd;
      const NasStatusOk = StatusRoot.Hardware.Nas.NasStatusOk;
      const NasStatusNotReady = StatusRoot.Hardware.Nas.NasStatusNotReady;
      const NasStatusBadHandle = StatusRoot.Hardware.Nas.NasStatusBadHandle;
      const NasStatusBadName = StatusRoot.Hardware.Nas.NasStatusBadName;
      const NasStatusTooLong = StatusRoot.Hardware.Nas.NasStatusTooLong;
      const NasStatusIo = StatusRoot.Hardware.Nas.NasStatusIo;
      const NasStatusBusy = StatusRoot.Hardware.Nas.NasStatusBusy;
      const NasStatusNoSession = StatusRoot.Hardware.Nas.NasStatusNoSession;
      const NasStatusBadArgument = StatusRoot.Hardware.Nas.NasStatusBadArgument;
      const NasVerbStat = VerbRoot.Hardware.Nas.NasVerbStat;
      const NasVerbOpen = VerbRoot.Hardware.Nas.NasVerbOpen;
      const NasVerbClose = VerbRoot.Hardware.Nas.NasVerbClose;
      const NasVerbRead = VerbRoot.Hardware.Nas.NasVerbRead;
      const NasVerbWrite = VerbRoot.Hardware.Nas.NasVerbWrite;
      const NasVerbMkdir = VerbRoot.Hardware.Nas.NasVerbMkdir;
      const NasVerbRemove = VerbRoot.Hardware.Nas.NasVerbRemove;
      const NasVerbRename = VerbRoot.Hardware.Nas.NasVerbRename;
      const NasVerbReaddir = VerbRoot.Hardware.Nas.NasVerbReaddir;
      const runtimePrefix = "[ZerOS.Hardware.Nas.NasRuntime]";

      type NasRequest = MessageRoot.Hardware.Nas.NasRequest;
      type NasReply = MessageRoot.Hardware.Nas.NasReply;

      /** 一次规划。reject 不改会话。fetch 才询问服务。 */
      interface NasPlan {
        readonly kind: "local" | "reject" | "fetch";
        readonly status: number;
        readonly request: NasRequest;
      }

      interface NasSession {
        locked: boolean;
        builder: number[];
        path0: number[];
        path1: number[];
        handle: number;
        offset: number;
        length: number;
        stage: number[];
        result: Uint8Array;
        pullAt: number;
        execStatus: number;
      }

      const live = blankSession();

      function fail(message: string): never {
        throw new Error(`${runtimePrefix} ${message}`);
      }

      function blankSession(): NasSession {
        return {
          locked: false,
          builder: [],
          path0: [],
          path1: [],
          handle: 0,
          offset: 0,
          length: 0,
          stage: [],
          result: new Uint8Array(0),
          pullAt: 0,
          execStatus: 0,
        };
      }

      function emptyRequest(): NasRequest {
        return {
          op: "",
          path: "",
          from: "",
          to: "",
          handle: 0,
          mode: 0,
          offset: 0,
          length: 0,
          index: 0,
          data: "",
        };
      }

      function wipe(session: NasSession): void {
        session.locked = false;
        session.builder = [];
        session.path0 = [];
        session.path1 = [];
        session.handle = 0;
        session.offset = 0;
        session.length = 0;
        session.stage = [];
        session.result = new Uint8Array(0);
        session.pullAt = 0;
        session.execStatus = 0;
      }

      function word(status: number, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, b7 = 0): Uint8Array {
        return Uint8Array.of(status & 255, b1 & 255, b2 & 255, b3 & 255, b4 & 255, b5 & 255, b6 & 255, b7 & 255);
      }

      function octetOf(value: number, place: number): number {
        return Math.trunc(value / 256 ** place) & 255;
      }

      function u16(low: number, high: number): number {
        return (low & 255) + (high & 255) * 256;
      }

      function u32(b0: number, b1: number, b2: number, b3: number): number {
        return (b0 & 255) + (b1 & 255) * 256 + (b2 & 255) * 65536 + (b3 & 255) * 16777216;
      }

      function requireWord(direction: number, payload: Uint8Array): void {
        if (direction !== 0) {
          fail("交换方向不是 0");
        }
        if (payload.length !== WordOctets) {
          fail("载荷不是 8 个八位组");
        }
      }

      function textFromOctets(octets: readonly number[]): string | null {
        try {
          return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(octets));
        } catch {
          return null;
        }
      }

      function encodeBase64(octets: readonly number[]): string {
        let text = "";
        for (const value of octets) {
          text += String.fromCharCode(value & 255);
        }
        return btoa(text);
      }

      function decodeBase64(text: string): Uint8Array | null {
        try {
          const raw = atob(text);
          const bytes = new Uint8Array(raw.length);
          for (let index = 0; index < raw.length; index += 1) {
            bytes[index] = raw.charCodeAt(index);
          }
          return bytes;
        } catch {
          return null;
        }
      }

      function asReply(value: unknown): NasReply | null {
        if (typeof value !== "object" || value === null) {
          return null;
        }
        const record = value as Record<string, unknown>;
        const status = record["status"];
        if (typeof status !== "number" || !Number.isInteger(status)) {
          return null;
        }
        const kind = record["kind"];
        const size = record["size"];
        const handle = record["handle"];
        const name = record["name"];
        const data = record["data"];
        return {
          status,
          kind: typeof kind === "number" ? kind : 0,
          size: typeof size === "number" ? size : 0,
          handle: typeof handle === "number" ? handle : 0,
          name: typeof name === "string" ? name : "",
          data: typeof data === "string" ? data : "",
          length: typeof record["length"] === "number" ? record["length"] : 0,
        };
      }

      /**
       * 服务类操作若不能发出，返回状态码。
       * 能发出时返回 null。不修改会话。
       */
      function serviceFault(session: NasSession, payload: Uint8Array): number | null {
        const opcode = payload[0] ?? 0;
        if (opcode === NasOpcodeReset) {
          return null;
        }
        if (!session.locked) {
          return NasStatusNoSession;
        }
        const verb = payload[1] ?? 0;
        if (
          verb !== NasVerbStat
          && verb !== NasVerbOpen
          && verb !== NasVerbClose
          && verb !== NasVerbRead
          && verb !== NasVerbWrite
          && verb !== NasVerbMkdir
          && verb !== NasVerbRemove
          && verb !== NasVerbRename
          && verb !== NasVerbReaddir
        ) {
          return NasStatusBadArgument;
        }
        const mode = payload[2] ?? 0;
        if (verb === NasVerbOpen && (mode < ModeRead || mode > ModeAppend)) {
          return NasStatusBadArgument;
        }
        if (verb === NasVerbRead || verb === NasVerbWrite || verb === NasVerbClose) {
          if (session.handle < 1) {
            return NasStatusBadHandle;
          }
        }
        if (verb === NasVerbStat || verb === NasVerbOpen || verb === NasVerbMkdir || verb === NasVerbRemove || verb === NasVerbReaddir) {
          if (textFromOctets(session.path0) === null) {
            return NasStatusBadName;
          }
        }
        if (verb === NasVerbRename) {
          if (textFromOctets(session.path0) === null || textFromOctets(session.path1) === null) {
            return NasStatusBadName;
          }
        }
        return null;
      }

      function buildRequest(session: NasSession, payload: Uint8Array): NasRequest {
        const opcode = payload[0] ?? 0;
        if (opcode === NasOpcodeReset) {
          return { ...emptyRequest(), op: "ping" };
        }
        const verb = payload[1] ?? 0;
        const mode = payload[2] ?? 0;
        const path0 = textFromOctets(session.path0) ?? "";
        const path1 = textFromOctets(session.path1) ?? "";
        if (verb === NasVerbStat) {
          return { ...emptyRequest(), op: "stat", path: path0 };
        }
        if (verb === NasVerbOpen) {
          return { ...emptyRequest(), op: "open", path: path0, mode };
        }
        if (verb === NasVerbClose) {
          return { ...emptyRequest(), op: "close", handle: session.handle };
        }
        if (verb === NasVerbRead) {
          return { ...emptyRequest(), op: "read", handle: session.handle, offset: session.offset, length: session.length };
        }
        if (verb === NasVerbWrite) {
          return {
            ...emptyRequest(),
            op: "write",
            handle: session.handle,
            offset: session.offset,
            length: session.stage.length,
            data: encodeBase64(session.stage),
          };
        }
        if (verb === NasVerbMkdir) {
          return { ...emptyRequest(), op: "mkdir", path: path0 };
        }
        if (verb === NasVerbRemove) {
          return { ...emptyRequest(), op: "remove", path: path0 };
        }
        if (verb === NasVerbRename) {
          return { ...emptyRequest(), op: "rename", from: path0, to: path1 };
        }
        return { ...emptyRequest(), op: "readdir", path: path0, index: session.offset };
      }

      function applyExec(session: NasSession, payload: Uint8Array, fetched: NasReply): Uint8Array {
        const verb = payload[1] ?? 0;
        session.stage = [];
        session.result = new Uint8Array(0);
        session.pullAt = 0;
        session.execStatus = fetched.status;
        if (fetched.status !== NasStatusOk) {
          return word(fetched.status);
        }
        if (verb === NasVerbStat) {
          if (!Number.isInteger(fetched.size) || fetched.size < 0 || fetched.size > 0xffffffff) {
            session.execStatus = NasStatusTooLong;
            return word(NasStatusTooLong);
          }
          if (fetched.kind !== NasKindFile && fetched.kind !== NasKindDirectory) {
            session.execStatus = NasStatusIo;
            return word(NasStatusIo);
          }
          return word(
            NasStatusOk,
            fetched.kind,
            octetOf(fetched.size, 0),
            octetOf(fetched.size, 1),
            octetOf(fetched.size, 2),
            octetOf(fetched.size, 3),
          );
        }
        if (verb === NasVerbOpen) {
          if (!Number.isInteger(fetched.handle) || fetched.handle < 1 || fetched.handle > 0xffff) {
            session.execStatus = NasStatusIo;
            return word(NasStatusIo);
          }
          return word(NasStatusOk, 0, octetOf(fetched.handle, 0), octetOf(fetched.handle, 1));
        }
        if (verb === NasVerbRead) {
          const bytes = decodeBase64(fetched.data);
          if (bytes === null || bytes.length > TransferCeil) {
            session.execStatus = NasStatusIo;
            return word(NasStatusIo);
          }
          session.result = bytes;
          session.execStatus = NasStatusOk;
          return word(NasStatusOk, 0, octetOf(bytes.length, 0), octetOf(bytes.length, 1));
        }
        if (verb === NasVerbWrite) {
          const written = fetched.length;
          if (!Number.isInteger(written) || written < 0 || written > TransferCeil) {
            session.execStatus = NasStatusIo;
            return word(NasStatusIo);
          }
          return word(NasStatusOk, 0, octetOf(written, 0), octetOf(written, 1));
        }
        if (verb === NasVerbReaddir) {
          let bytes: Uint8Array;
          try {
            bytes = new TextEncoder().encode(fetched.name);
          } catch {
            session.execStatus = NasStatusIo;
            return word(NasStatusIo);
          }
          if (bytes.length > PathMax) {
            session.execStatus = NasStatusTooLong;
            return word(NasStatusTooLong);
          }
          session.result = bytes;
          session.execStatus = NasStatusOk;
          return word(NasStatusOk, 0, octetOf(bytes.length, 0), octetOf(bytes.length, 1));
        }
        return word(NasStatusOk);
      }

      function acceptLocal(session: NasSession, payload: Uint8Array): Uint8Array {
        const opcode = payload[0] ?? 0;
        if (opcode === NasOpcodeBegin) {
          if (session.locked) {
            return word(NasStatusBusy);
          }
          wipe(session);
          session.locked = true;
          return word(NasStatusOk);
        }
        if (opcode === NasOpcodeEnd) {
          session.locked = false;
          return word(NasStatusOk);
        }
        if (opcode === NasOpcodePull) {
          if (!session.locked) {
            return word(NasStatusNoSession);
          }
          if (session.execStatus !== NasStatusOk && session.result.length === 0) {
            return word(session.execStatus);
          }
          const amount = Math.min(6, session.result.length - session.pullAt);
          const packed = word(NasStatusOk, amount);
          for (let index = 0; index < amount; index += 1) {
            packed[index + 2] = session.result[session.pullAt + index] ?? 0;
          }
          session.pullAt += amount;
          return packed;
        }
        if (!session.locked) {
          return word(NasStatusNoSession);
        }
        if (opcode === NasOpcodePathAppend || opcode === NasOpcodeStage) {
          const count = payload[1] ?? 0;
          if (!Number.isInteger(count) || count < 1 || count > 6) {
            return word(NasStatusBadArgument);
          }
          const target = opcode === NasOpcodePathAppend ? session.builder : session.stage;
          const limit = opcode === NasOpcodePathAppend ? PathMax : TransferCeil;
          if (target.length + count > limit) {
            return word(NasStatusTooLong);
          }
          const chunk: number[] = [];
          for (let index = 0; index < count; index += 1) {
            const unit = payload[index + 2] ?? 0;
            if (opcode === NasOpcodePathAppend && (unit === 0 || unit === 0x5c || unit === 0x3a)) {
              return word(NasStatusBadName);
            }
            chunk.push(unit);
          }
          for (const unit of chunk) {
            target.push(unit);
          }
          return word(NasStatusOk);
        }
        if (opcode === NasOpcodePathKeep) {
          const slot = payload[1] ?? 0;
          if (slot !== 0 && slot !== 1) {
            return word(NasStatusBadArgument);
          }
          const copy = session.builder.slice();
          if (slot === 0) {
            session.path0 = copy;
          } else {
            session.path1 = copy;
          }
          session.builder = [];
          return word(NasStatusOk);
        }
        if (opcode === NasOpcodeSetHandle) {
          session.handle = u16(payload[1] ?? 0, payload[2] ?? 0);
          return word(NasStatusOk);
        }
        if (opcode === NasOpcodeSetRange) {
          const length = u16(payload[5] ?? 0, payload[6] ?? 0);
          if (length > TransferCeil) {
            return word(NasStatusTooLong);
          }
          session.offset = u32(payload[1] ?? 0, payload[2] ?? 0, payload[3] ?? 0, payload[4] ?? 0);
          session.length = length;
          return word(NasStatusOk);
        }
        return word(NasStatusBadArgument);
      }

      function acceptNasWord(session: NasSession, direction: number, payload: Uint8Array, fetched: NasReply | null): Uint8Array {
        requireWord(direction, payload);
        const opcode = payload[0] ?? 0;
        if (opcode === NasOpcodeReset) {
          const status = fetched === null ? NasStatusNotReady : fetched.status;
          wipe(session);
          return word(status === NasStatusOk ? NasStatusOk : status);
        }
        if (opcode === NasOpcodeExec) {
          const fault = serviceFault(session, payload);
          if (fault !== null) {
            return word(fault);
          }
          if (fetched === null) {
            return word(NasStatusNotReady);
          }
          return applyExec(session, payload, fetched);
        }
        return acceptLocal(session, payload);
      }

      /**
       * 规划这一字要不要询问服务。
       * 不修改会话。方向或长度不合法时抛出，那是交换失败。
       */
      export function planNasWord(session: NasSession, direction: number, payload: Uint8Array): NasPlan {
        requireWord(direction, payload);
        const opcode = payload[0] ?? 0;
        if (opcode !== NasOpcodeReset && opcode !== NasOpcodeExec) {
          return { kind: "local", status: NasStatusOk, request: emptyRequest() };
        }
        const fault = serviceFault(session, payload);
        if (fault !== null) {
          return { kind: "reject", status: fault, request: emptyRequest() };
        }
        return { kind: "fetch", status: NasStatusOk, request: buildRequest(session, payload) };
      }

      /**
       * 用已经拿到的服务答复推进一份独立会话。
       * fetched 为 null 表示服务没有应答。自检使用它，不访问网络。
       */
      export function exchangePrepared(
        session: NasSession,
        direction: number,
        payload: Uint8Array,
        fetched: NasReply | null,
      ): Uint8Array {
        const plan = planNasWord(session, direction, payload);
        if (plan.kind === "reject") {
          return word(plan.status);
        }
        return acceptNasWord(session, direction, payload, plan.kind === "fetch" ? fetched : null);
      }

      /** 新的一份会话，与引导后那份实时会话分开。 */
      export function createNasSession(): NasSession {
        return blankSession();
      }

      /** 正在等服务答复的一笔。超时和断开都只结算一次。 */
      interface NasWaiter {
        done: boolean;
        readonly resolve: (reply: NasReply) => void;
        readonly reject: (error: Error) => void;
        readonly timer: ReturnType<typeof setTimeout>;
      }

      /** 已经打开的那条连接。断开后清空，下一笔再连。 */
      let nasSocket: WebSocket | null = null;

      /** 正在握手的那一次。避免两笔同时各开一条。 */
      let nasOpening: Promise<WebSocket> | null = null;

      /** 按送出顺序等答复。服务也按这个顺序回。 */
      const nasWaiters: NasWaiter[] = [];

      function settleWaiter(waiter: NasWaiter, reply: NasReply | null, error: Error | null): void {
        if (waiter.done) {
          return;
        }
        waiter.done = true;
        clearTimeout(waiter.timer);
        const index = nasWaiters.indexOf(waiter);
        if (index >= 0) {
          nasWaiters.splice(index, 1);
        }
        if (reply !== null) {
          waiter.resolve(reply);
          return;
        }
        waiter.reject(error ?? new Error(`${runtimePrefix} 服务没有应答`));
      }

      function dropSocket(current: WebSocket): void {
        if (nasSocket === current) {
          nasSocket = null;
        }
        const pending = nasWaiters.splice(0, nasWaiters.length);
        const error = new Error(`${runtimePrefix} 服务没有应答`);
        for (const waiter of pending) {
          settleWaiter(waiter, null, error);
        }
      }

      /**
       * 连上参考服务。
       * 已经开着就复用。握手超时或失败时，这一笔按未应答处理，不留下半开的套接字。
       */
      function openSocket(): Promise<WebSocket> {
        if (nasSocket !== null && nasSocket.readyState === WebSocket.OPEN) {
          return Promise.resolve(nasSocket);
        }
        if (nasOpening !== null) {
          return nasOpening;
        }
        const opening = new Promise<WebSocket>((resolve, reject): void => {
          let settled = false;
          const fail = (error: Error): void => {
            if (settled) {
              return;
            }
            settled = true;
            if (nasOpening === opening) {
              nasOpening = null;
            }
            reject(error);
          };
          const socket = new WebSocket(ServiceUrl);
          const timer = setTimeout((): void => {
            socket.close();
            fail(new Error(`${runtimePrefix} 服务没有应答`));
          }, ServiceTimeoutMs);
          socket.addEventListener("open", (): void => {
            if (settled) {
              return;
            }
            settled = true;
            clearTimeout(timer);
            nasSocket = socket;
            if (nasOpening === opening) {
              nasOpening = null;
            }
            resolve(socket);
          });
          socket.addEventListener("message", (event: MessageEvent): void => {
            const waiter = nasWaiters.shift();
            if (waiter === undefined) {
              return;
            }
            const text = typeof event.data === "string" ? event.data : "";
            let parsed: unknown;
            try {
              parsed = JSON.parse(text);
            } catch {
              settleWaiter(waiter, null, new Error(`${runtimePrefix} 服务答复不完整`));
              return;
            }
            const reply = asReply(parsed);
            if (reply === null) {
              settleWaiter(waiter, null, new Error(`${runtimePrefix} 服务答复不完整`));
              return;
            }
            settleWaiter(waiter, reply, null);
          });
          socket.addEventListener("close", (): void => {
            clearTimeout(timer);
            fail(new Error(`${runtimePrefix} 服务没有应答`));
            dropSocket(socket);
          });
          socket.addEventListener("error", (): void => {
            fail(new Error(`${runtimePrefix} 服务没有应答`));
          });
        });
        nasOpening = opening;
        return opening;
      }

      /**
       * 送出一笔并等对应的那条答复。
       * 连接还没有时先握手。服务没起来、超时或答复不是 JSON 时抛出，调用方当成未就绪。
       */
      async function postNas(request: NasRequest): Promise<NasReply> {
        const socket = await openSocket();
        return await new Promise((resolve, reject): void => {
          const waiter: NasWaiter = {
            done: false,
            resolve,
            reject,
            timer: setTimeout((): void => {
              settleWaiter(waiter, null, new Error(`${runtimePrefix} 服务没有应答`));
              socket.close();
            }, ServiceTimeoutMs),
          };
          nasWaiters.push(waiter);
          try {
            socket.send(JSON.stringify(request));
          } catch {
            settleWaiter(waiter, null, new Error(`${runtimePrefix} 服务没有应答`));
          }
        });
      }

      /**
       * 按句柄读一段，等价于 Begin、设句柄、设窗口、Exec、一次取走、End。
       * 会话在返回前结束。服务没有应答时状态是未就绪，不留下会话。
       */
      export async function readHandle(handle: number, offset: number, count: number): Promise<{ readonly status: number; readonly bytes: Uint8Array }> {
        const empty = new Uint8Array(0);
        if (!Number.isInteger(handle) || handle < 1 || handle > 65535) {
          return { status: NasStatusBadHandle, bytes: empty };
        }
        if (!Number.isInteger(offset) || offset < 0 || offset > 0xffffffff) {
          return { status: NasStatusBadArgument, bytes: empty };
        }
        if (!Number.isInteger(count) || count < 0 || count > TransferCeil) {
          return { status: count > TransferCeil ? NasStatusTooLong : NasStatusBadArgument, bytes: empty };
        }
        if (live.locked) {
          return { status: NasStatusBusy, bytes: empty };
        }
        wipe(live);
        live.locked = true;
        live.handle = handle;
        live.offset = offset;
        live.length = count;
        const payload = Uint8Array.of(NasOpcodeExec, NasVerbRead, 0, 0, 0, 0, 0, 0);
        const fault = serviceFault(live, payload);
        if (fault !== null) {
          live.locked = false;
          return { status: fault, bytes: empty };
        }
        if (count === 0) {
          live.locked = false;
          return { status: NasStatusOk, bytes: empty };
        }
        let fetched: NasReply | null = null;
        try {
          fetched = await postNas(buildRequest(live, payload));
        } catch {
          fetched = null;
        }
        if (fetched === null) {
          live.locked = false;
          return { status: NasStatusNotReady, bytes: empty };
        }
        const replied = applyExec(live, payload, fetched);
        const status = replied[0] ?? NasStatusIo;
        if (status !== NasStatusOk) {
          live.locked = false;
          return { status, bytes: empty };
        }
        const remain = live.result.length - live.pullAt;
        const amount = Math.min(count, remain < 0 ? 0 : remain);
        const bytes = new Uint8Array(amount);
        for (let index = 0; index < amount; index += 1) {
          bytes[index] = live.result[live.pullAt + index] ?? 0;
        }
        live.pullAt += amount;
        live.locked = false;
        return { status: NasStatusOk, bytes };
      }

      /**
       * 一次取走拉回缓冲里尚未取走的字节，至多 4096。
       * 游标只前进实际取走的个数。状态规则与 Pull 相同，这不是新的操作码。
       */
      export function drainPull(max: number): { readonly status: number; readonly bytes: Uint8Array } {
        if (!Number.isInteger(max) || max < 0 || max > 4096) {
          fail("一次拉回的长度超出 4096");
        }
        if (!live.locked) {
          return { status: NasStatusNoSession, bytes: new Uint8Array(0) };
        }
        if (live.execStatus !== NasStatusOk && live.result.length === 0) {
          return { status: live.execStatus, bytes: new Uint8Array(0) };
        }
        const remain = live.result.length - live.pullAt;
        const amount = Math.min(max, remain < 0 ? 0 : remain);
        const bytes = new Uint8Array(amount);
        for (let index = 0; index < amount; index += 1) {
          bytes[index] = live.result[live.pullAt + index] ?? 0;
        }
        live.pullAt += amount;
        return { status: NasStatusOk, bytes };
      }

      /**
       * 实时会话上的一次交换。
       * 服务没启动、超时或网络失败时返回未就绪，不抛出。
       */
      export async function exchangeWord(direction: number, payload: Uint8Array): Promise<Uint8Array> {
        const plan = planNasWord(live, direction, payload);
        if (plan.kind === "reject") {
          return word(plan.status);
        }
        if (plan.kind === "local") {
          return acceptNasWord(live, direction, payload, null);
        }
        let fetched: NasReply | null = null;
        try {
          fetched = await postNas(plan.request);
        } catch {
          fetched = null;
        }
        return acceptNasWord(live, direction, payload, fetched);
      }

    }
  }
}
