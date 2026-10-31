/**
 * @file PublishKeyboard.ts
 * @desc 因为浏览器的存在，迫不得已做出的让步。
 *       键盘事件只出现在持有文档的那条线程上，显示器是唯一持有文档的虚拟硬件。
 *       这里只把事件收成整数并交给主板，不解释按键，也不刷新别的设备。
 */

import { ZerOS as ConfigRoot } from "../../Keyboard/Config/KeyboardConfig";
import { ZerOS as KindRoot } from "../../Keyboard/Enum/EventKind";
import { ZerOS as MotherboardRoot } from "../../Motherboard/Bootstrap/Motherboard";
import { ZerOS as TracePageRoot } from "../../Diagnostics/Host/TracePage";
import { ZerOS as TraceOpRoot } from "../../Diagnostics/Enum/TraceOp";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Display {
      const WordOctets = ConfigRoot.Hardware.Keyboard.KeyboardConfig.WordOctets;
      const EventKindDown = KindRoot.Hardware.Keyboard.EventKindDown;
      const EventKindUp = KindRoot.Hardware.Keyboard.EventKindUp;
      const EventKindPress = KindRoot.Hardware.Keyboard.EventKindPress;
      const page = MotherboardRoot.Hardware.Motherboard.Motherboard;
      const traceInstant = TracePageRoot.Hardware.Diagnostics.traceInstant;
      const TraceOp = TraceOpRoot.Hardware.Diagnostics.TraceOp;
      const TraceLayer = TraceOpRoot.Hardware.Diagnostics.TraceLayer;
      const TraceHostEvent = TraceOpRoot.Hardware.Diagnostics.TraceHostEvent;

      /**
       * ZKP1 的键位名最多 8 个可打印 ASCII。
       * ArrowDown、ArrowLeft、ArrowRight、NumpadEnter 和 Backspace 都更长。
       * 直接丢掉的话，固件收不到方向键、小键盘回车，也删不掉刚打的字。
       * 这里收成仍然合法的短名，字长和协议都不变。ArrowUp 正好 7 个字符，不必改。
       */
      function fitName(code: string): string {
        if (code === "ArrowDown") {
          return "Down";
        }
        if (code === "ArrowLeft") {
          return "Left";
        }
        if (code === "ArrowRight") {
          return "Right";
        }
        if (code === "NumpadEnter") {
          return "Enter";
        }
        if (code === "Backspace") {
          return "Back";
        }
        return code;
      }

      /**
       * 键位名收成一个无符号字：最多 8 个 ASCII，小端。
       * 超长或出现不可打印字符时整段作废，调用方不发布这次事件。
       */
      function packCode(name: string): bigint | null {
        if (name.length > WordOctets) {
          return null;
        }
        let word = 0n;
        for (let index = 0; index < name.length; index += 1) {
          const code = name.charCodeAt(index);
          if (code < 0x20 || code > 0x7e) {
            return null;
          }
          word += BigInt(code) << BigInt(index * 8);
        }
        return word;
      }

      /** 关联号只在一次页面会话内唯一；16 位足够覆盖一次采集。 */
      let nextCorrelation = 0;

      function correlation(): number {
        nextCorrelation = nextCorrelation % 65535 + 1;
        return nextCorrelation;
      }

      /**
       * 把一次键盘事件收成 ZKP1 的 6 个语义字。
       * 种类只区分是哪一种监听被触发，不决定这个键做什么。
       */
      function packEvent(kind: number, event: KeyboardEvent): readonly bigint[] | null {
        const name = packCode(fitName(event.code));
        if (name === null) {
          return null;
        }
        const keyUnit = event.key.length < 1 ? 0 : event.key.charCodeAt(0);
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
        const location = event.location;
        if (!Number.isInteger(location) || location < 0 || location > 3) {
          return null;
        }
        return [
          BigInt(kind),
          event.repeat ? 1n : 0n,
          BigInt(location),
          BigInt(modifiers),
          BigInt(keyUnit),
          name,
        ];
      }

      /** 截住这次键盘事件并发布。页面上的其它监听不再看见它。 */
      function publish(kind: number, event: KeyboardEvent): void {
        event.preventDefault();
        event.stopPropagation();
        const packed = packEvent(kind, event);
        if (packed === null) {
          return;
        }
        const id = correlation();
        const words = [...packed, BigInt(id)];
        /* 先交给主板；同步投递失败会由 sendBoard 记 HostReject page，这里不再记成功事件。
           ZKP1 的第 7 个字就是关联号。 */
        page.Publish(words);
        /* 固件只消费按下和连按；松开不产生 key ring 消费，不记输入区间。 */
        if (kind !== EventKindUp) {
          traceInstant(TraceOp.Input, TraceLayer.Host, -1, id, Number(words[4] ?? 0n));
        }
        /* 页面侧时间戳和键号；只覆盖主机段，不声称到回显的因果。 */
        traceInstant(TraceOp.HostEvent, TraceLayer.Host, -1, TraceHostEvent.KeyboardPage, Number(words[4] ?? 0n));
      }

      /**
       * 接上三种键盘监听。
       * 必须在封印其它输入之后调用，这样按键不会被封印函数丢掉。
       */
      export function publishKeyboard(): void {
        window.addEventListener("keydown", (event: KeyboardEvent): void => {
          publish(EventKindDown, event);
        }, true);
        window.addEventListener("keyup", (event: KeyboardEvent): void => {
          publish(EventKindUp, event);
        }, true);
        window.addEventListener("keypress", (event: KeyboardEvent): void => {
          publish(EventKindPress, event);
        }, true);
      }
    }
  }
}
