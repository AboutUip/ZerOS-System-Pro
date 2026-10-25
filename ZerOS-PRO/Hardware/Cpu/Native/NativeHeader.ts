/**
 * @module ZerOS.Hardware.Cpu.NativeHeader
 * @description 认出 ZNB1 映像头并取出代码
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只看文件头，不执行。版本、标志和代码长度不对时返回空，调用方保持目标核心原样。
 * 代码长度之后的导出表不在这段里，装入时忽略。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 取出代码
 */

/* -------------------------------------------------------------------------- */
/* 1. 取出代码                                                                 */
/* -------------------------------------------------------------------------- */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      /**
       * 头是 12 个八位组：魔数 5A 4E 42 31、版本 1、标志 0、代码八位组数。
       * 代码从第 12 个八位组开始，长度至少 1，并且必须落在文件里。
       * 返回的是拷贝。文件后面的导出表留在原处，不进入这段。
       */
      export function nativeCodeBytes(octets: Uint8Array): Uint8Array | null {
        if (octets.length < 12) {
          return null;
        }
        if (octets[0] !== 0x5a || octets[1] !== 0x4e || octets[2] !== 0x42 || octets[3] !== 0x31) {
          return null;
        }
        const version = (octets[4] ?? 0) | ((octets[5] ?? 0) << 8);
        const flags = (octets[6] ?? 0) | ((octets[7] ?? 0) << 8);
        const codeLength = ((octets[8] ?? 0) | ((octets[9] ?? 0) << 8) | ((octets[10] ?? 0) << 16) | ((octets[11] ?? 0) << 24)) >>> 0;
        if (version !== 1 || flags !== 0 || codeLength < 1 || 12 + codeLength > octets.length) {
          return null;
        }
        return octets.slice(12, 12 + codeLength);
      }
    }
  }
}
