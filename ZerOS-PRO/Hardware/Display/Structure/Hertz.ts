/**
 * @file Hertz.ts
 * @desc 刷新率门闩。只接受协议闭区间内的整数。
 */

import { ZerOS as ConfigRoot } from "../Config/DisplayConfig";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Display {
      const MinHertz = ConfigRoot.Hardware.Display.Config.MinHertz;
      const MaxHertz = ConfigRoot.Hardware.Display.Config.MaxHertz;

      /** 值是否为合法刷新率。 */
      export function isHertz(value: number): boolean {
        return Number.isInteger(value) && value >= MinHertz && value <= MaxHertz;
      }
    }
  }
}
