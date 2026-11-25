import { type Col, bayerAt, clamp, hex, mix, rgb, rng } from './core';

// 像素牌桌的桌布（3D、2.5D 贴在桌面上，不插值）：256 见方，一格就是一格。
// 中间亮、四边暗的明暗不是渐变，是从同一条色阶里挑颜色、两级之间用 4×4 网点抖动过去；
// 布面上一行行错开的小点是织纹，零星几格亮一点、暗一点；四周一圈两格宽的金线，四个角各一颗四角星。
// zones：改良布局时从仪表盘四角斜着画到桌角的四条线（a 是仪表盘角离中心多远，按 0–128 算）

export const FELT_SIZE = 256;

export interface FeltSpec {
  felt: [string, string, string];
  line: string;
  // 改良布局：仪表盘角离中心多远（0 是原版的一圈方框）
  zones?: number;
}

// 桌布的色阶：比中心再亮一级、中心、中间、边缘、比边缘再暗一级（暗的那头偏冷）
function feltRamp(f: [string, string, string]): Col[] {
  const [a, b, c] = f.map(hex);
  const top = mix(a, rgb(250, 240, 200), 0.18);
  const deep = mix(c, rgb(20, 16, 48), 0.45);
  return [deep, c, mix(b, c, 0.5), b, mix(a, b, 0.5), a, top];
}

export function pixelFelt(spec: FeltSpec): Uint32Array {
  const N = FELT_SIZE;
  const px = new Uint32Array(N * N);
  const R = feltRamp(spec.felt);
  const rnd = rng(0x5a4b1);
  const h = N / 2;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      // 离中心多远（方一点的圆：桌子是方的，四个角最暗）
      const dx = (x + 0.5 - h) / h;
      const dy = (y + 0.5 - h) / h;
      const d = Math.pow(Math.pow(Math.abs(dx), 3) + Math.pow(Math.abs(dy), 3), 1 / 3);
      const t = clamp(1 - d * 0.92, 0, 1);
      // 0..R.length-1 之间挑一级：一大片一大片平涂，只有两级交界那一窄条用网点抖过去
      const lv = t * (R.length - 1.6) + 0.3;
      const f = lv - Math.floor(lv);
      let i = Math.floor(lv) + (f > 0.35 + bayerAt(x, y) * 0.3 ? 1 : 0);
      // 织纹：隔几行一排错开的小点，暗一级
      if (y % 6 === 2 && (x + (y % 12 === 2 ? 0 : 3)) % 6 === 0) i -= 1;
      // 零星的亮点、暗点
      const r = rnd();
      if (r < 0.004) i += 1;
      else if (r < 0.008) i -= 1;
      px[y * N + x] = R[clamp(i, 0, R.length - 1)];
    }
  const line = hex(spec.line);
  const lineDark = mix(line, rgb(60, 30, 20), 0.55);
  const set = (x: number, y: number, c: Col) => {
    if (x >= 0 && y >= 0 && x < N && y < N) px[y * N + x] = c;
  };
  if (spec.zones) {
    // 改良布局：仪表盘四个角斜着到桌角，一格一格的斜线（两格宽，下面压一道暗的）
    const a = Math.round(spec.zones);
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      for (let k = a; k <= h; k++) {
        const x = Math.round(h + sx * k - (sx > 0 ? 1 : 0));
        const y = Math.round(h + sy * k - (sy > 0 ? 1 : 0));
        set(x, y, line);
        set(x + sx, y, line);
        set(x, y + 1, lineDark);
      }
    }
  } else {
    // 一圈两格宽的金线，里侧一格暗一点（像素画里的立体感：亮边在上左、暗边在下右）
    const m = 37;
    for (let k = m; k < N - m; k++) {
      set(k, m, line);
      set(k, m + 1, line);
      set(k, N - m - 1, line);
      set(k, N - m - 2, line);
      set(m, k, line);
      set(m + 1, k, line);
      set(N - m - 1, k, line);
      set(N - m - 2, k, line);
      set(k, m + 2, lineDark);
      set(m + 2, k, lineDark);
      set(k, N - m, lineDark);
      set(N - m, k, lineDark);
    }
    // 四个角各一颗四角星
    for (const [cx, cy] of [[m + 12, m + 12], [N - m - 13, m + 12], [N - m - 13, N - m - 13], [m + 12, N - m - 13]]) sparkle(set, cx, cy, line, lineDark);
  }
  return px;
}

// 一颗四角星：十字两臂各 4 格、中间 3×3，右下压暗边
function sparkle(set: (x: number, y: number, c: Col) => void, cx: number, cy: number, c: Col, dark: Col): void {
  for (let k = -4; k <= 4; k++) {
    set(cx + k, cy + 1, dark);
    set(cx + 1, cy + k, dark);
  }
  for (let k = -4; k <= 4; k++) {
    set(cx + k, cy, c);
    set(cx, cy + k, c);
  }
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) set(cx + dx, cy + dy, c);
  set(cx, cy, rgb(255, 252, 232));
}

// 牌背正中的菱形宝石（tileLooks.ts 的 mark 'pixel'）：W×H 格，红色通道是亮还是暗（0 压暗、1 提亮），透明度是压多深。
// 一颗切面宝石：左上的面亮、右下的面暗，外面一圈暗边，正中一格高光；四周一圈细细的暗框
export const MARK_W = 20;
export const MARK_H = 27;

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
  const rx = 6;
  const ry = 8.5;
  for (let y = 0; y < MARK_H; y++)
    for (let x = 0; x < MARK_W; x++) {
      const u = (x - cx) / rx;
      const v = (y - cy) / ry;
      const d = Math.abs(u) + Math.abs(v);
      if (d <= 1) {
        // 面：左上亮、右下暗，正中一道横的分界
        const lit = u + v < 0;
        if (d > 0.8) put(x, y, 0, 230);
        else put(x, y, lit ? 255 : 0, lit ? 150 : 70);
      }
      // 暗框：离四边 2 格
      if (((x === 2 || x === MARK_W - 3) && y >= 2 && y <= MARK_H - 3) || ((y === 2 || y === MARK_H - 3) && x >= 2 && x <= MARK_W - 3)) put(x, y, 0, 120);
    }
  put(Math.round(cx - 2), Math.round(cy - 3), 255, 255);
  put(Math.round(cx - 1), Math.round(cy - 3), 255, 220);
  put(Math.round(cx - 2), Math.round(cy - 2), 255, 220);
  return out;
}

// 像素数组（Uint32，ABGR）画到一张 canvas 上
export function pixelCanvas(px: Uint32Array | Uint8ClampedArray, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const bytes = new Uint8ClampedArray(w * h * 4);
  bytes.set(px instanceof Uint32Array ? new Uint8Array(px.buffer, px.byteOffset, px.byteLength) : px);
  c.getContext('2d')!.putImageData(new ImageData(bytes, w, h), 0, 0);
  return c;
}
