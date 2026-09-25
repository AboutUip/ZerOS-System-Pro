/**
 * @module ZerOS.Hardware.Keyboard.Config
 * @description ZKP1 固定常量
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只放协议写死的个数和官方参考实现坐上的扩展口编号。
 * 不保存按键，也不发起交换。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. KeyboardConfig
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Keyboard {
      export const KeyboardConfig = {
        /** 协议标识。扩展插头的 DeviceProtocol 必须逐字是这个字符串。 */
        Protocol: "ZKP1",
        /** 交换协议。ActiveProtocol 必须是 ZXD1，键盘不另开一条线。 */
        ExchangeProtocol: "ZXD1",
        /** 一个字的八位组数。方向 0 和方向 1 的载荷都是这个长度。 */
        WordOctets: 8,
        /** 一次事件要连续收下的字数。少一个都不记。 */
        WordCount: 6,
        /** 官方参考实现 Bind 的扩展口。协议不强制这个编号。 */
        OfficialPort: 0,
        /** 已完成次数。方向 1 的请求码。 */
        QueryCount: 0,
        /** 上一次种类。 */
        QueryKind: 1,
        /** 上一次键值。 */
        QueryKey: 2,
        /** 上一次码值。 */
        QueryCode: 3,
      } as const;
    }
  }
}
