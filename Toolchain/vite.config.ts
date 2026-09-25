/**
 * ZerOS-PRO 工具链 · Vite 配置
 *
 * 职责：仅服务编译 / 开发服 / 产物输出。
 * 产品源码在 ../ZerOS-PRO，禁止把依赖与 Dist 写入产品树。
 */
import path from "node:path";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
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
 * 用已经编好的宿主编译器把 Boot 旁的 .obr 收成工具链目录里的文本。
 * Vite 不调用 g++。产品源码只导入虚拟模块，不写产物路径。
 * 源文件变了就再编译并整页重载。
 */
function obrFirmwarePlugin(): Plugin {
  const compiler = path.resolve(repoRoot, "Compiler/Obr/obrc.exe");
  const outputDir = path.resolve(toolchainDir, "Zap");
  const gpuHeader = path.resolve(productRoot, "Hardware/Gpu");
  const boardHeader = path.resolve(productRoot, "Hardware/Motherboard");
  const memoryHeader = path.resolve(productRoot, "Hardware/Memory");
  const jobs: readonly { readonly sources: readonly string[]; readonly output: string; readonly exportName: string }[] = [
    {
      sources: [path.resolve(productRoot, "Boot/Bios.obr"), path.resolve(productRoot, "Boot/Clear.obr")],
      output: path.resolve(outputDir, "Bios.zap"),
      exportName: "biosLines",
    },
    {
      sources: [path.resolve(productRoot, "Boot/Logo.obr")],
      output: path.resolve(outputDir, "Logo.zap"),
      exportName: "logoLines",
    },
  ];

  const compile = (): void => {
    mkdirSync(outputDir, { recursive: true });
    for (const job of jobs) {
      const result = spawnSync(
        compiler,
        [...job.sources, "-I", gpuHeader, "-I", boardHeader, "-I", memoryHeader, "-o", job.output],
        { encoding: "utf8" },
      );
      if (result.status !== 0) {
        const detail = (result.stderr || result.stdout || result.error?.message || "obrc 失败").trim();
        throw new Error(detail);
      }
    }
  };

  const linesOf = (file: string): string[] => {
    const text = readFileSync(file, "utf8");
    const lines: string[] = [];
    for (const raw of text.split("\n")) {
      const line = raw.endsWith("\r") ? raw.slice(0, -1).trim() : raw.trim();
      if (line.length > 0) {
        lines.push(line);
      }
    }
    return lines;
  };

  return {
    name: "zeros-obr-firmware",
    buildStart(): void {
      compile();
    },
    configureServer(server): void {
      compile();
      const watched = jobs.flatMap((job): readonly string[] => job.sources);
      watched.push(path.resolve(gpuHeader, "gpu.mr"), path.resolve(boardHeader, "board.mr"), path.resolve(memoryHeader, "memory.mr"), path.resolve(productRoot, "Boot/firmware.mr"));
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
        .map((job): string => `export const ${job.exportName} = ${JSON.stringify(linesOf(job.output))};`)
        .join("\n");
    },
    handleHotUpdate(context) {
      const file = context.file.split("?")[0] ?? context.file;
      if (!file.endsWith(".obr") && !file.endsWith(".mr")) {
        return undefined;
      }
      compile();
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
