/**
 * @module ZerOS.Hardware.Motherboard.ExpansionSeat
 * @description 引导时加载已经坐下的扩展设备
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 按 0 到 3 查看 4 个口。空口跳过。非空口先 Load 再 Boot。
 * 某一个口失败时，编号更大的口不再处理。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. bootExpansionPorts
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as KeyboardRoot } from "../../Keyboard/ActiveProvider/Provider";
import { ZerOS as KeyboardConfigRoot } from "../../Keyboard/Config/KeyboardConfig";
import { ZerOS as SandboxRoot } from "../../Sandbox/ActiveProvider/Provider";
import { ZerOS as SandboxConfigRoot } from "../../Sandbox/Config/SandboxConfig";
import { ZerOS as ConfigRoot } from "../Config/ExpansionConfig";
import { ZerOS as PortRoot } from "../Slot/Expansion/ExpansionPort";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      const PortCount = ConfigRoot.Hardware.Motherboard.ExpansionConfig.PortCount;
      const PortStateEmpty = ConfigRoot.Hardware.Motherboard.ExpansionConfig.PortStateEmpty;
      const Get = PortRoot.Hardware.Motherboard.Slot.Get;
      const State = PortRoot.Hardware.Motherboard.Slot.State;
      const Bind = PortRoot.Hardware.Motherboard.Slot.Bind;
      const Load = PortRoot.Hardware.Motherboard.Slot.Load;
      const Boot = PortRoot.Hardware.Motherboard.Slot.Boot;
      const OfficialPort = KeyboardConfigRoot.Hardware.Keyboard.KeyboardConfig.OfficialPort;
      const ActiveKeyboardProvider = KeyboardRoot.Hardware.Keyboard.ActiveKeyboardProvider;
      const SandboxPort = SandboxConfigRoot.Hardware.Sandbox.SandboxConfig.OfficialPort;
      const ActiveSandboxProvider = SandboxRoot.Hardware.Sandbox.ActiveSandboxProvider;
      const seatPrefix = "[ZerOS.Hardware.Motherboard.ExpansionSeat]";

      /**
       * 引导扩展口。
       * 没有 Bind 的口保持为空，不视为失败。
       */
      export function bootExpansionPorts(): void {
        if (Get(OfficialPort) === null) {
          Bind(OfficialPort, ActiveKeyboardProvider);
        }
        if (Get(SandboxPort) === null) {
          Bind(SandboxPort, ActiveSandboxProvider);
        }
        for (let index = 0; index < PortCount; index += 1) {
          if (Get(index) === null || State(index) !== PortStateEmpty) {
            continue;
          }
          try {
            Load(index);
            Boot(index);
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : `${seatPrefix} 扩展口引导失败`;
            throw new Error(message);
          }
        }
      }
    }
  }
}
