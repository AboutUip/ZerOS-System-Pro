/**
 * @module ZerOS.Hardware.Memory.ChannelServer
 * @description 内存线程上的通道执行
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 主板把地址、字宽、数据放进信箱。真正调用内存端口的是这一文件，因为它和总控在同一条线程。
 * 字宽规则与主板通道一致：1 位走线性位元，8 位走八位组，16/32/64 走线性小端整数。
 * 不创建 Worker，也不决定主板支持哪些协议。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 落点
 *   3. 读 / 写
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as MachineMemoryRoot } from "../Bootstrap/MachineMemory";
import type { ZerOS as MemoryControllerRoot } from "../Controller/MemoryController";
import { ZerOS as Uint32Root } from "../Structure/Uint32";
import { ZerOS as ChannelWidthRoot } from "../../Motherboard/Enum/ChannelWidth";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Memory {
      type MemoryController = MemoryControllerRoot.Hardware.Memory.MemoryController;
      type Uint32 = Uint32Root.Hardware.Memory.Uint32;
      type ChannelWidth = ChannelWidthRoot.Hardware.Motherboard.ChannelWidth;

      const channelPrefix = "[ZerOS.Hardware.Motherboard.MemoryChannel]";
      const ChannelWidthBit = ChannelWidthRoot.Hardware.Motherboard.ChannelWidthBit;
      const ChannelWidthOctet = ChannelWidthRoot.Hardware.Motherboard.ChannelWidthOctet;

      /** 总控只存在于这条内存线程。还没发布时通道不能碰存储体。 */
      function requireController(): MemoryController {
        const controller = MachineMemoryRoot.Hardware.Memory.MachineMemory.MemoryController;
        if (controller === null) {
          throw new Error(`${channelPrefix} 内存通道还没有座上总控`);
        }
        return controller;
      }

      /**
       * 线性八位组落在哪一颗的哪一个八位组。
       * 按 UnitOrdinal 从 0 走。失败颗粒的 CellCount 为 0，不占位置。
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

      /** 八位组对不上时用读探测，避免写路径先改掉一个位元。 */
      function probeMissingOctet(controller: MemoryController, address: bigint): never {
        controller.ReadLinearBit(address + 7n);
        throw new Error(`${channelPrefix} 这个八位组没有落在某一颗的八位组线上`);
      }

      /**
       * 执行一次通道读。
       * 字宽不在封闭集合里时，由调用方在主板线程上先拒绝，这里仍再查一次。
       */
      export function executeChannelRead(address: bigint, width: number): bigint {
        const accepted: ChannelWidth | null = ChannelWidthRoot.Hardware.Motherboard.toChannelWidth(width);
        if (accepted === null) {
          throw new Error(`${channelPrefix} 通道字宽不是 1、8、16、32、64`);
        }
        const controller = requireController();
        if (accepted === ChannelWidthBit) {
          return BigInt(controller.ReadLinearBit(address));
        }
        if (accepted === ChannelWidthOctet) {
          const place = locateOctet(controller, address);
          if (place === null) {
            probeMissingOctet(controller, address);
          }
          return BigInt(controller.ReadOctet(place.unitOrdinal, place.octetIndex));
        }
        return controller.ReadLinearInteger(address / 8n, accepted / 8);
      }

      /** 执行一次通道写。非法值交给内存端口，在改存储体之前拒绝。 */
      export function executeChannelWrite(address: bigint, width: number, data: bigint): void {
        const accepted: ChannelWidth | null = ChannelWidthRoot.Hardware.Motherboard.toChannelWidth(width);
        if (accepted === null) {
          throw new Error(`${channelPrefix} 通道字宽不是 1、8、16、32、64`);
        }
        const controller = requireController();
        if (accepted === ChannelWidthBit) {
          let bit = 2;
          if (data === 0n) {
            bit = 0;
          } else if (data === 1n) {
            bit = 1;
          }
          controller.WriteLinearBit(address, bit);
          return;
        }
        if (accepted === ChannelWidthOctet) {
          const place = locateOctet(controller, address);
          if (place === null) {
            probeMissingOctet(controller, address);
          }
          let octet = 256;
          if (data >= 0n && data <= 255n) {
            octet = Number(data);
          }
          controller.WriteOctet(place.unitOrdinal, place.octetIndex, octet);
          return;
        }
        controller.WriteLinearInteger(address / 8n, accepted / 8, data);
      }
    }
  }
}
