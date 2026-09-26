/**
 * @module ZerOS.Hardware.Display.DisplayDevice
 * @description 官方显示器。页面线程持有画布和帧缓冲。
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 分辨率、刷新率和帧缓冲都在这条页面线程上。呈现直接画到画布。
         * 节拍按绝对时间轴：第 n 拍到期于起点 + n × 1000 / Hertz。错过的拍丢掉。
         * 帧缓冲没有新内容时，这一拍只推进时间轴，不再把同一幅拆进画布。
         * 不创建 Worker。内存和主板在各自的线程里，不会堵住这里的计时。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 设备字段
 *   3. 协议字段与设置
 *   4. 呈现与时间轴
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as ConfigRoot } from "../Config/DisplayConfig";
import { ZerOS as HertzRoot } from "../Structure/Hertz";
import { ZerOS as ResolutionRoot } from "../Structure/Resolution";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Display {
      const DefaultWidth = ConfigRoot.Hardware.Display.Config.DefaultWidth;
      const DefaultHeight = ConfigRoot.Hardware.Display.Config.DefaultHeight;
      const DefaultHertz = ConfigRoot.Hardware.Display.Config.DefaultHertz;
      const isHertz = HertzRoot.Hardware.Display.isHertz;
      const isResolution = ResolutionRoot.Hardware.Display.isResolution;

      const displayPrefix = "[ZerOS.Hardware.Display.Display]";

      /**
       * 一块已接上画布的显示器。
       * Attach 之前只有逻辑分辨率和帧缓冲。接上之后画布栅格与时间轴一起生效。
       */
      export class DisplayDevice {
        /** 当前宽度。非法设置不会改它。 */
        private width = DefaultWidth;

        /** 当前高度。 */
        private height = DefaultHeight;

        /** 当前刷新率。 */
        private hertz = DefaultHertz;

        /** 按像素存放的帧缓冲。下标 0 是左上角。 */
        private framebuffer = new Uint32Array(DefaultWidth * DefaultHeight);

        /** 唯一面板。 */
        private canvas: HTMLCanvasElement | null = null;

        /** 页面线程上的二维上下文。封印宿主之后仍然使用这一份。 */
        private context: CanvasRenderingContext2D | null = null;

        /** 时间轴起点，单位毫秒。 */
        private origin = 0;

        /** 下一拍序号。第 n 拍的到期时刻是起点加上 n × 1000 / Hertz。 */
        private nextIndex = 1;

        /** 已经排好的下一次宿主定时。改刷新率时先清掉。 */
        private timer: number | null = null;

        /** 复用的画布位图。分辨率变了就丢掉，避免每一拍都重新分配。 */
        private image: ImageData | null = null;

        /** 当前帧缓冲已经画到画布上。节拍到期时不必再拆一遍同一幅。 */
        private shown = false;

        /** 当前宽度。 */
        public get Width(): number {
          return this.width;
        }

        /** 当前高度。 */
        public get Height(): number {
          return this.height;
        }

        /** 当前刷新率。 */
        public get Hertz(): number {
          return this.hertz;
        }

        /** 当前帧缓冲。调用方写入的非法像素会让下一次呈现拒绝整幅。 */
        public get Framebuffer(): Uint32Array {
          return this.framebuffer;
        }

        /**
         * 把面板接到这块显示器上。
         * 同一块画布重复接上时保持帧缓冲。另一块画布则拒绝。
         */
        public Attach(canvas: HTMLCanvasElement): void {
          if (this.canvas === canvas) {
            return;
          }
          if (this.canvas !== null) {
            throw new Error(`${displayPrefix} 显示器已经接上另一块画布`);
          }
          const context = canvas.getContext("2d", { alpha: false });
          if (context === null) {
            throw new Error(`${displayPrefix} 画布没有二维上下文`);
          }
          this.canvas = canvas;
          this.context = context;
          this.applyCanvasSize();
          this.Redraw();
          this.resetTimeline();
        }

        /**
         * 提交新分辨率并换成全 0 的新帧缓冲。
         * 参数非法时宽度、高度和帧缓冲都保持原样。
         */
        public SetResolution(width: number, height: number): void {
          if (!isResolution(width, height)) {
            throw new Error(`${displayPrefix} 分辨率超出协议范围`);
          }
          this.width = width;
          this.height = height;
          this.framebuffer = new Uint32Array(width * height);
          if (this.context !== null) {
            this.applyCanvasSize();
            this.Redraw();
          }
        }

        /**
         * 提交新的刷新率。不改帧缓冲。
         * 已经接上面板时，时间轴从现在重算，下一拍使用新的间隔。
         */
        public SetHertz(hertz: number): void {
          if (!isHertz(hertz)) {
            throw new Error(`${displayPrefix} 刷新率超出协议范围`);
          }
          this.hertz = hertz;
          if (this.context !== null) {
            this.resetTimeline();
          }
        }

        /**
         * 把帧缓冲整幅画到面板上。
         * 先检查全部像素，通过之后才写入画布，因此非法像素不会留下半幅。
         */
        public Redraw(): void {
          if (this.context === null) {
            throw new Error(`${displayPrefix} 面板还没有接上`);
          }
          this.paint();
        }

        /** 让画布栅格等于当前分辨率。改属性会清掉旧位图，随后由 Redraw 重画。 */
        private applyCanvasSize(): void {
          const canvas = this.canvas;
          if (canvas === null) {
            return;
          }
          canvas.width = this.width;
          canvas.height = this.height;
        }

        /**
         * 拆开每个像素再写入画布。
         * 任一像素不合法就在 putImageData 之前抛出，画布保持上一幅。
         * 不按宿主字节序整块拷贝。透明通道固定为 255，它不是协议像素的一部分。
         * 位图对象按分辨率复用。检查和拆开放在同一趟，避免每一帧先走一遍再走一遍。
         */
        private paint(): void {
          const context = this.context;
          if (context === null) {
            throw new Error(`${displayPrefix} 面板还没有接上`);
          }
          const source = this.framebuffer;
          let image = this.image;
          if (image === null) {
            image = context.createImageData(this.width, this.height);
            this.image = image;
          } else if (image.width !== this.width || image.height !== this.height) {
            image = context.createImageData(this.width, this.height);
            this.image = image;
          }
          const data = image.data;
          const length = source.length;
          const pixelMax = ConfigRoot.Hardware.Display.Config.PixelMax;
          for (let index = 0; index < length; index += 1) {
            const pixel = source[index];
            if (pixel === undefined || !Number.isInteger(pixel) || pixel < 0 || pixel > pixelMax) {
              throw new Error(`${displayPrefix} 帧缓冲含有非法像素，本次不呈现`);
            }
            const offset = index * 4;
            data[offset] = (pixel >> 16) & 255;
            data[offset + 1] = (pixel >> 8) & 255;
            data[offset + 2] = pixel & 255;
            data[offset + 3] = 255;
          }
          context.putImageData(image, 0, 0);
          this.shown = true;
        }

        /** 从现在起重新数拍。已经排好的定时作废。 */
        private resetTimeline(): void {
          this.origin = performance.now();
          this.nextIndex = 1;
          this.arm();
        }

        /**
         * 排到下一拍的绝对到期时刻。
         * 宿主定时的毫秒取整可能提前醒来，醒来后若还没到期就再排一次，误差不累加到后面的拍。
         */
        private arm(): void {
          if (this.timer !== null) {
            window.clearTimeout(this.timer);
            this.timer = null;
          }
          const delay = this.origin + (this.nextIndex * 1000) / this.hertz - performance.now();
          const wait = delay > 0 ? delay : 0;
          this.timer = window.setTimeout((): void => {
            this.onTick();
          }, wait);
        }

        /**
         * 到期则呈现一次，并跳过已经错过的序号。
         * 这一幅已经在画布上时，只推进节拍，不再拆像素。
         * 这一拍的像素不合法时，面板保持上一幅，时间轴继续。
         */
        private onTick(): void {
          this.timer = null;
          const now = performance.now();
          const deadline = this.origin + (this.nextIndex * 1000) / this.hertz;
          if (now + 0.25 < deadline) {
            this.arm();
            return;
          }
          let guard = 0;
          while (guard < 100000) {
            const ahead = this.origin + ((this.nextIndex + 1) * 1000) / this.hertz;
            if (now + 0.25 < ahead) {
              break;
            }
            this.nextIndex += 1;
            guard += 1;
          }
          this.nextIndex += 1;
          if (!this.shown) {
            try {
              this.paint();
            } catch {
              /* 这一拍的帧不合法时不呈现，面板保持上一幅。 */
            }
          }
          this.arm();
        }
      }

      /** 这一页上的那一块显示器。 */
      export const displayDevice = new DisplayDevice();
    }
  }
}
