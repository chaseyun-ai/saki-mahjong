import { lilyCount, lilyGrand, lilyStars } from '../ui3d/lilyFx';

// 2D 牌桌上宫永咲的岭上开花，和 3D 的（ui3d/lilyFx.ts）同一个样子：
// 结算里那张和了牌砸下去的一下，牌上炸开一团白光，一阵白色的旋风从牌底下卷出去（一道道毛笔扫出来似的风痕，
// 边转边往外扩、越扩越稀），牌上留一团薄荷绿的光，几片半透明的花瓣被风卷走，四角的星光在四周一闪一闪。
// 和得越大风卷得越远、花瓣和星光越多（按基本点）。画在一张盖在结算上面的 canvas 上，放完自己收起来。

interface Petal {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  spin: number;
  flip: number; // 翻面的相位：横着压扁花瓣，看起来像在空中翻
  flipSpeed: number;
  sway: number;
  phase: number;
  size: number;
  born: number;
  life: number;
}

// 一道风痕：rho 在风的前沿以内几成的地方，从 a0 起顺着螺线拖 len 弧度长；k 小的先淡掉（越扩越稀）
interface Streak {
  rho: number;
  a0: number;
  len: number;
  wide: number;
  k: number;
}

interface Star {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  size: number;
  phase: number;
  speed: number;
}

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const SQUASH = 0.62; // 旋风是贴着桌面的：竖着压扁一点
const PITCH = 0.3; // 风痕往里收的螺距

let starSprite: HTMLCanvasElement | null = null;
// 一颗四角星：白芯、薄荷绿的晕
function star(): HTMLCanvasElement {
  if (starSprite) return starSprite;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const halo = x.createRadialGradient(32, 32, 0, 32, 32, 26);
  halo.addColorStop(0, 'rgba(125,255,196,0.5)');
  halo.addColorStop(1, 'rgba(125,255,196,0)');
  x.fillStyle = halo;
  x.fillRect(0, 0, 64, 64);
  const body = x.createRadialGradient(32, 32, 0, 32, 32, 30);
  body.addColorStop(0, '#ffffff');
  body.addColorStop(0.35, '#eafff5');
  body.addColorStop(1, '#7dffc4');
  x.fillStyle = body;
  x.beginPath();
  x.moveTo(32, 2);
  x.quadraticCurveTo(32, 32, 62, 32);
  x.quadraticCurveTo(32, 32, 32, 62);
  x.quadraticCurveTo(32, 32, 2, 32);
  x.quadraticCurveTo(32, 32, 32, 2);
  x.fill();
  starSprite = c;
  return c;
}

export class Lily2D {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private petals: Petal[] = [];
  private streaks: Streak[] = [];
  private stars: Star[] = [];
  private rays: { a: number; len: number; wide: number }[] = [];
  private queue: { at: number; fn: () => void }[] = [];
  private clock = 0;
  private raf = 0;
  private last = 0;
  private origin = { x: 0, y: 0 };
  private start = -1;
  private grand = 0;
  private reach = 300;
  private dir = 1;
  private end = 0;
  private onDone: (() => void) | null = null;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'lily2d';
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d')!;
    this.el.append(this.canvas);
  }

  // 还在放吗
  get busy(): boolean {
    return this.clock < this.end;
  }

  // 在 at（这一层里的坐标：结算里那张和了牌）放；base 是这一手的基本点，done 是放完以后叫一声
  bloom(at: { x: number; y: number }, base: number, done?: () => void): void {
    this.onDone = done ?? null;
    if (reduced()) {
      done?.();
      return;
    }
    const grand = lilyGrand(base);
    this.grand = grand;
    this.origin = at;
    this.dir = Math.random() < 0.5 ? 1 : -1;
    const w = this.el.clientWidth || 1040;
    const h = this.el.clientHeight || 800;
    const t0 = this.clock;
    this.start = t0;
    const reach = Math.min(w, h) * (0.42 + 0.3 * grand);
    this.reach = reach;

    // 风痕：里面的粗、短，外面的细、长
    this.streaks = [];
    for (let i = 0; i < 54; i++) {
      const rho = 0.12 + 0.88 * Math.random() ** 0.8;
      this.streaks.push({ rho, a0: rand(0, Math.PI * 2), len: rand(0.7, 2.4) * (0.6 + 0.6 * rho), wide: rand(0.02, 0.055) * (1.25 - 0.5 * rho), k: Math.random() });
    }
    this.rays = [];
    for (let i = 0; i < 12; i++) this.rays.push({ a: (i / 12) * Math.PI * 2 + rand(-0.2, 0.2), len: rand(0.5, 1), wide: rand(1.5, 3.5) });

    // 花瓣：被风从牌边卷起来，一片片陆续起飞；头两三片大的飘得远
    const petals = lilyCount(base);
    for (let i = 0; i < petals; i++) {
      const big = i < 2 + Math.round(2 * grand);
      this.queue.push({ at: t0 + 0.06 + (i / petals) * 0.5 + rand(0, 0.08), fn: () => this.whirl(big) });
    }

    // 星光：一半绕着牌往上冒，一半跟着风撒开（不撒到画面外面）
    const stars = lilyStars(base);
    const near = Math.round(stars * 0.45);
    for (let i = 0; i < stars; i++) {
      const a = rand(0, Math.PI * 2);
      const close = i < near;
      const d = close ? rand(8, 130) : Math.sqrt(rand(0.03, 1)) * reach * 1.05;
      const x = at.x + Math.cos(a) * d;
      const y = at.y + Math.sin(a) * d * (close ? 0.9 : SQUASH + 0.15) - (close ? rand(0, 50) : rand(0, 70));
      if (x < 8 || x > w - 8 || y < 8 || y > h - 8) continue;
      const born = close ? t0 + 0.1 + rand(0, 1) ** 1.4 * (1.3 + 0.7 * grand) : t0 + 0.16 + (d / reach) * 0.4 + rand(0, 0.9 + 0.5 * grand);
      const sp = close ? rand(10, 70) : rand(4, 26);
      this.stars.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - rand(6, close ? 60 : 20), born, life: close ? rand(0.6, 1.3) : rand(0.8, 1.7), size: rand(13, 28) * (1 + 0.25 * grand), phase: rand(0, 6.28), speed: rand(5, 12) });
    }
    this.end = t0 + 2.8 + 0.9 * grand;
    this.kick();
  }

  private kick(): void {
    if (this.raf) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  private tick(now: number): void {
    this.raf = 0;
    if (!this.el.isConnected) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.step(dt);
    if (this.busy) this.raf = requestAnimationFrame((t) => this.tick(t));
    else {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      const done = this.onDone;
      this.onDone = null;
      done?.();
    }
  }

  // 往前走 dt 秒再画一帧（调试、截图也用）
  step(dt: number): void {
    this.clock += dt;
    const due = this.queue.filter((q) => q.at <= this.clock);
    this.queue = this.queue.filter((q) => q.at > this.clock);
    for (const q of due) q.fn();
    const live: Petal[] = [];
    for (const p of this.petals) {
      const age = this.clock - p.born;
      if (age > p.life) continue;
      // 花瓣很轻：被风带着绕牌转一小段，然后慢慢飘、左右晃
      const rx = p.x - this.origin.x;
      const ry = p.y - this.origin.y;
      const sw = (this.dir * 900 * Math.exp(-age * 1.6)) / (Math.hypot(rx, ry) + 60);
      p.vx += -ry * sw * dt;
      p.vy += rx * sw * dt;
      p.vy += 40 * dt;
      const drag = Math.exp(-1.6 * dt);
      p.vx *= drag;
      p.vy *= drag;
      p.x += (p.vx + Math.sin(age * 3.1 + p.phase) * p.sway) * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      p.flip += p.flipSpeed * dt;
      live.push(p);
    }
    this.petals = live;
    this.stars = this.stars.filter((s) => this.clock < s.born + s.life);
    this.draw();
  }

  // 一片被旋风卷起来的花瓣：从牌边顺着风转的方向甩出去；big 是飞得远的大片
  private whirl(big: boolean): void {
    const a = rand(0, Math.PI * 2);
    const ox = Math.cos(a);
    const oy = Math.sin(a);
    const sp = rand(150, 320) * (big ? 1.5 : 1);
    const out = rand(60, 170) * (big ? 1.6 : 1);
    this.petals.push({
      x: this.origin.x + ox * rand(16, 50),
      y: this.origin.y + oy * rand(10, 34),
      vx: -oy * sp * this.dir + ox * out,
      vy: (ox * sp * this.dir + oy * out) * 0.75 - rand(40, 140),
      rot: rand(0, 6.28),
      spin: rand(-5, 5),
      flip: rand(0, 6.28),
      flipSpeed: rand(3, 7),
      sway: rand(20, 55),
      phase: rand(0, 6.28),
      size: big ? rand(34, 46) : rand(18, 30),
      born: this.clock,
      life: big ? rand(2, 2.7) : rand(1.3, 2.2),
    });
  }

  private draw(): void {
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (this.start < 0) return;
    const t = this.clock - this.start;
    const out = Math.min(1, Math.max(0, (this.end - this.clock) / 0.5));
    const { x: ox, y: oy } = this.origin;

    this.drawVortex(t);

    // 牌上的光：白光一闪、几道光芒往外一冲，薄荷绿的光留着慢慢暗
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const mintLife = 2.2 + 0.9 * this.grand;
    if (t < mintLife) {
      const k = t / mintLife;
      const a = Math.min(1, t / 0.14) * (1 - Math.max(0, (k - 0.45) / 0.55) ** 1.5) * (0.88 + 0.12 * Math.sin(t * 7));
      const r = (120 + 60 * this.grand) * (0.8 + 0.2 * Math.min(1, t / 0.3));
      const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, r);
      g.addColorStop(0, `rgba(190,255,225,${(0.85 * a).toFixed(3)})`);
      g.addColorStop(0.3, `rgba(125,255,196,${(0.5 * a).toFixed(3)})`);
      g.addColorStop(1, 'rgba(125,255,196,0)');
      ctx.fillStyle = g;
      ctx.fillRect(ox - r, oy - r, r * 2, r * 2);
    }
    if (t < 0.42) {
      const k = t / 0.42;
      const a = Math.min(1, k / 0.12) * (1 - Math.max(0, (k - 0.3) / 0.7)) ** 1.6;
      const grow = 1 - (1 - Math.min(1, k / 0.35)) ** 3;
      const r = (110 + 60 * this.grand) * (0.45 + 0.55 * grow);
      const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, r);
      g.addColorStop(0, `rgba(255,255,255,${a.toFixed(3)})`);
      g.addColorStop(0.35, `rgba(255,255,255,${(0.6 * a).toFixed(3)})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(ox - r, oy - r, r * 2, r * 2);
      ctx.fillStyle = `rgba(242,255,248,${(0.8 * a).toFixed(3)})`;
      for (const ray of this.rays) {
        const len = (170 + 80 * this.grand) * ray.len * (0.25 + 0.75 * grow);
        ctx.save();
        ctx.translate(ox, oy);
        ctx.rotate(ray.a);
        ctx.beginPath();
        ctx.moveTo(0, -ray.wide);
        ctx.lineTo(len, 0);
        ctx.lineTo(0, ray.wide);
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.restore();

    // 花瓣：半透明，中间白、两头薄荷绿
    for (const p of this.petals) {
      const age = this.clock - p.born;
      const k = Math.min(1, age / 0.14) * Math.min(1, (p.life - age) / (p.life * 0.4)) ** 0.7;
      if (k <= 0) continue;
      const len = p.size * k;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      // 翻面：横着压扁
      ctx.scale(0.25 + 0.75 * Math.abs(Math.cos(p.flip)), 1);
      this.petalPath(len, 0.36);
      const g = ctx.createLinearGradient(0, 0, 0, -len);
      g.addColorStop(0, 'rgba(120,235,170,0.8)');
      g.addColorStop(0.4, 'rgba(232,255,242,0.82)');
      g.addColorStop(1, 'rgba(130,240,185,0.6)');
      ctx.fillStyle = g;
      ctx.globalAlpha = out;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(0, -len * 0.08);
      ctx.lineTo(0, -len * 0.85);
      ctx.stroke();
      ctx.restore();
    }

    // 星光：一闪一闪，慢慢往上飘
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const sprite = star();
    for (const s of this.stars) {
      const age = this.clock - s.born;
      if (age < 0) continue;
      const k = age / s.life;
      const tw = 0.5 + 0.5 * Math.sin(age * s.speed + s.phase);
      const a = smooth(0, 0.1, k) * (1 - smooth(0.55, 1, k)) * (0.35 + 0.65 * tw) * out;
      if (a <= 0.01) continue;
      // 冒出来的劲很快被拖住
      const m = (1 - Math.exp(-2 * age)) / 2;
      const size = s.size * (0.65 + 0.35 * tw);
      ctx.globalAlpha = a;
      ctx.drawImage(sprite, s.x + s.vx * m - size / 2, s.y + s.vy * m - 8 * age - size / 2, size, size);
    }
    ctx.restore();
  }

  // 旋风：前沿一开始冲得快、越来越慢；风痕一开始粗得连成一片，越扩越细、弱的先没；中间慢慢空出来，靠里的染上薄荷绿
  private drawVortex(t: number): void {
    const dur = 1.5 + 0.25 * this.grand;
    if (t >= dur) return;
    const ctx = this.ctx;
    const front = this.reach * (0.07 + 0.93 * (1 - Math.exp(-3.3 * t)));
    const turn = (3.6 * (1 - Math.exp(-1.8 * t)) + 0.7 * t) * this.dir;
    const thin = smooth(0.1, 0.95, t);
    const fade = smooth(0, 0.04, t) * (1 - smooth(dur * 0.5, dur, t));
    const hollow = 0.5 * smooth(0.15, 1, t);
    const thr = 0.55 * thin;
    ctx.save();
    ctx.translate(this.origin.x, this.origin.y);
    ctx.scale(1, SQUASH);
    // 刚炸开的那一下：中间一团厚厚的白
    const core = 1 - smooth(0.05, 0.32, t);
    if (core > 0) {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, front * 0.9);
      g.addColorStop(0, `rgba(255,255,255,${(0.9 * core * fade).toFixed(3)})`);
      g.addColorStop(0.6, `rgba(255,255,255,${(0.6 * core * fade).toFixed(3)})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, front * 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
    const green = smooth(0.08, 0.35, t);
    for (const s of this.streaks) {
      const a = smooth(thr - 0.12, thr + 0.12, s.k + 0.12) * smooth(hollow * 0.45, hollow, s.rho) * fade;
      if (a <= 0.01) continue;
      const mint = (1 - smooth(0.1, 0.75, s.rho)) * green * 0.75;
      const col = `${Math.round(255 - 130 * mint)},255,${Math.round(255 - 59 * mint)}`;
      const wide = front * s.wide * (1.5 - 1.15 * thin);
      // 画两遍：外面一圈淡的、里面一道实的，边上就是软的
      for (const [mul, alpha] of [[1.9, 0.22], [1, 0.62]] as const) {
        ctx.fillStyle = `rgba(${col},${(alpha * a * (0.5 + 0.5 * s.rho)).toFixed(3)})`;
        ctx.beginPath();
        const n = 14;
        for (let pass = 0; pass < 2; pass++) {
          for (let i = 0; i <= n; i++) {
            const u = pass === 0 ? i / n : 1 - i / n;
            const phi = u * s.len;
            const ang = s.a0 + turn + phi * this.dir;
            // 两头尖、中间鼓的一笔
            const half = wide * mul * Math.sin(Math.PI * u) ** 0.7 * (pass === 0 ? 1 : -1);
            const r = front * s.rho * Math.exp(-PITCH * phi) + half;
            const x = Math.cos(ang) * r;
            const y = Math.sin(ang) * r;
            if (pass === 0 && i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
        }
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // 一片花瓣：根在原点、往上（-y）长 len，最宽处在四成的地方，尖头
  private petalPath(len: number, wide: number): void {
    const ctx = this.ctx;
    const w = len * wide;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(w * 0.9, -len * 0.12, w * 1.15, -len * 0.62, 0, -len);
    ctx.bezierCurveTo(-w * 1.15, -len * 0.62, -w * 0.9, -len * 0.12, 0, 0);
    ctx.closePath();
  }
}
