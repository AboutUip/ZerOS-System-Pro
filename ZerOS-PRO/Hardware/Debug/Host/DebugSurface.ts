/**
 * @module ZerOS.Hardware.Debug.DebugSurface
 * @description 调试开关打开时才挂上的宿主入口
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 开关关闭时什么都不挂，已经挂上的入口也摘掉。开关打开时，在调用方给的对象上放一个不可枚举的 ZerOSDebug。
 * 入口只有读失败、读停机、扩展口交换和一段有限的 ZAP。没有 eval，也不接收客程序二进制。
 * run 和 exchange 会再看一次当前开关。固件把它关掉之后，这两条仍拒绝。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 入口
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as FlagRoot } from "../Config/DebugFlag";
import { type ZerOS as FaultRoot } from "../../Cpu/Structure/FaultRecord";
import { type ZerOS as StopRoot } from "../../Cpu/Structure/CoreStop";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Debug {
      const debugEnabled = FlagRoot.Hardware.Debug.debugEnabled;
      type FaultRecord = FaultRoot.Hardware.Cpu.FaultRecord;
      type CoreStop = StopRoot.Hardware.Cpu.CoreStop;

      /* ------------------------------------------------------------------ */
      /* 2. 入口                                                             */
      /* ------------------------------------------------------------------ */

      /** 页面把已经存在的宿主能力交进来。本文件不自己去找主板。 */
      export interface DebugHooks {
        readonly faults: () => readonly FaultRecord[];
        readonly last: () => FaultRecord | null;
        readonly stop: (ordinal: number) => CoreStop | null;
        readonly exchange: (index: number, direction: number, word: bigint) => Promise<bigint>;
        readonly run: (lines: readonly string[]) => Promise<string>;
      }

      /**
       * 开关关闭就摘掉入口，目标对象回到没有 ZerOSDebug 的样子。
       * 打开时挂上的函数不持有客程序能改的状态。属性可配置，是为了下一档能再摘掉。
       */
      export function installDebugSurface(target: object, enabled: boolean, hooks: DebugHooks): void {
        if (!enabled) {
          Reflect.deleteProperty(target, "ZerOSDebug");
          return;
        }
        const api = {
          faults: (): readonly FaultRecord[] => hooks.faults(),
          last: (): FaultRecord | null => hooks.last(),
          stop: (ordinal: number): CoreStop | null => hooks.stop(ordinal),
          exchange: (index: number, direction: number, word: bigint): Promise<bigint> => {
            if (!debugEnabled()) {
              return Promise.reject(new Error("debug is off"));
            }
            return hooks.exchange(index, direction, word);
          },
          run: (lines: readonly string[]): Promise<string> => {
            if (!debugEnabled()) {
              return Promise.resolve("debug is off");
            }
            return hooks.run(lines);
          },
        };
        Object.defineProperty(target, "ZerOSDebug", {
          value: api,
          enumerable: false,
          writable: false,
          configurable: true,
        });
      }
    }
  }
}
