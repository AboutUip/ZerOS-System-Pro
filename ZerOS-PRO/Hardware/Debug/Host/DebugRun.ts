/**
 * @module ZerOS.Hardware.Debug.DebugRun
 * @description 调试运行能不能开始
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只回答这一段 ZAP 文本允不允许在调试入口里跑。真正执行仍走 CPU 的原有序列。
 * 不提供 eval，也不接受二进制。文本超长、含有控制字符、或 0 号核心还在跑，都拒绝。
 * 开关关闭时一律拒绝，哪怕调用方把 enabled 传成 true 以外的路径已经在入口处挡住。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 判定
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Debug {
      /** 一次调试运行最多这么多行，避免从控制台灌进一整份固件。 */
      const lineCap = 32;
      /** 一行最多这么多字符。ZAP 助记符用不到更长的一行。 */
      const lineWidth = 80;

      /**
       * 空串表示可以执行。其它字符串是拒绝原因，调用方原样交还，不要再跑。
       * halted 由调用方告知 0 号核心是否已经停止。这里不自己去停它。
       */
      export function debugRunDecision(enabled: boolean, lines: readonly string[], halted: boolean): string {
        if (!enabled) {
          return "debug is off";
        }
        if (lines.length < 1 || lines.length > lineCap) {
          return "debug run was refused";
        }
        for (const line of lines) {
          if (line.length < 1 || line.length > lineWidth) {
            return "debug run was refused";
          }
          for (let index = 0; index < line.length; index += 1) {
            const code = line.charCodeAt(index);
            if (code < 0x20 || code > 0x7e) {
              return "debug run was refused";
            }
          }
        }
        if (!halted) {
          return "core 0 is not halted";
        }
        return "";
      }
    }
  }
}
