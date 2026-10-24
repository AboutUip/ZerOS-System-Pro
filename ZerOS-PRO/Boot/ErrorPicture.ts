/**
 * @module ZerOS.Boot.ErrorPicture
 * @description 把一次失败画成协议规定的停机帧
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只生成指令文本，不执行。未画到的像素保持 0，字是白色。
 * 帧上依次是 ERROR、错误码、来源、核心、指令编号、源位置和说明。
 * 有宿主调用栈时最多再画 4 行。没有栈就不画空行。
 * 字形表只有 ASCII。记录在进来之前已经收成这个范围。
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

import { type ZerOS as FaultRoot } from "../Hardware/Cpu/Structure/FaultRecord";
import { ZerOS as SourceRoot } from "../Hardware/Cpu/Enum/FaultSource";

export namespace ZerOS {
  export namespace Boot {
    type FaultRecord = FaultRoot.Hardware.Cpu.FaultRecord;
    const FaultSourceName = SourceRoot.Hardware.Cpu.FaultSourceName;

    /* ------------------------------------------------------------------ */
    /* 2. 画面                                                             */
    /* ------------------------------------------------------------------ */

    const FrameWidth = 640;
    const FrameHeight = 480;
    const Glyph = 8;
    const Ink = 16777215;
    const Columns = FrameWidth / Glyph;

    /**
     * 全幅清成 0，再按协议逐行写失败字段。
     * r6 是底，r7 是文本。最后 compose、present、halt，调用方等到停。
     */
    export function errorPicture(record: FaultRecord): readonly string[] {
      const lines = [
        "place r0, 0",
        "place r1, 0",
        "place r2, 0",
        `place r3, ${String(FrameWidth)}`,
        `place r4, ${String(FrameHeight)}`,
        "place r5, 0",
        "gpu.box r6, r0, r1, r2, r3, r4, r5",
      ];
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
      let row = 0;
      for (const block of blocks) {
        const rows = Math.max(1, Math.ceil(block.length / Columns));
        paint(lines, block, row, rows);
        row += rows;
      }
      const stackLimit = Math.min(4, record.Stack.length);
      for (let index = 0; index < stackLimit; index += 1) {
        const frame = record.Stack[index] ?? "";
        const visible = `STACK ${frame}`.slice(0, Columns);
        if (row * Glyph >= FrameHeight) {
          break;
        }
        paint(lines, visible, row, 1);
        row += 1;
      }
      lines.push("gpu.compose", "gpu.present", "halt");
      return lines;
    }

    /**
     * 一块文本一个节点。高度按行数留足，放不下的字符裁掉，不画出帧外。
     * 底色是 0，空字位不会把上一帧的颜色留住。
     */
    function paint(lines: string[], text: string, row: number, rows: number): void {
      const y = row * Glyph;
      if (y >= FrameHeight || text.length < 1 || rows < 1) {
        return;
      }
      const roomRows = Math.min(rows, Math.floor((FrameHeight - y) / Glyph));
      const visible = text.slice(0, roomRows * Columns);
      if (visible.length < 1) {
        return;
      }
      lines.push(
        "place r1, 0",
        `place r2, ${String(y)}`,
        `place r3, ${String(FrameWidth)}`,
        `place r4, ${String(roomRows * Glyph)}`,
        "gpu.text r7, r6, r1, r2, r3, r4",
        `place r1, ${String(Ink)}`,
        "place r2, 0",
        "gpu.paint r7, r1, r2",
      );
      for (let index = 0; index < visible.length; index += 1) {
        lines.push(`place r1, ${String(visible.charCodeAt(index))}`, "gpu.glyph r7, r1");
      }
    }
  }
}
