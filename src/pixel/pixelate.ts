import { BAYER } from './core';

// 把一张图（主页部室的图）变成像素画：先缩小到每 block 个原图像素一格，再挑出 colors 种颜色（中位切分），
// 每一格换成最接近的那种颜色，两种颜色之间用 4×4 网点抖一点（dither 是抖多少，0 不抖）。
// 饱和度提一点、暗部压一点：像素画的颜色比照片浓

export interface PixelateOpts {
  block: number;
  colors: number;
  dither: number;
  // 饱和度乘多少
  sat?: number;
}

type RGB = [number, number, number];

// 中位切分：每次把颜色范围最宽的那一箱从中间切开，切到 n 箱，每箱取平均
export function medianCut(px: Uint8ClampedArray, n: number): RGB[] {
  const all: number[] = [];
  for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 0) all.push(i);
  let boxes: number[][] = [all];
  const range = (b: number[]): [number, number] => {
    let best = 0;
    let ch = 0;
    for (let c = 0; c < 3; c++) {
      let lo = 255;
      let hi = 0;
      for (const i of b) {
        const v = px[i + c];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (hi - lo > best) {
        best = hi - lo;
        ch = c;
      }
    }
    return [best, ch];
  };
  while (boxes.length < n) {
    let pick = -1;
    let wide = 0;
    let chan = 0;
    boxes.forEach((b, k) => {
      if (b.length < 2) return;
      const [r, c] = range(b);
      // 箱子越大、越宽越先切
      const score = r * Math.sqrt(b.length);
      if (score > wide) {
        wide = score;
        pick = k;
        chan = c;
      }
    });
    if (pick < 0) break;
    const b = boxes[pick].slice().sort((x, y) => px[x + chan] - px[y + chan]);
    const mid = b.length >> 1;
    boxes = [...boxes.slice(0, pick), b.slice(0, mid), b.slice(mid), ...boxes.slice(pick + 1)];
  }
  return boxes
    .filter((b) => b.length)
    .map((b) => {
      let r = 0;
      let g = 0;
      let bl = 0;
      for (const i of b) {
        r += px[i];
        g += px[i + 1];
        bl += px[i + 2];
      }
      return [r / b.length, g / b.length, bl / b.length].map(Math.round) as RGB;
    });
}

// 离 (r, g, b) 最近的两种颜色（按人眼的权重量距离），和它在两者之间的位置（0 是最近的那个）
function nearest2(pal: RGB[], r: number, g: number, b: number): [number, number, number] {
  let a = 0;
  let da = Infinity;
  let c = 0;
  let dc = Infinity;
  for (let k = 0; k < pal.length; k++) {
    const [pr, pg, pb] = pal[k];
    const d = (pr - r) * (pr - r) * 0.3 + (pg - g) * (pg - g) * 0.59 + (pb - b) * (pb - b) * 0.11;
    if (d < da) {
      c = a;
      dc = da;
      a = k;
      da = d;
    } else if (d < dc) {
      c = k;
      dc = d;
    }
  }
  const t = da + dc > 0 ? Math.sqrt(da) / (Math.sqrt(da) + Math.sqrt(dc)) : 0;
  return [a, c, t];
}

// 缩小好的像素（RGBA）就地换成调色板里的颜色
export function quantize(px: Uint8ClampedArray, w: number, o: PixelateOpts): void {
  const sat = o.sat ?? 1.15;
  for (let i = 0; i < px.length; i += 4) {
    const l = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
    for (let c = 0; c < 3; c++) px[i + c] = Math.max(0, Math.min(255, l + (px[i + c] - l) * sat));
  }
  const pal = medianCut(px, o.colors);
  if (!pal.length) return;
  for (let i = 0; i < px.length; i += 4) {
    const p = i >> 2;
    const x = p % w;
    const y = (p / w) | 0;
    const [a, b, t] = nearest2(pal, px[i], px[i + 1], px[i + 2]);
    // 离第二近的颜色够近（t 接近 0.5）的那些格子，按网点门槛换成第二近的
    const use = t * 2 * o.dither > BAYER[((y & 3) << 2) | (x & 3)] ? b : a;
    const [r, g, bl] = pal[use];
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = bl;
  }
}

// 一张图变成像素画，画在一张小画布上（宽高是原图的 1/block）
export function pixelateImage(img: CanvasImageSource, w: number, h: number, o: PixelateOpts): HTMLCanvasElement {
  const cw = Math.max(1, Math.round(w / o.block));
  const ch = Math.max(1, Math.round(h / o.block));
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, cw, ch);
  const data = ctx.getImageData(0, 0, cw, ch);
  quantize(data.data, cw, o);
  ctx.putImageData(data, 0, 0);
  return c;
}

// 主页的图：做好的像素画按网址缓存（换时间来回点不用重算）
const done = new Map<string, Promise<string>>();

export function pixelatedUrl(src: string, o: PixelateOpts): Promise<string> {
  const key = `${src}|${o.block}|${o.colors}|${o.dither}`;
  let hit = done.get(key);
  if (!hit) {
    hit = new Promise<string>((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        try {
          const c = pixelateImage(img, img.naturalWidth, img.naturalHeight, o);
          c.toBlob((b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error('toBlob'))), 'image/png');
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => reject(new Error(`load ${src}`));
      img.src = src;
    });
    hit.catch(() => done.delete(key));
    done.set(key, hit);
  }
  return hit;
}
