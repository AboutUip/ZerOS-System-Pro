/**
 * @module ZerOS.Hardware.Motherboard.TimeChip
 * @description 主板内置墙上时钟芯片
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      let epochMilliseconds = BigInt(Date.now());
      let monotonicAnchor = performance.now();

      /** 读取 Unix 纪元毫秒。运行期间以单调时钟推进，不受宿主校时影响。 */
      export function readTime(): bigint {
        return epochMilliseconds + BigInt(Math.floor(performance.now() - monotonicAnchor));
      }

      /** 设置 Unix 纪元毫秒。芯片不施加 Obr ABI 以外的数值上限。 */
      export function setTime(value: bigint): void {
        epochMilliseconds = value;
        monotonicAnchor = performance.now();
      }

      /** 供监督核节拍使用的宿主单调毫秒，不随墙上时钟设置改变。 */
      export function readMonotonicMilliseconds(): bigint {
        return BigInt(Math.floor(performance.now()));
      }
    }
  }
}
