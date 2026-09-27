/**
 * @module ZerOS.Boot.KernelWindow
 * @description 引导侧记下的内核地址窗口
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只锁第一阶段要定死的数。没有运行时，也不读 NAS。
 * 这些数不是 ZCP1 / ZMP1 的协议字段，也不属于客程序。
 * 客程序在 Kernel/ 的 .obr 里。官方这几颗核心共用一条位元线，
 * 编译器却把栈和堆写在固定位地址上，所以核心 2 的数据必须整段错开。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 入口与核心
 *   2. 编译器在核心 0 上的地址
 *   3. 错开后的窗口与暂存
 */

export namespace ZerOS {
  export namespace Boot {
    /** 对外的窗口。字段写成 number / string，通电前的核对才能在改动后真的比较。 */
    export interface KernelWindowContract {
      readonly EntryGuestPath: string;
      readonly EntrySourceFile: string;
      readonly ResidentCore: number;
      readonly SlotBits: number;
      readonly DataFloor: number;
      readonly CompilerSp: number;
      readonly CompilerStack: number;
      readonly CompilerStackBits: number;
      readonly CompilerUi: number;
      readonly CompilerFrame: number;
      readonly CompilerHeapPtr: number;
      readonly CompilerStatic: number;
      readonly CompilerStaticBits: number;
      readonly CompilerHeap: number;
      readonly CompilerHeapBits: number;
      readonly CompilerImageLimit: number;
      readonly AddressSlot: number;
      readonly WindowOrigin: number;
      readonly WindowLimit: number;
      readonly ImageStageOrigin: number;
      readonly ImageStageOctets: number;
      readonly ImageStageBits: number;
    }

    /**
     * 常驻核心。
     * 0 是固件，1 是沙盒客程序。入口装到这颗核心上。
     */
    const ResidentCore = 2;

    /**
     * 与沙盒 CoreSlotBits 相同的槽距。
     * 核心 n 的数据地址 = 编译器地址 + n × 槽距。核心 0 不加。
     */
    const SlotBits = 8388608;

    /**
     * 小于这个地址的格子留给固件。
     * 与沙盒 DataFloor 相同。编译器的栈指针字正好落在这里，因此也会被错开。
     */
    const DataFloor = 1048576;

    /** 编译器 Layout.hpp 的 kHeap。核心 0 的堆从这里开始。 */
    const CompilerHeap = 5767168;

    /** 编译器 Layout.hpp 的 kHeapStride。堆占这么多位，到 6815744 为止，不含终点。 */
    const CompilerHeapBits = 1048576;

    /**
     * 装入程序把入口映像读进位元线时使用的长度，单位是八位组。
     * 这一段由核心 3 上的 Load.obr 执行，不在本文件里读盘。
     * 327680 正好停在核心 4 的数据槽之前。再长就会写进那颗核心的窗口。
     */
    const ImageStageOctets = 327680;

    /** 核心 2 相对编译器地址的位移。 */
    const AddressSlot = ResidentCore * SlotBits;

    /** 核心 0 上编译器映像的终点，不含。堆的终点就是这一个数。 */
    const CompilerImageLimit = CompilerHeap + CompilerHeapBits;

    export const KernelWindow: KernelWindowContract = {
      /** 客路径。NAS 上的文件没有扩展名，内容是程序映像。 */
      EntryGuestPath: "/kernel/start",
      /** 源文件名。与客路径的最后一段对应，编译产物不带 .obr。 */
      EntrySourceFile: "start.obr",
      ResidentCore,
      SlotBits,
      DataFloor,
      /** 栈指针字。与 DataFloor 是同一个地址。 */
      CompilerSp: 1048576,
      /** 栈底。跨度与 Layout.hpp 的 kStackStride 一致。 */
      CompilerStack: 2097152,
      CompilerStackBits: 524288,
      /** 界面库暂存。内核这一阶段不绘制，地址仍算进窗口，避免以后叠到固件。 */
      CompilerUi: 4603904,
      CompilerFrame: 4653056,
      CompilerHeapPtr: 4718592,
      CompilerStatic: 5242880,
      CompilerStaticBits: 65536,
      CompilerHeap,
      CompilerHeapBits,
      CompilerImageLimit,
      AddressSlot,
      /** 核心 2 的数据起点，含。等于 DataFloor + AddressSlot。 */
      WindowOrigin: DataFloor + AddressSlot,
      /** 核心 2 的数据终点，不含。等于编译器映像终点 + AddressSlot。 */
      WindowLimit: CompilerImageLimit + AddressSlot,
      /**
       * 入口映像的暂存起点。
       * 放在核心 3 的编译器映像终点，给那颗核心留下和核心 2 一样宽的数据槽。
       * 必须按 8 位对齐，install 才接受。
       */
      ImageStageOrigin: CompilerImageLimit + (ResidentCore + 1) * SlotBits,
      ImageStageOctets,
      /** 暂存占的位数。八位组数乘 8。 */
      ImageStageBits: ImageStageOctets * 8,
    };
  }
}
