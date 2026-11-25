// 像素特效的画布：一张低分辨率的帧，两层——color 放实打实的像素（半透明用 4×4 有序抖动打散，从不混色），
// light 放叠加的光，合成时加在 color 上面。画法参考 patch-gg/pixelfx（MIT，见 THIRD_PARTY_NOTICES.md）：
// 颜色从暗到亮排成一条色阶，挑一格用、不在两格之间渐变；随机数都有种子，同一个特效每次放出来一样。
// 代码是照这个思路重写的，没有整段照搬。

// 颜色是 32 位整数，按 ImageData 的字节顺序排（内存里 R、G、B、A），一帧的 color 能直接当像素用
export type Col = number;

export const rgb = (r: number, g: number, b: number): Col => ((255 << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)) >>> 0;
export const red = (c: Col): number => c & 255;
export const green = (c: Col): number => (c >>> 8) & 255;
export const blue = (c: Col): number => (c >>> 16) & 255;
export const clamp = (v: number, a = 0, b = 1): number => (v < a ? a : v > b ? b : v);

const hexCache = new Map<string, Col>();
// '#rgb'、'#rrggbb' 转成颜色（数字原样返回）
export function hex(h: string | Col): Col {
  if (typeof h === 'number') return h;
  let c = hexCache.get(h);
  if (c !== undefined) return c;
  let s = h.replace('#', '');
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const v = parseInt(s.slice(0, 6), 16);
  c = rgb((v >> 16) & 255, (v >> 8) & 255, v & 255);
  hexCache.set(h, c);
  return c;
}

export const toHex = (c: Col): string => `#${[red(c), green(c), blue(c)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

export function mix(a: Col, b: Col, t: number): Col {
  t = clamp(t);
  return rgb(red(a) + (red(b) - red(a)) * t, green(a) + (green(b) - green(a)) * t, blue(a) + (blue(b) - blue(a)) * t);
}

export const ramp = (list: string[]): Col[] => list.map(hex);
// 色阶上 t（0 暗到 1 亮）那一格：像素画挑一个颜色，不在两格之间渐变
export const at = (r: Col[], t: number): Col => r[clamp(Math.floor(t * r.length), 0, r.length - 1)];

// 拿一个颜色（角色色）现做一条色阶：暗处偏冷偏深，亮处偏暖、最后到白
export function rampOf(base: string, steps = 7): Col[] {
  const c = hex(base);
  const deep = rgb(red(c) * 0.18 + 8, green(c) * 0.14 + 6, blue(c) * 0.22 + 20);
  const out: Col[] = [];
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    if (t < 0.55) out.push(mix(deep, c, t / 0.55));
    else out.push(mix(c, rgb(255, 250, 236), (t - 0.55) / 0.45));
  }
  return out;
}

// 4×4 有序抖动的门槛：透明度 a 高过这一格的门槛才画
export const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
export const bayerAt = (x: number, y: number): number => BAYER[((y & 3) << 2) | (x & 3)];

// 有种子的随机数（mulberry32）
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Frame {
  color: Uint32Array;
  light: Uint32Array;
  constructor(
    public w: number,
    public h: number,
  ) {
    this.color = new Uint32Array(w * h);
    this.light = new Uint32Array(w * h);
  }
  clear(): void {
    this.color.fill(0);
    this.light.fill(0);
  }
}

type Shade<A extends unknown[]> = Col | ((...args: A) => Col);
type Alpha<A extends unknown[]> = number | ((...args: A) => number);
const call = <A extends unknown[], R>(v: R | ((...a: A) => R), ...a: A): R => (typeof v === 'function' ? (v as (...a: A) => R)(...a) : v);

// 往一帧上画：坐标就是帧上的像素（左上角 0,0），画之前可以 place 挪原点；fade 整体淡出（照样用抖动打散）
export class Painter {
  ox = 0;
  oy = 0;
  fade = 1;
  lightK = 1;
  constructor(public frame: Frame) {}

  place(x: number, y: number): this {
    this.ox = x;
    this.oy = y;
    return this;
  }

  // 帧上的一个像素：a < 1 时按抖动决定画不画。颜色 0 是“什么都不画”
  put(sx: number, sy: number, c: Col, a = 1): void {
    if (!c) return;
    a *= this.fade;
    if (a <= 0) return;
    sx |= 0;
    sy |= 0;
    if (a < 1 && a <= bayerAt(sx, sy)) return;
    const f = this.frame;
    if (sx < 0 || sy < 0 || sx >= f.w || sy >= f.h) return;
    f.color[sy * f.w + sx] = c;
  }

  // 往光那层加：k 是多亮（0–1）
  add(sx: number, sy: number, c: Col, k = 1): void {
    k *= this.fade * this.lightK;
    if (k <= 0.004) return;
    sx |= 0;
    sy |= 0;
    const f = this.frame;
    if (sx < 0 || sy < 0 || sx >= f.w || sy >= f.h) return;
    const i = sy * f.w + sx;
    const d = f.light[i];
    const r = Math.min(255, (d & 255) + red(c) * k) | 0;
    const g = Math.min(255, ((d >>> 8) & 255) + green(c) * k) | 0;
    const b = Math.min(255, ((d >>> 16) & 255) + blue(c) * k) | 0;
    f.light[i] = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }

  // 下面的坐标都相对原点（place）
  dot(x: number, y: number, c: Col, a = 1): void {
    this.put(Math.floor(this.ox + x), Math.floor(this.oy + y), c, a);
  }

  light(x: number, y: number, c: Col, k = 1): void {
    this.add(Math.floor(this.ox + x), Math.floor(this.oy + y), c, k);
  }

  rect(x: number, y: number, w: number, h: number, c: Col, a = 1): void {
    const x0 = Math.round(this.ox + x);
    const y0 = Math.round(this.oy + y);
    const x1 = Math.round(this.ox + x + w);
    const y1 = Math.round(this.oy + y + h);
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.put(xx, yy, c, a);
  }

  // 一像素宽的直线（Bresenham）。c、a 可以是沿线 u（0 起点到 1 终点）的函数
  line(x0: number, y0: number, x1: number, y1: number, c: Shade<[number]>, a: Alpha<[number]> = 1): void {
    let sx = Math.floor(this.ox + x0);
    let sy = Math.floor(this.oy + y0);
    const ex = Math.floor(this.ox + x1);
    const ey = Math.floor(this.oy + y1);
    const dx = Math.abs(ex - sx);
    const dy = -Math.abs(ey - sy);
    const stx = sx < ex ? 1 : -1;
    const sty = sy < ey ? 1 : -1;
    const n = Math.max(dx, -dy) || 1;
    let err = dx + dy;
    for (let i = 0; ; i++) {
      const u = i / n;
      this.put(sx, sy, call(c, u), call(a, u));
      if (sx === ex && sy === ey) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        sx += stx;
      }
      if (e2 <= dx) {
        err += dx;
        sy += sty;
      }
    }
  }

  // 椭圆（ry 默认等于 rx 就是圆）：c、a 是 d（0 圆心到 1 边）和角度的函数
  ellipse(cx: number, cy: number, rx: number, ry: number, c: Shade<[number, number]>, a: Alpha<[number, number]> = 1): void {
    if (rx <= 0 || ry <= 0) return;
    const X = this.ox + cx;
    const Y = this.oy + cy;
    if (rx < 0.6 && ry < 0.6) {
      this.put(Math.floor(X), Math.floor(Y), call(c, 0, 0), call(a, 0, 0));
      return;
    }
    for (let sy = Math.floor(Y - ry); sy <= Math.ceil(Y + ry); sy++) {
      const dy = (sy + 0.5 - Y) / ry;
      for (let sx = Math.floor(X - rx); sx <= Math.ceil(X + rx); sx++) {
        const dx = (sx + 0.5 - X) / rx;
        const d2 = dx * dx + dy * dy;
        if (d2 > 1) continue;
        const d = Math.sqrt(d2);
        const ang = Math.atan2(dy, dx);
        this.put(sx, sy, call(c, d, ang), call(a, d, ang));
      }
    }
  }

  circle(cx: number, cy: number, r: number, c: Shade<[number, number]>, a: Alpha<[number, number]> = 1): void {
    this.ellipse(cx, cy, r, r, c, a);
  }

  // 一圈环：半径 r，往里 w 宽（ry/rx 压扁成椭圆，画桌面上的冲击波）。c、a 是 v（0 内沿到 1 外沿）和角度的函数
  ring(cx: number, cy: number, r: number, w: number, c: Shade<[number, number]>, a: Alpha<[number, number]> = 1, squash = 1): void {
    if (r <= 0) return;
    const X = this.ox + cx;
    const Y = this.oy + cy;
    const r0 = Math.max(0, r - w);
    const ry = r * squash;
    for (let sy = Math.floor(Y - ry - 1); sy <= Math.ceil(Y + ry + 1); sy++) {
      const dy = (sy + 0.5 - Y) / squash;
      for (let sx = Math.floor(X - r - 1); sx <= Math.ceil(X + r + 1); sx++) {
        const dx = sx + 0.5 - X;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > r || d < r0) continue;
        const v = (d - r0) / (r - r0 || 1);
        const ang = Math.atan2(dy, dx);
        this.put(sx, sy, call(c, v, ang), call(a, v, ang));
      }
    }
  }

  // 填满的多边形（奇偶规则）
  poly(pts: [number, number][], c: Col, a = 1): void {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of pts) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    const n = pts.length;
    for (let sy = Math.floor(this.oy + y0); sy <= Math.ceil(this.oy + y1); sy++) {
      const py = sy + 0.5 - this.oy;
      for (let sx = Math.floor(this.ox + x0); sx <= Math.ceil(this.ox + x1); sx++) {
        const px = sx + 0.5 - this.ox;
        let inside = false;
        for (let i = 0, j = n - 1; i < n; j = i++) {
          const [xi, yi] = pts[i];
          const [xj, yj] = pts[j];
          if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
        }
        if (inside) this.put(sx, sy, c, a);
      }
    }
  }

  // 圆形的一团光：中心 k，到半径 r 落到 0（ry 压扁）
  glow(x: number, y: number, r: number, c: Col, k = 0.5, squash = 1): void {
    if (r < 1 || k <= 0.004) return;
    const X = this.ox + x;
    const Y = this.oy + y;
    const ry = r * squash;
    for (let sy = Math.floor(Y - ry); sy <= Math.ceil(Y + ry); sy++) {
      const dy = (sy + 0.5 - Y) / ry;
      for (let sx = Math.floor(X - r); sx <= Math.ceil(X + r); sx++) {
        const dx = (sx + 0.5 - X) / r;
        const d = dx * dx + dy * dy;
        if (d >= 1) continue;
        const f = 1 - Math.sqrt(d);
        this.add(sx, sy, c, f * f * k);
      }
    }
  }

  // 一圈光（冲击波的光）：贴着半径 R，往两边 r 宽落到 0
  glowRing(x: number, y: number, R: number, r: number, c: Col, k = 0.5, squash = 1): void {
    if (r < 1 || k <= 0.004) return;
    const X = this.ox + x;
    const Y = this.oy + y;
    const E = R + r;
    for (let sy = Math.floor(Y - E * squash); sy <= Math.ceil(Y + E * squash); sy++) {
      const dy = (sy + 0.5 - Y) / squash;
      for (let sx = Math.floor(X - E); sx <= Math.ceil(X + E); sx++) {
        const d = Math.abs(Math.hypot(sx + 0.5 - X, dy) - R) / r;
        if (d >= 1) continue;
        const f = 1 - d;
        this.add(sx, sy, c, f * f * k);
      }
    }
  }

  // 沿一条线段的光
  glowLine(x0: number, y0: number, x1: number, y1: number, r: number, c: Col, k = 0.5): void {
    if (r < 1 || k <= 0.004) return;
    const ax = this.ox + x0;
    const ay = this.oy + y0;
    const bx = this.ox + x1;
    const by = this.oy + y1;
    const dx = bx - ax;
    const dy = by - ay;
    const L2 = dx * dx + dy * dy || 1e-9;
    for (let sy = Math.floor(Math.min(ay, by) - r); sy <= Math.ceil(Math.max(ay, by) + r); sy++)
      for (let sx = Math.floor(Math.min(ax, bx) - r); sx <= Math.ceil(Math.max(ax, bx) + r); sx++) {
        const px = sx + 0.5;
        const py = sy + 0.5;
        const u = clamp(((px - ax) * dx + (py - ay) * dy) / L2);
        const d = Math.hypot(ax + dx * u - px, ay + dy * u - py) / r;
        if (d >= 1) continue;
        const f = 1 - d;
        this.add(sx, sy, c, f * f * k);
      }
  }

  // 用字符串画的小图：rows 每行一个字符串，pal 把字符对到颜色，'.' 和空格不画；左上角放在 (x, y)，scale 是放大几倍
  sprite(rows: string[], pal: Record<string, Col | string>, x: number, y: number, o: { scale?: number; a?: number; flip?: boolean; tint?: Col } = {}): void {
    const k = o.scale ?? 1;
    const a = o.a ?? 1;
    const W = rows[0]?.length ?? 0;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let q = 0; q < row.length; q++) {
        const ch = row[q];
        if (ch === '.' || ch === ' ') continue;
        const c = o.tint ?? (pal[ch] === undefined ? 0 : hex(pal[ch]));
        if (!c) continue;
        const col = o.flip ? W - 1 - q : q;
        if (k === 1) this.dot(x + col, y + r, c, a);
        else this.rect(x + col * k, y + r * k, k, k, c, a);
      }
    }
  }
}

// 两层合成到 RGBA 字节上（背景透明）：光的地方按最亮的那个通道当透明度，叠在暗的底上看着就是加亮
export function composite(f: Frame, out: Uint8ClampedArray): void {
  const n = f.w * f.h;
  const C = f.color;
  const L = f.light;
  for (let i = 0; i < n; i++) {
    const c = C[i];
    const l = L[i] & 0xffffff;
    let r = c & 255;
    let g = (c >>> 8) & 255;
    let b = (c >>> 16) & 255;
    let a = c >>> 24;
    if (l) {
      const lr = l & 255;
      const lg = (l >>> 8) & 255;
      const lb = (l >>> 16) & 255;
      if (a < 255) {
        const pa = a / 255;
        const na = Math.min(1, Math.max(pa, Math.max(lr, lg, lb) / 255));
        if (na > 0) {
          r = Math.min(255, (r * pa + lr) / na);
          g = Math.min(255, (g * pa + lg) / na);
          b = Math.min(255, (b * pa + lb) / na);
          a = na * 255;
        }
      } else {
        r = Math.min(255, r + lr);
        g = Math.min(255, g + lg);
        b = Math.min(255, b + lb);
      }
    }
    const j = i * 4;
    out[j] = r;
    out[j + 1] = g;
    out[j + 2] = b;
    out[j + 3] = a;
  }
}
