/**
 * @module ZerOS.Hardware.Motherboard.HardwareQuery
 * @description 把已经坐上的硬件字段读成一个整数
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 查询指令的主板侧。CPU 自己的字段不经过这里。
 * 不解释这些数是给设置画面还是给别的程序。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 记录
 *   3. 查询
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as BoardSupportRoot } from "../Config/BoardSupport";
import { ZerOS as ExpansionConfigRoot } from "../Config/ExpansionConfig";
import { ZerOS as GpuSeatRoot } from "../Seat/GpuSeat";
import { ZerOS as PortRoot } from "../Slot/Expansion/ExpansionPort";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      const PortCount = ExpansionConfigRoot.Hardware.Motherboard.ExpansionConfig.PortCount;
      const FieldChar = PortRoot.Hardware.Motherboard.Slot.FieldChar;
      const State = PortRoot.Hardware.Motherboard.Slot.State;
      const gpuInfo = GpuSeatRoot.Hardware.Motherboard.gpuInfo;
      const queryPrefix = "[ZerOS.Hardware.Motherboard.HardwareQuery]";

      const protocols: readonly string[] = [
        BoardSupportRoot.Hardware.Motherboard.SupportedMemoryProtocols[0] ?? "",
        BoardSupportRoot.Hardware.Motherboard.SupportedCpuProtocols[0] ?? "",
        BoardSupportRoot.Hardware.Motherboard.SupportedGpuProtocols[0] ?? "",
        BoardSupportRoot.Hardware.Motherboard.SupportedExpansionProtocols[0] ?? "",
        BoardSupportRoot.Hardware.Motherboard.SupportedExchangeProtocols[0] ?? "",
      ];

      let memoryId = "";
      let memoryVendor = "";
      let memoryProtocol = "";
      let memoryInit = 0;
      let memoryDrawn = 0;
      let memoryHertz = 0;
      let memoryExecuted = 0;
      let panelWidth = 0;
      let panelHeight = 0;
      let panelHertz = 0;

      function fail(message: string): never {
        throw new Error(`${queryPrefix} ${message}`);
      }

      function charAt(text: string, index: number): bigint {
        if (!Number.isInteger(index) || index < 0 || index >= text.length) {
          return 0n;
        }
        return BigInt(text.charCodeAt(index));
      }

      /** 内存线程上电成功后交来的观测。前五行是标识，后两行是 Hz 与已完成条数。 */
      export function noteMemory(text: string): void {
        const lines = text.split("\n");
        memoryId = lines[0] ?? "";
        memoryVendor = lines[1] ?? "";
        memoryProtocol = lines[2] ?? "";
        memoryInit = lines[3] === "1" ? 1 : 0;
        memoryDrawn = lines[4] === "1" ? 1 : 0;
        const hertz = Number(lines[5]);
        const executed = Number(lines[6]);
        if (Number.isInteger(hertz)) {
          memoryHertz = hertz;
        }
        if (Number.isInteger(executed)) {
          memoryExecuted = executed;
        }
      }

      /** 一次访问或改频率之后，信箱文本里的两行。 */
      export function noteMemoryPace(text: string): void {
        const lines = text.split("\n");
        const hertz = Number(lines[0]);
        const executed = Number(lines[1]);
        if (Number.isInteger(hertz)) {
          memoryHertz = hertz;
        }
        if (Number.isInteger(executed)) {
          memoryExecuted = executed;
        }
      }

      /** 页面报来的面板宽、高和刷新率。 */
      export function notePanel(width: number, height: number, hertz: number): void {
        if (!Number.isInteger(width) || !Number.isInteger(height) || !Number.isInteger(hertz)) {
          return;
        }
        panelWidth = width;
        panelHeight = height;
        panelHertz = hertz;
      }

      /**
       * 读一个字段。座位 1 由 CPU 线程自己回答，这里不接受。
       * 字符读过末尾时返回 0，不失败。
       */
      export function queryHardware(seat: number, field: number, index: number): bigint {
        if (!Number.isInteger(seat) || !Number.isInteger(field) || !Number.isInteger(index) || index < 0) {
          fail("查询参数不合法");
        }
        if (seat === 0) {
          if (field === 0) {
            return BigInt(PortCount);
          }
          if (field === 1) {
            return BigInt(protocols.length);
          }
          if (field === 2) {
            const ordinal = Math.floor(index / 8);
            const offset = index % 8;
            return charAt(protocols[ordinal] ?? "", offset);
          }
        }
        if (seat === 2) {
          if (field === 0) {
            return BigInt(memoryInit);
          }
          if (field === 1) {
            return BigInt(memoryDrawn);
          }
          if (field === 2) {
            return charAt(memoryId, index);
          }
          if (field === 3) {
            return charAt(memoryVendor, index);
          }
          if (field === 4) {
            return charAt(memoryProtocol, index);
          }
          if (field === 5) {
            return BigInt(memoryHertz);
          }
          if (field === 6) {
            return BigInt(memoryExecuted);
          }
        }
        if (seat === 3) {
          const gpu = gpuInfo();
          if (field === 0) {
            return BigInt(gpu.width);
          }
          if (field === 1) {
            return BigInt(gpu.height);
          }
          if (field === 2) {
            return charAt(gpu.id, index);
          }
          if (field === 3) {
            return charAt(gpu.vendor, index);
          }
          if (field === 4) {
            return charAt(gpu.protocol, index);
          }
          if (field === 5) {
            return BigInt(gpu.memoryBytes);
          }
          if (field === 6) {
            return BigInt(gpu.hertz);
          }
          if (field === 7) {
            return BigInt(gpu.executed);
          }
        }
        if (seat === 4) {
          if (field === 0) {
            return BigInt(panelWidth);
          }
          if (field === 1) {
            return BigInt(panelHeight);
          }
          if (field === 2) {
            return BigInt(panelHertz);
          }
        }
        if (seat === 5) {
          if (field === 0) {
            return BigInt(State(index));
          }
          if (field === 1 || field === 2 || field === 3) {
            const port = Math.floor(index / 64);
            const offset = index % 64;
            return BigInt(FieldChar(port, field - 1, offset));
          }
        }
        fail("没有这种硬件字段");
      }
    }
  }
}
