/**
 * @module ZerOS.Hardware.Nas.NasOpcode
 * @description ZNP1 操作码
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 字的第 0 个八位组。封闭集合，与协议正文一致。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 操作码
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Nas {
      /** 清空会话并询问服务是否在应答。 */
      export const NasOpcodeReset = 0;

      /** 把 1 至 6 个八位组追加到正在组装的路径。 */
      export const NasOpcodePathAppend = 1;

      /** 把组装好的路径抄进槽 0 或槽 1。 */
      export const NasOpcodePathKeep = 2;

      /** 设置 16 位句柄。 */
      export const NasOpcodeSetHandle = 3;

      /** 设置 32 位起点和 16 位长度。 */
      export const NasOpcodeSetRange = 4;

      /** 把 1 至 6 个八位组追加到写入阶段。 */
      export const NasOpcodeStage = 5;

      /** 按动词执行一次。 */
      export const NasOpcodeExec = 6;

      /** 拉回至多 6 个结果八位组。 */
      export const NasOpcodePull = 7;

      /** 建立会话。已有会话时拒绝。 */
      export const NasOpcodeBegin = 8;

      /** 解除会话。 */
      export const NasOpcodeEnd = 9;
    }
  }
}
