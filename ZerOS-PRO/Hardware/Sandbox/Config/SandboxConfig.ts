/**
 * @module ZerOS.Hardware.Sandbox.SandboxConfig
 * @description ZSP1 固定常量与官方标定
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 协议写死的命令、查询和文本上界放在这里。
 * 官方扩展口和客程序核心是这一份实现的标定，协议不强制编号。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. SandboxConfig
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Sandbox {
      export const SandboxConfig = {
        /** 协议标识。扩展插头的 DeviceProtocol 必须逐字是这个字符串。 */
        Protocol: "ZSP1",
        /** 交换协议。ActiveProtocol 必须是 ZXD1。 */
        ExchangeProtocol: "ZXD1",
        /** 一个字的八位组数。 */
        WordOctets: 8,
        /** 程序文本的最长八位组数。超出则这次追加失败，已有文本不动。 */
        TextMax: 4096,
        /** 故障说明最多保留的字符数。更长的说明在这里截断。 */
        FaultMax: 256,
        /** 官方参考实现 Bind 的扩展口。键盘占用口 0。 */
        OfficialPort: 1,
        /** 客程序使用的核心。口 0 上的固件循环占用核心 0。 */
        GuestCore: 1,
        /** 方向 0：清空文本、故障和寄存器，回到空闲。 */
        CommandReset: 0,
        /** 方向 0：追加一段 ASCII 文本。 */
        CommandAppend: 1,
        /** 方向 0：开始执行已经收下的文本。 */
        CommandRun: 2,
        /** 方向 1：当前状态。 */
        QueryStatus: 0,
        /** 方向 1：已收下的文本长度。 */
        QueryTextLength: 1,
        /** 方向 1：故障说明的长度。 */
        QueryFaultLength: 2,
        /** 方向 1：从给定起点读出最多 8 个故障字符。 */
        QueryFault: 3,
        /** 方向 1：寄存器查询的起点。加上寄存器编号 0 至 7。 */
        QueryRegister: 16,
      } as const;
    }
  }
}
