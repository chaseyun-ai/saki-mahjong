import { lilyCount, lilyFieldCount, lilyGrand } from '../ui3d/lilyFx';

// 2D 牌桌上宫永咲的岭上开花，和 3D 的（ui3d/lilyFx.ts）同一个样子：
// 结算里那张和了牌砸下去的一下，牌上开出一朵百合（六片花被、六根雄蕊顶着橙色花药），四周一圈圈冒出小百合，
// 花瓣从花里迸出来、打着转飘落，一圈白光贴着画面扫出去。和得越大花越大、小百合和花瓣越多（按基本点）。
// 画在一张盖在结算上面的 canvas 上，放完自己收起来。

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
  tint: number;
}

interface Flower {
  x: number;
  y: number;
  size: number;
  born: number;
  fall: number; // 开多久以后谢（花被变成花瓣飞走）
  turn: number;
  shed: boolean;
  main: boolean;
}

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const TINTS = ['#ffffff', '#fff6f9', '#fffaf0', '#fdeef4'];

export class Lily2D {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private petals: Petal[] = [];
  private flowers: Flower[] = [];
  private queue: { at: number; fn: () => void }[] = [];
  private clock = 0;
  private raf = 0;
  private last = 0;
  private origin = { x: 0, y: 0 };
  private ringAt = -1;
  private grand = 0;
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

  // 在 at（这一层里的坐标：结算里那张和了牌）开花；base 是这一手的基本点，done 是放完以后叫一声
  bloom(at: { x: number; y: number }, base: number, done?: () => void): void {
    this.onDone = done ?? null;
    if (reduced()) {
      done?.();
      return;
    }
    const grand = lilyGrand(base);
    this.grand = grand;
    this.origin = at;
    const w = this.el.clientWidth || 1040;
    const h = this.el.clientHeight || 800;
    const t0 = this.clock;
    const size = 44 + 46 * grand;
    this.flowers.push({ x: at.x, y: at.y - size * 0.25, size, born: t0, fall: 1.5 + 0.9 * grand, turn: rand(0, 1), shed: false, main: true });
    this.ringAt = t0;
    // 花瓣：2D 上花瓣大，片数取 3D 的六成
    const total = Math.round(lilyCount(base) * 0.6);
    const first = Math.round(total * 0.5);
    this.queue.push({ at: t0 + 0.06, fn: () => this.burst(first, size) });
    const streamTime = 0.6 + 1.2 * grand;
    const puffs = Math.max(1, Math.round(streamTime / 0.07));
    for (let i = 0; i < puffs; i++) {
      const n = Math.round(((i + 1) * (total - first)) / puffs) - Math.round((i * (total - first)) / puffs);
      if (n > 0) this.queue.push({ at: t0 + 0.22 + (i * streamTime) / puffs, fn: () => this.rise(n, size) });
    }
    // 四周的小百合：一圈圈往外开（往画面里面开得远），不开到画面外面
    const n = lilyFieldCount(base);
    const reach = Math.min(w, h) * (0.22 + 0.5 * grand);
    for (let i = 0, tries = 0, made = 0; made < n && tries < n * 12; tries++, i++) {
      const u = (i + 0.6 + Math.random() * 0.5) / n;
      const a = ((i * 0.618 + Math.random() * 0.12) % 1) * Math.PI * 2;
      const r = size * 1.3 + (reach - size * 1.3) * Math.sqrt(Math.min(1, u));
      const x = at.x + Math.cos(a) * r * 1.25;
      const y = at.y + Math.sin(a) * r * 0.8;
      if (x < 24 || x > w - 24 || y < 24 || y > h - 24) continue;
      made++;
      const s = size * rand(0.3, 0.5);
      this.queue.push({
        at: t0 + 0.12 + r * 0.0016 + Math.random() * 0.08,
        fn: () => {
          this.flowers.push({ x, y, size: s, born: this.clock, fall: 1.5 + 0.9 * grand + Math.random() * 0.5, turn: rand(0, 1), shed: false, main: false });
          this.puff(x, y, 3 + Math.round(3 * grand), s);
        },
      });
    }
    // 役满起：整个画面上空下一场花瓣雨
    if (grand > 0.85) {
      for (let i = 0; i < 12; i++) this.queue.push({ at: t0 + 0.5 + i * 0.18, fn: () => this.rain(Math.round(total * 0.03), w) });
    }
    this.end = t0 + 3.6 + 1.8 * grand;
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
    const h = this.el.clientHeight || 800;
    const live: Petal[] = [];
    for (const p of this.petals) {
      const age = this.clock - p.born;
      if (age > p.life || p.y > h + 60) continue;
      // 重力往下、空气阻力压得很慢（花瓣是飘的），左右晃
      p.vy += 150 * dt;
      const drag = Math.exp(-2.2 * dt);
      p.vx *= drag;
      p.vy *= drag;
      p.x += (p.vx + Math.sin(age * 3.1 + p.phase) * p.sway) * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      p.flip += p.flipSpeed * dt;
      live.push(p);
    }
    this.petals = live;
    for (const f of this.flowers) {
      if (!f.shed && this.clock - f.born > f.fall) {
        f.shed = true;
        // 花被脱落：变成几片大花瓣飞走
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + f.turn;
          this.spawn(f.x + Math.cos(a) * f.size * 0.4, f.y + Math.sin(a) * f.size * 0.4, Math.cos(a) * rand(60, 150), Math.sin(a) * rand(60, 150) - rand(40, 120), f.size * 0.42, rand(2.2, 3.2));
        }
      }
    }
    this.flowers = this.flowers.filter((f) => this.clock - f.born < f.fall + 0.4);
    this.draw();
  }

  private spawn(x: number, y: number, vx: number, vy: number, size: number, life = rand(2.6, 4)): void {
    if (this.petals.length > 520) return;
    this.petals.push({
      x,
      y,
      vx,
      vy,
      rot: rand(0, Math.PI * 2),
      spin: rand(1.5, 5) * (Math.random() < 0.5 ? -1 : 1),
      flip: rand(0, Math.PI * 2),
      flipSpeed: rand(2, 6),
      sway: rand(18, 60),
      phase: rand(0, Math.PI * 2),
      size,
      born: this.clock,
      life,
      tint: Math.floor(Math.random() * TINTS.length),
    });
  }

  // 花开的一下：往四周、偏上迸开一圈
  private burst(n: number, size: number): void {
    const { x, y } = this.origin;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(260, 620 + 420 * this.grand);
      this.spawn(x + Math.cos(a) * size * 0.3, y + Math.sin(a) * size * 0.3, Math.cos(a) * sp, Math.sin(a) * sp * 0.8 - rand(120, 360), rand(13, 21) + 5 * this.grand);
    }
  }

  // 从花心一股股往上冒
  private rise(n: number, size: number): void {
    const { x, y } = this.origin;
    for (let i = 0; i < n; i++) {
      this.spawn(x + rand(-0.4, 0.4) * size, y + rand(-0.3, 0.1) * size, rand(-260, 260), -rand(420, 760 + 620 * this.grand), rand(13, 21) + 5 * this.grand);
    }
  }

  private puff(x: number, y: number, n: number, size: number): void {
    for (let i = 0; i < n; i++) this.spawn(x, y, rand(-120, 120), -rand(120, 300), Math.max(9, size * 0.5), rand(1.6, 2.6));
  }

  private rain(n: number, w: number): void {
    for (let i = 0; i < n; i++) this.spawn(rand(0, w), -20, rand(-40, 40), rand(30, 90), rand(14, 22), rand(3.5, 5));
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
    const out = Math.min(1, Math.max(0, (this.end - this.clock) / 0.6));
    ctx.globalAlpha = out;
    // 扫出去的一圈白光
    const rk = this.clock - this.ringAt;
    if (this.ringAt >= 0 && rk < 0.9) {
      const k = rk / 0.9;
      const r = (60 + 620 * (1 - (1 - k) ** 2)) * (0.7 + 0.5 * this.grand);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(255,250,240,${(0.55 * (1 - k) ** 1.5).toFixed(3)})`;
      ctx.lineWidth = 16 * (1 - k) + 2;
      ctx.beginPath();
      ctx.ellipse(this.origin.x, this.origin.y, r, r * 0.62, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    // 小百合在下、大的在上
    for (const f of [...this.flowers].sort((a, b) => Number(a.main) - Number(b.main))) this.drawFlower(f);
    for (const p of this.petals) {
      const age = this.clock - p.born;
      const k = Math.min(1, age / 0.12) * Math.min(1, (p.life - age) / 0.6);
      if (k <= 0) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      // 翻面：横着压扁
      ctx.scale(0.25 + 0.75 * Math.abs(Math.cos(p.flip)), 1);
      this.petalPath(p.size * k, 0.42);
      ctx.fillStyle = TINTS[p.tint];
      ctx.shadowColor = 'rgba(255,220,230,0.55)';
      ctx.shadowBlur = 5;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(214,150,170,0.45)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
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

  private drawFlower(f: Flower): void {
    const ctx = this.ctx;
    const k = this.clock - f.born;
    // 0.38 秒开到最大（稍微张过头再回来），之后慢慢转、轻轻呼吸；到时候谢掉
    const open = k < 0.38 ? 1 - (1 - k / 0.38) ** 3 : 1;
    const over = k < 0.6 ? Math.sin(Math.PI * Math.min(1, k / 0.6)) * 0.14 : 0;
    const fade = k > f.fall ? Math.max(0, 1 - (k - f.fall) / 0.4) : 1;
    if (fade <= 0) return;
    const s = f.size * (0.3 + 0.7 * (open + over)) * (1 + 0.03 * Math.sin(k * 3.2));
    ctx.save();
    ctx.translate(f.x, f.y - f.size * 0.2 * (1 - Math.exp(-k * 1.5)));
    ctx.globalAlpha *= fade;
    // 花后面一团暖白的光
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 2.1);
    const ga = (k < 0.1 ? k / 0.1 : Math.exp(-(k - 0.1) * 1.4) * 0.6 + 0.3) * (f.main ? 0.9 : 0.55);
    glow.addColorStop(0, `rgba(255,252,240,${ga.toFixed(3)})`);
    glow.addColorStop(0.35, `rgba(255,240,225,${(ga * 0.45).toFixed(3)})`);
    glow.addColorStop(1, 'rgba(255,240,225,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, s * 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.rotate(f.turn * Math.PI * 2 + k * 0.25);
    // 六片花被：外三片宽一点先画，里三片窄一点压在上面；根部黄绿、往上白、尖上一点粉
    for (const outer of [true, false]) {
      for (let i = 0; i < 3; i++) {
        ctx.save();
        ctx.rotate(((i * 2 + (outer ? 0 : 1)) * Math.PI) / 3);
        const len = s * (outer ? 1 : 0.94);
        const g = ctx.createLinearGradient(0, 0, 0, -len);
        g.addColorStop(0, '#cfe08e');
        g.addColorStop(0.22, '#f1f5d8');
        g.addColorStop(0.5, '#fffdf8');
        g.addColorStop(0.85, '#fdf0f3');
        g.addColorStop(1, '#f6cfdc');
        this.petalPath(len, outer ? 0.36 : 0.3);
        ctx.fillStyle = g;
        ctx.shadowColor = 'rgba(40,30,60,0.35)';
        ctx.shadowBlur = f.main ? 8 : 3;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(190,150,165,0.55)';
        ctx.lineWidth = f.main ? 1.2 : 0.8;
        ctx.stroke();
        // 中肋
        ctx.strokeStyle = 'rgba(170,200,110,0.5)';
        ctx.lineWidth = f.main ? 1.4 : 0.8;
        ctx.beginPath();
        ctx.moveTo(0, -len * 0.08);
        ctx.lineTo(0, -len * 0.7);
        ctx.stroke();
        ctx.restore();
      }
    }
    // 雄蕊：六根细丝顶着橙色的花药
    const st = Math.min(1, k / 0.3);
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3 + 0.5;
      const r = s * 0.42 * st;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      ctx.strokeStyle = '#e4ecbe';
      ctx.lineWidth = Math.max(0.8, s * 0.025);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a + Math.PI / 2);
      ctx.fillStyle = '#c85a1c';
      ctx.beginPath();
      ctx.ellipse(0, 0, Math.max(1.6, s * 0.075), Math.max(0.9, s * 0.035), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = '#cfe08a';
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(1.5, s * 0.06), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
