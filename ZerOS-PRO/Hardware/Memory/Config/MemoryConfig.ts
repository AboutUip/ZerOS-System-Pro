/**
 * @module ZerOS.Hardware.Memory.Config
 * @description 虚拟内存硬件配置面（Hardware 层 · Memory 子系统）
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
 *   1. Uint32 门闩导入
 *   2. 协议契约（枚举）—— 先锁定「说哪种内存协议」
 *   3. 配置类型（类型 / 接口）—— 指标形状
 *   4. 生效配置（常量）—— 本机当前采用的协议与参数
 *
 * ---------------------------------------------------------------------------
 * 命名空间约定
 * ---------------------------------------------------------------------------
 * 路径 ZerOS.Hardware.Memory 与目录 ZerOS-PRO/Hardware/Memory 一一对应，
 * 外部引用须走完整命名空间，避免与日后 CPU、总线等硬件模块产生命名冲突。
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入：Uint32 门闩（UnitSizeBytes 必须先过值域，再充当字节数）             */
/* -------------------------------------------------------------------------- */

import { ZerOS as Uint32Root } from "../Structure/Uint32";

export namespace ZerOS {
  /**
   * Hardware：虚拟硬件层。
   * 此层模拟设备（内存，以及主板上的插座），不属于内核或系统。
   */
  export namespace Hardware {
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
       * 浅维度（ZMP1）：浅切所得的内存块个数。
       * Uint32 且 ≥ 1。块与颗粒的对应不由本类型表达。
       */
      export type ShallowDimension = Uint32Root.Hardware.Memory.Uint32;

      /**
       * 深维度（ZMP1）：单个内存块的嵌套深度上限。
       * Uint32 且 ≥ 1。浅切完成时块的 NestingDepth 为 1，不得大于本值。
       */
      export type DeepDimension = Uint32Root.Hardware.Memory.Uint32;

      /**
       * 内存颗粒数量：正整数（ZMP1，强制）。
       * 上界 4294967296，保证最后一颗的 UnitOrdinal 仍是 Uint32。
       */
      export type UnitCount = number;

      /**
       * 一个字节所含位元数（ZMP1 协议固定常量）。
       * 必须恒为 8。UnitSizeBytes 仍以字节计，不改用本常量当单位。
       */
      export type BitsPerByte = 8;

      /**
       * 单个内存颗粒大小：Uint32 正整数（ZMP1，强制）。
       * 单位固定为字节（byte）。上界由 CellCount 仍须落入 Uint32 决定。
       */
      export type UnitSizeBytes = Uint32Root.Hardware.Memory.Uint32;

      /**
       * 总内存大小：非负整数（ZMP1，强制）。
       * 单位固定为字节。和可以超过 2^53，所以用 bigint。默认 0 表示尚未由初始化确定。
       */
      export type TotalSizeBytes = bigint;

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
         * BitsPerByte：一个字节所含位元数。
         *
         * ZMP1 协议固定常量：配置面必须存在，取值必须恒为 8。
         * 不得改为 1 / 16 等其它宽度后仍标识为 ZMP1。
         * 位元总数写在颗粒的 CellCount 上，禁止把 UnitSizeBytes 改成按位计数。
         */
        export const BitsPerByte: BitsPerByte = 8;

        /**
         * ShallowDimension：浅切所得的内存块个数（官方标定）。
         * 必须通过 Uint32 门闩。当前：16。不是「16 颗颗粒」。
         */
        export const ShallowDimension: ShallowDimension =
          Uint32Root.Hardware.Memory.uint32OrThrow(
            16,
            "ZerOS.Hardware.Memory.Config.ShallowDimension",
          );

        /**
         * DeepDimension：单个内存块的嵌套深度上限（官方标定）。
         * 必须通过 Uint32 门闩。当前：8。浅切初值 NestingDepth = 1，必须 ≤ 本值。
         */
        export const DeepDimension: DeepDimension =
          Uint32Root.Hardware.Memory.uint32OrThrow(
            8,
            "ZerOS.Hardware.Memory.Config.DeepDimension",
          );

        /**
         * UnitCount：内存颗粒数量（官方标定，ZMP1 强制项）。
         * 当前：8。协议上界是 4294967296。
         */
        export const UnitCount: UnitCount = 8;

        /**
         * UnitSizeBytes：单个内存颗粒大小（标定值，ZMP1 强制项）。
         * 单位：字节（byte）。当前：2097152（2 MiB）。
         * 必须通过 Uint32 门闩；非法标定在加载期中止，而不是留到颗粒构造再猜。
         */
        export const UnitSizeBytes: UnitSizeBytes =
          Uint32Root.Hardware.Memory.uint32OrThrow(
            2097152,
            "ZerOS.Hardware.Memory.Config.UnitSizeBytes",
          );

        /**
         * TotalSizeBytes：总内存大小（ZMP1 强制项）。
         * 单位：字节。默认 0n。Initialize 发布总控时写成各颗 Cells.length 之和。
         * 必须是 let：发布函数通过配置对象写回，转译后裸标识符赋值到不了导出面。
         */
        // eslint-disable-next-line prefer-const -- publishCapacity 写回导出面
        export let TotalSizeBytes: TotalSizeBytes = 0n;

        /**
         * MemoryId：内存 ID（ZMP1 强制项）。
         *
         * 默认全为字符 '0'，表示禁用。Initialize 发布时按可打印 ASCII 抽一条非全零串。
         */
        // eslint-disable-next-line prefer-const -- publishCapacity 写回导出面
        export let MemoryId: MemoryId = "0".repeat(MemoryIdByteLength);

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
         * Identity：汇聚后的 ZMP1 身份配置视图。
         * 发布前是全零 ID；发布后与 MemoryId 同一条字符串。
         */
        // eslint-disable-next-line prefer-const -- publishCapacity 写回导出面
        export let Identity: IdentityConfig = {
          MemoryId,
          MemoryVendor,
        };

        /**
         * Initialize 发布总控时写入总容量和内存 ID，并刷新身份视图。
         * 临时总控不得调用这里。
         * 必须写在配置对象上，裸标识符在转译后只改闭包副本。
         */
        export function publishCapacity(total: TotalSizeBytes, memoryId: MemoryId): void {
          ZerOS.Hardware.Memory.Config.TotalSizeBytes = total;
          ZerOS.Hardware.Memory.Config.MemoryId = memoryId;
          ZerOS.Hardware.Memory.Config.Identity = {
            MemoryId: memoryId,
            MemoryVendor,
          };
        }
      }
    }
  }
}
