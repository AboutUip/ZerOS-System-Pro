/**
 * @file DomSeal.ts
 * @desc 页面宿主封印。画布接上之后，文档里只留这一块画布。
 *       点击、指针和滚轮在捕获阶段被截住，不作为显示器功能。
 *       键盘事件不在这里丢掉：因为浏览器的存在，迫不得已做出的让步，
 *       由 PublishKeyboard 收成整数后交给主板。
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Display {
      /** 在窗口捕获阶段截住的输入事件名。 */
      const blockedEventNames: readonly string[] = [
        "click",
        "dblclick",
        "auxclick",
        "contextmenu",
        "mousedown",
        "mouseup",
        "mousemove",
        "mouseenter",
        "mouseleave",
        "mouseover",
        "mouseout",
        "pointerdown",
        "pointerup",
        "pointermove",
        "pointerenter",
        "pointerleave",
        "pointerover",
        "pointerout",
        "pointercancel",
        "touchstart",
        "touchmove",
        "touchend",
        "touchcancel",
        "wheel",
        "beforeinput",
        "input",
        "drag",
        "dragstart",
        "dragend",
        "dragover",
        "drop",
      ];

      /**
       * 截住输入。捕获阶段停止继续下传，目标上的监听不会再看到这次事件。
       */
      function blockInput(event: Event): void {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }

      /**
       * 宿主若把某个函数锁死，就保持原状。
       * 事件截获和节点观察仍然生效。
       */
      function tryReplace(target: object, key: string, value: unknown): void {
        const descriptor = Object.getOwnPropertyDescriptor(target, key);
        if (descriptor?.configurable === false && descriptor.writable === false) {
          return;
        }
        try {
          Object.defineProperty(target, key, {
            configurable: true,
            writable: true,
            value,
          });
        } catch {
          /* 宿主锁死该属性时保持原状。 */
        }
      }

      /**
       * 封印当前文档，只保留传入的那一块画布。
       * 必须在取得二维上下文之后调用。
       */
      export function sealHostPage(canvas: HTMLCanvasElement): void {
        const body = document.body;
        const kept: ChildNode[] = [];
        for (const node of Array.from(body.childNodes)) {
          if (node !== canvas) {
            node.remove();
          } else {
            kept.push(node);
          }
        }
        if (kept.length !== 1) {
          throw new Error("[ZerOS.Hardware.Display.DomSeal] 页面里没有唯一的画布");
        }

        const observer = new MutationObserver((records: MutationRecord[]): void => {
          for (const record of records) {
            for (const node of Array.from(record.addedNodes)) {
              if (node !== canvas) {
                node.parentNode?.removeChild(node);
              }
            }
          }
        });
        observer.observe(body, { childList: true, subtree: true });

        const refuseNode = (): never => {
          throw new Error("[ZerOS.Hardware.Display.DomSeal] 页面不允许插入画布以外的节点");
        };
        const appendChild = body.appendChild.bind(body);
        body.appendChild = <T extends Node>(node: T): T => {
          const incoming: Node = node;
          if (incoming === canvas) {
            return appendChild(node);
          }
          return refuseNode();
        };
        body.insertBefore = <T extends Node>(_node: T, _child: Node | null): T => refuseNode();
        body.replaceChild = <T extends Node>(_node: Node, _child: T): T => refuseNode();
        body.append = (): void => {
          refuseNode();
        };
        body.prepend = (): void => {
          refuseNode();
        };
        body.replaceChildren = (): void => {
          refuseNode();
        };

        Object.defineProperty(body, "innerHTML", {
          configurable: true,
          get(): string {
            return canvas.outerHTML;
          },
          set(_value: string): void {
            throw new Error("[ZerOS.Hardware.Display.DomSeal] 页面不允许改写文档");
          },
        });

        const refuseDocument = (): never => {
          throw new Error("[ZerOS.Hardware.Display.DomSeal] 页面不允许改写文档");
        };
        tryReplace(document, "write", refuseDocument);
        tryReplace(document, "writeln", refuseDocument);
        tryReplace(document, "createElement", refuseDocument);
        tryReplace(document, "createElementNS", refuseDocument);
        tryReplace(window, "open", (): null => null);
        tryReplace(window, "alert", (): void => {
          /* 对话框不属于显示器。 */
        });
        tryReplace(window, "prompt", (): null => null);
        tryReplace(window, "confirm", (): boolean => false);
        tryReplace(window, "print", (): void => {
          /* 打印不属于显示器。 */
        });
        tryReplace(history, "pushState", refuseDocument);
        tryReplace(history, "replaceState", refuseDocument);

        for (const name of blockedEventNames) {
          const needsCancel = name === "wheel" || name.startsWith("touch");
          window.addEventListener(name, blockInput, needsCancel ? { capture: true, passive: false } : true);
        }
        sealConsole();
      }

      /** 控制台不属于这台机器。页面上的输出方法全部改成空操作。 */
      function sealConsole(): void {
        const methods = [
          "log",
          "info",
          "debug",
          "warn",
          "error",
          "trace",
          "dir",
          "dirxml",
          "table",
          "group",
          "groupCollapsed",
          "groupEnd",
          "time",
          "timeEnd",
          "timeLog",
          "count",
          "countReset",
          "assert",
          "clear",
        ] as const;
        const sink = (): void => {
          /* 禁止写入宿主控制台。 */
        };
        for (const name of methods) {
          tryReplace(console, name, sink);
        }
      }
    }
  }
}
