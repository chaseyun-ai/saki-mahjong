import { Kind, numOf, suitOf } from '../engine/tiles';
import { type Col, hex } from './core';
import { PIXEL_GLYPHS } from './glyphs';

// 像素风的牌面：一张牌面 25×35 个像素（和 SVG 牌面 40×56 一样的比例），一个像素一个像素画出来。
// 万子、字牌的字是像素字体里取出来的点阵（glyphs.ts）：数字 1 倍，萬和东南西北中發放大 2 倍；
// 筒子是一圈圈的圆饼，索子是三像素宽的竹节，一索是一只小孔雀。
// 透明的地方露出牌身的颜色。3D 牌桌照这个做贴图（不插值，一格就是一格），2D 牌桌嵌成图片放大

export const PFACE_W = 25;
export const PFACE_H = 35;

// 牌面上的几种颜色：墨、红、绿、蓝各一条三格的色阶（暗、本色、亮），饼的白芯
export const PIX_INK = '#272439';
const INK = hex(PIX_INK);
const WHITE = hex('#fbf6e6');
interface Tone {
  d: Col;
  m: Col;
  l: Col;
}
const tone = (d: string, m: string, l: string): Tone => ({ d: hex(d), m: hex(m), l: hex(l) });
const RED = tone('#7a1621', '#cf2b35', '#f2705f');
const GREEN = tone('#0c4a2c', '#1e8250', '#58be7c');
const BLUE = tone('#122f63', '#2557aa', '#5f92e2');

class Img {
  readonly px = new Uint32Array(PFACE_W * PFACE_H);
  set(x: number, y: number, c: Col): void {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= PFACE_W || y >= PFACE_H) return;
    this.px[y * PFACE_W + x] = c;
  }
  get(x: number, y: number): Col {
    if (x < 0 || y < 0 || x >= PFACE_W || y >= PFACE_H) return 0;
    return this.px[y * PFACE_W + x];
  }
}

// 一个字：点阵放大 k 倍，左上角在 (x, y)。bold 时往右多描一列（萬这种笔画密的字不加粗）
function glyph(img: Img, ch: string, x: number, y: number, k: number, c: Col, bold = false): void {
  const rows = PIXEL_GLYPHS[ch];
  if (!rows) return;
  rows.forEach((row, r) => {
    for (let q = 0; q < row.length; q++) {
      if (row[q] !== '#') continue;
      for (let dy = 0; dy < k; dy++)
        for (let dx = 0; dx < k + (bold ? 1 : 0); dx++) img.set(x + q * k + dx, y + r * k + dy, c);
    }
  });
}

// 点阵实际有笔画的列（居中用）
function inkCols(ch: string): [number, number] {
  const rows = PIXEL_GLYPHS[ch] ?? [];
  let a = Infinity;
  let b = -Infinity;
  for (const row of rows)
    for (let q = 0; q < row.length; q++)
      if (row[q] === '#') {
        a = Math.min(a, q);
        b = Math.max(b, q);
      }
  return a === Infinity ? [0, 0] : [a, b];
}

function centered(img: Img, ch: string, y: number, k: number, c: Col, bold = false): void {
  const [a, b] = inkCols(ch);
  const w = (b - a + 1) * k + (bold ? 1 : 0);
  glyph(img, ch, Math.floor((PFACE_W - w) / 2) - a * k, y, k, c, bold);
}

// ---------- 筒子 ----------

// 一枚饼：圆心 (cx, cy)（像素中心是 .5），半径 r。最外一圈深色描边，往里本色一圈、白一圈，芯是本色、正中一点白
function coin(img: Img, cx: number, cy: number, r: number, t: Tone): void {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d > r) continue;
      let c: Col;
      if (d > r - 1) c = t.d;
      else if (r >= 5 && d > r - 2) c = t.m;
      else if (d > r * 0.42 + 0.35) c = WHITE;
      else if (d < 0.75 && r >= 4) c = WHITE;
      else c = t.m;
      img.set(x, y, c);
    }
  // 左上角一点高光
  if (r >= 3.5) img.set(cx - r * 0.45, cy - r * 0.45, t.l);
}

// 一筒：大花饼。外两圈绿（深、本色），白底上一圈红花瓣，红圈、白圈，蓝芯正中一点白
function bigCoin(img: Img, red: boolean): void {
  const cx = 12.5;
  const cy = 17.5;
  const outer = red ? RED : GREEN;
  const core = red ? RED : BLUE;
  for (let y = 6; y < 30; y++)
    for (let x = 0; x < 25; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const a = Math.atan2(y + 0.5 - cy, x + 0.5 - cx);
      let c: Col = 0;
      if (d > 11.2) continue;
      if (d > 10.2) c = outer.d;
      else if (d > 9.2) c = outer.m;
      else if (d > 6.2) {
        // 花瓣：一圈 12 瓣，瓣和瓣之间留白
        const petal = Math.cos(a * 12) > 0.15 && d > 6.8 && d < 8.8;
        c = petal ? RED.m : WHITE;
      } else if (d > 5.2) c = RED.d;
      else if (d > 4.2) c = RED.m;
      else if (d > 3.2) c = WHITE;
      else if (d > 0.9) c = core.m;
      else c = WHITE;
      img.set(x, y, c);
    }
  img.set(8, 11, outer.l);
  img.set(9, 10, outer.l);
}

function pinFace(img: Img, n: number, red: boolean): void {
  const B = red ? RED : BLUE;
  const G = red ? RED : GREEN;
  const R = RED;
  const put = (list: [number, number, Tone][], r: number) => list.forEach(([x, y, t]) => coin(img, x, y, r, t));
  switch (n) {
    case 1:
      bigCoin(img, red);
      return;
    case 2:
      put([[12.5, 9.5, G], [12.5, 25.5, B]], 6.5);
      return;
    case 3:
      put([[6.5, 7.5, B], [12.5, 17.5, R], [18.5, 27.5, G]], 4.8);
      return;
    case 4:
      put([[7, 10, B], [18, 10, G], [7, 25, G], [18, 25, B]], 5.2);
      return;
    case 5:
      put([[6.5, 7.5, B], [18.5, 7.5, G], [12.5, 17.5, R], [6.5, 27.5, G], [18.5, 27.5, B]], 4.6);
      return;
    case 6:
      put([[7, 6, G], [18, 6, G], [7, 18, R], [18, 18, R], [7, 29, R], [18, 29, R]], 4.4);
      return;
    case 7:
      put([[5.5, 4.5, G], [12.5, 7.5, G], [19.5, 10.5, G], [7.5, 20.5, R], [17.5, 20.5, R], [7.5, 29.5, R], [17.5, 29.5, R]], 3.8);
      return;
    case 8:
      put([4.5, 12.5, 21.5, 29.5].flatMap((y) => [[7.5, y, B], [17.5, y, B]] as [number, number, Tone][]), 3.8);
      return;
    default:
      put(
        ([[6.5, B], [17.5, R], [28.5, G]] as [number, Tone][]).flatMap(([y, t]) => [5.5, 12.5, 19.5].map((x) => [x, y, t] as [number, number, Tone])),
        3.8,
      );
  }
}

// ---------- 索子 ----------

// 一根竹子：三像素宽，x 是中间那一列，从 y0 到 y1（含）。左一列亮、右一列暗；两头和正中一道竹节（深色，左右各宽出去一格）
function stick(img: Img, x: number, y0: number, y1: number, t: Tone): void {
  const mid = Math.round((y0 + y1) / 2);
  for (let y = y0; y <= y1; y++) {
    const node = y === y0 || y === y1 || y === mid;
    if (node) {
      for (let dx = -1; dx <= 1; dx++) img.set(x + dx, y, t.d);
      continue;
    }
    img.set(x - 1, y, t.l);
    img.set(x, y, t.m);
    img.set(x + 1, y, t.d);
  }
}

// 斜着的竹子（八索）：从 (x0, y0) 到 (x1, y1) 一行行往旁边挪，每行三像素
function slant(img: Img, x0: number, y0: number, x1: number, y1: number, t: Tone): void {
  const mid = Math.round((y0 + y1) / 2);
  for (let y = y0; y <= y1; y++) {
    const x = Math.round(x0 + ((x1 - x0) * (y - y0)) / (y1 - y0));
    const node = y === y0 || y === y1 || y === mid;
    if (node) {
      for (let dx = -1; dx <= 1; dx++) img.set(x + dx, y, t.d);
      continue;
    }
    img.set(x - 1, y, t.l);
    img.set(x, y, t.m);
    img.set(x + 1, y, t.d);
  }
}

// 一索：一只小孔雀（G 本色、g 深色、l 亮色、R 红、B 蓝、b 深蓝、W 白、K 墨）
const BIRD = [
  '..........R.R.R..........',
  '...........R.R...........',
  '..........ggggg..........',
  '.........gGGGGGg.........',
  '.........GGWKGGGRR.......',
  '.........gGGGGGgRRR......',
  '..........gGGGGg.........',
  '.........gGGGGGg.........',
  '........gGGllGGGg........',
  '.......gGGlggGGGGg.......',
  '.......gGlgggGGGGg.......',
  '.......gGlgggGGGGg.......',
  '.......gGGlgggGGGg.......',
  '........gGGGGGGGg........',
  '.........gGGGGGg.........',
  '..........ggGgg..........',
  '.....b...gg.G.gg...b.....',
  '....bBb.g...G...g.bBb....',
  '...bBRBbg...G...gbBRBb...',
  '...bBRBb....G....bBRBb...',
  '....bBb..g..G..g..bBb....',
  '.....b..bBb.G.bBb..b.....',
  '.......bBRBbGbBRBb.......',
  '.......bBRBb.bBRBb.......',
  '........bBb...bBb........',
  '.........b.....b.........',
  '...........R.R...........',
  '..........R...R..........',
  '.........RR...RR.........',
];

function bird(img: Img, red: boolean): void {
  const g = red ? RED : GREEN;
  const pal: Record<string, Col> = { G: g.m, g: g.d, l: g.l, R: RED.m, B: BLUE.m, b: BLUE.d, W: WHITE, K: INK };
  BIRD.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = pal[row[x]];
      if (c) img.set(x, y + 3, c);
    }
  });
}

function souFace(img: Img, n: number, red: boolean): void {
  const G = red ? RED : GREEN;
  const B = red ? RED : BLUE;
  const R = RED;
  switch (n) {
    case 1:
      bird(img, red);
      return;
    case 2:
      stick(img, 12, 2, 15, G);
      stick(img, 12, 19, 32, B);
      return;
    case 3:
      stick(img, 12, 2, 15, G);
      stick(img, 7, 19, 32, B);
      stick(img, 17, 19, 32, B);
      return;
    case 4:
      stick(img, 7, 2, 15, G);
      stick(img, 17, 2, 15, B);
      stick(img, 7, 19, 32, B);
      stick(img, 17, 19, 32, G);
      return;
    case 5:
      stick(img, 5, 2, 13, G);
      stick(img, 19, 2, 13, B);
      stick(img, 12, 12, 23, R);
      stick(img, 5, 22, 33, B);
      stick(img, 19, 22, 33, G);
      return;
    case 6:
      for (const x of [5, 12, 19]) {
        stick(img, x, 2, 15, G);
        stick(img, x, 19, 32, B);
      }
      return;
    case 7:
      stick(img, 12, 1, 9, R);
      for (const x of [5, 12, 19]) {
        stick(img, x, 12, 21, G);
        stick(img, x, 24, 33, B);
      }
      return;
    case 8:
      // 上面一组摆成 M、下面一组摆成 W
      stick(img, 3, 2, 15, G);
      slant(img, 9, 2, 11, 15, G);
      slant(img, 15, 2, 13, 15, G);
      stick(img, 21, 2, 15, G);
      stick(img, 3, 19, 32, B);
      slant(img, 11, 19, 9, 32, B);
      slant(img, 13, 19, 15, 32, B);
      stick(img, 21, 19, 32, B);
      return;
    default:
      [
        [2, 10],
        [13, 21],
        [24, 32],
      ].forEach(([y0, y1], row) => [5, 12, 19].forEach((x) => stick(img, x, y0, y1, x === 12 ? R : row === 1 ? B : G)));
  }
}

// ---------- 万子、字牌 ----------

const NUM_CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const HONOR_CN = ['東', '南', '西', '北', '', '發', '中'];

function manFace(img: Img, n: number, red: boolean): void {
  centered(img, NUM_CN[n - 1], 1, 1, red ? RED.m : INK, true);
  centered(img, '萬', 12, 2, RED.m);
}

function honorFace(img: Img, k: Kind): void {
  if (k === 31) {
    // 白：蓝色双线框
    for (let y = 4; y <= 30; y++)
      for (let x = 3; x <= 21; x++) {
        const outer = x <= 4 || x >= 20 || y <= 5 || y >= 29;
        const inner = (x === 7 || x === 17) && y >= 8 && y <= 26 ? true : (y === 8 || y === 26) && x >= 7 && x <= 17;
        if (outer) img.set(x, y, BLUE.m);
        else if (inner) img.set(x, y, BLUE.d);
      }
    return;
  }
  const c = k === 32 ? GREEN.m : k === 33 ? RED.m : INK;
  centered(img, HONOR_CN[k - 27], 6, 2, c);
  // 字的右下描一道深色的影子，粗一点、立体一点
  if (k === 32 || k === 33) shadowInk(img, c, k === 32 ? GREEN.d : RED.d);
}

// 本色笔画右边、下面空着的地方压一格深色
function shadowInk(img: Img, c: Col, dark: Col): void {
  const out: [number, number][] = [];
  for (let y = 0; y < PFACE_H; y++)
    for (let x = 0; x < PFACE_W; x++) if (img.get(x, y) === c && !img.get(x + 1, y + 1)) out.push([x + 1, y + 1]);
  for (const [x, y] of out) img.set(x, y, dark);
}

// 一张牌面的像素（PFACE_W × PFACE_H，按行排，0 是透明）
export function pixelFace(k: Kind, red: boolean): Uint32Array {
  const img = new Img();
  if (k >= 27) honorFace(img, k);
  else if (suitOf(k) === 0) manFace(img, numOf(k), red);
  else if (suitOf(k) === 1) pinFace(img, numOf(k), red);
  else souFace(img, numOf(k), red);
  return img.px;
}

// 画到 canvas 上（左上角 x, y，一格一个像素）
export function putPixelFace(ctx: CanvasRenderingContext2D, k: Kind, red: boolean, x: number, y: number): void {
  const px = pixelFace(k, red);
  const bytes = new Uint8ClampedArray(px.length * 4);
  bytes.set(new Uint8Array(px.buffer, px.byteOffset, px.byteLength));
  const data = new ImageData(bytes, PFACE_W, PFACE_H);
  ctx.putImageData(data, x, y);
}

// 2D 牌桌用：一张牌面做成 PNG 的 data URL，套一层 SVG（和普通牌面一样的 40×56 画布），不插值放大
const urls = new Map<number, string>();
export function pixelFaceSvg(k: Kind, red: boolean): string {
  const key = k * 2 + (red ? 1 : 0);
  let url = urls.get(key);
  if (!url) {
    const c = document.createElement('canvas');
    c.width = PFACE_W;
    c.height = PFACE_H;
    putPixelFace(c.getContext('2d')!, k, red, 0, 0);
    url = c.toDataURL('image/png');
    urls.set(key, url);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 40 56" width="100%" height="100%" class="px-face"><image href="${url}" xlink:href="${url}" x="0" y="0" width="40" height="56" preserveAspectRatio="none" style="image-rendering:pixelated"/></svg>`;
}
