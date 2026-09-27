/**
 * @module ZerOS.Hardware.Nas.NasStatus
 * @description ZNP1 状态
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 返回字的第 0 个八位组。封闭集合，与协议正文一致。
 * 这些状态不是扩展口引导失败。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 状态
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Nas {
      /** 成功。 */
      export const NasStatusOk = 0;

      /** 服务没有应答。 */
      export const NasStatusNotReady = 1;

      /** 没有这个路径或目录项。 */
      export const NasStatusNotFound = 2;

      /** 需要目录，目标不是目录。 */
      export const NasStatusNotDirectory = 3;

      /** 需要文件，目标是目录。 */
      export const NasStatusIsDirectory = 4;

      /** 句柄无效，或打开方式不允许该操作。 */
      export const NasStatusBadHandle = 5;

      /** 名字非法，或路径逃出客根。 */
      export const NasStatusBadName = 6;

      /** 超出路径、阶段、句柄表或单次搬运的上界。 */
      export const NasStatusTooLong = 7;

      /** 设备内部失败。 */
      export const NasStatusIo = 8;

      /** 已经有会话。 */
      export const NasStatusBusy = 9;

      /** 没有会话。 */
      export const NasStatusNoSession = 10;

      /** 目标已经存在。 */
      export const NasStatusExists = 11;

      /** 目录非空。 */
      export const NasStatusNotEmpty = 12;

      /** 操作码、槽、长度或打开方式不在范围内。 */
      export const NasStatusBadArgument = 13;
    }
  }
}
