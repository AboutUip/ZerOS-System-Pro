/**
 * 工具链在 Vite 加载阶段提供的固件二进制。类型检查不依赖产物文件已经写出来。
 * 每个数是一个字节。旁边的 .zap 不进这个模块。
 */
declare module "zeros-boot-firmware" {
  export const biosProgram: readonly number[];
  export const logoProgram: readonly number[];
}
