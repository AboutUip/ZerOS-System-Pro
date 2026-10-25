/**
 * @module ZerOS.Hardware.Gpu.TtfParse
 * @description 打开 TrueType 子集
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 实现 Font.md 第 2 节的接受条件：`sfnt` 版本、七张必需表、`unitsPerEm`、
 * format 4 与 format 12。不光栅，不调用宿主字体引擎，不校验表的 checksum。
 * 字形轮廓留在 `glyf` 副本里，由光栅读取。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. openTtf
 *   3. 目录与整数
 *   4. 各表
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as LimitRoot } from "../Config/FontLimit";
import type { ZerOS as FaceRoot } from "../Structure/TtfFace";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Gpu {
      const FontUnitsPerEmMin = LimitRoot.Hardware.Gpu.Config.FontUnitsPerEmMin;
      const FontUnitsPerEmMax = LimitRoot.Hardware.Gpu.Config.FontUnitsPerEmMax;

      /** 只有带轮廓的 TrueType。`OTTO` 是 CFF，本子集不接受。 */
      const SfntTrueType = 0x00010000;

      /** 目录项过多时直接拒绝，避免恶意表数把打开拖死。非协议。 */
      const TableCountMax = 256;

      interface TableSpan {
        readonly offset: number;
        readonly length: number;
      }

      /* ---------------------------------------------------------------------- */
      /* 2. openTtf                                                              */
      /* ---------------------------------------------------------------------- */

      /**
       * 按 Font.md 第 2 节打开。
       * 成功时 `glyf` 是副本，调用方随后改自己的数组不影响字体面。
       * 缺表、截断、版本不对、`unitsPerEm` 越界都是失败，不抛异常。
       */
      export function openTtf(bytes: Uint8Array): FaceRoot.Hardware.Gpu.TtfOpen {
        const tables = readDirectory(bytes);
        if (tables === null) {
          return { ok: false };
        }
        const head = sliceOf(bytes, tables, "head");
        const maxp = sliceOf(bytes, tables, "maxp");
        const cmap = sliceOf(bytes, tables, "cmap");
        const loca = sliceOf(bytes, tables, "loca");
        const glyf = sliceOf(bytes, tables, "glyf");
        const hhea = sliceOf(bytes, tables, "hhea");
        const hmtx = sliceOf(bytes, tables, "hmtx");
        if (
          head === null
          || maxp === null
          || cmap === null
          || loca === null
          || glyf === null
          || hhea === null
          || hmtx === null
        ) {
          return { ok: false };
        }
        /* (1) 度量与字形个数先定下来，后面的表都靠它们量长度。 */
        const metrics = readHead(head);
        const numGlyphs = readGlyphCount(maxp);
        const hMetrics = readHMetrics(hhea);
        if (metrics === null || numGlyphs === null || hMetrics === null || hMetrics > numGlyphs) {
          return { ok: false };
        }
        /* (2) 映射、偏移和前进宽度任何一张截断，整份字体都不要。 */
        const mapping = readCmap(cmap);
        const offsets = readLoca(loca, numGlyphs, metrics.locaFormat, glyf.length);
        const advances = readAdvances(hmtx, numGlyphs, hMetrics);
        if (mapping === null || offsets === null || advances === null) {
          return { ok: false };
        }
        return {
          ok: true,
          face: {
            unitsPerEm: metrics.unitsPerEm,
            numGlyphs,
            advances,
            loca: offsets,
            glyf: glyf.slice(),
            groups: mapping.groups,
            format4: mapping.format4,
          },
        };
      }

      /* ---------------------------------------------------------------------- */
      /* 3. 目录与整数                                                           */
      /* ---------------------------------------------------------------------- */

      /**
       * 线性扫描偏移表。不使用 searchRange，因此目录的二分辅助字段写错也不影响打开。
       * checksum 按协议忽略。
       */
      function readDirectory(bytes: Uint8Array): ReadonlyMap<string, TableSpan> | null {
        if (readU32(bytes, 0) !== SfntTrueType) {
          return null;
        }
        const count = readU16(bytes, 4);
        if (count === null || count < 1 || count > TableCountMax) {
          return null;
        }
        if (12 + count * 16 > bytes.length) {
          return null;
        }
        const tables = new Map<string, TableSpan>();
        for (let index = 0; index < count; index += 1) {
          const at = 12 + index * 16;
          const tag = readTag(bytes, at);
          const offset = readU32(bytes, at + 8);
          const length = readU32(bytes, at + 12);
          if (tag === null || offset === null || length === null) {
            return null;
          }
          /* 同名表留第一张。必需表只要求存在，不要求唯一。 */
          if (!tables.has(tag)) {
            tables.set(tag, { offset, length });
          }
        }
        return tables;
      }

      /** 表必须完全落在文件里。长度为 0 的 `glyf` 是合法的空字形集。 */
      function sliceOf(
        bytes: Uint8Array,
        tables: ReadonlyMap<string, TableSpan>,
        tag: string,
      ): Uint8Array | null {
        const span = tables.get(tag);
        if (span === undefined) {
          return null;
        }
        if (span.offset > bytes.length || span.length > bytes.length - span.offset) {
          return null;
        }
        return bytes.subarray(span.offset, span.offset + span.length);
      }

      function readTag(bytes: Uint8Array, offset: number): string | null {
        const a = readU8(bytes, offset);
        const b = readU8(bytes, offset + 1);
        const c = readU8(bytes, offset + 2);
        const d = readU8(bytes, offset + 3);
        if (a === null || b === null || c === null || d === null) {
          return null;
        }
        return String.fromCharCode(a, b, c, d);
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

      /** 大端。用乘法，避免 16 位以上的移位被当成有符号 32 位。 */
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

      function readU32(bytes: Uint8Array, offset: number): number | null {
        const b0 = readU8(bytes, offset);
        const b1 = readU8(bytes, offset + 1);
        const b2 = readU8(bytes, offset + 2);
        const b3 = readU8(bytes, offset + 3);
        if (b0 === null || b1 === null || b2 === null || b3 === null) {
          return null;
        }
        return b0 * 0x1000000 + b1 * 0x10000 + b2 * 0x100 + b3;
      }

      function readU16List(
        bytes: Uint8Array,
        offset: number,
        count: number,
        end: number,
      ): number[] | null {
        if (offset < 0 || end < offset || count < 0 || count > (end - offset) / 2) {
          return null;
        }
        const values: number[] = [];
        for (let index = 0; index < count; index += 1) {
          const value = readU16(bytes, offset + index * 2);
          if (value === null) {
            return null;
          }
          values.push(value);
        }
        return values;
      }

      function readI16List(
        bytes: Uint8Array,
        offset: number,
        count: number,
        end: number,
      ): number[] | null {
        const raw = readU16List(bytes, offset, count, end);
        if (raw === null) {
          return null;
        }
        const values: number[] = [];
        for (const value of raw) {
          values.push(value >= 0x8000 ? value - 0x10000 : value);
        }
        return values;
      }

      /* ---------------------------------------------------------------------- */
      /* 4. 各表                                                                 */
      /* ---------------------------------------------------------------------- */

      function readHead(table: Uint8Array): { readonly unitsPerEm: number; readonly locaFormat: number } | null {
        if (table.length < 54) {
          return null;
        }
        const unitsPerEm = readU16(table, 18);
        const locaFormat = readI16(table, 50);
        const glyphFormat = readI16(table, 52);
        if (unitsPerEm === null || locaFormat === null || glyphFormat === null) {
          return null;
        }
        if (unitsPerEm < FontUnitsPerEmMin || unitsPerEm > FontUnitsPerEmMax) {
          return null;
        }
        /* 0 是 16 位 loca，1 是 32 位。字形数据格式只接受 0。 */
        if ((locaFormat !== 0 && locaFormat !== 1) || glyphFormat !== 0) {
          return null;
        }
        return { unitsPerEm, locaFormat };
      }

      function readGlyphCount(table: Uint8Array): number | null {
        if (table.length < 6) {
          return null;
        }
        const count = readU16(table, 4);
        if (count === null || count < 1) {
          return null;
        }
        return count;
      }

      function readHMetrics(table: Uint8Array): number | null {
        if (table.length < 36) {
          return null;
        }
        const count = readU16(table, 34);
        if (count === null || count < 1) {
          return null;
        }
        return count;
      }

      /**
       * 只收 platform 3 的 format 4 与 format 12。
       * 两张都没有时字体无法把标量送到字形，打开失败。
       */
      function readCmap(table: Uint8Array): {
        readonly groups: readonly FaceRoot.Hardware.Gpu.CmapGroup[];
        readonly format4: FaceRoot.Hardware.Gpu.Format4 | null;
      } | null {
        const count = readU16(table, 2);
        if (count === null || 4 + count * 8 > table.length) {
          return null;
        }
        let format12At: number | null = null;
        let format4At: number | null = null;
        for (let index = 0; index < count; index += 1) {
          const platform = readU16(table, 4 + index * 8);
          const encoding = readU16(table, 6 + index * 8);
          const offset = readU32(table, 8 + index * 8);
          if (platform === null || encoding === null || offset === null || offset >= table.length) {
            return null;
          }
          if (platform === 3 && encoding === 10 && format12At === null) {
            format12At = offset;
          }
          if (platform === 3 && encoding === 1 && format4At === null) {
            format4At = offset;
          }
        }
        if (format12At === null && format4At === null) {
          return null;
        }
        const groups = format12At === null ? [] : readFormat12(table, format12At);
        const format4 = format4At === null ? null : readFormat4(table, format4At);
        if (groups === null || (format4At !== null && format4 === null)) {
          return null;
        }
        return { groups, format4 };
      }

      function readFormat12(table: Uint8Array, offset: number): FaceRoot.Hardware.Gpu.CmapGroup[] | null {
        if (readU16(table, offset) !== 12) {
          return null;
        }
        const length = readU32(table, offset + 4);
        const groupCount = readU32(table, offset + 12);
        if (
          length === null
          || groupCount === null
          || length < 16
          || offset > table.length
          || length > table.length - offset
          || 16 + groupCount * 12 > length
        ) {
          return null;
        }
        const groups: FaceRoot.Hardware.Gpu.CmapGroup[] = [];
        let at = offset + 16;
        for (let index = 0; index < groupCount; index += 1) {
          const start = readU32(table, at);
          const end = readU32(table, at + 4);
          const glyph = readU32(table, at + 8);
          if (start === null || end === null || glyph === null || end < start || end > 0x10ffff) {
            return null;
          }
          groups.push({ start, end, glyph });
          at += 12;
        }
        return groups;
      }

      function readFormat4(table: Uint8Array, offset: number): FaceRoot.Hardware.Gpu.Format4 | null {
        if (readU16(table, offset) !== 4) {
          return null;
        }
        const length = readU16(table, offset + 2);
        const segCountX2 = readU16(table, offset + 6);
        if (
          length === null
          || segCountX2 === null
          || length < 16
          || segCountX2 < 2
          || segCountX2 % 2 !== 0
          || offset > table.length
          || length > table.length - offset
        ) {
          return null;
        }
        const segCount = segCountX2 / 2;
        const headerAndArrays = 16 + segCount * 8;
        if (length < headerAndArrays) {
          return null;
        }
        const endLimit = offset + length;
        const endCount = readU16List(table, offset + 14, segCount, endLimit);
        const startCount = readU16List(table, offset + 16 + segCount * 2, segCount, endLimit);
        const idDelta = readI16List(table, offset + 16 + segCount * 4, segCount, endLimit);
        const idRangeOffset = readU16List(table, offset + 16 + segCount * 6, segCount, endLimit);
        const glyphCount = (length - headerAndArrays) / 2;
        const glyphIdArray = readU16List(table, offset + headerAndArrays, glyphCount, endLimit);
        if (
          endCount === null
          || startCount === null
          || idDelta === null
          || idRangeOffset === null
          || glyphIdArray === null
        ) {
          return null;
        }
        /* endCount 必须非降，否则“第一段盖住这个码”没有意义。 */
        let previous = -1;
        for (let index = 0; index < segCount; index += 1) {
          const end = endCount[index];
          const start = startCount[index];
          if (end === undefined || start === undefined || end < previous || start > end) {
            return null;
          }
          previous = end;
        }
        return {
          endCount,
          startCount,
          idDelta,
          idRangeOffset,
          words: idRangeOffset.concat(glyphIdArray),
        };
      }

      /**
       * loca 的最后一项是 glyf 的总长。
       * 短格式的表内数值要乘 2 才是字节偏移。
       */
      function readLoca(
        table: Uint8Array,
        numGlyphs: number,
        locaFormat: number,
        glyfLength: number,
      ): number[] | null {
        const count = numGlyphs + 1;
        const offsets: number[] = [];
        if (locaFormat === 0) {
          if (table.length < count * 2) {
            return null;
          }
          for (let index = 0; index < count; index += 1) {
            const value = readU16(table, index * 2);
            if (value === null) {
              return null;
            }
            offsets.push(value * 2);
          }
        } else {
          if (table.length < count * 4) {
            return null;
          }
          for (let index = 0; index < count; index += 1) {
            const value = readU32(table, index * 4);
            if (value === null) {
              return null;
            }
            offsets.push(value);
          }
        }
        let previous = 0;
        for (const offset of offsets) {
          if (offset < previous || offset > glyfLength) {
            return null;
          }
          previous = offset;
        }
        return offsets;
      }

      /**
       * 前 `hMetrics` 个字形各有自己的前进宽度。
       * 其余字形沿用最后一条长度量的前进宽度。
       */
      function readAdvances(table: Uint8Array, numGlyphs: number, hMetrics: number): number[] | null {
        const bytesNeeded = hMetrics * 4 + (numGlyphs - hMetrics) * 2;
        if (table.length < bytesNeeded) {
          return null;
        }
        const last = readU16(table, (hMetrics - 1) * 4);
        if (last === null) {
          return null;
        }
        const advances: number[] = [];
        for (let index = 0; index < numGlyphs; index += 1) {
          if (index < hMetrics) {
            const value = readU16(table, index * 4);
            if (value === null) {
              return null;
            }
            advances.push(value);
          } else {
            advances.push(last);
          }
        }
        return advances;
      }
    }
  }
}
