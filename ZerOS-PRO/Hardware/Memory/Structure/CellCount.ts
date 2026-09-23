/**
 * @module ZerOS.Hardware.Memory.CellCount
 * @description 颗粒位元计数（CellCount）推导
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只承载 ZMP1 §4.15 的一条算术：CellCount = UnitSizeBytes × BitsPerByte，
 * 以及由此得到的 UnitSizeBytes 上界。
 * 不提供位元读写，不映射内存块，不跨颗粒编址。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 配置面 / Uint32 导入
 *   2. MaxUnitSizeBytes
 *   3. cellCountFromUnitSize
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as MemoryConfigRoot } from "../Config/MemoryConfig";
import { ZerOS as Uint32Root } from "./Uint32";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      /* -------------------------------------------------------------------- */
      /* 2. UnitSizeBytes 上界：使精确乘积仍落在 Uint32 内                     */
      /* -------------------------------------------------------------------- */

      /**
       * `floor(Uint32Max / BitsPerByte)`。
       *
       * 用整数余数取整，避免先做浮点除法再舍入。
       * 协议正文写死同一十进制值；此处推导必须与该值一致，冲突时以协议为准。
       */
      export const MaxUnitSizeBytes: Uint32Root.Hardware.Memory.Uint32 = ((): Uint32Root.Hardware.Memory.Uint32 => {
        const bitsPerByte: MemoryConfigRoot.Hardware.Memory.BitsPerByte =
          MemoryConfigRoot.Hardware.Memory.Config.BitsPerByte;
        const span: number =
          Uint32Root.Hardware.Memory.Uint32Max -
          (Uint32Root.Hardware.Memory.Uint32Max % bitsPerByte);
        const quotient: number = span / bitsPerByte;
        const parsed: Uint32Root.Hardware.Memory.Uint32 | null =
          Uint32Root.Hardware.Memory.toUint32(quotient);
        if (parsed === null || parsed < 1) {
          throw new Error(
            "[ZerOS.Hardware.Memory.CellCount] MaxUnitSizeBytes 推导失败",
          );
        }
        return parsed;
      })();

      /* -------------------------------------------------------------------- */
      /* 3. 由字节数求位元数                                                   */
      /* -------------------------------------------------------------------- */

      /**
       * 计算 `UnitSizeBytes × BitsPerByte`。
       *
       * 返回 null：精确乘积大于 Uint32Max（颗粒大小非法）。
       * 不在这里拒绝 0：0×8 仍是合法 Uint32。调用方必须另行拒绝非正的 UnitSizeBytes。
       *
       * 宿主说明（非协议）：Uint32 上界乘以 8 仍小于 2^53，
       * 该乘积在 IEEE-754 中可精确表示。协议要求的是精确整数，不是某种浮点格式。
       */
      export function cellCountFromUnitSize(
        unitSizeBytes: Uint32Root.Hardware.Memory.Uint32,
      ): Uint32Root.Hardware.Memory.Uint32 | null {
        const bitsPerByte: MemoryConfigRoot.Hardware.Memory.BitsPerByte =
          MemoryConfigRoot.Hardware.Memory.Config.BitsPerByte;
        const product: number = unitSizeBytes * bitsPerByte;
        return Uint32Root.Hardware.Memory.toUint32(product);
      }
    }
  }
}
