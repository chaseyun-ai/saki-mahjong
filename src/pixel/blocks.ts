import { type Col, hex, mix, rgb, rng } from './core';

// 方块世界的贴图：每种都是 16×16（牌身 16×22）一格格画的小图，贴到 3D 方块上按最近邻放大，一格就是方块上一块颜色。
// 每张图只用 4～5 种颜色（同一个底色往暗、往亮各挪几级），颜色怎么分布按固定种子的随机数，每次画出来一样。
// 牌桌（3D）和界面（CSS 背景，pixel/dom.ts）用的是同一套图

export const BLOCK = 16;

// 同一个底色的几级：0 最暗，n-1 最亮，正中那级是底色
function shades(base: string, n: number, spread: number): Col[] {
  const c = hex(base);
  const out: Col[] = [];
  const mid = (n - 1) / 2;
  for (let i = 0; i < n; i++) {
    const t = (i - mid) / mid;
    out.push(t < 0 ? mix(c, rgb(0, 0, 0), -t * spread) : mix(c, rgb(255, 255, 255), t * spread * 0.8));
  }
  return out;
}

// 从几级里按权重挑一级（权重偏中间：底色最多，两头少）
function pick(r: () => number, weights: number[]): number {
  let v = r() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) {
    v -= weights[i];
    if (v < 0) return i;
  }
  return weights.length - 1;
}

// 木板：横着四块板，每块 4 格高，板和板之间一道暗缝（每块板最下面一行），每块板上有一处接头（竖着一格暗线）；
// 板上一段段的木纹（横着 2～4 格的暗一级）。四块板深浅各差一点
export function plankTexture(base: string, seed = 11): Uint32Array {
  const pal = shades(base, 5, 0.34);
  const r = rng(seed);
  const px = new Uint32Array(BLOCK * BLOCK);
  for (let b = 0; b < 4; b++) {
    const tone = b % 2 === 0 ? 0 : r() < 0.5 ? -1 : 1;
    const joint = 2 + Math.floor(r() * 12);
    for (let y = b * 4; y < b * 4 + 4; y++) {
      for (let x = 0; x < BLOCK; x++) {
        let k = 2 + tone + (r() < 0.12 ? -1 : r() < 0.08 ? 1 : 0);
        if (y === b * 4 + 3) k = 0;
        else if (x === joint) k = 1;
        else if (y === b * 4) k = Math.max(k, 2 + tone);
        px[y * BLOCK + x] = pal[Math.max(0, Math.min(4, k))];
      }
      // 木纹：一段暗一级的横线
      if (y % 4 === 1 || y % 4 === 2) {
        if (r() < 0.7) {
          const x0 = Math.floor(r() * BLOCK);
          const len = 2 + Math.floor(r() * 3);
          for (let i = 0; i < len; i++) {
            const x = (x0 + i) % BLOCK;
            if (x !== joint) px[y * BLOCK + x] = pal[Math.max(0, 1 + tone)];
          }
        }
      }
    }
  }
  return px;
}

// 桌布（羊毛毡）：底色上一格格深浅不一，斜着一道道织纹（每隔几格暗一级），四边各一格稍暗，一块块拼起来看得出缝
export function feltTexture16(base: string, seed = 23): Uint32Array {
  const pal = shades(base, 5, 0.22);
  const r = rng(seed);
  const px = new Uint32Array(BLOCK * BLOCK);
  for (let y = 0; y < BLOCK; y++)
    for (let x = 0; x < BLOCK; x++) {
      let k = 1 + pick(r, [2, 6, 2]);
      if ((x + y * 3) % 7 === 0) k -= 1;
      if (x === BLOCK - 1 || y === BLOCK - 1) k = Math.min(k, 1);
      px[y * BLOCK + x] = pal[Math.max(0, Math.min(4, k))];
    }
  return px;
}

// 石头：先在 4×4 的粗格上定深浅，再一格格加点噪声，挑 4 级；零星几道暗缝。spread 是最暗、最亮离底色多远
// （3D 牌桌上的石头 0.4；界面里铺在字底下的要淡得多，不然字看不清）
export function stoneTexture(base: string, seed = 37, spread = 0.4): Uint32Array {
  const pal = shades(base, 5, spread);
  const r = rng(seed);
  const coarse: number[] = [];
  for (let i = 0; i < 16; i++) coarse.push(r());
  const px = new Uint32Array(BLOCK * BLOCK);
  for (let y = 0; y < BLOCK; y++)
    for (let x = 0; x < BLOCK; x++) {
      // 粗格之间双线性一下，石头上是一团团的，不是一格格方块
      const fx = (x / BLOCK) * 4 - 0.5;
      const fy = (y / BLOCK) * 4 - 0.5;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const g = (i: number, j: number) => coarse[((j + 4) % 4) * 4 + ((i + 4) % 4)];
      const v = g(x0, y0) * (1 - tx) * (1 - ty) + g(x0 + 1, y0) * tx * (1 - ty) + g(x0, y0 + 1) * (1 - tx) * ty + g(x0 + 1, y0 + 1) * tx * ty;
      const n = v * 0.7 + r() * 0.3;
      const k = n < 0.3 ? 1 : n < 0.5 ? 2 : n < 0.68 ? 3 : n < 0.8 ? 2 : 4;
      px[y * BLOCK + x] = pal[k];
    }
  // 暗缝：从一格开始斜着走几格
  for (let c = 0; c < 3; c++) {
    let x = Math.floor(r() * BLOCK);
    let y = Math.floor(r() * BLOCK);
    for (let i = 0; i < 3 + Math.floor(r() * 3); i++) {
      px[(y & 15) * BLOCK + (x & 15)] = pal[0];
      x += r() < 0.5 ? 1 : 0;
      y += 1;
    }
  }
  return px;
}

// 牌身、牌背的颗粒（乘在底色上）：几乎都是白，零星几格浅灰，牌面那一面再淡一点（tileLooks.ts 的 smoothFace）
export function grainTexture16(seed = 51): Uint32Array {
  const r = rng(seed);
  const pal = [rgb(255, 255, 255), rgb(242, 240, 236), rgb(228, 225, 218), rgb(212, 208, 200)];
  const px = new Uint32Array(BLOCK * BLOCK);
  for (let i = 0; i < px.length; i++) px[i] = pal[pick(r, [10, 5, 2, 0.6])];
  return px;
}

// 方块的颜色（3D 牌桌和界面共用）
export const BLOCK_COLORS = {
  plank: '#a8743f',
  plankDark: '#6e4a2a',
  felt: '#3f8f4a',
  stone: '#8c8a86',
  stoneDark: '#4d4b49',
  sky: '#8fbfee',
};

// 牌背正中的菱形宝石（tileLooks.ts 的 mark 'pixel'）：和牌身颗粒一样 16 格宽（牌高 22 格），一格对一格。
// 红色通道是亮还是暗（0 压暗、1 提亮），透明度是压多深。一颗切面宝石：左上的面亮、右下的面暗，外面一圈暗边，
// 正中偏左上一格高光；四周离边一格一圈细细的暗框
export const MARK_W = 16;
export const MARK_H = 22;

export function pixelBackMark(): Uint8ClampedArray {
  const out = new Uint8ClampedArray(MARK_W * MARK_H * 4);
  const put = (x: number, y: number, light: number, a: number) => {
    if (x < 0 || y < 0 || x >= MARK_W || y >= MARK_H) return;
    const i = (y * MARK_W + x) * 4;
    out[i] = light;
    out[i + 1] = 0;
    out[i + 2] = 0;
    out[i + 3] = a;
  };
  const cx = MARK_W / 2 - 0.5;
  const cy = MARK_H / 2 - 0.5;
  const rx = 5;
  const ry = 7;
  for (let y = 0; y < MARK_H; y++)
    for (let x = 0; x < MARK_W; x++) {
      const u = (x - cx) / rx;
      const v = (y - cy) / ry;
      const d = Math.abs(u) + Math.abs(v);
      if (d <= 1.05) {
        const lit = u + v < 0;
        if (d > 0.78) put(x, y, 0, 230);
        else put(x, y, lit ? 255 : 0, lit ? 150 : 70);
      }
      if (((x === 1 || x === MARK_W - 2) && y >= 1 && y <= MARK_H - 2) || ((y === 1 || y === MARK_H - 2) && x >= 1 && x <= MARK_W - 2)) put(x, y, 0, 110);
    }
  put(Math.round(cx - 2), Math.round(cy - 2), 255, 255);
  put(Math.round(cx - 1), Math.round(cy - 3), 255, 220);
  return out;
}

// 像素数组（Uint32 按 ImageData 的字节顺序，或者直接是 RGBA 字节）画到一张 canvas 上
export function pixelCanvas(px: Uint32Array | Uint8ClampedArray, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const bytes = new Uint8ClampedArray(w * h * 4);
  bytes.set(px instanceof Uint32Array ? new Uint8Array(px.buffer, px.byteOffset, px.byteLength) : px);
  c.getContext('2d')!.putImageData(new ImageData(bytes, w, h), 0, 0);
  return c;
}
