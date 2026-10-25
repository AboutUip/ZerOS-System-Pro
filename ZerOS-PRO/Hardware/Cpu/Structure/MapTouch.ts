/**
 * @module ZerOS.Hardware.Cpu.MapTouch
 * @description 一次映射读要不要调页
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 只描述查询结果的形状。不分配，也不访问扩展口。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 调页请求
 *   2. 查询结果
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Cpu {
      /**
       * 某一页还没进线性位元。
       * `offset` 是句柄里的八位组偏移。`count` 是这一页里仍属于 rN 的八位组数，不超过一页。
       * `address` 是这一页在线性位元上的起始位地址。
       */
      export interface FillPage {
        readonly port: number;
        readonly handle: number;
        readonly offset: number;
        readonly address: bigint;
        readonly count: number;
      }

      /**
       * 一次读或写落在哪。
       * `ram` 是映射区以外，按原来的线性位元做。
       * `ready` 是映射区内、需要的页都已经调入。
       * `fill` 是还缺的页，调用方必须先搬运再读。
       * `fault` 是落在映射区但没有整段落在一次仍有效的映射里。
       */
      export type MapTouch =
        | { readonly kind: "ram" }
        | { readonly kind: "ready" }
        | { readonly kind: "fill"; readonly pages: readonly FillPage[] }
        | { readonly kind: "fault" };

      /** 一次仍有效的映射占的线性范围。卸下时先把这些八位组写成 0。 */
      export interface MapRegion {
        readonly address: bigint;
        readonly octets: number;
      }
    }
  }
}
