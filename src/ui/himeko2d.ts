import './himeko2d.css';
import { beatFinal, beatHit, beatLength } from './himekoBeat';

// 鹤田姬子拿到钥匙的那一局（2D 牌桌）：和 3D 一样，配牌时她的牌东一张西一张错落着（himekoBeat.ts）裹着火、拖着火尾，
// 从画面正上方的天上竖着砸进她手里（牌不打转），最后一张砸下来最重（推开一圈光、牌桌一震）；理完牌一团火从她右手边烧到左手边。
// 包着牌的火、火尾、落地的火星和后面的火画在盖住牌桌的一张 canvas 上（不挡点击）；牌自己的下落在同一帧里
// 用 translate/rotate/scale 摆（这样牌和火尾永远对得上），牌出现、发橙光、被火烧到时映橙色是 CSS 动画
// （himeko2d.css，牌桌每次重画后 apply() 用负的 animation-delay 接着放）。

const T = {
  open: 0.2, // 她这一段从开始算第几秒起（之后照 himekoBeat.ts 的节奏落地）
  drop: 0.32, // 一张牌从天上砸到手里要多久（himeko2d.css 的 hk-fall：0.8 秒里前 40%）
  light: 0.2, // 最后一张之后再停多久点火（节奏里已经停过 settle）
  sweep: 1.0, // 火从右烧到左
  burn: 1.0, // 火头过去以后还烧多久
};

// 流星从哪个方向来：画面正上方，竖着砸下来
const DIR = { x: 0, y: -1 };

interface Spot {
  x: number; // 牌中心（牌桌坐标）
  y: number;
  w: number;
  h: number;
  len: number; // 从起点到这张牌的路有多长
  el: HTMLElement;
  lx: number; // 起点相对落点的位移，换到牌自己的坐标里（她那排手牌整个转过）
  ly: number;
}

interface Flame {
  u: number; // 0 右手边，1 左手边
  dx: number;
  birth: number;
  life: number;
  rise: number;
  size: number;
  spark: boolean;
  wob: number;
}

// 流星身上的一点火：born 是在下落的哪一段（0 起飞，1 落地）冒出来的
interface Ember {
  born: number;
  jx: number; // 在牌上哪个位置冒出来（以牌宽、牌高为单位）
  jy: number;
  life: number;
  size: number;
  rise: number;
  wob: number;
}

// 落地时溅出去的火星
interface Spark {
  angle: number;
  speed: number;
  life: number;
  size: number;
}

function rng(seed: number): () => number {
  let r = seed >>> 0;
  return () => ((r = (r * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// 固定的伪随机数：每次烧起来样子一样
function flames(): Flame[] {
  const rnd = rng(0x51ed27);
  const out: Flame[] = [];
  for (let i = 0; i < 420; i++) {
    const spark = i % 6 === 0;
    const u = rnd() * 1.06 - 0.03;
    out.push({
      u,
      dx: rnd() - 0.5,
      birth: u * T.sweep + rnd() * 0.2 - 0.04,
      life: spark ? 0.9 + rnd() * 0.7 : 0.5 + rnd() * 0.7,
      rise: spark ? 80 + rnd() * 90 : 45 + rnd() * 70,
      size: spark ? 2 + rnd() * 2.5 : 15 + rnd() * 17,
      spark,
      wob: rnd() * 40,
    });
  }
  return out;
}

function embers(seed: number): Ember[] {
  const rnd = rng(seed * 7919 + 17);
  return Array.from({ length: 46 }, () => ({
    born: rnd() * 1.04,
    jx: (rnd() - 0.5) * 1.3,
    jy: (rnd() - 0.5) * 1.2,
    life: 0.14 + rnd() * 0.26,
    size: 0.45 + rnd() * 0.6,
    rise: 10 + rnd() * 26,
    wob: rnd() * 40,
  }));
}

function sparks(seed: number, n: number): Spark[] {
  const rnd = rng(seed * 104729 + 3);
  // 往上半边溅（画面上 y 朝下，所以角度在 π..2π）
  return Array.from({ length: n }, () => ({
    angle: Math.PI * (1.05 + rnd() * 0.9),
    speed: 140 + rnd() * 260,
    life: 0.35 + rnd() * 0.35,
    size: 1.5 + rnd() * 2,
  }));
}

const FLAMES = flames();
const EMBERS = Array.from({ length: 14 }, (_, i) => embers(i));
const SPARKS = Array.from({ length: 14 }, (_, i) => sparks(i, 12));
const BIG_SPARKS = sparks(99, 34);

// 一团火的贴图：中间亮、外面透明，按温度给颜色（白热 → 黄 → 橙 → 暗红）
function sprite(heat: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const col = heat > 0.75 ? '255,236,190' : heat > 0.5 ? '255,190,70' : heat > 0.25 ? '255,110,20' : '190,40,5';
  const g = ctx.createRadialGradient(32, 36, 0, 32, 36, 32);
  g.addColorStop(0, `rgba(${col},1)`);
  g.addColorStop(0.45, `rgba(${col},0.55)`);
  g.addColorStop(1, `rgba(${col},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return c;
}

// 她坐在自己的哪边，那一排手牌就转了多少度（style.css 里 .opponent.right/top/left）
const SEAT_TURN = [0, -Math.PI / 2, Math.PI, Math.PI / 2];

export class Himeko2D {
  private canvas: HTMLCanvasElement | null = null;
  private start: number | null = null; // 开始的 performance.now()（毫秒），没在放是 null
  private spots: Spot[] = [];
  private raf = 0;
  private sprites: HTMLCanvasElement[] | null = null;
  private calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  private count = 13;
  private seed = 0; // 这一局落下的先后、间隔（himekoBeat.ts 的 beatSeed）
  private shook = false;

  // 第 i 张（她自己看过去从左到右）什么时候落地
  private hitAt(i: number): number {
    return T.open + beatHit(i, this.count, this.seed).at;
  }

  // 第 i 张是不是最后砸下来的那张（重拍）
  private accent(i: number): boolean {
    return beatHit(i, this.count, this.seed).accent === 2;
  }

  // 整段多久（秒）
  private get total(): number {
    return this.fireAt + T.sweep + T.burn;
  }

  private get fireAt(): number {
    return T.open + beatLength(this.count, this.seed) + T.light;
  }

  get running(): boolean {
    return this.start !== null && (performance.now() - this.start) / 1000 < this.total;
  }

  // 还要放多久（毫秒），电脑先别出牌
  busyMs(): number {
    if (this.start === null) return 0;
    return Math.max(0, this.total * 1000 - (performance.now() - this.start));
  }

  begin(seed = 0): void {
    this.seed = seed;
    this.start = performance.now();
    this.spots = [];
    this.shook = false;
  }

  stop(): void {
    for (const { el } of this.spots) el.style.translate = el.style.rotate = el.style.scale = '';
    this.start = null;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.canvas?.remove();
    this.canvas = null;
  }

  // 牌桌重画以后调用：给她的手牌接上动画、量出每张牌在哪、需要的话开始画
  // rel：她坐在自己的哪边（0 下、1 右、2 上、3 左），用来分清她的右手边在画面哪边
  apply(table: HTMLElement, handSelector: string, rel: number): void {
    if (!this.running) return;
    const els = [...table.querySelectorAll<HTMLElement>(`${handSelector} > *:not(.drawn), ${handSelector} > .drawn > *`)].filter((el) => el.offsetWidth > 0);
    if (!els.length) return;
    this.count = els.length;
    const t = (performance.now() - (this.start ?? 0)) / 1000;
    const scale = table.getBoundingClientRect().width / table.offsetWidth || 1;
    const box = table.getBoundingClientRect();
    const [rx, ry] = [[1, 0], [0, -1], [-1, 0], [0, 1]][rel & 3];
    // 起点在画面上是 DIR × len；她那排手牌整个转过，要换到牌自己的坐标里
    const turn = SEAT_TURN[rel & 3];
    const [c, s] = [Math.cos(turn), Math.sin(turn)];
    const measured = els.map((el) => {
      // 牌正在往下落的话量到的是半空中的位置，先把位移去掉再量
      el.style.translate = el.style.rotate = el.style.scale = '';
      const r = el.getBoundingClientRect();
      const x = (r.left + r.width / 2 - box.left) / scale;
      const y = (r.top + r.height / 2 - box.top) / scale;
      // 起点都在画面上沿再往上一截（离画面上沿近的牌也至少飞 420）
      const len = (Math.max(y, 280) + 140) / -DIR.y;
      const [dx, dy] = [DIR.x * len, DIR.y * len];
      const spot: Spot = { x, y, w: r.width / scale, h: r.height / scale, len, el, lx: dx * c + dy * s, ly: -dx * s + dy * c };
      return { spot, along: x * rx + y * ry };
    });
    measured.sort((a, b) => a.along - b.along);
    this.spots = measured.map((m) => m.spot);
    // 手里从左到右第 i 张（她自己看过去），按 himekoBeat.ts 排好的先后错落着砸下来；火从最后一张烧到第一张
    this.spots.forEach(({ el }, i) => {
      el.classList.add('hk-tile');
      const fall = this.hitAt(i) - T.drop - t;
      const burn = this.fireAt + (1 - i / Math.max(1, this.spots.length - 1)) * T.sweep - t;
      el.style.animationDelay = `${fall.toFixed(3)}s, ${burn.toFixed(3)}s`;
    });
    if (this.calm) return;
    this.place(t);
    if (!this.canvas || !this.canvas.isConnected) {
      this.canvas?.remove();
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'hk-fx';
      table.appendChild(this.canvas);
    } else if (this.canvas.parentElement !== table) table.appendChild(this.canvas);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(table.offsetWidth * dpr);
    const h = Math.round(table.offsetHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    if (!this.raf) this.raf = requestAnimationFrame(this.draw);
  }

  private draw = (): void => {
    this.raf = 0;
    const c = this.canvas;
    if (!c || this.start === null) return;
    const t = (performance.now() - this.start) / 1000;
    const ctx = c.getContext('2d')!;
    const dpr = c.width / (c.parentElement?.offsetWidth || c.width);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    if (t > this.total) {
      this.stop();
      return;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    this.sprites ??= [0.1, 0.35, 0.6, 0.9].map(sprite);
    // 最后一张砸下来时牌桌一震
    if (!this.shook && this.spots.length && t >= T.open + beatFinal(this.count, this.seed)) {
      this.shook = true;
      const table = c.parentElement;
      table?.classList.add('hk-shake');
      window.setTimeout(() => table?.classList.remove('hk-shake'), 450);
    }
    this.place(t);
    this.spots.forEach((s, i) => this.drawMeteor(ctx, s, i, t));
    this.drawFire(ctx, t);
    ctx.globalAlpha = 1;
    this.raf = requestAnimationFrame(this.draw);
  };

  // 正在往下砸的牌摆到火尾的头上（越落越快，竖着落、不打转，离得远时大一点）；落地了就去掉位移
  private place(t: number): void {
    this.spots.forEach((s, i) => {
      const a = t - (this.hitAt(i) - T.drop);
      const style = s.el.style;
      if (a >= T.drop) {
        if (style.translate) style.translate = style.rotate = style.scale = '';
        return;
      }
      const k = Math.max(0, a / T.drop);
      const left = 1 - k * k;
      style.translate = `${(s.lx * left).toFixed(1)}px ${(s.ly * left).toFixed(1)}px`;
      style.scale = (1 + 0.3 * (1 - k)).toFixed(3);
    });
  }

  // 牌飞到下落的 k（0 起飞，1 落地）时在哪：越落越快（k²）
  private at(s: Spot, k: number): [number, number] {
    const left = s.len * (1 - k * k);
    return [s.x + DIR.x * left, s.y + DIR.y * left];
  }

  private flame(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, heat: number, alpha: number): void {
    const img = this.sprites![heat > 0.75 ? 3 : heat > 0.5 ? 2 : heat > 0.25 ? 1 : 0];
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.drawImage(img, x - size, y - size * 1.2, size * 2, size * 2.4);
  }

  private drawMeteor(ctx: CanvasRenderingContext2D, s: Spot, i: number, t: number): void {
    const a = t - (this.hitAt(i) - T.drop);
    if (a < 0 || a > T.drop + 0.9) return;
    const accent = this.accent(i);
    const k = Math.min(1, a / T.drop);
    const [hx, hy] = this.at(s, k);
    const size = Math.max(s.w, s.h * 0.75);
    if (a < T.drop) {
      // 火尾：从牌往天上拖一条，越落越快拖得越长
      const [tx, ty] = this.at(s, Math.max(0, k - 0.32));
      const len = Math.hypot(tx - hx, ty - hy) + size * 1.5;
      const ex = hx + DIR.x * len;
      const ey = hy + DIR.y * len;
      for (const [wide, alpha] of [
        [1.7, 0.24],
        [0.8, 0.62],
      ]) {
        const w = size * wide * (accent ? 1.35 : 1);
        const g = ctx.createLinearGradient(hx, hy, ex, ey);
        g.addColorStop(0, `rgba(255,214,140,${alpha})`);
        g.addColorStop(0.18, `rgba(255,150,40,${alpha * 0.85})`);
        g.addColorStop(0.55, `rgba(240,80,12,${alpha * 0.45})`);
        g.addColorStop(1, 'rgba(160,30,5,0)');
        ctx.globalAlpha = 1;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(hx - DIR.y * w * 0.5, hy + DIR.x * w * 0.5);
        ctx.lineTo(hx + DIR.y * w * 0.5, hy - DIR.x * w * 0.5);
        ctx.lineTo(ex, ey);
        ctx.closePath();
        ctx.fill();
      }
      // 裹着牌的一团火光（中间留淡一点，看得见牌）
      const r = size * (accent ? 1.9 : 1.45);
      const g = ctx.createRadialGradient(hx, hy, size * 0.25, hx, hy, r);
      g.addColorStop(0, 'rgba(255,190,90,0.28)');
      g.addColorStop(0.45, 'rgba(255,120,24,0.32)');
      g.addColorStop(1, 'rgba(255,80,10,0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = g;
      ctx.fillRect(hx - r, hy - r, r * 2, r * 2);
      // 裹着牌的火舌：绕着牌一圈，往火尾那边卷，一闪一闪
      for (let j = 0; j < 10; j++) {
        const ang = (j / 10) * Math.PI * 2 + i;
        const flick = 0.75 + 0.25 * Math.sin(t * 43 + j * 2.1 + i);
        const back = (0.2 + (0.4 * ((j * 7) % 5)) / 4) * size;
        const x = hx + Math.cos(ang) * s.w * 0.55 + DIR.x * back;
        const y = hy + Math.sin(ang) * s.h * 0.5 + DIR.y * back;
        this.flame(ctx, x, y, size * 0.6 * flick * (accent ? 1.3 : 1), 0.55 + 0.25 * flick, 0.5);
      }
    }
    // 牌身上一直冒出来的火：冒出来就留在原地往上飘，连成火尾
    for (const e of EMBERS[i % EMBERS.length]) {
      if (e.born * T.drop > a) continue;
      const age = a - e.born * T.drop;
      const f = age / e.life;
      if (f >= 1) continue;
      const [bx, by] = this.at(s, Math.min(1, e.born));
      const x = bx + e.jx * s.w + DIR.x * 14 * f + Math.sin(age * 18 + e.wob) * 3;
      const y = by + e.jy * s.h + DIR.y * 14 * f - e.rise * f;
      this.flame(ctx, x, y, size * e.size * (accent ? 1.3 : 1) * (1 - 0.5 * f), 1 - f, (1 - f) * 0.75);
    }
    if (a < T.drop) return;
    // 落地：一下闪光、火星溅开；最后一张再推开一圈光
    const b = a - T.drop;
    const flash = Math.exp(-b * (accent ? 6 : 10));
    if (flash > 0.02) {
      const r = size * (accent ? 3.2 : 1.8) * (1 + b * 3);
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
      g.addColorStop(0, `rgba(255,236,190,${0.9 * flash})`);
      g.addColorStop(0.35, `rgba(255,140,40,${0.55 * flash})`);
      g.addColorStop(1, 'rgba(255,90,10,0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = g;
      ctx.fillRect(s.x - r, s.y - r, r * 2, r * 2);
    }
    if (accent && b < 0.75) {
      const f = b / 0.75;
      const r = s.w * (0.6 + 8 * Math.pow(f, 0.4));
      ctx.globalAlpha = 1;
      ctx.strokeStyle = `rgba(255,170,70,${Math.pow(1 - f, 1.5)})`;
      ctx.lineWidth = 3 + 6 * (1 - f);
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, r, r * 0.6, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const p of accent ? BIG_SPARKS : SPARKS[i % SPARKS.length]) {
      const f = b / p.life;
      if (f >= 1) continue;
      const v = p.speed * (accent ? 1.4 : 1);
      const x = s.x + Math.cos(p.angle) * v * b;
      const y = s.y + s.h * 0.3 + Math.sin(p.angle) * v * b + 420 * b * b;
      ctx.globalAlpha = 1 - f;
      ctx.fillStyle = f < 0.4 ? '#ffe6b0' : '#ff9a30';
      ctx.beginPath();
      ctx.arc(x, y, p.size * (1 - 0.5 * f), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawFire(ctx: CanvasRenderingContext2D, now: number): void {
    const t = now - this.fireAt;
    if (t < 0 || this.spots.length === 0) return;
    const right = this.spots[this.spots.length - 1];
    const left = this.spots[0];
    const ox = (right.x - left.x) / Math.max(1, Math.hypot(right.x - left.x, right.y - left.y));
    const oy = (right.y - left.y) / Math.max(1, Math.hypot(right.x - left.x, right.y - left.y));
    // 起点、终点各往外多出半张牌
    const ax = right.x + ox * right.w * 0.5;
    const ay = right.y + oy * right.w * 0.5;
    const bx = left.x - ox * left.w * 0.5;
    const by = left.y - oy * left.w * 0.5;
    const across = Math.max(left.h, left.w) * 0.35;
    for (const f of FLAMES) {
      const age = t - f.birth;
      const k = age / f.life;
      if (k <= 0 || k >= 1) continue;
      const x0 = ax + (bx - ax) * f.u - oy * f.dx * across * 2;
      const y0 = ay + (by - ay) * f.u + ox * f.dx * across * 2 + across;
      const drift = (f.spark ? 30 : 16) * k;
      const x = x0 - ox * drift + Math.sin(age * 10 + f.wob) * 4 * k;
      const y = y0 - oy * drift - f.rise * Math.pow(k, 0.85);
      const heat = (1 - k) * (f.spark ? 1 : 0.8);
      const img = this.sprites![heat > 0.75 ? 3 : heat > 0.5 ? 2 : heat > 0.25 ? 1 : 0];
      const s = f.spark ? f.size * (1 - k) : f.size * (1 - 0.45 * k) * Math.min(1, k * 10);
      ctx.globalAlpha = f.spark ? 1 - k : (1 - k) * 0.5;
      ctx.drawImage(img, x - s, y - s * 1.4, s * 2, s * 2.6);
    }
    ctx.globalAlpha = 1;
  }
}
