/**
 * @module ZerOS.Hardware.Keyboard.KeyboardRuntime
 * @description 键盘设备上的事件装配
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只按 ZKP1 收下或读回一个字。不碰显示器，也不认识浏览器事件。
 * 一次事件要满 6 个合法字才记下。中途不合法则丢掉未完成的字。
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

import { ZerOS as ConfigRoot } from "../Config/KeyboardConfig";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Keyboard {
      const WordOctets = ConfigRoot.Hardware.Keyboard.KeyboardConfig.WordOctets;
      const WordCount = ConfigRoot.Hardware.Keyboard.KeyboardConfig.WordCount;
      const QueryCount = ConfigRoot.Hardware.Keyboard.KeyboardConfig.QueryCount;
      const QueryKind = ConfigRoot.Hardware.Keyboard.KeyboardConfig.QueryKind;
      const QueryKey = ConfigRoot.Hardware.Keyboard.KeyboardConfig.QueryKey;
      const QueryCode = ConfigRoot.Hardware.Keyboard.KeyboardConfig.QueryCode;
      const runtimePrefix = "[ZerOS.Hardware.Keyboard.KeyboardRuntime]";

      const pending: bigint[] = [];
      let completed = 0n;
      let lastKind = 0n;
      let lastRepeat = 0n;
      let lastLocation = 0n;
      let lastModifiers = 0n;
      let lastKey = 0n;
      let lastCode = 0n;

      function fail(message: string): never {
        throw new Error(`${runtimePrefix} ${message}`);
      }

      /** 8 个小端八位组收成一个无符号字。长度不对就丢掉未完成的事件。 */
      function decodeWord(payload: Uint8Array): bigint {
        if (payload.length !== WordOctets) {
          throw new Error(`${runtimePrefix} 键盘交换的载荷不是 8 个八位组`);
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
       * 槽 5 是最多 8 个可打印 ASCII，小端。
       * 一旦出现 0，后面的字节也必须是 0，这样空名字和短名字都能表示。
       */
      function acceptCode(word: bigint): boolean {
        let seenZero = false;
        for (let index = 0; index < WordOctets; index += 1) {
          const octet = Number((word >> BigInt(index * 8)) & 0xffn);
          if (octet === 0) {
            seenZero = true;
            continue;
          }
          if (seenZero || octet < 0x20 || octet > 0x7e) {
            return false;
          }
        }
        return true;
      }

      /** 按当前槽位检查这一个字。槽位就是已经收下的个数。 */
      function acceptWord(word: bigint): boolean {
        const slot = pending.length;
        if (slot === 0) {
          return word === 0n || word === 1n || word === 2n;
        }
        if (slot === 1) {
          return word === 0n || word === 1n;
        }
        if (slot === 2) {
          return word >= 0n && word <= 3n;
        }
        if (slot === 3) {
          return word >= 0n && word <= 15n;
        }
        if (slot === 4) {
          return word >= 0n && word <= 65535n;
        }
        return acceptCode(word);
      }

      /**
       * 方向 0：收下这一个字。
       * 满 6 个才增加已完成次数。返回值永远是当前已完成次数。
       */
      function acceptHost(payload: Uint8Array): Uint8Array {
        const word = decodeWord(payload);
        if (!acceptWord(word)) {
          pending.length = 0;
          fail("键盘事件的这个字不在合法范围");
        }
        pending.push(word);
        if (pending.length === WordCount) {
          lastKind = pending[0] ?? 0n;
          lastRepeat = pending[1] ?? 0n;
          lastLocation = pending[2] ?? 0n;
          lastModifiers = pending[3] ?? 0n;
          lastKey = pending[4] ?? 0n;
          lastCode = pending[5] ?? 0n;
          pending.length = 0;
          completed += 1n;
        }
        return encodeWord(completed);
      }

      /** 方向 1：按请求码读回。还没有事件时，除次数以外都返回 0。 */
      function answerHost(payload: Uint8Array): Uint8Array {
        const query = decodeWord(payload);
        if (query === BigInt(QueryCount)) {
          return encodeWord(completed);
        }
        if (query === BigInt(QueryKind)) {
          return encodeWord(lastKind);
        }
        if (query === BigInt(QueryKey)) {
          return encodeWord(lastKey);
        }
        if (query === BigInt(QueryCode)) {
          return encodeWord(lastCode);
        }
        if (query === 4n) {
          return encodeWord(lastRepeat);
        }
        if (query === 5n) {
          return encodeWord(lastLocation);
        }
        if (query === 6n) {
          return encodeWord(lastModifiers);
        }
        fail("键盘没有这种读回请求");
      }

      /**
       * 一次交换。方向只接受 0 或 1。
       * 失败时未完成的字已经被丢掉，已记下的事件不动。
       */
      export function exchangeWord(direction: number, payload: Uint8Array): Uint8Array {
        if (direction === 0) {
          return acceptHost(payload);
        }
        if (direction === 1) {
          return answerHost(payload);
        }
        fail("键盘交换方向不是 0 或 1");
      }
    }
  }
}
