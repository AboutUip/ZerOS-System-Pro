/**
 * @module ZerOS.Boot.KernelWindowCheck
 * @description 通电前核对内核窗口没有压到固件、沙盒和位元线尽头
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 通电前调用。只做整数比较，不访问内存，也不访问 NAS。
 * 窗口被改到和沙盒槽距或编译器地址冲突时，这里失败，主板不通电。
 * 客程序本身在 Kernel/ 的 .obr 里，本文件不编译进映像。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. runKernelWindowCheck
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as CpuConfigRoot } from "../../Hardware/Cpu/Config/CpuConfig";
import { ZerOS as MemoryConfigRoot } from "../../Hardware/Memory/Config/MemoryConfig";
import { ZerOS as SandboxConfigRoot } from "../../Hardware/Sandbox/Config/SandboxConfig";
import { ZerOS as WindowRoot } from "../Config/KernelWindow";

export namespace ZerOS {
  export namespace Boot {
    const KernelWindow = WindowRoot.Boot.KernelWindow;
    const OfficialCoreCount = CpuConfigRoot.Hardware.Cpu.Config.OfficialCoreCount;
    const RelocateSlotBits = CpuConfigRoot.Hardware.Cpu.Config.RelocateSlotBits;
    const RelocateDataFloor = CpuConfigRoot.Hardware.Cpu.Config.RelocateDataFloor;
    const SandboxConfig = SandboxConfigRoot.Hardware.Sandbox.SandboxConfig;
    const UnitCount = MemoryConfigRoot.Hardware.Memory.Config.UnitCount;
    const UnitSizeBytes = MemoryConfigRoot.Hardware.Memory.Config.UnitSizeBytes;
    const BitsPerByte = MemoryConfigRoot.Hardware.Memory.Config.BitsPerByte;
    const checkPrefix = "[ZerOS.Boot.KernelWindowCheck]";

    function fail(message: string): never {
      throw new Error(`${checkPrefix} ${message}`);
    }

    /** 把字面量收成普通 number，避免核对被当成永远成立的比较。 */
    function widen(value: number): number {
      return value;
    }

    function text(value: string): string {
      return value;
    }

    /**
     * 通电前核对窗口。
     * 核心 0 使用编译器原地址。核心 1 使用沙盒的同一槽距。核心 2 使用窗口里的位移。
     */
    export function runKernelWindowCheck(): void {
      if (text(KernelWindow.EntryGuestPath) !== "/kernel/start" || text(KernelWindow.EntrySourceFile) !== "start.obr") {
        fail("入口不是 /kernel/start 与 start.obr");
      }
      const resident = widen(KernelWindow.ResidentCore);
      const guest = widen(SandboxConfig.GuestCore);
      const slotBits = widen(KernelWindow.SlotBits);
      const dataFloor = widen(KernelWindow.DataFloor);
      const addressSlot = widen(KernelWindow.AddressSlot);
      const imageLimit = widen(KernelWindow.CompilerHeap) + widen(KernelWindow.CompilerHeapBits);
      const windowOrigin = widen(KernelWindow.WindowOrigin);
      const windowLimit = widen(KernelWindow.WindowLimit);
      const stageOrigin = widen(KernelWindow.ImageStageOrigin);
      if (resident !== 2 || resident === guest) {
        fail("常驻核心不是 2，或与沙盒核心相同");
      }
      if (resident + 1 >= widen(OfficialCoreCount)) {
        fail("官方挂载的核心不够放下固件、沙盒、入口和核心 3");
      }
      if (slotBits !== widen(SandboxConfig.CoreSlotBits) || dataFloor !== widen(SandboxConfig.DataFloor)) {
        fail("槽距或数据下限和沙盒标定不一致");
      }
      if (slotBits !== widen(RelocateSlotBits) || dataFloor !== widen(RelocateDataFloor)) {
        fail("槽距或数据下限和核心装入位移不一致");
      }
      if (widen(KernelWindow.CompilerSp) !== dataFloor) {
        fail("栈指针字不在数据下限上");
      }
      if (addressSlot !== resident * slotBits) {
        fail("地址位移不是核心号乘槽距");
      }
      if (imageLimit !== widen(KernelWindow.CompilerImageLimit)) {
        fail("编译器映像终点不是堆的终点");
      }
      if (windowOrigin !== dataFloor + addressSlot) {
        fail("窗口起点不是数据下限加位移");
      }
      if (windowLimit !== imageLimit + addressSlot) {
        fail("窗口终点不是编译器映像终点加位移");
      }
      const sandboxLimit = imageLimit + widen(SandboxConfig.CoreSlotBits);
      if (windowOrigin < sandboxLimit) {
        fail("内核窗口压到沙盒核心的数据");
      }
      if (imageLimit > dataFloor + slotBits) {
        fail("核心 0 的编译器映像越过了核心 1 的槽");
      }
      const regions: readonly (readonly [number, number])[] = [
        [widen(KernelWindow.CompilerSp), 64],
        [widen(KernelWindow.CompilerStack), widen(KernelWindow.CompilerStackBits)],
        [widen(KernelWindow.CompilerUi), 64],
        [widen(KernelWindow.CompilerFrame), 64],
        [widen(KernelWindow.CompilerHeapPtr), 64],
        [widen(KernelWindow.CompilerStatic), widen(KernelWindow.CompilerStaticBits)],
        [widen(KernelWindow.CompilerHeap), widen(KernelWindow.CompilerHeapBits)],
      ];
      let previousEnd = dataFloor;
      for (const [origin, bits] of regions) {
        if (origin < previousEnd || origin + bits > imageLimit) {
          fail("编译器地址重叠，或越出核心 0 的映像");
        }
        const shifted = origin + addressSlot;
        if (shifted < windowOrigin || shifted + bits > windowLimit) {
          fail("错开后的编译器地址不在内核窗口内");
        }
        previousEnd = origin + bits;
      }
      const core3Origin = dataFloor + (resident + 1) * slotBits;
      if (core3Origin < windowLimit) {
        fail("核心 3 的数据槽压到内核窗口");
      }
      if (stageOrigin !== imageLimit + (resident + 1) * slotBits) {
        fail("映像暂存不在核心 3 的数据槽之后");
      }
      if (stageOrigin % 8 !== 0) {
        fail("映像暂存没有按 8 位对齐");
      }
      if (widen(KernelWindow.ImageStageBits) !== widen(KernelWindow.ImageStageOctets) * 8) {
        fail("暂存位数不是八位组数乘 8");
      }
      const lineBits = widen(UnitCount) * widen(UnitSizeBytes) * widen(BitsPerByte);
      if (stageOrigin + widen(KernelWindow.ImageStageBits) > lineBits) {
        fail("映像暂存越出位元线");
      }
      const core4Origin = dataFloor + (resident + 2) * slotBits;
      if (stageOrigin + widen(KernelWindow.ImageStageBits) > core4Origin) {
        fail("映像暂存写进核心 4 的数据槽");
      }
    }
  }
}
