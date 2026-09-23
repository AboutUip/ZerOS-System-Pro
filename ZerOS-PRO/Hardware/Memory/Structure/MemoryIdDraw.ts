/**
 * @module ZerOS.Hardware.Memory.MemoryIdDraw
 * @description 内存 ID 的协议抽签（MemoryId）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 按 ZMP1 §4.7.3 从可打印 ASCII 里均匀抽出 256 个字符。
 * 抽到全 `0` 时重抽。不写 Config，失败时返回 null。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 字符表
 *   2. drawMemoryId
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      /**
       * MemoryId 的字符表：U+0021 到 U+007E，共 94 个可打印 ASCII。
       * 含数字 0，所以全零串仍可能被抽到，必须重抽。
       */
      export const MemoryIdAlphabet: string = buildAlphabet();

      /**
       * 抽出一条已启用的 MemoryId。
       * 宿主没有 crypto.getRandomValues 时返回 null，调用方不得发布总控。
       */
      export function drawMemoryId(byteLength: number): string | null {
        const cryptoApi: Crypto = globalThis.crypto;
        if (typeof cryptoApi.getRandomValues !== "function") {
          return null;
        }
        const alphabet: string = ZerOS.Hardware.Memory.MemoryIdAlphabet;
        const alphabetLength: number = alphabet.length;
        const rejectionLimit: number = Math.floor(256 / alphabetLength) * alphabetLength;
        const zeroId: string = "0".repeat(byteLength);
        let drawn = "";
        while (drawn === "" || drawn === zeroId) {
          const chars: string[] = [];
          while (chars.length < byteLength) {
            const bucket = new Uint8Array(1);
            cryptoApi.getRandomValues(bucket);
            const sample: number | undefined = bucket[0];
            if (sample === undefined || sample >= rejectionLimit) {
              continue;
            }
            const character: string | undefined = alphabet[sample % alphabetLength];
            if (character === undefined) {
              continue;
            }
            chars.push(character);
          }
          drawn = chars.join("");
        }
        return drawn;
      }

      function buildAlphabet(): string {
        let text = "";
        let code = 0x21;
        while (code <= 0x7e) {
          text += String.fromCharCode(code);
          code += 1;
        }
        return text;
      }
    }
  }
}
