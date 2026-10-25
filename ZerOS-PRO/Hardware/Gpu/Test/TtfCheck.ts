/**
 * @module ZerOS.Hardware.Gpu.TtfCheck
 * @description TrueType 子集的打开与着墨自检
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 对照 Font.md 检查缺表、截断、cmap 优先级、空字形、像素中心、二次曲线、
 * 复合字形和两次光栅一致。字体字节在这里现造，不带外部字体文件。
 * 接着核对字体面：一次打开、一次选择、整段标量一次绘制，失败不留像素。
 * 不画到帧上，也不碰封闭点阵。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. runTtfCheck
 *   3. 断言
 *   4. 造字体
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import type { ZerOS as MaskRoot } from "../Structure/GlyphMask";
import type { ZerOS as FaceRoot } from "../Structure/TtfFace";
import { ZerOS as OpRoot } from "../Enum/AccelOp";
import { ZerOS as ParseRoot } from "../Font/TtfParse";
import { ZerOS as RasterRoot } from "../Font/TtfRaster";
import { ZerOS as SessionRoot } from "../Font/FontSession";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Gpu {
      const openTtf = ParseRoot.Hardware.Gpu.openTtf;
      const rasterizeGlyph = RasterRoot.Hardware.Gpu.rasterizeGlyph;
      const Op = OpRoot.Hardware.Gpu.AccelOp;
      const createFontSession = SessionRoot.Hardware.Gpu.createFontSession;
      const fontParameter = SessionRoot.Hardware.Gpu.fontParameter;
      const checkPrefix = "[ZerOS.Hardware.Gpu.TtfCheck]";

      /** 测试已经知道标量。这里只按 FontDraw 的小端四字节排开，不解码 UTF-8。 */
      function packKnownScalars(scalars: readonly number[]): Uint8Array {
        const bytes = new Uint8Array(scalars.length * 4);
        for (let index = 0; index < scalars.length; index += 1) {
          const scalar = scalars[index] ?? 0;
          const at = index * 4;
          bytes[at] = scalar & 0xff;
          bytes[at + 1] = (scalar >>> 8) & 0xff;
          bytes[at + 2] = (scalar >>> 16) & 0xff;
          bytes[at + 3] = (scalar >>> 24) & 0xff;
        }
        return bytes;
      }

      type GlyphMask = MaskRoot.Hardware.Gpu.GlyphMask;
      type TtfFace = FaceRoot.Hardware.Gpu.TtfFace;

      /* ---------------------------------------------------------------------- */
      /* 2. runTtfCheck                                                          */
      /* ---------------------------------------------------------------------- */

      /** 显卡自检一开始就调用。失败会抛出，启动停在这里。 */
      export function runTtfCheck(): void {
        expectClosed(new Uint8Array(0), "empty file");
        expectClosed(Uint8Array.of(0x4f, 0x54, 0x54, 0x4f, 0, 0, 0, 0), "cff version");
        expectClosed(demoFont().subarray(0, 24), "truncated file");
        expectClosed(demoFont({ unitsPerEm: 8 }), "units per em");
        expectClosed(demoFont({ skip: "glyf" }), "missing glyf");

        const bytes = demoFont();
        const face = expectOpen(bytes);
        /* 打开之后改掉调用方的数组，字形必须还在。glyf 在打开时已经复制。 */
        bytes.fill(0);
        expectFull("rectangle", expectGlyph(face, 0x41, 8), 8, 8, 8);
        expectFull("ppem 1", expectGlyph(face, 0x41, 1), 1, 1, 1);
        const fractional = expectGlyph(face, 0x47, 8);
        expectFull("ceil bbox", fractional, 8, 8, 8);

        const bowed = expectGlyph(face, 0x42, 8);
        expectSize("bowed", bowed, 8, 8, 8);
        if (bowed.coverage[5 * 8 + 4] !== 255 || bowed.coverage[7 * 8 + 4] !== 0) {
          fail("bowed curve did not move the bottom edge");
        }
        expectFull("midpoint", expectGlyph(face, 0x46, 8), 8, 8, 8);
        expectFull("compound", expectGlyph(face, 0x43, 8), 8, 8, 8);
        const half = expectGlyph(face, 0x44, 8);
        expectSize("half scale", half, 8, 8, 4);
        /* 半缩放后墨只在 32 字体单位内。包围盒仍是 64，所以右上角必须是空的。 */
        if (half.coverage[7 * 8] !== 255 || half.coverage[0] !== 0) {
          fail("half scale did not shrink the square");
        }
        expectFull("two by two", expectGlyph(face, 0x45, 8), 8, 8, 8);

        const missing = expectGlyph(face, 0x20, 8);
        expectSize("notdef", missing, 0, 0, 0);
        if (missing.coverage.length !== 0) {
          fail("notdef coverage should be empty");
        }
        const aboveBmp = expectGlyph(face, 0x10000, 8);
        expectSize("format 4 cannot name U+10000", aboveBmp, 0, 0, 0);
        if (rasterizeGlyph(face, 0xd800, 8) !== null) {
          fail("surrogate should be rejected");
        }
        if (rasterizeGlyph(face, 0x41, 0) !== null || rasterizeGlyph(face, 0x41, 257) !== null) {
          fail("ppem out of range should be rejected");
        }
        if (rasterizeGlyph(face, 1.5, 8) !== null) {
          fail("non-integer scalar should be rejected");
        }
        const again = expectGlyph(face, 0x42, 8);
        if (!sameBytes(bowed.coverage, again.coverage)) {
          fail("second raster changed pixels");
        }

        const both = expectOpen(bothCmapFont());
        expectFull("format 12 wins", expectGlyph(both, 0x41, 8), 8, 8, 8);
        expectFull("format 4 fallback", expectGlyph(both, 0x42, 8), 8, 8, 8);

        const supplementary = expectOpen(format12Font());
        expectFull("format 12 supplementary", expectGlyph(supplementary, 0x10000, 8), 8, 8, 8);
        expectSize("format 12 miss", expectGlyph(supplementary, 0x41, 8), 0, 0, 0);

        expectSize("point match", expectGlyph(expectOpen(pointMatchFont()), 0x41, 8), 0, 0, 0);
        expectSize("compound cycle", expectGlyph(expectOpen(cycleFont()), 0x41, 8), 0, 0, 0);
        checkFontDraw();
      }

      /**
       * 颜色目标自检用的方块字体。U+0041 是铺满的方块。
       * 每次返回新的一份，调用方改数组不影响下一次。
       */
      export function squareFontBytes(): Uint8Array {
        return demoFont();
      }

      /* ---------------------------------------------------------------------- */
      /* 3. 断言                                                                 */
      /* ---------------------------------------------------------------------- */

      function fail(message: string): never {
        throw new Error(`${checkPrefix} ${message}`);
      }

      function expectClosed(bytes: Uint8Array, title: string): void {
        const opened = openTtf(bytes);
        if (opened.ok) {
          fail(`${title} should not open`);
        }
      }

      function expectOpen(bytes: Uint8Array): TtfFace {
        const opened = openTtf(bytes);
        if (!opened.ok) {
          fail("font should open");
        }
        return opened.face;
      }

      function expectGlyph(face: TtfFace, scalar: number, ppem: number): GlyphMask {
        const mask = rasterizeGlyph(face, scalar, ppem);
        if (mask === null) {
          fail(`scalar ${scalar.toString(16)} should rasterize`);
        }
        return mask;
      }

      function expectSize(title: string, mask: GlyphMask, width: number, height: number, advance: number): void {
        if (mask.width !== width || mask.height !== height || mask.advance !== advance) {
          fail(`${title}: got ${String(mask.width)}x${String(mask.height)} advance ${String(mask.advance)}`);
        }
      }

      function expectFull(title: string, mask: GlyphMask, width: number, height: number, advance: number): void {
        expectSize(title, mask, width, height, advance);
        if (mask.coverage.length !== width * height) {
          fail(`${title}: coverage length ${String(mask.coverage.length)}`);
        }
        for (let index = 0; index < mask.coverage.length; index += 1) {
          if (mask.coverage[index] !== 255) {
            fail(`${title}: pixel ${String(index)} is ${String(mask.coverage[index] ?? -1)}`);
          }
        }
      }

      function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
        if (left.length !== right.length) {
          return false;
        }
        for (let index = 0; index < left.length; index += 1) {
          if (left[index] !== right[index]) {
            return false;
          }
        }
        return true;
      }

      /**
       * 字体面不经过帧缓冲。
       * 整段标量一次光栅。坏标量不得留下前一个字的图章。打开之后改掉源字节，第二次仍相同。
       */
      function checkFontDraw(): void {
        const source = demoFont();
        const face = expectOpen(source.slice());
        const mask = expectGlyph(face, 0x41, 8);
        const session = createFontSession();
        const bits = fontParameter;
        if (session.command(Op.FontFace, bits(0), bits(1), bits(8), 0n, Uint8Array.of(0)).ok) {
          fail("a broken file received a face id");
        }
        const opened = session.command(Op.FontFace, bits(0), bits(source.length), bits(8), 0n, source);
        if (!opened.ok || opened.id !== 1 || opened.ink.length !== 0) {
          fail("FontFace did not return the first id");
        }
        source.fill(0);
        const packed = packKnownScalars([0x41, 0x41]);
        if (session.command(Op.FontDraw, bits(0), bits(2), 0n, 0n, packed).ok) {
          fail("FontDraw without FontSelect succeeded");
        }
        if (!session.command(Op.FontSelect, bits(1), bits(10), bits(20), 0n, null).ok) {
          fail("FontSelect rejected a live face");
        }
        if (session.command(Op.FontSelect, bits(2), bits(0), bits(0), 0n, null).ok) {
          fail("FontSelect accepted a missing face");
        }
        const drawn = session.command(Op.FontDraw, bits(0), bits(2), 0n, 0n, packed);
        if (!drawn.ok || drawn.ink.length !== 2) {
          fail("FontDraw did not stamp both scalars");
        }
        const first = drawn.ink[0];
        const second = drawn.ink[1];
        if (first === undefined || second === undefined) {
          fail("FontDraw stamps were missing");
        }
        if (first.x !== 10 + mask.left || first.y !== 20 - mask.top || !sameBytes(first.coverage, mask.coverage)) {
          fail("the first stamp did not match the raster");
        }
        if (second.x !== first.x + mask.advance || !sameBytes(second.coverage, mask.coverage)) {
          fail("the second stamp did not advance");
        }
        const again = session.command(Op.FontDraw, bits(0), bits(1), 0n, 0n, packed.subarray(0, 4));
        const repeated = again.ok ? again.ink[0] : undefined;
        if (repeated === undefined || !sameBytes(repeated.coverage, first.coverage)) {
          fail("the cached glyph changed pixels");
        }
        if (repeated.x !== second.x + mask.advance) {
          fail("the pen did not stay where the previous draw left it");
        }
        const bad = new Uint8Array(8);
        bad[0] = 0x41;
        bad[4] = 0x00;
        bad[5] = 0xd8;
        const pen = repeated.x + mask.advance;
        if (session.command(Op.FontDraw, bits(0), bits(2), 0n, 0n, bad).ok) {
          fail("a surrogate scalar was drawn");
        }
        const after = session.command(Op.FontDraw, bits(0), bits(1), 0n, 0n, packed.subarray(0, 4));
        const kept = after.ok ? after.ink[0] : undefined;
        if (kept === undefined) {
          fail("a failed draw moved the pen");
        }
        if (kept.x !== pen) {
          fail("a failed draw moved the pen");
        }
        const none = session.command(Op.FontDraw, bits(0), bits(0), 0n, 0n, new Uint8Array(0));
        if (!none.ok || none.ink.length !== 0) {
          fail("a zero count was a primitive");
        }
        const still = session.command(Op.FontDraw, bits(0), bits(1), 0n, 0n, packed.subarray(0, 4));
        const stayed = still.ok ? still.ink[0] : undefined;
        if (stayed === undefined) {
          fail("a zero count moved the pen");
        }
        if (stayed.x !== kept.x + mask.advance) {
          fail("a zero count moved the pen");
        }
      }

      /* ---------------------------------------------------------------------- */
      /* 4. 造字体                                                               */
      /* ---------------------------------------------------------------------- */

      /**
       * 字形 0 空。1 是 64 单位方块。2 是底边向上弯的二次曲线。
       * 3、4、5 是复合字形。6 用两个相邻离曲线点把底边仍放在 y = 0。
       * 7 的右边是 63，用来确认包围盒向上取整而不是先向 0 截断。
       */
      function demoFont(options?: { readonly unitsPerEm?: number; readonly skip?: string }): Uint8Array {
        const unitsPerEm = options?.unitsPerEm ?? 64;
        const blobs = [
          glyphEmpty(),
          rectangle(64, 64),
          bowedBottom(),
          compound(0x0003, 1, [], 64, 64),
          compound(0x000b, 1, [0x20, 0x00], 64, 64),
          compound(0x0083, 1, [0x40, 0x00, 0, 0, 0, 0, 0x40, 0x00], 64, 64),
          flatOffCurve(),
          rectangle(63, 63),
        ];
        const packed = packGlyphs(blobs);
        const parts = [
          { tag: "cmap", body: cmap4([
            { code: 0x41, glyph: 1 },
            { code: 0x42, glyph: 2 },
            { code: 0x43, glyph: 3 },
            { code: 0x44, glyph: 4 },
            { code: 0x45, glyph: 5 },
            { code: 0x46, glyph: 6 },
            { code: 0x47, glyph: 7 },
          ]) },
          { tag: "glyf", body: packed.glyf },
          { tag: "head", body: headTable(unitsPerEm, 1) },
          { tag: "hhea", body: hheaTable(blobs.length) },
          { tag: "hmtx", body: hmtxTable([0, 64, 64, 64, 32, 64, 64, 64]) },
          { tag: "loca", body: packed.loca },
          { tag: "maxp", body: maxpTable(blobs.length) },
        ];
        const kept = parts.filter((part) => part.tag !== options?.skip);
        return assemble(kept, 0x00010000);
      }

      /** format 12 把 U+0041 送到方块，format 4 把同一个码送到空字形。 */
      function bothCmapFont(): Uint8Array {
        const blobs = [glyphEmpty(), rectangle(64, 64)];
        const packed = packGlyphs(blobs);
        const cmap = cmapTable([
          { platform: 3, encoding: 10, body: format12([{ start: 0x41, end: 0x41, glyph: 1 }]) },
          { platform: 3, encoding: 1, body: cmap4Body([
            { code: 0x41, glyph: 0 },
            { code: 0x42, glyph: 1 },
          ]) },
        ]);
        return faceAround(blobs.length, packed, cmap, [0, 64]);
      }

      function format12Font(): Uint8Array {
        const blobs = [glyphEmpty(), rectangle(64, 64)];
        const packed = packGlyphs(blobs);
        const cmap = cmapTable([
          { platform: 3, encoding: 10, body: format12([{ start: 0x10000, end: 0x10000, glyph: 1 }]) },
        ]);
        return faceAround(blobs.length, packed, cmap, [0, 64]);
      }

      /** 部件用点号而不是坐标。这一版必须退回空的 `.notdef`。 */
      function pointMatchFont(): Uint8Array {
        const blobs = [glyphEmpty(), rectangle(64, 64), compound(0x0001, 1, [], 64, 64)];
        const packed = packGlyphs(blobs);
        return faceAround(blobs.length, packed, cmap4([{ code: 0x41, glyph: 2 }]), [0, 64, 64]);
      }

      /** 复合字形指向自己。嵌套超过 16 层后必须退回 `.notdef`。 */
      function cycleFont(): Uint8Array {
        const blobs = [glyphEmpty(), compound(0x0003, 1, [], 64, 64)];
        const packed = packGlyphs(blobs);
        return faceAround(blobs.length, packed, cmap4([{ code: 0x41, glyph: 1 }]), [0, 64]);
      }

      function faceAround(
        glyphCount: number,
        packed: { readonly glyf: number[]; readonly loca: number[] },
        cmap: number[],
        advances: readonly number[],
      ): Uint8Array {
        return assemble([
          { tag: "cmap", body: cmap },
          { tag: "glyf", body: packed.glyf },
          { tag: "head", body: headTable(64, 1) },
          { tag: "hhea", body: hheaTable(glyphCount) },
          { tag: "hmtx", body: hmtxTable(advances) },
          { tag: "loca", body: packed.loca },
          { tag: "maxp", body: maxpTable(glyphCount) },
        ], 0x00010000);
      }

      function glyphEmpty(): number[] {
        return [];
      }

      /** 从原点到 (x, y) 的逆时针方块，四个点都在曲线上。 */
      function rectangle(x: number, y: number): number[] {
        const body: number[] = [];
        pushI16(body, 1);
        pushI16(body, 0);
        pushI16(body, 0);
        pushI16(body, x);
        pushI16(body, y);
        pushU16(body, 3);
        pushU16(body, 0);
        body.push(0x37, 0x37, 0x37, 0x27, 0, x, 0, x, 0, 0, y, 0);
        return body;
      }

      /**
       * (0,0) 经离曲线点 (32,32) 到 (64,0)，再走上面的两条直边。
       * 控制点把底边抬高，底行中心应落在填充外，靠上的中心仍在填充内。
       */
      function bowedBottom(): number[] {
        const body: number[] = [];
        pushI16(body, 1);
        pushI16(body, 0);
        pushI16(body, 0);
        pushI16(body, 64);
        pushI16(body, 64);
        pushU16(body, 4);
        pushU16(body, 0);
        body.push(0x37, 0x36, 0x17, 0x37, 0x27);
        body.push(0, 32, 32, 0, 64);
        body.push(0, 32, 32, 64, 0);
        return body;
      }

      /** 底边上两个相邻离曲线点。补中点之后仍是 y = 0 的直线。 */
      function flatOffCurve(): number[] {
        const body: number[] = [];
        pushI16(body, 1);
        pushI16(body, 0);
        pushI16(body, 0);
        pushI16(body, 64);
        pushI16(body, 64);
        pushU16(body, 5);
        pushU16(body, 0);
        body.push(0x37, 0x36, 0x36, 0x37, 0x37, 0x27);
        body.push(0, 21, 22, 21, 0, 64);
        body.push(0, 0, 0, 0, 64, 0);
        return body;
      }

      function compound(flags: number, glyph: number, extra: readonly number[], xMax: number, yMax: number): number[] {
        const body: number[] = [];
        pushI16(body, -1);
        pushI16(body, 0);
        pushI16(body, 0);
        pushI16(body, xMax);
        pushI16(body, yMax);
        pushU16(body, flags);
        pushU16(body, glyph);
        pushI16(body, 0);
        pushI16(body, 0);
        for (const value of extra) {
          body.push(value);
        }
        return body;
      }

      function packGlyphs(blobs: readonly (readonly number[])[]): { readonly glyf: number[]; readonly loca: number[] } {
        const glyf: number[] = [];
        const loca: number[] = [];
        pushU32(loca, 0);
        for (const blob of blobs) {
          for (const value of blob) {
            glyf.push(value);
          }
          pushU32(loca, glyf.length);
        }
        return { glyf, loca };
      }

      function headTable(unitsPerEm: number, locaFormat: number): number[] {
        const body = zeros(54);
        body[0] = 0;
        body[1] = 1;
        body[12] = 0x5f;
        body[13] = 0x0f;
        body[14] = 0x3c;
        body[15] = 0xf5;
        body[18] = (unitsPerEm >> 8) & 0xff;
        body[19] = unitsPerEm & 0xff;
        body[50] = (locaFormat >> 8) & 0xff;
        body[51] = locaFormat & 0xff;
        return body;
      }

      function maxpTable(numGlyphs: number): number[] {
        const body = zeros(32);
        body[0] = 0;
        body[1] = 1;
        body[4] = (numGlyphs >> 8) & 0xff;
        body[5] = numGlyphs & 0xff;
        return body;
      }

      function hheaTable(metrics: number): number[] {
        const body = zeros(36);
        body[34] = (metrics >> 8) & 0xff;
        body[35] = metrics & 0xff;
        return body;
      }

      function hmtxTable(advances: readonly number[]): number[] {
        const body: number[] = [];
        for (const advance of advances) {
          pushU16(body, advance);
          pushI16(body, 0);
        }
        return body;
      }

      function cmap4(segments: readonly { readonly code: number; readonly glyph: number }[]): number[] {
        return cmapTable([{ platform: 3, encoding: 1, body: cmap4Body(segments) }]);
      }

      function cmap4Body(segments: readonly { readonly code: number; readonly glyph: number }[]): number[] {
        const ordered = [...segments].sort((left, right) => left.code - right.code);
        ordered.push({ code: 0xffff, glyph: 0 });
        const segCount = ordered.length;
        const body: number[] = [];
        pushU16(body, 4);
        pushU16(body, 16 + segCount * 8);
        pushU16(body, 0);
        pushU16(body, segCount * 2);
        const search = pow2AtMost(segCount);
        pushU16(body, search * 2);
        pushU16(body, Math.log2(search));
        pushU16(body, segCount * 2 - search * 2);
        for (const segment of ordered) {
          pushU16(body, segment.code);
        }
        pushU16(body, 0);
        for (const segment of ordered) {
          pushU16(body, segment.code);
        }
        for (const segment of ordered) {
          const delta = segment.code === 0xffff ? 1 : segment.glyph - segment.code;
          pushI16(body, delta);
        }
        for (let index = 0; index < segCount; index += 1) {
          pushU16(body, 0);
        }
        return body;
      }

      function format12(
        groups: readonly { readonly start: number; readonly end: number; readonly glyph: number }[],
      ): number[] {
        const body: number[] = [];
        pushU16(body, 12);
        pushU16(body, 0);
        pushU32(body, 16 + groups.length * 12);
        pushU32(body, 0);
        pushU32(body, groups.length);
        for (const group of groups) {
          pushU32(body, group.start);
          pushU32(body, group.end);
          pushU32(body, group.glyph);
        }
        return body;
      }

      function cmapTable(
        subtables: readonly { readonly platform: number; readonly encoding: number; readonly body: readonly number[] }[],
      ): number[] {
        const body: number[] = [];
        pushU16(body, 0);
        pushU16(body, subtables.length);
        let offset = 4 + subtables.length * 8;
        for (const subtable of subtables) {
          pushU16(body, subtable.platform);
          pushU16(body, subtable.encoding);
          pushU32(body, offset);
          offset += subtable.body.length;
        }
        for (const subtable of subtables) {
          for (const value of subtable.body) {
            body.push(value);
          }
        }
        return body;
      }

      function assemble(
        parts: readonly { readonly tag: string; readonly body: readonly number[] }[],
        version: number,
      ): Uint8Array {
        const count = parts.length;
        const search = pow2AtMost(count);
        const bytes: number[] = [];
        pushU32(bytes, version);
        pushU16(bytes, count);
        pushU16(bytes, search * 16);
        pushU16(bytes, Math.log2(search));
        pushU16(bytes, count * 16 - search * 16);
        let offset = 12 + count * 16;
        const blobs: number[][] = [];
        for (const part of parts) {
          bytes.push(part.tag.charCodeAt(0), part.tag.charCodeAt(1), part.tag.charCodeAt(2), part.tag.charCodeAt(3));
          pushU32(bytes, 0);
          pushU32(bytes, offset);
          pushU32(bytes, part.body.length);
          const pad = (4 - (part.body.length % 4)) % 4;
          const blob = [...part.body];
          for (let index = 0; index < pad; index += 1) {
            blob.push(0);
          }
          blobs.push(blob);
          offset += blob.length;
        }
        for (const blob of blobs) {
          for (const value of blob) {
            bytes.push(value);
          }
        }
        return Uint8Array.from(bytes);
      }

      function zeros(count: number): number[] {
        const body: number[] = [];
        for (let index = 0; index < count; index += 1) {
          body.push(0);
        }
        return body;
      }

      function pow2AtMost(value: number): number {
        let power = 1;
        while (power * 2 <= value) {
          power *= 2;
        }
        return power;
      }

      function pushU16(out: number[], value: number): void {
        out.push((value >> 8) & 0xff, value & 0xff);
      }

      function pushI16(out: number[], value: number): void {
        const wrapped = value < 0 ? value + 0x10000 : value;
        pushU16(out, wrapped);
      }

      function pushU32(out: number[], value: number): void {
        out.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
      }
    }
  }
}
