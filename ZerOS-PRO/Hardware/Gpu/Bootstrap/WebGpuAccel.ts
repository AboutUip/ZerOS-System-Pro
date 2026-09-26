/**
 * @module ZerOS.Hardware.Gpu.WebGpuAccel
 * @description 用 WebGPU 执行 gpu.accel
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 固定功能管线：矩阵、顶点、纹理、清除和绘制。
 * 屏幕矩形、圆角、椭圆和屏幕字形按颜色目标的像素坐标画，不使用矩阵栈。
 * 只在显卡线程里使用。浏览器必须提供 WebGPU。
 * 没有绘制时不改帧存储，节点树的合成结果保持原样。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 状态与设备
 *   3. 命令
 *   4. 读回帧
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as OpRoot } from "../Enum/AccelOp";
import { ZerOS as GlyphRoot } from "../Structure/UiGlyph";
import { ZerOS as MemoryRoot } from "./VideoMemory";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Gpu {
      const Op = OpRoot.Hardware.Gpu.AccelOp;
      const glyphRows = GlyphRoot.Hardware.Gpu.UiGlyphRows;
      const readBytes = MemoryRoot.Hardware.Gpu.readBytes;
      const accelPrefix = "[ZerOS.Hardware.Gpu.WebGpuAccel]";

      const shader = `
struct Uniforms {
  mvp: mat4x4<f32>,
  useTex: f32,
  useLight: f32,
}
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

struct Vin {
  @location(0) pos: vec3<f32>,
  @location(1) color: vec4<f32>,
  @location(2) uv: vec2<f32>,
  @location(3) normal: vec3<f32>,
}
struct Vout {
  @builtin(position) clip: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) uv: vec2<f32>,
  @location(2) normal: vec3<f32>,
}

@vertex fn vs(v: Vin) -> Vout {
  var o: Vout;
  o.clip = u.mvp * vec4<f32>(v.pos, 1.0);
  o.color = v.color;
  o.uv = v.uv;
  o.normal = v.normal;
  return o;
}

@fragment fn fs(i: Vout) -> @location(0) vec4<f32> {
  let sampled = textureSample(tex, samp, i.uv);
  let mixed = mix(vec4<f32>(1.0, 1.0, 1.0, 1.0), sampled, u.useTex);
  let len = length(i.normal);
  let facing = select(1.0, max(dot(i.normal / len, vec3<f32>(0.0, 0.0, 1.0)), 0.0), len > 0.0);
  let lit = mix(1.0, facing, u.useLight);
  return i.color * mixed * vec4<f32>(lit, lit, lit, 1.0);
}
`;

      /**
       * 屏幕路径专用。mode 0 整格着色，1 是圆角矩形，2 是内切椭圆。
       * 片段坐标是像素中心，原点在左上。圆角半径收到较短边的一半。
       */
      const screenShader = `
struct Uniforms {
  mvp: mat4x4<f32>,
  useTex: f32,
  mode: f32,
  radius: f32,
  box: vec4<f32>,
}
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

struct Vin {
  @location(0) pos: vec3<f32>,
  @location(1) color: vec4<f32>,
  @location(2) uv: vec2<f32>,
  @location(3) normal: vec3<f32>,
}
struct Vout {
  @builtin(position) clip: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) uv: vec2<f32>,
  @location(2) normal: vec3<f32>,
}

@vertex fn vs(v: Vin) -> Vout {
  var o: Vout;
  o.clip = u.mvp * vec4<f32>(v.pos, 1.0);
  o.color = v.color;
  o.uv = v.uv;
  o.normal = v.normal;
  return o;
}

@fragment fn fs(i: Vout) -> @location(0) vec4<f32> {
  let sampled = textureSample(tex, samp, i.uv);
  let mixed = mix(vec4<f32>(1.0, 1.0, 1.0, 1.0), sampled, max(i.normal.x, u.useTex * 0.0));
  let p = i.clip.xy;
  let half = u.box.zw * 0.5;
  let center = u.box.xy + half;
  if (u.mode > 0.5 && u.mode < 1.5) {
    let r = min(max(u.radius, 0.0), min(half.x, half.y));
    let q = abs(p - center) - (half - vec2<f32>(r, r));
    let d = length(max(q, vec2<f32>(0.0, 0.0))) + min(max(q.x, q.y), 0.0) - r;
    if (d > 0.0) {
      discard;
    }
  }
  if (u.mode > 1.5) {
    let n = (p - center) / half;
    if (dot(n, n) > 1.0) {
      discard;
    }
  }
  return i.color * mixed;
}
`;

      function fail(message: string): never {
        throw new Error(`${accelPrefix} ${message}`);
      }

      /** 寄存器里的二进制 64 位型，按小端还原成有限浮点。 */
      function f64(bits: bigint): number {
        const view = new DataView(new ArrayBuffer(8));
        view.setBigInt64(0, BigInt.asIntN(64, bits), true);
        const value = view.getFloat64(0, true);
        if (!Number.isFinite(value)) {
          fail("加速参数不是有限数");
        }
        return value;
      }

      function iarg(bits: bigint): number {
        return Math.trunc(f64(bits));
      }

      function identity(): Float32Array {
        const m = new Float32Array(16);
        m[0] = 1;
        m[5] = 1;
        m[10] = 1;
        m[15] = 1;
        return m;
      }

      function multiply(left: Float32Array, right: Float32Array): Float32Array {
        const out = new Float32Array(16);
        for (let column = 0; column < 4; column += 1) {
          for (let row = 0; row < 4; row += 1) {
            let sum = 0;
            for (let k = 0; k < 4; k += 1) {
              sum += (left[k * 4 + row] ?? 0) * (right[column * 4 + k] ?? 0);
            }
            out[column * 4 + row] = sum;
          }
        }
        return out;
      }

      let width = 1;
      let height = 1;
      let drawn = false;
      let colorReady = false;
      let device: GPUDevice | null = null;
      let color: GPUTexture | null = null;
      let depth: GPUTexture | null = null;
      let pipeline: GPURenderPipeline | null = null;
      let uniform: GPUBuffer | null = null;
      let vertices: GPUBuffer | null = null;
      let readback: GPUBuffer | null = null;
      let bind: GPUBindGroup | null = null;
      let sampler: GPUSampler | null = null;
      let white: GPUTexture | null = null;
      let gpuTexture: GPUTexture | null = null;
      let pipelineKey = "";

      const modelStack: Float32Array[] = [identity()];
      const projStack: Float32Array[] = [identity()];
      let matrixMode = 0;
      let near = -1;
      let far = 1;
      let clearRed = 0;
      let clearGreen = 0;
      let clearBlue = 0;
      let clearAlpha = 1;
      let clearZ = 1;
      let red = 1;
      let green = 1;
      let blue = 1;
      let alpha = 1;
      let cornerRadius = 0;
      let u = 0;
      let v = 0;
      let nx = 0;
      let ny = 0;
      let nz = 1;
      const floatsPerVertex = 12;
      let viewportX = 0;
      let viewportY = 0;
      let viewportW = 1;
      let viewportH = 1;
      let scissorX = 0;
      let scissorY = 0;
      let scissorW = 1;
      let scissorH = 1;
      let depthOn = false;
      let blendOn = false;
      let cullOn = false;
      let scissorOn = false;
      let textureOn = false;
      let lightOn = false;
      let blendSrc = 2;
      let blendDst = 3;
      let depthFunc = 1;
      let cullFace = 1;
      let frontCw = false;
      let depthReady = false;
      let primitive = 0;
      let batch: number[] = [];
      let nextTexture = 1;
      let boundTexture = 0;
      const textures = new Map<number, { readonly w: number; readonly h: number; readonly rgba: Uint8Array }>();
      let screenPipeline: GPURenderPipeline | null = null;
      /** 同一纹理的矩形或字形先攒成一份顶点，一次提交。换纹理、剪裁或读回时再画。 */
      let screenVertices: GPUBuffer | null = null;
      let screenVertexBytes = 0;
      let screenRectGroup: GPUBindGroup | null = null;
      let screenGlyphGroup: GPUBindGroup | null = null;
      /** 0 没有在攒，1 矩形和字形已经在同一份顶点里。 */
      let screenRun = 0;
      const screenQuads: number[] = [];
      let fontTexture: GPUTexture | null = null;
      const glyphColumns = 5;
      const glyphBand = 7;
      const glyphCount = 95;

      function currentStack(): Float32Array[] {
        return matrixMode === 1 ? projStack : modelStack;
      }

      function top(): Float32Array {
        const stack = currentStack();
        const matrix = stack[stack.length - 1];
        if (matrix === undefined) {
          fail("矩阵栈是空的");
        }
        return matrix;
      }

      function replaceTop(matrix: Float32Array): void {
        const stack = currentStack();
        stack[stack.length - 1] = matrix;
      }

      /** 帧尺寸变化后丢掉旧的颜色目标，下次绘制再按新尺寸建立。 */
      export function resize(nextWidth: number, nextHeight: number): void {
        width = nextWidth;
        height = nextHeight;
        viewportW = nextWidth;
        viewportH = nextHeight;
        scissorW = nextWidth;
        scissorH = nextHeight;
        color = null;
        depth = null;
        readback = null;
        pipeline = null;
        colorReady = false;
        depthReady = false;
      }

      async function ensure(): Promise<GPUDevice> {
        if (device !== null && color !== null) {
          return device;
        }
        /* DOM 把 navigator.gpu 标成必定存在。没开 WebGPU 的浏览器运行时仍是空的，先按未知值看一眼。 */
        const hostGpu: unknown = navigator.gpu;
        if (typeof hostGpu !== "object" || hostGpu === null) {
          fail("浏览器没有 WebGPU");
        }
        const gpu = navigator.gpu;
        if (device === null) {
          const adapter = await gpu.requestAdapter();
          if (adapter === null) {
            fail("没有 WebGPU 适配器");
          }
          device = await adapter.requestDevice();
          sampler = device.createSampler({ magFilter: "nearest", minFilter: "nearest" });
          white = device.createTexture({
            size: { width: 1, height: 1 },
            format: "rgba8unorm",
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
          });
          const whiteBytes = new Uint8Array(256);
          whiteBytes[0] = 255;
          whiteBytes[1] = 255;
          whiteBytes[2] = 255;
          whiteBytes[3] = 255;
          device.queue.writeTexture(
            { texture: white },
            whiteBytes,
            { bytesPerRow: 256 },
            { width: 1, height: 1 },
          );
          buildFont(device);
          uniform = device.createBuffer({
            size: 96,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          });
        }
        const active = device;
        color = active.createTexture({
          size: { width, height },
          format: "rgba8unorm",
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        });
        depth = active.createTexture({
          size: { width, height },
          format: "depth24plus",
          usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
        readback = active.createBuffer({
          size: bytesPerRow * height,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        pipeline = null;
        return active;
      }

      function blendFactor(code: number): GPUBlendFactor {
        const table: readonly GPUBlendFactor[] = [
          "zero",
          "one",
          "src-alpha",
          "one-minus-src-alpha",
          "dst-alpha",
          "one-minus-dst-alpha",
          "src",
          "one-minus-src",
          "dst",
          "one-minus-dst",
        ];
        const factor = table[code];
        if (factor === undefined) {
          fail("没有这种混合因子");
        }
        return factor;
      }

      function depthCompare(): GPUCompareFunction {
        if (!depthOn) {
          return "always";
        }
        const table: readonly GPUCompareFunction[] = [
          "never",
          "less",
          "equal",
          "less-equal",
          "greater",
          "not-equal",
          "greater-equal",
          "always",
        ];
        const compare = table[depthFunc];
        if (compare === undefined) {
          fail("没有这种深度比较");
        }
        return compare;
      }

      function pipelineFor(active: GPUDevice): GPURenderPipeline {
        const key = [
          blendOn ? "1" : "0",
          String(blendSrc),
          String(blendDst),
          depthOn ? "1" : "0",
          String(depthFunc),
          cullOn ? "1" : "0",
          String(cullFace),
          frontCw ? "1" : "0",
          String(primitive),
        ].join(":");
        if (pipeline !== null && pipelineKey === key) {
          return pipeline;
        }
        const module = active.createShaderModule({ code: shader });
        const format = "rgba8unorm" as const;
        let topology: GPUPrimitiveTopology = "triangle-list";
        if (primitive === 0) {
          topology = "point-list";
        } else if (primitive === 1) {
          topology = "line-list";
        } else if (primitive === 2) {
          topology = "line-strip";
        } else if (primitive === 4) {
          topology = "triangle-strip";
        }
        const src = blendFactor(blendSrc);
        const dst = blendFactor(blendDst);
        const colorTarget = blendOn
          ? {
            format,
            blend: {
              color: { srcFactor: src, dstFactor: dst, operation: "add" as const },
              alpha: { srcFactor: "one" as const, dstFactor: "one-minus-src-alpha" as const, operation: "add" as const },
            },
          }
          : { format };
        pipeline = active.createRenderPipeline({
          layout: "auto",
          vertex: {
            module,
            entryPoint: "vs",
            buffers: [{
              arrayStride: floatsPerVertex * 4,
              attributes: [
                { shaderLocation: 0, offset: 0, format: "float32x3" },
                { shaderLocation: 1, offset: 12, format: "float32x4" },
                { shaderLocation: 2, offset: 28, format: "float32x2" },
                { shaderLocation: 3, offset: 36, format: "float32x3" },
              ],
            }],
          },
          fragment: {
            module,
            entryPoint: "fs",
            targets: [colorTarget],
          },
          primitive: {
            topology,
            cullMode: !cullOn || cullFace === 2 ? "none" : cullFace === 0 ? "front" : "back",
            frontFace: frontCw ? "cw" : "ccw",
          },
          depthStencil: {
            format: "depth24plus",
            depthWriteEnabled: depthOn,
            depthCompare: depthCompare(),
          },
        });
        pipelineKey = key;
        bind = null;
        return pipeline;
      }

      function bindGroup(active: GPUDevice, pipe: GPURenderPipeline): GPUBindGroup {
        if (bind !== null) {
          return bind;
        }
        const view = (textureOn && gpuTexture !== null ? gpuTexture : white);
        if (view === null || sampler === null || uniform === null) {
          fail("WebGPU 资源还没有建立");
        }
        bind = active.createBindGroup({
          layout: pipe.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: uniform } },
            { binding: 1, resource: view.createView() },
            { binding: 2, resource: sampler },
          ],
        });
        return bind;
      }

      function mvp(): Float32Array {
        const projection = projStack[projStack.length - 1] ?? identity();
        const model = modelStack[modelStack.length - 1] ?? identity();
        const clip = identity();
        /* OpenGL 的 z 是 -1 到 1。WebGPU 的 z 是 0 到 1。y 仍向上，视口把上边映到纹理第 0 行。 */
        clip[10] = 0.5;
        clip[14] = 0.5;
        return multiply(clip, multiply(projection, model));
      }

      async function draw(list: number[], mode: number): Promise<void> {
        if (list.length < floatsPerVertex) {
          return;
        }
        if (cullOn && cullFace === 2) {
          return;
        }
        if (!(viewportW > 0) || !(viewportH > 0)) {
          fail("视口宽或高不是正数");
        }
        let scissorLeft = 0;
        let scissorTop = 0;
        let scissorWidth = width;
        let scissorHeight = height;
        if (scissorOn) {
          scissorLeft = Math.max(0, Math.min(width, scissorX));
          scissorTop = Math.max(0, Math.min(height, scissorY));
          scissorWidth = Math.max(0, Math.min(width - scissorLeft, scissorW));
          scissorHeight = Math.max(0, Math.min(height - scissorTop, scissorH));
          if (scissorWidth < 1 || scissorHeight < 1) {
            return;
          }
        }
        const active = await ensure();
        if (color === null || depth === null || uniform === null) {
          fail("颜色目标还没有建立");
        }
        primitive = mode;
        const pipe = pipelineFor(active);
        const packed = new Float32Array(20);
        packed.set(mvp());
        packed[16] = textureOn ? 1 : 0;
        packed[17] = lightOn ? 1 : 0;
        active.queue.writeBuffer(uniform, 0, packed);
        const data = new Float32Array(list);
        if (vertices !== null) {
          vertices.destroy();
        }
        vertices = active.createBuffer({
          size: Math.max(data.byteLength, floatsPerVertex * 4),
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        active.queue.writeBuffer(vertices, 0, data);
        const encoder = active.createCommandEncoder();
        const pass = encoder.beginRenderPass({
          colorAttachments: [{
            view: color.createView(),
            loadOp: colorReady ? "load" : "clear",
            clearValue: { r: clearRed, g: clearGreen, b: clearBlue, a: clearAlpha },
            storeOp: "store",
          }],
          depthStencilAttachment: {
            view: depth.createView(),
            depthLoadOp: depthReady ? "load" : "clear",
            depthClearValue: clearZ,
            depthStoreOp: "store",
          },
        });
        pass.setPipeline(pipe);
        pass.setBindGroup(0, bindGroup(active, pipe));
        pass.setViewport(viewportX, viewportY, viewportW, viewportH, 0, 1);
        if (scissorOn) {
          pass.setScissorRect(scissorLeft, scissorTop, scissorWidth, scissorHeight);
        }
        pass.setVertexBuffer(0, vertices);
        pass.draw(list.length / floatsPerVertex);
        pass.end();
        active.queue.submit([encoder.finish()]);
        colorReady = true;
        depthReady = true;
        drawn = true;
      }

      function pushVertex(x: number, y: number, z: number): void {
        batch.push(x, y, z, red, green, blue, alpha, u, v, nx, ny, nz);
      }

      function cornerAt(source: number[], index: number, n: number): number[] {
        const start = index + n * floatsPerVertex;
        return source.slice(start, start + floatsPerVertex);
      }

      function expandQuads(source: number[]): number[] {
        const out: number[] = [];
        const quad = floatsPerVertex * 4;
        for (let index = 0; index + quad <= source.length; index += quad) {
          out.push(
            ...cornerAt(source, index, 0),
            ...cornerAt(source, index, 1),
            ...cornerAt(source, index, 2),
            ...cornerAt(source, index, 0),
            ...cornerAt(source, index, 2),
            ...cornerAt(source, index, 3),
          );
        }
        return out;
      }

      function expandFan(source: number[]): number[] {
        const out: number[] = [];
        const count = Math.floor(source.length / floatsPerVertex);
        for (let index = 1; index + 1 < count; index += 1) {
          out.push(
            ...cornerAt(source, 0, 0),
            ...cornerAt(source, 0, index),
            ...cornerAt(source, 0, index + 1),
          );
        }
        return out;
      }

      async function paint(source: number[], mode: number): Promise<void> {
        if (mode === 5) {
          await draw(expandFan(source), 3);
          return;
        }
        if (mode === 6) {
          await draw(expandQuads(source), 3);
          return;
        }
        if (mode < 0 || mode > 4) {
          fail("没有这种图元");
        }
        await draw(source, mode);
      }

      function capability(code: number, enabled: boolean): void {
        if (code === 1) {
          depthOn = enabled;
        } else if (code === 2) {
          blendOn = enabled;
        } else if (code === 3) {
          cullOn = enabled;
        } else if (code === 4) {
          scissorOn = enabled;
        } else if (code === 5) {
          textureOn = enabled;
          bind = null;
        } else if (code === 6) {
          lightOn = enabled;
          return;
        } else {
          fail("没有这种能力");
        }
        pipeline = null;
        bind = null;
      }

      /** 把当前绑定的纹理送进 WebGPU。设备还没建立时先留在内存里，下次绑定再送。 */
      function uploadBound(): void {
        gpuTexture = null;
        bind = null;
        const image = textures.get(boundTexture);
        if (image === undefined || device === null) {
          return;
        }
        gpuTexture = device.createTexture({
          size: { width: image.w, height: image.h },
          format: "rgba8unorm",
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        const stride = Math.ceil((image.w * 4) / 256) * 256;
        const padded = new Uint8Array(stride * image.h);
        for (let row = 0; row < image.h; row += 1) {
          padded.set(image.rgba.subarray(row * image.w * 4, (row + 1) * image.w * 4), row * stride);
        }
        device.queue.writeTexture(
          { texture: gpuTexture },
          padded,
          { bytesPerRow: stride },
          { width: image.w, height: image.h },
        );
      }

      /**
       * 把 5×7 字形铺成一张最近邻图集。
       * 每个码点占 5 列，bit 4 是左列，第 0 行是字的上边。图集只建一次。
       */
      function buildFont(active: GPUDevice): void {
        if (fontTexture !== null) {
          return;
        }
        if (glyphRows.length !== glyphCount * glyphBand) {
          fail("屏幕字形表长度不对");
        }
        const atlasWidth = glyphCount * glyphColumns;
        const ink = new Uint8Array(atlasWidth * glyphBand * 4);
        for (let glyph = 0; glyph < glyphCount; glyph += 1) {
          for (let row = 0; row < glyphBand; row += 1) {
            const bits = glyphRows[glyph * glyphBand + row];
            if (bits === undefined) {
              fail("屏幕字形表缺了一行");
            }
            for (let column = 0; column < glyphColumns; column += 1) {
              const on = (bits & (1 << (4 - column))) !== 0;
              const offset = (row * atlasWidth + glyph * glyphColumns + column) * 4;
              ink[offset] = on ? 255 : 0;
              ink[offset + 1] = on ? 255 : 0;
              ink[offset + 2] = on ? 255 : 0;
              ink[offset + 3] = on ? 255 : 0;
            }
          }
        }
        fontTexture = active.createTexture({
          size: { width: atlasWidth, height: glyphBand },
          format: "rgba8unorm",
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        const stride = Math.ceil((atlasWidth * 4) / 256) * 256;
        const padded = new Uint8Array(stride * glyphBand);
        for (let row = 0; row < glyphBand; row += 1) {
          padded.set(ink.subarray(row * atlasWidth * 4, (row + 1) * atlasWidth * 4), row * stride);
        }
        active.queue.writeTexture(
          { texture: fontTexture },
          padded,
          { bytesPerRow: stride },
          { width: atlasWidth, height: glyphBand },
        );
      }

      function clampUnit(value: number): number {
        if (value < 0) {
          return 0;
        }
        if (value > 1) {
          return 1;
        }
        return value;
      }

      /** 字号小于 2 时格子宽是 1，否则是字号除以 2 向零截断。 */
      function glyphAdvance(size: number): number {
        if (size < 2) {
          return 1;
        }
        return Math.trunc(size / 2);
      }

      /**
       * 屏幕像素矩形或字形是否盖住剪裁后的颜色目标。
       * 完全落在外面就不必画，也不把这一帧算成已经绘制。
       */
      function coversTarget(x: number, y: number, cellWidth: number, cellHeight: number): boolean {
        let left = 0;
        let top = 0;
        let right = width;
        let bottom = height;
        if (scissorOn) {
          left = Math.max(left, scissorX);
          top = Math.max(top, scissorY);
          right = Math.min(right, scissorX + scissorW);
          bottom = Math.min(bottom, scissorY + scissorH);
        }
        const hitLeft = Math.max(left, x);
        const hitTop = Math.max(top, y);
        const hitRight = Math.min(right, x + cellWidth);
        const hitBottom = Math.min(bottom, y + cellHeight);
        return hitRight - hitLeft >= 1 && hitBottom - hitTop >= 1;
      }

      function screenPipe(active: GPUDevice): GPURenderPipeline {
        if (screenPipeline !== null) {
          return screenPipeline;
        }
        const module = active.createShaderModule({ code: screenShader });
        screenPipeline = active.createRenderPipeline({
          layout: "auto",
          vertex: {
            module,
            entryPoint: "vs",
            buffers: [{
              arrayStride: floatsPerVertex * 4,
              attributes: [
                { shaderLocation: 0, offset: 0, format: "float32x3" },
                { shaderLocation: 1, offset: 12, format: "float32x4" },
                { shaderLocation: 2, offset: 28, format: "float32x2" },
                { shaderLocation: 3, offset: 36, format: "float32x3" },
              ],
            }],
          },
          fragment: {
            module,
            entryPoint: "fs",
            targets: [{
              format: "rgba8unorm",
              blend: {
                color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
                alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
              },
            }],
          },
          primitive: { topology: "triangle-list", cullMode: "none", frontFace: "ccw" },
          depthStencil: {
            format: "depth24plus",
            depthWriteEnabled: false,
            depthCompare: "always",
          },
        });
        return screenPipeline;
      }

      /**
       * 用颜色目标自己的像素坐标画矩形、圆角、椭圆或一个字形。
       * mode 0 是实心矩形，1 是字形，2 是圆角，3 是椭圆。
       * 实心矩形和字形放在同一份顶点里，一次绘制。法线 x 为 1 时采样字形，为 0 时用纯色。
       * 圆角和椭圆各有自己的包围盒，仍是一次一个。
       * 原点在左上，y 向下。不碰矩阵栈，也不看混合开关；透明度总是按源透明度叠上去。
       */
      function pushScreenQuad(x: number, y: number, cellWidth: number, cellHeight: number, u0: number, v0: number, u1: number, v1: number, font: number): void {
        const tintR = clampUnit(red);
        const tintG = clampUnit(green);
        const tintB = clampUnit(blue);
        const tintA = clampUnit(alpha);
        const left = (x / width) * 2 - 1;
        const right = ((x + cellWidth) / width) * 2 - 1;
        const top = 1 - (y / height) * 2;
        const bottom = 1 - ((y + cellHeight) / height) * 2;
        const corner = (px: number, py: number, su: number, sv: number): number[] => [px, py, 0, tintR, tintG, tintB, tintA, su, sv, font, 0, 0];
        screenQuads.push(
          ...corner(left, top, u0, v0),
          ...corner(right, top, u1, v0),
          ...corner(right, bottom, u1, v1),
          ...corner(left, top, u0, v0),
          ...corner(right, bottom, u1, v1),
          ...corner(left, bottom, u0, v1),
        );
      }

      /** 把已经攒下的矩形和字形一次画出去。顶点法线的 x 标明要不要采样字形。 */
      async function flushScreenRun(): Promise<void> {
        if (screenRun === 0 || screenQuads.length === 0) {
          screenRun = 0;
          screenQuads.length = 0;
          return;
        }
        const list = screenQuads.slice();
        screenRun = 0;
        screenQuads.length = 0;
        await submitScreenList(true, 0, 0, 0, 0, 0, 0, list);
      }

      /**
       * 一次渲染通道画完这份顶点。
       * useFont 为真时采样字形图集，否则采样白纹理。sdf 0 是整格，1 是圆角，2 是椭圆。
       */
      async function submitScreenList(
        useFont: boolean,
        sdf: number,
        radius: number,
        boxX: number,
        boxY: number,
        boxW: number,
        boxH: number,
        list: readonly number[],
      ): Promise<void> {
        if (list.length === 0) {
          return;
        }
        const active = await ensure();
        buildFont(active);
        if (color === null || depth === null || uniform === null || sampler === null || white === null || fontTexture === null) {
          fail("颜色目标还没有建立");
        }
        const pipe = screenPipe(active);
        const packed = new Float32Array(24);
        packed.set(identity());
        packed[16] = useFont ? 1 : 0;
        packed[17] = sdf;
        packed[18] = radius;
        packed[20] = boxX;
        packed[21] = boxY;
        packed[22] = boxW;
        packed[23] = boxH;
        active.queue.writeBuffer(uniform, 0, packed);
        const data = new Float32Array(list);
        const bytes = data.byteLength;
        let buffer = screenVertices;
        if (buffer === null || screenVertexBytes < bytes) {
          if (buffer !== null) {
            buffer.destroy();
          }
          const size = Math.max(bytes, screenVertexBytes * 2, 4096);
          buffer = active.createBuffer({
            size,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
          });
          screenVertices = buffer;
          screenVertexBytes = size;
        }
        active.queue.writeBuffer(buffer, 0, data);
        const cached = useFont ? screenGlyphGroup : screenRectGroup;
        const view = useFont ? fontTexture : white;
        const group = cached ?? active.createBindGroup({
          layout: pipe.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: uniform } },
            { binding: 1, resource: view.createView() },
            { binding: 2, resource: sampler },
          ],
        });
        if (useFont) {
          screenGlyphGroup = group;
        } else {
          screenRectGroup = group;
        }
        let scissorLeft = 0;
        let scissorTop = 0;
        let scissorWidth = width;
        let scissorHeight = height;
        if (scissorOn) {
          scissorLeft = Math.max(0, Math.min(width, scissorX));
          scissorTop = Math.max(0, Math.min(height, scissorY));
          scissorWidth = Math.max(0, Math.min(width - scissorLeft, scissorW));
          scissorHeight = Math.max(0, Math.min(height - scissorTop, scissorH));
        }
        const encoder = active.createCommandEncoder();
        const pass = encoder.beginRenderPass({
          colorAttachments: [{
            view: color.createView(),
            loadOp: colorReady ? "load" : "clear",
            clearValue: { r: clearRed, g: clearGreen, b: clearBlue, a: clearAlpha },
            storeOp: "store",
          }],
          depthStencilAttachment: {
            view: depth.createView(),
            depthLoadOp: depthReady ? "load" : "clear",
            depthClearValue: clearZ,
            depthStoreOp: "store",
          },
        });
        pass.setPipeline(pipe);
        pass.setBindGroup(0, group);
        pass.setViewport(0, 0, width, height, 0, 1);
        if (scissorOn && scissorWidth >= 1 && scissorHeight >= 1) {
          pass.setScissorRect(scissorLeft, scissorTop, scissorWidth, scissorHeight);
        }
        pass.setVertexBuffer(0, buffer);
        pass.draw(list.length / floatsPerVertex);
        pass.end();
        active.queue.submit([encoder.finish()]);
        colorReady = true;
        depthReady = true;
        drawn = true;
      }

      async function paintScreen(mode: number, a: number, b: number, c: number, d: number): Promise<number> {
        if (mode === 2 || mode === 3) {
          await flushScreenRun();
          if (c < 0 || d < 0) {
            fail("矩形宽或高是负数");
          }
          if (c === 0 || d === 0 || !coversTarget(a, b, c, d)) {
            return 0;
          }
          screenRun = 1;
          pushScreenQuad(a, b, c, d, 0, 0, 1, 1, 0);
          const list = screenQuads.slice();
          screenRun = 0;
          screenQuads.length = 0;
          const radius = mode === 2 ? cornerRadius : 0;
          const sdf = mode === 2 ? 1 : 2;
          await submitScreenList(false, sdf, radius, a, b, c, d, list);
          return 0;
        }
        let x = 0;
        let y = 0;
        let cellWidth = 0;
        let cellHeight = 0;
        let u0 = 0;
        let u1 = 1;
        const v0 = 0;
        const v1 = 1;
        const font = mode === 1 ? 1 : 0;
        if (mode === 1) {
          if (d < 1) {
            fail("字形字号小于 1");
          }
          if (a < 0x20 || a > 0x7e) {
            fail("字形码点不在 0x20 到 0x7E");
          }
          x = b;
          y = c;
          cellHeight = d;
          cellWidth = glyphAdvance(d);
          const index = a - 0x20;
          const atlasWidth = glyphCount * glyphColumns;
          u0 = (index * glyphColumns) / atlasWidth;
          u1 = ((index + 1) * glyphColumns) / atlasWidth;
        } else {
          if (c < 0 || d < 0) {
            fail("矩形宽或高是负数");
          }
          if (c === 0 || d === 0) {
            return 0;
          }
          x = a;
          y = b;
          cellWidth = c;
          cellHeight = d;
        }
        if (!coversTarget(x, y, cellWidth, cellHeight)) {
          return 0;
        }
        if (screenRun === 0) {
          screenRun = 1;
        }
        pushScreenQuad(x, y, cellWidth, cellHeight, u0, v0, u1, v1, font);
        return 0;
      }

      /**
       * 执行一条加速命令。
       * 返回值写入调用方的结果寄存器；多数命令返回 0，生成纹理时返回新编号。
       */
      export async function accel(op: number, a: bigint, b: bigint, c: bigint, d: bigint): Promise<number> {
        if (op !== Op.Fill && op !== Op.ScreenGlyph && op !== Op.Color) {
          await flushScreenRun();
        }
        if (op === Op.Viewport) {
          viewportX = f64(a);
          viewportY = f64(b);
          viewportW = f64(c);
          viewportH = f64(d);
          return 0;
        }
        if (op === Op.Scissor) {
          scissorX = Math.trunc(f64(a));
          scissorY = Math.trunc(f64(b));
          scissorW = Math.trunc(f64(c));
          scissorH = Math.trunc(f64(d));
          return 0;
        }
        if (op === Op.ClearColor) {
          clearRed = f64(a);
          clearGreen = f64(b);
          clearBlue = f64(c);
          clearAlpha = f64(d);
          return 0;
        }
        if (op === Op.ClearDepth) {
          clearZ = f64(a);
          return 0;
        }
        if (op === Op.Clear) {
          const active = await ensure();
          if (color === null || depth === null) {
            fail("颜色目标还没有建立");
          }
          const mask = iarg(a);
          const encoder = active.createCommandEncoder();
          const pass = encoder.beginRenderPass({
            colorAttachments: [{
              view: color.createView(),
              loadOp: (mask & 1) !== 0 ? "clear" : "load",
              clearValue: { r: clearRed, g: clearGreen, b: clearBlue, a: clearAlpha },
              storeOp: "store",
            }],
            depthStencilAttachment: {
              view: depth.createView(),
              depthLoadOp: (mask & 2) !== 0 || !depthReady ? "clear" : "load",
              depthClearValue: clearZ,
              depthStoreOp: "store",
            },
          });
          pass.end();
          active.queue.submit([encoder.finish()]);
          colorReady = true;
          depthReady = true;
          if ((mask & 1) !== 0) {
            drawn = true;
          }
          return 0;
        }
        if (op === Op.Color) {
          red = f64(a);
          green = f64(b);
          blue = f64(c);
          alpha = f64(d);
          return 0;
        }
        if (op === Op.Vertex) {
          pushVertex(f64(a), f64(b), f64(c));
          return 0;
        }
        if (op === Op.TexCoord) {
          u = f64(a);
          v = f64(b);
          return 0;
        }
        if (op === Op.Normal) {
          nx = f64(a);
          ny = f64(b);
          nz = f64(c);
          return 0;
        }
        if (op === Op.Begin) {
          primitive = iarg(a);
          batch = [];
          return 0;
        }
        if (op === Op.End) {
          const source = batch;
          batch = [];
          await paint(source, primitive);
          return 0;
        }
        if (op === Op.MatrixMode) {
          matrixMode = iarg(a) === 1 ? 1 : 0;
          return 0;
        }
        if (op === Op.LoadIdentity) {
          replaceTop(identity());
          return 0;
        }
        if (op === Op.PushMatrix) {
          if (currentStack().length >= 32) {
            fail("矩阵栈已满");
          }
          currentStack().push(top().slice());
          return 0;
        }
        if (op === Op.PopMatrix) {
          if (currentStack().length < 2) {
            fail("矩阵栈不能再弹出");
          }
          currentStack().pop();
          return 0;
        }
        if (op === Op.Translate) {
          const m = identity();
          m[12] = f64(a);
          m[13] = f64(b);
          m[14] = f64(c);
          replaceTop(multiply(top(), m));
          return 0;
        }
        if (op === Op.Rotate) {
          const axisX = f64(b);
          const axisY = f64(c);
          const axisZ = f64(d);
          const length = Math.hypot(axisX, axisY, axisZ);
          if (length === 0) {
            return 0;
          }
          const angle = f64(a) * Math.PI / 180;
          const cosine = Math.cos(angle);
          const sine = Math.sin(angle);
          const turn = 1 - cosine;
          const ux = axisX / length;
          const uy = axisY / length;
          const uz = axisZ / length;
          const m = identity();
          m[0] = turn * ux * ux + cosine;
          m[1] = turn * ux * uy + sine * uz;
          m[2] = turn * ux * uz - sine * uy;
          m[4] = turn * ux * uy - sine * uz;
          m[5] = turn * uy * uy + cosine;
          m[6] = turn * uy * uz + sine * ux;
          m[8] = turn * ux * uz + sine * uy;
          m[9] = turn * uy * uz - sine * ux;
          m[10] = turn * uz * uz + cosine;
          replaceTop(multiply(top(), m));
          return 0;
        }
        if (op === Op.Scale) {
          const m = identity();
          m[0] = f64(a);
          m[5] = f64(b);
          m[10] = f64(c);
          replaceTop(multiply(top(), m));
          return 0;
        }
        if (op === Op.Ortho) {
          const left = f64(a);
          const right = f64(b);
          const bottom = f64(c);
          const topEdge = f64(d);
          if (right === left || topEdge === bottom || far === near) {
            fail("投影的两边重合");
          }
          const m = identity();
          m[0] = 2 / (right - left);
          m[5] = 2 / (topEdge - bottom);
          m[10] = -2 / (far - near);
          m[12] = -(right + left) / (right - left);
          m[13] = -(topEdge + bottom) / (topEdge - bottom);
          m[14] = -(far + near) / (far - near);
          replaceTop(multiply(top(), m));
          return 0;
        }
        if (op === Op.OrthoDepth) {
          near = f64(a);
          far = f64(b);
          return 0;
        }
        if (op === Op.Frustum) {
          const left = f64(a);
          const right = f64(b);
          const bottom = f64(c);
          const topEdge = f64(d);
          if (near <= 0 || far <= 0 || right === left || topEdge === bottom || far === near) {
            fail("视锥的近远或左右不成立");
          }
          const m = identity();
          m[0] = (2 * near) / (right - left);
          m[5] = (2 * near) / (topEdge - bottom);
          m[8] = (right + left) / (right - left);
          m[9] = (topEdge + bottom) / (topEdge - bottom);
          m[10] = -(far + near) / (far - near);
          m[11] = -1;
          m[14] = -(2 * far * near) / (far - near);
          m[15] = 0;
          replaceTop(multiply(top(), m));
          return 0;
        }
        if (op === Op.FrustumDepth) {
          near = f64(a);
          far = f64(b);
          return 0;
        }
        if (op === Op.Enable) {
          capability(iarg(a), true);
          return 0;
        }
        if (op === Op.Disable) {
          capability(iarg(a), false);
          return 0;
        }
        if (op === Op.GenTexture) {
          const id = nextTexture;
          nextTexture += 1;
          textures.set(id, { w: 1, h: 1, rgba: new Uint8Array([255, 255, 255, 255]) });
          return id;
        }
        if (op === Op.BindTexture) {
          boundTexture = iarg(a);
          uploadBound();
          return 0;
        }
        if (op === Op.TexImage) {
          const w = iarg(a);
          const h = iarg(b);
          const address = iarg(c);
          if (boundTexture < 1) {
            fail("还没有绑定纹理");
          }
          if (w < 1 || h < 1) {
            fail("纹理边长小于 1");
          }
          const rgba = readBytes(address, w * h * 4);
          textures.set(boundTexture, { w, h, rgba });
          uploadBound();
          return 0;
        }
        if (op === Op.DrawArrays) {
          const mode = iarg(a);
          const first = iarg(b);
          const count = iarg(c);
          if (first < 0 || count < 0) {
            fail("DrawArrays 的起点或个数小于 0");
          }
          const start = first * floatsPerVertex;
          const end = start + count * floatsPerVertex;
          if (end > batch.length) {
            fail("DrawArrays 超出已提交的顶点");
          }
          await paint(batch.slice(start, end), mode);
          return 0;
        }
        if (op === Op.BlendFunc) {
          blendFactor(iarg(a));
          blendFactor(iarg(b));
          blendSrc = iarg(a);
          blendDst = iarg(b);
          pipeline = null;
          return 0;
        }
        if (op === Op.DepthFunc) {
          const func = iarg(a);
          if (func < 0 || func > 7) {
            fail("没有这种深度比较");
          }
          depthFunc = func;
          pipeline = null;
          return 0;
        }
        if (op === Op.CullFace) {
          const face = iarg(a);
          if (face < 0 || face > 2) {
            fail("没有这种剔除面");
          }
          cullFace = face;
          pipeline = null;
          return 0;
        }
        if (op === Op.FrontFace) {
          const order = iarg(a);
          if (order !== 0 && order !== 1) {
            fail("没有这种绕序");
          }
          frontCw = order === 1;
          pipeline = null;
          return 0;
        }
        if (op === Op.Corner) {
          const radius = f64(a);
          if (radius < 0) {
            fail("圆角半径是负数");
          }
          cornerRadius = radius;
          return 0;
        }
        if (op === Op.Frame) {
          const edge = f64(a);
          if (edge === 0) {
            return width;
          }
          if (edge === 1) {
            return height;
          }
          fail("没有这条帧边");
        }
        if (op === Op.Fill || op === Op.Round || op === Op.Ellipse || op === Op.ScreenGlyph) {
          const mode = op === Op.ScreenGlyph ? 1 : op === Op.Round ? 2 : op === Op.Ellipse ? 3 : 0;
          return await paintScreen(mode, iarg(a), iarg(b), iarg(c), iarg(d));
        }
        fail("没有这种加速操作");
      }

      /**
       * 把最近一次加速绘制读回帧存储。
       * 还没绘制过就什么都不写，节点树合成的像素留在帧里。
       */
      export async function blit(frame: Uint32Array, frameWidth: number, frameHeight: number): Promise<void> {
        await flushScreenRun();
        if (!drawn || device === null || color === null || readback === null) {
          return;
        }
        const bytesPerRow = Math.ceil((frameWidth * 4) / 256) * 256;
        const encoder = device.createCommandEncoder();
        encoder.copyTextureToBuffer(
          { texture: color },
          { buffer: readback, bytesPerRow },
          { width: frameWidth, height: frameHeight },
        );
        device.queue.submit([encoder.finish()]);
        await readback.mapAsync(GPUMapMode.READ);
        const bytes = new Uint8Array(readback.getMappedRange());
        let pixel = 0;
        for (let y = 0; y < frameHeight; y += 1) {
          let offset = y * bytesPerRow;
          const rowEnd = pixel + frameWidth;
          while (pixel < rowEnd) {
            const red = bytes[offset] ?? 0;
            const green = bytes[offset + 1] ?? 0;
            const blue = bytes[offset + 2] ?? 0;
            frame[pixel] = (red << 16) | (green << 8) | blue;
            offset += 4;
            pixel += 1;
          }
        }
        readback.unmap();
        drawn = false;
      }
    }
  }
}
