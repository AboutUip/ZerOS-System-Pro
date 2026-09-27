/**
 * @module ZerOS.Hardware.Display.SplashDots
 * @description 启动画面六个点的换色
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只在页面线程使用。logo 已经把 Starting 和六个点画进帧缓冲。
 * 固件循环的快慢跟着另一颗核心的读盘走，不能拿它当节拍。
 * 这里按墙上的毫秒决定哪一颗是红的。新的一帧若不再是这幅 logo，换色停止。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 识别与着色
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Display {
      /**
       * 两颗点之间的像素。
       * 与 Logo.obr 里字号 48 的 advance 相同：字号除以 2 再加 1。
       */
      const DotStep = 25;

      /** 一颗点保持这么多毫秒，六颗一轮。错过的节拍不补画。 */
      export const SplashStepMs = 180;

      /** 红点至少要有这么多像素，避免把自检里的单个红点认成启动画面。 */
      const RedInkMin = 8;

      /** 旁边五颗里，至少这么多颗在同一偏移上仍有墨，才认定是那六个点。 */
      const NeighborMin = 4;

      /** logo 上六个点的墨，以及这一轮从什么时刻开始数。 */
      export interface SplashDots {
        readonly width: number;
        readonly ink: readonly (readonly number[])[];
        readonly base: Uint32Array;
        origin: number;
        shownPhase: number;
      }

      function failShift(index: number, width: number, dx: number): number {
        const x = index % width;
        const y = Math.trunc(index / width);
        const next = x + dx;
        if (next < 0 || next >= width) {
          return -1;
        }
        return y * width + next;
      }

      function isRed(pixel: number): boolean {
        const red = (pixel >> 16) & 255;
        const green = (pixel >> 8) & 255;
        const blue = pixel & 255;
        return red > 200 && green < 48 && blue < 48;
      }

      /**
       * 从第一颗红点推出另外五颗。
       * 对不上时返回空，调用方就按普通帧画，不在这幅上换色。
       */
      export function captureSplash(pixels: Uint32Array, width: number, height: number): SplashDots | null {
        if (pixels.length !== width * height || width < DotStep * 6) {
          return null;
        }
        const red: number[] = [];
        const count = pixels.length;
        for (let index = 0; index < count; index += 1) {
          const pixel = pixels[index];
          if (pixel !== undefined && isRed(pixel)) {
            red.push(index);
          }
        }
        if (red.length < RedInkMin) {
          return null;
        }
        let neighbors = 0;
        for (let dot = 1; dot < 6; dot += 1) {
          const dx = dot * DotStep;
          let ink = 0;
          for (const index of red) {
            const shifted = failShift(index, width, dx);
            if (shifted >= 0 && pixels[shifted] !== 0) {
              ink += 1;
            }
          }
          if (ink >= RedInkMin) {
            neighbors += 1;
          }
        }
        if (neighbors < NeighborMin) {
          return null;
        }
        const ink: number[][] = [[], [], [], [], [], []];
        for (const index of red) {
          const first = ink[0];
          if (first !== undefined) {
            first.push(index);
          }
          for (let dot = 1; dot < 6; dot += 1) {
            const shifted = failShift(index, width, dot * DotStep);
            const slot = ink[dot];
            if (shifted >= 0 && slot !== undefined) {
              slot.push(shifted);
            }
          }
        }
        return {
          width,
          ink,
          base: pixels.slice(),
          origin: performance.now(),
          shownPhase: -1,
        };
      }

      /** 新来的一帧是否仍是记下的那幅 logo。有一处不同就不再换色。 */
      export function sameSplash(splash: SplashDots, pixels: Uint32Array): boolean {
        const base = splash.base;
        if (base.length !== pixels.length) {
          return false;
        }
        const count = base.length;
        for (let index = 0; index < count; index += 1) {
          if (base[index] !== pixels[index]) {
            return false;
          }
        }
        return true;
      }

      /** 从记下的起点算，现在该亮第几颗。范围是 0 到 5。 */
      export function splashPhase(splash: SplashDots, now: number): number {
        const elapsed = now - splash.origin;
        if (elapsed <= 0) {
          return 0;
        }
        const step = Math.floor(elapsed / SplashStepMs);
        return step % 6;
      }

      /**
       * 用 logo 原帧盖上当前这一颗红、其余白。
       * 不改调用方的帧缓冲，返回的是给画布用的一份。
       */
      export function composeSplash(splash: SplashDots, phase: number): Uint32Array {
        const frame = splash.base.slice();
        const dots = splash.ink;
        for (let dot = 0; dot < dots.length; dot += 1) {
          const color = dot === phase ? 0xff0000 : 0xffffff;
          const marks = dots[dot];
          if (marks === undefined) {
            continue;
          }
          for (const index of marks) {
            frame[index] = color;
          }
        }
        return frame;
      }
    }
  }
}
