/**
 * @module ZerOS.Hardware.Gpu.AccelOp
 * @description WebGPU 加速命令的操作码
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 这些整数是 `gpu.accel` 的操作数。权威登记在协议的 AccelRegistry。
 * 本文件只放操作码，不执行绘图。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 操作码
 */

export namespace ZerOS {
  export namespace Hardware {
    export namespace Gpu {
      /** `gpu.accel` 第一个寄存器里的操作。取值与 AccelRegistry 逐字一致。 */
      export const AccelOp = {
        Viewport: 1,
        Scissor: 2,
        ClearColor: 3,
        ClearDepth: 4,
        Clear: 5,
        Color: 6,
        Vertex: 7,
        TexCoord: 8,
        Normal: 9,
        Begin: 10,
        End: 11,
        MatrixMode: 12,
        LoadIdentity: 13,
        PushMatrix: 14,
        PopMatrix: 15,
        Translate: 16,
        Rotate: 17,
        Scale: 18,
        Ortho: 19,
        OrthoDepth: 20,
        Frustum: 21,
        FrustumDepth: 22,
        Enable: 23,
        Disable: 24,
        BlendFunc: 25,
        DepthFunc: 26,
        CullFace: 27,
        FrontFace: 28,
        GenTexture: 29,
        BindTexture: 30,
        TexImage: 31,
        DrawArrays: 32,
        Fill: 33,
        ScreenGlyph: 34,
        Corner: 35,
        Round: 36,
        Ellipse: 37,
        Frame: 38,
      } as const;
    }
  }
}
