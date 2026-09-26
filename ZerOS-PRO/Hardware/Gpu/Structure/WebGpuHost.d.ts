/**
 * 浏览器 WebGPU 的用法标志。
 *
 * 当前 TypeScript 的 DOM 库已经声明适配器、设备、纹理、缓冲、管线和渲染通道。
 * 这些接口若在这里再写一遍，会和 DOM 库合并：只读修饰符不一致，纹理格式、范围和绑定资源的类型也对不上。
 * 同一份 DOM 库仍没有 GPUTextureUsage、GPUBufferUsage、GPUMapMode 这三个运行时对象。
 * 标志的数值由开启了 WebGPU 的浏览器提供，这里只声明加速实现会按位组合的那些名字。
 */

declare const GPUTextureUsage: {
  readonly TEXTURE_BINDING: number;
  readonly COPY_DST: number;
  readonly COPY_SRC: number;
  readonly RENDER_ATTACHMENT: number;
};

declare const GPUBufferUsage: {
  readonly VERTEX: number;
  readonly COPY_DST: number;
  readonly COPY_SRC: number;
  readonly UNIFORM: number;
  readonly MAP_READ: number;
};

declare const GPUMapMode: {
  readonly READ: number;
};
