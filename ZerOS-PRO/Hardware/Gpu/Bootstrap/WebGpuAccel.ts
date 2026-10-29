/**
 * @module ZerOS.Hardware.Gpu.WebGpuAccel
 * @description 用 WebGPU 执行 gpu.accel
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 固定功能管线：矩阵、顶点、纹理、清除和绘制。
 * 屏幕矩形、圆角、椭圆和屏幕字形按颜色目标的像素坐标画，不使用矩阵栈。
 * 这些图元先记在列表里，到 present、读回，或下一条要占用颜色目标的三维绘制时，一次提交。
 * 只在显卡线程里使用。浏览器必须提供 WebGPU。
 * 没有绘制时不改帧存储，节点树的合成结果保持原样。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 状态与设备
 *   3. 命令
 *   4. 读回帧与位图
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as OpRoot } from "../Enum/AccelOp";
import { ZerOS as GlyphRoot } from "../Structure/UiGlyph";
import { ZerOS as MemoryRoot } from "./VideoMemory";
import { ZerOS as FontBytesRoot } from "../Font/FontBytes";
import { ZerOS as FontSessionRoot } from "../Font/FontSession";
import { type ZerOS as StampRoot } from "../Structure/FontStamp";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Gpu {
      const Op = OpRoot.Hardware.Gpu.AccelOp;
      const takeFontBytes = FontBytesRoot.Hardware.Gpu.takeFontBytes;
      const machineFont = FontSessionRoot.Hardware.Gpu.machineFont;
      type FontStamp = StampRoot.Hardware.Gpu.FontStamp;
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
}
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

struct Vin {
  @location(0) pos: vec3<f32>,
  @location(1) color: vec4<f32>,
  @location(2) uv: vec2<f32>,
  @location(3) normal: vec3<f32>,
  @location(4) shape: vec4<f32>,
  @location(5) box: vec4<f32>,
  @location(6) clip: vec4<f32>,
}
struct Vout {
  @builtin(position) pixel: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) uv: vec2<f32>,
  @location(2) normal: vec3<f32>,
  @location(3) @interpolate(flat) shape: vec4<f32>,
  @location(4) @interpolate(flat) box: vec4<f32>,
  @location(5) @interpolate(flat) clip: vec4<f32>,
}

@vertex fn vs(v: Vin) -> Vout {
  var o: Vout;
  o.pixel = u.mvp * vec4<f32>(v.pos, 1.0);
  o.color = v.color;
  o.uv = v.uv;
  o.normal = v.normal;
  o.shape = v.shape;
  o.box = v.box;
  o.clip = v.clip;
  return o;
}

@fragment fn fs(i: Vout) -> @location(0) vec4<f32> {
  let sampled = textureSample(tex, samp, i.uv);
  let mixed = mix(vec4<f32>(1.0, 1.0, 1.0, 1.0), sampled, max(i.normal.x, 0.0));
  let p = i.pixel.xy;
  if (i.shape.z > 0.5) {
    if (p.x < i.clip.x || p.y < i.clip.y || p.x >= i.clip.x + i.clip.z || p.y >= i.clip.y + i.clip.w) {
      discard;
    }
  }
  let half = i.box.zw * 0.5;
  let center = i.box.xy + half;
  if (i.shape.x > 0.5 && i.shape.x < 1.5) {
    let r = min(max(i.shape.y, 0.0), min(half.x, half.y));
    let q = abs(p - center) - (half - vec2<f32>(r, r));
    let d = length(max(q, vec2<f32>(0.0, 0.0))) + min(max(q.x, q.y), 0.0) - r;
    if (d > 0.0) {
      discard;
    }
  }
  if (i.shape.x > 1.5) {
    let n = (p - center) / half;
    if (dot(n, n) > 1.0) {
      discard;
    }
  }
  return i.color * mixed;
}
`;

      /**
       * 把颜色目标原样盖满一张画布。
       * 顶点是铺满裁剪空间的三角形。片段位置就是纹理像素，原点在左上，不用采样器，避免过滤把界面糊掉。
       */
      const viewShader = `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<uniform> origin: vec2<u32>;

@vertex fn vs(@builtin(vertex_index) index: u32) -> @builtin(position) vec4<f32> {
  var x = -1.0;
  var y = -1.0;
  if (index == 1u) {
    x = 3.0;
  }
  if (index == 2u) {
    y = 3.0;
  }
  return vec4<f32>(x, y, 0.0, 1.0);
}

@fragment fn fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  let at = vec2<i32>(floor(pos.xy)) + vec2<i32>(origin);
  return textureLoad(src, at, 0);
}
`;

      function fail(message: string): never {
        throw new Error(`${accelPrefix} ${message}`);
      }

      /**
       * 还原浮点用的八个字节。
       * 进度条、圆角和每个字形都要把寄存器里的位型换回浮点。每次新开一块，一帧会生出几千个短命对象。
       */
      const floatBits = new DataView(new ArrayBuffer(8));

      /** 寄存器里的二进制 64 位型，按小端还原成有限浮点。 */
      function f64(bits: bigint): number {
        floatBits.setBigInt64(0, BigInt.asIntN(64, bits), true);
        const value = floatBits.getFloat64(0, true);
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
      /**
       * 颜色目标和深度目标的视图只建一次。
       * 每一帧都 createView，浏览器会把旧视图留到队列结束才回收。
       * 加载圈一直在画，视图越积越多，同一次提交就越来越慢。
       * 换了纹理必须丢掉，否则还会画到已经作废的那张上。
       */
      let colorView: GPUTextureView | null = null;
      let depthView: GPUTextureView | null = null;
      let pipeline: GPURenderPipeline | null = null;
      let uniform: GPUBuffer | null = null;
      let vertices: GPUBuffer | null = null;
      let readback: GPUBuffer | null = null;
      /** 交给页面的画布。尺寸一变就丢掉，下一帧按新分辨率再要一张。 */
      let viewCanvas: OffscreenCanvas | null = null;
      let viewContext: GPUCanvasContext | null = null;
      let viewPipe: GPURenderPipeline | null = null;
      let viewOriginBuffer: GPUBuffer | null = null;
      let viewGroup: GPUBindGroup | null = null;
      /** 这一帧真正改过的像素。下一次位图只交这块，不再整帧读回。 */
      let inkLeft = 0;
      let inkTop = 0;
      let inkRight = 0;
      let inkBottom = 0;
      let inkAny = false;
      let postedX = 0;
      let postedY = 0;
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
      /** 屏幕顶点比三维多三组：形状、包围盒、剪裁。三维的 DrawArrays 仍用 12。 */
      const screenFloats = 24;
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
      /** 同一纹理的矩形、圆角、椭圆和字形记在一份顶点里，到提交时再画。 */
      let screenVertices: GPUBuffer | null = null;
      let screenVertexBytes = 0;
      let screenGroup: GPUBindGroup | null = null;
      /**
       * 一次清除和它后面的图元是一段。
       * 下一次清除再开一段。提交时一段一个渲染通道，整份只进一次队列。
       */
      interface ScreenPass {
        clearColor: boolean;
        red: number;
        green: number;
        blue: number;
        alpha: number;
        clearDepth: boolean;
        z: number;
        /** 这一段第一个顶点在 scratch 里的下标。 */
        first: number;
        /** 这一段的顶点个数。 */
        count: number;
      }
      const screenPasses: ScreenPass[] = [];
      /**
       * 屏幕顶点写在这一块里。每个角再 new 一个短数组的话，CPU 页一帧有几百个字形，
       * 鼠标连着动时回收会把页面线程拖住。提交前先抄出这一帧：准备设备会让出，下一批从开头写。
       */
      let screenScratch = new Float32Array(65536);
      let screenUsed = 0;
      /** 只清深度时先记下，下一段或提交时再用。 */
      let screenDepthPending = false;
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

      /**
       * 颜色或深度纹理换掉之后，挂在上面的视图和拷贝绑定组一并作废。
       * 不在这里 destroy：上一份命令可能还在队列里引用它们，等浏览器自己收。
       */
      function dropTargetViews(): void {
        colorView = null;
        depthView = null;
        viewGroup = null;
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
        dropTargetViews();
        readback = null;
        viewCanvas = null;
        viewContext = null;
        viewGroup = null;
        pipeline = null;
        colorReady = false;
        depthReady = false;
      }

      /** 同一张颜色纹理始终返回同一个视图。第一次用到才创建。 */
      function colorAttachment(texture: GPUTexture): GPUTextureView {
        return colorView ??= texture.createView();
      }

      /** 同一张深度纹理始终返回同一个视图。 */
      function depthAttachment(texture: GPUTexture): GPUTextureView {
        return depthView ??= texture.createView();
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
        /* 旧纹理已经空了。若视图还指着它，下一帧会画到已经丢掉的目标上。 */
        dropTargetViews();
        color = active.createTexture({
          size: { width, height },
          format: "rgba8unorm",
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING,
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
            view: colorAttachment(color),
            loadOp: colorReady ? "load" : "clear",
            clearValue: { r: clearRed, g: clearGreen, b: clearBlue, a: clearAlpha },
            storeOp: "store",
          }],
          depthStencilAttachment: {
            view: depthAttachment(depth),
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
              arrayStride: screenFloats * 4,
              attributes: [
                { shaderLocation: 0, offset: 0, format: "float32x3" },
                { shaderLocation: 1, offset: 12, format: "float32x4" },
                { shaderLocation: 2, offset: 28, format: "float32x2" },
                { shaderLocation: 3, offset: 36, format: "float32x3" },
                { shaderLocation: 4, offset: 48, format: "float32x4" },
                { shaderLocation: 5, offset: 64, format: "float32x4" },
                { shaderLocation: 6, offset: 80, format: "float32x4" },
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

      /** 还没有图元时开一段。这一段记下当时的清除色，隐式清屏不会被后面的改色带走。 */
      function screenTail(): ScreenPass {
        const last = screenPasses[screenPasses.length - 1];
        if (last !== undefined) {
          return last;
        }
        const created: ScreenPass = {
          clearColor: false,
          red: clearRed,
          green: clearGreen,
          blue: clearBlue,
          alpha: clearAlpha,
          clearDepth: screenDepthPending,
          z: clearZ,
          first: screenUsed / screenFloats,
          count: 0,
        };
        screenDepthPending = false;
        screenPasses.push(created);
        return created;
      }

      /** 顶点要写到的位置超出现有缓冲时加倍。只抄已经写入的前缀。 */
      function ensureScreen(count: number): void {
        const need = screenUsed + count;
        if (need <= screenScratch.length) {
          return;
        }
        let size = screenScratch.length;
        while (size < need) {
          size *= 2;
        }
        const next = new Float32Array(size);
        next.set(screenScratch.subarray(0, screenUsed));
        screenScratch = next;
      }

      /** 按与原来每个角相同的 24 个数写下标，不再为这个角分配数组。 */
      function writeScreenVertex(
        at: number,
        px: number,
        py: number,
        su: number,
        sv: number,
        font: number,
        mode: number,
        radius: number,
        clipOn: number,
        originX: number,
        originY: number,
        cellWidth: number,
        cellHeight: number,
        tintR: number,
        tintG: number,
        tintB: number,
        tintA: number,
      ): void {
        const scratch = screenScratch;
        scratch[at] = px;
        scratch[at + 1] = py;
        scratch[at + 2] = 0;
        scratch[at + 3] = tintR;
        scratch[at + 4] = tintG;
        scratch[at + 5] = tintB;
        scratch[at + 6] = tintA;
        scratch[at + 7] = su;
        scratch[at + 8] = sv;
        scratch[at + 9] = font;
        scratch[at + 10] = 0;
        scratch[at + 11] = 0;
        scratch[at + 12] = mode;
        scratch[at + 13] = radius;
        scratch[at + 14] = clipOn;
        scratch[at + 15] = 0;
        scratch[at + 16] = originX;
        scratch[at + 17] = originY;
        scratch[at + 18] = cellWidth;
        scratch[at + 19] = cellHeight;
        scratch[at + 20] = scissorX;
        scratch[at + 21] = scissorY;
        scratch[at + 22] = scissorW;
        scratch[at + 23] = scissorH;
      }

      /**
       * 颜色清除并进当前段。这段已经有图元时另开一段，好让清除发生在那些图元之后。
       * 只清深度先挂起，不单独占一次提交。
       */
      function markInk(x: number, y: number, cellWidth: number, cellHeight: number): void {
        const left = Math.max(0, Math.floor(x));
        const top = Math.max(0, Math.floor(y));
        const right = Math.min(width, Math.ceil(x + cellWidth));
        const bottom = Math.min(height, Math.ceil(y + cellHeight));
        if (right <= left || bottom <= top) {
          return;
        }
        if (!inkAny) {
          inkLeft = left;
          inkTop = top;
          inkRight = right;
          inkBottom = bottom;
          inkAny = true;
          return;
        }
        if (left < inkLeft) {
          inkLeft = left;
        }
        if (top < inkTop) {
          inkTop = top;
        }
        if (right > inkRight) {
          inkRight = right;
        }
        if (bottom > inkBottom) {
          inkBottom = bottom;
        }
      }

      function markFull(): void {
        inkLeft = 0;
        inkTop = 0;
        inkRight = width;
        inkBottom = height;
        inkAny = true;
      }

      function recordClear(mask: number): void {
        const colorBit = (mask & 1) !== 0;
        const depthBit = (mask & 2) !== 0;
        if (depthBit) {
          screenDepthPending = true;
        }
        if (!colorBit) {
          return;
        }
        /* 清颜色会改整帧。这一次位图必须把整幅交出去，不能只交后面画上的那一行。 */
        markFull();
        const last = screenPasses[screenPasses.length - 1];
        if (last?.count === 0) {
          last.clearColor = true;
          last.red = clearRed;
          last.green = clearGreen;
          last.blue = clearBlue;
          last.alpha = clearAlpha;
          if (screenDepthPending) {
            last.clearDepth = true;
            last.z = clearZ;
            screenDepthPending = false;
          }
          return;
        }
        screenPasses.push({
          clearColor: true,
          red: clearRed,
          green: clearGreen,
          blue: clearBlue,
          alpha: clearAlpha,
          clearDepth: screenDepthPending,
          z: clearZ,
          first: screenUsed / screenFloats,
          count: 0,
        });
        screenDepthPending = false;
      }

      /**
       * 用颜色目标自己的像素坐标记一个矩形、圆角、椭圆或字形。
       * shape 的 x 是 0 实心、1 圆角、2 椭圆。法线 x 为 1 时采样字形。
       * 半径、包围盒和剪裁都写在顶点上，不同图元可以留在同一次绘制里。
       * 原点在左上，y 向下。不碰矩阵栈，也不看混合开关；透明度总是按源透明度叠上去。
       */
      function pushScreenQuad(x: number, y: number, cellWidth: number, cellHeight: number, u0: number, v0: number, u1: number, v1: number, font: number, mode: number, radius: number): void {
        markInk(x, y, cellWidth, cellHeight);
        const tintR = clampUnit(red);
        const tintG = clampUnit(green);
        const tintB = clampUnit(blue);
        const tintA = clampUnit(alpha);
        const left = (x / width) * 2 - 1;
        const right = ((x + cellWidth) / width) * 2 - 1;
        const top = 1 - (y / height) * 2;
        const bottom = 1 - ((y + cellHeight) / height) * 2;
        const clipOn = scissorOn ? 1 : 0;
        const pass = screenTail();
        const quad = screenFloats * 6;
        ensureScreen(quad);
        const base = screenUsed;
        writeScreenVertex(base, left, top, u0, v0, font, mode, radius, clipOn, x, y, cellWidth, cellHeight, tintR, tintG, tintB, tintA);
        writeScreenVertex(base + screenFloats, right, top, u1, v0, font, mode, radius, clipOn, x, y, cellWidth, cellHeight, tintR, tintG, tintB, tintA);
        writeScreenVertex(base + screenFloats * 2, right, bottom, u1, v1, font, mode, radius, clipOn, x, y, cellWidth, cellHeight, tintR, tintG, tintB, tintA);
        writeScreenVertex(base + screenFloats * 3, left, top, u0, v0, font, mode, radius, clipOn, x, y, cellWidth, cellHeight, tintR, tintG, tintB, tintA);
        writeScreenVertex(base + screenFloats * 4, right, bottom, u1, v1, font, mode, radius, clipOn, x, y, cellWidth, cellHeight, tintR, tintG, tintB, tintA);
        writeScreenVertex(base + screenFloats * 5, left, bottom, u0, v1, font, mode, radius, clipOn, x, y, cellWidth, cellHeight, tintR, tintG, tintB, tintA);
        screenUsed = base + quad;
        pass.count += 6;
      }

      /**
       * 把记下的屏幕图元一次提交。
       * 每一段清除是一个渲染通道，顶点在通道之间按顺序画，队列只收这一份命令。
       */
      export async function flushScreen(): Promise<void> {
        const passes = screenPasses.splice(0);
        const used = screenUsed;
        /* 准备设备会让出线程。先把这一帧抄出来，下一批字形才能从缓冲开头接着写。 */
        const snapshot = used > 0 ? screenScratch.slice(0, used) : null;
        screenUsed = 0;
        if (screenDepthPending) {
          passes.push({
            clearColor: false,
            red: clearRed,
            green: clearGreen,
            blue: clearBlue,
            alpha: clearAlpha,
            clearDepth: true,
            z: clearZ,
            first: 0,
            count: 0,
          });
          screenDepthPending = false;
        }
        if (passes.length === 0) {
          return;
        }
        const active = await ensure();
        buildFont(active);
        if (color === null || depth === null || uniform === null || sampler === null || fontTexture === null) {
          fail("颜色目标还没有建立");
        }
        const pipe = screenPipe(active);
        const mvp = new Float32Array(17);
        mvp.set(identity());
        active.queue.writeBuffer(uniform, 0, mvp);
        const draws: { readonly first: number; readonly count: number }[] = [];
        for (const pass of passes) {
          draws.push({ first: pass.first, count: pass.count });
        }
        let buffer = screenVertices;
        if (snapshot !== null) {
          const data = snapshot;
          const bytes = data.byteLength;
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
        }
        const group = screenGroup ?? active.createBindGroup({
          layout: pipe.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: uniform } },
            { binding: 1, resource: fontTexture.createView() },
            { binding: 2, resource: sampler },
          ],
        });
        screenGroup = group;
        const encoder = active.createCommandEncoder();
        let painted = false;
        for (let index = 0; index < passes.length; index += 1) {
          const pass = passes[index];
          const draw = draws[index];
          if (pass === undefined || draw === undefined) {
            continue;
          }
          const clearColor = pass.clearColor || (!colorReady && draw.count > 0);
          const gpuPass = encoder.beginRenderPass({
            colorAttachments: [{
              view: colorAttachment(color),
              loadOp: clearColor ? "clear" : "load",
              clearValue: { r: pass.red, g: pass.green, b: pass.blue, a: pass.alpha },
              storeOp: "store",
            }],
            depthStencilAttachment: {
              view: depthAttachment(depth),
              depthLoadOp: pass.clearDepth || !depthReady ? "clear" : "load",
              depthClearValue: pass.z,
              depthStoreOp: "store",
            },
          });
          if (draw.count > 0 && buffer !== null) {
            gpuPass.setPipeline(pipe);
            gpuPass.setBindGroup(0, group);
            gpuPass.setViewport(0, 0, width, height, 0, 1);
            gpuPass.setVertexBuffer(0, buffer);
            gpuPass.draw(draw.count, 1, draw.first, 0);
          }
          gpuPass.end();
          if (pass.clearColor || draw.count > 0 || pass.clearDepth) {
            colorReady = true;
          }
          if (pass.clearColor || draw.count > 0) {
            painted = true;
          }
          depthReady = true;
        }
        active.queue.submit([encoder.finish()]);
        if (painted) {
          drawn = true;
        }
      }

      function paintScreen(mode: number, a: number, b: number, c: number, d: number): number {
        if (mode === 2 || mode === 3) {
          if (c < 0 || d < 0) {
            fail("矩形宽或高是负数");
          }
          if (c === 0 || d === 0 || !coversTarget(a, b, c, d)) {
            return 0;
          }
          const radius = mode === 2 ? cornerRadius : 0;
          const sdf = mode === 2 ? 1 : 2;
          pushScreenQuad(a, b, c, d, 0, 0, 1, 1, 0, sdf, radius);
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
        pushScreenQuad(x, y, cellWidth, cellHeight, u0, v0, u1, v1, font, 0, 0);
        return 0;
      }

      /** 这些操作只改屏幕列表或它的状态，不能把已经记下的图元提前提交。 */
      function screenHolds(op: number): boolean {
        return op === Op.Fill
          || op === Op.ScreenGlyph
          || op === Op.Color
          || op === Op.Corner
          || op === Op.Round
          || op === Op.Ellipse
          || op === Op.Scissor
          || op === Op.ClearColor
          || op === Op.ClearDepth
          || op === Op.Clear
          || op === Op.Frame
          || op === Op.Enable
          || op === Op.Disable;
      }

      /**
       * 只追加屏幕图元或改它的状态，不提交，也不等待。
       * 不是这类操作时返回 null。调用方先把已经记下的图元提交，再走会等待的那条。
       * 进度条的轨道、填充和亮线，以及每个字形，都是这类操作。
       */
      function heldAccel(op: number, a: bigint, b: bigint, c: bigint, d: bigint): number | null {
        if (!screenHolds(op)) {
          return null;
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
          recordClear(iarg(a));
          return 0;
        }
        if (op === Op.Color) {
          red = f64(a);
          green = f64(b);
          blue = f64(c);
          alpha = f64(d);
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
          return paintScreen(mode, iarg(a), iarg(b), iarg(c), iarg(d));
        }
        fail("没有这种加速操作");
      }

      /** 给一批屏幕命令用。做不到当场完成时返回 null。 */
      export function accelImmediate(op: number, a: bigint, b: bigint, c: bigint, d: bigint): number | null {
        return heldAccel(op, a, b, c, d);
      }

      /**
       * 把一枚字形掩码按当前颜色盖上去。合成和 Fill 一样，完全落在目标外的行不提交。
       * 着墨是 255。0 留空，不抗锯齿。
       */
      function paintStamp(stamp: FontStamp): void {
        for (let row = 0; row < stamp.height; row += 1) {
          let column = 0;
          while (column < stamp.width) {
            while (column < stamp.width && stamp.coverage[row * stamp.width + column] !== 255) {
              column += 1;
            }
            const start = column;
            while (column < stamp.width && stamp.coverage[row * stamp.width + column] === 255) {
              column += 1;
            }
            const run = column - start;
            if (run > 0 && coversTarget(stamp.x + start, stamp.y + row, run, 1)) {
              pushScreenQuad(stamp.x + start, stamp.y + row, run, 1, 0, 0, 1, 1, 0, 0, 0);
            }
          }
        }
      }

      /**
       * 字体面三条命令。字节已经由执行核心从线性位元读出。
       * 失败时一条图章都不追加，颜色目标保持调用前的内容。
       */
      function paintFont(op: number, a: bigint, b: bigint, c: bigint, d: bigint): number {
        const answer = machineFont().command(op, a, b, c, d, takeFontBytes());
        if (!answer.ok) {
          fail("font command was rejected");
        }
        for (const stamp of answer.ink) {
          paintStamp(stamp);
        }
        return answer.id;
      }

      /**
       * 执行一条加速命令。
       * 返回值写入调用方的结果寄存器；多数命令返回 0，生成纹理时返回新编号。
       * 屏幕图元只追加。要画到三维管线或读像素之前，才把列表提交。
       * 字体面在追加之前解析。失败不把已经记下的屏幕图元提前提交。
       */
      export async function accel(op: number, a: bigint, b: bigint, c: bigint, d: bigint): Promise<number> {
        if (op === Op.FontFace || op === Op.FontSelect || op === Op.FontDraw) {
          return paintFont(op, a, b, c, d);
        }
        const held = heldAccel(op, a, b, c, d);
        if (held !== null) {
          return held;
        }
        await flushScreen();
        if (op === Op.Viewport) {
          viewportX = f64(a);
          viewportY = f64(b);
          viewportW = f64(c);
          viewportH = f64(d);
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
        fail("没有这种加速操作");
      }

      /** OffscreenCanvas 的 getContext 返回联合类型。WebGPU 上下文才有 configure。 */
      function isGpuCanvas(context: RenderingContext | OffscreenRenderingContext): context is GPUCanvasContext {
        return "configure" in context && "getCurrentTexture" in context;
      }

      /** 最近一次位图相对整帧的左上角。整幅时是 0,0。 */
      export function viewOrigin(): { readonly x: number; readonly y: number } {
        return { x: postedX, y: postedY };
      }

      /**
       * 准备一张刚好盖住这块脏矩形的画布。
       * 浏览器画布的像素格式常常不是 rgba8unorm，所以不用纹理拷贝，改画一个铺满的三角形。
       * 尺寸没变就沿用上一张。位图被拿走之后，下一次 getCurrentTexture 会换新纹理。
       */
      function ensureView(active: GPUDevice, patchWidth: number, patchHeight: number): OffscreenCanvas {
        const existing = viewCanvas;
        if (
          existing !== null
          && existing.width === patchWidth
          && existing.height === patchHeight
          && viewContext !== null
          && viewPipe !== null
          && viewOriginBuffer !== null
        ) {
          return existing;
        }
        const canvas = new OffscreenCanvas(patchWidth, patchHeight);
        const context = canvas.getContext("webgpu");
        if (context === null || !isGpuCanvas(context)) {
          fail("画面画布没有 WebGPU 上下文");
        }
        const format = navigator.gpu.getPreferredCanvasFormat();
        context.configure({
          device: active,
          format,
          alphaMode: "opaque",
        });
        viewCanvas = canvas;
        viewContext = context;
        /* 统一缓冲的绑定长度必须是 16 的倍数。只要 8 字节时绑定会失败，
           位图做不成，每个键都退回整帧读回。 */
        viewOriginBuffer ??= active.createBuffer({
          size: 16,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        if (viewPipe === null) {
          const module = active.createShaderModule({ code: viewShader });
          viewPipe = active.createRenderPipeline({
            layout: "auto",
            vertex: { module, entryPoint: "vs" },
            fragment: {
              module,
              entryPoint: "fs",
              targets: [{ format }],
            },
            primitive: { topology: "triangle-list" },
          });
        }
        return canvas;
      }

      /**
       * 把颜色目标里这块矩形画进位图。
       * 先等这一次提交做完，再把画布交出去。位图拿走之后画布是空的，下一帧会再画。
       * 只交改过的那一块。整帧读回会让每个键都等一两百毫秒。
       */
      async function copyColor(active: GPUDevice, source: GPUTexture, originX: number, originY: number, patchWidth: number, patchHeight: number): Promise<ImageBitmap> {
        const canvas = ensureView(active, patchWidth, patchHeight);
        const context = viewContext;
        const pipe = viewPipe;
        const originBuffer = viewOriginBuffer;
        if (context === null || pipe === null || originBuffer === null) {
          fail("画面画布还没有建立");
        }
        const packed = new Uint32Array([originX, originY]);
        active.queue.writeBuffer(originBuffer, 0, packed);
        /* 源纹理不变就复用绑定组。每一帧新建一份，会和视图一样越积越慢。 */
        const group = viewGroup ??= active.createBindGroup({
          layout: pipe.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: colorAttachment(source) },
            { binding: 1, resource: { buffer: originBuffer } },
          ],
        });
        const encoder = active.createCommandEncoder();
        const pass = encoder.beginRenderPass({
          colorAttachments: [{
            /* 位图被拿走后，画布换上一张新纹理。这一张的视图不能留到下一帧。 */
            view: context.getCurrentTexture().createView(),
            loadOp: "clear",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
          }],
        });
        pass.setPipeline(pipe);
        pass.setBindGroup(0, group);
        pass.draw(3);
        pass.end();
        active.queue.submit([encoder.finish()]);
        await active.queue.onSubmittedWorkDone();
        postedX = originX;
        postedY = originY;
        return canvas.transferToImageBitmap();
      }

      /**
       * 加速器刚画过时，交出一张位图，不再把每个像素读回成整数。
       * 位图只覆盖这一帧改过的矩形，左上角在 viewOrigin。
       * 还没画过就返回空，调用方继续用节点树合成的帧。失败时也返回空，同一幅仍可以走读回。
       */
      export async function snapshot(): Promise<ImageBitmap | null> {
        await flushScreen();
        const active = device;
        const source = color;
        if (!drawn || active === null || source === null) {
          return null;
        }
        const originX = inkAny ? inkLeft : 0;
        const originY = inkAny ? inkTop : 0;
        const patchWidth = inkAny ? Math.max(1, inkRight - inkLeft) : width;
        const patchHeight = inkAny ? Math.max(1, inkBottom - inkTop) : height;
        inkAny = false;
        try {
          const bitmap = await copyColor(active, source, originX, originY, patchWidth, patchHeight);
          drawn = false;
          return bitmap;
        } catch {
          viewCanvas = null;
          viewContext = null;
          viewGroup = null;
          return null;
        }
      }

      /**
       * 把最近一次加速绘制读回帧存储。
       * 还没绘制过就什么都不写，节点树合成的像素留在帧里。
       * 自检和启动画面仍走这里。稳态画面用 snapshot，不再整帧读回。
       */
      export async function blit(frame: Uint32Array, frameWidth: number, frameHeight: number): Promise<void> {
        await flushScreen();
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
