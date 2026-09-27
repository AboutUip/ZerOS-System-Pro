/**
 * @module ZerOS.Hardware.Nas.NasMessage
 * @description 参考服务的一次请求和答复
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 这是官方插头和官方 Node 服务之间的 JSON，不是 ZNP1。
 * 第三方设备可以不使用这份结构，只要扩展口上的 8 个八位组符合协议。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 消息
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Nas {
      /** 插头发给参考服务的一笔操作。未用到的字符串是空串，未用到的数是 0。 */
      export interface NasRequest {
        readonly op: string;
        readonly path: string;
        readonly from: string;
        readonly to: string;
        readonly handle: number;
        readonly mode: number;
        readonly offset: number;
        readonly length: number;
        readonly index: number;
        readonly data: string;
      }

      /** 参考服务的答复。data 是结果八位组的 base64。 */
      export interface NasReply {
        readonly status: number;
        readonly kind: number;
        readonly size: number;
        readonly handle: number;
        readonly name: string;
        readonly data: string;
        /** 读到或写下的八位组数。查看和打开不用它。 */
        readonly length: number;
      }
    }
  }
}
