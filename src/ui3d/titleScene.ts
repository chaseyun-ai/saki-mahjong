import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { TILE_H, TILE_T, TILE_W } from './tableLayout';

// 主页封面的牌桌（title.ts 用）：榻榻米上一张麻将桌，从斜上方往下看。
// 桌子中间五张大牌拼出「超能力麻将」，四边各有一排牌拼出一种玩法（东家这边是个人对局，南家团体赛，北家随机出场，
// 西家的全国大赛还扣着、贴着封条），右下角三根点棒是三个设置。牌山、骰子、起家牌、坐垫、茶杯都是摆设。
// 这里只管画和动：哪一块被鼠标指着、被点了，由 title.ts 告诉它；每一块在屏幕上占的位置也由这里算出来交回去，
// title.ts 把看不见的按钮盖在上面（键盘、读屏、点击都走按钮）。

export type TitleHotId = 'single' | 'team' | 'random' | 'story' | 'match' | 'visual' | 'sound' | 'dice';
export type TitleTod = 'day' | 'dusk' | 'night';

export interface TitleSceneOpts {
  // 盖着开场：镜头先凑近 logo，牌山一墩墩升起来；open() 以后镜头拉开、发牌
  gate: boolean;
  tod: TitleTod;
  // 第一次来 / 回来：便签上写的不一样
  back: boolean;
  // 每一帧把各块在画面里的位置（像素，相对画布）交回去
  onRects: (rects: Map<TitleHotId, { x: number; y: number; w: number; h: number }>) => void;
  // 牌山升完了（可以显示「点一下开始」）
  onReady: () => void;
  // 一张牌落桌（发牌、点了以后），响一声
  onClack: () => void;
}

// 桌布半宽、桌框宽、桌框比桌布高多少（单位：牌宽）
const F = 14.2;
const FRAME_W = 1.7;
const FRAME_UP = 0.72;
const WALL_Z = 9.45;
const WALL_N = 17;
// 三根点棒：第一根的 z、每根隔多远
const STICK_Z = 10.75;
const STICK_GAP = 1.15;
// logo 那五张牌摆在哪（z）
const LOGO_Z = -2.1;

const INK_RED = '#bf2a30';
const INK_BLUE = '#1c3f8f';
const INK_GREEN = '#1c7a46';
const TILE_BODY = '#f7f1e1';
const TILE_BACK = '#e2a03a';

const GLYPH_FONT = '"Ma Shan Zheng", "Noto Serif SC", "Songti SC", "SimSun", serif';
const PRINT_FONT = '"Noto Serif SC", "Songti SC", "SimSun", serif';
const NOTE_FONT = '"ZCOOL KuaiLe", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';

const ease = (k: number) => 1 - (1 - k) * (1 - k) * (1 - k);
const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const clamp01 = (k: number) => Math.min(1, Math.max(0, k));

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function canvasTexture(c: HTMLCanvasElement, aniso = 8): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

// ---------- 贴图 ----------

// 一张牌面：一个大字，像刻进去再填了漆（右下一道亮边、字里上深下浅）
function glyphCanvas(ch: string, color: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 348;
  drawGlyph(c, ch, color);
  return c;
}

function drawGlyph(c: HTMLCanvasElement, ch: string, color: string): void {
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `210px ${GLYPH_FONT}`;
  const x = c.width / 2;
  const y = c.height / 2 + 8;
  // 刻痕的亮边
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillText(ch, x + 3, y + 3.5);
  // 刻痕的暗边
  ctx.fillStyle = 'rgba(60,30,10,0.35)';
  ctx.fillText(ch, x - 1.5, y - 2);
  const g = ctx.createLinearGradient(0, y - 110, 0, y + 110);
  g.addColorStop(0, shade(color, -0.22));
  g.addColorStop(1, shade(color, 0.1));
  ctx.fillStyle = g;
  ctx.fillText(ch, x, y);
}

// 颜色调深（k<0）调浅（k>0）
function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex);
  if (k < 0) c.multiplyScalar(1 + k);
  else c.lerp(new THREE.Color('#ffffff'), k);
  return `#${c.getHexString()}`;
}

interface FeltLabel {
  x: number;
  z: number;
  text: string;
  size: number;
  color?: string;
  align?: 'left' | 'center' | 'right';
  spacing?: number;
  font?: string;
}

// 桌布：中间亮四周暗的绿呢，上面印着金线、座位的风、每种玩法的一句说明
function drawFelt(c: HTMLCanvasElement): void {
  const S = c.width;
  const ctx = c.getContext('2d')!;
  const px = S / (2 * F);
  const X = (x: number) => (x + F) * px;
  const g = ctx.createRadialGradient(S / 2, S * 0.46, S * 0.05, S / 2, S / 2, S * 0.74);
  g.addColorStop(0, '#3fa873');
  g.addColorStop(0.5, '#2a8a5a');
  g.addColorStop(1, '#155a38');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  // 呢子的细绒：一粒粒很淡的亮点、暗点，再加几道很淡的顺毛
  const R = seeded(21);
  for (let i = 0; i < 90000; i++) {
    ctx.fillStyle = R() < 0.5 ? `rgba(255,255,255,${(0.02 + R() * 0.045).toFixed(3)})` : `rgba(0,30,10,${(0.03 + R() * 0.06).toFixed(3)})`;
    ctx.fillRect(R() * S, R() * S, 1.6, 1.6);
  }
  for (let i = 0; i < 260; i++) {
    ctx.strokeStyle = `rgba(255,255,255,${(0.012 + R() * 0.02).toFixed(3)})`;
    ctx.lineWidth = 1 + R() * 2;
    const x = R() * S;
    const y = R() * S;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 60 + R() * 160, y + (R() - 0.5) * 30);
    ctx.stroke();
  }
  // logo 背后一圈放射的光（很淡），让中间亮一点
  const rc = { x: X(0), y: X(LOGO_Z) };
  for (let k = 0; k < 28; k++) {
    const a0 = (k / 28) * Math.PI * 2 + 0.05;
    const a1 = a0 + (Math.PI * 2) / 56;
    const len = (k % 2 ? 8.6 : 7.4) * px;
    const rg = ctx.createRadialGradient(rc.x, rc.y, 1.2 * px, rc.x, rc.y, len);
    rg.addColorStop(0, 'rgba(236,255,200,0.17)');
    rg.addColorStop(1, 'rgba(236,255,200,0)');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.moveTo(rc.x, rc.y);
    ctx.lineTo(rc.x + Math.cos(a0) * len, rc.y + Math.sin(a0) * len);
    ctx.lineTo(rc.x + Math.cos(a1) * len, rc.y + Math.sin(a1) * len);
    ctx.closePath();
    ctx.fill();
  }
  // 贴着桌框的两道金线
  const gold = 'rgba(255,224,150,0.62)';
  const line = (inset: number, w: number) => {
    const a = X(-F + inset);
    const b = X(F - inset);
    const r = 0.9 * px;
    ctx.strokeStyle = gold;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(a + r, a);
    ctx.arcTo(b, a, b, b, r);
    ctx.arcTo(b, b, a, b, r);
    ctx.arcTo(a, b, a, a, r);
    ctx.arcTo(a, a, b, a, r);
    ctx.closePath();
    ctx.stroke();
  };
  line(0.42, 5);
  line(0.66, 2);
  // 中间：logo 底下的一句话，两边各一道线、一个菱形
  const label = (l: FeltLabel) => {
    ctx.font = l.font ? `${l.size * px}px ${l.font}` : `600 ${l.size * px}px ${PRINT_FONT}`;
    ctx.fillStyle = l.color ?? 'rgba(255,246,214,0.9)';
    ctx.textBaseline = 'middle';
    const gap = (l.spacing ?? 0) * px;
    const chars = [...l.text];
    const widths = chars.map((ch) => ctx.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0) + gap * (chars.length - 1);
    let x = X(l.x) - (l.align === 'right' ? total : l.align === 'left' ? 0 : total / 2);
    ctx.textAlign = 'left';
    chars.forEach((ch, i) => {
      ctx.fillText(ch, x, X(l.z));
      x += widths[i] + gap;
    });
    return total / px;
  };
  const subW = label({ x: 0, z: 1.75, text: '天才少女们的能力对决', size: 0.78, spacing: 0.34, color: 'rgba(255,226,150,0.92)' });
  ctx.strokeStyle = gold;
  ctx.lineWidth = 3;
  for (const s of [-1, 1]) {
    const x0 = X((s * subW) / 2 + s * 0.5);
    const x1 = X(s * 7.6);
    ctx.beginPath();
    ctx.moveTo(x0, X(1.75));
    ctx.lineTo(x1, X(1.75));
    ctx.stroke();
    ctx.fillStyle = gold;
    ctx.save();
    ctx.translate(x1, X(1.75));
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-7, -7, 14, 14);
    ctx.restore();
  }
  // 四家的风（淡淡的大字）
  const wind = 'rgba(214,255,226,0.3)';
  label({ x: 12, z: -5.6, text: '南', size: 1.5, color: wind, font: GLYPH_FONT });
  label({ x: 6.2, z: -12.05, text: '西', size: 1.5, color: wind, font: GLYPH_FONT });
  label({ x: -12, z: -7.0, text: '北', size: 1.5, color: wind, font: GLYPH_FONT });
  // 每种玩法的一句说明
  const note = 'rgba(255,246,214,0.82)';
  label({ x: -7.55, z: 11.68, text: '选一位', size: 0.5, align: 'right', color: note, spacing: 0.06 });
  label({ x: -7.55, z: 12.46, text: '和三个电脑打', size: 0.5, align: 'right', color: note, spacing: 0.06 });
  label({ x: 12, z: 4.75, text: '四队蛇形选人', size: 0.46, color: note, spacing: 0.04 });
  label({ x: 12, z: 5.47, text: '五人接力', size: 0.46, color: note, spacing: 0.04 });
  label({ x: -12, z: 5.95, text: '抽一位', size: 0.46, color: note, spacing: 0.04 });
  label({ x: -12, z: 6.67, text: '直接开局', size: 0.46, color: note, spacing: 0.04 });
  label({ x: 7.7, z: -12.44, text: '剧情模式', size: 0.5, align: 'left', color: note, spacing: 0.06 });
  label({ x: 7.7, z: -11.66, text: '还在做', size: 0.5, align: 'left', color: note, spacing: 0.06 });
  // 三根点棒旁边的字
  ['对局设置', '视觉设置', '声音设置'].forEach((text, i) => label({ x: 8.85, z: STICK_Z + i * STICK_GAP, text, size: 0.54, align: 'right', spacing: 0.06 }));
}

// 木头：深浅不一的长木纹
function woodCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#7b4a26';
  ctx.fillRect(0, 0, 512, 512);
  const R = seeded(31);
  for (let i = 0; i < 220; i++) {
    const y = R() * 512;
    const dark = R() < 0.55;
    ctx.strokeStyle = dark ? `rgba(52,26,8,${(0.08 + R() * 0.2).toFixed(3)})` : `rgba(214,150,88,${(0.06 + R() * 0.14).toFixed(3)})`;
    ctx.lineWidth = 0.6 + R() * 2.4;
    ctx.beginPath();
    const amp = 2 + R() * 7;
    const ph = R() * 6.28;
    const f = 1 + Math.floor(R() * 2);
    for (let x = 0; x <= 512; x += 16) {
      const yy = y + Math.sin((x / 512) * Math.PI * 2 * f + ph) * amp;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  return c;
}

// 榻榻米：一张席子（1 : 2），顺着长边一根根蔺草，两条长边包着深色的布边
function tatamiCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 1024;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#c9b86e';
  ctx.fillRect(0, 0, 512, 1024);
  const R = seeded(41);
  for (let x = 0; x < 512; x += 2) {
    const v = R();
    ctx.fillStyle = v < 0.4 ? `rgba(255,250,210,${(0.1 + R() * 0.2).toFixed(3)})` : `rgba(120,110,50,${(0.06 + R() * 0.16).toFixed(3)})`;
    ctx.fillRect(x, 0, 1, 1024);
  }
  // 横着的经线，隔一段一道，很淡
  for (let y = 0; y < 1024; y += 26) {
    ctx.fillStyle = 'rgba(110,100,48,0.12)';
    ctx.fillRect(0, y, 512, 1);
  }
  // 布边
  for (const x of [0, 512 - 22]) {
    ctx.fillStyle = '#2c4636';
    ctx.fillRect(x, 0, 22, 1024);
    ctx.fillStyle = 'rgba(214,190,110,0.5)';
    for (let y = 8; y < 1024; y += 22) {
      ctx.save();
      ctx.translate(x + 11, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-3.2, -3.2, 6.4, 6.4);
      ctx.restore();
    }
  }
  // 席子两头的缝
  ctx.fillStyle = 'rgba(70,60,30,0.5)';
  ctx.fillRect(0, 0, 512, 3);
  ctx.fillRect(0, 1021, 512, 3);
  return c;
}

// 坐垫的布：深红底子，淡淡的方格织纹
function cushionCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#9a2f3b';
  ctx.fillRect(0, 0, 256, 256);
  const R = seeded(51);
  for (let i = 0; i < 256; i += 4) {
    ctx.fillStyle = `rgba(255,220,200,${(0.02 + R() * 0.05).toFixed(3)})`;
    ctx.fillRect(i, 0, 1, 256);
    ctx.fillStyle = `rgba(50,0,10,${(0.03 + R() * 0.07).toFixed(3)})`;
    ctx.fillRect(0, i, 256, 1);
  }
  ctx.strokeStyle = 'rgba(240,200,120,0.28)';
  ctx.lineWidth = 2;
  for (let i = -256; i < 512; i += 64) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 256, 256);
    ctx.moveTo(i + 256, 0);
    ctx.lineTo(i, 256);
    ctx.stroke();
  }
  return c;
}

// 点棒：白棒子，中间一颗红点，两边几颗黑点（三根的点数不一样）
function stickCanvas(kind: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 48;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fbf9f0';
  ctx.fillRect(0, 0, 512, 48);
  const dot = (x: number, color: string, r = 7) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, 24, r, 0, Math.PI * 2);
    ctx.fill();
  };
  if (kind === 0) {
    dot(256, '#c4212c', 11);
    for (const x of [150, 185, 220, 292, 327, 362]) dot(x, '#20222e');
  } else if (kind === 1) {
    for (const x of [196, 226, 256, 286, 316]) dot(x, '#c4212c', 8);
  } else {
    dot(256, '#c4212c', 11);
  }
  return c;
}

// 起家牌：橘色的牌子，一个「東」
function dealerCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 176;
  drawDealer(c);
  return c;
}

function drawDealer(c: HTMLCanvasElement): void {
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 176);
  g.addColorStop(0, '#f39a3c');
  g.addColorStop(1, '#de7a22');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 176);
  ctx.fillStyle = '#2a1608';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `136px ${GLYPH_FONT}`;
  ctx.fillText('東', 128, 94);
}

// 封条：一条白纸，红字「敬请期待」，盖一个圆章
function sealCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 176;
  drawSeal(c);
  return c;
}

function drawSeal(c: HTMLCanvasElement): void {
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 1024, 176);
  ctx.fillStyle = '#fbf6e6';
  ctx.fillRect(0, 0, 1024, 176);
  ctx.strokeStyle = '#b3262c';
  ctx.lineWidth = 6;
  ctx.strokeRect(12, 12, 1000, 152);
  ctx.lineWidth = 2;
  ctx.strokeRect(24, 24, 976, 128);
  ctx.fillStyle = '#b3262c';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `108px ${GLYPH_FONT}`;
  [...'全国大赛'].forEach((ch, i) => ctx.fillText(ch, 290 + i * 112, 94));
  ctx.font = `66px ${GLYPH_FONT}`;
  ctx.fillText('·', 706, 94);
  [...'敬请期待'].forEach((ch, i) => ctx.fillText(ch, 762 + i * 66, 98));
  // 圆章
  ctx.beginPath();
  ctx.arc(140, 88, 56, 0, Math.PI * 2);
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.font = `76px ${GLYPH_FONT}`;
  ctx.fillText('封', 140, 94);
}

// 榻榻米上的便签：一张米色的纸，一截和纸胶带
function noteCanvas(back: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 400;
  drawNote(c, back);
  return c;
}

function drawNote(c: HTMLCanvasElement, back: boolean): void {
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 512, 400);
  ctx.fillStyle = '#fffbe9';
  ctx.fillRect(0, 26, 512, 374);
  // 横线
  ctx.fillStyle = 'rgba(120,160,210,0.35)';
  for (let y = 140; y < 380; y += 84) ctx.fillRect(34, y + 44, 444, 2);
  ctx.fillStyle = 'rgba(246,170,190,0.9)';
  ctx.fillRect(186, 0, 140, 56);
  ctx.fillStyle = '#5a2a12';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `72px ${NOTE_FONT}`;
  ctx.fillText(back ? '欢迎回来！' : '欢迎！', 256, 130);
  ctx.font = `58px ${NOTE_FONT}`;
  ctx.fillText('今天也打', 256, 228);
  ctx.fillText('一局吧～', 256, 312);
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,244,170,1)');
  g.addColorStop(0.5, 'rgba(255,230,120,0.72)');
  g.addColorStop(1, 'rgba(255,220,100,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return canvasTexture(c, 1);
}

function diePips(v: number): THREE.CanvasTexture {
  const P: Record<number, [number, number][]> = {
    1: [[0, 0]],
    2: [[-1, -1], [1, 1]],
    3: [[-1, -1], [0, 0], [1, 1]],
    4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
    5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
    6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
  };
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f8f4ea';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = v === 1 || v === 4 ? '#c4212c' : '#1d1f33';
  const r = v === 1 ? 21 : 11.5;
  for (const [x, y] of P[v]) {
    ctx.beginPath();
    ctx.arc(64 + x * 31, 64 + y * 31, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvasTexture(c, 4);
}

// BoxGeometry 六个面的顺序是 +x -x +y -y +z -z，对面点数相加为 7
const DIE_FACES = [3, 4, 1, 6, 2, 5];
const DIE_UP: Record<number, THREE.Euler> = {
  1: new THREE.Euler(0, 0, 0),
  6: new THREE.Euler(Math.PI, 0, 0),
  2: new THREE.Euler(-Math.PI / 2, 0, 0),
  5: new THREE.Euler(Math.PI / 2, 0, 0),
  3: new THREE.Euler(0, 0, Math.PI / 2),
  4: new THREE.Euler(0, 0, -Math.PI / 2),
};

// ---------- 场景里的东西 ----------

// 一张摆在桌上的牌：pivot 管位置和朝向，inner 管翻面、抬起来
interface Piece {
  pivot: THREE.Group;
  inner: THREE.Group;
  home: THREE.Vector3;
  from: THREE.Vector3;
  scale: number;
  // 这张牌什么时候开始发（秒）；发的时候从扣着翻成正面朝上（down 的不翻）
  dealAt: number;
  down: boolean;
  landed: boolean;
}

interface Hot {
  id: TitleHotId;
  group: THREE.Group;
  pieces: Piece[];
  // 点棒、骰子这些不是牌的东西
  props: THREE.Object3D[];
  box: THREE.Box3;
  glow: THREE.Mesh | null;
  hover: number;
  pressAt: number;
  shakeAt: number;
}

interface Die {
  mesh: THREE.Mesh;
  home: THREE.Vector3;
  from: THREE.Quaternion;
  to: THREE.Quaternion;
  axis: THREE.Vector3;
  rollAt: number;
}

const TOD_LIGHT: Record<TitleTod, { hemi: number; sky: string; ground: string; key: number; keyColor: string; exposure: number; room: string }> = {
  day: { hemi: 1.15, sky: '#fff6e6', ground: '#6b5a3a', key: 2.3, keyColor: '#fff4e0', exposure: 1.02, room: '#b9ae78' },
  dusk: { hemi: 0.95, sky: '#ffe2c2', ground: '#5a4630', key: 2.3, keyColor: '#ffd9a8', exposure: 0.98, room: '#a89a68' },
  night: { hemi: 0.62, sky: '#cdd6ff', ground: '#33281c', key: 2.5, keyColor: '#ffe0b0', exposure: 0.95, room: '#6f6746' },
};

export class TitleScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 1, 400);
  private clock = new THREE.Clock();
  private t = 0;
  private raf = 0;
  private dead = false;
  private hots = new Map<TitleHotId, Hot>();
  private hovered: TitleHotId | null = null;
  private logo: Piece[] = [];
  private dice: Die[] = [];
  private walls: { body: THREE.InstancedMesh; back: THREE.InstancedMesh; at: number[]; pos: THREE.Matrix4[]; done: boolean } | null = null;
  private repaint: (() => void)[] = [];
  // 镜头：凑近 logo 的位置、拉开看全桌的位置，zoom 0 → 1
  private camNear = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  private camFar = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  private zoom = 0;
  private openAt = Infinity;
  private ready = false;
  private pointer = new THREE.Vector2();
  private sway = new THREE.Vector2();
  private nextIdleRoll = 6;
  private ro: ResizeObserver | null = null;
  private onMove = (e: PointerEvent) => {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1);
  };

  constructor(
    private canvas: HTMLCanvasElement,
    private opts: TitleSceneOpts,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.buildRoom();
    this.buildTable();
    this.buildWalls();
    this.buildLogo();
    this.buildMenu();
    this.buildProps();
    if (!opts.gate) {
      // 从选人页回来：不盖开场，牌山已经在，直接发牌
      this.zoom = 1;
      this.openAt = 0.15;
      this.ready = true;
    }
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement ?? canvas);
    window.addEventListener('pointermove', this.onMove);
    // 字体下好以后，带字的贴图重画一遍
    const fonts = document.fonts;
    if (fonts?.load) {
      const text = '超能力麻将个人对局团体赛随机出场全国大赛東南西北敬请期待封天才少女们的选一位和三电脑打四队蛇形五接抽直开剧情模式还在做设置视觉声音欢迎回来今也吧！～';
      void Promise.all([fonts.load(`64px "Ma Shan Zheng"`, text), fonts.load(`600 32px "Noto Serif SC"`, text), fonts.load(`32px "ZCOOL KuaiLe"`, text)])
        .catch(() => {})
        .then(() => {
          if (!this.dead) this.repaint.forEach((f) => f());
        });
    }
    this.loop();
  }

  // ---------- 搭场景 ----------

  private buildRoom(): void {
    const L = TOD_LIGHT[this.opts.tod];
    this.scene.background = new THREE.Color(L.room);
    this.renderer.toneMappingExposure = L.exposure;
    this.scene.add(new THREE.HemisphereLight(L.sky, L.ground, L.hemi));
    const key = new THREE.DirectionalLight(L.keyColor, L.key);
    key.position.set(-11, 26, 9);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 3.5;
    const sc = key.shadow.camera;
    sc.left = -34;
    sc.right = 34;
    sc.top = 30;
    sc.bottom = -30;
    sc.near = 1;
    sc.far = 80;
    sc.updateProjectionMatrix();
    this.scene.add(key);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.32;
    pmrem.dispose();

    // 榻榻米：一张席子 34 × 68（牌宽），铺满地面
    const tex = canvasTexture(tatamiCanvas(), 8);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(8, 4);
    tex.offset.set(0.5, 0.12);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(272, 272), new THREE.MeshStandardMaterial({ map: tex, color: '#e2d8bc', roughness: 0.95, envMapIntensity: 0.2 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.3;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  private buildTable(): void {
    // 桌布
    const feltCanvas = document.createElement('canvas');
    feltCanvas.width = feltCanvas.height = 2048;
    drawFelt(feltCanvas);
    const feltTex = canvasTexture(feltCanvas, 16);
    this.repaint.push(() => {
      drawFelt(feltCanvas);
      feltTex.needsUpdate = true;
    });
    const felt = new THREE.Mesh(new THREE.PlaneGeometry(F * 2, F * 2), new THREE.MeshStandardMaterial({ map: feltTex, roughness: 0.96, envMapIntensity: 0.1 }));
    felt.rotation.x = -Math.PI / 2;
    felt.receiveShadow = true;
    this.scene.add(felt);

    // 桌框：一圈圆角的木头，内沿一道铜边
    const outer = F + FRAME_W;
    const shape = new THREE.Shape();
    const r = 1.6;
    shape.moveTo(-outer + r, -outer);
    shape.lineTo(outer - r, -outer);
    shape.quadraticCurveTo(outer, -outer, outer, -outer + r);
    shape.lineTo(outer, outer - r);
    shape.quadraticCurveTo(outer, outer, outer - r, outer);
    shape.lineTo(-outer + r, outer);
    shape.quadraticCurveTo(-outer, outer, -outer, outer - r);
    shape.lineTo(-outer, -outer + r);
    shape.quadraticCurveTo(-outer, -outer, -outer + r, -outer);
    const hole = new THREE.Path();
    hole.moveTo(-F, -F);
    hole.lineTo(-F, F);
    hole.lineTo(F, F);
    hole.lineTo(F, -F);
    hole.closePath();
    shape.holes.push(hole);
    const depth = FRAME_UP + 1.9;
    const frameGeo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.22, bevelSize: 0.22, bevelSegments: 4, curveSegments: 10 });
    const wood = canvasTexture(woodCanvas(), 8);
    wood.wrapS = wood.wrapT = THREE.RepeatWrapping;
    wood.repeat.set(1 / 13, 1 / 13);
    const frame = new THREE.Mesh(frameGeo, new THREE.MeshStandardMaterial({ map: wood, roughness: 0.42, metalness: 0.05, envMapIntensity: 0.9 }));
    frame.rotation.x = -Math.PI / 2;
    frame.position.y = FRAME_UP - depth;
    frame.castShadow = true;
    frame.receiveShadow = true;
    this.scene.add(frame);
    const brass = new THREE.MeshStandardMaterial({ color: '#d9b25a', roughness: 0.3, metalness: 0.85, envMapIntensity: 1.2 });
    for (let k = 0; k < 4; k++) {
      const trim = new THREE.Mesh(new THREE.BoxGeometry(F * 2, 0.12, 0.12), brass);
      trim.position.set(0, FRAME_UP + 0.2, F - 0.02).applyAxisAngle(new THREE.Vector3(0, 1, 0), (k * Math.PI) / 2);
      trim.rotation.y = (k * Math.PI) / 2;
      this.scene.add(trim);
    }
    // 桌子底下一块暗的，桌框外面看得到一点桌身
    const body = new THREE.Mesh(new THREE.BoxGeometry(outer * 2 - 1.2, 1, outer * 2 - 1.2), new THREE.MeshStandardMaterial({ color: '#3a2212', roughness: 0.7 }));
    body.position.y = -1.6;
    this.scene.add(body);
  }

  private tileGeoms(): { body: THREE.BufferGeometry; back: THREE.BufferGeometry } {
    return {
      body: new RoundedBoxGeometry(TILE_W, TILE_H, TILE_T * 0.62, 4, 0.12),
      back: new RoundedBoxGeometry(TILE_W, TILE_H, TILE_T * 0.42, 4, 0.12),
    };
  }

  private bodyMat = new THREE.MeshStandardMaterial({ color: TILE_BODY, roughness: 0.38, envMapIntensity: 0.7 });
  private backMat = new THREE.MeshStandardMaterial({ color: TILE_BACK, roughness: 0.36, envMapIntensity: 0.8 });
  private geoms: { body: THREE.BufferGeometry; back: THREE.BufferGeometry } | null = null;

  // 一张牌（本地 +z 是牌面）：牌身、牌背、牌面上的字
  private makeTile(face: THREE.Texture | null): THREE.Group {
    const g = (this.geoms ??= this.tileGeoms());
    const group = new THREE.Group();
    const body = new THREE.Mesh(g.body, this.bodyMat);
    body.position.z = TILE_T * 0.19;
    const back = new THREE.Mesh(g.back, this.backMat);
    back.position.z = -TILE_T * 0.25;
    for (const m of [body, back]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    group.add(body, back);
    if (face) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(TILE_W * 0.9, TILE_H * 0.9), new THREE.MeshStandardMaterial({ map: face, transparent: true, roughness: 0.4, envMapIntensity: 0.5 }));
      f.position.z = TILE_T / 2 + 0.003;
      group.add(f);
    }
    return group;
  }

  private glyphTexture(ch: string, color: string): THREE.CanvasTexture {
    const c = glyphCanvas(ch, color);
    const t = canvasTexture(c, 8);
    this.repaint.push(() => {
      drawGlyph(c, ch, color);
      t.needsUpdate = true;
    });
    return t;
  }

  // 摆一张平放的牌：正面朝上（down 是扣着），大小 scale，转一点 yaw
  private piece(parent: THREE.Object3D, face: THREE.Texture | null, x: number, z: number, scale: number, yaw: number, down = false): Piece {
    const pivot = new THREE.Group();
    const inner = this.makeTile(face);
    inner.scale.setScalar(scale);
    pivot.add(inner);
    pivot.rotation.y = yaw;
    parent.add(pivot);
    const home = new THREE.Vector3(x, (TILE_T / 2) * scale, z);
    return { pivot, inner, home, from: home.clone(), scale, dealAt: 0, down, landed: false };
  }

  // 牌山：四面各 17 墩、两层，都扣着；开场时一墩墩从桌面里升起来
  private buildWalls(): void {
    const g = (this.geoms ??= this.tileGeoms());
    const n = WALL_N * 2 * 4;
    const body = new THREE.InstancedMesh(g.body, this.bodyMat, n);
    const back = new THREE.InstancedMesh(g.back, this.backMat, n);
    for (const m of [body, back]) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      this.scene.add(m);
    }
    const at: number[] = [];
    const pos: THREE.Matrix4[] = [];
    const R = seeded(61);
    const q = new THREE.Quaternion();
    const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
    for (let side = 0; side < 4; side++) {
      const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (side * Math.PI) / 2);
      for (let k = 0; k < WALL_N; k++) {
        for (let level = 0; level < 2; level++) {
          const p = new THREE.Vector3((k - (WALL_N - 1) / 2) * (TILE_W + 0.012), TILE_T * (level + 0.5), WALL_Z + (R() - 0.5) * 0.03).applyQuaternion(turn);
          const jitter = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (R() - 0.5) * 0.02);
          q.copy(turn).multiply(jitter).multiply(flat);
          pos.push(new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)));
          at.push(this.opts.gate ? 0.35 + (side * WALL_N + k) * 0.014 : -1);
        }
      }
    }
    this.walls = { body, back, at, pos, done: false };
    this.updateWalls();
  }

  private updateWalls(): void {
    const w = this.walls;
    if (!w || w.done) return;
    const m = new THREE.Matrix4();
    const bodyOff = new THREE.Matrix4().makeTranslation(0, 0, TILE_T * 0.19);
    const backOff = new THREE.Matrix4().makeTranslation(0, 0, -TILE_T * 0.25);
    const sink = new THREE.Matrix4();
    let all = true;
    for (let i = 0; i < w.pos.length; i++) {
      const k = clamp01((this.t - w.at[i]) / 0.42);
      if (k < 1) all = false;
      // 从桌面底下升上来，快到头时冒一下
      const e = ease(k);
      const y = (e - 1) * TILE_T * 2.4 + Math.sin(k * Math.PI) * 0.12;
      sink.makeTranslation(0, y, 0);
      m.multiplyMatrices(sink, w.pos[i]).multiply(bodyOff);
      w.body.setMatrixAt(i, m);
      m.multiplyMatrices(sink, w.pos[i]).multiply(backOff);
      w.back.setMatrixAt(i, m);
    }
    w.body.instanceMatrix.needsUpdate = true;
    w.back.instanceMatrix.needsUpdate = true;
    if (all) {
      w.done = true;
      if (!this.ready) {
        this.ready = true;
        this.opts.onReady();
      }
    }
  }

  // logo：桌子中间五张大牌
  private buildLogo(): void {
    const chars: [string, string][] = [
      ['超', INK_RED],
      ['能', INK_BLUE],
      ['力', INK_RED],
      ['麻', INK_GREEN],
      ['将', INK_RED],
    ];
    const yaws = [0.07, -0.05, 0.03, -0.06, 0.05];
    const group = new THREE.Group();
    this.scene.add(group);
    // 牌底下一片暖光，慢慢地一明一暗；一盏小灯隔一阵从左到右扫过去，牌面上闪一下
    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(22, 8.4),
      new THREE.MeshBasicMaterial({ map: (this.glowTex ??= glowTexture()), transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.set(0, 0.02, LOGO_Z + 0.2);
    this.scene.add(halo);
    this.halo = halo;
    this.glint = new THREE.PointLight('#fff1cc', 0, 11, 1.6);
    this.glint.position.set(-14, 3.4, LOGO_Z + 1.2);
    this.scene.add(this.glint);
    chars.forEach(([ch, color], i) => {
      const p = this.piece(group, this.glyphTexture(ch, color), (i - 2) * 3.04, LOGO_Z + (i % 2 ? 0.16 : -0.1), 2.78, yaws[i]);
      p.dealAt = this.opts.gate ? 0.15 + i * 0.09 : -1;
      this.logo.push(p);
    });
  }

  private halo: THREE.Mesh | null = null;
  private glint: THREE.PointLight | null = null;

  private hot(id: TitleHotId): Hot {
    const group = new THREE.Group();
    this.scene.add(group);
    const h: Hot = { id, group, pieces: [], props: [], box: new THREE.Box3(), glow: null, hover: 0, pressAt: -9, shakeAt: -9 };
    this.hots.set(id, h);
    return h;
  }

  private finishHot(h: Hot, pad = 0.35): void {
    const box = new THREE.Box3();
    for (const p of h.pieces) {
      const w = (TILE_W * p.scale) / 2;
      const d = (TILE_H * p.scale) / 2;
      box.expandByPoint(new THREE.Vector3(p.home.x - w, 0, p.home.z - d));
      box.expandByPoint(new THREE.Vector3(p.home.x + w, TILE_T * p.scale, p.home.z + d));
    }
    for (const o of h.props) box.expandByObject(o);
    box.expandByVector(new THREE.Vector3(pad, 0, pad));
    h.box.copy(box);
    // 指着的时候底下亮一片
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(size.x + 2.6, size.z + 2.6),
      new THREE.MeshBasicMaterial({ map: (this.glowTex ??= glowTexture()), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(center.x, 0.03, center.z);
    glow.renderOrder = 1;
    this.scene.add(glow);
    h.glow = glow;
  }

  private glowTex: THREE.CanvasTexture | null = null;

  // 四边的四排牌
  private buildMenu(): void {
    const S = 1.72;
    const R = seeded(71);
    const yaw = () => (R() - 0.5) * 0.07;
    // 东家（靠自己这边）：个人对局
    const single = this.hot('single');
    [...'个人对局'].forEach((ch, i) => {
      const p = this.piece(single.group, this.glyphTexture(ch, INK_RED), (i - 1.5) * 1.84, 12.05, S, yaw());
      p.from.set(p.home.x * 0.6, TILE_T * 2.4, WALL_Z);
      single.pieces.push(p);
    });
    // 南家（右边）：团体赛，从上往下读
    const team = this.hot('team');
    [...'团体赛'].forEach((ch, i) => {
      const p = this.piece(team.group, this.glyphTexture(ch, INK_BLUE), 12.05, (i - 1) * 2.44, S, yaw());
      p.from.set(WALL_Z, TILE_T * 2.4, p.home.z * 0.6);
      team.pieces.push(p);
    });
    // 北家（左边）：随机出场
    const random = this.hot('random');
    [...'随机出场'].forEach((ch, i) => {
      const p = this.piece(random.group, this.glyphTexture(ch, INK_GREEN), -12.05, (i - 1.5) * 2.44 - 0.6, S, yaw());
      p.from.set(-WALL_Z, TILE_T * 2.4, p.home.z * 0.6);
      random.pieces.push(p);
    });
    // 西家（对面）：全国大赛，扣着，贴一张封条
    const story = this.hot('story');
    for (let i = 0; i < 4; i++) {
      const p = this.piece(story.group, null, (i - 1.5) * 1.84, -12.05, S, yaw(), true);
      p.from.set(p.home.x * 0.6, TILE_T * 2.4, -WALL_Z);
      story.pieces.push(p);
    }
    const sealC = sealCanvas();
    const sealTex = canvasTexture(sealC, 8);
    this.repaint.push(() => {
      drawSeal(sealC);
      sealTex.needsUpdate = true;
    });
    const seal = new THREE.Mesh(new THREE.PlaneGeometry(8.6, 1.48), new THREE.MeshStandardMaterial({ map: sealTex, roughness: 0.9, transparent: true, opacity: 0 }));
    seal.rotation.set(-Math.PI / 2, 0, -0.05);
    seal.position.set(0, TILE_T * S + 0.02, -12.05);
    seal.receiveShadow = true;
    seal.userData.seal = true;
    story.group.add(seal);
    this.seal = seal;
    // 每排牌轮着发：一张隔一小会儿
    let order = 0;
    for (const h of [single, team, story, random]) {
      for (const p of h.pieces) p.dealAt = order++ * 0.055;
      this.finishHot(h);
    }
    this.dealSpan = order * 0.055 + 0.6;
  }

  private seal: THREE.Mesh | null = null;
  private dealSpan = 1.5;

  // 点棒、骰子、起家牌、坐垫、茶、便签
  private buildProps(): void {
    // 三根点棒 = 三个设置
    const ids: TitleHotId[] = ['match', 'visual', 'sound'];
    ids.forEach((id, i) => {
      const h = this.hot(id);
      const tex = canvasTexture(stickCanvas(i), 8);
      const side = new THREE.MeshStandardMaterial({ color: '#fbf9f0', roughness: 0.35, envMapIntensity: 0.8 });
      const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, envMapIntensity: 0.8 });
      const stick = new THREE.Mesh(new RoundedBoxGeometry(4.5, 0.2, 0.42, 3, 0.09), [side, side, top, side, side, side]);
      stick.position.set(11.45, 0.1, STICK_Z + i * STICK_GAP);
      stick.rotation.y = (i - 1) * -0.02;
      stick.castShadow = true;
      stick.receiveShadow = true;
      stick.userData.home = stick.position.clone();
      h.group.add(stick);
      h.props.push(stick);
      this.finishHot(h, 0.12);
      if (h.glow) h.glow.scale.set(1, 0.55, 1);
    });

    // 两颗骰子
    const dice = this.hot('dice');
    const geo = new RoundedBoxGeometry(1.02, 1.02, 1.02, 4, 0.16);
    const mats = DIE_FACES.map((v) => new THREE.MeshStandardMaterial({ map: diePips(v), roughness: 0.3, envMapIntensity: 0.9 }));
    [
      [-0.95, 4.55, 1, 0.4],
      [0.85, 4.75, 5, -0.25],
    ].forEach(([x, z, v, yaw]) => {
      const mesh = new THREE.Mesh(geo, mats);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.set(x, 0.51, z);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiply(new THREE.Quaternion().setFromEuler(DIE_UP[v]));
      mesh.quaternion.copy(q);
      dice.group.add(mesh);
      dice.props.push(mesh);
      this.dice.push({ mesh, home: mesh.position.clone(), from: q.clone(), to: q.clone(), axis: new THREE.Vector3(1, 0, 0), rollAt: -9 });
    });
    this.finishHot(dice, 0.3);

    // 起家牌
    const dealerC = dealerCanvas();
    const dealerTex = canvasTexture(dealerC, 8);
    this.repaint.push(() => {
      drawDealer(dealerC);
      dealerTex.needsUpdate = true;
    });
    const orange = new THREE.MeshStandardMaterial({ color: '#e07f26', roughness: 0.4 });
    const dealer = new THREE.Mesh(new RoundedBoxGeometry(2.3, 0.34, 1.58, 3, 0.12), [orange, orange, new THREE.MeshStandardMaterial({ map: dealerTex, roughness: 0.4 }), orange, orange, orange]);
    dealer.position.set(-5.75, 0.17, 12.08);
    dealer.rotation.y = 0.07;
    dealer.castShadow = true;
    dealer.receiveShadow = true;
    this.scene.add(dealer);

    // 四个坐垫
    const cloth = canvasTexture(cushionCanvas(), 4);
    cloth.wrapS = cloth.wrapT = THREE.RepeatWrapping;
    cloth.repeat.set(2, 2);
    const cushionMat = new THREE.MeshStandardMaterial({ map: cloth, roughness: 1, envMapIntensity: 0.1 });
    const cushionGeo = new RoundedBoxGeometry(13, 1.7, 13, 5, 0.85);
    const knot = new THREE.MeshStandardMaterial({ color: '#e0b860', roughness: 0.6 });
    for (let k = 0; k < 4; k++) {
      const c = new THREE.Mesh(cushionGeo, cushionMat);
      const d = F + FRAME_W + 8.2;
      c.position.set(0, -1.3 + 0.85, d).applyAxisAngle(new THREE.Vector3(0, 1, 0), (k * Math.PI) / 2);
      c.rotation.y = (k * Math.PI) / 2 + (k % 2 ? 0.05 : -0.04);
      c.castShadow = true;
      c.receiveShadow = true;
      this.scene.add(c);
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 10), knot);
      b.scale.y = 0.45;
      b.position.copy(c.position).setY(-1.3 + 1.72);
      this.scene.add(b);
    }

    // 茶盘、茶杯
    const tray = new THREE.Group();
    const lacquer = new THREE.MeshStandardMaterial({ color: '#2a1410', roughness: 0.25, envMapIntensity: 1.1 });
    const board = new THREE.Mesh(new RoundedBoxGeometry(6.6, 0.4, 5, 3, 0.18), lacquer);
    board.castShadow = true;
    board.receiveShadow = true;
    tray.add(board);
    const cupMat = new THREE.MeshStandardMaterial({ color: '#f1ece0', roughness: 0.35, envMapIntensity: 0.9, side: THREE.DoubleSide });
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.02, 1.9, 32, 1, true), cupMat);
    cup.position.set(-0.9, 1.15, 0.2);
    cup.castShadow = true;
    const cupBase = new THREE.Mesh(new THREE.CylinderGeometry(1.02, 1.02, 0.12, 32), cupMat);
    cupBase.position.set(-0.9, 0.26, 0.2);
    const tea = new THREE.Mesh(new THREE.CircleGeometry(1.17, 32), new THREE.MeshStandardMaterial({ color: '#8fae4a', roughness: 0.12, envMapIntensity: 1.4 }));
    tea.rotation.x = -Math.PI / 2;
    tea.position.set(-0.9, 1.72, 0.2);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.12, 0.3, 32, 1, true), new THREE.MeshStandardMaterial({ color: '#3d6a8a', roughness: 0.4 }));
    band.position.set(-0.9, 1.35, 0.2);
    tray.add(cup, cupBase, tea, band);
    // 三颗团子
    const dango = ['#f4b6c6', '#fbf7ea', '#a9cf7a'];
    dango.forEach((color, i) => {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.46, 20, 14), new THREE.MeshStandardMaterial({ color, roughness: 0.55 }));
      ball.position.set(1.15 + i * 0.84, 0.66, 0.5 - i * 0.22);
      ball.castShadow = true;
      tray.add(ball);
    });
    const skewer = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.6, 8), new THREE.MeshStandardMaterial({ color: '#c9a56a', roughness: 0.7 }));
    skewer.rotation.set(0, Math.atan2(0.22, 0.84), Math.PI / 2);
    skewer.position.set(1.15 + 0.84 + 0.35, 0.66, 0.5 - 0.22 - 0.09);
    tray.add(skewer);
    // 茶杯上飘着的热气
    const puff = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const ctx = c.getContext('2d')!;
      const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
      return canvasTexture(c, 1);
    })();
    for (let i = 0; i < 4; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, transparent: true, opacity: 0, depthWrite: false }));
      sp.position.set(-0.9, 1.9, 0.2);
      tray.add(sp);
      this.steam.push(sp);
    }
    tray.position.set(-(F + FRAME_W + 5.2), -1.3 + 0.2, -12.4);
    tray.rotation.y = -0.16;
    this.scene.add(tray);

    // 便签
    const noteC = noteCanvas(this.opts.back);
    const noteTex = canvasTexture(noteC, 8);
    this.repaint.push(() => {
      drawNote(noteC, this.opts.back);
      noteTex.needsUpdate = true;
    });
    const note = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 5.6), new THREE.MeshStandardMaterial({ map: noteTex, roughness: 0.9, transparent: true, alphaTest: 0.05 }));
    note.rotation.set(-Math.PI / 2, 0, -0.1);
    note.position.set(F + FRAME_W + 5.4, -1.3 + 0.04, -12.2);
    note.receiveShadow = true;
    this.scene.add(note);
  }

  // ---------- 镜头 ----------

  private resize(): void {
    const host = this.canvas.parentElement;
    const w = Math.max(1, host?.clientWidth ?? this.canvas.clientWidth);
    const h = Math.max(1, host?.clientHeight ?? this.canvas.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // 从斜上方往下看：找一个刚好把四排牌都装进画面的距离
    const dir = new THREE.Vector3(0, Math.cos(0.5), Math.sin(0.5));
    const fit = (look: THREE.Vector3, pts: THREE.Vector3[], mx: number, top: number, bottom: number): THREE.Vector3 => {
      let lo = 12;
      let hi = 260;
      const pos = new THREE.Vector3();
      for (let i = 0; i < 26; i++) {
        const d = (lo + hi) / 2;
        pos.copy(look).addScaledVector(dir, d);
        this.camera.position.copy(pos);
        this.camera.lookAt(look);
        this.camera.updateMatrixWorld();
        const ok = pts.every((p) => {
          const n = p.clone().project(this.camera);
          return Math.abs(n.x) <= mx && n.y <= top && n.y >= -bottom;
        });
        if (ok) hi = d;
        else lo = d;
      }
      return pos.copy(look).addScaledVector(dir, hi);
    };
    // 整张桌子（连桌框）都要在画面里；上下留的边一样多
    // 竖屏（手机）：宽度不够，只保证桌布上的东西都在，桌框两边可以出画
    const o = w < h * 0.8 ? F - 0.5 : F + FRAME_W;
    const box = [
      new THREE.Vector3(-o, FRAME_UP, -o),
      new THREE.Vector3(o, FRAME_UP, -o),
      new THREE.Vector3(-o, FRAME_UP, o),
      new THREE.Vector3(o, FRAME_UP, o),
      new THREE.Vector3(-o, -1.3, o),
      new THREE.Vector3(o, -1.3, o),
    ];
    let zLo = -6;
    let zHi = 6;
    for (let i = 0; i < 14; i++) {
      this.camFar.look.set(0, 0, (zLo + zHi) / 2);
      this.camFar.pos.copy(fit(this.camFar.look, box, w < h * 0.8 ? 1 : 0.97, 0.955, 0.955));
      this.camera.position.copy(this.camFar.pos);
      this.camera.lookAt(this.camFar.look);
      this.camera.updateMatrixWorld();
      let hi = -Infinity;
      let lo = Infinity;
      for (const p of box) {
        const y = p.clone().project(this.camera).y;
        hi = Math.max(hi, y);
        lo = Math.min(lo, y);
      }
      // 上面空得多：往下看一点（桌子在画面里往上挪）
      if (1 - hi > lo + 1) zLo = this.camFar.look.z;
      else zHi = this.camFar.look.z;
    }
    // 开场：只看 logo 那五张牌
    const lg = [new THREE.Vector3(-8.9, 0, -5.8), new THREE.Vector3(8.9, 0, -5.8), new THREE.Vector3(-8.9, 2, 4.2), new THREE.Vector3(8.9, 2, 4.2)];
    this.camNear.look.set(0, 0, -1.2);
    this.camNear.pos.copy(fit(this.camNear.look, lg, 0.86, 0.5, 0.62));
    this.placeCamera();
  }

  private placeCamera(): void {
    const k = easeInOut(this.zoom);
    const pos = this.camNear.pos.clone().lerp(this.camFar.pos, k);
    const look = this.camNear.look.clone().lerp(this.camFar.look, k);
    // 跟着鼠标轻轻晃一点
    pos.x += this.sway.x * 0.9;
    pos.z += this.sway.y * 0.7;
    this.camera.position.copy(pos);
    this.camera.lookAt(look);
    this.camera.updateMatrixWorld();
  }

  // ---------- 对外 ----------

  // 点了开始：镜头拉开，发牌
  open(): void {
    if (this.openAt !== Infinity) return;
    this.openAt = this.t;
    // 牌山还没升完：一下子升好
    if (this.walls && !this.walls.done) this.walls.at = this.walls.at.map((a) => Math.min(a, this.t - 0.3));
  }

  setHover(id: TitleHotId | null): void {
    this.hovered = id;
  }

  // 点了一块：牌跳一下再落桌
  press(id: TitleHotId): void {
    const h = this.hots.get(id);
    if (h) h.pressAt = this.t;
    if (id === 'random') this.roll();
  }

  // 锁着的那块：晃一晃
  shake(id: TitleHotId): void {
    const h = this.hots.get(id);
    if (h) h.shakeAt = this.t;
  }

  // 掷骰子
  roll(): void {
    this.dice.forEach((d, i) => {
      const v = 1 + Math.floor(Math.random() * 6);
      d.from.copy(d.mesh.quaternion);
      d.to.copy(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 1.6).multiply(new THREE.Quaternion().setFromEuler(DIE_UP[v])));
      d.axis.set(Math.random() - 0.5, Math.random() * 0.4, Math.random() - 0.5).normalize();
      d.rollAt = this.t + i * 0.07;
    });
    this.nextIdleRoll = this.t + 9 + Math.random() * 6;
  }

  dispose(): void {
    if (this.dead) return;
    this.dead = true;
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    window.removeEventListener('pointermove', this.onMove);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) {
        (mat as THREE.MeshStandardMaterial).map?.dispose?.();
        mat.dispose?.();
      }
    });
    this.scene.environment?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  // ---------- 每一帧 ----------

  private loop = (): void => {
    if (this.dead) return;
    // 画布被换掉了（离开主页）：收摊
    if (!this.canvas.isConnected) {
      this.dispose();
      return;
    }
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.2, this.clock.getDelta());
    this.t += dt;
    this.update(dt);
    this.renderer.render(this.scene, this.camera);
    this.reportRects();
  };

  private update(dt: number): void {
    const t = this.t;
    this.updateWalls();
    const opened = this.openAt !== Infinity;
    const since = t - this.openAt;
    const calm = this.calm;
    if (opened && this.zoom < 1) this.zoom = calm ? 1 : Math.min(1, this.zoom + dt / 1.25);
    if (!calm) {
      this.sway.x += (this.pointer.x - this.sway.x) * Math.min(1, dt * 2.2);
      this.sway.y += (this.pointer.y - this.sway.y) * Math.min(1, dt * 2.2);
    }
    this.steam.forEach((sp, i) => {
      const k = (t * 0.28 + i / this.steam.length) % 1;
      sp.position.set(-0.9 + Math.sin(k * 5 + i * 2.1) * 0.35, 1.9 + k * 3.2, 0.2 - k * 0.6);
      sp.scale.setScalar(0.9 + k * 1.6);
      sp.material.opacity = calm ? 0 : Math.sin(k * Math.PI) * 0.3;
    });
    this.placeCamera();

    // logo：开场从上面掉下来弹一下，之后一张张轻轻起伏
    this.logo.forEach((p, i) => {
      const k = calm ? 1 : clamp01((t - p.dealAt) / 0.55);
      const drop = (1 - ease(k)) * 16;
      const bounce = Math.abs(Math.sin(k * Math.PI * 2)) * (1 - k) * 1.3;
      const bob = calm ? 0 : Math.sin(t * 1.25 + i * 0.9) * 0.07;
      p.pivot.position.set(p.home.x, p.home.y + drop + bounce + 0.1 + bob, p.home.z);
      p.inner.rotation.set(-Math.PI / 2 + Math.sin(t * 0.9 + i * 1.3) * 0.02 + 0.06, 0, Math.sin(t * 1.1 + i) * 0.012);
      p.pivot.visible = calm || t >= p.dealAt;
    });

    if (this.halo) (this.halo.material as THREE.MeshBasicMaterial).opacity = 0.26 + Math.sin(t * 1.1) * 0.07;
    if (this.glint) {
      // 每 6.5 秒扫一次，一次 1.5 秒
      const k = ((t + 4.6) % 6.5) / 1.5;
      this.glint.intensity = k < 1 && !calm ? Math.sin(k * Math.PI) * 26 : 0;
      this.glint.position.x = -11 + k * 22;
    }

    // 四排牌
    for (const h of this.hots.values()) {
      const target = opened && this.hovered === h.id && (calm || since > this.dealSpan * 0.6) ? 1 : 0;
      h.hover += (target - h.hover) * Math.min(1, dt * 12);
      const lock = h.id === 'story';
      const hv = lock ? h.hover * 0.25 : h.hover;
      const press = t - h.pressAt;
      const shake = t - h.shakeAt;
      h.group.position.x = shake < 0.45 ? Math.sin(shake * 46) * 0.16 * (1 - shake / 0.45) : 0;
      h.pieces.forEach((p, i) => {
        const k = opened ? (calm ? 1 : clamp01((since - p.dealAt) / 0.5)) : 0;
        p.pivot.visible = opened && (calm || since >= p.dealAt);
        const e = ease(k);
        const pos = p.from.clone().lerp(p.home, e);
        pos.y += Math.sin(k * Math.PI) * 2.6;
        if (k >= 1 && !p.landed) {
          p.landed = true;
          if (i % 2 === 0) this.opts.onClack();
        }
        // 点了：一张接一张跳起来
        const pp = press - i * 0.04;
        if (pp > 0 && pp < 0.32) pos.y += Math.sin((pp / 0.32) * Math.PI) * 1.5;
        pos.y += hv * 1.0;
        p.pivot.position.copy(pos);
        // 发牌时从扣着翻成正面朝上；指着时朝镜头抬起来一点
        const flip = p.down ? Math.PI / 2 : Math.PI / 2 - e * Math.PI;
        p.inner.rotation.x = flip + (p.down ? -hv * 0.3 : hv * 0.42);
        p.inner.scale.setScalar(p.scale * (1 + hv * 0.05));
      });
      for (const o of h.props) {
        if (h.id === 'dice') continue;
        const home = o.userData.home as THREE.Vector3;
        const k = opened ? (calm ? 1 : clamp01((since - this.dealSpan * 0.55) / 0.4)) : 0;
        o.visible = k > 0;
        const pp = press;
        const hop = pp > 0 && pp < 0.3 ? Math.sin((pp / 0.3) * Math.PI) * 0.9 : 0;
        o.position.set(home.x + (1 - ease(k)) * 5, home.y + hv * 0.55 + hop, home.z);
        o.rotation.x = hv * -0.5;
      }
      if (h.glow) (h.glow.material as THREE.MeshBasicMaterial).opacity = (lock ? 0.3 : 1) * h.hover;
    }
    if (this.seal) {
      const k = opened ? (calm ? 1 : clamp01((since - this.dealSpan + 0.25) / 0.3)) : 0;
      (this.seal.material as THREE.MeshStandardMaterial).opacity = k;
      this.seal.visible = k > 0;
      const story = this.hots.get('story');
      this.seal.position.y = TILE_T * 1.72 + 0.02 + (story ? story.hover * 0.2 : 0) + (1 - ease(k)) * 1.2;
    }

    // 骰子：隔一阵自己跳一下
    const diceHot = this.hots.get('dice');
    const diceIn = opened && (calm || since > 0.75);
    if (diceIn && !this.diceThrown) {
      this.diceThrown = true;
      if (!calm) this.roll();
    }
    if (opened && !calm && t > this.nextIdleRoll && since > 3) this.roll();
    for (const d of this.dice) {
      const k = clamp01((t - d.rollAt) / 0.85);
      const hv = diceHot ? diceHot.hover : 0;
      if (k < 1 && t >= d.rollAt) {
        const bounce = Math.sin(Math.min(1, k * 1.6) * Math.PI) * 2.4 + Math.abs(Math.sin(k * Math.PI * 3)) * (1 - k) * 0.5;
        d.mesh.position.set(d.home.x, d.home.y + bounce, d.home.z);
        const spin = new THREE.Quaternion().setFromAxisAngle(d.axis, (1 - k) * (1 - k) * 15);
        d.mesh.quaternion.copy(spin.multiply(d.from.clone().slerp(d.to, ease(k))));
      } else {
        d.mesh.position.set(d.home.x, d.home.y + hv * 0.35, d.home.z);
      }
      d.mesh.visible = diceIn;
    }
  }

  private steam: THREE.Sprite[] = [];
  private diceThrown = false;
  // 系统里开了「减少动态效果」：不推镜头、不发牌、不晃，直接摆好
  private calm = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private rects = new Map<TitleHotId, { x: number; y: number; w: number; h: number }>();

  private reportRects(): void {
    const w = this.canvas.clientWidth;
    const hgt = this.canvas.clientHeight;
    const v = new THREE.Vector3();
    for (const h of this.hots.values()) {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      const b = h.box;
      for (let i = 0; i < 8; i++) {
        v.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(this.camera);
        const sx = (v.x * 0.5 + 0.5) * w;
        const sy = (-v.y * 0.5 + 0.5) * hgt;
        x0 = Math.min(x0, sx);
        y0 = Math.min(y0, sy);
        x1 = Math.max(x1, sx);
        y1 = Math.max(y1, sy);
      }
      this.rects.set(h.id, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
    this.opts.onRects(this.rects);
  }
}
