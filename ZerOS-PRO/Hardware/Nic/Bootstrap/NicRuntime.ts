/**
 * @module ZerOS.Hardware.Nic.NicRuntime
 * @description ZNC1 会话与参考服务
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 用一条 WebSocket 把原始以太网帧交给 Rust 网卡，再把帧取回来。
 * 只搬八位组；不解析以太网、IP、TCP、UDP、ARP、DNS。
 * 服务没启动时返回未就绪，不抛出到引导。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 类型
 *   3. 会话
 *   4. 帧操作
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as ConfigRoot } from "../Config/NicConfig";
import { ZerOS as OpcodeRoot } from "../Enum/NicOpcode";
import { ZerOS as StatusRoot } from "../Enum/NicStatus";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Nic {
      const ServiceUrl = ConfigRoot.Hardware.Nic.NicConfig.ServiceUrl;
      const ServiceTimeoutMs = ConfigRoot.Hardware.Nic.NicConfig.ServiceTimeoutMs;
      const FrameMax = ConfigRoot.Hardware.Nic.NicConfig.FrameMax;
      const QueueDepth = ConfigRoot.Hardware.Nic.NicConfig.QueueDepth;
      const WordOctets = ConfigRoot.Hardware.Nic.NicConfig.WordOctets;
      const NicOpcodeInfo = OpcodeRoot.Hardware.Nic.NicOpcodeInfo;
      const NicOpcodeSend = OpcodeRoot.Hardware.Nic.NicOpcodeSend;
      const NicOpcodeReceive = OpcodeRoot.Hardware.Nic.NicOpcodeReceive;
      const NicOpcodeConfig = OpcodeRoot.Hardware.Nic.NicOpcodeConfig;
      const NicOpcodePing = OpcodeRoot.Hardware.Nic.NicOpcodePing;
      const NicStatusOk = StatusRoot.Hardware.Nic.NicStatusOk;
      const NicStatusEmpty = StatusRoot.Hardware.Nic.NicStatusEmpty;
      const NicStatusNotReady = StatusRoot.Hardware.Nic.NicStatusNotReady;
      const NicStatusTooLong = StatusRoot.Hardware.Nic.NicStatusTooLong;
      const NicStatusBadArgument = StatusRoot.Hardware.Nic.NicStatusBadArgument;
      const ControlInfo = ConfigRoot.Hardware.Nic.NicConfig.ControlInfo;
      const ControlConfig = ConfigRoot.Hardware.Nic.NicConfig.ControlConfig;
      const WireLoopback = ConfigRoot.Hardware.Nic.NicConfig.WireLoopback;
      const WireUdp = ConfigRoot.Hardware.Nic.NicConfig.WireUdp;
      const runtimePrefix = "[ZerOS.Hardware.Nic.NicRuntime]";

      /* -------------------------------------------------------------------- */
      /* 2. 类型                                                               */
      /* -------------------------------------------------------------------- */

      /** 一次探测的能力答复。 */
      export interface NicInfo {
        readonly status: number;
        readonly frameMax: number;
        readonly queueDepth: number;
        readonly wireKind: number;
      }

      /** 一次原始帧操作的答复。status 不是 0 时 bytes 为空。 */
      export interface NicReply {
        readonly status: number;
        readonly bytes: Uint8Array;
      }

      interface NicWaiter {
        done: boolean;
        readonly resolve: (bytes: Uint8Array) => void;
        readonly reject: (error: Error) => void;
        readonly timer: ReturnType<typeof setTimeout>;
      }

      /* -------------------------------------------------------------------- */
      /* 3. 会话                                                               */
      /* -------------------------------------------------------------------- */

      let socket: WebSocket | null = null;
      let opening: Promise<WebSocket> | null = null;
      const waiters: NicWaiter[] = [];

      function empty(): Uint8Array {
        return new Uint8Array(0);
      }

      function asBytes(data: unknown): Uint8Array | null {
        if (data instanceof ArrayBuffer) {
          return new Uint8Array(data);
        }
        if (data instanceof Uint8Array) {
          return data;
        }
        return null;
      }

      function settleWaiter(waiter: NicWaiter, bytes: Uint8Array | null, error: Error | null): void {
        if (waiter.done) {
          return;
        }
        waiter.done = true;
        clearTimeout(waiter.timer);
        const at = waiters.indexOf(waiter);
        if (at >= 0) {
          waiters.splice(at, 1);
        }
        if (bytes !== null) {
          waiter.resolve(bytes);
          return;
        }
        waiter.reject(error ?? new Error(`${runtimePrefix} 服务没有应答`));
      }

      function dropSocket(current: WebSocket): void {
        if (socket === current) {
          socket = null;
        }
        const pending = waiters.splice(0, waiters.length);
        const error = new Error(`${runtimePrefix} 服务没有应答`);
        for (const waiter of pending) {
          settleWaiter(waiter, null, error);
        }
      }

      function openSocket(): Promise<WebSocket> {
        if (socket !== null && socket.readyState === WebSocket.OPEN) {
          return Promise.resolve(socket);
        }
        if (opening !== null) {
          return opening;
        }
        const pending = new Promise<WebSocket>((resolve, reject): void => {
          let settled = false;
          const fail = (error: Error): void => {
            if (settled) {
              return;
            }
            settled = true;
            if (opening === pending) {
              opening = null;
            }
            reject(error);
          };
          const next = new WebSocket(ServiceUrl);
          next.binaryType = "arraybuffer";
          const timer = setTimeout((): void => {
            next.close();
            fail(new Error(`${runtimePrefix} 服务没有应答`));
          }, ServiceTimeoutMs);
          next.addEventListener("open", (): void => {
            if (settled) {
              return;
            }
            settled = true;
            clearTimeout(timer);
            socket = next;
            if (opening === pending) {
              opening = null;
            }
            resolve(next);
          });
          next.addEventListener("message", (event: MessageEvent): void => {
            const waiter = waiters.shift();
            if (waiter === undefined) {
              return;
            }
            const data: unknown = event.data;
            const bytes = asBytes(data);
            if (bytes === null) {
              settleWaiter(waiter, null, new Error(`${runtimePrefix} 服务答复不是字节`));
              return;
            }
            settleWaiter(waiter, bytes, null);
          });
          next.addEventListener("close", (): void => {
            clearTimeout(timer);
            fail(new Error(`${runtimePrefix} 服务没有应答`));
            dropSocket(next);
          });
          next.addEventListener("error", (): void => {
            fail(new Error(`${runtimePrefix} 服务没有应答`));
          });
        });
        opening = pending;
        return pending;
      }

      async function post(message: Uint8Array): Promise<Uint8Array> {
        const current = await openSocket();
        return await new Promise<Uint8Array>((resolve, reject): void => {
          const waiter: NicWaiter = {
            done: false,
            resolve,
            reject,
            timer: setTimeout((): void => {
              settleWaiter(waiter, null, new Error(`${runtimePrefix} 服务没有应答`));
              current.close();
            }, ServiceTimeoutMs),
          };
          waiters.push(waiter);
          try {
            const outbound = new Uint8Array(message.length);
            outbound.set(message);
            current.send(outbound);
          } catch {
            settleWaiter(waiter, null, new Error(`${runtimePrefix} 服务没有应答`));
          }
        });
      }

      /* -------------------------------------------------------------------- */
      /* 4. 帧操作                                                             */
      /* -------------------------------------------------------------------- */

      function u32(bytes: Uint8Array, at: number): number {
        return (bytes[at] ?? 0)
          + (bytes[at + 1] ?? 0) * 256
          + (bytes[at + 2] ?? 0) * 65536
          + (bytes[at + 3] ?? 0) * 16777216;
      }

      function u16(bytes: Uint8Array, at: number): number {
        return (bytes[at] ?? 0) + (bytes[at + 1] ?? 0) * 256;
      }

      /** 把 8 个能力八位组收成一份。短答复按未就绪处理。 */
      export function decodeInfo(bytes: Uint8Array): NicInfo {
        if (bytes.length < WordOctets) {
          return { status: NicStatusNotReady, frameMax: 0, queueDepth: 0, wireKind: 0 };
        }
        return {
          status: bytes[0] ?? NicStatusNotReady,
          frameMax: u32(bytes, 1),
          queueDepth: u16(bytes, 5),
          wireKind: bytes[7] ?? 0,
        };
      }

      /** 把一份能力收成 8 个八位组。自检和离线测试使用。 */
      export function encodeInfo(info: NicInfo): Uint8Array {
        const bytes = new Uint8Array(WordOctets);
        bytes[0] = info.status & 255;
        bytes[1] = info.frameMax & 255;
        bytes[2] = (info.frameMax >>> 8) & 255;
        bytes[3] = (info.frameMax >>> 16) & 255;
        bytes[4] = (info.frameMax >>> 24) & 255;
        bytes[5] = info.queueDepth & 255;
        bytes[6] = (info.queueDepth >>> 8) & 255;
        bytes[7] = info.wireKind & 255;
        return bytes;
      }

      /** 读取能力。服务没启动时返回未就绪，不抛出。 */
      export async function readInfo(): Promise<NicInfo> {
        try {
          const reply = await post(Uint8Array.of(NicOpcodeInfo));
          return decodeInfo(reply);
        } catch {
          return { status: NicStatusNotReady, frameMax: 0, queueDepth: 0, wireKind: 0 };
        }
      }

      function statusWord(status: number): Uint8Array {
        const bytes = new Uint8Array(WordOctets);
        bytes[0] = status & 255;
        return bytes;
      }

      /**
       * 一次控制字交换。返回正好 8 个八位组，失败也是 8 个。
       * 第一个八位组是操作：0 读能力，1 配置线。
       */
      export async function control(direction: number, payload: Uint8Array): Promise<Uint8Array> {
        if (direction !== 0 || payload.length !== WordOctets) {
          return statusWord(NicStatusBadArgument);
        }
        const op = payload[0] ?? NicStatusBadArgument;
        if (op === ControlInfo) {
          return encodeInfo(await readInfo());
        }
        if (op !== ControlConfig) {
          return statusWord(NicStatusBadArgument);
        }
        const wire = payload[1] ?? 0;
        if (wire === WireLoopback) {
          return statusWord(await configureWire("loopback"));
        }
        if (wire !== WireUdp) {
          return statusWord(NicStatusBadArgument);
        }
        const a = payload[2] ?? 0;
        const b = payload[3] ?? 0;
        const c = payload[4] ?? 0;
        const d = payload[5] ?? 0;
        const port = (payload[6] ?? 0) * 256 + (payload[7] ?? 0);
        const host = `${String(a)}.${String(b)}.${String(c)}.${String(d)}`;
        return statusWord(await configureWire(`udp:${host}:${String(port)}`));
      }

      /** 发送一帧原始以太网报文。返回状态，不返回帧。 */
      export async function sendFrame(frame: Uint8Array): Promise<number> {
        if (frame.length > FrameMax) {
          return NicStatusTooLong;
        }
        const message = new Uint8Array(1 + frame.length);
        message[0] = NicOpcodeSend;
        message.set(frame, 1);
        try {
          const reply = await post(message);
          return reply[0] ?? NicStatusNotReady;
        } catch {
          return NicStatusNotReady;
        }
      }

      /** 取走一帧原始以太网报文。没有帧时状态是空。 */
      export async function receiveFrame(limit: number): Promise<NicReply> {
        const capacity = Math.min(limit, FrameMax);
        if (!Number.isInteger(limit) || limit < 0) {
          return { status: NicStatusBadArgument, bytes: empty() };
        }
        try {
          const reply = await post(Uint8Array.of(NicOpcodeReceive));
          const status = reply[0] ?? NicStatusNotReady;
          if (status !== NicStatusOk) {
            return { status, bytes: empty() };
          }
          const bytes = reply.subarray(1);
          if (bytes.length > capacity) {
            return { status: NicStatusTooLong, bytes: empty() };
          }
          return { status, bytes };
        } catch {
          return { status: NicStatusNotReady, bytes: empty() };
        }
      }

      /** 配置网卡的线。载荷是 ASCII：loopback 或 udp:HOST:PORT。 */
      export async function configureWire(text: string): Promise<number> {
        const encoded = new TextEncoder().encode(text);
        const message = new Uint8Array(1 + encoded.length);
        message[0] = NicOpcodeConfig;
        message.set(encoded, 1);
        try {
          const reply = await post(message);
          return reply[0] ?? NicStatusNotReady;
        } catch {
          return NicStatusNotReady;
        }
      }

      /** 探活。 */
      export async function ping(): Promise<number> {
        try {
          const reply = await post(Uint8Array.of(NicOpcodePing));
          return reply[0] ?? NicStatusNotReady;
        } catch {
          return NicStatusNotReady;
        }
      }

      /** 参考实现的队列深度。能力上限交给驱动，这里只暴露标定值。 */
      export function queueDepth(): number {
        return QueueDepth;
      }

      /** 一帧上界。 */
      export function frameMax(): number {
        return FrameMax;
      }

      /** 接收空帧时使用的状态。自检使用。 */
      export function emptyStatus(): number {
        return NicStatusEmpty;
      }
    }
  }
}
