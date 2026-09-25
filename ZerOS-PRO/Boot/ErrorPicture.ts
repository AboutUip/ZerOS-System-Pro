/**
 * @module ZerOS.Boot.ErrorPicture
 * @description 把一次指令失败画成黑底白字的一帧
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只生成指令文本。错误码和来源以 ZCP1 失败登记表为准。
 * 说明文字只保留字形表能画的 ASCII。本文件不执行指令。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 画面
 */

export namespace ZerOS {
  export namespace Boot {
    const Columns = 80;
    const TextLimit = 240;
    const Ink = 16777215;

    const sourceName: readonly string[] = [
      "Board",
      "Cpu",
      "Memory",
      "Gpu",
      "Display",
      "Expansion",
      "Keyboard",
    ];

    /** 留下登记表里的错误码、来源，以及能画上面板的说明。 */
    export function describeFault(message: string): { code: number; source: number; text: string } {
      const source = sourceOf(message);
      const code = codeOf(message);
      let text = "";
      for (let index = 0; index < message.length && text.length < TextLimit; index += 1) {
        const unit = message.charCodeAt(index);
        if (unit >= 0x20 && unit <= 0x7e) {
          text += message.charAt(index);
        }
      }
      if (text.length < 1) {
        text = "unspecified";
      }
      return { code, source, text };
    }

    /**
     * 黑底。第一行 ERROR，接着十进制错误码、来源短名，然后说明。
     * 官方帧宽 640，一行 80 个字形。超出帧高的行不再生成。
     * 这段不被 call 进入。r0 至 r5 是盒子操作数，盒子编号借用 r6，文本编号借用 r7。
     */
    export function errorPicture(code: number, source: number, text: string): readonly string[] {
      const name = sourceName[source] ?? "Board";
      const rows = [
        "ERROR",
        `CODE ${String(code)}`,
        `SRC ${String(source)} ${name}`,
      ];
      for (let index = 0; index < text.length; index += Columns) {
        rows.push(text.slice(index, index + Columns));
      }
      const lines = [
        "place r0, 0",
        "place r1, 0",
        "place r2, 0",
        "place r3, 640",
        "place r4, 480",
        "place r5, 0",
        "gpu.box r6, r0, r1, r2, r3, r4, r5",
      ];
      let top = 0;
      for (const row of rows) {
        if (top > 472) {
          break;
        }
        lines.push(
          "place r1, 0",
          `place r2, ${String(top)}`,
          "place r3, 640",
          "place r4, 8",
          "gpu.text r7, r6, r1, r2, r3, r4",
          `place r1, ${String(Ink)}`,
          "place r2, 0",
          "gpu.paint r7, r1, r2",
        );
        for (let index = 0; index < row.length; index += 1) {
          lines.push(`place r1, ${String(row.charCodeAt(index))}`, "gpu.glyph r7, r1");
        }
        top += 8;
      }
      lines.push("gpu.compose", "gpu.present", "halt");
      return lines;
    }

    function sourceOf(message: string): number {
      if (message.includes("Keyboard")) {
        return 6;
      }
      if (message.includes("Display")) {
        return 4;
      }
      if (message.includes("Gpu") || message.includes("显卡")) {
        return 3;
      }
      if (message.includes("Memory") || message.includes("内存") || message.includes("访存")) {
        return 2;
      }
      if (message.includes("Cpu") || message.includes("CPU") || message.includes("核心")) {
        return 1;
      }
      if (message.includes("扩展")) {
        return 5;
      }
      return 0;
    }

    function codeOf(message: string): number {
      if (message.includes("跳转")) {
        return 1;
      }
      if (message.includes("寄存器")) {
        return 2;
      }
      if (message.includes("不在执行中")) {
        return 3;
      }
      if (message.includes("没做完")) {
        return 4;
      }
      if (message.includes("Hz")) {
        return 5;
      }
      if (message.includes("操作码")) {
        return 6;
      }
      if (message.includes("指标")) {
        return 7;
      }
      if (message.includes("交换") || message.includes("扩展口")) {
        return 8;
      }
      if (message.includes("查询") || message.includes("字段")) {
        return 9;
      }
      if (message.includes("显卡") || message.includes("Gpu")) {
        return 10;
      }
      if (message.includes("访存") || message.includes("内存")) {
        return 11;
      }
      return 0;
    }
  }
}
