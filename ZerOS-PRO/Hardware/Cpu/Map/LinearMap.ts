/**
 * @module ZerOS.Hardware.Cpu.LinearMap
 * @description 把扩展口句柄按页映射进线性位元
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 实现 ZCP1 的 mmap / munmap。映射区在全部核心窗口之上，和普通内存分开，
 * 卸下之后这段地址再读必须失败，即使字节还留在存储体里。
 * 某一页第一次被碰到时，调用方用一次搬运读入这一页属于 rN 的八位组。
 * 同一页记下之后，再读不再给出搬运请求。
 * 本文件不访问扩展口，也不写内存。搬运和清零由主板座位完成。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 一张映射表
 *   3. 这台机器的表
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as CpuConfigRoot } from "../Config/CpuConfig";
import { ZerOS as MapConfigRoot } from "../Config/MapConfig";
import { type ZerOS as TouchRoot } from "../Structure/MapTouch";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      const PageBytes = MapConfigRoot.Hardware.Cpu.Config.MapPageBytes;
      const LengthMin = MapConfigRoot.Hardware.Cpu.Config.MapLengthMin;
      const LengthMax = MapConfigRoot.Hardware.Cpu.Config.MapLengthMax;
      const DataFloor = CpuConfigRoot.Hardware.Cpu.Config.RelocateDataFloor;
      const SlotBits = CpuConfigRoot.Hardware.Cpu.Config.RelocateSlotBits;
      const CoreCount = CpuConfigRoot.Hardware.Cpu.Config.OfficialCoreCount;
      const MapEndBits = CpuConfigRoot.Hardware.Cpu.Config.MapEndBits;

      type FillPage = TouchRoot.Hardware.Cpu.FillPage;
      type MapTouch = TouchRoot.Hardware.Cpu.MapTouch;
      type MapRegion = TouchRoot.Hardware.Cpu.MapRegion;

      interface LiveMap {
        readonly address: bigint;
        readonly length: number;
        readonly pages: number;
        readonly port: number;
        readonly handle: number;
        readonly resident: boolean[];
      }

      /* ---------------------------------------------------------------------- */
      /* 2. 一张映射表                                                           */
      /* ---------------------------------------------------------------------- */

      export interface LinearMap {
        /** 映射区起点，含。位地址，8 对齐。 */
        readonly origin: bigint;
        /** 映射区终点，不含。 */
        readonly limit: bigint;
        /** 仍有效的映射个数。 */
        liveCount(): number;
        /**
         * 保留一段。成功返回起始位地址。
         * 长度、端口或句柄不合法，或映射区放不下，返回 null，表不动。
         */
        map(port: number, handle: number, length: number): bigint | null;
        /** 起始地址和当时的 rN 都对上才卸下。对不上返回 false，表不动。 */
        unmap(address: bigint, length: number): boolean;
        /** 卸下前要清掉的八位组范围。对不上返回 null。 */
        region(address: bigint, length: number): MapRegion | null;
        /** 这一段读或写要不要调页。不改表。 */
        touch(address: bigint, byteCount: number): MapTouch;
        /** 这一页已经完整写进线性位元。地址必须是 touch 给出的页起点。 */
        note(address: bigint): void;
        /** 丢掉全部映射。自检收尾用，不代替 munmap 的清零。 */
        forgetAll(): void;
      }

      /**
       * 建一张空表。
       * origin 必须 8 对齐，并且小于 limit。对不齐时后面的 map 都会失败。
       */
      export function createLinearMap(origin: bigint, limit: bigint): LinearMap {
        const live: LiveMap[] = [];
        const usable = origin >= 0n && origin % 8n === 0n && limit > origin;

        function pagesOf(length: number): number {
          return Math.ceil(length / PageBytes);
        }

        function find(address: bigint, length: number): LiveMap | null {
          for (const item of live) {
            if (item.address === address && item.length === length) {
              return item;
            }
          }
          return null;
        }

        function covering(address: bigint, end: bigint): LiveMap | null {
          for (const item of live) {
            const mapEnd = item.address + BigInt(item.pages * PageBytes) * 8n;
            if (address >= item.address && end <= mapEnd) {
              return item;
            }
          }
          return null;
        }

        return {
          origin,
          limit,
          liveCount(): number {
            return live.length;
          },
          map(port: number, handle: number, length: number): bigint | null {
            if (!usable) {
              return null;
            }
            if (!Number.isInteger(port) || port < 0 || !Number.isInteger(handle) || handle < 0) {
              return null;
            }
            if (!Number.isInteger(length) || length < LengthMin || length > LengthMax) {
              return null;
            }
            const pages = pagesOf(length);
            const bits = BigInt(pages * PageBytes) * 8n;
            const ordered = live.slice().sort((left, right): number => {
              if (left.address < right.address) {
                return -1;
              }
              if (left.address > right.address) {
                return 1;
              }
              return 0;
            });
            let at = origin;
            for (const item of ordered) {
              if (at + bits <= item.address) {
                break;
              }
              const itemEnd = item.address + BigInt(item.pages * PageBytes) * 8n;
              if (itemEnd > at) {
                at = itemEnd;
              }
            }
            if (at + bits > limit) {
              return null;
            }
            const resident: boolean[] = [];
            for (let page = 0; page < pages; page += 1) {
              resident.push(false);
            }
            live.push({ address: at, length, pages, port, handle, resident });
            return at;
          },
          unmap(address: bigint, length: number): boolean {
            if (!Number.isInteger(length)) {
              return false;
            }
            const index = live.findIndex((item): boolean => item.address === address && item.length === length);
            if (index < 0) {
              return false;
            }
            live.splice(index, 1);
            return true;
          },
          region(address: bigint, length: number): MapRegion | null {
            const item = Number.isInteger(length) ? find(address, length) : null;
            if (item === null) {
              return null;
            }
            return { address: item.address, octets: item.pages * PageBytes };
          },
          touch(address: bigint, byteCount: number): MapTouch {
            if (!Number.isInteger(byteCount) || byteCount < 1) {
              return { kind: "ram" };
            }
            const end = address + BigInt(byteCount) * 8n;
            if (end < address) {
              return { kind: "fault" };
            }
            /* 整段都在映射区下面，或整段都从终点起，才是普通内存。跨过边界不能当普通读。 */
            if (end <= origin || address >= limit) {
              return { kind: "ram" };
            }
            if (address < origin || end > limit) {
              return { kind: "fault" };
            }
            const item = covering(address, end);
            if (item === null) {
              return { kind: "fault" };
            }
            const startByte = Number((address - item.address) / 8n);
            const endByte = startByte + byteCount;
            const first = Math.floor(startByte / PageBytes);
            const last = Math.floor((endByte - 1) / PageBytes);
            const pages: FillPage[] = [];
            for (let page = first; page <= last; page += 1) {
              if (item.resident[page] === true) {
                continue;
              }
              const pageByte = page * PageBytes;
              const count = Math.min(PageBytes, item.length - pageByte);
              if (count < 1) {
                continue;
              }
              pages.push({
                port: item.port,
                handle: item.handle,
                offset: pageByte,
                address: item.address + BigInt(pageByte) * 8n,
                count,
              });
            }
            if (pages.length === 0) {
              return { kind: "ready" };
            }
            return { kind: "fill", pages };
          },
          note(address: bigint): void {
            for (const item of live) {
              if (address < item.address) {
                continue;
              }
              const pageByte = Number((address - item.address) / 8n);
              const page = Math.floor(pageByte / PageBytes);
              const slot = item.resident[page];
              if (slot !== undefined) {
                item.resident[page] = true;
                return;
              }
            }
          },
          forgetAll(): void {
            live.splice(0, live.length);
          },
        };
      }

      /**
       * 按查询结果把缺的页一次补齐。
       * 搬运返回的八位组个数必须正好是这一页的 count。少一个字节也不记成已调入，
       * 这样失败不会留下还能接着读的半页。全部写完才返回。
       */
      export async function bringIn(
        map: LinearMap,
        address: bigint,
        byteCount: number,
        carry: (page: FillPage) => Promise<Uint8Array | null>,
        write: (address: bigint, bytes: Uint8Array) => void,
      ): Promise<void> {
        const plan = map.touch(address, byteCount);
        if (plan.kind === "ram" || plan.kind === "ready") {
          return;
        }
        if (plan.kind === "fault") {
          throw new Error("map request was rejected");
        }
        for (const page of plan.pages) {
          const bytes = await carry(page);
          if (bytes === null) {
            throw new Error("map request was rejected");
          }
          if (bytes.length !== page.count) {
            throw new Error("map request was rejected");
          }
          write(page.address, bytes);
          map.note(page.address);
        }
      }

      /* ---------------------------------------------------------------------- */
      /* 3. 这台机器的表                                                         */
      /* ---------------------------------------------------------------------- */

      /**
       * 映射区从最后一颗核心的窗口终点开始，到兼容尾区之前为止。
       * 核心窗口里的栈和堆不会被 mmap 占走。尾区也不进这张表。
       */
      const machineOrigin = BigInt(DataFloor + CoreCount * SlotBits);
      const machineLimit = BigInt(MapEndBits);
      const machine = createLinearMap(machineOrigin, machineLimit);

      /** 主板和 mmap 指令共用这一张表。核心线程各有自己的模块副本，不能在那边记。 */
      export function machineMap(): LinearMap {
        return machine;
      }
    }
  }
}
