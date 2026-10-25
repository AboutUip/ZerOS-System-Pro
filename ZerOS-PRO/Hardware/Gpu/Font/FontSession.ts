/**
 * @module ZerOS.Hardware.Gpu.FontSession
 * @description 执行 FontFace、FontSelect 和 FontDraw
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 字体面留在显卡这一侧。打开时复制字形表，之后不再读那一段文件字节。
 * FontDraw 先把整段标量光栅完，有一个不合法就一个像素都不交出去。
 * 同一字体面、同一字号、同一标量的掩码留着，第二次必须和第一次逐字节相同。
 * 不调用宿主字体引擎，不抗锯齿，不改颜色目标。盖像素的是 WebGpuAccel。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 参数
 *   3. 会话
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as OpRoot } from "../Enum/AccelOp";
import { ZerOS as LimitRoot } from "../Config/FontLimit";
import { ZerOS as ParseRoot } from "./TtfParse";
import { ZerOS as RasterRoot } from "./TtfRaster";
import { type ZerOS as FaceRoot } from "../Structure/TtfFace";
import { type ZerOS as MaskRoot } from "../Structure/GlyphMask";
import { type ZerOS as StampRoot } from "../Structure/FontStamp";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Gpu {
      const Op = OpRoot.Hardware.Gpu.AccelOp;
      const FontPpemMin = LimitRoot.Hardware.Gpu.Config.FontPpemMin;
      const FontPpemMax = LimitRoot.Hardware.Gpu.Config.FontPpemMax;
      const FontFileOctets = LimitRoot.Hardware.Gpu.Config.FontFileOctets;
      const FontDrawMax = LimitRoot.Hardware.Gpu.Config.FontDrawMax;
      const openTtf = ParseRoot.Hardware.Gpu.openTtf;
      const rasterizeGlyph = RasterRoot.Hardware.Gpu.rasterizeGlyph;

      type TtfFace = FaceRoot.Hardware.Gpu.TtfFace;
      type GlyphMask = MaskRoot.Hardware.Gpu.GlyphMask;
      type FontStamp = StampRoot.Hardware.Gpu.FontStamp;
      type FontAnswer = StampRoot.Hardware.Gpu.FontAnswer;

      const ScalarMax = 0x10ffff;
      const SurrogateMin = 0xd800;
      const SurrogateMax = 0xdfff;
      const floatBits = new DataView(new ArrayBuffer(8));

      interface HeldFace {
        readonly id: number;
        readonly ppem: number;
        readonly face: TtfFace;
      }

      /* ---------------------------------------------------------------------- */
      /* 2. 参数                                                                 */
      /* ---------------------------------------------------------------------- */

      /** 把一个有限数收成加速参数用的二进制 64 位型。测试和调用方共用。 */
      export function fontParameter(value: number): bigint {
        floatBits.setFloat64(0, value, true);
        return floatBits.getBigInt64(0, true);
      }

      /** 寄存器里的二进制 64 位型。不是有限整数就拒绝，避免把位型截成另一个长度。 */
      function integerParam(bits: bigint): number | null {
        floatBits.setBigInt64(0, BigInt.asIntN(64, bits), true);
        const value = floatBits.getFloat64(0, true);
        if (!Number.isSafeInteger(value)) {
          return null;
        }
        return value;
      }

      function scalarAt(bytes: Uint8Array, index: number): number {
        const b0 = bytes[index] ?? 0;
        const b1 = bytes[index + 1] ?? 0;
        const b2 = bytes[index + 2] ?? 0;
        const b3 = bytes[index + 3] ?? 0;
        return (b0 + (b1 << 8) + (b2 << 16) + b3 * 0x1000000) >>> 0;
      }

      function legalScalar(scalar: number): boolean {
        return scalar <= ScalarMax && (scalar < SurrogateMin || scalar > SurrogateMax);
      }

      /* ---------------------------------------------------------------------- */
      /* 3. 会话                                                                 */
      /* ---------------------------------------------------------------------- */

      export interface FontSession {
        /**
         * 执行一条字体加速命令。
         * `bytes` 是执行核心已经从线性位元读出的那一段。FontSelect 不需要它。
         * 成功时 FontFace 的 id 从 1 起只增不减。失败时 id 不增加，ink 为空。
         */
        command(op: number, a: bigint, b: bigint, c: bigint, d: bigint, bytes: Uint8Array | null): FontAnswer;
      }

      /** 一张独立的字体面表。自检用新的，显卡线程用 machineFont。 */
      export function createFontSession(): FontSession {
        let nextId = 1;
        const faces = new Map<number, HeldFace>();
        let selected: HeldFace | null = null;
        let penX = 0;
        let penY = 0;
        const cache = new Map<string, GlyphMask>();

        function cached(face: HeldFace, scalar: number): GlyphMask | null {
          const key = `${String(face.id)}:${String(face.ppem)}:${String(scalar)}`;
          const found = cache.get(key);
          if (found !== undefined) {
            return found;
          }
          const mask = rasterizeGlyph(face.face, scalar, face.ppem);
          if (mask === null) {
            return null;
          }
          cache.set(key, mask);
          return mask;
        }

        function reject(): FontAnswer {
          return { ok: false };
        }

        function succeed(id: number, ink: readonly FontStamp[]): FontAnswer {
          return { ok: true, id, ink };
        }

        function faceOf(bits: bigint): FontAnswer | HeldFace {
          const id = integerParam(bits);
          if (id === null) {
            return reject();
          }
          const held = faces.get(id);
          if (held === undefined) {
            return reject();
          }
          return held;
        }

        return {
          command(op: number, a: bigint, b: bigint, c: bigint, _d: bigint, bytes: Uint8Array | null): FontAnswer {
            if (op === Op.FontFace) {
              const length = integerParam(b);
              const ppem = integerParam(c);
              if (length === null || ppem === null || length < 1 || length > FontFileOctets || ppem < FontPpemMin || ppem > FontPpemMax) {
                return reject();
              }
              if (bytes === null) {
                return reject();
              }
              if (bytes.length !== length) {
                return reject();
              }
              const opened = openTtf(bytes);
              if (!opened.ok) {
                return reject();
              }
              const id = nextId;
              nextId += 1;
              faces.set(id, { id, ppem, face: opened.face });
              return succeed(id, []);
            }
            if (op === Op.FontSelect) {
              const held = faceOf(a);
              if (!("face" in held)) {
                return held;
              }
              const x = integerParam(b);
              const y = integerParam(c);
              if (x === null || y === null) {
                return reject();
              }
              selected = held;
              penX = x;
              penY = y;
              return succeed(0, []);
            }
            if (op === Op.FontDraw) {
              const count = integerParam(b);
              if (count === null || count < 0 || count > FontDrawMax) {
                return reject();
              }
              if (selected === null) {
                return reject();
              }
              if (count === 0) {
                return succeed(0, []);
              }
              if (bytes === null) {
                return reject();
              }
              if (bytes.length !== count * 4) {
                return reject();
              }
              const scalars: number[] = [];
              for (let index = 0; index < count; index += 1) {
                const scalar = scalarAt(bytes, index * 4);
                if (!legalScalar(scalar)) {
                  return reject();
                }
                scalars.push(scalar);
              }
              const masks: GlyphMask[] = [];
              for (const scalar of scalars) {
                const mask = cached(selected, scalar);
                if (mask === null) {
                  return reject();
                }
                masks.push(mask);
              }
              const ink: FontStamp[] = [];
              let x = penX;
              for (const mask of masks) {
                if (mask.width > 0 && mask.height > 0 && mask.coverage.length === mask.width * mask.height) {
                  ink.push({
                    x: x + mask.left,
                    y: penY - mask.top,
                    width: mask.width,
                    height: mask.height,
                    coverage: new Uint8Array(mask.coverage),
                  });
                }
                x += mask.advance;
              }
              penX = x;
              return succeed(0, ink);
            }
            return reject();
          },
        };
      }

      const machine = createFontSession();

      /** 显卡线程上的那一张表。编号在这一进程里只增不减。 */
      export function machineFont(): FontSession {
        return machine;
      }
    }
  }
}
