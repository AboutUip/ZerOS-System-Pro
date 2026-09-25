/**
 * @module ZerOS.Hardware.Cpu.CpuInstruction
 * @description 通用指令的文本形式
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 把一行 ZAP 收成一条指令，或把一条指令写回 ZAP。
 * ZAP 是汇编语言的简称。这些行不是机器码字节。
 * 不执行指令，也不访问存储。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 指令
 *   3. 文本
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as OpcodeRoot } from "../../Motherboard/Enum/MemoryOpcode";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      const MemoryOpcodeLoadBit = OpcodeRoot.Hardware.Motherboard.MemoryOpcodeLoadBit;
      const MemoryOpcodeStoreBit = OpcodeRoot.Hardware.Motherboard.MemoryOpcodeStoreBit;
      const MemoryOpcodeLoadOctet = OpcodeRoot.Hardware.Motherboard.MemoryOpcodeLoadOctet;
      const MemoryOpcodeStoreOctet = OpcodeRoot.Hardware.Motherboard.MemoryOpcodeStoreOctet;
      const MemoryOpcodeLoad16 = OpcodeRoot.Hardware.Motherboard.MemoryOpcodeLoad16;
      const MemoryOpcodeStore16 = OpcodeRoot.Hardware.Motherboard.MemoryOpcodeStore16;
      const MemoryOpcodeLoad32 = OpcodeRoot.Hardware.Motherboard.MemoryOpcodeLoad32;
      const MemoryOpcodeStore32 = OpcodeRoot.Hardware.Motherboard.MemoryOpcodeStore32;
      const MemoryOpcodeLoad64 = OpcodeRoot.Hardware.Motherboard.MemoryOpcodeLoad64;
      const MemoryOpcodeStore64 = OpcodeRoot.Hardware.Motherboard.MemoryOpcodeStore64;
      const MemoryOpcodeLoadFloat32 = OpcodeRoot.Hardware.Motherboard.MemoryOpcodeLoadFloat32;
      const MemoryOpcodeStoreFloat32 = OpcodeRoot.Hardware.Motherboard.MemoryOpcodeStoreFloat32;
      const MemoryOpcodeLoadFloat64 = OpcodeRoot.Hardware.Motherboard.MemoryOpcodeLoadFloat64;
      const MemoryOpcodeStoreFloat64 = OpcodeRoot.Hardware.Motherboard.MemoryOpcodeStoreFloat64;

      /** 一条 ZAP 指令。 */
      export type CpuInstruction =
        | { readonly Op: "place"; readonly Register: number; readonly Data: bigint }
        | { readonly Op: "add"; readonly Destination: number; readonly Left: number; readonly Right: number }
        | { readonly Op: "load"; readonly Opcode: number; readonly Address: bigint; readonly Register: number }
        | { readonly Op: "store"; readonly Opcode: number; readonly Address: bigint; readonly Register: number }
        | { readonly Op: "gpu.clear"; readonly Register: number }
        | { readonly Op: "gpu.plot"; readonly X: number; readonly Y: number; readonly Pixel: number }
        | {
          readonly Op: "gpu.character";
          readonly X: number;
          readonly Y: number;
          readonly Code: number;
          readonly Foreground: number;
          readonly Background: number;
        }
        | { readonly Op: "gpu.present" }
        | { readonly Op: "gpu.compose" }
        | { readonly Op: "gpu.box"; readonly Register: number; readonly Parent: number; readonly X: number; readonly Y: number; readonly Width: number; readonly Height: number; readonly Fill: number }
        | { readonly Op: "gpu.text"; readonly Register: number; readonly Parent: number; readonly X: number; readonly Y: number; readonly Width: number; readonly Height: number }
        | { readonly Op: "gpu.align"; readonly Node: number; readonly AlignX: number; readonly AlignY: number }
        | { readonly Op: "gpu.paint"; readonly Node: number; readonly Foreground: number; readonly Background: number }
        | { readonly Op: "gpu.glyph"; readonly Node: number; readonly Code: number }
        | { readonly Op: "gpu.drop"; readonly Node: number }
        | { readonly Op: "gpu.hertz"; readonly Hertz: number }
        | { readonly Op: "gpu.metric"; readonly Register: number; readonly Kind: number }
        | { readonly Op: "gpu.load"; readonly Register: number; readonly Address: number }
        | { readonly Op: "gpu.store"; readonly Address: number; readonly Value: number }
        | { readonly Op: "mem.hertz"; readonly Hertz: number }
        | { readonly Op: "mem.metric"; readonly Register: number; readonly Kind: number }
        | { readonly Op: "hertz"; readonly Ordinal: number; readonly Hertz: number }
        | { readonly Op: "metric"; readonly Register: number; readonly Ordinal: number; readonly Kind: number }
        | { readonly Op: "eq"; readonly Destination: number; readonly Left: number; readonly Right: number }
        | { readonly Op: "sub"; readonly Destination: number; readonly Left: number; readonly Right: number }
        | { readonly Op: "udiv"; readonly Destination: number; readonly Left: number; readonly Right: number }
        | { readonly Op: "umod"; readonly Destination: number; readonly Left: number; readonly Right: number }
        | { readonly Op: "mul"; readonly Destination: number; readonly Left: number; readonly Right: number }
        | { readonly Op: "div"; readonly Destination: number; readonly Left: number; readonly Right: number }
        | { readonly Op: "mod"; readonly Destination: number; readonly Left: number; readonly Right: number }
        | { readonly Op: "and"; readonly Destination: number; readonly Left: number; readonly Right: number }
        | { readonly Op: "or"; readonly Destination: number; readonly Left: number; readonly Right: number }
        | { readonly Op: "xor"; readonly Destination: number; readonly Left: number; readonly Right: number }
        | { readonly Op: "shl"; readonly Destination: number; readonly Left: number; readonly Right: number }
        | { readonly Op: "shr"; readonly Destination: number; readonly Left: number; readonly Right: number }
        | { readonly Op: "fadd"; readonly Destination: number; readonly Left: number; readonly Right: number }
        | { readonly Op: "fsub"; readonly Destination: number; readonly Left: number; readonly Right: number }
        | { readonly Op: "fmul"; readonly Destination: number; readonly Left: number; readonly Right: number }
        | { readonly Op: "fdiv"; readonly Destination: number; readonly Left: number; readonly Right: number }
        | { readonly Op: "fpow"; readonly Destination: number; readonly Left: number; readonly Right: number }
        | { readonly Op: "fmod"; readonly Destination: number; readonly Left: number; readonly Right: number }
        | { readonly Op: "lt"; readonly Destination: number; readonly Left: number; readonly Right: number }
        | { readonly Op: "le"; readonly Destination: number; readonly Left: number; readonly Right: number }
        | { readonly Op: "gt"; readonly Destination: number; readonly Left: number; readonly Right: number }
        | { readonly Op: "ge"; readonly Destination: number; readonly Left: number; readonly Right: number }
        | { readonly Op: "feq"; readonly Destination: number; readonly Left: number; readonly Right: number }
        | { readonly Op: "not"; readonly Destination: number; readonly Source: number }
        | { readonly Op: "itof"; readonly Destination: number; readonly Source: number }
        | { readonly Op: "call"; readonly Register: number; readonly Target: number }
        | { readonly Op: "ret"; readonly Register: number }
        | { readonly Op: "jz"; readonly Condition: number; readonly Target: number }
        | { readonly Op: "jnz"; readonly Condition: number; readonly Target: number }
        | { readonly Op: "link"; readonly Register: number; readonly Target: number }
        | { readonly Op: "jmp"; readonly Register: number }
        | { readonly Op: "inbox"; readonly Found: number; readonly Value: number }
        | { readonly Op: "xchg"; readonly Port: number; readonly Direction: number; readonly Data: number }
        | { readonly Op: "port.state"; readonly Destination: number; readonly Port: number }
        | { readonly Op: "port.char"; readonly Destination: number; readonly Port: number; readonly Offset: number }
        | { readonly Op: "port.byte"; readonly Destination: number; readonly Port: number; readonly Field: number; readonly Offset: number }
        | { readonly Op: "query"; readonly Register: number; readonly Seat: number; readonly Field: number; readonly Index: number }
        | { readonly Op: "ldi"; readonly Opcode: number; readonly Register: number; readonly Address: number }
        | { readonly Op: "sti"; readonly Opcode: number; readonly Register: number; readonly Address: number }
        | { readonly Op: "halt" };

      const loadMnemonic: Readonly<Record<string, number>> = {
        "load.bit": MemoryOpcodeLoadBit,
        "load.octet": MemoryOpcodeLoadOctet,
        "load.16": MemoryOpcodeLoad16,
        "load.32": MemoryOpcodeLoad32,
        "load.64": MemoryOpcodeLoad64,
        "load.f32": MemoryOpcodeLoadFloat32,
        "load.f64": MemoryOpcodeLoadFloat64,
      };

      const storeMnemonic: Readonly<Record<string, number>> = {
        "store.bit": MemoryOpcodeStoreBit,
        "store.octet": MemoryOpcodeStoreOctet,
        "store.16": MemoryOpcodeStore16,
        "store.32": MemoryOpcodeStore32,
        "store.64": MemoryOpcodeStore64,
        "store.f32": MemoryOpcodeStoreFloat32,
        "store.f64": MemoryOpcodeStoreFloat64,
      };

      function indirectLoadOpcode(head: string): number | null {
        if (head === "ldi.octet") {
          return MemoryOpcodeLoadOctet;
        }
        if (head === "ldi.16") {
          return MemoryOpcodeLoad16;
        }
        if (head === "ldi.32") {
          return MemoryOpcodeLoad32;
        }
        if (head === "ldi.64") {
          return MemoryOpcodeLoad64;
        }
        if (head === "ldi.f32") {
          return MemoryOpcodeLoadFloat32;
        }
        if (head === "ldi.f64") {
          return MemoryOpcodeLoadFloat64;
        }
        return null;
      }

      function indirectStoreOpcode(head: string): number | null {
        if (head === "sti.octet") {
          return MemoryOpcodeStoreOctet;
        }
        if (head === "sti.16") {
          return MemoryOpcodeStore16;
        }
        if (head === "sti.32") {
          return MemoryOpcodeStore32;
        }
        if (head === "sti.64") {
          return MemoryOpcodeStore64;
        }
        if (head === "sti.f32") {
          return MemoryOpcodeStoreFloat32;
        }
        if (head === "sti.f64") {
          return MemoryOpcodeStoreFloat64;
        }
        return null;
      }

      function indirectLoadMnemonic(opcode: number): string {
        if (opcode === MemoryOpcodeLoad16) {
          return "ldi.16";
        }
        if (opcode === MemoryOpcodeLoad32) {
          return "ldi.32";
        }
        if (opcode === MemoryOpcodeLoad64) {
          return "ldi.64";
        }
        if (opcode === MemoryOpcodeLoadFloat32) {
          return "ldi.f32";
        }
        if (opcode === MemoryOpcodeLoadFloat64) {
          return "ldi.f64";
        }
        return "ldi.octet";
      }

      function indirectStoreMnemonic(opcode: number): string {
        if (opcode === MemoryOpcodeStore16) {
          return "sti.16";
        }
        if (opcode === MemoryOpcodeStore32) {
          return "sti.32";
        }
        if (opcode === MemoryOpcodeStore64) {
          return "sti.64";
        }
        if (opcode === MemoryOpcodeStoreFloat32) {
          return "sti.f32";
        }
        if (opcode === MemoryOpcodeStoreFloat64) {
          return "sti.f64";
        }
        return "sti.octet";
      }

      function registerOf(token: string): number | null {
        if (!token.startsWith("r")) {
          return null;
        }
        const text = token.slice(1);
        if (text.length < 1 || !/^[0-9]+$/u.test(text)) {
          return null;
        }
        const value = Number(text);
        if (!Number.isInteger(value) || value < 0 || value > 7) {
          return null;
        }
        return value;
      }

      function integerOf(token: string): bigint | null {
        if (token.startsWith("-")) {
          const magnitude = integerOf(token.slice(1));
          if (magnitude === null) {
            return null;
          }
          return -magnitude;
        }
        if (/^0x[0-9a-fA-F]+$/u.test(token)) {
          return BigInt(token);
        }
        if (/^[0-9]+$/u.test(token)) {
          return BigInt(token);
        }
        return null;
      }

      /**
       * 解析一行。空行返回 null。无法识别时抛出。
       * 逗号和空白只作分隔，不构成另一种语法。
       */
      export function parseCpuInstruction(line: string): CpuInstruction | null {
        const trimmed = line.trim();
        if (trimmed.length < 1) {
          return null;
        }
        const parts = trimmed.split(/[\s,]+/u).filter((part): boolean => part.length > 0);
        const head = parts[0];
        if (head === undefined) {
          return null;
        }
        if (head === "halt" && parts.length === 1) {
          return { Op: "halt" };
        }
        if (head === "gpu.present" && parts.length === 1) {
          return { Op: "gpu.present" };
        }
        if (head === "gpu.compose" && parts.length === 1) {
          return { Op: "gpu.compose" };
        }
        if (head === "gpu.drop" && parts.length === 2) {
          const node = registerOf(parts[1] ?? "");
          if (node === null) {
            throw new Error(`[ZerOS.Hardware.Cpu.CpuInstruction] 无法解析 ${trimmed}`);
          }
          return { Op: "gpu.drop", Node: node };
        }
        if (head === "gpu.hertz" && parts.length === 2) {
          const hertz = registerOf(parts[1] ?? "");
          if (hertz === null) {
            throw new Error(`[ZerOS.Hardware.Cpu.CpuInstruction] 无法解析 ${trimmed}`);
          }
          return { Op: "gpu.hertz", Hertz: hertz };
        }
        if (head === "gpu.metric" && parts.length === 3) {
          const register = registerOf(parts[1] ?? "");
          const kind = registerOf(parts[2] ?? "");
          if (register === null || kind === null) {
            throw new Error(`[ZerOS.Hardware.Cpu.CpuInstruction] 无法解析 ${trimmed}`);
          }
          return { Op: "gpu.metric", Register: register, Kind: kind };
        }
        if (head === "gpu.load" && parts.length === 3) {
          const register = registerOf(parts[1] ?? "");
          const address = registerOf(parts[2] ?? "");
          if (register === null || address === null) {
            throw new Error(`[ZerOS.Hardware.Cpu.CpuInstruction] 无法解析 ${trimmed}`);
          }
          return { Op: "gpu.load", Register: register, Address: address };
        }
        if (head === "gpu.store" && parts.length === 3) {
          const address = registerOf(parts[1] ?? "");
          const value = registerOf(parts[2] ?? "");
          if (address === null || value === null) {
            throw new Error(`[ZerOS.Hardware.Cpu.CpuInstruction] 无法解析 ${trimmed}`);
          }
          return { Op: "gpu.store", Address: address, Value: value };
        }
        if (head === "mem.hertz" && parts.length === 2) {
          const hertz = registerOf(parts[1] ?? "");
          if (hertz === null) {
            throw new Error(`[ZerOS.Hardware.Cpu.CpuInstruction] 无法解析 ${trimmed}`);
          }
          return { Op: "mem.hertz", Hertz: hertz };
        }
        if (head === "mem.metric" && parts.length === 3) {
          const register = registerOf(parts[1] ?? "");
          const kind = registerOf(parts[2] ?? "");
          if (register === null || kind === null) {
            throw new Error(`[ZerOS.Hardware.Cpu.CpuInstruction] 无法解析 ${trimmed}`);
          }
          return { Op: "mem.metric", Register: register, Kind: kind };
        }
        if (head === "hertz" && parts.length === 3) {
          const ordinal = registerOf(parts[1] ?? "");
          const hertz = registerOf(parts[2] ?? "");
          if (ordinal === null || hertz === null) {
            throw new Error(`[ZerOS.Hardware.Cpu.CpuInstruction] 无法解析 ${trimmed}`);
          }
          return { Op: "hertz", Ordinal: ordinal, Hertz: hertz };
        }
        if (head === "metric" && parts.length === 4) {
          const register = registerOf(parts[1] ?? "");
          const ordinal = registerOf(parts[2] ?? "");
          const kind = registerOf(parts[3] ?? "");
          if (register === null || ordinal === null || kind === null) {
            throw new Error(`[ZerOS.Hardware.Cpu.CpuInstruction] 无法解析 ${trimmed}`);
          }
          return { Op: "metric", Register: register, Ordinal: ordinal, Kind: kind };
        }
        if (head === "eq" && parts.length === 4) {
          const destination = registerOf(parts[1] ?? "");
          const left = registerOf(parts[2] ?? "");
          const right = registerOf(parts[3] ?? "");
          if (destination === null || left === null || right === null) {
            throw new Error(`[ZerOS.Hardware.Cpu.CpuInstruction] 无法解析 ${trimmed}`);
          }
          return { Op: "eq", Destination: destination, Left: left, Right: right };
        }
        if ((head === "sub" || head === "udiv" || head === "umod" || head === "mul" || head === "div" || head === "mod" || head === "and" || head === "or" || head === "xor" || head === "shl" || head === "shr" || head === "fadd" || head === "fsub" || head === "fmul" || head === "fdiv" || head === "fpow" || head === "fmod" || head === "lt" || head === "le" || head === "gt" || head === "ge" || head === "feq") && parts.length === 4) {
          const destination = registerOf(parts[1] ?? "");
          const left = registerOf(parts[2] ?? "");
          const right = registerOf(parts[3] ?? "");
          if (destination === null || left === null || right === null) {
            throw new Error(`[ZerOS.Hardware.Cpu.CpuInstruction] 无法解析 ${trimmed}`);
          }
          return { Op: head, Destination: destination, Left: left, Right: right };
        }
        if ((head === "not" || head === "itof") && parts.length === 3) {
          const destination = registerOf(parts[1] ?? "");
          const source = registerOf(parts[2] ?? "");
          if (destination === null || source === null) {
            throw new Error(`[ZerOS.Hardware.Cpu.CpuInstruction] 无法解析 ${trimmed}`);
          }
          return { Op: head === "itof" ? "itof" : "not", Destination: destination, Source: source };
        }
        if ((head === "link" || head === "call") && parts.length === 3) {
          const register = registerOf(parts[1] ?? "");
          const target = integerOf(parts[2] ?? "");
          if (register === null || target === null || target > 0xffffffffn) {
            throw new Error(`[ZerOS.Hardware.Cpu.CpuInstruction] 无法解析 ${trimmed}`);
          }
          return { Op: head === "call" ? "call" : "link", Register: register, Target: Number(target) };
        }
        if ((head === "jmp" || head === "ret") && parts.length === 2) {
          const register = registerOf(parts[1] ?? "");
          if (register === null) {
            throw new Error(`[ZerOS.Hardware.Cpu.CpuInstruction] 无法解析 ${trimmed}`);
          }
          return { Op: head === "ret" ? "ret" : "jmp", Register: register };
        }
        const indirectLoad = indirectLoadOpcode(head);
        const indirectStore = indirectStoreOpcode(head);
        if (indirectLoad !== null && parts.length === 3) {
          const register = registerOf(parts[1] ?? "");
          const address = registerOf(parts[2] ?? "");
          if (register === null || address === null) {
            throw new Error(`[ZerOS.Hardware.Cpu.CpuInstruction] 无法解析 ${trimmed}`);
          }
          return { Op: "ldi", Opcode: indirectLoad, Register: register, Address: address };
        }
        if (indirectStore !== null && parts.length === 3) {
          const register = registerOf(parts[1] ?? "");
          const address = registerOf(parts[2] ?? "");
          if (register === null || address === null) {
            throw new Error(`[ZerOS.Hardware.Cpu.CpuInstruction] 无法解析 ${trimmed}`);
          }
          return { Op: "sti", Opcode: indirectStore, Register: register, Address: address };
        }
        if (head === "query" && parts.length === 5) {
          const register = registerOf(parts[1] ?? "");
          const seat = registerOf(parts[2] ?? "");
          const field = registerOf(parts[3] ?? "");
          const index = registerOf(parts[4] ?? "");
          if (register === null || seat === null || field === null || index === null) {
            throw new Error(`[ZerOS.Hardware.Cpu.CpuInstruction] 无法解析 ${trimmed}`);
          }
          return { Op: "query", Register: register, Seat: seat, Field: field, Index: index };
        }
        if (head === "port.byte" && parts.length === 5) {
          const destination = registerOf(parts[1] ?? "");
          const port = registerOf(parts[2] ?? "");
          const field = registerOf(parts[3] ?? "");
          const offset = registerOf(parts[4] ?? "");
          if (destination === null || port === null || field === null || offset === null) {
            throw new Error(`[ZerOS.Hardware.Cpu.CpuInstruction] 无法解析 ${trimmed}`);
          }
          return { Op: "port.byte", Destination: destination, Port: port, Field: field, Offset: offset };
        }
        if ((head === "jz" || head === "jnz") && parts.length === 3) {
          const condition = registerOf(parts[1] ?? "");
          const target = integerOf(parts[2] ?? "");
          if (condition === null || target === null || target > 0xffffffffn) {
            throw new Error(`[ZerOS.Hardware.Cpu.CpuInstruction] 无法解析 ${trimmed}`);
          }
          return { Op: head, Condition: condition, Target: Number(target) };
        }
        if (head === "inbox" && parts.length === 3) {
          const found = registerOf(parts[1] ?? "");
          const value = registerOf(parts[2] ?? "");
          if (found === null || value === null) {
            throw new Error(`[ZerOS.Hardware.Cpu.CpuInstruction] 无法解析 ${trimmed}`);
          }
          return { Op: "inbox", Found: found, Value: value };
        }
        if (head === "xchg" && parts.length === 4) {
          const port = registerOf(parts[1] ?? "");
          const direction = registerOf(parts[2] ?? "");
          const data = registerOf(parts[3] ?? "");
          if (port === null || direction === null || data === null) {
            throw new Error(`[ZerOS.Hardware.Cpu.CpuInstruction] 无法解析 ${trimmed}`);
          }
          return { Op: "xchg", Port: port, Direction: direction, Data: data };
        }
        if (head === "port.state" && parts.length === 3) {
          const destination = registerOf(parts[1] ?? "");
          const port = registerOf(parts[2] ?? "");
          if (destination === null || port === null) {
            throw new Error(`[ZerOS.Hardware.Cpu.CpuInstruction] 无法解析 ${trimmed}`);
          }
          return { Op: "port.state", Destination: destination, Port: port };
        }
        if (head === "port.char" && parts.length === 4) {
          const destination = registerOf(parts[1] ?? "");
          const port = registerOf(parts[2] ?? "");
          const offset = registerOf(parts[3] ?? "");
          if (destination === null || port === null || offset === null) {
            throw new Error(`[ZerOS.Hardware.Cpu.CpuInstruction] 无法解析 ${trimmed}`);
          }
          return { Op: "port.char", Destination: destination, Port: port, Offset: offset };
        }
        if (head === "place" && parts.length === 3) {
          const register = registerOf(parts[1] ?? "");
          const data = integerOf(parts[2] ?? "");
          if (register === null || data === null) {
            throw new Error(`[ZerOS.Hardware.Cpu.CpuInstruction] 无法解析 ${trimmed}`);
          }
          return { Op: "place", Register: register, Data: data };
        }
        if (head === "add" && parts.length === 4) {
          const destination = registerOf(parts[1] ?? "");
          const left = registerOf(parts[2] ?? "");
          const right = registerOf(parts[3] ?? "");
          if (destination === null || left === null || right === null) {
            throw new Error(`[ZerOS.Hardware.Cpu.CpuInstruction] 无法解析 ${trimmed}`);
          }
          return { Op: "add", Destination: destination, Left: left, Right: right };
        }
        const loadOpcode = loadMnemonic[head];
        if (loadOpcode !== undefined && parts.length === 3) {
          const register = registerOf(parts[1] ?? "");
          const address = integerOf(parts[2] ?? "");
          if (register === null || address === null) {
            throw new Error(`[ZerOS.Hardware.Cpu.CpuInstruction] 无法解析 ${trimmed}`);
          }
          return { Op: "load", Opcode: loadOpcode, Address: address, Register: register };
        }
        const storeOpcode = storeMnemonic[head];
        if (storeOpcode !== undefined && parts.length === 3) {
          const register = registerOf(parts[1] ?? "");
          const address = integerOf(parts[2] ?? "");
          if (register === null || address === null) {
            throw new Error(`[ZerOS.Hardware.Cpu.CpuInstruction] 无法解析 ${trimmed}`);
          }
          return { Op: "store", Opcode: storeOpcode, Address: address, Register: register };
        }
        if (head === "gpu.clear" && parts.length === 2) {
          const register = registerOf(parts[1] ?? "");
          if (register === null) {
            throw new Error(`[ZerOS.Hardware.Cpu.CpuInstruction] 无法解析 ${trimmed}`);
          }
          return { Op: "gpu.clear", Register: register };
        }
        if (head === "gpu.plot" && parts.length === 4) {
          const x = registerOf(parts[1] ?? "");
          const y = registerOf(parts[2] ?? "");
          const pixel = registerOf(parts[3] ?? "");
          if (x === null || y === null || pixel === null) {
            throw new Error(`[ZerOS.Hardware.Cpu.CpuInstruction] 无法解析 ${trimmed}`);
          }
          return { Op: "gpu.plot", X: x, Y: y, Pixel: pixel };
        }
        if (head === "gpu.character" && parts.length === 6) {
          const x = registerOf(parts[1] ?? "");
          const y = registerOf(parts[2] ?? "");
          const code = registerOf(parts[3] ?? "");
          const foreground = registerOf(parts[4] ?? "");
          const background = registerOf(parts[5] ?? "");
          if (x === null || y === null || code === null || foreground === null || background === null) {
            throw new Error(`[ZerOS.Hardware.Cpu.CpuInstruction] 无法解析 ${trimmed}`);
          }
          return { Op: "gpu.character", X: x, Y: y, Code: code, Foreground: foreground, Background: background };
        }
        if (head === "gpu.box" && parts.length === 8) {
          const register = registerOf(parts[1] ?? "");
          const parent = registerOf(parts[2] ?? "");
          const x = registerOf(parts[3] ?? "");
          const y = registerOf(parts[4] ?? "");
          const width = registerOf(parts[5] ?? "");
          const height = registerOf(parts[6] ?? "");
          const fill = registerOf(parts[7] ?? "");
          if (register === null || parent === null || x === null || y === null || width === null || height === null || fill === null) {
            throw new Error(`[ZerOS.Hardware.Cpu.CpuInstruction] 无法解析 ${trimmed}`);
          }
          return { Op: "gpu.box", Register: register, Parent: parent, X: x, Y: y, Width: width, Height: height, Fill: fill };
        }
        if (head === "gpu.text" && parts.length === 7) {
          const register = registerOf(parts[1] ?? "");
          const parent = registerOf(parts[2] ?? "");
          const x = registerOf(parts[3] ?? "");
          const y = registerOf(parts[4] ?? "");
          const width = registerOf(parts[5] ?? "");
          const height = registerOf(parts[6] ?? "");
          if (register === null || parent === null || x === null || y === null || width === null || height === null) {
            throw new Error(`[ZerOS.Hardware.Cpu.CpuInstruction] 无法解析 ${trimmed}`);
          }
          return { Op: "gpu.text", Register: register, Parent: parent, X: x, Y: y, Width: width, Height: height };
        }
        if (head === "gpu.align" && parts.length === 4) {
          const node = registerOf(parts[1] ?? "");
          const alignX = registerOf(parts[2] ?? "");
          const alignY = registerOf(parts[3] ?? "");
          if (node === null || alignX === null || alignY === null) {
            throw new Error(`[ZerOS.Hardware.Cpu.CpuInstruction] 无法解析 ${trimmed}`);
          }
          return { Op: "gpu.align", Node: node, AlignX: alignX, AlignY: alignY };
        }
        if (head === "gpu.paint" && parts.length === 4) {
          const node = registerOf(parts[1] ?? "");
          const foreground = registerOf(parts[2] ?? "");
          const background = registerOf(parts[3] ?? "");
          if (node === null || foreground === null || background === null) {
            throw new Error(`[ZerOS.Hardware.Cpu.CpuInstruction] 无法解析 ${trimmed}`);
          }
          return { Op: "gpu.paint", Node: node, Foreground: foreground, Background: background };
        }
        if (head === "gpu.glyph" && parts.length === 3) {
          const node = registerOf(parts[1] ?? "");
          const code = registerOf(parts[2] ?? "");
          if (node === null || code === null) {
            throw new Error(`[ZerOS.Hardware.Cpu.CpuInstruction] 无法解析 ${trimmed}`);
          }
          return { Op: "gpu.glyph", Node: node, Code: code };
        }
        throw new Error(`[ZerOS.Hardware.Cpu.CpuInstruction] 无法解析 ${trimmed}`);
      }

      /** 把一条指令写回一行 ZAP。调试时这一行和通道访问并在一起。 */
      export function formatCpuInstruction(instruction: CpuInstruction): string {
        if (instruction.Op === "halt") {
          return "halt";
        }
        if (instruction.Op === "gpu.present") {
          return "gpu.present";
        }
        if (instruction.Op === "gpu.compose") {
          return "gpu.compose";
        }
        if (instruction.Op === "gpu.drop") {
          return `gpu.drop r${String(instruction.Node)}`;
        }
        if (instruction.Op === "gpu.hertz") {
          return `gpu.hertz r${String(instruction.Hertz)}`;
        }
        if (instruction.Op === "gpu.metric") {
          return `gpu.metric r${String(instruction.Register)}, r${String(instruction.Kind)}`;
        }
        if (instruction.Op === "gpu.load") {
          return `gpu.load r${String(instruction.Register)}, r${String(instruction.Address)}`;
        }
        if (instruction.Op === "gpu.store") {
          return `gpu.store r${String(instruction.Address)}, r${String(instruction.Value)}`;
        }
        if (instruction.Op === "mem.hertz") {
          return `mem.hertz r${String(instruction.Hertz)}`;
        }
        if (instruction.Op === "mem.metric") {
          return `mem.metric r${String(instruction.Register)}, r${String(instruction.Kind)}`;
        }
        if (instruction.Op === "hertz") {
          return `hertz r${String(instruction.Ordinal)}, r${String(instruction.Hertz)}`;
        }
        if (instruction.Op === "metric") {
          return `metric r${String(instruction.Register)}, r${String(instruction.Ordinal)}, r${String(instruction.Kind)}`;
        }
        if (instruction.Op === "eq") {
          return `eq r${String(instruction.Destination)}, r${String(instruction.Left)}, r${String(instruction.Right)}`;
        }
        if (instruction.Op === "sub" || instruction.Op === "udiv" || instruction.Op === "umod" || instruction.Op === "mul" || instruction.Op === "div" || instruction.Op === "mod" || instruction.Op === "and" || instruction.Op === "or" || instruction.Op === "xor" || instruction.Op === "shl" || instruction.Op === "shr" || instruction.Op === "fadd" || instruction.Op === "fsub" || instruction.Op === "fmul" || instruction.Op === "fdiv" || instruction.Op === "fpow" || instruction.Op === "fmod" || instruction.Op === "lt" || instruction.Op === "le" || instruction.Op === "gt" || instruction.Op === "ge" || instruction.Op === "feq") {
          return `${instruction.Op} r${String(instruction.Destination)}, r${String(instruction.Left)}, r${String(instruction.Right)}`;
        }
        if (instruction.Op === "not" || instruction.Op === "itof") {
          return `${instruction.Op} r${String(instruction.Destination)}, r${String(instruction.Source)}`;
        }
        if (instruction.Op === "link" || instruction.Op === "call") {
          return `${instruction.Op} r${String(instruction.Register)}, ${String(instruction.Target)}`;
        }
        if (instruction.Op === "jmp" || instruction.Op === "ret") {
          return `${instruction.Op} r${String(instruction.Register)}`;
        }
        if (instruction.Op === "ldi") {
          return `${indirectLoadMnemonic(instruction.Opcode)} r${String(instruction.Register)}, r${String(instruction.Address)}`;
        }
        if (instruction.Op === "sti") {
          return `${indirectStoreMnemonic(instruction.Opcode)} r${String(instruction.Register)}, r${String(instruction.Address)}`;
        }
        if (instruction.Op === "query") {
          return `query r${String(instruction.Register)}, r${String(instruction.Seat)}, r${String(instruction.Field)}, r${String(instruction.Index)}`;
        }
        if (instruction.Op === "port.byte") {
          return `port.byte r${String(instruction.Destination)}, r${String(instruction.Port)}, r${String(instruction.Field)}, r${String(instruction.Offset)}`;
        }
        if (instruction.Op === "jz" || instruction.Op === "jnz") {
          return `${instruction.Op} r${String(instruction.Condition)}, ${String(instruction.Target)}`;
        }
        if (instruction.Op === "inbox") {
          return `inbox r${String(instruction.Found)}, r${String(instruction.Value)}`;
        }
        if (instruction.Op === "xchg") {
          return `xchg r${String(instruction.Port)}, r${String(instruction.Direction)}, r${String(instruction.Data)}`;
        }
        if (instruction.Op === "port.state") {
          return `port.state r${String(instruction.Destination)}, r${String(instruction.Port)}`;
        }
        if (instruction.Op === "port.char") {
          return `port.char r${String(instruction.Destination)}, r${String(instruction.Port)}, r${String(instruction.Offset)}`;
        }
        if (instruction.Op === "gpu.box") {
          return `gpu.box r${String(instruction.Register)}, r${String(instruction.Parent)}, r${String(instruction.X)}, r${String(instruction.Y)}, r${String(instruction.Width)}, r${String(instruction.Height)}, r${String(instruction.Fill)}`;
        }
        if (instruction.Op === "gpu.text") {
          return `gpu.text r${String(instruction.Register)}, r${String(instruction.Parent)}, r${String(instruction.X)}, r${String(instruction.Y)}, r${String(instruction.Width)}, r${String(instruction.Height)}`;
        }
        if (instruction.Op === "gpu.align") {
          return `gpu.align r${String(instruction.Node)}, r${String(instruction.AlignX)}, r${String(instruction.AlignY)}`;
        }
        if (instruction.Op === "gpu.paint") {
          return `gpu.paint r${String(instruction.Node)}, r${String(instruction.Foreground)}, r${String(instruction.Background)}`;
        }
        if (instruction.Op === "gpu.glyph") {
          return `gpu.glyph r${String(instruction.Node)}, r${String(instruction.Code)}`;
        }
        if (instruction.Op === "place") {
          return `place r${String(instruction.Register)}, ${String(instruction.Data)}`;
        }
        if (instruction.Op === "add") {
          return `add r${String(instruction.Destination)}, r${String(instruction.Left)}, r${String(instruction.Right)}`;
        }
        if (instruction.Op === "gpu.clear") {
          return `gpu.clear r${String(instruction.Register)}`;
        }
        if (instruction.Op === "gpu.plot") {
          return `gpu.plot r${String(instruction.X)}, r${String(instruction.Y)}, r${String(instruction.Pixel)}`;
        }
        if (instruction.Op === "gpu.character") {
          return `gpu.character r${String(instruction.X)}, r${String(instruction.Y)}, r${String(instruction.Code)}, r${String(instruction.Foreground)}, r${String(instruction.Background)}`;
        }
        if (instruction.Op === "load") {
          let mnemonic = "load";
          for (const key of Object.keys(loadMnemonic)) {
            if (loadMnemonic[key] === instruction.Opcode) {
              mnemonic = key;
            }
          }
          return `${mnemonic} r${String(instruction.Register)}, ${String(instruction.Address)}`;
        }
        let mnemonic = "store";
        for (const key of Object.keys(storeMnemonic)) {
          if (storeMnemonic[key] === instruction.Opcode) {
            mnemonic = key;
          }
        }
        return `${mnemonic} r${String(instruction.Register)}, ${String(instruction.Address)}`;
      }
    }
  }
}
