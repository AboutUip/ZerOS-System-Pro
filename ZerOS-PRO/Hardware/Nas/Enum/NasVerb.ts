/**
 * @module ZerOS.Hardware.Nas.NasVerb
 * @description ZNP1 动词
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * Exec 字的第 1 个八位组。封闭集合，与协议正文一致。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 动词
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Nas {
      /** 查看槽 0。 */
      export const NasVerbStat = 1;

      /** 打开槽 0。 */
      export const NasVerbOpen = 2;

      /** 关闭句柄。 */
      export const NasVerbClose = 3;

      /** 按窗口读取。 */
      export const NasVerbRead = 4;

      /** 写下阶段缓冲。 */
      export const NasVerbWrite = 5;

      /** 创建槽 0 这一层目录。 */
      export const NasVerbMkdir = 6;

      /** 删除槽 0。 */
      export const NasVerbRemove = 7;

      /** 把槽 0 改名为槽 1。 */
      export const NasVerbRename = 8;

      /** 读取槽 0 目录的一项。 */
      export const NasVerbReaddir = 9;
    }
  }
}
