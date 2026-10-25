/**
 * @module ZerOS.Hardware.Gpu.TtfRaster
 * @description 把 TrueType 字形着成像素中心掩码
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 实现 Font.md 第 3 节：包围盒取整、非零环绕、离曲线中点、四分之一像素细分、
 * 复合字形的平移与缩放。不抗锯齿，不执行字形指令，不调用宿主字体引擎。
 * 同一个字形两次光栅的覆盖必须逐字节相同，因为这里没有缓存，也没有随机采样。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. rasterizeGlyph
 *   3. 标量到字形
 *   4. 轮廓
 *   5. 展平与着墨
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as LimitRoot } from "../Config/FontLimit";
import type { ZerOS as FaceRoot } from "../Structure/TtfFace";
import type { ZerOS as MaskRoot } from "../Structure/GlyphMask";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Gpu {
      const FontPpemMin = LimitRoot.Hardware.Gpu.Config.FontPpemMin;
      const FontPpemMax = LimitRoot.Hardware.Gpu.Config.FontPpemMax;
      const FontPointLimit = LimitRoot.Hardware.Gpu.Config.FontPointLimit;
      const FontCompoundDepth = LimitRoot.Hardware.Gpu.Config.FontCompoundDepth;
      const FontBitmapSideMax = LimitRoot.Hardware.Gpu.Config.FontBitmapSideMax;

      /** 标量上界。值域与 Utf8.md 一致。 */
      const ScalarMax = 0x10ffff;

      const SurrogateMin = 0xd800;
      const SurrogateMax = 0xdfff;

      /** 简单字形标志。 */
      const OnCurve = 0x01;
      const XShort = 0x02;
      const YShort = 0x04;
      const RepeatFlag = 0x08;
      const XSameOrPositive = 0x10;
      const YSameOrPositive = 0x20;

      /** 复合字形标志。点号匹配不实现，遇到就让这个字形退回 `.notdef`。 */
      const ArgWords = 0x0001;
      const ArgXY = 0x0002;
      const HaveScale = 0x0008;
      const MoreComponents = 0x0020;
      const HaveXYScale = 0x0040;
      const HaveTwoByTwo = 0x0080;
      const ScaledOffset = 0x0800;

      /** 一条二次曲线最多对半切这么多次。非协议，只为病态曲线能返回。 */
      const FlattenDepthMax = 16;

      /** 复合部件个数上限。非协议。 */
      const ComponentMax = 256;

      /** 判断点是否贴在边上。字体单位，远小于测试用的像素中心间距。 */
      const EdgeEpsilon = 1e-4;

      interface CurvePoint {
        readonly x: number;
        readonly y: number;
        readonly on: boolean;
      }

      interface LinePoint {
        readonly x: number;
        readonly y: number;
      }

      interface Affine {
        readonly a: number;
        readonly b: number;
        readonly c: number;
        readonly d: number;
        readonly e: number;
        readonly f: number;
      }

      interface Outline {
        readonly contours: readonly (readonly CurvePoint[])[];
        readonly xMin: number;
        readonly yMin: number;
        readonly xMax: number;
        readonly yMax: number;
      }

      interface GlyphHeader {
        readonly contours: number;
        readonly xMin: number;
        readonly yMin: number;
        readonly xMax: number;
        readonly yMax: number;
      }

      interface Cursor {
        readonly bytes: Uint8Array;
        at: number;
      }

      const Identity: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

      /* ---------------------------------------------------------------------- */
      /* 2. rasterizeGlyph                                                       */
      /* ---------------------------------------------------------------------- */

      /**
       * 把一个标量着成掩码。
       * 标量不合法或字号越界时返回 null。cmap 没有命中时画字形 0。
       * 该字形读不出来时改画 `.notdef`；`.notdef` 也读不出来时返回 null。
       */
      export function rasterizeGlyph(
        face: FaceRoot.Hardware.Gpu.TtfFace,
        scalar: number,
        ppem: number,
      ): MaskRoot.Hardware.Gpu.GlyphMask | null {
        if (!Number.isInteger(ppem) || ppem < FontPpemMin || ppem > FontPpemMax) {
          return null;
        }
        const glyph = glyphForScalar(face, scalar);
        if (glyph === null) {
          return null;
        }
        return drawGlyph(face, glyph, ppem, true);
      }

      /**
       * `fallback` 只在第一次失败时改画字形 0，避免 `.notdef` 再失败时来回递归。
       */
      function drawGlyph(
        face: FaceRoot.Hardware.Gpu.TtfFace,
        glyph: number,
        ppem: number,
        fallback: boolean,
      ): MaskRoot.Hardware.Gpu.GlyphMask | null {
        const outline = loadOutline(face, glyph);
        const mask = outline === null ? null : rasterOutline(face, glyph, ppem, outline);
        if (mask !== null) {
          return mask;
        }
        if (fallback && glyph !== 0) {
          return drawGlyph(face, 0, ppem, false);
        }
        return null;
      }

      /* ---------------------------------------------------------------------- */
      /* 3. 标量到字形                                                           */
      /* ---------------------------------------------------------------------- */

      /**
       * 大于 65535 的标量只查 format 12。
       * 其余先查 format 12，没有命中再查 format 4。都没有则是字形 0。
       * 代理项和值域外返回 null，不落到字形 0。
       */
      function glyphForScalar(face: FaceRoot.Hardware.Gpu.TtfFace, scalar: number): number | null {
        if (!Number.isInteger(scalar) || scalar < 0 || scalar > ScalarMax) {
          return null;
        }
        if (scalar >= SurrogateMin && scalar <= SurrogateMax) {
          return null;
        }
        const from12 = lookup12(face.groups, scalar);
        if (from12 !== null) {
          return inFace(face, from12);
        }
        if (scalar > 0xffff || face.format4 === null) {
          return 0;
        }
        const from4 = lookup4(face.format4, scalar);
        if (from4 === null) {
          return 0;
        }
        return inFace(face, from4);
      }

      /** 字形号越界时当成没有这个字形，也就是 `.notdef`。 */
      function inFace(face: FaceRoot.Hardware.Gpu.TtfFace, glyph: number): number {
        if (!Number.isInteger(glyph) || glyph < 0 || glyph >= face.numGlyphs) {
          return 0;
        }
        return glyph;
      }

      function lookup12(groups: readonly FaceRoot.Hardware.Gpu.CmapGroup[], code: number): number | null {
        for (const group of groups) {
          if (code >= group.start && code <= group.end) {
            return group.glyph + (code - group.start);
          }
        }
        return null;
      }

      /**
       * 找到第一段 `endCount >= code` 的段。
       * `idRangeOffset` 为 0 时，字形号是码点加 `idDelta`，按 16 位回绕。
       */
      function lookup4(map: FaceRoot.Hardware.Gpu.Format4, code: number): number | null {
        const segCount = map.endCount.length;
        let seg = 0;
        while (seg < segCount) {
          const end = map.endCount[seg];
          if (end === undefined) {
            return null;
          }
          if (end >= code) {
            break;
          }
          seg += 1;
        }
        if (seg >= segCount) {
          return null;
        }
        const start = map.startCount[seg];
        const end = map.endCount[seg];
        const delta = map.idDelta[seg];
        const range = map.idRangeOffset[seg];
        if (start === undefined || end === undefined || delta === undefined || range === undefined) {
          return null;
        }
        if (code < start || code > end) {
          return null;
        }
        if (range === 0) {
          return (code + delta) & 0xffff;
        }
        if (range % 2 !== 0) {
          return null;
        }
        /* 偏移从这段 idRangeOffset 自己的位置量起，单位是 16 位字。 */
        const glyph = map.words[seg + range / 2 + (code - start)];
        if (glyph === undefined || glyph === 0) {
          return 0;
        }
        return (glyph + delta) & 0xffff;
      }

      /* ---------------------------------------------------------------------- */
      /* 4. 轮廓                                                                 */
      /* ---------------------------------------------------------------------- */

      function loadOutline(face: FaceRoot.Hardware.Gpu.TtfFace, glyph: number): Outline | null {
        const slice = glyphBytes(face, glyph);
        if (slice === null) {
          return null;
        }
        if (slice.length === 0) {
          return { contours: [], xMin: 0, yMin: 0, xMax: 0, yMax: 0 };
        }
        const header = readHeader(slice);
        if (header === null) {
          return null;
        }
        if (header.contours === 0) {
          return {
            contours: [],
            xMin: header.xMin,
            yMin: header.yMin,
            xMax: header.xMax,
            yMax: header.yMax,
          };
        }
        const contours = header.contours < 0
          ? readCompound(face, slice, 0, Identity)
          : readSimple(slice, header.contours, Identity);
        if (contours === null) {
          return null;
        }
        return {
          contours,
          xMin: header.xMin,
          yMin: header.yMin,
          xMax: header.xMax,
          yMax: header.yMax,
        };
      }

      function glyphBytes(face: FaceRoot.Hardware.Gpu.TtfFace, glyph: number): Uint8Array | null {
        if (glyph < 0 || glyph >= face.numGlyphs) {
          return null;
        }
        const start = face.loca[glyph];
        const end = face.loca[glyph + 1];
        if (start === undefined || end === undefined || end < start || end > face.glyf.length) {
          return null;
        }
        return face.glyf.subarray(start, end);
      }

      function readHeader(slice: Uint8Array): GlyphHeader | null {
        if (slice.length < 10) {
          return null;
        }
        const contours = readI16(slice, 0);
        const xMin = readI16(slice, 2);
        const yMin = readI16(slice, 4);
        const xMax = readI16(slice, 6);
        const yMax = readI16(slice, 8);
        if (contours === null || xMin === null || yMin === null || xMax === null || yMax === null) {
          return null;
        }
        return { contours, xMin, yMin, xMax, yMax };
      }

      function readSimple(slice: Uint8Array, contourCount: number, xf: Affine): CurvePoint[][] | null {
        if (contourCount > FontPointLimit) {
          return null;
        }
        const cursor: Cursor = { bytes: slice, at: 10 };
        const endPts: number[] = [];
        let pointCount = 0;
        for (let index = 0; index < contourCount; index += 1) {
          const end = pullU16(cursor);
          /* endPts 必须严格变大，最后一个点的下标再加 1 就是点数。 */
          if (end === null || end < pointCount || end >= FontPointLimit) {
            return null;
          }
          endPts.push(end);
          pointCount = end + 1;
        }
        if (pointCount > FontPointLimit) {
          return null;
        }
        const instructionLength = pullU16(cursor);
        if (instructionLength === null || cursor.at + instructionLength > slice.length) {
          return null;
        }
        /* 指令原样跳过。提示不是这一版的着墨规则。 */
        cursor.at += instructionLength;
        const flags: number[] = [];
        while (flags.length < pointCount) {
          const flag = pullU8(cursor);
          if (flag === null) {
            return null;
          }
          flags.push(flag);
          if ((flag & RepeatFlag) !== 0) {
            const extra = pullU8(cursor);
            if (extra === null || flags.length + extra > pointCount) {
              return null;
            }
            for (let repeat = 0; repeat < extra; repeat += 1) {
              flags.push(flag);
            }
          }
        }
        const xs = pullCoords(cursor, flags, XShort, XSameOrPositive);
        const ys = pullCoords(cursor, flags, YShort, YSameOrPositive);
        if (xs === null || ys === null) {
          return null;
        }
        const contours: CurvePoint[][] = [];
        let begin = 0;
        for (const end of endPts) {
          const contour: CurvePoint[] = [];
          for (let index = begin; index <= end; index += 1) {
            const x = xs[index];
            const y = ys[index];
            const flag = flags[index];
            if (x === undefined || y === undefined || flag === undefined) {
              return null;
            }
            const moved = applyAffine(xf, x, y);
            contour.push({ x: moved.x, y: moved.y, on: (flag & OnCurve) !== 0 });
          }
          contours.push(contour);
          begin = end + 1;
        }
        return contours;
      }

      /** 坐标是相对上一个点的增量。短向量用一个字节，正负看标志。 */
      function pullCoords(
        cursor: Cursor,
        flags: readonly number[],
        shortBit: number,
        sameBit: number,
      ): number[] | null {
        const coords: number[] = [];
        let current = 0;
        for (const flag of flags) {
          let delta = 0;
          if ((flag & shortBit) !== 0) {
            const value = pullU8(cursor);
            if (value === null) {
              return null;
            }
            delta = (flag & sameBit) !== 0 ? value : -value;
          } else if ((flag & sameBit) !== 0) {
            delta = 0;
          } else {
            const value = pullI16(cursor);
            if (value === null) {
              return null;
            }
            delta = value;
          }
          current += delta;
          coords.push(current);
        }
        return coords;
      }

      /**
       * 复合字形先套自己的仿射，再交回调用方并进同一条环绕。
       * `depth` 从最外层的 0 计。第 17 层（depth 16）拒绝。
       */
      function readCompound(
        face: FaceRoot.Hardware.Gpu.TtfFace,
        slice: Uint8Array,
        depth: number,
        xf: Affine,
      ): CurvePoint[][] | null {
        if (depth >= FontCompoundDepth) {
          return null;
        }
        const cursor: Cursor = { bytes: slice, at: 10 };
        const contours: CurvePoint[][] = [];
        let flags = 0;
        let components = 0;
        do {
          components += 1;
          if (components > ComponentMax) {
            return null;
          }
          const flagValue = pullU16(cursor);
          const childIndex = pullU16(cursor);
          if (flagValue === null || childIndex === null) {
            return null;
          }
          flags = flagValue;
          const words = (flags & ArgWords) !== 0;
          const xy = (flags & ArgXY) !== 0;
          const arg1 = words ? (xy ? pullI16(cursor) : pullU16(cursor)) : (xy ? pullI8(cursor) : pullU8(cursor));
          const arg2 = words ? (xy ? pullI16(cursor) : pullU16(cursor)) : (xy ? pullI8(cursor) : pullU8(cursor));
          if (arg1 === null || arg2 === null || !xy) {
            return null;
          }
          const scaleCount = ((flags & HaveTwoByTwo) !== 0 ? 1 : 0)
            + ((flags & HaveXYScale) !== 0 ? 1 : 0)
            + ((flags & HaveScale) !== 0 ? 1 : 0);
          if (scaleCount > 1) {
            return null;
          }
          const local = readComponentMatrix(cursor, flags, arg1, arg2);
          if (local === null) {
            return null;
          }
          const child = readChild(face, childIndex, depth + 1, compose(xf, local));
          if (child === null) {
            return null;
          }
          for (const contour of child) {
            contours.push(contour);
          }
        } while ((flags & MoreComponents) !== 0);
        return contours;
      }

      function readComponentMatrix(cursor: Cursor, flags: number, arg1: number, arg2: number): Affine | null {
        let a = 1;
        let b = 0;
        let c = 0;
        let d = 1;
        if ((flags & HaveScale) !== 0) {
          const scale = pullF2Dot14(cursor);
          if (scale === null) {
            return null;
          }
          a = scale;
          d = scale;
        } else if ((flags & HaveXYScale) !== 0) {
          const sx = pullF2Dot14(cursor);
          const sy = pullF2Dot14(cursor);
          if (sx === null || sy === null) {
            return null;
          }
          a = sx;
          d = sy;
        } else if ((flags & HaveTwoByTwo) !== 0) {
          const m00 = pullF2Dot14(cursor);
          const m01 = pullF2Dot14(cursor);
          const m10 = pullF2Dot14(cursor);
          const m11 = pullF2Dot14(cursor);
          if (m00 === null || m01 === null || m10 === null || m11 === null) {
            return null;
          }
          a = m00;
          b = m01;
          c = m10;
          d = m11;
        }
        let e = arg1;
        let f = arg2;
        /* 这个标志先用部件自己的缩放吃掉偏移，再交给外层仿射。 */
        if ((flags & ScaledOffset) !== 0) {
          e = a * arg1 + b * arg2;
          f = c * arg1 + d * arg2;
        }
        return { a, b, c, d, e, f };
      }

      function readChild(
        face: FaceRoot.Hardware.Gpu.TtfFace,
        glyph: number,
        depth: number,
        xf: Affine,
      ): CurvePoint[][] | null {
        const slice = glyphBytes(face, glyph);
        if (slice === null) {
          return null;
        }
        if (slice.length === 0) {
          return [];
        }
        const header = readHeader(slice);
        if (header === null) {
          return null;
        }
        if (header.contours === 0) {
          return [];
        }
        if (header.contours < 0) {
          return readCompound(face, slice, depth, xf);
        }
        return readSimple(slice, header.contours, xf);
      }

      function compose(outer: Affine, inner: Affine): Affine {
        return {
          a: outer.a * inner.a + outer.b * inner.c,
          b: outer.a * inner.b + outer.b * inner.d,
          c: outer.c * inner.a + outer.d * inner.c,
          d: outer.c * inner.b + outer.d * inner.d,
          e: outer.a * inner.e + outer.b * inner.f + outer.e,
          f: outer.c * inner.e + outer.d * inner.f + outer.f,
        };
      }

      function applyAffine(xf: Affine, x: number, y: number): LinePoint {
        return {
          x: xf.a * x + xf.b * y + xf.e,
          y: xf.c * x + xf.d * y + xf.f,
        };
      }

      /* ---------------------------------------------------------------------- */
      /* 5. 展平与着墨                                                           */
      /* ---------------------------------------------------------------------- */

      function rasterOutline(
        face: FaceRoot.Hardware.Gpu.TtfFace,
        glyph: number,
        ppem: number,
        outline: Outline,
      ): MaskRoot.Hardware.Gpu.GlyphMask | null {
        const advance = advanceOf(face, glyph, ppem);
        const units = face.unitsPerEm;
        if (outline.contours.length === 0) {
          return blank(advance, edgeMin(outline.xMin, ppem, units), edgeMax(outline.yMax, ppem, units));
        }
        const left = edgeMin(outline.xMin, ppem, units);
        const right = edgeMax(outline.xMax, ppem, units);
        const bottom = edgeMin(outline.yMin, ppem, units);
        const top = edgeMax(outline.yMax, ppem, units);
        const width = right - left;
        const height = top - bottom;
        if (width < 0 || height < 0 || width > FontBitmapSideMax || height > FontBitmapSideMax) {
          return null;
        }
        if (width === 0 || height === 0) {
          return blank(advance, left, top);
        }
        /* 四分之一像素换成字体单位，细分时才能和轮廓用同一套坐标。 */
        const tolerance = (0.25 * units) / ppem;
        const polys: LinePoint[][] = [];
        for (const contour of outline.contours) {
          const flat = flatten(contour, tolerance);
          if (flat === null) {
            return null;
          }
          if (flat.length >= 2) {
            polys.push(flat);
          }
        }
        const coverage = new Uint8Array(width * height);
        const scale = units / ppem;
        for (let row = 0; row < height; row += 1) {
          /* 第 0 行是包围盒最上边，所以行号越大，字体 y 越小。 */
          const y = (top - row - 0.5) * scale;
          for (let col = 0; col < width; col += 1) {
            const x = (left + col + 0.5) * scale;
            if (covered(x, y, polys)) {
              coverage[row * width + col] = 255;
            }
          }
        }
        return { width, height, advance, left, top, coverage };
      }

      function blank(advance: number, left: number, top: number): MaskRoot.Hardware.Gpu.GlyphMask {
        return {
          width: 0,
          height: 0,
          advance,
          left,
          top,
          coverage: new Uint8Array(0),
        };
      }

      function advanceOf(face: FaceRoot.Hardware.Gpu.TtfFace, glyph: number, ppem: number): number {
        const raw = face.advances[glyph] ?? 0;
        const advance = Math.trunc((raw * ppem) / face.unitsPerEm);
        if (advance < 0) {
          return 0;
        }
        return advance;
      }

      /** 左边和下边向下取整，右边和上边向上取整。用实数，不先向 0 截断。 */
      function edgeMin(font: number, ppem: number, units: number): number {
        return Math.floor((font * ppem) / units);
      }

      function edgeMax(font: number, ppem: number, units: number): number {
        return Math.ceil((font * ppem) / units);
      }

      /**
       * 相邻两个离曲线点之间先补中点，这个中点算在曲线上。
       * 然后从某个在曲线上的点出发，把二次曲线收到折线。
       */
      function flatten(contour: readonly CurvePoint[], tolerance: number): LinePoint[] | null {
        if (contour.length === 0) {
          return [];
        }
        const implied = imply(contour);
        let start = 0;
        while (start < implied.length) {
          const point = implied[start];
          if (point?.on === true) {
            break;
          }
          start += 1;
        }
        if (start >= implied.length) {
          return null;
        }
        const ordered: CurvePoint[] = [];
        for (let index = 0; index < implied.length; index += 1) {
          const point = implied[(start + index) % implied.length];
          if (point === undefined) {
            return null;
          }
          ordered.push(point);
        }
        const first = ordered[0];
        if (first === undefined) {
          return null;
        }
        const line: LinePoint[] = [{ x: first.x, y: first.y }];
        const count = ordered.length;
        let index = 0;
        let guard = 0;
        let closed = false;
        while (guard < count * 2) {
          guard += 1;
          const nextIndex = (index + 1) % count;
          const next = ordered[nextIndex];
          if (next === undefined) {
            return null;
          }
          if (next.on) {
            line.push({ x: next.x, y: next.y });
            if (nextIndex === 0) {
              closed = true;
              break;
            }
            index = nextIndex;
            continue;
          }
          const endIndex = (index + 2) % count;
          const end = ordered[endIndex];
          const current = line[line.length - 1];
          if (end === undefined || !end.on || current === undefined) {
            return null;
          }
          appendQuadratic(line, current, next, end, tolerance, 0);
          if (endIndex === 0) {
            closed = true;
            break;
          }
          index = endIndex;
        }
        if (!closed) {
          return null;
        }
        return line;
      }

      function imply(contour: readonly CurvePoint[]): CurvePoint[] {
        const implied: CurvePoint[] = [];
        const count = contour.length;
        for (let index = 0; index < count; index += 1) {
          const current = contour[index];
          const next = contour[(index + 1) % count];
          if (current === undefined || next === undefined) {
            continue;
          }
          implied.push(current);
          if (!current.on && !next.on) {
            implied.push({
              x: (current.x + next.x) / 2,
              y: (current.y + next.y) / 2,
              on: true,
            });
          }
        }
        return implied;
      }

      /**
       * 控制点到弦的距离用字体单位。
       * 不超过容差就收成弦的终点；否则在 t = 1/2 切成两条二次曲线。
       */
      function appendQuadratic(
        line: LinePoint[],
        start: LinePoint,
        control: CurvePoint,
        end: CurvePoint,
        tolerance: number,
        depth: number,
      ): void {
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const span = Math.hypot(dx, dy);
        const area = Math.abs(dx * (start.y - control.y) - dy * (start.x - control.x));
        const distance = span === 0 ? Math.hypot(control.x - start.x, control.y - start.y) : area / span;
        if (distance <= tolerance || depth >= FlattenDepthMax) {
          line.push({ x: end.x, y: end.y });
          return;
        }
        const leftControl: CurvePoint = {
          x: (start.x + control.x) / 2,
          y: (start.y + control.y) / 2,
          on: false,
        };
        const rightControl: CurvePoint = {
          x: (control.x + end.x) / 2,
          y: (control.y + end.y) / 2,
          on: false,
        };
        const mid: CurvePoint = {
          x: (leftControl.x + rightControl.x) / 2,
          y: (leftControl.y + rightControl.y) / 2,
          on: true,
        };
        appendQuadratic(line, start, leftControl, mid, tolerance, depth + 1);
        appendQuadratic(line, mid, rightControl, end, tolerance, depth + 1);
      }

      function covered(x: number, y: number, polys: readonly (readonly LinePoint[])[]): boolean {
        for (const poly of polys) {
          for (let index = 0; index < poly.length - 1; index += 1) {
            const from = poly[index];
            const to = poly[index + 1];
            if (from !== undefined && to !== undefined && onSegment(x, y, from, to)) {
              return true;
            }
          }
        }
        let winding = 0;
        for (const poly of polys) {
          for (let index = 0; index < poly.length - 1; index += 1) {
            const from = poly[index];
            const to = poly[index + 1];
            if (from === undefined || to === undefined) {
              continue;
            }
            const side = (to.x - from.x) * (y - from.y) - (x - from.x) * (to.y - from.y);
            if (from.y <= y) {
              if (to.y > y && side > 0) {
                winding += 1;
              }
            } else if (to.y <= y && side < 0) {
              winding -= 1;
            }
          }
        }
        return winding !== 0;
      }

      function onSegment(x: number, y: number, from: LinePoint, to: LinePoint): boolean {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const area = dx * (y - from.y) - dy * (x - from.x);
        if (area > EdgeEpsilon || area < -EdgeEpsilon) {
          return false;
        }
        const dot = (x - from.x) * dx + (y - from.y) * dy;
        if (dot < -EdgeEpsilon) {
          return false;
        }
        const length2 = dx * dx + dy * dy;
        return dot <= length2 + EdgeEpsilon;
      }

      function pullU8(cursor: Cursor): number | null {
        const value = readU8(cursor.bytes, cursor.at);
        if (value === null) {
          return null;
        }
        cursor.at += 1;
        return value;
      }

      function pullU16(cursor: Cursor): number | null {
        const value = readU16(cursor.bytes, cursor.at);
        if (value === null) {
          return null;
        }
        cursor.at += 2;
        return value;
      }

      function pullI8(cursor: Cursor): number | null {
        const value = pullU8(cursor);
        if (value === null) {
          return null;
        }
        if (value >= 0x80) {
          return value - 0x100;
        }
        return value;
      }

      function pullI16(cursor: Cursor): number | null {
        const value = pullU16(cursor);
        if (value === null) {
          return null;
        }
        if (value >= 0x8000) {
          return value - 0x10000;
        }
        return value;
      }

      /** 2.14 定点。16384 表示 1。 */
      function pullF2Dot14(cursor: Cursor): number | null {
        const value = pullI16(cursor);
        if (value === null) {
          return null;
        }
        return value / 16384;
      }

      function readU8(bytes: Uint8Array, offset: number): number | null {
        if (offset < 0 || offset >= bytes.length) {
          return null;
        }
        const value = bytes[offset];
        if (value === undefined) {
          return null;
        }
        return value;
      }

      function readU16(bytes: Uint8Array, offset: number): number | null {
        const hi = readU8(bytes, offset);
        const lo = readU8(bytes, offset + 1);
        if (hi === null || lo === null) {
          return null;
        }
        return hi * 256 + lo;
      }

      function readI16(bytes: Uint8Array, offset: number): number | null {
        const value = readU16(bytes, offset);
        if (value === null) {
          return null;
        }
        if (value >= 0x8000) {
          return value - 0x10000;
        }
        return value;
      }
    }
  }
}
