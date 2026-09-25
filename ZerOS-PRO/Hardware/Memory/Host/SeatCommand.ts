/**
 * @module ZerOS.Hardware.Memory.SeatCommand
 * @description 内存线程上的坐座动作
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 主板把支持的协议名单交过来。Bind、Test、Initialize 都在这条内存线程里完成。
 * 总控留在本线程的 MachineMemory 上，不送回页面。
 * 不决定名单里有哪些协议，名单是主板传来的。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. seatActiveMemory
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as ActiveProviderRoot } from "../ActiveProvider/Provider";
import { ZerOS as ConfigRoot } from "../Config/MemoryConfig";
import { ZerOS as MachineMemoryRoot } from "../Bootstrap/MachineMemory";
import { ZerOS as ClockRoot } from "./MemoryClock";
import { ZerOS as MemorySlotRoot } from "../../Motherboard/Slot/Memory/MemorySlot";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      const seatPrefix = "[ZerOS.Hardware.Motherboard.MemorySeat]";

      /**
       * 按主板名单坐上当前 ActiveProvider。
       * 协议不在名单里时不 Bind。插座拒绝时不测试。
       */
      export function seatActiveMemory(supported: readonly string[]): void {
        const provider = ActiveProviderRoot.Hardware.Memory.ActiveMemoryProvider;
        let allowed = false;
        for (const protocol of supported) {
          if (protocol === provider.ActiveProtocol) {
            allowed = true;
          }
        }
        if (!allowed) {
          throw new Error(`${seatPrefix} 主板不支持内存协议 ${provider.ActiveProtocol}`);
        }

        const slot = MemorySlotRoot.Hardware.Motherboard.Slot.MemorySlot;
        slot.Bind(provider);
        if (slot.GetActive() !== provider) {
          throw new Error(`${seatPrefix} 内存插头没有坐上插座`);
        }

        const memory = MachineMemoryRoot.Hardware.Memory.MachineMemory;
        memory.MemoryInit.Test();
        memory.MemoryInit.Initialize();
        if (memory.MemoryController === null) {
          throw new Error(`${seatPrefix} 内存总控没有发布到 MachineMemory`);
        }
      }

      /** 坐稳之后的一行观测。标识、协议、已初始化、MemoryId 是否已经不是全零。 */
      export function memoryObserveText(): string {
        const provider = ActiveProviderRoot.Hardware.Memory.ActiveMemoryProvider;
        const id = ConfigRoot.Hardware.Memory.Config.MemoryId;
        const published = MachineMemoryRoot.Hardware.Memory.MachineMemory.MemoryController !== null;
        let drawn = 0;
        for (let index = 0; index < id.length; index += 1) {
          if (id.charAt(index) !== "0") {
            drawn = 1;
          }
        }
        const init = published ? 1 : 0;
        const hertz = ClockRoot.Hardware.Memory.currentHertz();
        const executed = ClockRoot.Hardware.Memory.currentExecuted();
        return `${provider.ProviderId}\n${provider.ProviderVendor}\n${provider.ActiveProtocol}\n${String(init)}\n${String(drawn)}\n${String(hertz)}\n${String(executed)}`;
      }
    }
  }
}
