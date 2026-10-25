/**
 * 工具链在 Vite 加载阶段提供的固件二进制。类型检查不依赖产物文件已经写出来。
 * 每个数是一个字节。固件编译不写 .zap。
 * 类型检查经 Toolchain/tsconfig.json 包含本文件。上电入口在主板的 FirmwarePower.ts。
 */
declare module "zeros-boot-firmware" {
  export const biosProgram: readonly number[];
  export const logoProgram: readonly number[];
  export const loadProgram: readonly number[];
  /** 指令编号的连续段：起点、终点开区间、文件名、行号、函数名。 */
  export type FirmwareSite = readonly [number, number, string, number, string];
  export const biosProgramSites: readonly FirmwareSite[];
  export const logoProgramSites: readonly FirmwareSite[];
  export const loadProgramSites: readonly FirmwareSite[];
}
