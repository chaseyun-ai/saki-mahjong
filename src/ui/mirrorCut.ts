import './mirrorCut.css';

// 宫永照的照魔镜：第一局打完、第二局开始之前放的一段全屏演出，三种视角共用（画在盖住整个页面的一张 canvas 上）。
// 照着原作那一段的三拍来：
//   1. 裂地：紫色的地面裂开，石板一块块崩飞，底下露出一面巨大的镜子（暗绿的镜面、深色的镜缘）
//   2. 碎裂：画面一黑，带红边的碎片从一点朝四周炸开
//   3. 镜中人：另外三家各站在一面大镜子前，背后是红光，脚下翻着红色的云
// 全是现画的（地面、镜子、碎片、云），人用头像框里那张图：抠好的半身像站在镜子前面，方图就照进镜子里。
// 只是画面效果：点一下可以跳过；开始淡出（或跳过）时调 onDone，牌局往下走，下一局的牌桌在它底下露出来。

// 三拍各多少毫秒，最后淡出
export const MIRROR_CUT = { crack: 1050, shatter: 600, reveal: 1900, fade: 320 } as const;
export const MIRROR_CUT_MS = MIRROR_CUT.crack + MIRROR_CUT.shatter + MIRROR_CUT.reveal + MIRROR_CUT.fade;
// 系统设了“减少动态效果”：只把最后那一幅定住放一会儿
export const MIRROR_CUT_STILL_MS = 1100;

export type MirrorBeat = 'crack' | 'shatter' | 'reveal' | 'fade' | 'done';

// 放到第 ms 毫秒是哪一拍、这一拍走了多少（0–1）
export function mirrorBeat(ms: number): { beat: MirrorBeat; t: number } {
  let left = Math.max(0, ms);
  for (const beat of ['crack', 'shatter', 'reveal', 'fade'] as const) {
    if (left < MIRROR_CUT[beat]) return { beat, t: left / MIRROR_CUT[beat] };
    left -= MIRROR_CUT[beat];
  }
  return { beat: 'done', t: 1 };
}

export interface MirrorTarget {
  name: string;
  url: string; // 头像图，没有就是空字符串（画名字的最后一个字）
  glyph: string;
}

// 固定种子的随机数：每次放都是同一套石板、同一套碎片
export function mirrorRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Pt = [number, number];

// 盖在镜子上的一块石板。坐标按镜子算：镜面是单位圆，圆心 (0,0)
export interface MirrorSlab {
  pts: Pt[];
  cx: number;
  cy: number;
  over: boolean; // 压在镜面上（会崩开）；镜子外面的地面不动
  breakAt: number; // 裂地这一拍走到多少（0–1）时崩开
  dx: number; // 崩飞的方向（单位向量）
  dy: number;
  spin: number; // 崩飞时转多少（弧度）
}

// 最先裂开的地方（镜面坐标），裂缝从这里朝四周传开
const EPICENTRE: Pt = [0.12, 0.18];
const SLAB_COLS = 9;
const SLAB_ROWS = 8;
const SLAB_SPAN = 1.3; // 石板铺到镜面外多远
// 最后一块石板在这一拍走到多少之前崩开（后面留一点时间看镜子）
export const SLABS_GONE = 0.86;

// 把镜子上方那片地面切成不规整的石板：一张抖过的网格，有的格子再斜着劈成两块三角
export function mirrorSlabs(seed = 7): MirrorSlab[] {
  const rnd = mirrorRng(seed);
  const vx: number[][] = [];
  const vy: number[][] = [];
  const cw = (SLAB_SPAN * 2) / SLAB_COLS;
  const ch = (SLAB_SPAN * 2) / SLAB_ROWS;
  for (let j = 0; j <= SLAB_ROWS; j++) {
    vx.push([]);
    vy.push([]);
    for (let i = 0; i <= SLAB_COLS; i++) {
      vx[j].push(-SLAB_SPAN + i * cw + (rnd() - 0.5) * cw * 0.62);
      vy[j].push(-SLAB_SPAN + j * ch + (rnd() - 0.5) * ch * 0.62);
    }
  }
  const out: MirrorSlab[] = [];
  const add = (pts: Pt[]) => {
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const over = Math.hypot(cx, cy) < 1.07;
    const ex = cx - EPICENTRE[0];
    const ey = cy - EPICENTRE[1];
    const d = Math.hypot(ex, ey);
    const far = Math.min(1, d / 1.25);
    const a = Math.atan2(ey, ex) + (rnd() - 0.5) * 0.9;
    out.push({
      pts,
      cx,
      cy,
      over,
      breakAt: Math.min(SLABS_GONE, 0.14 + 0.6 * far + rnd() * 0.1),
      dx: d < 0.05 ? 0 : Math.cos(a),
      dy: d < 0.05 ? -1 : Math.sin(a),
      spin: (rnd() - 0.5) * 1.5,
    });
  };
  for (let j = 0; j < SLAB_ROWS; j++) {
    for (let i = 0; i < SLAB_COLS; i++) {
      const q: Pt[] = [
        [vx[j][i], vy[j][i]],
        [vx[j][i + 1], vy[j][i + 1]],
        [vx[j + 1][i + 1], vy[j + 1][i + 1]],
        [vx[j + 1][i], vy[j + 1][i]],
      ];
      const r = rnd();
      if (r < 0.2) {
        add([q[0], q[1], q[2]]);
        add([q[0], q[2], q[3]]);
      } else if (r < 0.4) {
        add([q[0], q[1], q[3]]);
        add([q[1], q[2], q[3]]);
      } else add(q);
    }
  }
  return out;
}

// 碎裂那一拍的一片碎片：从中心朝 angle 方向，r0 到 r1（按画面短边算），最宽处 width；big 的是蓝灰的芯子镶红边，小的整片是红的
export interface MirrorShard {
  angle: number;
  r0: number;
  r1: number;
  width: number;
  big: boolean;
  jag: number[]; // 两条边上的锯齿（每个点往外、往里错开多少，-1–1）
}

export function mirrorShards(seed: number, n = 44): MirrorShard[] {
  const rnd = mirrorRng(seed);
  const out: MirrorShard[] = [];
  for (let i = 0; i < n; i++) {
    const big = rnd() < 0.3;
    const r0 = 0.015 + rnd() * (big ? 0.16 : 0.5);
    const len = big ? 0.45 + rnd() * 0.9 : 0.14 + rnd() * 0.7;
    out.push({
      // 大致均匀地绕一圈，再错开一点
      angle: ((i + rnd() * 0.9) / n) * Math.PI * 2,
      r0,
      r1: r0 + len,
      width: big ? 0.014 + rnd() * 0.03 : 0.003 + rnd() * 0.008,
      big,
      jag: Array.from({ length: 12 }, () => rnd() * 2 - 1),
    });
  }
  return out;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOut = (x: number) => 1 - (1 - clamp01(x)) ** 3;
const easeIn = (x: number) => clamp01(x) ** 3;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return [c, c.getContext('2d')!];
}

// ---------- 紫色的地面 ----------

const GROUND_W = 1280;
const GROUND_H = 800;

function paintGround(): HTMLCanvasElement {
  const [c, x] = makeCanvas(GROUND_W, GROUND_H);
  const rnd = mirrorRng(11);
  const base = x.createLinearGradient(0, 0, GROUND_W, GROUND_H);
  base.addColorStop(0, '#6a27d9');
  base.addColorStop(0.45, '#7c2ee6');
  base.addColorStop(1, '#5320c9');
  x.fillStyle = base;
  x.fillRect(0, 0, GROUND_W, GROUND_H);
  // 一块块深浅：偏蓝的暗处、偏粉的亮处
  const blob = (col: string, n: number, r0: number, r1: number) => {
    for (let i = 0; i < n; i++) {
      const bx = rnd() * GROUND_W;
      const by = rnd() * GROUND_H;
      const r = r0 + rnd() * (r1 - r0);
      const g = x.createRadialGradient(bx, by, 0, bx, by, r);
      g.addColorStop(0, col);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g;
      x.beginPath();
      x.ellipse(bx, by, r, r * (0.45 + rnd() * 0.5), rnd() * Math.PI, 0, Math.PI * 2);
      x.fill();
    }
  };
  blob('rgba(52,34,210,0.55)', 16, 90, 260);
  blob('rgba(160,70,255,0.34)', 26, 50, 170);
  blob('rgba(38,14,140,0.4)', 22, 30, 120);
  blob('rgba(190,96,255,0.22)', 60, 10, 46);
  // 石头的颗粒
  for (let i = 0; i < 5200; i++) {
    x.fillStyle = rnd() < 0.5 ? `rgba(34,12,120,${(0.1 + rnd() * 0.22).toFixed(2)})` : `rgba(196,120,255,${(0.06 + rnd() * 0.16).toFixed(2)})`;
    const s = 1 + rnd() * 3.2;
    x.fillRect(rnd() * GROUND_W, rnd() * GROUND_H, s, s * (0.5 + rnd()));
  }
  // 石头的棱：几块颜色略深略浅的多边形
  for (let i = 0; i < 46; i++) {
    const px = rnd() * GROUND_W;
    const py = rnd() * GROUND_H;
    const r = 26 + rnd() * 90;
    const n = 4 + Math.floor(rnd() * 3);
    const a0 = rnd() * Math.PI;
    x.beginPath();
    for (let k = 0; k < n; k++) {
      const a = a0 + (k / n) * Math.PI * 2;
      const rr = r * (0.6 + rnd() * 0.5);
      x[k ? 'lineTo' : 'moveTo'](px + Math.cos(a) * rr, py + Math.sin(a) * rr * 0.7);
    }
    x.closePath();
    x.fillStyle = rnd() < 0.5 ? 'rgba(150,72,255,0.16)' : 'rgba(40,18,150,0.2)';
    x.fill();
    x.strokeStyle = 'rgba(28,8,96,0.5)';
    x.lineWidth = 1.2;
    x.stroke();
  }
  // 地上本来就有的细裂纹
  x.lineCap = 'round';
  x.lineJoin = 'round';
  for (let i = 0; i < 70; i++) {
    let px = rnd() * GROUND_W;
    let py = rnd() * GROUND_H;
    let a = rnd() * Math.PI * 2;
    x.beginPath();
    x.moveTo(px, py);
    const steps = 3 + Math.floor(rnd() * 5);
    for (let k = 0; k < steps; k++) {
      a += (rnd() - 0.5) * 1.5;
      const l = 12 + rnd() * 36;
      px += Math.cos(a) * l;
      py += Math.sin(a) * l;
      x.lineTo(px, py);
    }
    x.strokeStyle = `rgba(26,6,92,${(0.45 + rnd() * 0.4).toFixed(2)})`;
    x.lineWidth = 0.9 + rnd() * 1.3;
    x.stroke();
  }
  return c;
}

// ---------- 红色的云（祥云那种一团团带卷的） ----------

function paintClouds(w: number, h: number, seed: number, front: boolean): HTMLCanvasElement {
  const [c, x] = makeCanvas(w, h);
  const rnd = mirrorRng(seed);
  const lumps: { x: number; y: number; r: number }[] = [];
  // 上面一排小的定出云的轮廓，下面两排大的把里面填满
  for (let px = -h * 0.2; px < w + h * 0.2; ) {
    const r = h * (0.13 + rnd() * 0.15);
    lumps.push({ x: px, y: h * (0.34 + rnd() * 0.2) + (Math.sin(px / (h * 0.9)) + 1) * h * 0.06, r });
    px += r * (0.9 + rnd() * 0.5);
  }
  for (let px = -h * 0.2; px < w + h * 0.2; ) {
    const r = h * (0.2 + rnd() * 0.16);
    lumps.push({ x: px, y: h * (0.62 + rnd() * 0.16), r });
    px += r * (0.8 + rnd() * 0.5);
  }
  const edge = Math.max(2, h * 0.014);
  // 先用边的颜色把每一团画大一圈，再用云的颜色盖上：只有最外面一圈留着边
  x.fillStyle = front ? '#ff3a55' : '#b3214a';
  x.shadowColor = front ? 'rgba(255,60,90,0.9)' : 'rgba(200,30,80,0.6)';
  x.shadowBlur = h * 0.05;
  for (const l of lumps) {
    x.beginPath();
    x.arc(l.x, l.y, l.r + edge, 0, Math.PI * 2);
    x.fill();
  }
  x.shadowBlur = 0;
  const body = x.createLinearGradient(0, h * 0.2, 0, h);
  if (front) {
    body.addColorStop(0, '#7a1a44');
    body.addColorStop(0.5, '#b01c3e');
    body.addColorStop(1, '#f0405a');
  } else {
    body.addColorStop(0, '#4a1238');
    body.addColorStop(0.6, '#7a1640');
    body.addColorStop(1, '#a81c40');
  }
  x.fillStyle = body;
  for (const l of lumps) {
    x.beginPath();
    x.arc(l.x, l.y, l.r, 0, Math.PI * 2);
    x.fill();
  }
  x.fillRect(0, h * 0.78, w, h * 0.22);
  // 每一团里卷一个旋
  x.lineCap = 'round';
  x.strokeStyle = front ? 'rgba(255,92,118,0.62)' : 'rgba(196,48,96,0.5)';
  for (const l of lumps) {
    if (l.r < h * 0.15) continue;
    const dir = rnd() < 0.5 ? 1 : -1;
    const a0 = rnd() * Math.PI * 2;
    x.lineWidth = Math.max(1.5, l.r * 0.07);
    x.beginPath();
    for (let k = 0; k <= 40; k++) {
      const u = k / 40;
      const a = a0 + dir * u * Math.PI * 2.6;
      const rr = l.r * (0.74 - 0.62 * u);
      x[k ? 'lineTo' : 'moveTo'](l.x + Math.cos(a) * rr, l.y + Math.sin(a) * rr);
    }
    x.stroke();
  }
  return c;
}

// ---------- 画面 ----------

interface Face {
  target: MirrorTarget;
  img: HTMLImageElement | null;
  ready: boolean;
  cutout: boolean; // 抠好的图（四角透明）：人站在镜子前面；不然照进镜子里
  sprite: HTMLCanvasElement | null;
  spriteFor: boolean; // sprite 是按图已经读好时画的
}

// 图的四角是不是透明的（读不了像素就当不是）
function isCutout(img: HTMLImageElement): boolean {
  try {
    const x = makeCanvas(16, 16)[1];
    x.drawImage(img, 0, 0, 16, 16);
    const d = x.getImageData(0, 0, 16, 16).data;
    // 最上面一行和左右两边的上半截大半是透明的，就是抠好的
    const edge = [...Array.from({ length: 16 }, (_, i) => i), ...Array.from({ length: 8 }, (_, j) => j * 16), ...Array.from({ length: 8 }, (_, j) => j * 16 + 15)];
    return edge.filter((i) => d[i * 4 + 3] < 40).length > edge.length * 0.6;
  } catch {
    return false;
  }
}

class MirrorCut {
  private el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private start = performance.now();
  private raf = 0;
  private timer = 0;
  private over = false;
  private released = false;
  private beatSeen: MirrorBeat | null = null;
  private ground = paintGround();
  private groundPattern: CanvasPattern | null = null;
  private slabs = mirrorSlabs();
  private slabPts: Pt[][] = [];
  private slabAt: Pt[] = [];
  private shardSets = [mirrorShards(3), mirrorShards(17), mirrorShards(29)];
  private cloudBack: HTMLCanvasElement | null = null;
  private cloudFront: HTMLCanvasElement | null = null;
  private faces: Face[];
  private still: boolean;
  // 镜子在裂地那一拍的位置：圆心、两个半径、转多少
  private m = { cx: 0, cy: 0, rx: 0, ry: 0, rot: 0 };

  constructor(
    targets: MirrorTarget[],
    private word: string,
    private onBeat: (beat: MirrorBeat) => void,
    private onDone: () => void,
  ) {
    this.still = reduced();
    this.el = document.createElement('div');
    this.el.className = 'mirror-cut';
    this.canvas = document.createElement('canvas');
    this.el.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.faces = targets.map((target) => {
      const f: Face = { target, img: null, ready: false, cutout: false, sprite: null, spriteFor: false };
      if (target.url) {
        const img = new Image();
        img.onload = () => {
          f.ready = true;
          f.cutout = isCutout(img);
        };
        img.onerror = () => (f.img = null);
        img.src = target.url;
        f.img = img;
      }
      return f;
    });
    document.body.appendChild(this.el);
    this.layout();
    // 点一下跳过：直接淡出
    this.el.addEventListener('pointerdown', () => this.skip());
    const total = this.still ? MIRROR_CUT_STILL_MS + MIRROR_CUT.fade : MIRROR_CUT_MS;
    // 页面在后台时不出帧：到点了照样收场，牌局不会卡住
    this.timer = window.setTimeout(() => this.finish(), total + 80);
    this.raf = requestAnimationFrame(this.frame);
  }

  private layout(): void {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    // 大屏幕上不按满分辨率画：最多两百多万像素
    const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(2_400_000 / (w * h)));
    this.w = w;
    this.h = h;
    this.dpr = Math.max(0.5, dpr);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    const D = Math.max(w, h * 1.5);
    this.m = { cx: w * 0.4, cy: h * 0.2, rx: D * 0.56, ry: D * 0.37, rot: 0.6 };
    const { cx, cy, rx, ry, rot } = this.m;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const at = (p: Pt): Pt => [cx + p[0] * rx * cos - p[1] * ry * sin, cy + p[0] * rx * sin + p[1] * ry * cos];
    this.slabPts = this.slabs.map((s) => s.pts.map(at));
    this.slabAt = this.slabs.map((s) => at([s.cx, s.cy]));
    this.groundPattern = null;
    this.cloudBack = this.cloudFront = null;
    for (const f of this.faces) f.sprite = null;
  }

  private skip(): void {
    if (this.over) return;
    const now = performance.now();
    const fadeFrom = (this.still ? MIRROR_CUT_STILL_MS : MIRROR_CUT_MS - MIRROR_CUT.fade) - 1;
    if (now - this.start >= fadeFrom) return;
    this.start = now - fadeFrom;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.finish(), MIRROR_CUT.fade + 80);
  }

  // 开始淡出：牌局可以往下走了（只叫一次）
  private release(): void {
    if (this.released) return;
    this.released = true;
    this.onDone();
  }

  private finish(): void {
    if (this.over) return;
    this.over = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timer);
    this.el.remove();
    this.release();
  }

  // 提前收掉（牌桌被换掉了）：不调 onDone
  cancel(): void {
    this.over = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timer);
    this.el.remove();
  }

  private frame = (now: number): void => {
    if (this.over) return;
    if (window.innerWidth !== this.w || window.innerHeight !== this.h) this.layout();
    let ms = now - this.start;
    // 减少动态效果：直接定在最后那一幅
    if (this.still) ms = ms < MIRROR_CUT_STILL_MS ? MIRROR_CUT.crack + MIRROR_CUT.shatter + MIRROR_CUT.reveal - 1 : MIRROR_CUT_MS - MIRROR_CUT.fade + (ms - MIRROR_CUT_STILL_MS);
    const { beat, t } = mirrorBeat(ms);
    if (beat === 'done') {
      this.finish();
      return;
    }
    if (beat !== this.beatSeen) {
      this.beatSeen = beat;
      if (!this.still || beat === 'reveal') this.onBeat(beat);
      if (beat === 'fade') this.release();
    }
    if (this.over) return;
    const x = this.ctx;
    x.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'source-over';
    x.clearRect(0, 0, this.w, this.h);
    if (beat === 'crack') this.drawCrack(t);
    else if (beat === 'shatter') this.drawShatter(t);
    else {
      this.drawReveal(beat === 'fade' ? 1 : t, beat === 'fade' ? t : 0);
      this.el.style.opacity = beat === 'fade' ? (1 - t).toFixed(3) : '1';
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  // ----- 第一拍：裂地 -----

  private pattern(): CanvasPattern | null {
    if (this.groundPattern) return this.groundPattern;
    const p = this.ctx.createPattern(this.ground, 'repeat');
    if (!p) return null;
    const s = this.groundScale();
    p.setTransform?.(new DOMMatrix([s, 0, 0, s, -this.w * 0.15, -this.h * 0.15]));
    this.groundPattern = p;
    return p;
  }

  // 地面那张图铺满画面（四周多出 15%，镜头转、晃的时候不露边）要放大多少
  private groundScale(): number {
    return Math.max((this.w * 1.3) / GROUND_W, (this.h * 1.3) / GROUND_H);
  }

  private path(pts: Pt[]): void {
    const x = this.ctx;
    x.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) x.lineTo(pts[i][0], pts[i][1]);
    x.closePath();
  }

  private drawCrack(t: number): void {
    const x = this.ctx;
    const { w, h } = this;
    const { cx, cy, rx, ry, rot } = this.m;
    const pat = this.pattern();
    x.save();
    // 镜头：慢慢推近、转一点；一裂开就抖；最后猛地冲进去
    const rush = easeIn((t - 0.88) / 0.12);
    const zoom = 1.04 + 0.12 * t + 0.28 * rush;
    const shake = (t > 0.1 ? 1 : 0) * (1 - t * 0.5) * Math.min(w, h) * 0.006;
    const jx = Math.sin(t * 91) * shake;
    const jy = Math.cos(t * 77) * shake;
    x.translate(w * 0.5 + jx, h * 0.52 + jy);
    x.rotate(-0.05 + 0.06 * t);
    x.scale(zoom, zoom);
    x.translate(-w * 0.5, -h * 0.52);
    // 地面
    x.fillStyle = pat ?? '#6a27d9';
    x.fillRect(-w * 0.15, -h * 0.15, w * 1.3, h * 1.3);
    // 崩开的地方：底下是镜子（镜面外的那一点是压暗的地基）
    const broken = this.slabs.map((s) => s.over && t >= s.breakAt);
    if (broken.some(Boolean)) {
      x.save();
      x.beginPath();
      this.slabs.forEach((_, i) => broken[i] && this.path(this.slabPts[i]));
      x.clip();
      x.fillStyle = 'rgba(22,6,74,0.62)';
      x.fillRect(-w * 0.15, -h * 0.15, w * 1.3, h * 1.3);
      // 镜面：暗绿，上亮下暗，竖着几道淡淡的反光
      x.beginPath();
      x.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2);
      const glass = x.createLinearGradient(cx - rx * 0.5, cy - ry, cx + rx * 0.5, cy + ry * 1.2);
      glass.addColorStop(0, '#5d8f76');
      glass.addColorStop(0.5, '#3a6a55');
      glass.addColorStop(1, '#1c4a3b');
      x.fillStyle = glass;
      x.fill();
      x.save();
      x.clip();
      x.fillStyle = 'rgba(200,240,220,0.07)';
      const rnd = mirrorRng(5);
      for (let i = 0; i < 14; i++) {
        const sx = cx - rx + rnd() * rx * 2.2;
        const sw = rx * (0.01 + rnd() * 0.035);
        x.fillRect(sx, cy - ry * (0.4 + rnd()), sw, ry * (1 + rnd() * 1.6));
      }
      // 斜着一大片淡淡的反光
      const sheen = x.createLinearGradient(cx - rx * 0.2, cy - ry * 0.6, cx + rx * 0.6, cy + ry * 0.7);
      sheen.addColorStop(0, 'rgba(210,255,232,0)');
      sheen.addColorStop(0.5, 'rgba(210,255,232,0.13)');
      sheen.addColorStop(1, 'rgba(210,255,232,0)');
      x.fillStyle = sheen;
      x.fillRect(cx - rx * 1.3, cy - ry * 1.3, rx * 2.6, rx * 2.6);
      x.restore();
      // 镜缘：外面一圈深色，里面一道细的亮线
      const rim = Math.max(4, rx * 0.022);
      x.lineWidth = rim;
      x.strokeStyle = '#0d2a22';
      x.beginPath();
      x.ellipse(cx, cy, rx - rim * 0.5, ry - rim * 0.5, rot, 0, Math.PI * 2);
      x.stroke();
      x.lineWidth = Math.max(1, rim * 0.16);
      x.strokeStyle = 'rgba(150,200,176,0.55)';
      x.beginPath();
      x.ellipse(cx, cy, rx - rim * 1.25, ry - rim * 1.25, rot, 0, Math.PI * 2);
      x.stroke();
      x.restore();
    }
    // 快崩开的石板：边上的裂缝先黑出来
    x.lineJoin = 'round';
    this.slabs.forEach((s, i) => {
      if (!s.over || broken[i]) return;
      const a = clamp01((t - (s.breakAt - 0.2)) / 0.2);
      if (a <= 0) return;
      x.beginPath();
      this.path(this.slabPts[i]);
      x.strokeStyle = `rgba(20,4,78,${(a * 0.85).toFixed(2)})`;
      x.lineWidth = 1 + a * Math.max(1.5, w * 0.0022);
      x.stroke();
    });
    // 崩飞的石板：朝外、朝镜头翻出去，越飞越淡；底下拖一块暗的当厚度
    const life = 0.36;
    const D = Math.max(w, h);
    this.slabs.forEach((s, i) => {
      if (!broken[i]) return;
      const age = (t - s.breakAt) / life;
      if (age >= 1) return;
      const e = easeOut(age);
      const [sx, sy] = this.slabAt[i];
      x.save();
      // 快飞出去了才淡掉，之前是实心的石头
      x.globalAlpha = 1 - clamp01((age - 0.62) / 0.38) ** 2;
      x.translate(sx + s.dx * D * 0.12 * e, sy + s.dy * D * 0.12 * e + D * 0.06 * age * age);
      x.rotate(s.spin * e);
      const sc = 1 + 0.3 * e;
      x.scale(sc, sc);
      x.translate(-sx, -sy);
      // 石板的厚度：往右下错开画两层暗的侧面
      const thick = D * 0.011 * (1 + e);
      for (const [k, col] of [[1, '#1c0c5c'], [0.5, '#2f1790']] as const) {
        x.beginPath();
        this.path(this.slabPts[i].map((p): Pt => [p[0] + thick * 0.55 * k, p[1] + thick * k]));
        x.fillStyle = col;
        x.fill();
      }
      x.beginPath();
      this.path(this.slabPts[i]);
      x.fillStyle = pat ?? '#7c2ee6';
      x.fill();
      // 翻起来的那一面有的迎着光、有的背着光
      x.fillStyle = s.spin > 0 ? `rgba(200,130,255,${(0.2 * e).toFixed(2)})` : `rgba(24,8,92,${(0.3 * e).toFixed(2)})`;
      x.fill();
      x.strokeStyle = 'rgba(206,150,255,0.6)';
      x.lineWidth = 1.2;
      x.stroke();
      x.restore();
    });
    x.restore();
    // 冲进去的最后几帧：压黑，接下一拍
    if (rush > 0) {
      x.fillStyle = `rgba(17,19,27,${(rush * 0.9).toFixed(2)})`;
      x.fillRect(0, 0, w, h);
    }
  }

  // ----- 第二拍：碎裂 -----

  private drawShatter(t: number): void {
    const x = this.ctx;
    const { w, h } = this;
    x.fillStyle = '#11131b';
    x.fillRect(0, 0, w, h);
    const D = Math.hypot(w, h) * 0.62;
    // 炸开的中心从左下慢慢移到画面中间
    const cx = lerp(w * 0.4, w * 0.5, t);
    const cy = lerp(h * 0.74, h * 0.6, t);
    const ms = t * MIRROR_CUT.shatter;
    // 像手绘动画那样三帧换一套碎片，每一套里碎片一直往外冲
    const step = Math.floor(ms / 100);
    const within = (ms - step * 100) / 100;
    const set = this.shardSets[step % this.shardSets.length];
    const grow = 1 + 0.5 * t + 0.16 * within;
    // 刚炸开：地面和镜子的大块碎片还在四个角上往外飞
    if (t < 0.34) {
      const k = t / 0.34;
      const pat = this.pattern();
      const corner = (ax: number, ay: number, fill: string | CanvasPattern, size: number, tilt: number) => {
        x.save();
        x.translate(lerp(cx, ax, 0.45 + k * 0.75), lerp(cy, ay, 0.45 + k * 0.75));
        x.rotate(tilt + k * 0.5);
        x.beginPath();
        x.moveTo(-size, -size * 0.5);
        x.lineTo(size * 0.2, -size * 0.8);
        x.lineTo(size, size * 0.1);
        x.lineTo(size * 0.3, size * 0.75);
        x.lineTo(-size * 0.7, size * 0.5);
        x.closePath();
        x.fillStyle = fill;
        x.fill();
        x.lineWidth = Math.max(2, D * 0.006);
        x.strokeStyle = '#e0183c';
        x.stroke();
        x.restore();
      };
      const s = D * 0.3;
      corner(0, h, pat ?? '#7c2ee6', s, 0.3);
      corner(w, 0, '#3f7a60', s * 0.8, 1.2);
      corner(0, 0, '#33356a', s * 1.1, -0.6);
      corner(w, h * 0.3, pat ?? '#7c2ee6', s * 0.6, 2.1);
    }
    x.save();
    x.translate(cx, cy);
    x.rotate(-0.12 + t * 0.2 + step * 0.05);
    x.lineJoin = 'miter';
    x.shadowColor = 'rgba(255,24,64,0.85)';
    x.shadowBlur = D * 0.018 * this.dpr;
    for (const s of set) {
      const r0 = s.r0 * D * grow;
      const r1 = s.r1 * D * grow * (1 + within * 0.2);
      const wd = s.width * D * (0.8 + t * 0.5);
      const cos = Math.cos(s.angle);
      const sin = Math.sin(s.angle);
      const n = 5;
      const side: Pt[] = [];
      const other: Pt[] = [];
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const r = lerp(r0, r1, u);
        // 两头尖、中间宽，边上带锯齿
        const half = wd * Math.sin(Math.PI * u) ** 0.7;
        const a = half * (1 + s.jag[i] * 0.45);
        const b = half * (1 + s.jag[i + 6] * 0.45);
        const along = r + s.jag[(i + 3) % 12] * wd * 0.6;
        side.push([cos * along - sin * a, sin * along + cos * a]);
        other.push([cos * along + sin * b, sin * along - cos * b]);
      }
      x.beginPath();
      this.path([...side, ...other.reverse()]);
      if (s.big) {
        x.fillStyle = '#2f3163';
        x.fill();
        x.lineWidth = Math.max(2, D * 0.0075);
        x.strokeStyle = '#d4163c';
        x.stroke();
      } else {
        x.fillStyle = '#d4163c';
        x.fill();
      }
    }
    x.restore();
    // 开头接上一拍的黑，结尾一闪红接下一拍
    const flash = easeIn((t - 0.82) / 0.18);
    if (flash > 0) {
      x.fillStyle = `rgba(255,70,96,${(flash * 0.95).toFixed(2)})`;
      x.fillRect(0, 0, w, h);
    }
  }

  // ----- 第三拍：镜中人 -----

  // 每面镜子在画面上的位置：三家从左到右是上家、对家、下家；对家那面大一点、高一点
  private spots(): { cx: number; cy: number; rx: number; ry: number; tilt: number }[] {
    const { w, h } = this;
    const n = this.faces.length;
    // 竖屏：横着排不开，三面镜子左一面右一面错着往下排
    if (h > w * 1.2 && n > 1) {
      const rx = Math.min(w * 0.29, h * (n > 2 ? 0.115 : 0.15));
      return this.faces.map((_, i) => ({
        cx: w * (i % 2 ? 0.67 : 0.35),
        cy: h * (0.18 + (0.4 * i) / (n - 1)),
        rx,
        ry: rx * 1.38,
        tilt: i % 2 ? 0.06 : -0.06,
      }));
    }
    const rx = Math.min(w / (n * 2.12), h * 0.25);
    return this.faces.map((_, i) => {
      const mid = n === 3 && i === 1;
      const k = mid ? 1.08 : 1;
      return {
        cx: n === 1 ? w * 0.5 : lerp(w * 0.5 - rx * 2.16 * ((n - 1) / 2), w * 0.5 + rx * 2.16 * ((n - 1) / 2), i / (n - 1)),
        cy: h * (mid ? 0.42 : 0.45),
        rx: rx * k,
        ry: rx * 1.38 * k,
        tilt: n === 1 ? 0 : lerp(-0.07, 0.07, i / (n - 1)),
      };
    });
  }

  // 一面镜子连同镜前（或镜里）的人，画一次存起来，每帧只贴图
  private sprite(f: Face, rx: number, ry: number): HTMLCanvasElement {
    const ready = !!f.img && f.ready;
    if (f.sprite && f.spriteFor === ready) return f.sprite;
    const s = this.dpr;
    const pw = rx * 3;
    const ph = ry * 2.7;
    const [c, x] = makeCanvas(pw * s, ph * s);
    x.scale(s, s);
    const mx = pw / 2;
    const my = ry * 1.15;
    const rim = Math.max(3, rx * 0.06);
    const glassPath = () => {
      x.beginPath();
      x.ellipse(mx, my, rx - rim * 0.5, ry - rim * 0.5, 0, 0, Math.PI * 2);
    };
    // 镜面：照着满屋的红光，顶上还留一点镜子本来的绿
    glassPath();
    const glass = x.createLinearGradient(0, my - ry, 0, my + ry);
    glass.addColorStop(0, '#213a32');
    glass.addColorStop(0.3, '#3a1418');
    glass.addColorStop(1, '#8c1428');
    x.fillStyle = glass;
    x.fill();
    const img = ready ? f.img! : null;
    // 把人染上红光：底下亮、顶上淡
    const lit = (cw: number, chh: number, draw: (t: CanvasRenderingContext2D) => void): HTMLCanvasElement => {
      const [tc, tx] = makeCanvas(cw * s, chh * s);
      tx.scale(s, s);
      draw(tx);
      tx.globalCompositeOperation = 'source-atop';
      const g = tx.createLinearGradient(0, 0, 0, chh);
      g.addColorStop(0, 'rgba(120,10,30,0.18)');
      g.addColorStop(0.55, 'rgba(255,60,80,0.2)');
      g.addColorStop(1, 'rgba(255,60,90,0.6)');
      tx.fillStyle = g;
      tx.fillRect(0, 0, cw, chh);
      return tc;
    };
    const stroke = () => {
      // 镜缘：青绿的一圈，外面压一道深色，左上有一段高光
      x.lineWidth = rim;
      x.strokeStyle = '#1b4a3c';
      x.beginPath();
      x.ellipse(mx, my, rx, ry, 0, 0, Math.PI * 2);
      x.stroke();
      x.lineWidth = rim * 0.62;
      x.strokeStyle = '#6fc3a2';
      x.beginPath();
      x.ellipse(mx, my, rx, ry, 0, 0, Math.PI * 2);
      x.stroke();
      x.lineWidth = rim * 0.2;
      x.strokeStyle = 'rgba(214,250,232,0.85)';
      x.beginPath();
      x.ellipse(mx, my, rx + rim * 0.1, ry + rim * 0.1, 0, Math.PI * 1.05, Math.PI * 1.55);
      x.stroke();
    };
    if (img && f.cutout) {
      // 抠好的半身像：镜子里是她淡淡的背影（反过来、偏到一边），人站在镜子前面，下半截会被云挡住
      const bw = rx * 2.3;
      const bh = (bw * img.naturalHeight) / img.naturalWidth;
      // 半身像底下那条平平的切边淡掉（云还没翻上来时不露出来）
      const body = lit(bw, bh, (tx) => {
        tx.drawImage(img, 0, 0, bw, bh);
        tx.globalCompositeOperation = 'destination-out';
        const cut = tx.createLinearGradient(0, bh * 0.8, 0, bh);
        cut.addColorStop(0, 'rgba(0,0,0,0)');
        cut.addColorStop(1, 'rgba(0,0,0,1)');
        tx.fillStyle = cut;
        tx.fillRect(0, bh * 0.8, bw, bh * 0.2);
      });
      x.save();
      glassPath();
      x.clip();
      x.globalAlpha = 0.3;
      x.translate(mx + rx * 0.34, 0);
      x.scale(-1, 1);
      x.drawImage(body, -bw * 0.45, my - ry * 0.86, bw * 0.9, bh * 0.9);
      x.restore();
      stroke();
      // 头顶不冒出镜子（半身像上边是平着切的）：镜心以上只画镜面里的部分，镜心以下肩膀可以伸到镜子外面
      x.save();
      x.beginPath();
      x.ellipse(mx, my, rx - rim * 0.5, ry - rim * 0.5, 0, 0, Math.PI * 2);
      x.rect(0, my, pw, ph - my);
      x.clip();
      x.drawImage(body, mx - bw / 2, my - ry * 0.98, bw, bh);
      x.restore();
    } else if (img) {
      // 方图：照进镜子里，铺满镜面（脸在上半截）
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      const k = Math.max((rx * 2) / iw, (ry * 2) / ih);
      const dw = iw * k;
      const dh = ih * k;
      const body = lit(dw, dh, (tx) => tx.drawImage(img, 0, 0, dw, dh));
      x.save();
      glassPath();
      x.clip();
      x.drawImage(body, mx - dw / 2, my - ry + (ry * 2 - dh) * 0.25, dw, dh);
      // 镜面边上压暗一圈
      const v = x.createRadialGradient(mx, my, rx * 0.5, mx, my, ry * 1.05);
      v.addColorStop(0, 'rgba(60,0,10,0)');
      v.addColorStop(1, 'rgba(60,0,10,0.6)');
      x.fillStyle = v;
      x.fillRect(0, 0, pw, ph);
      x.restore();
      stroke();
    } else {
      // 没有图：镜子里映出名字的最后一个字
      x.save();
      glassPath();
      x.clip();
      x.font = `900 ${Math.round(rx * 1.25)}px "Noto Serif SC", "Songti SC", "SimSun", serif`;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.shadowColor = 'rgba(255,60,90,0.9)';
      x.shadowBlur = rx * 0.2 * s;
      x.fillStyle = 'rgba(255,226,230,0.9)';
      x.fillText(f.target.glyph, mx, my - ry * 0.08);
      x.restore();
      stroke();
    }
    f.sprite = c;
    f.spriteFor = ready;
    return c;
  }

  private drawReveal(t: number, fade: number): void {
    const x = this.ctx;
    const { w, h } = this;
    const secs = (t * MIRROR_CUT.reveal) / 1000;
    // 背景：顶上压黑，往下是一片红光
    const bg = x.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#0d0204');
    bg.addColorStop(0.42, '#4a0812');
    bg.addColorStop(0.8, '#c81f3a');
    bg.addColorStop(1, '#ff5a70');
    x.fillStyle = bg;
    x.fillRect(0, 0, w, h);
    const glow = x.createRadialGradient(w * 0.5, h * 0.92, 0, w * 0.5, h * 0.92, Math.max(w, h) * 0.7);
    glow.addColorStop(0, 'rgba(255,120,130,0.7)');
    glow.addColorStop(0.5, 'rgba(230,40,70,0.24)');
    glow.addColorStop(1, 'rgba(230,40,70,0)');
    x.fillStyle = glow;
    x.fillRect(0, 0, w, h);
    // 镜头慢慢推近
    x.save();
    const push = 1 + 0.035 * t;
    x.translate(w / 2, h / 2);
    x.scale(push, push);
    x.translate(-w / 2, -h / 2);
    // 镜子一面接一面从右边甩进来，停住时晃一下
    const spots = this.spots();
    // 横着排时对家那面压在两边的上面；竖着排时下面的压上面的
    const wide = !(h > w * 1.2);
    const order = spots.map((_, i) => i).sort((a, b) => (wide && a === 1 && spots.length === 3 ? 1 : 0) - (wide && b === 1 && spots.length === 3 ? 1 : 0));
    for (const i of order) {
      const sp = spots[i];
      const f = this.faces[i];
      const at = this.still ? 1 : (secs - 0.04 - i * 0.13) / 0.26;
      if (at <= 0) continue;
      const e = easeOut(at);
      const img = this.sprite(f, sp.rx, sp.ry);
      const pw = sp.rx * 3;
      const ph = sp.ry * 2.7;
      const settle = at > 1 && at < 1.9 ? Math.sin((at - 1) * 10) * (1.9 - at) * 0.012 : 0;
      const draw = (dx: number, alpha: number, stretch: number) => {
        x.save();
        x.globalAlpha = alpha;
        x.translate(sp.cx + dx, sp.cy);
        x.rotate(sp.tilt + settle + (1 - e) * 0.2);
        x.scale((1 + (1 - e) * 0.25) * stretch, 1 + (1 - e) * 0.25);
        x.drawImage(img, -pw / 2, -sp.ry * 1.15, pw, ph);
        x.restore();
      };
      const dx = (1 - e) * w * 0.7;
      // 甩进来的时候拖几道残影
      if (at < 0.85) for (let k = 3; k >= 1; k--) draw(dx + k * w * 0.05 * (1 - e), 0.16, 1 + 0.12 * k * (1 - e));
      draw(dx, 1, 1);
      // 停稳以后镜面上扫过一道光
      const sweep = (secs - 0.5 - i * 0.13) / 0.5;
      if (sweep > 0 && sweep < 1 && !this.still) {
        x.save();
        x.translate(sp.cx, sp.cy);
        x.rotate(sp.tilt);
        x.beginPath();
        x.ellipse(0, 0, sp.rx * 0.94, sp.ry * 0.94, 0, 0, Math.PI * 2);
        x.clip();
        const px = lerp(-sp.rx * 1.8, sp.rx * 1.8, sweep);
        const band = x.createLinearGradient(px - sp.rx * 0.5, 0, px + sp.rx * 0.5, 0);
        band.addColorStop(0, 'rgba(255,255,255,0)');
        band.addColorStop(0.5, `rgba(255,236,240,${(0.34 * Math.sin(Math.PI * sweep)).toFixed(2)})`);
        band.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = band;
        x.rotate(0.35);
        x.fillRect(-sp.rx * 3, -sp.ry * 2, sp.rx * 6, sp.ry * 4);
        x.restore();
      }
    }
    x.restore();
    // 红云：后面一层暗的、前面一层亮的，从底下翻上来，慢慢往两边飘
    const ch = Math.max(h * 0.4, w * 0.16);
    const cw = Math.ceil(w * 1.5 + ch);
    this.cloudBack ??= paintClouds(cw, ch, 41, false);
    this.cloudFront ??= paintClouds(cw, ch, 23, true);
    const rise = this.still ? 1 : easeOut(secs / 0.5);
    const drift = secs * w * 0.012;
    x.drawImage(this.cloudBack, -w * 0.1 - drift, h - ch * 0.98 * rise - ch * 0.12, cw, ch);
    x.drawImage(this.cloudFront, -w * 0.32 + drift * 1.4, h - ch * 0.72 * rise, cw, ch);
    // 三家的名字压在云上
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    const fs = Math.max(14, Math.min(w, h) * 0.042);
    x.font = `700 ${fs.toFixed(0)}px "Noto Serif SC", "Songti SC", "SimSun", serif`;
    spots.forEach((sp, i) => {
      const a = this.still ? 1 : clamp01((secs - 0.4 - i * 0.13) / 0.25);
      if (a <= 0) return;
      x.globalAlpha = a;
      x.lineWidth = fs * 0.28;
      x.strokeStyle = 'rgba(70,4,18,0.85)';
      x.lineJoin = 'round';
      const ny = Math.min(h - fs * 3.4, sp.cy + sp.ry * 0.9);
      x.strokeText(this.faces[i].target.name, sp.cx, ny);
      x.fillStyle = '#fff1f2';
      x.fillText(this.faces[i].target.name, sp.cx, ny);
    });
    // 底下云上的大字
    const wa = this.still ? 1 : clamp01((secs - 0.3) / 0.3);
    if (wa > 0) {
      x.globalAlpha = wa;
      const ws = Math.max(24, Math.min(w * 0.075, h * 0.095));
      x.font = `900 ${ws.toFixed(0)}px "Noto Serif SC", "Songti SC", "SimSun", serif`;
      const chars = [...this.word];
      const gap = ws * 1.5;
      const y = h - Math.max(ws * 0.85, h * 0.075) + (1 - easeOut(wa)) * ws * 0.3;
      x.shadowColor = 'rgba(255,40,80,0.95)';
      x.shadowBlur = ws * 0.35 * this.dpr;
      chars.forEach((ch2, i) => {
        const px = w / 2 + (i - (chars.length - 1) / 2) * gap;
        x.lineWidth = ws * 0.12;
        x.strokeStyle = 'rgba(90,4,22,0.9)';
        x.strokeText(ch2, px, y);
        x.fillStyle = '#fff6f6';
        x.fillText(ch2, px, y);
      });
      x.shadowBlur = 0;
    }
    x.globalAlpha = 1;
    // 接上一拍的那一闪
    const flash = this.still ? 0 : 1 - clamp01(secs / 0.16);
    if (flash > 0 && fade === 0) {
      x.fillStyle = `rgba(255,70,96,${(flash * 0.95).toFixed(2)})`;
      x.fillRect(0, 0, w, h);
    }
  }
}

let playing: MirrorCut | null = null;

// 放一遍照魔镜：targets 是被照的几家（从左到右）。每一拍开始时调 onBeat（配音效），开始淡出（或者被点掉）时调 onDone。
// 返回一个收场的函数（牌桌被换掉时用，不调 onDone）
export function playMirrorCut(targets: MirrorTarget[], opts: { word?: string; onBeat?: (beat: MirrorBeat) => void; onDone?: () => void } = {}): () => void {
  playing?.cancel();
  const cut = new MirrorCut(targets, opts.word ?? '照魔镜', opts.onBeat ?? (() => {}), () => {
    if (playing === cut) playing = null;
    opts.onDone?.();
  });
  playing = cut;
  return () => {
    if (playing === cut) playing = null;
    cut.cancel();
  };
}
