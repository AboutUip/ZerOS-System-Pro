/**
 * @module ZerOS.Hardware.Motherboard.Slot.Expansion.Port
 * @description 主板上的 4 个扩展口
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 每个口可以为空。Bind 只坐下插头，Load 与 Boot 由引导按编号调用。
 * Exchange 只在已引导的口上搬运一块八位组，不解释内容。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 校验
 *   3. 口
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import type { ZerOS as ExpansionProviderRoot } from "./ExpansionProvider";
import { ZerOS as ConfigRoot } from "../../Config/ExpansionConfig";
import { ZerOS as ProviderMetaRoot } from "../Structure/ProviderMeta";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Motherboard {
      export namespace Slot {
        type ExpansionProvider = ExpansionProviderRoot.Hardware.Motherboard.Slot.ExpansionProvider;

        const PortCount = ConfigRoot.Hardware.Motherboard.ExpansionConfig.PortCount;
        const PortStateEmpty = ConfigRoot.Hardware.Motherboard.ExpansionConfig.PortStateEmpty;
        const PortStateLoaded = ConfigRoot.Hardware.Motherboard.ExpansionConfig.PortStateLoaded;
        const PortStateBooted = ConfigRoot.Hardware.Motherboard.ExpansionConfig.PortStateBooted;
        const DirectionHostToDevice = ConfigRoot.Hardware.Motherboard.ExpansionConfig.DirectionHostToDevice;
        const DirectionDeviceToHost = ConfigRoot.Hardware.Motherboard.ExpansionConfig.DirectionDeviceToHost;
        const PayloadMaxLength = ConfigRoot.Hardware.Motherboard.ExpansionConfig.PayloadMaxLength;
        const DeviceProtocolMaxLength = ConfigRoot.Hardware.Motherboard.ExpansionConfig.DeviceProtocolMaxLength;
        const ExchangeProtocol = ConfigRoot.Hardware.Motherboard.ExpansionConfig.ExchangeProtocol;
        const portPrefix = "[ZerOS.Hardware.Motherboard.ExpansionPort]";

        interface SeatedPort {
          readonly provider: ExpansionProvider;
          state: number;
          busy: boolean;
        }

        const ports: (SeatedPort | null)[] = [null, null, null, null];

        function fail(message: string): never {
          throw new Error(`${portPrefix} ${message}`);
        }

        function isPrintable(value: string, min: number, max: number): boolean {
          if (value.length < min || value.length > max) {
            return false;
          }
          for (let index = 0; index < value.length; index += 1) {
            const code = value.charCodeAt(index);
            if (code < 0x21 || code > 0x7e) {
              return false;
            }
          }
          return true;
        }

        function requireIndex(index: number): void {
          if (!Number.isInteger(index) || index < 0 || index >= PortCount) {
            fail("扩展口编号不在 0 到 3");
          }
        }

        /**
         * 把一份设备插头坐到指定口。
         * 口已经有插头、或标识不合法时，这个口保持原状。
         */
        export function Bind(index: number, provider: ExpansionProvider): void {
          requireIndex(index);
          const seated = ports[index];
          if (seated !== null && seated !== undefined) {
            fail("这个扩展口已经有设备");
          }
          if (
            !isPrintable(provider.ProviderId, 1, ProviderMetaRoot.Hardware.Motherboard.Slot.ProviderIdMaxLength)
            || !isPrintable(
              provider.ProviderVendor,
              1,
              ProviderMetaRoot.Hardware.Motherboard.Slot.ProviderVendorMaxLength,
            )
            || !isPrintable(provider.DeviceProtocol, 1, DeviceProtocolMaxLength)
            || provider.ActiveProtocol !== ExchangeProtocol
          ) {
            fail("扩展设备的标识不合法");
          }
          ports[index] = { provider, state: PortStateEmpty, busy: false };
        }

        /** 取出该口的插头。空口返回 null。 */
        export function Get(index: number): ExpansionProvider | null {
          requireIndex(index);
          const seated = ports[index];
          if (seated === null || seated === undefined) {
            return null;
          }
          return seated.provider;
        }

        /**
         * 读出该口某个标识字段的一个字符码。
         * 字段 0 是 DeviceProtocol，1 是 ProviderId，2 是 ProviderVendor。
         * 偏移超过字符串长度时返回 0。
         */
        export function FieldChar(index: number, field: number, offset: number): number {
          requireIndex(index);
          if (!Number.isInteger(field) || field < 0 || field > 2) {
            fail("设备字段不是 0、1 或 2");
          }
          if (!Number.isInteger(offset) || offset < 0 || offset >= DeviceProtocolMaxLength) {
            fail("设备标识的偏移不在 0 到 63");
          }
          const seated = ports[index];
          if (seated === null || seated === undefined) {
            fail("这个扩展口是空的");
          }
          const text = field === 0
            ? seated.provider.DeviceProtocol
            : field === 1
              ? seated.provider.ProviderId
              : seated.provider.ProviderVendor;
          if (offset >= text.length) {
            return 0;
          }
          return text.charCodeAt(offset);
        }

        /**
         * 读出 DeviceProtocol 的一个字符码。
         * 偏移不在 0 至 63，或该口是空的，则失败。超过字符串长度时返回 0。
         */
        export function Identity(index: number, offset: number): number {
          return FieldChar(index, 0, offset);
        }

        /** 该口当前状态。空口是 0。 */
        export function State(index: number): number {
          requireIndex(index);
          const seated = ports[index];
          if (seated === null || seated === undefined) {
            return PortStateEmpty;
          }
          return seated.state;
        }

        /**
         * 调用已绑定设备的 Load。
         * 成功后状态变为 1。失败则保持 0，且不会在这里调用 Boot。
         */
        export function Load(index: number): void {
          requireIndex(index);
          const seated = ports[index];
          if (seated?.state !== PortStateEmpty) {
            fail("这个扩展口不能加载");
          }
          seated.provider.Load();
          seated.state = PortStateLoaded;
        }

        /** 调用已加载设备的 Boot。成功后状态变为 2。 */
        export function Boot(index: number): void {
          requireIndex(index);
          const seated = ports[index];
          if (seated?.state !== PortStateLoaded) {
            fail("这个扩展口不能引导");
          }
          seated.provider.Boot();
          seated.state = PortStateBooted;
        }

        /**
         * 在已引导的口上交换一块八位组。
         * 宿主不查看内容。长度或方向不合法时不调用设备。
         */
        export function Exchange(index: number, direction: number, payload: Uint8Array): Uint8Array {
          requireIndex(index);
          const seated = ports[index];
          if (seated?.state !== PortStateBooted) {
            fail("这个扩展口还不能交换数据");
          }
          if (direction !== DirectionHostToDevice && direction !== DirectionDeviceToHost) {
            fail("交换方向不是 0 或 1");
          }
          if (payload.length > PayloadMaxLength) {
            fail("载荷长于 4096");
          }
          if (seated.busy) {
            fail("这个扩展口还有一次交换没结束");
          }
          seated.busy = true;
          try {
            const result = seated.provider.Exchange(direction, payload);
            if (result.length > PayloadMaxLength) {
              fail("设备返回的载荷长于 4096");
            }
            return result;
          } finally {
            seated.busy = false;
          }
        }
      }
    }
  }
}
