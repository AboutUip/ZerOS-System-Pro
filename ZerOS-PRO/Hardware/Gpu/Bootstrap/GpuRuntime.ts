/**
 * @module ZerOS.Hardware.Gpu.GpuRuntime
 * @description 显卡帧存储与三条绘图命令
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只在显卡线程里使用。帧存储不进入系统内存，也不写面板。
 * Clear / Plot / Image / Character 失败时一个像素都不改。Present 交出副本。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 帧存储
 *   3. 命令
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as ConfigRoot } from "../Config/GpuConfig";
import { ZerOS as ClockRoot } from "./GpuClock";
import { ZerOS as MemoryRoot } from "./VideoMemory";
import { ZerOS as GlyphRoot } from "../Structure/Glyph";
import { ZerOS as PixelRoot } from "../Structure/Pixel";
import { ZerOS as SceneRoot } from "../Structure/SceneTree";
import { ZerOS as AccelRoot } from "./WebGpuAccel";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Gpu {
      const FrameEdgeMin = ConfigRoot.Hardware.Gpu.Config.FrameEdgeMin;
      const FrameEdgeMax = ConfigRoot.Hardware.Gpu.Config.FrameEdgeMax;
      const FramePixelMaxCount = ConfigRoot.Hardware.Gpu.Config.FramePixelMaxCount;
      const isPixel = PixelRoot.Hardware.Gpu.isPixel;
      const glyphRow = GlyphRoot.Hardware.Gpu.glyphRow;
      const GlyphWidth = GlyphRoot.Hardware.Gpu.GlyphWidth;
      const GlyphHeight = GlyphRoot.Hardware.Gpu.GlyphHeight;
      const spend = ClockRoot.Hardware.Gpu.spend;
      const resizeAccel = AccelRoot.Hardware.Gpu.resize;
      const blitAccel = AccelRoot.Hardware.Gpu.blit;
      const runtimePrefix = "[ZerOS.Hardware.Gpu.GpuRuntime]";

      let frameWidth = 0;
      let frameHeight = 0;
      let frame: Uint32Array = new Uint32Array(0);
      let busy = false;

      function fail(message: string): never {
        throw new Error(`${runtimePrefix} ${message}`);
      }

      function edgeOk(value: number): boolean {
        return Number.isInteger(value) && value >= FrameEdgeMin && value <= FrameEdgeMax;
      }

      /**
       * 按实现声明建立全 0 的帧存储。
       * 尺寸不合法时不替换已经有的帧。
       */
      export function declareFrame(width: number, height: number, memoryBytes: number): void {
        if (!edgeOk(width) || !edgeOk(height)) {
          fail("帧边长不在 1 到 16384");
        }
        const count = width * height;
        if (count > FramePixelMaxCount) {
          fail("帧的像素个数超过 16777216");
        }
        frameWidth = width;
        frameHeight = height;
        frame = MemoryRoot.Hardware.Gpu.declareMemory(memoryBytes, count);
        SceneRoot.Hardware.Gpu.resetScene(width, height);
        resizeAccel(width, height);
      }

      export function videoBytes(): number {
        return MemoryRoot.Hardware.Gpu.memoryBytes();
      }

      export async function readByte(address: number): Promise<number> {
        begin();
        try {
          const value = MemoryRoot.Hardware.Gpu.readByte(address);
          await spend(1);
          return value;
        } finally {
          end();
        }
      }

      export async function writeByte(address: number, value: number): Promise<void> {
        begin();
        try {
          MemoryRoot.Hardware.Gpu.writeByte(address, value);
          await spend(1);
        } finally {
          end();
        }
      }

      export function gpuHertz(): number {
        return ClockRoot.Hardware.Gpu.currentHertz();
      }

      export function gpuExecuted(): number {
        return ClockRoot.Hardware.Gpu.currentExecuted();
      }

      export async function metric(kind: number): Promise<number> {
        begin();
        try {
          if (kind !== 0 && kind !== 1) {
            fail("没有这种显卡指标");
          }
          await spend(1);
          return kind === 0 ? ClockRoot.Hardware.Gpu.currentHertz() : ClockRoot.Hardware.Gpu.currentExecuted();
        } finally {
          end();
        }
      }

      export async function setGpuHertz(value: number): Promise<void> {
        begin();
        try {
          ClockRoot.Hardware.Gpu.setHertz(value);
          await spend(1);
        } finally {
          end();
        }
      }

      export function frameSize(): { readonly width: number; readonly height: number } {
        return { width: frameWidth, height: frameHeight };
      }

      function begin(): void {
        if (frameWidth < 1 || frame.length !== frameWidth * frameHeight) {
          fail("帧存储还没有建立");
        }
        if (busy) {
          fail("上一条绘图命令还没完成");
        }
        busy = true;
      }

      function end(): void {
        busy = false;
      }

      /** 整帧写成同一个像素。非法像素时保持原帧。 */
      export async function clear(pixel: number): Promise<void> {
        begin();
        try {
          if (!isPixel(pixel)) {
            fail("Clear 的像素不是 0 到 16777215 的整数");
          }
          frame.fill(pixel);
          await spend(frame.length);
        } finally {
          end();
        }
      }

      /** 只改一个像素。坐标或像素非法时保持原帧。 */
      export async function plot(x: number, y: number, pixel: number): Promise<void> {
        begin();
        try {
          if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= frameWidth || y >= frameHeight) {
            fail("Plot 的坐标不在帧内");
          }
          if (!isPixel(pixel)) {
            fail("Plot 的像素不是 0 到 16777215 的整数");
          }
          const index = y * frameWidth + x;
          frame[index] = pixel;
          await spend(1);
        } finally {
          end();
        }
      }

      /**
       * 交出当前帧的副本。
       * 加速器若刚画过，先把颜色目标写入帧，再复制。没画过则保留节点树合成的像素。
       * 帧存储仍留在显卡线程，随后的 Clear / Plot / Image / Character 改不到这份副本。
       */
      export async function present(): Promise<Uint32Array> {
        begin();
        try {
          await blitAccel(frame, frameWidth, frameHeight);
          const copy = frame.slice();
          await spend(frame.length);
          return copy;
        } finally {
          end();
        }
      }

      function inside(x: number, y: number, width: number, height: number): boolean {
        if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(width) || !Number.isInteger(height)) {
          return false;
        }
        if (width < 1 || height < 1) {
          return false;
        }
        if (x < 0 || y < 0 || x + width > frameWidth || y + height > frameHeight) {
          return false;
        }
        return true;
      }

      /**
       * 把一块像素矩形写入帧存储。
       * 矩形越界、长度不对或含有非法像素时，一个像素都不写。
       */
      export async function image(x: number, y: number, width: number, height: number, pixels: Uint32Array): Promise<void> {
        begin();
        try {
          if (!inside(x, y, width, height) || pixels.length !== width * height) {
            fail("Image 的矩形不在帧内");
          }
          for (const pixel of pixels) {
            if (!isPixel(pixel)) {
              fail("Image 含有非法像素");
            }
          }
          for (let row = 0; row < height; row += 1) {
            for (let column = 0; column < width; column += 1) {
              const pixel = pixels[row * width + column];
              if (pixel === undefined) {
                fail("Image 含有非法像素");
              }
              frame[(y + row) * frameWidth + (x + column)] = pixel;
            }
          }
          await spend(width * height);
        } finally {
          end();
        }
      }

      /**
       * 把一个字形画成 8×8。
       * 编码不在 0x20 至 0x7E，或方块越出帧时，一个像素都不写。
       * 位 7 是最左像素。1 用前景色，0 用背景色。
       */
      /** 追加填色盒子，返回节点编号。失败时树和帧都不改。 */
      export async function spawnBox(
        parent: number,
        x: number,
        y: number,
        width: number,
        height: number,
        fill: number,
      ): Promise<number> {
        begin();
        try {
          const id = SceneRoot.Hardware.Gpu.spawnBox(parent, x, y, width, height, fill);
          await spend(1);
          return id;
        } finally {
          end();
        }
      }

      /** 追加空文本，返回节点编号。失败时树和帧都不改。 */
      export async function spawnText(parent: number, x: number, y: number, width: number, height: number): Promise<number> {
        begin();
        try {
          const id = SceneRoot.Hardware.Gpu.spawnText(parent, x, y, width, height);
          await spend(1);
          return id;
        } finally {
          end();
        }
      }

      /** 设置文本对齐。 */
      export async function align(node: number, alignX: number, alignY: number): Promise<void> {
        begin();
        try {
          SceneRoot.Hardware.Gpu.alignNode(node, alignX, alignY);
          await spend(1);
        } finally {
          end();
        }
      }

      /** 给文本或盒子涂两个像素。盒子采用背景色作为填色。 */
      export async function paint(node: number, foreground: number, background: number): Promise<void> {
        begin();
        try {
          SceneRoot.Hardware.Gpu.paintNode(node, foreground, background);
          await spend(1);
        } finally {
          end();
        }
      }

      /** 给文本追加一个字形。 */
      export async function glyph(node: number, code: number): Promise<void> {
        begin();
        try {
          SceneRoot.Hardware.Gpu.glyphNode(node, code);
          await spend(1);
        } finally {
          end();
        }
      }

      /** 摘掉节点及其后代。根不能摘。 */
      export async function drop(node: number): Promise<void> {
        begin();
        try {
          SceneRoot.Hardware.Gpu.dropNode(node);
          await spend(1);
        } finally {
          end();
        }
      }

      /**
       * 用整棵树替换帧存储。
       * 先画到新缓冲，成功后一次换上。树保持不变。没盖住的像素是 0。
       */
      export async function compose(): Promise<void> {
        begin();
        try {
          const raster = SceneRoot.Hardware.Gpu.rasterScene();
          if (raster.length !== frame.length) {
            fail("合成结果和帧的字数不一致");
          }
          frame.set(raster);
          await spend(frame.length);
        } finally {
          end();
        }
      }

      export async function character(
        x: number,
        y: number,
        code: number,
        foreground: number,
        background: number,
      ): Promise<void> {
        begin();
        try {
          if (!inside(x, y, GlyphWidth, GlyphHeight)) {
            fail("Character 的字形越出帧");
          }
          if (!isPixel(foreground) || !isPixel(background)) {
            fail("Character 的颜色不是像素整数");
          }
          const rows: number[] = [];
          for (let row = 0; row < GlyphHeight; row += 1) {
            const bits = glyphRow(code, row);
            if (bits === null) {
              fail("Character 的编码不在 0x20 到 0x7E");
            }
            rows.push(bits);
          }
          for (let row = 0; row < GlyphHeight; row += 1) {
            const bits = rows[row];
            if (bits === undefined) {
              fail("Character 的编码不在 0x20 到 0x7E");
            }
            for (let column = 0; column < GlyphWidth; column += 1) {
              const ink = (bits & (1 << (7 - column))) !== 0;
              frame[(y + row) * frameWidth + (x + column)] = ink ? foreground : background;
            }
          }
          await spend(GlyphWidth * GlyphHeight);
        } finally {
          end();
        }
      }
    }
  }
}
