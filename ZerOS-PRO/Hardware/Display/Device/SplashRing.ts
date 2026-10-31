/**
 * @module ZerOS.Hardware.Display.SplashRing
 * @description 加载画面的四块方标和拖影
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只在页面线程使用。固件画出这幅之后，字体映射会占住同一条宿主线程，
 * 圆圈的相位就不再往前走，最后一帧会一直停着。
 * 这里按墙上的毫秒自己转。几何和 Boot/Splash.obr 的 loading 一致。
 * 认画面只看左上角是不是黑的、方标那一格是不是蓝的。停机蓝整幅都是蓝，不会被认成这一幅。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 几何
 *   2. 绘制
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Display {
      /** 方标边长。和固件 panes 里的 26 相同。 */
      const Mark = 26;

      /** 两块方标左缘的距离。边长 26，中间留 8。 */
      const Jump = 34;

      /** 方标组的外包宽度。 */
      const Block = 60;

      /** 方标下沿到拖影圆心的空隙，再加上半径和笔触。整组高度是 176。 */
      const Total = 176;

      /** 拖影一圈 24 步。和固件 orbit 的位移相同。 */
      const Orbit: readonly (readonly [number, number])[] = [
        [14, 0],
        [14, 4],
        [12, 7],
        [10, 10],
        [7, 12],
        [4, 14],
        [0, 14],
        [-4, 14],
        [-7, 12],
        [-10, 10],
        [-12, 7],
        [-14, 4],
        [-14, 0],
        [-14, -4],
        [-12, -7],
        [-10, -10],
        [-7, -12],
        [-4, -14],
        [0, -14],
        [4, -14],
        [7, -12],
        [10, -10],
        [12, -7],
        [14, -4],
      ];

      /** 方标内部的一格。用来判断这一帧是不是加载画面。 */
      export function loadingMark(width: number, height: number): { readonly x: number; readonly y: number } {
        const top = Math.trunc((height - Total) / 2);
        const left = Math.trunc((width - Block) / 2);
        return { x: left + 8, y: top + 8 };
      }

      /**
       * 左上角近黑，方标那一格是蓝。
       * 终端纸色是 30,30,30，停机画面整幅是蓝，这两处都对不上。
       */
      export function looksLikeLoading(
        corner: Uint8ClampedArray,
        mark: Uint8ClampedArray,
      ): boolean {
        const cornerRed = corner[0] ?? 255;
        const cornerGreen = corner[1] ?? 255;
        const cornerBlue = corner[2] ?? 255;
        if (cornerRed > 12 || cornerGreen > 12 || cornerBlue > 12) {
          return false;
        }
        const red = mark[0] ?? 0;
        const green = mark[1] ?? 0;
        const blue = mark[2] ?? 0;
        /* 淡入时方标还不到 120。白字和灰纸蓝不压过绿，对不上。 */
        return blue > 40 && blue > red + 15 && green > 15 && blue >= green;
      }

      /**
       * 盖掉整幅：黑底、四块圆角蓝标、一段白色拖影。
       * phase 是拖影头部，0 到 23。靠近头的几颗不透明，后面收成拖影。
       */
      export function paintLoading(
        context: CanvasRenderingContext2D,
        width: number,
        height: number,
        phase: number,
      ): void {
        const top = Math.trunc((height - Total) / 2);
        const left = Math.trunc((width - Block) / 2);
        context.save();
        context.globalAlpha = 1;
        context.fillStyle = "#000000";
        context.fillRect(0, 0, width, height);
        context.fillStyle = "rgb(0, 120, 212)";
        fillRound(context, left, top, Mark);
        fillRound(context, left + Jump, top, Mark);
        fillRound(context, left, top + Jump, Mark);
        fillRound(context, left + Jump, top + Jump, Mark);
        const centerX = Math.trunc(width / 2);
        const centerY = top + Block + 80 + 14 + 4;
        const head = ((phase % 24) + 24) % 24;
        context.fillStyle = "rgb(236, 242, 248)";
        for (let step = 9; step >= 0; step -= 1) {
          let slot = head - step;
          if (slot < 0) {
            slot += 24;
          }
          const point = Orbit[slot];
          if (point === undefined) {
            continue;
          }
          const alpha = step > 2 ? 1 - (step - 2) / 7 : 1;
          if (alpha <= 0) {
            continue;
          }
          context.globalAlpha = alpha;
          context.beginPath();
          context.ellipse(centerX + point[0], centerY + point[1], 4, 4, 0, 0, Math.PI * 2);
          context.fill();
        }
        context.restore();
      }

      /** 圆角 3。没有 roundRect 时退成方角，拖影仍按节拍转。 */
      function fillRound(context: CanvasRenderingContext2D, x: number, y: number, size: number): void {
        context.beginPath();
        if (typeof context.roundRect === "function") {
          context.roundRect(x, y, size, size, 3);
        } else {
          context.rect(x, y, size, size);
        }
        context.fill();
      }
    }
  }
}
