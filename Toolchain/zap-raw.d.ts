/**
 * 工具链在 Vite 加载阶段提供的固件行。类型检查不依赖产物文件已经写出来。
 */
declare module "zeros-boot-firmware" {
  export const biosLines: readonly string[];
  export const logoLines: readonly string[];
}
