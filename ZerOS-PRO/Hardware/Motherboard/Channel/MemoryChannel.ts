/**
 * @module ZerOS.Hardware.Motherboard.MemoryChannel
 * @description 主板内存通道：地址、数据、方向、字宽
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 把已经坐上的内存总控收成一条底层通道。
 * 方向 0 是读，方向 1 是写。地址是线性位元下标。字宽是 1/8/16/32/64 位。
 * 数据是 bigint。通道自己不保存存储体，只调用内存已经导出的端口。
 * 不调度。什么时候发起一次访问，留给以后的 CPU。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 取总控与八位组落点
 *   3. 读 / 写
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as MachineMemoryRoot } from "../../Memory/Bootstrap/MachineMemory";
import type { ZerOS as MemoryControllerRoot } from "../../Memory/Controller/MemoryController";
import { ZerOS as Uint32Root } from "../../Memory/Structure/Uint32";
import { ZerOS as ChannelWidthRoot } from "../Enum/ChannelWidth";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      type MemoryController = MemoryControllerRoot.Hardware.Memory.MemoryController;
      type Uint32 = Uint32Root.Hardware.Memory.Uint32;
      type ChannelWidth = ChannelWidthRoot.Hardware.Motherboard.ChannelWidth;

      /* ------------------------------------------------------------------ */
      /* 2. 没有总控就不能碰存储体；八位组必须落在某一颗上                     */
      /* ------------------------------------------------------------------ */

      const channelPrefix = "[ZerOS.Hardware.Motherboard.MemoryChannel]";

      /**
       * 通道只认已经发布在内存门面上的那一台总控。
       * 主板还没上电时这里是空的，读写成会改到存储体之前就停住。
       */
      function requireController(): MemoryController {
        const controller = MachineMemoryRoot.Hardware.Memory.MachineMemory.MemoryController;
        if (controller === null) {
          throw new Error(`${channelPrefix} 内存通道还没有座上总控`);
        }
        return controller;
      }

      /**
       * 字宽大于 1 时，地址必须是八位组起点。
       * 不对齐就停，避免把一个字拆进内存端口后只写成一部分。
       */
      function requireWidth(width: number, address: bigint): ChannelWidth {
        const accepted: ChannelWidth | null =
          ChannelWidthRoot.Hardware.Motherboard.toChannelWidth(width);
        if (accepted === null) {
          throw new Error(`${channelPrefix} 通道字宽不是 1、8、16、32、64`);
        }
        if (accepted !== ChannelWidthRoot.Hardware.Motherboard.ChannelWidthBit && address % 8n !== 0n) {
          throw new Error(`${channelPrefix} 宽度大于 1 时地址必须对齐到八位组`);
        }
        return accepted;
      }

      /**
       * 线性八位组落在哪一颗的哪一个八位组。
       * 按 UnitOrdinal 从 0 走，失败颗粒的 CellCount 为 0，不占位置。
       * 找不到就返回 null，调用方不得自己写存储体。
       */
      function locateOctet(
        controller: MemoryController,
        address: bigint,
      ): { readonly unitOrdinal: Uint32; readonly octetIndex: Uint32 } | null {
        const linearOctet: bigint = address / 8n;
        const units = Array.from(controller.Units.values()).sort(
          (left, right): number => left.UnitOrdinal - right.UnitOrdinal,
        );
        let cursor = 0n;
        for (const unit of units) {
          const octetCount: bigint = BigInt(unit.CellCount) / 8n;
          if (linearOctet >= cursor && linearOctet < cursor + octetCount) {
            const local: bigint = linearOctet - cursor;
            const index: Uint32 | null = Uint32Root.Hardware.Memory.toUint32(Number(local));
            if (index === null) {
              return null;
            }
            return {
              unitOrdinal: unit.UnitOrdinal,
              octetIndex: index,
            };
          }
          cursor += octetCount;
        }
        return null;
      }

      /**
       * 八位组窗口对不上时，先问内存这条位元线认不认。
       * 用读探测，这样写路径也不会先改掉一个位元。
       * 内存若拒绝，异常由内存自己记下并抛出。
       */
      function probeMissingOctet(controller: MemoryController, address: bigint): never {
        controller.ReadLinearBit(address + 7n);
        throw new Error(`${channelPrefix} 这个八位组没有落在某一颗的八位组线上`);
      }

      /* ------------------------------------------------------------------ */
      /* 3. 读与写：方向已经分开，数据始终是 bigint                            */
      /* ------------------------------------------------------------------ */

      /**
       * 按方向 0 从通道读出。
       * 地址是线性位元下标。返回值的低位是该窗口的最低有效位。
       */
      export function Read(Address: bigint, Width: number): bigint {
        const width: ChannelWidth = requireWidth(Width, Address);
        const controller: MemoryController = requireController();
        if (width === ChannelWidthRoot.Hardware.Motherboard.ChannelWidthBit) {
          return BigInt(controller.ReadLinearBit(Address));
        }
        if (width === ChannelWidthRoot.Hardware.Motherboard.ChannelWidthOctet) {
          const place = locateOctet(controller, Address);
          if (place === null) {
            probeMissingOctet(controller, Address);
          }
          return BigInt(controller.ReadOctet(place.unitOrdinal, place.octetIndex));
        }
        // 16/32/64 位交给内存的线性小端整数。可以跨过颗粒边界。
        return controller.ReadLinearInteger(Address / 8n, width / 8);
      }

      /**
       * 按方向 1 写入通道。
       * 值不合法或跨度对不上时，由内存端口在改存储体之前拒绝。
       */
      export function Write(Address: bigint, Width: number, Data: bigint): void {
        const width: ChannelWidth = requireWidth(Width, Address);
        const controller: MemoryController = requireController();
        if (width === ChannelWidthRoot.Hardware.Motherboard.ChannelWidthBit) {
          // 只有 0 和 1 是位元。其它值交给位元端口拒绝，这里不先改存储体。
          let bit = 2;
          if (Data === 0n) {
            bit = 0;
          } else if (Data === 1n) {
            bit = 1;
          }
          controller.WriteLinearBit(Address, bit);
          return;
        }
        if (width === ChannelWidthRoot.Hardware.Motherboard.ChannelWidthOctet) {
          const place = locateOctet(controller, Address);
          if (place === null) {
            probeMissingOctet(controller, Address);
          }
          let octet = 256;
          if (Data >= 0n && Data <= 255n) {
            octet = Number(Data);
          }
          controller.WriteOctet(place.unitOrdinal, place.octetIndex, octet);
          return;
        }
        controller.WriteLinearInteger(Address / 8n, width / 8, Data);
      }
    }
  }
}
