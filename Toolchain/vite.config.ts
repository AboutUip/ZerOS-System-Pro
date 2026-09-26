/**
 * ZerOS-PRO 工具链 · Vite 配置
 *
 * 职责：仅服务编译 / 开发服 / 产物输出。
 * 产品源码在 ../ZerOS-PRO，禁止把依赖与 Dist 写入产品树。
 */
import path from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
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
 * CMake 的目标名是 obrc：Windows 产出 obrc.exe，其它系统产出不带扩展名的 obrc。
 */
function hostCompilerPath(): string {
  const fileName = process.platform === "win32" ? "obrc.exe" : "obrc";
  return path.resolve(repoRoot, "Compiler/Obr", fileName);
}

/**
 * 用已经编好的宿主编译器把 Boot 旁的 .obr 收成程序。
 * 交给页面的是无扩展名二进制。旁边的 .zap 只留在工具链目录里，用来对照指令。
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
  const jobs: readonly { readonly sources: readonly string[]; readonly output: string; readonly exportName: string }[] = [
    {
      sources: [path.resolve(productRoot, "Boot/Bios.obr"), path.resolve(productRoot, "Boot/Clear.obr"), gpuDriver],
      output: path.resolve(outputDir, "Bios"),
      exportName: "biosProgram",
    },
    {
      sources: [path.resolve(productRoot, "Boot/Logo.obr"), gpuDriver],
      output: path.resolve(outputDir, "Logo"),
      exportName: "logoProgram",
    },
  ];

  const compile = (): void => {
    const compiler = hostCompilerPath();
    if (!existsSync(compiler)) {
      throw new Error(`找不到宿主编译器 ${compiler}。请在当前系统用 C++20 编译 Compiler/Obr。`);
    }
    mkdirSync(outputDir, { recursive: true });
    for (const job of jobs) {
      const result = spawnSync(
        compiler,
        [...job.sources, "-I", gpuHeader, "-I", driverHeader, "-I", boardHeader, "-I", memoryHeader, "-o", job.output],
        { encoding: "utf8" },
      );
      if (result.status !== 0) {
        const detail = (result.stderr || result.stdout || result.error?.message || "obrc 失败").trim();
        throw new Error(detail);
      }
    }
  };

  const bytesOf = (file: string): number[] => Array.from(readFileSync(file));

  return {
    name: "zeros-obr-firmware",
    buildStart(): void {
      compile();
    },
    configureServer(server): void {
      compile();
      const watched = jobs.flatMap((job): readonly string[] => job.sources);
      watched.push(path.resolve(gpuHeader, "gpu.mr"), path.resolve(driverHeader, "gl.mr"), path.resolve(boardHeader, "board.mr"), path.resolve(memoryHeader, "memory.mr"), path.resolve(productRoot, "Boot/firmware.mr"));
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
        .map((job): string => `export const ${job.exportName} = ${JSON.stringify(bytesOf(job.output))};`)
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
