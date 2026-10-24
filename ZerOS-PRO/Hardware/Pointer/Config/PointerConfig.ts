/**
 * @module ZerOS.Hardware.Pointer.Config
 * @description ZPP1 固定常量
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只放协议写死的个数和官方参考实现坐上的扩展口编号。
 * 不保存坐标，也不发起交换。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. PointerConfig
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Pointer {
      export const PointerConfig = {
        /** 协议标识。扩展插头的 DeviceProtocol 必须逐字是这个字符串。 */
        Protocol: "ZPP1",
        /** 交换协议。ActiveProtocol 必须是 ZXD1，鼠标不另开一条线。 */
        ExchangeProtocol: "ZXD1",
        /** 一个字的八位组数。方向 0 和方向 1 的载荷都是这个长度。 */
        WordOctets: 8,
        /** 一次事件要连续收下的字数。少一个都不记。 */
        WordCount: 6,
        /** 横坐标和纵坐标的上界，含本身。与显示器单边最大值减 1 相同。 */
        CoordMax: 16383,
        /** 官方参考实现 Bind 的扩展口。键盘 0、沙盒 1、网络盘 2。协议不强制这个编号。 */
        OfficialPort: 3,
        /** 未读队列至少留下这么多次。满了先丢最旧的移动。 */
        QueueMin: 32,
        /** 已完成次数。方向 1 的请求码。 */
        QueryCount: 0,
        /** 上一次种类。 */
        QueryKind: 1,
        /** 上一次键。 */
        QueryButton: 2,
        /** 上一次横坐标。 */
        QueryX: 3,
        /** 上一次纵坐标。 */
        QueryY: 4,
        /** 上一次修饰位。 */
        QueryModifiers: 5,
        /** 上一次滚轮字。 */
        QueryWheel: 6,
        /** 当前按住掩码。 */
        QueryHeld: 7,
        /** 还没移出的事件个数。不移出。 */
        QueryDepth: 8,
        /** 移出最旧的一次，返回剩下的个数。 */
        QueryPop: 9,
      } as const;
    }
  }
}
