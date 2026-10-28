/**
 * @module ZerOS.Hardware.Motherboard.ErrorPicture
 * @description 把一次失败画成协议规定的停机帧
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只生成指令文本，不执行。画面铺满当前已经发布的帧，不再写死 640×480。
 * BIOS 换过分辨率之后，旧的 640 宽会把字切在半路，右边留下一块没画的黑。
 * 七个字段的行首仍是协议规定的 ERROR、CODE、SRC、CORE、AT、SITE。
 * 说明按帧宽折行。调用栈最多四行，一行放不下时收成函数名和文件名。
 * 字形表只有 ASCII。记录在进来之前已经收成这个范围。
 * 整幅是蓝底。笑脸用方块拼，字形只有 8 像素，拼出来才看得清。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 画面
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import type { ZerOS as FaultRoot } from "../../Cpu/Structure/FaultRecord";
import { ZerOS as SourceRoot } from "../../Cpu/Enum/FaultSource";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      type FaultRecord = FaultRoot.Hardware.Cpu.FaultRecord;
      const FaultSourceName = SourceRoot.Hardware.Cpu.FaultSourceName;

      /* ------------------------------------------------------------------ */
      /* 2. 画面                                                             */
      /* ------------------------------------------------------------------ */

      const Glyph = 8;
      const Ink = 16777215;
      /** Windows 停机蓝 #0078D7。整幅铺这一种，不再用近黑玻璃。 */
      const Field = 30935;
      const Margin = 16;
      /**
       * Windows 停机画面上的那张脸，就是 ":("。
       * # 是一格白块。左边两竖是冒号，右边一条弯是括号。
       * 8 像素字形画出来几乎看不见，所以用方块拼大。
       */
      const SadFace = [
        "....................",
        "##..................",
        "##..................",
        "....................",
        "##..................",
        "##..................",
        "....................",
        "..............####..",
        ".............#......",
        "............#.......",
        "...........#........",
        "..........#.........",
        "..........#.........",
        "...........#........",
        "............#.......",
        ".............#......",
        "..............####..",
      ];

      /**
       * 先清成 0，再铺满停机蓝，左上角用方块拼出笑脸，下面按协议逐行写失败字段。
       * 宽高用已经发布的帧。还没发布，或边长小到放不下一行字时，退回 640×480。
       * r6 是底，r7 是文本。最后 compose、present、halt，调用方等到停。
       */
      export function errorPicture(record: FaultRecord, width = 640, height = 480): readonly string[] {
        const frame = fitFrame(width, height);
        const columns = Math.floor((frame.width - Margin) / Glyph);
        const lines = [
          "place r0, 0",
          "place r1, 0",
          "place r2, 0",
          `place r3, ${String(frame.width)}`,
          `place r4, ${String(frame.height)}`,
          "place r5, 0",
          "gpu.box r6, r0, r1, r2, r3, r4, r5",
          "place r0, 0",
          "place r1, 0",
          "place r2, 0",
          `place r3, ${String(frame.width)}`,
          `place r4, ${String(frame.height)}`,
          `place r5, ${String(Field)}`,
          "gpu.box r6, r0, r1, r2, r3, r4, r5",
        ];
        const faceBottom = sadFace(lines, frame.width, frame.height);
        const name = FaultSourceName[record.Source] ?? "Board";
        const core = record.Core < 0 ? "CORE -" : `CORE ${String(record.Core)}`;
        const op = record.Op.length > 0 ? `AT ${String(record.Index)} ${record.Op}` : `AT ${String(record.Index)}`;
        const blocks = [
          "ERROR",
          `CODE ${String(record.Code)}`,
          `SRC ${String(record.Source)} ${name}`,
          core,
          op,
          `SITE ${record.Site}`,
          record.Text,
        ];
        let row = Math.floor((faceBottom + Glyph) / Glyph) + 1;
        for (let index = 0; index < blocks.length; index += 1) {
          const block = blocks[index] ?? "";
          const rows = Math.max(1, Math.ceil(block.length / columns));
          row = paint(lines, block, row, rows, frame.width, frame.height, columns);
          if (index === 2 || index === 5) {
            row += 1;
          }
        }
        const stackLimit = Math.min(4, record.Stack.length);
        for (let index = 0; index < stackLimit; index += 1) {
          const frameText = record.Stack[index] ?? "";
          const visible = stackLine(frameText, columns);
          if (row * Glyph >= frame.height) {
            break;
          }
          const rows = Math.max(1, Math.ceil(visible.length / columns));
          row = paint(lines, visible, row, rows, frame.width, frame.height, columns);
        }
        lines.push("gpu.compose", "gpu.present", "halt");
        return lines;
      }

      /**
       * 把笑脸拼进画面。返回脸的下沿，协议文字从这里下面开始，免得压住眼睛。
       * 帧太矮时缩小格子，文字仍要留得下。
       */
      function sadFace(lines: string[], frameWidth: number, frameHeight: number): number {
        const cell = frameHeight >= 600 ? 18 : frameHeight >= 480 ? 14 : 8;
        const originX = 48;
        const originY = 36;
        for (let row = 0; row < SadFace.length; row += 1) {
          const line = SadFace[row] ?? "";
          for (let col = 0; col < line.length; col += 1) {
            if (line[col] !== "#") {
              continue;
            }
            const x = originX + col * cell;
            const y = originY + row * cell;
            if (x + cell > frameWidth || y + cell > frameHeight) {
              continue;
            }
            lines.push(
              "place r0, 0",
              `place r1, ${String(x)}`,
              `place r2, ${String(y)}`,
              `place r3, ${String(cell)}`,
              `place r4, ${String(cell)}`,
              `place r5, ${String(Ink)}`,
              "gpu.box r6, r0, r1, r2, r3, r4, r5",
            );
          }
        }
        return originY + SadFace.length * cell;
      }

      /** 边长还没发布，或小到协议那一行字放不下时，用上电时的 640×480。 */
      function fitFrame(width: number, height: number): { readonly width: number; readonly height: number } {
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 160 || height < 120) {
          return { width: 640, height: 480 };
        }
        return { width, height };
      }

      /**
       * 一行放得下就原样画。放不下时收成函数名和文件名，查询串丢掉。
       * 仍然以 STACK 开头，并且不超过这一帧的列数。
       */
      function stackLine(frame: string, columns: number): string {
        const raw = `STACK ${frame}`;
        if (raw.length <= columns) {
          return raw;
        }
        const shortened = `STACK ${shortFrame(frame)}`;
        if (shortened.length <= columns) {
          return shortened;
        }
        return shortened.slice(0, columns);
      }

      /** `at fail (http://.../CpuRuntime.ts?t=1:20:3)` 收成 `fail  CpuRuntime.ts:20`。 */
      function shortFrame(frame: string): string {
        let text = frame.trim();
        if (text.startsWith("at ")) {
          text = text.slice(3);
        }
        let name = text;
        let where = "";
        const open = text.lastIndexOf(" (");
        if (open >= 0 && text.endsWith(")")) {
          name = text.slice(0, open);
          where = text.slice(open + 2, -1);
        }
        const slash = Math.max(where.lastIndexOf("/"), where.lastIndexOf("\\"));
        let file = slash >= 0 ? where.slice(slash + 1) : where;
        const query = file.indexOf("?");
        if (query >= 0) {
          const tail = file.slice(query + 1);
          const line = /:(\d+):\d+$/.exec(tail);
          file = file.slice(0, query);
          if (line?.[1] !== undefined) {
            file = `${file}:${line[1]}`;
          }
        }
        if (name.length > 0 && file.length > 0) {
          return `${name}  ${file}`;
        }
        if (name.length > 0) {
          return name;
        }
        return text;
      }

      /**
       * 一块文本一个节点。高度按行数留足，放不下的字符裁掉，不画出帧外。
       * 字的底色和停机蓝相同，空字位不再抠出黑块。
       * 返回下一块可用的行号。
       */
      function paint(
        lines: string[],
        text: string,
        row: number,
        rows: number,
        frameWidth: number,
        frameHeight: number,
        columns: number,
      ): number {
        const y = row * Glyph;
        if (y >= frameHeight || text.length < 1 || rows < 1 || columns < 1) {
          return row;
        }
        const roomRows = Math.min(rows, Math.floor((frameHeight - y) / Glyph));
        const visible = text.slice(0, roomRows * columns);
        if (visible.length < 1) {
          return row;
        }
        lines.push(
          `place r1, ${String(Margin)}`,
          `place r2, ${String(y)}`,
          `place r3, ${String(frameWidth - Margin)}`,
          `place r4, ${String(roomRows * Glyph)}`,
          "gpu.text r7, r6, r1, r2, r3, r4",
          `place r1, ${String(Ink)}`,
          `place r2, ${String(Field)}`,
          "gpu.paint r7, r1, r2",
        );
        for (let index = 0; index < visible.length; index += 1) {
          lines.push(`place r1, ${String(visible.charCodeAt(index))}`, "gpu.glyph r7, r1");
        }
        return row + roomRows;
      }
    }
  }
}
