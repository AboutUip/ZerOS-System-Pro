/**
 * @module ZerOS.Hardware.Debug.DebugMap
 * @description 指令编号到源文件行的对照
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 解析 obrc -debug 写下的 obr-debug 1 对照表，并按指令编号查出文件名、行号和函数名。
 * 对照表不进程序二进制。查不到时源位置保持 `-`，不编造文件名。
 * 全路径不进面板。只留文件名，避免把本机目录画到屏幕上。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 对照
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { type ZerOS as FaultRoot } from "../../Cpu/Structure/FaultRecord";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Debug {
      type FaultRecord = FaultRoot.Hardware.Cpu.FaultRecord;

      /* ------------------------------------------------------------------ */
      /* 2. 对照                                                             */
      /* ------------------------------------------------------------------ */

      /** 一段连续指令共用同一个源位置。Until 是开区间。 */
      export interface DebugSiteRun {
        readonly From: number;
        readonly Until: number;
        readonly File: string;
        readonly Line: number;
        readonly Name: string;
      }

      function baseName(file: string): string {
        const slash = Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\"));
        const base = slash >= 0 ? file.slice(slash + 1) : file;
        let out = "";
        for (let index = 0; index < base.length && out.length < 40; index += 1) {
          const code = base.charCodeAt(index);
          if (code >= 0x20 && code <= 0x7e) {
            out += base.charAt(index);
          }
        }
        return out.length > 0 ? out : "unknown.obr";
      }

      function asciiName(name: string): string {
        let out = "";
        for (let index = 0; index < name.length && out.length < 32; index += 1) {
          const code = name.charCodeAt(index);
          if (code >= 0x20 && code <= 0x7e) {
            out += name.charAt(index);
          }
        }
        return out.length > 0 ? out : "unknown";
      }

      /**
       * 把对照表正文收成连续段。
       * 首行不是 obr-debug 1，或某一行缺字段，整份当作没有对照，避免半份表把编号对错。
       */
      export function parseDebugText(text: string): readonly DebugSiteRun[] {
        const lines = text.split("\n");
        const header = lines[0] ?? "";
        if (header.trim() !== "obr-debug 1") {
          return [];
        }
        const runs: DebugSiteRun[] = [];
        let from = -1;
        let until = -1;
        let file = "";
        let lineNo = 0;
        let name = "";
        for (let index = 1; index < lines.length; index += 1) {
          const line = lines[index] ?? "";
          if (line.length < 1) {
            continue;
          }
          const parts = line.split("\t");
          if (parts.length < 4) {
            return [];
          }
          const at = Number(parts[0]);
          const row = Number(parts[2]);
          const nextFile = baseName(parts[1] ?? "");
          const nextName = asciiName(parts[3] ?? "");
          if (!Number.isInteger(at) || at < 0 || !Number.isInteger(row) || row < 1) {
            return [];
          }
          const same = from >= 0 && at === until && nextFile === file && row === lineNo && nextName === name;
          if (same) {
            until = at + 1;
            continue;
          }
          if (from >= 0) {
            runs.push({ From: from, Until: until, File: file, Line: lineNo, Name: name });
          }
          from = at;
          until = at + 1;
          file = nextFile;
          lineNo = row;
          name = nextName;
        }
        if (from >= 0) {
          runs.push({ From: from, Until: until, File: file, Line: lineNo, Name: name });
        }
        return runs;
      }

      /** 线程消息里的紧凑数组。不合格的段丢掉，不让一份坏数据挡启动。 */
      export function readDebugSites(value: unknown): readonly DebugSiteRun[] {
        if (!Array.isArray(value)) {
          return [];
        }
        const runs: DebugSiteRun[] = [];
        for (const item of value) {
          if (!Array.isArray(item) || item.length < 5) {
            continue;
          }
          const row = item as readonly unknown[];
          const from = row[0];
          const until = row[1];
          const file = row[2];
          const line = row[3];
          const name = row[4];
          if (typeof from !== "number" || typeof until !== "number" || typeof file !== "string" || typeof line !== "number" || typeof name !== "string") {
            continue;
          }
          if (!Number.isInteger(from) || !Number.isInteger(until) || until <= from || !Number.isInteger(line) || line < 1) {
            continue;
          }
          runs.push({
            From: from,
            Until: until,
            File: baseName(file),
            Line: line,
            Name: asciiName(name),
          });
        }
        return runs;
      }

      /** 按编号查出 `文件:行 函数`。没有这一段时是 `-`。 */
      export function lookupSite(runs: readonly DebugSiteRun[], index: number): string {
        if (!Number.isInteger(index) || index < 0) {
          return "-";
        }
        let low = 0;
        let high = runs.length - 1;
        while (low <= high) {
          const mid = low + Math.floor((high - low) / 2);
          const run = runs[mid];
          if (run === undefined) {
            return "-";
          }
          if (index < run.From) {
            high = mid - 1;
            continue;
          }
          if (index >= run.Until) {
            low = mid + 1;
            continue;
          }
          const site = `${run.File}:${String(run.Line)} ${run.Name}`;
          return site.length > 80 ? site.slice(0, 80) : site;
        }
        return "-";
      }

      /**
       * 记录里还是 `-` 时，用这一核的对照表补上源位置。
       * 已经有源位置就不改，避免调试运行覆盖调用方写明的位置。
       */
      export function applySite(
        record: FaultRecord,
        maps: ReadonlyMap<number, readonly DebugSiteRun[]>,
      ): FaultRecord {
        if (record.Site !== "-") {
          return record;
        }
        const runs = maps.get(record.Core);
        if (runs === undefined) {
          return record;
        }
        const site = lookupSite(runs, record.Index);
        if (site === "-") {
          return record;
        }
        return { ...record, Site: site };
      }
    }
  }
}
