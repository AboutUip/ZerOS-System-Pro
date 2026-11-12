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
import { ZerOS as PointerRoot } from "../../Pointer/ActiveProvider/Provider";
import { ZerOS as PointerConfigRoot } from "../../Pointer/Config/PointerConfig";
import { ZerOS as NasRoot } from "../../Nas/ActiveProvider/Provider";
import { ZerOS as NasConfigRoot } from "../../Nas/Config/NasConfig";
import { ZerOS as NicRoot } from "../../Nic/ActiveProvider/Provider";
import { ZerOS as NicConfigRoot } from "../../Nic/Config/NicConfig";
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
      const NicPort = NicConfigRoot.Hardware.Nic.NicConfig.OfficialPort;
      const ActiveNicProvider = NicRoot.Hardware.Nic.ActiveNicProvider;
      const NasPort = NasConfigRoot.Hardware.Nas.NasConfig.OfficialPort;
      const ActiveNasProvider = NasRoot.Hardware.Nas.ActiveNasProvider;
      const PointerPort = PointerConfigRoot.Hardware.Pointer.PointerConfig.OfficialPort;
      const ActivePointerProvider = PointerRoot.Hardware.Pointer.ActivePointerProvider;
      const seatPrefix = "[ZerOS.Hardware.Motherboard.ExpansionSeat]";

      /**
       * 引导扩展口。
       * 没有 Bind 的口保持为空，不视为失败。
       */
      export function bootExpansionPorts(): void {
        if (Get(OfficialPort) === null) {
          Bind(OfficialPort, ActiveKeyboardProvider);
        }
        /*
         * 沙盒（口 1，ZSP1）暂时不绑定，口 1 让给网卡（ZNC1）。
         * 恢复沙盒时重新引入 Sandbox/ActiveProvider/Provider 和
         * Sandbox/Config/SandboxConfig，并把这里的 Bind 换回 SandboxPort。
         */
        if (Get(NicPort) === null) {
          Bind(NicPort, ActiveNicProvider);
        }
        if (Get(NasPort) === null) {
          Bind(NasPort, ActiveNasProvider);
        }
        if (Get(PointerPort) === null) {
          Bind(PointerPort, ActivePointerProvider);
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
