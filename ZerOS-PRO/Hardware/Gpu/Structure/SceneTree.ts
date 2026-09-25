/**
 * @module ZerOS.Hardware.Gpu.SceneTree
 * @description 显卡内部的节点树
 *
 * ---------------------------------------------------------------------------
 * 文件职责
 * ---------------------------------------------------------------------------
 * 根、盒子和文本都留在显卡线程。坐标相对父节点，文本按对齐排成 8×8 字形。
 * 不写帧存储。Compose 只向调用方要一块新缓冲，成功后由帧存储换上。
 *
 * ---------------------------------------------------------------------------
 * 代码组织（严格优先级，自上而下，禁止打乱）
 * ---------------------------------------------------------------------------
 *   1. 导入
 *   2. 树
 *   3. 修改
 *   4. 栅格化
 */

/* -------------------------------------------------------------------------- */
/* 1. 导入                                                                     */
/* -------------------------------------------------------------------------- */

import { ZerOS as AlignRoot } from "../Enum/Align";
import { ZerOS as ConfigRoot } from "../Config/GpuConfig";
import { ZerOS as GlyphRoot } from "./Glyph";
import { ZerOS as KindRoot } from "../Enum/NodeKind";
import { ZerOS as PixelRoot } from "./Pixel";

export namespace ZerOS {
  export namespace Hardware {
    export namespace Gpu {
      const AlignStart = AlignRoot.Hardware.Gpu.AlignStart;
      const AlignCenter = AlignRoot.Hardware.Gpu.AlignCenter;
      const AlignEnd = AlignRoot.Hardware.Gpu.AlignEnd;
      const NodeKindBox = KindRoot.Hardware.Gpu.NodeKindBox;
      const NodeKindText = KindRoot.Hardware.Gpu.NodeKindText;
      const NodeMaxCount = ConfigRoot.Hardware.Gpu.Config.NodeMaxCount;
      const GlyphRunMaxCount = ConfigRoot.Hardware.Gpu.Config.GlyphRunMaxCount;
      const NodeSpanMax = ConfigRoot.Hardware.Gpu.Config.NodeSpanMax;
      const GlyphWidth = GlyphRoot.Hardware.Gpu.GlyphWidth;
      const GlyphHeight = GlyphRoot.Hardware.Gpu.GlyphHeight;
      const glyphRow = GlyphRoot.Hardware.Gpu.glyphRow;
      const isPixel = PixelRoot.Hardware.Gpu.isPixel;
      const treePrefix = "[ZerOS.Hardware.Gpu.SceneTree]";

      interface SceneNode {
        readonly Kind: number;
        Parent: number;
        X: number;
        Y: number;
        Width: number;
        Height: number;
        Fill: number;
        Filled: boolean;
        AlignX: number;
        AlignY: number;
        Foreground: number;
        Background: number;
        Glyphs: number[];
        Children: number[];
      }

      interface Clip {
        readonly X: number;
        readonly Y: number;
        readonly Width: number;
        readonly Height: number;
      }

      let frameWidth = 0;
      let frameHeight = 0;
      let nextId = 1;
      const nodes = new Map<number, SceneNode>();

      function fail(message: string): never {
        throw new Error(`${treePrefix} ${message}`);
      }

      function isAlign(value: number): boolean {
        return value === AlignStart || value === AlignCenter || value === AlignEnd;
      }

      function isSpan(value: number): boolean {
        return Number.isInteger(value) && value >= -NodeSpanMax && value <= NodeSpanMax;
      }

      function isExtent(value: number): boolean {
        return Number.isInteger(value) && value >= 0 && value <= NodeSpanMax;
      }

      /**
       * 帧建立时换一棵只含根的树。
       * 根铺满帧，自己不填色。先前的节点全部作废。
       */
      export function resetScene(width: number, height: number): void {
        frameWidth = width;
        frameHeight = height;
        nextId = 1;
        nodes.clear();
        nodes.set(0, {
          Kind: NodeKindBox,
          Parent: 0,
          X: 0,
          Y: 0,
          Width: width,
          Height: height,
          Fill: 0,
          Filled: false,
          AlignX: AlignStart,
          AlignY: AlignStart,
          Foreground: 0,
          Background: 0,
          Glyphs: [],
          Children: [],
        });
      }

      function requireBoxParent(parent: number): SceneNode {
        const node = nodes.get(parent);
        if (node?.Kind !== NodeKindBox) {
          fail("父节点不是盒子");
        }
        return node;
      }

      function reserveId(): number {
        if (nodes.size >= NodeMaxCount || nextId > 2147483647) {
          fail("节点个数已经到达 4096");
        }
        const id = nextId;
        nextId += 1;
        return id;
      }

      /**
       * 在盒子下追加一个填色矩形，并返回新编号。
       * 父节点、边长或像素不合法时树保持原样。
       */
      export function spawnBox(
        parent: number,
        x: number,
        y: number,
        width: number,
        height: number,
        fill: number,
      ): number {
        const owner = requireBoxParent(parent);
        if (!isSpan(x) || !isSpan(y) || !isExtent(width) || !isExtent(height) || !isPixel(fill)) {
          fail("盒子的几何或填色不合法");
        }
        const id = reserveId();
        nodes.set(id, {
          Kind: NodeKindBox,
          Parent: parent,
          X: x,
          Y: y,
          Width: width,
          Height: height,
          Fill: fill,
          Filled: true,
          AlignX: AlignStart,
          AlignY: AlignStart,
          Foreground: 0,
          Background: fill,
          Glyphs: [],
          Children: [],
        });
        owner.Children.push(id);
        return id;
      }

      /**
       * 在盒子下追加一个空文本，并返回新编号。
       * 对齐先靠左上，颜色先是 0。树在参数不合法时不变。
       */
      export function spawnText(
        parent: number,
        x: number,
        y: number,
        width: number,
        height: number,
      ): number {
        const owner = requireBoxParent(parent);
        if (!isSpan(x) || !isSpan(y) || !isExtent(width) || !isExtent(height)) {
          fail("文本的几何不合法");
        }
        const id = reserveId();
        nodes.set(id, {
          Kind: NodeKindText,
          Parent: parent,
          X: x,
          Y: y,
          Width: width,
          Height: height,
          Fill: 0,
          Filled: false,
          AlignX: AlignStart,
          AlignY: AlignStart,
          Foreground: 0,
          Background: 0,
          Glyphs: [],
          Children: [],
        });
        owner.Children.push(id);
        return id;
      }

      /** 只改文本的对齐。盒子没有对齐。失败时不改这个节点。 */
      export function alignNode(nodeId: number, alignX: number, alignY: number): void {
        const node = nodes.get(nodeId);
        if (node?.Kind !== NodeKindText) {
          fail("对齐只作用于文本");
        }
        if (!isAlign(alignX) || !isAlign(alignY)) {
          fail("对齐不在 0、1、2");
        }
        node.AlignX = alignX;
        node.AlignY = alignY;
      }

      /**
       * 写入两个像素。
       * 文本同时改前景和背景。盒子把背景当作填色，前景只做合法性检查。
       */
      export function paintNode(nodeId: number, foreground: number, background: number): void {
        const node = nodes.get(nodeId);
        if (node === undefined || nodeId === 0) {
          fail("不能给根涂色");
        }
        if (!isPixel(foreground) || !isPixel(background)) {
          fail("涂色不是像素整数");
        }
        if (node.Kind === NodeKindBox) {
          node.Fill = background;
          node.Filled = true;
          node.Background = background;
          return;
        }
        node.Foreground = foreground;
        node.Background = background;
      }

      /** 往文本末尾追加一个字形。编码非法或已经满员时不追加。 */
      export function glyphNode(nodeId: number, code: number): void {
        const node = nodes.get(nodeId);
        if (node?.Kind !== NodeKindText) {
          fail("字形只追加到文本");
        }
        if (glyphRow(code, 0) === null) {
          fail("字形编码不在 0x20 到 0x7E");
        }
        if (node.Glyphs.length >= GlyphRunMaxCount) {
          fail("文本的字形已经到达 1024");
        }
        node.Glyphs.push(code);
      }

      /**
       * 摘掉一个节点及其全部后代。
       * 根不能摘。编号不存在时失败，且不改其余节点。编号不回收。
       */
      export function dropNode(nodeId: number): void {
        const node = nodes.get(nodeId);
        if (node === undefined || nodeId === 0) {
          fail("不能摘掉根或不存在的节点");
        }
        const parent = nodes.get(node.Parent);
        if (parent === undefined) {
          fail("父节点已经不在");
        }
        const doomed: number[] = [];
        const pending = [nodeId];
        while (pending.length > 0) {
          const current = pending.pop();
          if (current === undefined) {
            break;
          }
          doomed.push(current);
          const item = nodes.get(current);
          if (item !== undefined) {
            for (const child of item.Children) {
              pending.push(child);
            }
          }
        }
        parent.Children = parent.Children.filter((child): boolean => child !== nodeId);
        for (const id of doomed) {
          nodes.delete(id);
        }
      }

      function intersect(clip: Clip, x: number, y: number, width: number, height: number): Clip | null {
        const left = Math.max(clip.X, x);
        const top = Math.max(clip.Y, y);
        const right = Math.min(clip.X + clip.Width, x + width);
        const bottom = Math.min(clip.Y + clip.Height, y + height);
        if (right <= left || bottom <= top) {
          return null;
        }
        return { X: left, Y: top, Width: right - left, Height: bottom - top };
      }

      function placeAlign(start: number, room: number, used: number, align: number): number {
        if (align === AlignCenter) {
          return start + Math.trunc((room - used) / 2);
        }
        if (align === AlignEnd) {
          return start + room - used;
        }
        return start;
      }

      function stamp(
        buffer: Uint32Array,
        width: number,
        clip: Clip,
        x: number,
        y: number,
        pixel: number,
      ): void {
        if (x < clip.X || y < clip.Y || x >= clip.X + clip.Width || y >= clip.Y + clip.Height) {
          return;
        }
        if (x < 0 || y < 0 || x >= frameWidth || y >= frameHeight) {
          return;
        }
        buffer[y * width + x] = pixel;
      }

      function paintText(buffer: Uint32Array, width: number, node: SceneNode, absX: number, absY: number, clip: Clip): void {
        const lines: number[][] = [];
        let line: number[] = [];
        const capacity = Math.trunc(node.Width / GlyphWidth);
        for (const code of node.Glyphs) {
          if (capacity < 1) {
            break;
          }
          if (line.length >= capacity) {
            lines.push(line);
            line = [];
          }
          line.push(code);
        }
        if (line.length > 0) {
          lines.push(line);
        }
        const blockHeight = lines.length * GlyphHeight;
        const originY = placeAlign(absY, node.Height, blockHeight, node.AlignY);
        for (let row = 0; row < lines.length; row += 1) {
          const glyphs = lines[row];
          if (glyphs === undefined) {
            continue;
          }
          const originX = placeAlign(absX, node.Width, glyphs.length * GlyphWidth, node.AlignX);
          const glyphY = originY + row * GlyphHeight;
          for (let index = 0; index < glyphs.length; index += 1) {
            const code = glyphs[index];
            if (code === undefined) {
              continue;
            }
            const glyphX = originX + index * GlyphWidth;
            for (let glyphRowIndex = 0; glyphRowIndex < GlyphHeight; glyphRowIndex += 1) {
              const bits = glyphRow(code, glyphRowIndex);
              if (bits === null) {
                fail("文本里出现了封闭表以外的字形");
              }
              for (let column = 0; column < GlyphWidth; column += 1) {
                const ink = (bits & (1 << (7 - column))) !== 0;
                stamp(
                  buffer,
                  width,
                  clip,
                  glyphX + column,
                  glyphY + glyphRowIndex,
                  ink ? node.Foreground : node.Background,
                );
              }
            }
          }
        }
      }

      function paintBox(
        buffer: Uint32Array,
        width: number,
        nodeId: number,
        originX: number,
        originY: number,
        clip: Clip,
      ): void {
        const node = nodes.get(nodeId);
        if (node === undefined) {
          return;
        }
        const absX = originX + node.X;
        const absY = originY + node.Y;
        const next = intersect(clip, absX, absY, node.Width, node.Height);
        if (next === null) {
          return;
        }
        if (node.Kind === NodeKindBox && node.Filled) {
          for (let y = next.Y; y < next.Y + next.Height; y += 1) {
            for (let x = next.X; x < next.X + next.Width; x += 1) {
              if (x >= 0 && y >= 0 && x < frameWidth && y < frameHeight) {
                buffer[y * width + x] = node.Fill;
              }
            }
          }
        }
        if (node.Kind === NodeKindText) {
          paintText(buffer, width, node, absX, absY, next);
          return;
        }
        for (const child of node.Children) {
          paintBox(buffer, width, child, absX, absY, next);
        }
      }

      /**
       * 把整棵树画进一块新缓冲。
       * 没被节点盖住的像素是 0。树本身不改。
       */
      export function rasterScene(): Uint32Array {
        const count = frameWidth * frameHeight;
        const buffer = new Uint32Array(count);
        const rootClip: Clip = { X: 0, Y: 0, Width: frameWidth, Height: frameHeight };
        const root = nodes.get(0);
        if (root === undefined) {
          fail("根节点不在");
        }
        for (const child of root.Children) {
          paintBox(buffer, frameWidth, child, 0, 0, rootClip);
        }
        return buffer;
      }
    }
  }
}
