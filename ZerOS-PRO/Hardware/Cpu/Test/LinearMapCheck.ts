/**
 * @module ZerOS.Hardware.Cpu.LinearMapCheck
 * @description 核对按页映射
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 用一张独立的表核对：第一次碰到才要搬运，第二次不再要，卸下后再读失败，
 * 重复卸下失败，搬运短了不记成已调入。不打开扩展口。
 * 另外核对这台机器的映射区在核心窗口之上，并且放得下一份最大的字体文件。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. runLinearMapCheck
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as CpuConfigRoot } from "../Config/CpuConfig";
import { ZerOS as FontLimitRoot } from "../../Gpu/Config/FontLimit";
import { ZerOS as MapConfigRoot } from "../Config/MapConfig";
import { ZerOS as MemoryConfigRoot } from "../../Memory/Config/MemoryConfig";
import { ZerOS as MapRoot } from "../Map/LinearMap";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      const PageBytes = MapConfigRoot.Hardware.Cpu.Config.MapPageBytes;
      const createLinearMap = MapRoot.Hardware.Cpu.createLinearMap;
      const bringIn = MapRoot.Hardware.Cpu.bringIn;
      const machineMap = MapRoot.Hardware.Cpu.machineMap;
      const DataFloor = CpuConfigRoot.Hardware.Cpu.Config.RelocateDataFloor;
      const SlotBits = CpuConfigRoot.Hardware.Cpu.Config.RelocateSlotBits;
      const CoreCount = CpuConfigRoot.Hardware.Cpu.Config.OfficialCoreCount;
      const LineBits = CpuConfigRoot.Hardware.Cpu.Config.LineBits;
      const UnitCount = MemoryConfigRoot.Hardware.Memory.Config.UnitCount;
      const UnitSizeBytes = MemoryConfigRoot.Hardware.Memory.Config.UnitSizeBytes;
      const FontFileOctets = FontLimitRoot.Hardware.Gpu.Config.FontFileOctets;
      const checkPrefix = "[ZerOS.Hardware.Cpu.LinearMapCheck]";

      function fail(message: string): never {
        throw new Error(`${checkPrefix} ${message}`);
      }

      /* ---------------------------------------------------------------------- */
      /* 2. runLinearMapCheck                                                    */
      /* ---------------------------------------------------------------------- */

      /** 内存坐稳之后、寄存器核对之前调用。失败会抛出。 */
      export async function runLinearMapCheck(): Promise<void> {
        const origin = BigInt(DataFloor + CoreCount * SlotBits);
        const limit = BigInt(LineBits);
        const line = BigInt(UnitCount) * BigInt(UnitSizeBytes) * 8n;
        if (machineMap().origin !== origin || machineMap().limit !== limit || limit !== line) {
          fail("the map arena is not the free tail of the bit line");
        }
        if ((limit - origin) / 8n < BigInt(FontFileOctets)) {
          fail("the map arena cannot hold a font file");
        }
        if (machineMap().liveCount() !== 0) {
          fail("the machine map was not empty at boot");
        }

        const map = createLinearMap(origin, origin + BigInt(PageBytes * 3) * 8n);
        if (map.map(1, 2, 0) !== null || map.map(1, 2, -1) !== null || map.map(-1, 2, 8) !== null) {
          fail("an illegal map was accepted");
        }
        const address = map.map(7, 9, 100);
        if (address === null || address !== origin || address % 8n !== 0n) {
          fail("the first map did not start at the arena");
        }
        if (map.liveCount() !== 1) {
          fail("a successful map was not live");
        }

        const trace = { carries: 0 };
        const written: bigint[] = [];
        const carry = (page: { readonly count: number; readonly offset: number; readonly port: number; readonly handle: number }): Promise<Uint8Array | null> => {
          trace.carries += 1;
          if (page.port !== 7 || page.handle !== 9 || page.offset !== 0 || page.count !== 100) {
            fail("the first page request was not the file prefix");
          }
          const bytes = new Uint8Array(page.count);
          bytes[0] = 0x41;
          return Promise.resolve(bytes);
        };
        await bringIn(map, address, 1, carry, (at, bytes): void => {
          written.push(at);
          if (bytes.length !== 100 || bytes[0] !== 0x41) {
            fail("the page was not written in full");
          }
        });
        if (trace.carries !== 1 || written.length !== 1) {
          fail("the first touch did not carry exactly one page");
        }
        await bringIn(map, address + 8n, 1, (): Promise<Uint8Array | null> => {
          fail("a resident page was carried again");
        }, (): void => {
          fail("a resident page was written again");
        });

        const across = map.touch(address - 8n, 2);
        if (across.kind !== "fault") {
          fail("a read crossing into the arena was treated as ram");
        }
        const below = map.touch(0n, 1);
        if (below.kind !== "ram") {
          fail("ordinary ram was treated as a map");
        }

        if (map.unmap(address, 99) || map.unmap(address + 8n, 100)) {
          fail("a mismatched unmap succeeded");
        }
        if (map.touch(address, 1).kind !== "ready") {
          fail("a rejected unmap dropped the page");
        }
        const region = map.region(address, 100);
        if (region === null) {
          fail("the live map had no region");
        }
        if (region.octets !== PageBytes) {
          fail("the reserved length was not rounded up to a page");
        }
        if (!map.unmap(address, 100) || map.unmap(address, 100)) {
          fail("unmap did not remove the map exactly once");
        }
        if (map.touch(address, 1).kind !== "fault") {
          fail("a read after unmap still succeeded");
        }

        const again = map.map(7, 9, 100);
        if (again === null) {
          fail("the arena did not accept another map");
        }
        if (createLinearMap(origin, origin + 8n).map(1, 1, 1) !== null) {
          fail("a map larger than the arena was accepted");
        }
        const traceWide = { noted: false, rejected: false };
        const wide = createLinearMap(origin, origin + BigInt(PageBytes * 2) * 8n);
        const wideAddress = wide.map(3, 4, PageBytes + 1);
        if (wideAddress === null) {
          fail("a two-page map was rejected");
        }
        let second = 0;
        try {
          await bringIn(
            wide,
            wideAddress,
            PageBytes + 1,
            (page): Promise<Uint8Array | null> => {
              if (page.offset === 0) {
                return Promise.resolve(new Uint8Array(page.count));
              }
              second += 1;
              return Promise.resolve(null);
            },
            (): void => {
              traceWide.noted = true;
            },
          );
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "";
          traceWide.rejected = message.includes("map request was rejected");
        }
        if (!traceWide.rejected || second !== 1) {
          fail("a short carry was accepted");
        }
        if (wide.touch(wideAddress, 1).kind !== "ready") {
          fail("the completed page was fetched again");
        }
        if (wide.touch(wideAddress + BigInt(PageBytes) * 8n, 1).kind !== "fill") {
          fail("the failed page was marked resident");
        }
        if (!traceWide.noted) {
          fail("the completed page was not written");
        }
      }
    }
  }
}
