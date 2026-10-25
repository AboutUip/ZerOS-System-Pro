/**
 * @module ZerOS.Hardware.Cpu.KernelWindowCheck
 * @description 通电前核对内核窗口没有压到固件、沙盒和位元线尽头
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 通电前调用。只做整数比较，不访问内存，也不访问 NAS。
 * 窗口被改到和沙盒槽距或编译器地址冲突时，这里失败，主板不通电。
 * 任务表、文件区、内存文件和用户堆池也在这里对一下。
 * 堆池在编译器映像之后、下一颗核心之前。映射区要放得下一份最大的字体文件。
 * 客程序本身在 Kernel/ 的 .obr 里，本文件不编译进映像。这些数要和 task.obr、vfs.obr 一起改。
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

import { ZerOS as CpuConfigRoot } from "../Config/CpuConfig";
import { ZerOS as FontLimitRoot } from "../../Gpu/Config/FontLimit";
import { ZerOS as MemoryConfigRoot } from "../../Memory/Config/MemoryConfig";
import { ZerOS as SandboxConfigRoot } from "../../Sandbox/Config/SandboxConfig";
import { ZerOS as WindowRoot } from "../Config/KernelWindow";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      const KernelWindow = WindowRoot.Hardware.Cpu.KernelWindow;
      const OfficialCoreCount = CpuConfigRoot.Hardware.Cpu.Config.OfficialCoreCount;
      const RelocateSlotBits = CpuConfigRoot.Hardware.Cpu.Config.RelocateSlotBits;
      const RelocateDataFloor = CpuConfigRoot.Hardware.Cpu.Config.RelocateDataFloor;
      const SandboxConfig = SandboxConfigRoot.Hardware.Sandbox.SandboxConfig;
      const LineBits = CpuConfigRoot.Hardware.Cpu.Config.LineBits;
      const UnitCount = MemoryConfigRoot.Hardware.Memory.Config.UnitCount;
      const UnitSizeBytes = MemoryConfigRoot.Hardware.Memory.Config.UnitSizeBytes;
      const BitsPerByte = MemoryConfigRoot.Hardware.Memory.Config.BitsPerByte;
      const FontFileOctets = FontLimitRoot.Hardware.Gpu.Config.FontFileOctets;
      const checkPrefix = "[ZerOS.Hardware.Cpu.KernelWindowCheck]";

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
        const rawStage = imageLimit + (resident + 1) * slotBits;
        if (stageOrigin < rawStage || stageOrigin - rawStage >= 8) {
          fail("映像暂存不在核心 3 的数据槽之后");
        }
        if (stageOrigin % 8 !== 0) {
          fail("映像暂存没有按 8 位对齐");
        }
        if (widen(KernelWindow.ImageStageBits) !== widen(KernelWindow.ImageStageOctets) * 8) {
          fail("暂存位数不是八位组数乘 8");
        }
        const lineBits = widen(UnitCount) * widen(UnitSizeBytes) * widen(BitsPerByte);
        if (lineBits !== widen(LineBits)) {
          fail("位元线长度和颗粒总容量不一致");
        }
        if (stageOrigin + widen(KernelWindow.ImageStageBits) > lineBits) {
          fail("映像暂存越出位元线");
        }
        /*
         * 映射区从最后一颗核心的窗口终点开始，到整条位元线为止。
         * 入口划给客核心的跨度必须小于一槽，最后一颗客核心才碰不到这一段。
         */
        const arenaOrigin = dataFloor + widen(OfficialCoreCount) * slotBits;
        const fontBits = widen(FontFileOctets) * widen(BitsPerByte);
        const granted = windowLimit - windowOrigin;
        if (arenaOrigin <= windowLimit || stageOrigin + widen(KernelWindow.ImageStageBits) > arenaOrigin) {
          fail("映射区压到内核窗口或映像暂存");
        }
        if (granted >= slotBits) {
          fail("入口划定的跨度盖过了下一颗核心");
        }
        const lastGuest = dataFloor + (widen(OfficialCoreCount) - 1) * slotBits + granted;
        if (lastGuest > arenaOrigin || lineBits < arenaOrigin + fontBits) {
          fail("映射区放不下一份最大的字体文件，或最后一颗核心写了进去");
        }
        const core4Stack = widen(KernelWindow.CompilerStack) + (resident + 2) * slotBits;
        if (stageOrigin + widen(KernelWindow.ImageStageBits) > core4Stack) {
          fail("映像暂存写进核心 4 的栈");
        }
        /*
         * 任务表在核心 2 窗口 +65536，512 份，每份 19 个字。
         * 名字槽 4096 位，文件表 4096 格，路径草稿 8192 个八位组，目录栈 128 层。
         * 管道 64 条，每条 4096 个八位组。内存文件 6 份，每份 1048576 个八位组。
         * 这些都停在编译器栈之前。程序正文改放槽尾，不再挤在栈前面。
         */
        const stackOffset = widen(KernelWindow.CompilerStack) - dataFloor;
        const taskStride = widen(19 * 64);
        const tableOffset = widen(65536);
        const taskLimit = widen(512);
        if (tableOffset + taskLimit * taskStride >= stackOffset) {
          fail("任务表写进了编译器栈");
        }
        const vfsBase = tableOffset + taskLimit * taskStride;
        const vfsEndOffset =
          vfsBase +
          widen(128 * 512) +
          widen(256 * 256) +
          widen(256 * 4096) +
          widen(4096 * 320) +
          widen(64 + 8192 * 8) +
          widen(128 * 64) +
          widen(64 * 448) +
          widen(64 * 4096 * 8) +
          widen(16 * 768 + 16 * 2 * 4096 * 8);
        const memEndOffset = vfsEndOffset + widen(128 * 64) + widen(6) * widen(1048576) * widen(8);
        const memEnd = windowOrigin + memEndOffset;
        const stack2 = widen(KernelWindow.CompilerStack) + resident * slotBits;
        if (memEnd >= stack2 || memEnd >= windowLimit) {
          fail("内存文件正文写进了编译器栈");
        }
        const span = windowLimit - windowOrigin;
        const imageBits = slotBits - span;
        if (span !== widen(137904128) || imageBits !== widen(16316416) * widen(8)) {
          fail("槽尾不是程序暂存的那一段");
        }
        const imageEnd = windowOrigin + slotBits;
        const nextCore = dataFloor + (resident + 1) * slotBits;
        if (windowOrigin + span !== windowLimit || imageEnd !== nextCore) {
          fail("程序暂存没有铺满监督核的槽尾");
        }
        /* 请求路径在调用者窗口 +16384，8192 个八位组，停在编译器栈之前，也躲开 +12288 的调用帧。 */
        const pathAt = widen(16384);
        const pathEnd = pathAt + widen(64 + 8192 * 8);
        if (pathAt <= widen(12288) || pathEnd >= stackOffset) {
          fail("请求路径压到调用帧或编译器栈");
        }
        /* 读写字节在路径之后。一次 262144 个八位组，停在编译器栈之前。 */
        const byteAt = widen(131072);
        const byteEnd = byteAt + widen(262144 * 8);
        if (byteAt <= pathEnd || byteEnd >= stackOffset) {
          fail("读写字节压到路径或编译器栈");
        }
        let userCore = resident + 1;
        const coreCount = widen(OfficialCoreCount);
        while (userCore < coreCount) {
          const origin = dataFloor + userCore * slotBits;
          const poolEnd = origin + slotBits;
          const stack = widen(KernelWindow.CompilerStack) + userCore * slotBits;
          const next = userCore + 1 === coreCount ? arenaOrigin : dataFloor + (userCore + 1) * slotBits;
          const imageEnd = origin + span;
          if (imageEnd <= stack || poolEnd !== next) {
            fail("用户核的堆池没有停在下一颗核心之前");
          }
          userCore += 1;
        }
      }
    }
  }
}
