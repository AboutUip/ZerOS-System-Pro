/**
 * @module ZerOS.Hardware.Motherboard.FaultGlassCheck
 * @description 失败帧、调试开关和源位置的上电核对
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 通电之前跑完。任一断言失败就抛出，主板不会通电。
 * 核对每一档错误码和来源都能画进协议规定的行，显卡来源不送面板，
 * 调试开关关闭时不挂全局入口，对照表能按指令编号查出文件名。
 * 不执行这些画面指令，也不启动核心。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. runFaultGlassCheck
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as PictureRoot } from "../Host/ErrorPicture";
import { ZerOS as DeliveryRoot } from "../Host/FaultDelivery";
import { ZerOS as FaultRoot } from "../../Cpu/Structure/FaultRecord";
import { ZerOS as SourceRoot } from "../../Cpu/Enum/FaultSource";
import { ZerOS as MapRoot } from "../../Debug/Host/DebugMap";
import { ZerOS as RunRoot } from "../../Debug/Host/DebugRun";
import { ZerOS as SurfaceRoot } from "../../Debug/Host/DebugSurface";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      const errorPicture = PictureRoot.Hardware.Motherboard.errorPicture;
      const faultChannel = DeliveryRoot.Hardware.Motherboard.faultChannel;
      const faultFromText = FaultRoot.Hardware.Cpu.faultFromText;
      const faultFromWire = FaultRoot.Hardware.Cpu.faultFromWire;
      const formatSevere = FaultRoot.Hardware.Cpu.formatSevere;
      const FaultSourceName = SourceRoot.Hardware.Cpu.FaultSourceName;
      const FaultSourceLast = SourceRoot.Hardware.Cpu.FaultSourceLast;
      const parseDebugText = MapRoot.Hardware.Debug.parseDebugText;
      const lookupSite = MapRoot.Hardware.Debug.lookupSite;
      const applySite = MapRoot.Hardware.Debug.applySite;
      const readDebugSites = MapRoot.Hardware.Debug.readDebugSites;
      const debugRunDecision = RunRoot.Hardware.Debug.debugRunDecision;
      const installDebugSurface = SurfaceRoot.Hardware.Debug.installDebugSurface;
      const checkPrefix = "[ZerOS.Hardware.Motherboard.FaultGlassCheck]";

      function fail(message: string): never {
        throw new Error(`${checkPrefix} ${message}`);
      }

      /** 只收紧挨着 gpu.glyph 的那个字符。坐标用的 place 不跟 glyph，不会混进来。 */
      function painted(lines: readonly string[]): string[] {
        const blocks: string[] = [];
        let current = "";
        let open = false;
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index] ?? "";
          if (line.startsWith("gpu.text")) {
            if (open) {
              blocks.push(current);
            }
            current = "";
            open = true;
            continue;
          }
          if (line !== "gpu.glyph r7, r1") {
            continue;
          }
          const matched = /^place r1, (\d+)$/.exec(lines[index - 1] ?? "");
          const code = matched?.[1];
          if (code === undefined) {
            fail("a glyph was not preceded by its code point");
          }
          current += String.fromCharCode(Number(code));
        }
        if (open) {
          blocks.push(current);
        }
        return blocks;
      }

      function assertAscii(text: string, label: string): void {
        for (let index = 0; index < text.length; index += 1) {
          const code = text.charCodeAt(index);
          if (code < 0x20 || code > 0x7e) {
            fail(`${label} drew a character outside ASCII`);
          }
        }
      }

      /**
       * 通电前的失败帧和调试入口核对。
       * 调试开关两种取值都要能过：关闭时全局没有入口，打开时入口在，且运行仍受文本限制。
       */
      export async function runFaultGlassCheck(): Promise<void> {
        const sample = faultFromWire({
          message: "schedule found no program",
          code: 14,
          source: 1,
          core: 2,
          index: 40,
          op: "schedule",
          site: "Bios.obr:15 loading",
          stack: ["at boot", "at main", "at third", "at fourth", "at fifth"],
          window: true,
        });
        const lines = errorPicture(sample);
        if (!lines.includes("gpu.present") || !lines.includes("halt") || !lines.includes("place r5, 0") || !lines.includes("place r1, 16777215")) {
          fail("the fault frame is missing the clear, the white ink, or the present");
        }
        const blocks = painted(lines);
        const expected = [
          "ERROR",
          "CODE 14",
          "SRC 1 Cpu",
          "CORE 2",
          "AT 40 schedule",
          "SITE Bios.obr:15 loading",
          "schedule found no program",
          "STACK at boot",
          "STACK at main",
          "STACK at third",
          "STACK at fourth",
        ];
        if (blocks.length !== expected.length) {
          fail(`the fault frame has ${String(blocks.length)} text blocks`);
        }
        for (let index = 0; index < expected.length; index += 1) {
          if (blocks[index] !== expected[index]) {
            fail(`fault frame block ${String(index)} was ${blocks[index] ?? ""}`);
          }
          assertAscii(blocks[index] ?? "", `block ${String(index)}`);
        }
        if (blocks.some((block) => block.includes("HALT"))) {
          fail("the fault frame still says HALT");
        }
        const unnamed = faultFromWire({
          message: "x",
          code: 0,
          source: 0,
          core: -1,
          index: 0,
          op: "",
          site: "-",
          window: true,
        });
        const unnamedBlocks = painted(errorPicture(unnamed));
        if (unnamedBlocks[3] !== "CORE -" || unnamedBlocks[4] !== "AT 0" || unnamedBlocks[5] !== "SITE -") {
          fail("a fault without a core or an op was not labeled");
        }
        const aligned = faultFromText(
          "[ZerOS.Hardware.Motherboard.MemoryChannel] 宽度大于 1 时地址必须对齐到八位组",
          0,
          0,
          "",
          "",
        );
        if (aligned.Code !== 11 || aligned.Text.includes("?") || !aligned.Text.includes("not aligned")) {
          fail("a non-ASCII memory fault was not rewritten in English");
        }
        const alignedBlocks = painted(errorPicture(aligned));
        for (const block of alignedBlocks) {
          assertAscii(block, "aligned fault");
        }
        for (let code = 0; code <= 22; code += 1) {
          const frame = painted(errorPicture(faultFromWire({
            message: "n",
            code,
            source: 1,
            core: 0,
            index: 0,
            op: "halt",
            site: "-",
            window: true,
          })));
          if (frame[0] !== "ERROR" || frame[1] !== `CODE ${String(code)}`) {
            fail(`code ${String(code)} was not drawn`);
          }
        }
        for (let source = 0; source <= FaultSourceLast; source += 1) {
          const name = FaultSourceName[source] ?? "";
          const frame = painted(errorPicture(faultFromWire({
            message: "n",
            code: 0,
            source,
            core: 0,
            index: 0,
            op: "halt",
            site: "-",
            window: source !== 3,
          })));
          if (frame[2] !== `SRC ${String(source)} ${name}`) {
            fail(`source ${String(source)} was drawn as ${frame[2] ?? ""}`);
          }
        }
        const cafe = faultFromText("caf\u00e9", 0, 0, "", "");
        if (cafe.Text !== "caf?") {
          fail("a non-ASCII explanation was not replaced");
        }
        if (faultFromText("", -1, 0, "", "").Text !== "unspecified fault") {
          fail("an empty explanation was dropped");
        }
        const longText = "a".repeat(300);
        if (faultFromText(longText, 0, 0, "", "").Text.length !== 240) {
          fail("the explanation was not kept to 240 characters");
        }
        const wide = painted(errorPicture(faultFromText("b".repeat(90), 0, 1, "halt", "")));
        const body = wide[6] ?? "";
        if (body.length !== 90) {
          fail("a wrapped explanation was clipped");
        }
        const published = errorPicture(sample, 1024, 768);
        if (!published.includes("place r3, 1024") || !published.includes("place r4, 768")) {
          fail("the fault frame ignored the published size");
        }
        const crowded = faultFromWire({
          message: "install program image",
          code: 12,
          source: 1,
          core: 2,
          index: 4,
          op: "div",
          site: "-",
          stack: ["at fail (http://localhost:5173/@fs/D:/Project/Algorithm/ZerOS-System-Pro/ZerOS-PRO/Hardware/Cpu/Bootstrap/CpuRuntime.ts?t=1:20:3)"],
          window: true,
        });
        const crowdedBlocks = painted(errorPicture(crowded, 640, 480));
        const stack = crowdedBlocks.find((block) => block.startsWith("STACK "));
        if (stack === undefined || stack.length > 78 || stack.includes("http://") || !stack.includes("CpuRuntime.ts:20")) {
          fail("a long stack frame was not shortened to the frame");
        }
        const gpu = faultFromText("gpu command failed", 0, 3, "gpu.present", "");
        if (gpu.Code !== 10 || gpu.Source !== 3 || gpu.Window) {
          fail("a GPU failure was still marked as drawable");
        }
        if (
          faultChannel(gpu, false) !== "console"
          || faultChannel(gpu, true) !== "console"
          || faultChannel(sample, false) !== "draw"
          || faultChannel(sample, true) !== "drop"
        ) {
          fail("the fault channel was wrong");
        }
        const display = faultFromText("[ZerOS.Hardware.Display.PageHost] canvas is missing", -1, 0, "", "");
        if (display.Source !== 4 || display.Code !== 0 || !display.Window) {
          fail("a display failure was not kept on the window path");
        }
        const severe = formatSevere(sample);
        if (!severe.startsWith("ERROR code=14 source=1 core=2 at=40 op=schedule site=Bios.obr:15 loading text=")) {
          fail("the console line dropped a field");
        }
        if (!severe.includes("stack=at boot | at main")) {
          fail("the console line dropped the stack");
        }
        const mapText = [
          "obr-debug 1",
          "0\tD:\\Project\\Bios.obr\t15\tputnum",
          "1\tD:\\Project\\Bios.obr\t15\tputnum",
          "2\tD:\\Project\\Load.obr\t9\tmain",
          "",
        ].join("\n");
        const runs = parseDebugText(mapText);
        if (runs.length !== 2) {
          fail("adjacent sites were not merged");
        }
        if (lookupSite(runs, 1) !== "Bios.obr:15 putnum" || lookupSite(runs, 2) !== "Load.obr:9 main" || lookupSite(runs, 3) !== "-") {
          fail("a site lookup missed or invented a line");
        }
        if (parseDebugText("obr-debug 2\n").length !== 0 || parseDebugText("obr-debug 1\n0\tonly-three\n").length !== 0) {
          fail("a bad debug map was accepted");
        }
        const compact = readDebugSites([[0, 2, "D:\\Project\\Bios.obr", 15, "putnum"]]);
        const placed = applySite(faultFromText("register is outside 0 to 7", 0, 1, "load", ""), new Map([[0, compact]]));
        if (placed.Site !== "Bios.obr:15 putnum" || placed.Code !== 2) {
          fail("the site map did not fill a missing site");
        }
        if (debugRunDecision(false, ["halt"], true) !== "debug is off") {
          fail("debug run was allowed while the flag was off");
        }
        if (debugRunDecision(true, [], true) !== "debug run was refused") {
          fail("an empty debug run was allowed");
        }
        const many = new Array<string>(33).fill("halt");
        if (debugRunDecision(true, many, true) !== "debug run was refused") {
          fail("an overlong debug run was allowed");
        }
        if (debugRunDecision(true, [""], true) !== "debug run was refused") {
          fail("a blank debug line was allowed");
        }
        if (debugRunDecision(true, ["a".repeat(81)], true) !== "debug run was refused") {
          fail("a wide debug line was allowed");
        }
        if (debugRunDecision(true, ["halt\n"], true) !== "debug run was refused") {
          fail("a debug line with a control character was allowed");
        }
        if (debugRunDecision(true, ["halt"], false) !== "core 0 is not halted") {
          fail("debug run was allowed on a running core");
        }
        if (debugRunDecision(true, ["place r1, 1", "halt"], true) !== "") {
          fail("a short halted debug run was refused");
        }
        const quiet: object = {};
        installDebugSurface(quiet, false, {
          faults: () => [],
          last: () => null,
          stop: () => null,
          exchange: () => Promise.reject(new Error("exchange")),
          run: () => Promise.resolve("ran"),
        });
        if ("ZerOSDebug" in quiet) {
          fail("the debug surface was installed while disabled");
        }
        const loud: object = {};
        installDebugSurface(loud, true, {
          faults: () => [],
          last: () => null,
          stop: () => null,
          exchange: () => Promise.reject(new Error("exchange")),
          run: () => Promise.resolve("ran"),
        });
        const surface = loud as {
          ZerOSDebug?: {
            readonly run: (lines: readonly string[]) => Promise<string>;
            readonly eval?: unknown;
          };
        };
        if (surface.ZerOSDebug === undefined || surface.ZerOSDebug.eval !== undefined) {
          fail("the debug surface was missing or exposed eval");
        }
        if (Object.keys(loud).includes("ZerOSDebug")) {
          fail("the debug surface was enumerable");
        }
        const answer = await surface.ZerOSDebug.run(["halt"]);
        if (answer === "debug is off") {
          if ("ZerOSDebug" in globalThis) {
            fail("the page installed a debug surface while the flag is off");
          }
        } else if (answer === "ran") {
          if (!("ZerOSDebug" in globalThis)) {
            fail("an enabled flag did not expose the debug surface");
          }
        } else {
          fail("the debug surface returned an unexpected answer");
        }
      }
    }
  }
}
