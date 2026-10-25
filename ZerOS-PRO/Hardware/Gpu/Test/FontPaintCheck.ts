/**
 * @module ZerOS.Hardware.Gpu.FontPaintCheck
 * @description 把字体面画进颜色目标再读回
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 解析和会话自检不碰帧。这一步才走 WebGPU：清成黑色，用红色盖上 U+0041，
 * 读回的像素必须和光栅掩码上的着墨位置一致。非法文件和代理项一个图元都不加。
 * 画完把颜色恢复成白，免得固件的第一笔跟着变红。不改封闭点阵，也不把帧送到页面。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. runFontPaintCheck
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as OpRoot } from "../Enum/AccelOp";
import { ZerOS as AccelRoot } from "../Bootstrap/WebGpuAccel";
import { ZerOS as RuntimeRoot } from "../Bootstrap/GpuRuntime";
import { ZerOS as BytesRoot } from "../Font/FontBytes";
import { ZerOS as SessionRoot } from "../Font/FontSession";
import { ZerOS as ParseRoot } from "../Font/TtfParse";
import { ZerOS as RasterRoot } from "../Font/TtfRaster";
import { ZerOS as TtfCheckRoot } from "./TtfCheck";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Gpu {
      const Op = OpRoot.Hardware.Gpu.AccelOp;
      const accel = AccelRoot.Hardware.Gpu.accel;
      const present = RuntimeRoot.Hardware.Gpu.present;
      const frameSize = RuntimeRoot.Hardware.Gpu.frameSize;
      const stageFontBytes = BytesRoot.Hardware.Gpu.stageFontBytes;
      const fontParameter = SessionRoot.Hardware.Gpu.fontParameter;
      const openTtf = ParseRoot.Hardware.Gpu.openTtf;
      const rasterizeGlyph = RasterRoot.Hardware.Gpu.rasterizeGlyph;
      const squareFontBytes = TtfCheckRoot.Hardware.Gpu.squareFontBytes;
      const checkPrefix = "[ZerOS.Hardware.Gpu.FontPaintCheck]";

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
      const penX = 10;
      const penY = 20;

      function fail(message: string): never {
        throw new Error(`${checkPrefix} ${message}`);
      }

      /** 拒绝必须带着协议那句，别的失败原样抛出去。 */
      async function expectRejected(op: number, a: bigint, b: bigint, c: bigint, bytes: Uint8Array): Promise<void> {
        stageFontBytes(bytes);
        try {
          await accel(op, a, b, c, 0n);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "";
          if (!message.includes("font command was rejected")) {
            throw error;
          }
          return;
        }
        fail("a rejected font command was accepted");
      }

      /* ---------------------------------------------------------------------- */
      /* 2. runFontPaintCheck                                                    */
      /* ---------------------------------------------------------------------- */

      /** 显卡自检的最后一步。颜色目标已经按帧尺寸建立。 */
      export async function runFontPaintCheck(): Promise<void> {
        const bits = fontParameter;
        const source = squareFontBytes();
        const opened = openTtf(source);
        if (!opened.ok) {
          fail("the square font did not open");
        }
        const mask = rasterizeGlyph(opened.face, 0x41, 8);
        if (mask === null) {
          fail("the square glyph did not rasterize");
        }
        let column = -1;
        let row = -1;
        for (let y = 0; y < mask.height && column < 0; y += 1) {
          for (let x = 0; x < mask.width; x += 1) {
            if (mask.coverage[y * mask.width + x] === 255) {
              column = x;
              row = y;
              break;
            }
          }
        }
        if (column < 0 || row < 0) {
          fail("the square glyph had no ink");
        }
        const sampleX = penX + mask.left + column;
        const sampleY = penY - mask.top + row;
        const size = frameSize();
        if (sampleX < 1 || sampleY < 1 || sampleX >= size.width || sampleY >= size.height) {
          fail("the sample pixel is outside the frame");
        }
        const packed = packKnownScalars([0x41]);
        const bad = new Uint8Array(8);
        bad[0] = 0x41;
        bad[5] = 0xd8;

        /* (1) 坏文件不得分配字体面，也不得留下图元。 */
        await expectRejected(Op.FontFace, bits(0), bits(1), bits(8), Uint8Array.of(0));

        /* (2) 清成黑，再用红盖着墨。第四个参数是不透明度，0 会把红乘没。默认颜色是白，画完必须改回去。 */
        await accel(Op.ClearColor, bits(0), bits(0), bits(0), bits(1));
        await accel(Op.Clear, bits(1), 0n, 0n, 0n);
        await accel(Op.Color, bits(1), bits(0), bits(0), bits(1));
        try {
          stageFontBytes(source);
          const id = await accel(Op.FontFace, bits(0), bits(source.length), bits(8), 0n);
          if (id < 1) {
            fail("FontFace did not return an id");
          }
          stageFontBytes(null);
          await accel(Op.FontSelect, bits(id), bits(penX), bits(penY), 0n);
          stageFontBytes(packed);
          await accel(Op.FontDraw, bits(0), bits(1), 0n, 0n);
          /* 整段里有一个代理项时，这一笔的图元必须一个都不追加。上一笔的方块还在队列里。 */
          await expectRejected(Op.FontDraw, bits(0), bits(2), 0n, bad);
        } finally {
          await accel(Op.Color, bits(1), bits(1), bits(1), bits(1));
        }

        /* (3) 提交后读回。着墨是红，方块外面的原点仍是清除色。 */
        const shown = await present();
        const ink = shown[sampleY * size.width + sampleX];
        const origin = shown[0];
        if (ink === undefined || origin === undefined) {
          fail("the readback missed a pixel");
        }
        if (ink !== 0xff0000) {
          fail(`the ink pixel was ${ink.toString(16)}`);
        }
        if (origin !== 0) {
          fail(`the clear color was ${origin.toString(16)}`);
        }
      }
    }
  }
}
