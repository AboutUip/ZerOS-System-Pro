/**
 * @module ZerOS.Hardware.Gpu.GpuSelfCheck
 * @description 显卡坐上之后的自检
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 核对 Clear、Plot、副本隔离，以及 Image 与 Character。
 * 不把帧送到页面。页面上的那一次 Present 由主板在显示器自检之后另发。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. runGpuSelfCheck
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as RuntimeRoot } from "../Bootstrap/GpuRuntime";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Gpu {
      const frameSize = RuntimeRoot.Hardware.Gpu.frameSize;
      const clear = RuntimeRoot.Hardware.Gpu.clear;
      const plot = RuntimeRoot.Hardware.Gpu.plot;
      const image = RuntimeRoot.Hardware.Gpu.image;
      const character = RuntimeRoot.Hardware.Gpu.character;
      const present = RuntimeRoot.Hardware.Gpu.present;
      const readByte = RuntimeRoot.Hardware.Gpu.readByte;
      const writeByte = RuntimeRoot.Hardware.Gpu.writeByte;
      const setGpuHertz = RuntimeRoot.Hardware.Gpu.setGpuHertz;
      const gpuHertz = RuntimeRoot.Hardware.Gpu.gpuHertz;
      const videoBytes = RuntimeRoot.Hardware.Gpu.videoBytes;
      const spawnBox = RuntimeRoot.Hardware.Gpu.spawnBox;
      const spawnText = RuntimeRoot.Hardware.Gpu.spawnText;
      const align = RuntimeRoot.Hardware.Gpu.align;
      const paint = RuntimeRoot.Hardware.Gpu.paint;
      const glyph = RuntimeRoot.Hardware.Gpu.glyph;
      const drop = RuntimeRoot.Hardware.Gpu.drop;
      const compose = RuntimeRoot.Hardware.Gpu.compose;
      const checkPrefix = "[ZerOS.Hardware.Gpu.GpuSelfCheck]";

      function fail(message: string): never {
        throw new Error(`${checkPrefix} ${message}`);
      }

      /**
       * 帧存储已经按声明建立之后调用。
       * 先核对 Plot 与副本隔离，再留下一块 2×2 图像和字符 A。
       */
      export async function runGpuSelfCheck(): Promise<void> {
        const size = frameSize();
        if (size.width < 16 || size.height < 8) {
          fail("自检需要至少 16×8 的帧");
        }
        const frameBytes = size.width * size.height * 4;
        if (videoBytes() < frameBytes + 1) {
          fail("显存没有比帧多出的字节");
        }
        await clear(0x112233);
        if (await readByte(0) !== 0x33) {
          fail("帧的最低字节没有按小端落在显存地址 0");
        }
        await plot(1, 2, 0x445566);
        const copy = await present();
        const plottedIndex = 2 * size.width + 1;
        if (copy[plottedIndex] !== 0x445566 || copy[0] !== 0x112233) {
          fail("Present 副本和帧存储不一致");
        }
        await clear(0x101010);
        await image(0, 0, 2, 2, Uint32Array.of(0xff0000, 0x00ff00, 0x0000ff, 0xffffff));
        await character(8, 0, 0x41, 0xffffff, 0x000000);
        const shown = await present();
        if (shown[0] !== 0xff0000 || shown[1] !== 0x00ff00 || shown[size.width] !== 0x0000ff) {
          fail("Image 没有按矩形写入");
        }
        if (shown[8] !== 0x000000 || shown[10] !== 0xffffff) {
          fail("Character 没有按字形的最左位画出 A");
        }
        await writeByte(frameBytes, 0x5a);
        if (await readByte(frameBytes) !== 0x5a) {
          fail("帧后面的显存字节没有留下");
        }
        const kept = gpuHertz();
        try {
          await setGpuHertz(0);
          fail("非法频率没有被拒绝");
        } catch (error: unknown) {
          if (!(error instanceof Error) || !error.message.includes("不在 1 到")) {
            throw error;
          }
        }
        if (gpuHertz() !== kept) {
          fail("非法 Hz 改写了已记下的频率");
        }
        const box = await spawnBox(0, 0, 0, size.width, size.height, 0x0a1628);
        const text = await spawnText(box, 0, 0, size.width, size.height);
        await align(text, 1, 1);
        await paint(text, 0xffffff, 0x0a1628);
        await glyph(text, 0x42);
        await compose();
        const laid = await present();
        const glyphX = Math.trunc((size.width - 8) / 2);
        const glyphY = Math.trunc((size.height - 8) / 2);
        const origin = laid[glyphY * size.width + glyphX];
        const ink = laid[glyphY * size.width + glyphX + 1];
        if (origin !== 0x0a1628 || ink !== 0xffffff) {
          fail("文本没有在矩形里居中");
        }
        await drop(box);
      }
    }
  }
}
