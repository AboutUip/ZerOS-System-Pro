/**
 * @module ZerOS.Machine.Memory.Config
 * @description 虚拟内存硬件配置面（Machine 层 · Memory 子系统）
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 本文件只承载「内存虚拟硬件」的静态配置与协议标识，不实现读写、分配或地址翻译。
 * 指标语义遵循 Documents/Protocol/PhysicalHardware/Memory/ZMP1.md。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 协议契约（枚举）—— 先锁定「说哪种内存协议」
 *   2. 配置类型（类型 / 接口）—— 指标形状
 *   3. 生效配置（常量）—— 本机当前采用的协议与参数
 *
 * ---------------------------------------------------------------------------
 * 命名空间约定
 * ---------------------------------------------------------------------------
 * 路径 ZerOS.Machine.Memory 与目录 ZerOS-PRO/Machine/Memory 一一对应，
 * 外部引用须走完整命名空间，避免与日后 CPU、总线等硬件模块产生命名冲突。
 */

export namespace ZerOS {
  /**
   * Machine：虚拟硬件层。
   * 此层模拟物理机侧设备（内存、日后的 CPU / 总线等），不属于内核或用户态。
   */
  export namespace Machine {
    /**
     * Memory：虚拟内存硬件子系统。
     * 关注存储介质契约与配置，不包含操作系统意义上的「虚拟内存 / 页表」策略
     * （那一层属于后续 Kernel，勿在本文件混入）。
     */
    export namespace Memory {
      /**
       * Protocol：ZerOS 内存协议（ZerOS Memory Protocol，简称 ZMP）。
       *
       * 用途：
       *   - 标识「虚拟内存硬件」遵循的契约版本（布局、语义、兼容规则）。
       *   - 供配置、实现与教学观测台校验：当前机器到底跑的是哪一版内存协议。
       *
       * 约定：
       *   - 枚举成员名与协议简称一致（如 ZMP1）。
       *   - 枚举值为稳定字符串标识，便于日志、序列化与跨模块比对。
       *   - 新增协议只追加成员，不复用、不改写既有成员含义。
       */
      export enum Protocol {
        /**
         * ZMP1 — ZerOS Memory Protocol · 第 1 版
         *
         * 当前（也是起步阶段）唯一启用的内存协议修订号。
         * 后续若出现不兼容的布局或语义变更，应新增 ZMP2 / ZMP3 …，
         * 而不是静默修改 ZMP1 的含义。
         */
        ZMP1 = "ZMP1",
      }

      /**
       * 浅维度：确定的数字（ZMP1）。
       * 用于将内存划分成不同的内存块；
       * 块的具体行为由后续协议定义，不由本类型表达。
       */
      export type ShallowDimension = number;

      /**
       * 深维度：确定的数字（ZMP1）。
       * 表示单个内存块可保存的维度，或可嵌套深度上限。
       */
      export type DeepDimension = number;

      /**
       * 内存颗粒数量：确定的数字（ZMP1，强制）。
       * 表示可模拟的内存颗粒个数。
       */
      export type UnitCount = number;

      /**
       * 单个内存颗粒大小：确定的数字（ZMP1，强制）。
       * 单位固定为字节（byte）。
       */
      export type UnitSizeBytes = number;

      /**
       * 总内存大小：非负整数（ZMP1，强制）。
       * 单位固定为字节（byte）；默认 0 表示尚未由初始化确定。
       */
      export type TotalSizeBytes = number;

      /**
       * 内存 ID：长度为 MemoryIdByteLength 的字符串（ZMP1，强制）。
       * 正式值应在初始化时动态生成（256 字节随机串）；
       * 全 '0' 表示禁用；配置面默认全零，由后续 MemoryInit 覆盖为非全零即启用。
       */
      export type MemoryId = string;

      /**
       * 内存标识：16 个字符以内的厂商标记字符串（ZMP1，强制）。
       */
      export type MemoryVendor = string;

      /**
       * ZMP1 维度配置形状：浅维度 + 深维度。
       */
      export interface DimensionConfig {
        /** 浅维度：切块划分尺度 */
        readonly ShallowDimension: ShallowDimension;
        /** 深维度：单块可保存维度 / 可嵌套深度 */
        readonly DeepDimension: DeepDimension;
      }

      /**
       * ZMP1 颗粒配置形状：数量 + 单颗粒字节大小。
       */
      export interface UnitConfig {
        /** 内存颗粒数量 */
        readonly UnitCount: UnitCount;
        /** 单个内存颗粒大小（字节） */
        readonly UnitSizeBytes: UnitSizeBytes;
      }

      /**
       * ZMP1 身份配置形状：内存 ID + 厂商标识。
       * 启用判定：MemoryId 全为字符 '0' 表示禁用；非全零表示已启用。
       */
      export interface IdentityConfig {
        /** 内存 ID（全零=禁用；正式为随机串） */
        readonly MemoryId: MemoryId;
        /** 内存厂商标识（≤16 字符） */
        readonly MemoryVendor: MemoryVendor;
      }

      /**
       * Config：虚拟内存设备的静态配置命名空间。
       *
       * 说明：
       *   - 此处只放「编译期 / 启动期可知」的配置常量与占位。
       *   - 运行时状态（已用块、嵌套深度实况等）不得写入本命名空间。
       *   - MemoryIdByteLength / MemoryVendorMaxLength 为 ZMP1 协议固定常量（必须存在且取值不可变）。
       *   - TotalSizeBytes 默认 0，由初始化写入有效值；不在本文件推算。
       *   - MemoryId 的随机生成不在本文件实现；默认全零表示禁用，待 MemoryInit 覆盖。
       *   - 不另设 MemoryId 布尔启用开关。
       */
      export namespace Config {
        /**
         * ActiveProtocol：当前配置档案所遵循的内存协议修订。
         *
         * 语义：
         *   - 标记本虚拟机内存硬件「声称并实现」的 ZMP 版本。
         *   - 实现层与观测层应以本常量为准，禁止魔法字符串散落他处。
         *
         * 当前值：
         *   Protocol.ZMP1（ZerOS Memory Protocol 第 1 版）
         */
        export const ActiveProtocol: Protocol = Protocol.ZMP1;

        /**
         * MemoryIdByteLength：内存 ID 的字节长度。
         *
         * ZMP1 协议固定常量：配置面必须存在，取值必须恒为 256。
         * 不得删除、不得改为其他数字；若需变更须发布 ZMP2+。
         */
        export const MemoryIdByteLength = 256;

        /**
         * MemoryVendorMaxLength：内存厂商标识的最大字符数。
         *
         * ZMP1 协议固定常量：配置面必须存在，取值必须恒为 16。
         * 不得删除、不得改为其他数字；若需变更须发布 ZMP2+。
         */
        export const MemoryVendorMaxLength = 16;

        /**
         * ShallowDimension：浅维度（暂定标定值）。
         * 用于划分出不同的内存块；块行为见后续协议。
         */
        export const ShallowDimension: ShallowDimension = 16;

        /**
         * DeepDimension：深维度（暂定标定值）。
         * 单个内存块可保存的维度 / 可嵌套深度上限。
         */
        export const DeepDimension: DeepDimension = 8;

        /**
         * UnitCount：内存颗粒数量（暂定标定值，ZMP1 强制项）。
         */
        export const UnitCount: UnitCount = 8;

        /**
         * UnitSizeBytes：单个内存颗粒大小（标定值，ZMP1 强制项）。
         * 单位：字节（byte）。当前：2097152（2 MiB）。
         */
        export const UnitSizeBytes: UnitSizeBytes = 2097152;

        /**
         * TotalSizeBytes：总内存大小（ZMP1 强制项）。
         * 单位：字节（byte）。默认 0 = 尚未由初始化确定；有效值由 MemoryInit 等逻辑写入。
         */
        export const TotalSizeBytes: TotalSizeBytes = 0;

        /**
         * MemoryId：内存 ID（ZMP1 强制项）。
         *
         * 正式语义：初始化时生成的 256 字节随机字符串。
         * 启用判定：全为字符 '0' 表示禁用；非全零表示已启用。
         * 当前：不实现随机逻辑；默认 "0000…0"（全零）即禁用，待 MemoryInit 覆盖。
         */
        export const MemoryId: MemoryId = "0".repeat(MemoryIdByteLength);

        /**
         * MemoryVendor：内存厂商标识（ZMP1 强制项，≤16 字符）。
         * 当前确定值：ZerOS-Team-M1。
         */
        export const MemoryVendor: MemoryVendor = "ZerOS-Team-M1";

        /**
         * Dimensions：汇聚后的 ZMP1 深浅维度配置视图（只读快照）。
         */
        export const Dimensions: DimensionConfig = {
          ShallowDimension,
          DeepDimension,
        };

        /**
         * Units：汇聚后的 ZMP1 颗粒配置视图（只读快照）。
         */
        export const Units: UnitConfig = {
          UnitCount,
          UnitSizeBytes,
        };

        /**
         * Identity：汇聚后的 ZMP1 身份配置视图（只读快照）。
         */
        export const Identity: IdentityConfig = {
          MemoryId,
          MemoryVendor,
        };
      }
    }
  }
}
