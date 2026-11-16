import type { TableColors } from '../ui/theme';
import { CONSOLE_HALF } from './tableLayout';

// 牌桌风格的中央仪表盘（theme.ts 里牌桌风格的 look）：自动麻将机的数码管、原木的木牌、深夜的纯色、翻牌屏、沙滩的海水、草甸的亚麻布。
// 跟皮肤走时不用这里，还是 table3d.ts 原来那种。
// 画在 512×512 的坐标里（贴图 2048，调用前已经放大 4 倍）。几样东西各套都放在同一个位置，换风格不挪地方：
// 中间方屏（半宽 124）从上到下是局数、本场和余牌、宝牌指示牌、供托；四边各家朝着自己，左边风位、右边点数，
// 最外一条（y 224 上下）只在轮到这家时亮。立直棒是立体的（table3d.ts），放在顶上靠这家的那条边、压在最外一条上，所以那里不放字；
// 圆盘上是小一号的，放在更外面一圈

// 仪表盘的形状（theme.ts 的 shape，视觉设置里「仪表盘形状」，可以跟牌桌风格走，也可以单独选）：机身在 table3d.ts 里建，
// 这里的字和花纹照形状排，不出形状。方盒、矮牌、切角、软包四边的排法一样；圆盘边上越往外越窄，四家那一排往中间收、窄一点
// 风位的字比第一版大一圈（方的 38 到 44px，圆盘 32 到 38px），点数的字照旧
// 顶面贴图那一块的半宽（世界单位），对应贴图 512 坐标里的 256
export const CONSOLE_TOP = CONSOLE_HALF - 0.15;
// 切角：机身外圈每个角沿边切掉多长；软包：外圈圆角半径、边上鼓起来多少
export const CONSOLE_CUT = 0.62;
export const CONSOLE_CUSHION_R = 0.85;
export const CONSOLE_CUSHION_BEVEL = 0.14;
// 顶面贴图那块：切角切掉多长、软包的圆角（世界单位）。比机身往里收 0.1，切口、圆角和机身平行
export const TOP_CUT = CONSOLE_CUT - 0.09;
export const TOP_CUSHION_R = CONSOLE_CUSHION_R - CONSOLE_CUSHION_BEVEL - 0.01;
const PX = 256 / CONSOLE_TOP;

export interface ConsoleSeat {
  // 画面上的方位：0 自己（下边），1 下家（右边），2 对家，3 上家
  rel: number;
  wind: string;
  score: number;
  active: boolean;
  // 角色的颜色：风位旁边留一小条，认人用
  color: string;
  // 鼠标指着仪表盘时（手机上是点一下）：自己比这家多几点，多了写 +、少了写 -；自己那边和平时是 null，照常写点数
  diff: number | null;
}

export interface ConsoleInfo {
  wind: string;
  // 第几局，1 到 4
  no: number;
  honba: number;
  // 发牌前牌山还没码，没有余牌数
  remaining: number | null;
  sticks: number;
  // 五张宝牌指示牌：翻开的是牌面编号，没翻的是 null（画牌背）
  dora: (number | null)[];
}

type DrawTile = (c: CanvasRenderingContext2D, face: number, x: number, y: number, w: number, h: number) => void;

const S = 512;
const M = S / 2;
const SANS = "'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif";
const SERIF = "'Noto Serif SC','STSong',serif";
const NUM = "'Barlow Condensed','Arial Narrow',sans-serif";

interface Look {
  base(c: CanvasRenderingContext2D, k: TableColors): void;
  center(c: CanvasRenderingContext2D, k: TableColors, info: ConsoleInfo, tile: DrawTile): void;
  // 已经转到这家朝下（+y 是这家那条边）
  seat(c: CanvasRenderingContext2D, k: TableColors, s: ConsoleSeat): void;
}

export function drawConsoleLook(c: CanvasRenderingContext2D, k: TableColors, info: ConsoleInfo, seats: ConsoleSeat[], tile: DrawTile): void {
  const look = LOOKS[k.look ?? 'flat'] ?? LOOKS.flat;
  c.save();
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.shadowBlur = 0;
  look.base(c, k);
  look.center(c, k, info, tile);
  for (const s of seats) {
    c.save();
    c.translate(M, M);
    c.rotate((-s.rel * Math.PI) / 2);
    look.seat(c, k, s);
    c.restore();
  }
  c.restore();
}

// ---------- 共用的小件 ----------

// 固定种子的随机数：木纹、波光每次重画都一样，不会一闪一闪
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number | number[]): void {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}

// 实际用的仪表盘形状
const shapeOf = (k: TableColors) => k.shape ?? 'box';
const isDisc = (k: TableColors) => shapeOf(k) === 'disc';

// 顶面的外轮廓往里缩 inset（贴图坐标）：方的照给的圆角 r；圆盘是圆，切角、软包照机身的切口、圆角（往里缩时切口、圆角跟着小一点，和外圈平行）。
// 跟皮肤走的原来那种仪表盘（table3d.ts）也用这个描边框
export function outline(c: CanvasRenderingContext2D, k: TableColors, inset: number, r: number): void {
  const f = shapeOf(k);
  c.beginPath();
  if (f === 'disc') {
    c.arc(M, M, M - inset, 0, Math.PI * 2);
  } else if (f === 'chamfer') {
    const h = M - inset;
    const cut = TOP_CUT * PX - inset * (2 - Math.SQRT2);
    c.moveTo(M - h + cut, M - h);
    c.lineTo(M + h - cut, M - h);
    c.lineTo(M + h, M - h + cut);
    c.lineTo(M + h, M + h - cut);
    c.lineTo(M + h - cut, M + h);
    c.lineTo(M - h + cut, M + h);
    c.lineTo(M - h, M + h - cut);
    c.lineTo(M - h, M - h + cut);
    c.closePath();
  } else if (f === 'cushion') {
    c.roundRect(inset, inset, S - inset * 2, S - inset * 2, Math.max(2, TOP_CUSHION_R * PX - inset));
  } else {
    c.roundRect(inset, inset, S - inset * 2, S - inset * 2, r);
  }
}

function stick(c: CanvasRenderingContext2D, cx: number, cy: number, len: number, th: number): void {
  c.fillStyle = '#f7f3ea';
  rr(c, cx - len / 2, cy - th / 2, len, th, th / 2);
  c.fill();
  c.fillStyle = '#c4212c';
  c.beginPath();
  c.arc(cx, cy, th * 0.38, 0, Math.PI * 2);
  c.fill();
}

// 宝牌指示牌一排（y 是上沿）
function doraRow(c: CanvasRenderingContext2D, k: TableColors, info: ConsoleInfo, y: number, tile: DrawTile, edge?: string): void {
  const w = 36;
  const h = 48;
  for (let i = 0; i < 5; i++) {
    const x = M + (i - 2.5) * (w + 5) + 2.5;
    const f = info.dora[i];
    c.fillStyle = f === null || f === undefined ? k.back : '#f6f1e3';
    rr(c, x, y, w, h, 5);
    c.fill();
    if (edge) {
      c.strokeStyle = edge;
      c.lineWidth = 1.5;
      c.stroke();
    }
    if (f !== null && f !== undefined) tile(c, f, x, y, w, h);
  }
}

// 供托：一根小立直棒加“×几”（没有就不画）
function sticksRow(c: CanvasRenderingContext2D, info: ConsoleInfo, y: number, color: string, font: string): void {
  if (!info.sticks) return;
  stick(c, M - 26, y, 60, 9);
  c.font = font;
  c.fillStyle = color;
  c.textAlign = 'left';
  c.fillText(`×${info.sticks}`, M + 12, y + 1);
  c.textAlign = 'center';
}

// 本场、余牌一行：中间一道竖线隔开
function infoRow(c: CanvasRenderingContext2D, info: ConsoleInfo, y: number, color: string, font: string, line: string): void {
  c.font = font;
  c.fillStyle = color;
  c.textAlign = 'right';
  c.fillText(`${info.honba} 本场`, M - 14, y);
  c.textAlign = 'left';
  c.fillText(`余 ${info.remaining ?? '—'}`, M + 14, y);
  c.textAlign = 'center';
  c.fillStyle = line;
  c.fillRect(M - 1, y - 15, 2, 30);
}

const scoreText = (n: number) => n.toLocaleString('en-US');

// 点差的写法：+1,200、-300、±0。数码管、翻牌不写千分位的逗号
export function diffText(n: number, commas = true): string {
  const a = commas ? scoreText(Math.abs(n)) : String(Math.abs(n));
  return n > 0 ? `+${a}` : n < 0 ? `-${a}` : `±${a}`;
}

// 这一家那条边上写什么、用什么颜色：平时是点数（负分用 minus 色）；指着仪表盘时其他三家写点差，多了 plus 色（蓝）、少了 minus 色（红），一样多照常
function scoreFace(s: ConsoleSeat, ink: string, plus: string, minus: string, commas = true): [string, string] {
  if (s.diff === null) return [commas ? scoreText(s.score) : String(s.score), s.score < 0 ? minus : ink];
  return [diffText(s.diff, commas), s.diff > 0 ? plus : s.diff < 0 ? minus : ink];
}

// 原来那种仪表盘（跟皮肤走）的点差颜色：深色底用亮蓝、亮红，白瓷、漫画这种浅色底用深蓝、深红（都在 5:1 以上）
export function skinSignColors(bg: string): [plus: string, minus: string] {
  const h = bg.replace('#', '');
  const lin = (i: number) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
  return lum > 0.4 ? ['#1a56b0', '#b3212a'] : ['#5ab4ff', '#ff6b6b'];
}

// ---------- 七段数码管 ----------

const SEGS: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abged',
  '3': 'abgcd',
  '4': 'fgbc',
  '5': 'afgcd',
  '6': 'afgedc',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
  '-': 'g',
};

// 一段：两头削尖的长条
function segment(c: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, t: number): void {
  const h = t / 2;
  c.beginPath();
  if (y1 === y2) {
    c.moveTo(x1, y1);
    c.lineTo(x1 + h, y1 - h);
    c.lineTo(x2 - h, y1 - h);
    c.lineTo(x2, y1);
    c.lineTo(x2 - h, y1 + h);
    c.lineTo(x1 + h, y1 + h);
  } else {
    c.moveTo(x1, y1);
    c.lineTo(x1 + h, y1 + h);
    c.lineTo(x1 + h, y2 - h);
    c.lineTo(x1, y2);
    c.lineTo(x1 - h, y2 - h);
    c.lineTo(x1 - h, y1 + h);
  }
  c.closePath();
  c.fill();
}

// 一位数（x、y 是左上角）；lit 为空就只画暗着的那层“8”
function segDigit(c: CanvasRenderingContext2D, ch: string, x: number, y: number, w: number, h: number, t: number, lit: string): void {
  const g = t * 0.2;
  const on = SEGS[ch] ?? '';
  const mid = y + h / 2;
  // 点差的“+”“±”：七段里没有，用两段十字拼（±是十字往上挪，底下加一横）
  if (ch === '+' || ch === '±') {
    c.fillStyle = lit;
    const cx = x + w / 2;
    const arm = Math.min(w / 2 - g, h * 0.24);
    const cy = ch === '+' ? mid : y + arm + t / 2;
    segment(c, cx - arm, cy, cx + arm, cy, t);
    segment(c, cx, cy - arm, cx, cy + arm, t);
    if (ch === '±') segment(c, cx - arm, y + h - t / 2, cx + arm, y + h - t / 2, t);
    return;
  }
  const parts: Record<string, [number, number, number, number]> = {
    a: [x + g, y + t / 2, x + w - g, y + t / 2],
    g: [x + g, mid, x + w - g, mid],
    d: [x + g, y + h - t / 2, x + w - g, y + h - t / 2],
    f: [x + t / 2, y + g, x + t / 2, mid - g],
    b: [x + w - t / 2, y + g, x + w - t / 2, mid - g],
    e: [x + t / 2, mid + g, x + t / 2, y + h - g],
    c: [x + w - t / 2, mid + g, x + w - t / 2, y + h - g],
  };
  c.fillStyle = lit;
  for (const s of on) {
    const [x1, y1, x2, y2] = parts[s];
    segment(c, x1, y1, x2, y2, t);
  }
}

// 一串数字靠右排（right 是最右一位的右边）；slots 位都先画一层暗的“8”，像真的数码管
function segNumber(c: CanvasRenderingContext2D, text: string, right: number, y: number, w: number, h: number, t: number, gap: number, slots: number, lit: string, ghost: string, glow: string): void {
  const n = Math.max(slots, text.length);
  c.save();
  // 数码管略微往右斜
  c.translate(0, y + h);
  c.transform(1, 0, -0.07, 1, 0, 0);
  c.translate(0, -(y + h));
  for (let i = 0; i < n; i++) {
    const x = right - (n - i) * w - (n - 1 - i) * gap;
    segDigit(c, '8', x, y, w, h, t, ghost);
  }
  c.shadowColor = glow;
  c.shadowBlur = 5;
  for (let i = 0; i < text.length; i++) {
    const x = right - (text.length - i) * w - (text.length - 1 - i) * gap;
    segDigit(c, text[i], x, y, w, h, t, lit);
  }
  c.restore();
}

// ---------- 自动麻将机：黑色亮面机身，琥珀色数码管 ----------

const LED_ON = '#ffb02e';
const LED_RED = '#ff4636';
const LED_BLUE = '#4fb3ff';
// 没亮的那几段：只比窗底亮一点点，看得出是数码管，又不会被认成数字
const LED_GHOST = '#170d09';
const LED_WIN = '#0a0605';
const LED_LABEL = '#d6cabc';

function ledWindow(c: CanvasRenderingContext2D, k: TableColors, x: number, y: number, w: number, h: number, lit = false, r = 8): void {
  rr(c, x, y, w, h, r);
  c.fillStyle = LED_WIN;
  c.fill();
  c.strokeStyle = lit ? LED_ON : k.console.line;
  c.lineWidth = lit ? 2.5 : 2;
  c.stroke();
}

const led: Look = {
  base(c, k) {
    const bg = c.createLinearGradient(0, 0, S, S);
    bg.addColorStop(0, k.console.bg[0]);
    bg.addColorStop(1, k.console.bg[1]);
    c.fillStyle = bg;
    c.fillRect(0, 0, S, S);
    // 亮面机身：左上角一抹反光
    const sheen = c.createLinearGradient(0, 0, S * 0.7, S * 0.7);
    sheen.addColorStop(0, 'rgba(255,255,255,0.07)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = sheen;
    c.fillRect(0, 0, S, S);
    c.strokeStyle = '#2c2d30';
    c.lineWidth = 2;
    outline(c, k, 9, 14);
    c.stroke();
    // 中间方屏：圆盘上圆角大一点
    ledWindow(c, k, M - 124, M - 124, 248, 248, false, isDisc(k) ? 30 : 8);
  },
  center(c, k, info, tile) {
    // 局数：“东”和“局”是印在面板上、背后打着灯的字，中间的局数是数码管
    c.font = `900 56px ${SANS}`;
    c.fillStyle = LED_ON;
    c.shadowColor = LED_ON;
    c.shadowBlur = 6;
    c.fillText(info.wind, M - 66, M - 70);
    c.fillText('局', M + 66, M - 70);
    c.shadowBlur = 0;
    segNumber(c, String(info.no), M + 17, M - 98, 34, 56, 7, 0, 1, LED_ON, LED_GHOST, LED_ON);
    // 本场、余牌：小字标签加两位数码管
    c.font = `900 26px ${SANS}`;
    c.fillStyle = LED_LABEL;
    c.textAlign = 'left';
    c.fillText('本场', M - 114, M - 4);
    c.fillText('余', M + 14, M - 4);
    c.textAlign = 'center';
    segNumber(c, String(info.honba), M - 10, M - 22, 22, 36, 5, 5, 2, LED_ON, LED_GHOST, LED_ON);
    segNumber(c, info.remaining === null ? '--' : String(info.remaining), M + 100, M - 22, 22, 36, 5, 5, 2, LED_ON, LED_GHOST, LED_ON);
    doraRow(c, k, info, M + 26, tile);
    sticksRow(c, info, M + 100, LED_ON, `700 30px ${NUM}`);
  },
  seat(c, k, s) {
    const disc = isDisc(k);
    // 风位：一个方键，边上是角色的颜色；轮到这家时方键亮起来
    const [kx, ky, kw, kf] = disc ? [-128, 152, 46, 34] : [-152, 162, 52, 40];
    rr(c, kx, ky, kw, kw, 6);
    c.fillStyle = s.active ? LED_ON : '#1d1e21';
    c.fill();
    c.strokeStyle = s.color;
    c.lineWidth = 3;
    c.stroke();
    c.font = `900 ${kf}px ${SANS}`;
    c.fillStyle = s.active ? '#1a1006' : LED_LABEL;
    c.fillText(s.wind, kx + kw / 2, ky + kw / 2 + 1);
    // 点数窗：六位数码管，靠右；数字高 46，和原来仪表盘上点数的字差不多大（圆盘上窗窄一点，数字高 40）
    const [wx, wy, ww, wh] = disc ? [-74, 148, 194, 54] : [-88, 156, 224, 62];
    ledWindow(c, k, wx, wy, ww, wh, s.active);
    const [text, ink] = scoreFace(s, LED_ON, LED_BLUE, LED_RED, false);
    if (disc) segNumber(c, text, wx + ww - 9, wy + 7, text.length > 6 ? 20 : 24, 40, 5, 5, 6, ink, LED_GHOST, ink);
    else segNumber(c, text, wx + ww - 9, wy + 8, text.length > 6 ? 23 : 28, 46, 6, 6, 6, ink, LED_GHOST, ink);
    if (s.active) {
      c.fillStyle = LED_ON;
      c.shadowColor = LED_ON;
      c.shadowBlur = 8;
      if (disc) rr(c, wx, wy + wh + 4, ww - 20, 4, 2);
      else rr(c, wx, 224, ww, 4, 2);
      c.fill();
      c.shadowBlur = 0;
    }
  },
};

// ---------- 原木：浅色木牌、墨色字，轮到谁盖朱红印 ----------

const VERMILION = '#9b2c17';
// 点差多了用的蓝：浅木牌上 5.5:1
const INDIGO = '#1a4a94';

// 原木那套的一排：左边圆圈里写风位，右边点数。圆盘上整排往中间收、窄一点
function circleSeat(k: TableColors) {
  return isDisc(k)
    ? { cx: -104, cy: 176, r: 26, wf: 34, sx: -64, sy: 178, sw: 182, sf: 56, by: 206, bw: 168 }
    : { cx: -121, cy: 188, r: 31, wf: 40, sx: -74, sy: 191, sw: 210, sf: 62, by: 223, bw: 208 };
}

const plaque: Look = {
  base(c, k) {
    const bg = c.createRadialGradient(M, M, 40, M, M, M * 1.4);
    bg.addColorStop(0, k.console.bg[0]);
    bg.addColorStop(1, k.console.bg[1]);
    c.fillStyle = bg;
    c.fillRect(0, 0, S, S);
    // 木纹：几十条起伏的细线，颜色很淡
    const rnd = seeded(7);
    for (let i = 0; i < 46; i++) {
      const y0 = rnd() * S;
      const amp = 3 + rnd() * 7;
      const f = 0.006 + rnd() * 0.01;
      const ph = rnd() * Math.PI * 2;
      c.strokeStyle = `rgba(150,108,58,${0.08 + rnd() * 0.14})`;
      c.lineWidth = 0.8 + rnd() * 1.8;
      c.beginPath();
      for (let x = -4; x <= S + 4; x += 8) {
        const y = y0 + Math.sin(x * f + ph) * amp + Math.sin(x * f * 3.1 + ph) * amp * 0.25;
        if (x < 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.stroke();
    }
    // 刻出来的边：一道深线，里面一道亮线
    c.strokeStyle = k.console.line;
    c.lineWidth = 2.5;
    outline(c, k, 12, 10);
    c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.4)';
    c.lineWidth = 1;
    outline(c, k, 15.5, 8);
    c.stroke();
    // 中间方屏：一个刻线方框（圆盘上圆角大一点）
    c.fillStyle = 'rgba(255,255,255,0.22)';
    rr(c, M - 120, M - 120, 240, 240, isDisc(k) ? 30 : 8);
    c.fill();
    c.strokeStyle = k.console.line;
    c.lineWidth = 2;
    c.stroke();
  },
  center(c, k, info, tile) {
    c.font = k.console.title.replace('1em', '72px');
    c.fillStyle = k.console.ink;
    c.fillText(`${info.wind}${'一二三四'[info.no - 1] ?? info.no}局`, M, M - 62);
    infoRow(c, info, M - 2, k.console.dim, `700 30px ${SERIF}`, k.console.line);
    doraRow(c, k, info, M + 24, tile);
    sticksRow(c, info, M + 98, k.console.ink, `700 28px ${SERIF}`);
  },
  seat(c, k, s) {
    // 风位：墨线圆圈，外面一圈角色色；轮到这家时盖成朱红印
    const p = circleSeat(k);
    c.beginPath();
    c.arc(p.cx, p.cy, p.r + 6, 0, Math.PI * 2);
    c.strokeStyle = s.color;
    c.lineWidth = 3;
    c.stroke();
    c.beginPath();
    c.arc(p.cx, p.cy, p.r, 0, Math.PI * 2);
    c.fillStyle = s.active ? VERMILION : 'rgba(255,255,255,0.3)';
    c.fill();
    if (!s.active) {
      c.strokeStyle = k.console.ink;
      c.lineWidth = 2.5;
      c.stroke();
    }
    c.font = `900 ${p.wf + 2}px ${SERIF}`;
    c.fillStyle = s.active ? '#fff4e6' : k.console.ink;
    c.fillText(s.wind, p.cx, p.cy + 2);
    // 点数：太长（六位数、负数、点差）就横着压一压，不出这条边
    const [text, ink] = scoreFace(s, k.console.ink, INDIGO, VERMILION);
    c.font = `900 ${p.sf}px ${SERIF}`;
    c.fillStyle = ink;
    c.textAlign = 'left';
    c.fillText(text, p.sx, p.sy, p.sw);
    c.textAlign = 'center';
    if (s.active) {
      c.fillStyle = VERMILION;
      rr(c, p.sx, p.by, p.bw, 5, 2.5);
      c.fill();
    }
  },
};

// ---------- 深夜：纯色底、灰白字加一点青，不发光 ----------

const flat: Look = {
  base(c, k) {
    const bg = c.createRadialGradient(M, M, 40, M, M, M * 1.4);
    bg.addColorStop(0, k.console.bg[0]);
    bg.addColorStop(1, k.console.bg[1]);
    c.fillStyle = bg;
    c.fillRect(0, 0, S, S);
    c.strokeStyle = k.console.line;
    c.lineWidth = 2;
    outline(c, k, 10, 12);
    c.stroke();
    // 中间方屏：圆盘上圆角大一点
    c.fillStyle = '#23272d';
    rr(c, M - 120, M - 120, 240, 240, isDisc(k) ? 36 : 16);
    c.fill();
  },
  center(c, k, info, tile) {
    c.font = k.console.title.replace('1em', '72px');
    c.fillStyle = k.console.ink;
    c.fillText(`${info.wind}${'一二三四'[info.no - 1] ?? info.no}局`, M, M - 62);
    infoRow(c, info, M - 2, k.console.dim, `700 32px ${NUM}`, k.console.line);
    doraRow(c, k, info, M + 24, tile);
    sticksRow(c, info, M + 98, k.console.ink, `700 30px ${NUM}`);
  },
  seat(c, k, s) {
    // 圆盘：边上越往外越窄，这一排往中间收一点、整排窄一点，点数的字还是和原来一样大（66px）
    const disc = isDisc(k);
    const [bx, by, bw] = disc ? [-126, 148, 46] : [-152, 162, 52];
    rr(c, bx, by, bw, bw, 8);
    c.fillStyle = s.active ? k.console.accent : '#2a2f37';
    c.fill();
    // 角色色：方块下面一小条
    c.fillStyle = s.color;
    rr(c, bx, by + bw + 3, bw, 4, 2);
    c.fill();
    c.font = `900 ${disc ? 32 : 38}px ${SANS}`;
    c.fillStyle = s.active ? '#10201e' : k.console.ink;
    c.fillText(s.wind, bx + bw / 2, by + bw / 2 + 1);
    const [text, ink] = scoreFace(s, k.console.ink, '#6cb6ff', '#ff8a7a');
    const [sx, sy, sw] = disc ? [-70, 176, 186] : [-80, 191, 214];
    c.font = `700 ${disc ? 66 : 68}px ${NUM}`;
    c.fillStyle = ink;
    c.textAlign = 'left';
    c.fillText(text, sx, sy, sw);
    c.textAlign = 'center';
    if (s.active) {
      c.fillStyle = k.console.accent;
      rr(c, sx, disc ? 205 : 223, disc ? 176 : 214, disc ? 4 : 5, 2.5);
      c.fill();
    }
  },
};

// ---------- 翻牌屏：铝面板，一位一块翻牌 ----------

const FLAP = '#1f2226';
const FLAP_TOP = '#272a2f';
const FLAP_ON = '#ff8a1f';

// 一颗一字螺丝
function screw(c: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  const g = c.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
  g.addColorStop(0, '#f2f4f6');
  g.addColorStop(1, '#8a929a');
  c.fillStyle = g;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = '#5d646b';
  c.lineWidth = 1;
  c.stroke();
  c.strokeStyle = '#4a5056';
  c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(x - r * 0.6, y + r * 0.35);
  c.lineTo(x + r * 0.6, y - r * 0.35);
  c.stroke();
}

// 一块翻牌：上下两半颜色差一点，中间一道缝
function flapTile(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, ch: string, font: string, ink: string, fill = FLAP): void {
  rr(c, x, y, w, h, 4);
  c.fillStyle = fill;
  c.fill();
  if (fill === FLAP) {
    c.fillStyle = FLAP_TOP;
    rr(c, x, y, w, h / 2, [4, 4, 0, 0]);
    c.fill();
  }
  c.font = font;
  c.fillStyle = ink;
  c.fillText(ch, x + w / 2, y + h / 2 + 1, w - 4);
  c.fillStyle = 'rgba(0,0,0,0.55)';
  c.fillRect(x, y + h / 2 - 1, w, 2);
}

// 一串翻牌靠右排
function flapRow(c: CanvasRenderingContext2D, text: string, right: number, y: number, w: number, h: number, gap: number, font: string, ink: string): void {
  for (let i = 0; i < text.length; i++) {
    const x = right - (text.length - i) * w - (text.length - 1 - i) * gap;
    flapTile(c, x, y, w, h, text[i], font, ink);
  }
}

const flap: Look = {
  base(c, k) {
    const bg = c.createLinearGradient(0, 0, 0, S);
    bg.addColorStop(0, k.console.bg[0]);
    bg.addColorStop(1, k.console.bg[1]);
    c.fillStyle = bg;
    c.fillRect(0, 0, S, S);
    // 拉丝铝：横向的细纹
    const rnd = seeded(11);
    for (let y = 0; y < S; y += 1.5) {
      c.fillStyle = rnd() < 0.5 ? `rgba(255,255,255,${0.05 + rnd() * 0.08})` : `rgba(0,0,0,${0.02 + rnd() * 0.04})`;
      c.fillRect(0, y, S, 1);
    }
    c.strokeStyle = k.console.line;
    c.lineWidth = 2;
    outline(c, k, 10, 12);
    c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.6)';
    c.lineWidth = 1;
    outline(c, k, 13, 10);
    c.stroke();
    // 切角的铝盒：四个切口里各一颗螺丝
    if (shapeOf(k) === 'chamfer') {
      const d = M - (TOP_CUT * PX) / 2 - 14;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) screw(c, M + sx * d, M + sy * d, 6);
    }
  },
  center(c, k, info, tile) {
    // 局数：东、几、局三块大翻牌
    const font = `900 48px ${SANS}`;
    flapTile(c, M - 101, M - 106, 62, 72, info.wind, font, k.console.ink);
    flapTile(c, M - 31, M - 106, 62, 72, String(info.no), `700 62px ${NUM}`, k.console.ink);
    flapTile(c, M + 39, M - 106, 62, 72, '局', font, k.console.ink);
    // 本场、余牌：印在铝面上的深色小字，数字是小翻牌
    c.font = `900 26px ${SANS}`;
    c.fillStyle = k.console.dim;
    c.textAlign = 'left';
    c.fillText('本场', M - 116, M - 4);
    c.fillText('余', M + 12, M - 4);
    c.textAlign = 'center';
    const small = `700 34px ${NUM}`;
    flapRow(c, String(info.honba), M - 24, M - 24, 26, 40, 3, small, k.console.ink);
    flapRow(c, info.remaining === null ? '--' : String(info.remaining), M + 100, M - 24, 26, 40, 3, small, k.console.ink);
    doraRow(c, k, info, M + 28, tile);
    sticksRow(c, info, M + 102, k.console.dim, `700 30px ${NUM}`);
  },
  seat(c, k, s) {
    // 风位一块翻牌，轮到这家时翻成橙色；下面一小条角色色。圆盘上整排往中间收、块矮一点
    const disc = isDisc(k);
    const [tx, ty, tw, th, tf] = disc ? [-124, 148, 44, 50, 36] : [-152, 156, 52, 64, 44];
    flapTile(c, tx, ty, tw, th, s.wind, `900 ${tf}px ${SANS}`, s.active ? '#1a1006' : k.console.ink, s.active ? FLAP_ON : FLAP);
    c.fillStyle = s.color;
    rr(c, tx, ty + th + 3, tw, 4, 2);
    c.fill();
    // 点数一位一块：块高 64、数字 56px，和原来仪表盘上点数的字差不多大；位数多了块窄一点（圆盘上块高 50、数字 44px）
    const [text, ink] = scoreFace(s, k.console.ink, '#6cbcff', '#ff8a7a', false);
    if (disc) flapRow(c, text, 118, ty, text.length > 6 ? 22 : text.length > 5 ? 25 : 28, th, 3, `700 44px ${NUM}`, ink);
    else flapRow(c, text, 134, ty, text.length > 6 ? 26 : text.length > 5 ? 31 : 34, th, 4, `700 56px ${NUM}`, ink);
    if (s.active) {
      c.fillStyle = FLAP_ON;
      if (disc) rr(c, -70, ty + th + 4, 174, 4, 2);
      else rr(c, -84, 223, 218, 5, 2.5);
      c.fill();
    }
  },
};

// ---------- 沙滩：一汪深海水，白字，轮到谁亮一块阳光黄 ----------

// 一排四家：左边风位方块，右边点数（深夜、沙滩、草甸三套一样排）。圆盘上整排往中间收、窄一点，点数的字还是 66px
function boxSeat(k: TableColors) {
  return isDisc(k) ? { bx: -126, by: 148, bw: 46, wf: 32, sx: -70, sy: 176, sw: 186, sf: 66, bar: 205, bw2: 176, bh: 4 } : { bx: -152, by: 162, bw: 52, wf: 38, sx: -80, sy: 191, sw: 214, sf: 68, bar: 223, bw2: 214, bh: 5 };
}

const tide: Look = {
  base(c, k) {
    // 海水：中间浅一点、往外深，边上一道白线（浪花），中间方屏是更深的一块水。别的什么都不画
    const bg = c.createRadialGradient(M, M, 30, M, M, M * 1.4);
    bg.addColorStop(0, k.console.bg[0]);
    bg.addColorStop(1, k.console.bg[1]);
    c.fillStyle = bg;
    c.fillRect(0, 0, S, S);
    c.strokeStyle = 'rgba(240,252,250,0.55)';
    c.lineWidth = 2;
    outline(c, k, 11, 14);
    c.stroke();
    c.fillStyle = 'rgba(0,24,30,0.3)';
    rr(c, M - 122, M - 122, 244, 244, isDisc(k) ? 34 : 16);
    c.fill();
  },
  center(c, k, info, tile) {
    c.font = k.console.title.replace('1em', '72px');
    c.fillStyle = k.console.ink;
    c.fillText(`${info.wind}${'一二三四'[info.no - 1] ?? info.no}局`, M, M - 62);
    infoRow(c, info, M - 2, k.console.dim, `700 32px ${NUM}`, k.console.line);
    // 没翻的宝牌是沙子牌的牌背：描一圈浅色边，在深水上也看得出来
    doraRow(c, k, info, M + 24, tile, 'rgba(217,241,238,0.85)');
    sticksRow(c, info, M + 98, k.console.ink, `700 30px ${NUM}`);
  },
  seat(c, k, s) {
    // 风位：一块浅一点的水、白字，下面一小条角色色；轮到这家时换成阳光黄、深色字
    const p = boxSeat(k);
    rr(c, p.bx, p.by, p.bw, p.bw, 12);
    c.fillStyle = s.active ? k.console.accent : 'rgba(255,255,255,0.14)';
    c.fill();
    c.fillStyle = s.color;
    rr(c, p.bx, p.by + p.bw + 3, p.bw, 4, 2);
    c.fill();
    c.font = `900 ${p.wf}px ${SANS}`;
    c.fillStyle = s.active ? '#1d2a2c' : k.console.ink;
    c.fillText(s.wind, p.bx + p.bw / 2, p.by + p.bw / 2 + 1);
    const [text, ink] = scoreFace(s, k.console.ink, '#b5e3ff', '#ffc2b4');
    c.font = `700 ${p.sf}px ${NUM}`;
    c.fillStyle = ink;
    c.textAlign = 'left';
    c.fillText(text, p.sx, p.sy, p.sw);
    c.textAlign = 'center';
    if (s.active) {
      c.fillStyle = k.console.accent;
      rr(c, p.sx, p.bar, p.bw2, p.bh, 2.5);
      c.fill();
    }
  },
};

// ---------- 草甸：一块米白的亚麻布，四边一圈缝线，四个斜角压着一小枝叶子；深绿字，轮到谁亮一块叶绿 ----------

// 一小枝压平的叶子：一根细茎，两边交错着几片小叶（ang 是这枝朝哪个方向长，k 是大小）
function sprig(c: CanvasRenderingContext2D, x: number, y: number, ang: number, k: number, color: string): void {
  c.save();
  c.translate(x, y);
  c.rotate(ang);
  c.scale(k, k);
  c.strokeStyle = color;
  c.fillStyle = color;
  c.lineWidth = 1.6;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(0, 0);
  c.quadraticCurveTo(14, -3, 30, 0);
  c.stroke();
  for (const [t, side, len] of [[7, -1, 9], [13, 1, 10], [19, -1, 9], [25, 1, 8], [31, 0, 8]] as const) {
    c.save();
    c.translate(t, side === 0 ? 0 : -0.5);
    c.rotate(side === 0 ? 0 : side * -0.75);
    c.beginPath();
    c.moveTo(0, 0);
    c.quadraticCurveTo(len * 0.5, -len * 0.38, len, 0);
    c.quadraticCurveTo(len * 0.5, len * 0.38, 0, 0);
    c.fill();
    c.restore();
  }
  c.restore();
}

const linen: Look = {
  base(c, k) {
    const bg = c.createRadialGradient(M, M, 30, M, M, M * 1.4);
    bg.addColorStop(0, k.console.bg[0]);
    bg.addColorStop(1, k.console.bg[1]);
    c.fillStyle = bg;
    c.fillRect(0, 0, S, S);
    // 亚麻布纹：横竖很淡的细线
    const rnd = seeded(23);
    for (let y = 0; y < S; y += 2) {
      c.fillStyle = rnd() < 0.5 ? `rgba(255,255,255,${0.12 + rnd() * 0.12})` : `rgba(110,96,60,${0.03 + rnd() * 0.04})`;
      c.fillRect(0, y, S, 0.8);
    }
    for (let x = 0; x < S; x += 2) {
      c.fillStyle = rnd() < 0.5 ? `rgba(255,255,255,${0.08 + rnd() * 0.1})` : `rgba(110,96,60,${0.025 + rnd() * 0.035})`;
      c.fillRect(x, 0, 0.8, S);
    }
    // 四边一圈缝线（虚线）
    c.strokeStyle = k.console.line;
    c.lineWidth = 2;
    c.setLineDash([9, 6]);
    outline(c, k, 13, 12);
    c.stroke();
    c.setLineDash([]);
    // 四个斜角各压一小枝叶子，朝着角往外长；在四家那几排字外面，不压字（圆盘上往里收一点，才在圆里面）
    const d = isDisc(k) ? 150 : 178;
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sy], i) => {
      const ang = Math.atan2(sy, sx) + (i % 2 ? 0.25 : -0.25);
      sprig(c, M + sx * d, M + sy * d, ang, isDisc(k) ? 1.1 : 1.35, 'rgba(84,122,66,0.72)');
    });
    // 中间方屏：白一点的一块，细细一道叶绿边
    c.fillStyle = 'rgba(255,255,255,0.5)';
    rr(c, M - 122, M - 122, 244, 244, isDisc(k) ? 34 : 16);
    c.fill();
    c.strokeStyle = k.console.line;
    c.lineWidth = 1.5;
    c.stroke();
  },
  center(c, k, info, tile) {
    c.font = k.console.title.replace('1em', '72px');
    c.fillStyle = k.console.ink;
    c.fillText(`${info.wind}${'一二三四'[info.no - 1] ?? info.no}局`, M, M - 62);
    infoRow(c, info, M - 2, k.console.dim, `700 32px ${NUM}`, k.console.line);
    doraRow(c, k, info, M + 24, tile, k.console.line);
    sticksRow(c, info, M + 98, k.console.ink, `700 30px ${NUM}`);
  },
  seat(c, k, s) {
    // 风位：白色小方块、深绿字，下面一小条角色色；轮到这家时换成叶绿、白字
    const p = boxSeat(k);
    rr(c, p.bx, p.by, p.bw, p.bw, 10);
    c.fillStyle = s.active ? k.console.accent : '#ffffff';
    c.fill();
    c.strokeStyle = s.active ? k.console.accent : k.console.line;
    c.lineWidth = 2;
    c.stroke();
    c.fillStyle = s.color;
    rr(c, p.bx, p.by + p.bw + 3, p.bw, 4, 2);
    c.fill();
    c.font = `900 ${p.wf}px ${SANS}`;
    c.fillStyle = s.active ? '#ffffff' : k.console.ink;
    c.fillText(s.wind, p.bx + p.bw / 2, p.by + p.bw / 2 + 1);
    const [text, ink] = scoreFace(s, k.console.ink, '#1a56b0', '#a81e27');
    c.font = `700 ${p.sf}px ${NUM}`;
    c.fillStyle = ink;
    c.textAlign = 'left';
    c.fillText(text, p.sx, p.sy, p.sw);
    c.textAlign = 'center';
    if (s.active) {
      c.fillStyle = k.console.accent;
      rr(c, p.sx, p.bar, p.bw2, p.bh, 2.5);
      c.fill();
    }
  },
};

const LOOKS: Record<string, Look> = { led, plaque, flat, flap, tide, linen };
