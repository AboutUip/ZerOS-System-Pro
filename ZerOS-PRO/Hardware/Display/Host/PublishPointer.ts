/**
 * @file PublishPointer.ts
 * @desc 因为浏览器的存在，迫不得已做出的让步。
 *       鼠标事件只出现在持有文档的那条线程上，显示器是唯一持有文档的虚拟硬件。
 *       这里只把事件收成整数并交给主板，不解释点击，也不刷新别的设备。
 */

import { ZerOS as ConfigRoot } from "../../Pointer/Config/PointerConfig";
import { ZerOS as KindRoot } from "../../Pointer/Enum/EventKind";
import { ZerOS as ButtonRoot } from "../../Pointer/Enum/Button";
import { ZerOS as MotherboardRoot } from "../../Motherboard/Bootstrap/Motherboard";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Display {
      const CoordMax = ConfigRoot.Hardware.Pointer.PointerConfig.CoordMax;
      const EventKindMove = KindRoot.Hardware.Pointer.EventKindMove;
      const EventKindDown = KindRoot.Hardware.Pointer.EventKindDown;
      const EventKindUp = KindRoot.Hardware.Pointer.EventKindUp;
      const EventKindWheel = KindRoot.Hardware.Pointer.EventKindWheel;
      const ButtonNone = ButtonRoot.Hardware.Pointer.ButtonNone;
      const ButtonLeft = ButtonRoot.Hardware.Pointer.ButtonLeft;
      const ButtonRight = ButtonRoot.Hardware.Pointer.ButtonRight;
      const ButtonMiddle = ButtonRoot.Hardware.Pointer.ButtonMiddle;
      const ButtonBack = ButtonRoot.Hardware.Pointer.ButtonBack;
      const ButtonForward = ButtonRoot.Hardware.Pointer.ButtonForward;
      const page = MotherboardRoot.Hardware.Motherboard.Motherboard;

      /** 浏览器键号收成 ZPP1 的键。不认识的键不发布。 */
      function buttonOf(button: number): number | null {
        if (button === 0) {
          return ButtonLeft;
        }
        if (button === 1) {
          return ButtonMiddle;
        }
        if (button === 2) {
          return ButtonRight;
        }
        if (button === 3) {
          return ButtonBack;
        }
        if (button === 4) {
          return ButtonForward;
        }
        return null;
      }

      /** 修饰位和键盘同一套：Shift、Ctrl、Alt、Meta。 */
      function modifiersOf(event: MouseEvent): number {
        let modifiers = 0;
        if (event.shiftKey) {
          modifiers += 1;
        }
        if (event.ctrlKey) {
          modifiers += 2;
        }
        if (event.altKey) {
          modifiers += 4;
        }
        if (event.metaKey) {
          modifiers += 8;
        }
        return modifiers;
      }

      /**
       * 把宿主坐标收成画布像素。
       * 松开可以落在画布外，这时夹到边上，好让按住掩码能清掉。
       * 移动和按下出了画布就不发布。
       */
      function locate(event: MouseEvent, clamp: boolean): { readonly x: number; readonly y: number } | null {
        const canvas = document.querySelector("canvas");
        if (!(canvas instanceof HTMLCanvasElement)) {
          return null;
        }
        const rect = canvas.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1 || canvas.width < 1 || canvas.height < 1) {
          return null;
        }
        let x = Math.floor(((event.clientX - rect.left) * canvas.width) / rect.width);
        let y = Math.floor(((event.clientY - rect.top) * canvas.height) / rect.height);
        const inside = x >= 0 && y >= 0 && x < canvas.width && y < canvas.height;
        if (!inside && !clamp) {
          return null;
        }
        if (x < 0) {
          x = 0;
        }
        if (y < 0) {
          y = 0;
        }
        if (x >= canvas.width) {
          x = canvas.width - 1;
        }
        if (y >= canvas.height) {
          y = canvas.height - 1;
        }
        if (x > CoordMax || y > CoordMax) {
          return null;
        }
        return { x, y };
      }

      /**
       * 垂直分量在低 16 位，水平分量在接着的 16 位，都是补码。
       * 不到 1 的非零分量收成 1 格，否则触控板的小步进会被截成 0，固件看不到滚轮。
       */
      function packWheel(deltaX: number, deltaY: number): bigint {
        const quantizeAxis = (value: number): number => {
          if (!Number.isFinite(value)) {
            return 0;
          }
          if (value > 0 && value < 1) {
            return 1;
          }
          if (value < 0 && value > -1) {
            return -1;
          }
          const whole = Math.trunc(value);
          if (whole > 32767) {
            return 32767;
          }
          if (whole < -32768) {
            return -32768;
          }
          return whole;
        };
        const vertical = quantizeAxis(deltaY) & 0xffff;
        const horizontal = quantizeAxis(deltaX) & 0xffff;
        return BigInt(vertical) | (BigInt(horizontal) << 16n);
      }

      /**
       * 收成 ZPP1 的 6 个字。
       * 种类只说明浏览器触发了哪一种监听，不决定这个键做什么。
       */
      function packEvent(
        kind: number,
        button: number,
        point: { readonly x: number; readonly y: number },
        modifiers: number,
        wheel: bigint,
      ): readonly bigint[] {
        return [BigInt(kind), BigInt(button), BigInt(point.x), BigInt(point.y), BigInt(modifiers), wheel];
      }

      /** 截住这次鼠标事件并发布。页面上的其它监听不再看见它。 */
      function publish(kind: number, button: number, event: MouseEvent, wheel: bigint, clamp: boolean): void {
        event.preventDefault();
        event.stopPropagation();
        const point = locate(event, clamp);
        if (point === null) {
          return;
        }
        page.PublishPointer(packEvent(kind, button, point, modifiersOf(event), wheel));
      }

      /**
       * 接上指针的移动、按下、松开和滚轮。
       * 听指针事件，并在记下之后取消默认动作，这样浏览器不再另发一套鼠标事件。
       * 必须在封印之后调用。封印名单里没有这三件，否则捕获阶段会把它们丢掉。
       * 右键菜单只取消，不另记一次事件，按下和松开已经记过右键。
       */
      export function publishPointer(): void {
        window.addEventListener("pointermove", (event: PointerEvent): void => {
          publish(EventKindMove, ButtonNone, event, 0n, false);
        }, true);
        window.addEventListener("pointerdown", (event: PointerEvent): void => {
          const button = buttonOf(event.button);
          if (button === null) {
            return;
          }
          publish(EventKindDown, button, event, 0n, false);
        }, true);
        window.addEventListener("pointerup", (event: PointerEvent): void => {
          const button = buttonOf(event.button);
          if (button === null) {
            return;
          }
          publish(EventKindUp, button, event, 0n, true);
        }, true);
        window.addEventListener("wheel", (event: WheelEvent): void => {
          publish(EventKindWheel, ButtonNone, event, packWheel(event.deltaX, event.deltaY), false);
        }, { capture: true, passive: false });
        window.addEventListener("contextmenu", (event: MouseEvent): void => {
          event.preventDefault();
          event.stopPropagation();
        }, true);
      }
    }
  }
}
