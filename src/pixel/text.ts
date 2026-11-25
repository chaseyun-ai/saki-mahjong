import { type Col, type Painter, at } from './core';

// 像素字：用像素字体（Saki Pixel 12）按 12px 写进一张小画布，透明度过一道门槛变成一格格的点阵（不留半透明的毛边），
// 再在帧上放大 k 倍画：外面一圈深色描边、往右下一格影子，字身从上到下按色阶分几段（像素游戏标题字的画法）

export const PIXEL_FAMILY = "'Saki Pixel 12','Noto Sans SC',sans-serif";

export interface Mask {
  w: number;
  h: number;
  on: Uint8Array;
}

const cache = new Map<string, Mask>();

// 一行字的点阵（12px 一格）。字体还没下载好就先用后备字体，下好以后新的字会重新量
export function textMask(text: string): Mask {
  // 没有页面（测试里）：没有字
  if (typeof document === 'undefined') return { w: 1, h: 1, on: new Uint8Array(1) };
  const ready = document.fonts?.check?.(`12px ${PIXEL_FAMILY}`);
  const key = `${ready ? 1 : 0}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  ctx.font = `12px ${PIXEL_FAMILY}`;
  const w = Math.max(1, Math.ceil(ctx.measureText(text).width) + 2);
  const h = 14;
  c.width = w;
  c.height = h;
  ctx.font = `12px ${PIXEL_FAMILY}`;
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#fff';
  ctx.fillText(text, 1, 1);
  const data = ctx.getImageData(0, 0, w, h).data;
  const on = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) on[i] = data[i * 4 + 3] > 110 ? 1 : 0;
  // 裁掉四周空着的行列
  let x0 = w;
  let x1 = -1;
  let y0 = h;
  let y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (on[y * w + x]) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
  let m: Mask;
  if (x1 < 0) m = { w: 1, h: 1, on: new Uint8Array(1) };
  else {
    const mw = x1 - x0 + 1;
    const mh = y1 - y0 + 1;
    const out = new Uint8Array(mw * mh);
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) out[y * mw + x] = on[(y + y0) * w + x + x0];
    m = { w: mw, h: mh, on: out };
  }
  cache.set(key, m);
  return m;
}

export interface TextStyle {
  // 放大几倍（整数）
  k: number;
  // 字身的色阶（从上到下：亮到暗，按行分段）
  fill: Col[];
  // 描边、影子的颜色
  edge: Col;
  shadow?: Col;
  a?: number;
}

// 把一行字画到帧上：(x, y) 是字的中心
export function drawText(p: Painter, text: string, x: number, y: number, s: TextStyle): { w: number; h: number } {
  const m = textMask(text);
  const k = s.k;
  const W = m.w * k;
  const H = m.h * k;
  const left = Math.round(x - W / 2);
  const top = Math.round(y - H / 2);
  const a = s.a ?? 1;
  const on = (cx: number, cy: number) => cx >= 0 && cy >= 0 && cx < m.w && cy < m.h && m.on[cy * m.w + cx] === 1;
  // 影子（往右下 k 格），描边（字身四周一格，按放大后的格子算，粗细是 1 格不是 k 格）
  if (s.shadow) {
    for (let cy = 0; cy < m.h; cy++) for (let cx = 0; cx < m.w; cx++) if (on(cx, cy)) p.rect(left + cx * k + k, top + cy * k + k + 1, k, k, s.shadow, a);
  }
  for (let cy = 0; cy < m.h; cy++)
    for (let cx = 0; cx < m.w; cx++) {
      if (!on(cx, cy)) continue;
      p.rect(left + cx * k - 1, top + cy * k - 1, k + 2, k + 2, s.edge, a);
    }
  for (let cy = 0; cy < m.h; cy++) {
    const c = at(s.fill, cy / m.h);
    for (let cx = 0; cx < m.w; cx++) if (on(cx, cy)) p.rect(left + cx * k, top + cy * k, k, k, c, a);
  }
  return { w: W, h: H };
}
