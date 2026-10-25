/**
 * @module ZerOS.Hardware.Gpu.FontBytes
 * @description 把已经读出的字体字节交给这一条显卡命令
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 显卡线程看不到线性位元。执行核心先把 FontFace 或 FontDraw 的那一段读出来，
 * 再随命令送来。这里只在同一条显卡线程里暂存这一份，下一条命令会换掉它。
 * 不解析 TrueType，也不绘制。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 暂存
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Gpu {
      let staged: Uint8Array | null = null;

      /** 这条加速命令附带的字节。没有就是 null，表示调用方没读到一段。 */
      export function stageFontBytes(bytes: Uint8Array | null): void {
        staged = bytes;
      }

      /** 取走上一条暂存。取走之后再取是 null，避免下一条字体命令看见旧文件。 */
      export function takeFontBytes(): Uint8Array | null {
        const bytes = staged;
        staged = null;
        return bytes;
      }
    }
  }
}
