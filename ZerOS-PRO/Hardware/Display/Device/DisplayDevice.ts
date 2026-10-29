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
 * 启动画面的六个点例外：它们按墙上的毫秒换色，不看固件循环快慢，也不看读盘。
 * 四块方标和拖影也在这一侧转。固件停笔之后，最后一帧不会把圆圈冻住。
 * 启动画面之后的画面是显卡交来的位图，直接贴上画布，不再把帧缓冲拆进画布。
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
import { ZerOS as SplashRoot } from "./SplashDots";
import { ZerOS as RingRoot } from "./SplashRing";
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
      const captureSplash = SplashRoot.Hardware.Display.captureSplash;
      const sameSplash = SplashRoot.Hardware.Display.sameSplash;
      const splashPhase = SplashRoot.Hardware.Display.splashPhase;
      const composeSplash = SplashRoot.Hardware.Display.composeSplash;
      const loadingMark = RingRoot.Hardware.Display.loadingMark;
      const looksLikeLoading = RingRoot.Hardware.Display.looksLikeLoading;
      const paintLoading = RingRoot.Hardware.Display.paintLoading;
      type SplashDots = SplashRoot.Hardware.Display.SplashDots;

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

        /** 启动画面还在。新的一帧不再是这幅 logo 时清掉。 */
        private splash: SplashDots | null = null;

        /**
         * 启动画面已经结束。
         * 之后不再整幅扫描帧缓冲去认 logo。位图贴上画布时也置上，免得节拍再用旧帧盖住画面。
         */
        private splashDone = false;

        /** 加载圆圈由页面按 40 毫秒一拍自己转。固件不再送来新相位时也不停。 */
        private loading = false;

        /** 拖影头部。0 到 23，和固件那一圈相同。 */
        private loadingPhase = 0;

        /** 圆圈的下一拍。和刷新率那条时间轴分开，免得节拍被 shown 吃掉。 */
        private loadingTimer: number | null = null;

        /** 这一轮拖影从哪一毫秒开始。相位按墙上的时间算，迟到的回调不会停在第一拍。 */
        private loadingOrigin = 0;

        /** 已经见过方标，并且后来的整幅不再是方标。此后不再抽样，BIOS 和终端不付读回的代价。 */
        private sawLoading = false;

        /** 方标已经交接给终端或设置画面。 */
        private settled = false;

        /** 抽样画布的上下文。按频繁读回创建，读到的是刚画上的那一格。画布由这个上下文留着。 */
        private eyeContext: CanvasRenderingContext2D | null = null;

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
          /* 主画布不按频繁读回创建。那样每一帧都会走软件位图，BIOS 每 16 毫秒整幅重画就会卡住。 */
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

        /**
         * 把显卡交来的位图贴上面板。
         * 尺寸必须已经和面板一致。贴上之后这一幅算画过，节拍不再用帧缓冲盖住它。
         * 启动画面如果还在换色，到这里停止：这一张已经是下一幅画面。
         */
        public ShowBitmap(bitmap: ImageBitmap): void {
          const context = this.context;
          if (context === null) {
            bitmap.close();
            throw new Error(`${displayPrefix} 面板还没有接上`);
          }
          if (bitmap.width !== this.width || bitmap.height !== this.height) {
            bitmap.close();
            throw new Error(`${displayPrefix} 位图尺寸和面板不一致`);
          }
          /* 先在小画布上认方标，再贴主画布。主画布不读回，设置界面才不会被读像素拖死。 */
          let hold = false;
          if (!this.settled) {
            try {
              hold = this.bitmapLooksLoading(bitmap);
            } catch {
              hold = false;
            }
          }
          try {
            context.drawImage(bitmap, 0, 0);
          } finally {
            bitmap.close();
          }
          this.splash = null;
          this.splashDone = true;
          this.shown = true;
          if (this.settled) {
            return;
          }
          /* 整幅仍是四块方标就立刻盖上自己的拖影。固件这帧的相位经常是停住的。 */
          if (hold) {
            this.sawLoading = true;
            this.holdLoading();
            return;
          }
          if (this.sawLoading) {
            this.settled = true;
          }
          this.stopLoading();
        }

        /**
         * 把一小块位图贴进已经画过的面板。
         * 按键和一行输出只改这条带。整帧再读回来，每个键都要等一两百毫秒。
         * 这块超出面板就整块丢掉，不留下半条。
         */
        public ShowPatch(originX: number, originY: number, bitmap: ImageBitmap): void {
          const context = this.context;
          if (context === null) {
            bitmap.close();
            throw new Error(`${displayPrefix} 面板还没有接上`);
          }
          /* 圆圈还在转时，画面中部的拖影补丁会把圆圈冻住。终端的字在顶上，那一块要留下并停转。 */
          if (this.loading && originY >= 80 && bitmap.height < 160) {
            bitmap.close();
            return;
          }
          if (this.loading) {
            this.stopLoading();
          }
          if (
            !Number.isInteger(originX)
            || !Number.isInteger(originY)
            || originX < 0
            || originY < 0
            || bitmap.width < 1
            || bitmap.height < 1
            || originX + bitmap.width > this.width
            || originY + bitmap.height > this.height
          ) {
            bitmap.close();
            throw new Error(`${displayPrefix} 位图超出面板`);
          }
          try {
            context.drawImage(bitmap, originX, originY);
          } finally {
            bitmap.close();
          }
          this.splash = null;
          this.splashDone = true;
          this.shown = true;
        }

        /** 让画布栅格等于当前分辨率。改属性会清掉旧位图，随后由 Redraw 重画。 */
        private applyCanvasSize(): void {
          const canvas = this.canvas;
          if (canvas === null) {
            return;
          }
          this.stopLoading();
          canvas.width = this.width;
          canvas.height = this.height;
        }

        /** 抽样画布只建一次。8×8 足够看一格，不把整幅位图拆进主画布再读。 */
        private prepareEye(): CanvasRenderingContext2D | null {
          if (this.eyeContext !== null) {
            return this.eyeContext;
          }
          const canvas = document.createElement("canvas");
          canvas.width = 8;
          canvas.height = 8;
          const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
          if (context === null) {
            return null;
          }
          this.eyeContext = context;
          return context;
        }

        /**
         * 从还没关闭的位图上取一格。
         * 主画布贴完再读，经常还是上一幅，而且会把设置界面拖进软件读回。
         */
        private sampleBitmap(bitmap: ImageBitmap, x: number, y: number): Uint8ClampedArray | null {
          if (x < 2 || y < 2 || x + 2 >= bitmap.width || y + 2 >= bitmap.height) {
            return null;
          }
          const context = this.prepareEye();
          if (context === null) {
            return null;
          }
          context.imageSmoothingEnabled = false;
          context.drawImage(bitmap, x - 2, y - 2, 8, 8, 0, 0, 8, 8);
          return context.getImageData(2, 2, 1, 1).data;
        }

        /** 左上角近黑、方标那一格是蓝，才算加载画面。认的是这一张位图，不是已经贴上的主画布。 */
        private bitmapLooksLoading(bitmap: ImageBitmap): boolean {
          if (bitmap.width < 80 || bitmap.height < 200) {
            return false;
          }
          const corner = this.sampleBitmap(bitmap, 2, 2);
          if (corner === null) {
            return false;
          }
          const mark = loadingMark(bitmap.width, bitmap.height);
          const shifts = [0, 8, 16];
          for (const shift of shifts) {
            const logo = this.sampleBitmap(bitmap, mark.x, mark.y + shift);
            if (logo !== null && looksLikeLoading(corner, logo)) {
              return true;
            }
          }
          return false;
        }

        /** 从现在起由页面转拖影。已经在转就按墙上的时间盖当前这一拍，不把起点拨回现在。 */
        private holdLoading(): void {
          const context = this.context;
          if (context === null) {
            return;
          }
          if (!this.loading) {
            this.loading = true;
            this.loadingOrigin = performance.now();
            this.armLoading();
          }
          this.paintLoadingNow(context);
        }

        /** 相位是走过的毫秒除以 40，再绕 24 拍。回调晚了也会跳到该在的位置。 */
        private paintLoadingNow(context: CanvasRenderingContext2D): void {
          const elapsed = performance.now() - this.loadingOrigin;
          const steps = Math.floor(elapsed / 40);
          this.loadingPhase = ((steps % 24) + 24) % 24;
          paintLoading(context, this.width, this.height, this.loadingPhase);
        }

        /** 终端或别的画面来了。停掉拖影，调用方已经把那一帧贴上。 */
        private stopLoading(): void {
          this.loading = false;
          if (this.loadingTimer !== null) {
            window.clearTimeout(this.loadingTimer);
            this.loadingTimer = null;
          }
        }

        /**
         * 40 毫秒一拍，和固件原来的 dwell 一样。
         * 已经排着就不动。固件若连着送同一帧，不能把这一拍一次次推后，否则圆圈永远停在开头。
         */
        private armLoading(): void {
          if (this.loadingTimer !== null) {
            return;
          }
          this.loadingTimer = window.setTimeout((): void => {
            this.loadingTimer = null;
            if (!this.loading) {
              return;
            }
            const context = this.context;
            if (context === null) {
              this.loading = false;
              return;
            }
            this.paintLoadingNow(context);
            this.armLoading();
          }, 40);
        }

        /**
         * 新的一帧来了才调用。
         * 仍是同一幅 logo 就继续换色。换成别的画面，包括全黑，换色停止。
         */
        private observeSplash(): void {
          if (this.splashDone) {
            return;
          }
          const current = this.splash;
          const source = this.framebuffer;
          if (current !== null) {
            if (!sameSplash(current, source)) {
              this.splash = null;
              this.splashDone = true;
            }
            return;
          }
          this.splash = captureSplash(source, this.width, this.height);
        }

        /** 把一份像素拆进画布。来源可以是帧缓冲，也可以是换过色的 logo。 */
        private paintPixels(source: Uint32Array): void {
          const context = this.context;
          if (context === null) {
            throw new Error(`${displayPrefix} 面板还没有接上`);
          }
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

        /**
         * 拆开每个像素再写入画布。
         * 任一像素不合法就在 putImageData 之前抛出，画布保持上一幅。
         * 不按宿主字节序整块拷贝。透明通道固定为 255，它不是协议像素的一部分。
         * 位图对象按分辨率复用。检查和拆开放在同一趟，避免每一帧先走一遍再走一遍。
         * 启动画面在换色期间不把原帧直接送上画布，红点按当前节拍盖上去。
         */
        private paint(): void {
          this.observeSplash();
          const splash = this.splash;
          if (splash !== null) {
            const phase = splashPhase(splash, performance.now());
            this.paintPixels(composeSplash(splash, phase));
            splash.shownPhase = phase;
            return;
          }
          this.paintPixels(this.framebuffer);
          /* 像素路径送来的方标同样接上拖影。换成别的画面就停，免得圆圈盖住终端。 */
          if (this.bufferLooksLoading()) {
            this.holdLoading();
          } else if (this.loading) {
            this.stopLoading();
          }
        }

        /** 帧缓冲里方标那一格是蓝、角上是黑。终端纸色和停机蓝对不上。 */
        private bufferLooksLoading(): boolean {
          const width = this.width;
          const height = this.height;
          const pixels = this.framebuffer;
          if (width < 80 || height < 200 || pixels.length < width * height) {
            return false;
          }
          const corner = pixels[2 * width + 2] ?? 0;
          const cornerBytes = Uint8ClampedArray.of((corner >> 16) & 255, (corner >> 8) & 255, corner & 255, 255);
          const mark = loadingMark(width, height);
          const shifts = [0, 8, 16];
          for (const shift of shifts) {
            const y = mark.y + shift;
            if (y < 0 || y >= height || mark.x < 0 || mark.x >= width) {
              continue;
            }
            const pixel = pixels[y * width + mark.x] ?? 0;
            const logo = Uint8ClampedArray.of((pixel >> 16) & 255, (pixel >> 8) & 255, pixel & 255, 255);
            if (looksLikeLoading(cornerBytes, logo)) {
              return true;
            }
          }
          return false;
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
          const splash = this.splash;
          if (splash !== null) {
            const phase = splashPhase(splash, now);
            if (phase !== splash.shownPhase) {
              try {
                this.paintPixels(composeSplash(splash, phase));
                splash.shownPhase = phase;
              } catch {
                /* 这一拍的帧不合法时不呈现，面板保持上一幅。 */
              }
            }
          } else if (!this.shown) {
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
