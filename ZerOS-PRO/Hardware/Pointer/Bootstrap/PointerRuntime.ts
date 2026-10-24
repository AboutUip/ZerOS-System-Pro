/**
 * @module ZerOS.Hardware.Pointer.PointerRuntime
 * @description 鼠标设备上的事件装配
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只按 ZPP1 收下或读回一个字。不碰显示器，也不认识浏览器事件。
 * 一次事件要满 6 个合法字才进入未读队列。中途不合法则丢掉未完成的字。
 * 按下和松开在进入队列时改按住掩码。请求码 9 才把最旧的一次移出。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 装配
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as ConfigRoot } from "../Config/PointerConfig";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Pointer {
      const WordOctets = ConfigRoot.Hardware.Pointer.PointerConfig.WordOctets;
      const WordCount = ConfigRoot.Hardware.Pointer.PointerConfig.WordCount;
      const CoordMax = ConfigRoot.Hardware.Pointer.PointerConfig.CoordMax;
      const QueryCount = ConfigRoot.Hardware.Pointer.PointerConfig.QueryCount;
      const QueryKind = ConfigRoot.Hardware.Pointer.PointerConfig.QueryKind;
      const QueryButton = ConfigRoot.Hardware.Pointer.PointerConfig.QueryButton;
      const QueryX = ConfigRoot.Hardware.Pointer.PointerConfig.QueryX;
      const QueryY = ConfigRoot.Hardware.Pointer.PointerConfig.QueryY;
      const QueryModifiers = ConfigRoot.Hardware.Pointer.PointerConfig.QueryModifiers;
      const QueryWheel = ConfigRoot.Hardware.Pointer.PointerConfig.QueryWheel;
      const QueryHeld = ConfigRoot.Hardware.Pointer.PointerConfig.QueryHeld;
      const QueryDepth = ConfigRoot.Hardware.Pointer.PointerConfig.QueryDepth;
      const QueryPop = ConfigRoot.Hardware.Pointer.PointerConfig.QueryPop;
      const QueueMin = ConfigRoot.Hardware.Pointer.PointerConfig.QueueMin;
      const runtimePrefix = "[ZerOS.Hardware.Pointer.PointerRuntime]";

      /** 一次已经收满的事件。队列按收下的顺序排，下标 0 是最旧的。 */
      interface QueuedEvent {
        readonly kind: bigint;
        readonly button: bigint;
        readonly x: bigint;
        readonly y: bigint;
        readonly modifiers: bigint;
        readonly wheel: bigint;
      }

      const pending: bigint[] = [];
      const queue: QueuedEvent[] = [];
      let completed = 0n;
      let departed: QueuedEvent = { kind: 0n, button: 0n, x: 0n, y: 0n, modifiers: 0n, wheel: 0n };
      let held = 0n;

      function fail(message: string): never {
        throw new Error(`${runtimePrefix} ${message}`);
      }

      /** 8 个小端八位组收成一个无符号字。长度不对就丢掉未完成的事件。 */
      function decodeWord(payload: Uint8Array): bigint {
        if (payload.length !== WordOctets) {
          throw new Error(`${runtimePrefix} 鼠标交换的载荷不是 8 个八位组`);
        }
        let word = 0n;
        for (let index = 0; index < WordOctets; index += 1) {
          const octet = payload[index] ?? 0;
          word += BigInt(octet) << BigInt(index * 8);
        }
        return word;
      }

      /** 把一个无符号字写成 8 个小端八位组。 */
      function encodeWord(word: bigint): Uint8Array {
        const octets = new Uint8Array(WordOctets);
        let rest = word;
        for (let index = 0; index < WordOctets; index += 1) {
          octets[index] = Number(rest & 0xffn);
          rest >>= 8n;
        }
        return octets;
      }

      /**
       * 滚轮字只占低 32 位。
       * 高 32 位必须是 0，这样垂直和水平两个 16 位补码不会被误读成更大的整数。
       */
      function acceptWheel(word: bigint): boolean {
        return word >= 0n && word <= 0xffffffffn;
      }

      /** 按当前槽位检查这一个字。槽位就是已经收下的个数。 */
      function acceptWord(word: bigint): boolean {
        const slot = pending.length;
        if (slot === 0) {
          return word === 0n || word === 1n || word === 2n || word === 3n;
        }
        if (slot === 1) {
          const kind = pending[0] ?? 0n;
          if (kind === 0n || kind === 3n) {
            return word === 0n;
          }
          return word >= 1n && word <= 5n;
        }
        if (slot === 2 || slot === 3) {
          return word >= 0n && word <= BigInt(CoordMax);
        }
        if (slot === 4) {
          return word >= 0n && word <= 15n;
        }
        const kind = pending[0] ?? 0n;
        if (kind !== 3n) {
          return word === 0n;
        }
        return acceptWheel(word);
      }

      /** 键号 1 到 5 对应掩码的位 0 到 4。 */
      function buttonBit(button: bigint): bigint {
        return 1n << (button - 1n);
      }

      /**
       * 方向 0：收下这一个字。
       * 满 6 个才增加已完成次数。返回值永远是当前已完成次数。
       */
      function acceptHost(payload: Uint8Array): Uint8Array {
        const word = decodeWord(payload);
        if (!acceptWord(word)) {
          pending.length = 0;
          fail("鼠标事件的这个字不在合法范围");
        }
        pending.push(word);
        if (pending.length === WordCount) {
          const event: QueuedEvent = {
            kind: pending[0] ?? 0n,
            button: pending[1] ?? 0n,
            x: pending[2] ?? 0n,
            y: pending[3] ?? 0n,
            modifiers: pending[4] ?? 0n,
            wheel: pending[5] ?? 0n,
          };
          if (event.kind === 1n) {
            held |= buttonBit(event.button);
          } else if (event.kind === 2n) {
            /* 只清这一键的位。掩码其余位保持，避免把没按下的键写成按下。 */
            held &= 0x1fn ^ buttonBit(event.button);
          }
          remember(event);
          pending.length = 0;
          completed += 1n;
        }
        return encodeWord(completed);
      }

      /**
       * 放进未读队列。
       * 已满时先丢掉最旧的移动，这样按下和松开不会被后面的移动盖掉。
       * 队列里没有移动时才丢掉最旧的一次。
       */
      function remember(event: QueuedEvent): void {
        if (queue.length >= QueueMin) {
          let dropAt = queue.findIndex((item: QueuedEvent): boolean => item.kind === 0n);
          if (dropAt < 0) {
            dropAt = 0;
          }
          const removed = queue.splice(dropAt, 1)[0];
          if (removed !== undefined) {
            departed = removed;
          }
        }
        queue.push(event);
      }

      /** 请求码 1 至 6 看这一次：队列里最旧的，空了就看最近离开的。 */
      function visible(): QueuedEvent {
        return queue[0] ?? departed;
      }

      /** 方向 1：按请求码读回。还没有事件时，除次数和按住掩码以外都返回 0。 */
      function answerHost(payload: Uint8Array): Uint8Array {
        const query = decodeWord(payload);
        if (query === BigInt(QueryCount)) {
          return encodeWord(completed);
        }
        const shown = visible();
        if (query === BigInt(QueryKind)) {
          return encodeWord(shown.kind);
        }
        if (query === BigInt(QueryButton)) {
          return encodeWord(shown.button);
        }
        if (query === BigInt(QueryX)) {
          return encodeWord(shown.x);
        }
        if (query === BigInt(QueryY)) {
          return encodeWord(shown.y);
        }
        if (query === BigInt(QueryModifiers)) {
          return encodeWord(shown.modifiers);
        }
        if (query === BigInt(QueryWheel)) {
          return encodeWord(shown.wheel);
        }
        if (query === BigInt(QueryHeld)) {
          return encodeWord(held);
        }
        if (query === BigInt(QueryDepth)) {
          return encodeWord(BigInt(queue.length));
        }
        if (query === BigInt(QueryPop)) {
          const removed = queue.shift();
          if (removed !== undefined) {
            departed = removed;
          }
          return encodeWord(BigInt(queue.length));
        }
        fail("鼠标没有这种读回请求");
      }

      /**
       * 一次交换。方向只接受 0 或 1。
       * 失败时未完成的字已经被丢掉，已记下的事件和按住掩码不动。
       */
      export function exchangeWord(direction: number, payload: Uint8Array): Uint8Array {
        if (direction === 0) {
          return acceptHost(payload);
        }
        if (direction === 1) {
          return answerHost(payload);
        }
        fail("鼠标交换方向不是 0 或 1");
      }
    }
  }
}
