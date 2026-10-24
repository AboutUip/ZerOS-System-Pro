/**
 * @module ZerOS.Hardware.Debug.SevereConsole
 * @description 错误帧画不出来时的那一次控制台输出
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 页面会把控制台方法换成空操作。这里在替换之前留下原来的 error。
 * 只有显卡故障或错误帧自己失败时才调用 reportSevere。普通失败不经过这个文件。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 控制台
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Debug {
      /** 封印页面之前保存的 error。没保存过就还用当前的。 */
      let nativeError: ((text: string) => void) | null = null;

      /** 必须在把 console.error 换成空操作之前调用，否则后来的严重失败写不出来。 */
      export function rememberSevereConsole(): void {
        const saved = console.error.bind(console);
        nativeError = (text: string): void => {
          saved(text);
        };
      }

      /**
       * 写一行严重失败。
       * 页面控制台已经封住时仍走封印前留下的那一个。没留下时用当前的 error。
       */
      export function reportSevere(text: string): void {
        if (nativeError !== null) {
          nativeError(text);
          return;
        }
        console.error(text);
      }
    }
  }
}
