/**
 * ZerOS-PRO 工具链 · Vite 配置
 *
 * 职责：仅服务编译 / 开发服 / 产物输出。
 * 产品源码在 ../ZerOS-PRO，禁止把依赖与 Dist 写入产品树。
 */
import path from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const toolchainDir: string = path.dirname(fileURLToPath(import.meta.url));
const repoRoot: string = path.resolve(toolchainDir, "..");
const productRoot: string = path.resolve(repoRoot, "ZerOS-PRO");
const displayRoot: string = path.resolve(productRoot, "Hardware/Display");

/**
 * 主板线程和内存线程之间的共享信箱要求页面跨源隔离。这是宿主头，不是硬件协议。
 */
function isolationHeaders(): Record<string, string> {
  return {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
  };
}

const boardDispatch = path.resolve(productRoot, "Hardware/Motherboard/Host/BoardDispatch.ts");
const memoryDispatch = path.resolve(productRoot, "Hardware/Memory/Host/MemoryDispatch.ts");
const cpuDispatch = path.resolve(productRoot, "Hardware/Cpu/Host/CpuDispatch.ts");
const coreDispatch = path.resolve(productRoot, "Hardware/Cpu/Host/CoreDispatch.ts");
const gpuDispatch = path.resolve(productRoot, "Hardware/Gpu/Host/GpuDispatch.ts");

/**
 * 构建时把两条线程的入口打成独立脚本，并改写引导里的模块地址。
 * 开发服仍按 TypeScript 源文件地址装载，不在这里改。
 */
function threadEntryPlugin(): Plugin {
  return {
    name: "zeros-thread-entry",
    apply: "build",
    enforce: "pre",
    transform(code: string, id: string): string | null {
      const file = id.split("?")[0] ?? id;
      if (!file.endsWith("QueuedWorker.ts")) {
        return null;
      }
      return code
        .replaceAll('"./BoardDispatch.ts"', '"./BoardDispatch.js"')
        .replaceAll('"../../Memory/Host/MemoryDispatch.ts"', '"./MemoryDispatch.js"')
        .replaceAll('"../../Cpu/Host/CpuDispatch.ts"', '"./CpuDispatch.js"')
        .replaceAll('"../../Cpu/Host/CoreDispatch.ts"', '"./CoreDispatch.js"')
        .replaceAll('"../../Gpu/Host/GpuDispatch.ts"', '"./GpuDispatch.js"');
    },
  };
}

/**
 * 源码正文只有画布。模块脚本由工具链在提供页面时插入，不属于显示器内容。
 */
function displayHostPlugin(): Plugin {
  return {
    name: "zeros-display-host",
    transformIndexHtml: {
      order: "pre",
      handler(html: string): string {
        const script = '<script type="module" src="./Host/PageHost.ts"></script>';
        if (html.includes(script)) {
          return html;
        }
        return html.replace("</body>", `${script}</body>`);
      },
    },
  };
}

const firmwareModule = "zeros-boot-firmware";
const firmwareResolved = "\0zeros-boot-firmware";

/**
 * 当前系统上的宿主编译器。
 * CMake 的目标名是 obrc，并把可执行文件写到本目录：Windows 是 obrc.exe，其它系统是 obrc。
 * 不读取 build/ 里的副本。
 */
function hostCompilerPath(): string {
  const fileName = process.platform === "win32" ? "obrc.exe" : "obrc";
  return path.resolve(repoRoot, "Compiler/ObrCompiler", fileName);
}

/**
 * 用已经编好的宿主编译器把上电前就必须在的三份固件收成程序。
 * Logo 在探针和扩展口之前跑完并停机，画出第一帧。Bios 留在核心 0。
 * Load 按核心 3 的槽编译，倒计时结束后才读 NAS。三份同时存在，不能合成一个，也不放到 NAS。
 * 交给页面的是无扩展名二进制。旁边的 .debug 只用来收失败帧的源位置，不打进页面包，CPU 不读它。
 * 这里不写 .zap。文本对照要人手用 -zap 另编。
 * Vite 不调用 g++。产品源码只导入虚拟模块，不写产物路径。
 * 源文件变了就再编译并整页重载。
 */
function obrFirmwarePlugin(): Plugin {
  const outputDir = path.resolve(toolchainDir, "Zap");
  const gpuHeader = path.resolve(productRoot, "Hardware/Gpu");
  const driverHeader = path.resolve(repoRoot, "Driver/Gpu");
  const boardHeader = path.resolve(productRoot, "Hardware/Motherboard");
  const memoryHeader = path.resolve(productRoot, "Hardware/Memory");
  const gpuDriver = path.resolve(driverHeader, "gl.obr");
  const jobs: readonly {
    readonly sources: readonly string[];
    readonly output: string;
    readonly exportName: string;
    readonly slot?: number;
  }[] = [
    {
      sources: [
        path.resolve(productRoot, "Boot/Bios.obr"),
        path.resolve(productRoot, "Boot/Keys.obr"),
        path.resolve(productRoot, "Boot/Splash.obr"),
        path.resolve(productRoot, "Boot/Panel.obr"),
        path.resolve(productRoot, "Boot/Clear.obr"),
        path.resolve(repoRoot, "Driver/Pointer/pointer.obr"),
        path.resolve(repoRoot, "Compiler/ObrCompiler/lib/obr.widget.obr"),
        path.resolve(repoRoot, "Compiler/ObrCompiler/lib/obr.nas.obr"),
        path.resolve(repoRoot, "Driver/Display/panel.obr"),
        gpuDriver,
      ],
      output: path.resolve(outputDir, "Bios"),
      exportName: "biosProgram",
    },
    {
      sources: [path.resolve(productRoot, "Boot/Logo.obr"), gpuDriver],
      output: path.resolve(outputDir, "Logo"),
      exportName: "logoProgram",
    },
    {
      sources: [
        path.resolve(productRoot, "Boot/Load.obr"),
        path.resolve(repoRoot, "Compiler/ObrCompiler/lib/obr.nas.obr"),
      ],
      output: path.resolve(outputDir, "Load"),
      exportName: "loadProgram",
      slot: 3,
    },
  ];

  const compile = (): void => {
    const compiler = hostCompilerPath();
    if (!existsSync(compiler)) {
      throw new Error(`找不到宿主编译器 ${compiler}。请在当前系统用 C++20 编译 Compiler/ObrCompiler。`);
    }
    mkdirSync(outputDir, { recursive: true });
    for (const job of jobs) {
      const result = spawnSync(
        compiler,
        [
          ...job.sources,
          "-I",
          gpuHeader,
          "-I",
          driverHeader,
          "-I",
          boardHeader,
          "-I",
          memoryHeader,
          ...(job.slot === undefined ? [] : ["-slot", String(job.slot)]),
          "-debug",
          "-o",
          job.output,
        ],
        { encoding: "utf8" },
      );
      if (result.status !== 0) {
        const detail = (result.stderr || result.stdout || result.error?.message || "obrc 失败").trim();
        throw new Error(detail);
      }
      const listing = `${job.output}.zap`;
      if (existsSync(listing)) {
        unlinkSync(listing);
      }
    }
  };

  const bytesOf = (file: string): number[] => Array.from(readFileSync(file));

  /**
   * 把 obr-debug 1 收成连续段，避免把整份对照表嵌进页面。
   * 只留文件名。全路径不进失败帧。
   */
  const compactSites = (binaryPath: string): (readonly [number, number, string, number, string])[] => {
    const debugPath = `${binaryPath}.debug`;
    if (!existsSync(debugPath)) {
      return [];
    }
    const lines = readFileSync(debugPath, "utf8").split("\n");
    const header = lines[0] ?? "";
    if (header.trim() !== "obr-debug 1") {
      return [];
    }
    const runs: (readonly [number, number, string, number, string])[] = [];
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
        continue;
      }
      const at = Number(parts[0]);
      const row = Number(parts[2]);
      const full = parts[1] ?? "";
      const slash = Math.max(full.lastIndexOf("/"), full.lastIndexOf("\\"));
      const nextFile = slash >= 0 ? full.slice(slash + 1) : full;
      const nextName = parts[3] ?? "";
      /* 开头几条没有源文件。跳过，不能因此把后面整份对照表丢掉。 */
      if (!Number.isInteger(at) || at < 0 || !Number.isInteger(row) || row < 1 || nextFile.length < 1 || nextName.length < 1) {
        continue;
      }
      if (from >= 0 && at === until && nextFile === file && row === lineNo && nextName === name) {
        until = at + 1;
        continue;
      }
      if (from >= 0) {
        runs.push([from, until, file, lineNo, name]);
      }
      from = at;
      until = at + 1;
      file = nextFile;
      lineNo = row;
      name = nextName;
    }
    if (from >= 0) {
      runs.push([from, until, file, lineNo, name]);
    }
    return runs;
  };

  return {
    name: "zeros-obr-firmware",
    buildStart(): void {
      compile();
    },
    configureServer(server): void {
      compile();
      const watched = jobs.flatMap((job): readonly string[] => job.sources);
      watched.push(path.resolve(gpuHeader, "gpu.mr"), path.resolve(driverHeader, "gl.mr"), path.resolve(boardHeader, "board.mr"), path.resolve(memoryHeader, "memory.mr"), path.resolve(productRoot, "Boot/firmware.mr"), path.resolve(repoRoot, "Compiler/ObrCompiler/lib/obr.widget.mr"));
      server.watcher.add(watched);
    },
    resolveId(id: string): string | null {
      if (id === firmwareModule) {
        return firmwareResolved;
      }
      return null;
    },
    load(id: string): string | null {
      if (id !== firmwareResolved) {
        return null;
      }
      compile();
      return jobs
        .map((job): string => {
          const bytes = `export const ${job.exportName} = ${JSON.stringify(bytesOf(job.output))};`;
          const sites = `export const ${job.exportName}Sites = ${JSON.stringify(compactSites(job.output))};`;
          return `${bytes}\n${sites}`;
        })
        .join("\n");
    },
    handleHotUpdate(context) {
      const file = context.file.split("?")[0] ?? context.file;
      if (!file.endsWith(".obr") && !file.endsWith(".mr")) {
        return undefined;
      }
      compile();
      const firmware = context.server.moduleGraph.getModuleById(firmwareResolved);
      if (firmware) {
        context.server.moduleGraph.invalidateModule(firmware);
      }
      context.server.ws.send({ type: "full-reload" });
      return [];
    },
  };
}

export default defineConfig({
  root: displayRoot,
  publicDir: false,
  plugins: [obrFirmwarePlugin(), threadEntryPlugin(), displayHostPlugin()],
  resolve: {
    alias: {
      "@ZerOS-PRO": productRoot,
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    headers: isolationHeaders(),
    fs: {
      allow: [repoRoot, productRoot, toolchainDir, displayRoot],
    },
  },
  preview: {
    headers: isolationHeaders(),
  },
  build: {
    outDir: path.resolve(toolchainDir, "Dist"),
    emptyOutDir: true,
    modulePreload: false,
    rollupOptions: {
      preserveEntrySignatures: "strict",
      input: {
        index: path.resolve(displayRoot, "index.html"),
        BoardDispatch: boardDispatch,
        MemoryDispatch: memoryDispatch,
        CpuDispatch: cpuDispatch,
        CoreDispatch: coreDispatch,
        GpuDispatch: gpuDispatch,
      },
      output: {
        entryFileNames(chunkInfo): string {
          if (
            chunkInfo.name === "BoardDispatch"
            || chunkInfo.name === "MemoryDispatch"
            || chunkInfo.name === "CpuDispatch"
            || chunkInfo.name === "CoreDispatch"
            || chunkInfo.name === "GpuDispatch"
          ) {
            return "assets/[name].js";
          }
          return "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
      },
    },
  },
});
