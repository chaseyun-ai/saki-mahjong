// 2D 牌桌上薄墨初美的里鬼门，照动画原作，和 3D 的（ui3d/gale.ts）同一个样子：
// 紫色的风绕着牌桌打转、往里卷，四周暗成星空；和牌时桌心炸开白光，紫色的风像喷泉一样往上张开。
// 风丝画在一张 canvas 上：每条是两头细、中间粗的笔触，先铺一层紫晕再描一道白芯（叠加混合）。

const STREAKS = 150;
const SEG = 14;
const RAYS = 120;
const PALETTE: [number, number, number][] = [
  [217, 60, 255],
  [226, 85, 255],
  [184, 60, 255],
  [255, 79, 216],
  [201, 76, 255],
  [239, 107, 255],
];

interface Streak {
  rank: number;
  seed: number;
  theta: number;
  omega: number;
  phase: number;
  inward: number;
  span: number;
  width: number;
  wobble: number;
  col: [number, number, number];
}

interface Ray {
  angle: number;
  speed: number;
  len: number;
  width: number;
  delay: number;
  bend: number;
  col: [number, number, number];
}

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// 平滑的一维噪声
function hash(n: number): number {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}
function noise(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash(i) * (1 - u) + hash(i + 1) * u;
}

export class Gale2D {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private voidEl: HTMLDivElement;
  private streaks: Streak[] = [];
  private rays: Ray[] = [];
  private level = 0;
  private shown = 0;
  private release = 0;
  private releasing = false;
  private burstT = -1;
  private clock = 0;
  private raf = 0;
  private last = 0;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'gale2d';
    this.voidEl = document.createElement('div');
    this.voidEl.className = 'gale-void';
    this.voidEl.innerHTML = Array.from({ length: 50 }, () => {
      let x = 0;
      let y = 0;
      do {
        x = Math.random();
        y = Math.random();
      } while (((x - 0.5) / 0.4) ** 2 + ((y - 0.5) / 0.38) ** 2 < 1);
      const d = 1.5 + Math.random() * 3;
      return `<i style="left:${(x * 100).toFixed(1)}%;top:${(y * 100).toFixed(1)}%;--s:${(1 + Math.random() * 2).toFixed(1)}px;animation-duration:${d.toFixed(2)}s;animation-delay:${(-Math.random() * d).toFixed(2)}s"></i>`;
    }).join('');
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d')!;
    this.el.append(this.voidEl, this.canvas);
    for (let s = 0; s < STREAKS; s++) {
      this.streaks.push({
        rank: (s * 0.61803) % 1,
        seed: Math.random() * 100,
        theta: Math.random() * Math.PI * 2,
        omega: 0.5 + Math.random() * 0.7,
        phase: Math.random(),
        inward: 0.05 + Math.random() * 0.1,
        span: 0.3 + Math.random() * 0.9,
        width: 4 + Math.pow(Math.random(), 1.5) * 13,
        wobble: 0.004 + Math.random() * 0.018,
        col: PALETTE[Math.floor(Math.random() * PALETTE.length)],
      });
    }
    for (let i = 0; i < RAYS; i++) {
      this.rays.push({
        // 大多往上（画面上方），往两边张开
        angle: -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * (0.3 + Math.random() * 0.7),
        speed: 900 + Math.random() * 1400,
        len: 120 + Math.random() * 380,
        width: 3 + Math.random() * 12,
        delay: Math.random() * 0.3,
        bend: (Math.random() - 0.5) * 0.6,
        col: PALETTE[i % PALETTE.length],
      });
    }
  }

  setLevel(level: number): void {
    const v = Math.max(0, Math.min(1, level));
    if (v > 0 && this.level === 0) {
      this.releasing = false;
      this.release = 0;
    }
    this.level = v;
    this.kick();
  }

  // 和牌：风甩散，桌心炸开喷泉（盖在牌桌上面放完）
  burst(): void {
    if (this.shown > 0.01) this.releasing = true;
    this.burstT = 0;
    this.el.classList.add('burst');
    this.kick();
  }

  private kick(): void {
    if (this.raf || reduced()) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  private tick(now: number): void {
    this.raf = 0;
    if (!this.el.isConnected) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.shown += (this.level - this.shown) * (1 - Math.exp(-dt * 1.2));
    if (this.level === 0 && this.shown < 0.01) this.shown = 0;
    if (this.releasing) this.release = Math.min(1, this.release + dt / 1.4);
    if (this.burstT >= 0) {
      this.burstT += dt;
      if (this.burstT > 2.4) {
        this.burstT = -1;
        this.el.classList.remove('burst');
      }
    }
    this.clock += dt * (0.7 + 0.6 * this.shown);
    const amount = this.shown * (1 - this.release);
    this.voidEl.style.opacity = (amount * 0.85).toFixed(3);
    this.draw(amount);
    if (amount > 0.002 || this.burstT >= 0 || (this.releasing && this.release < 1) || Math.abs(this.level - this.shown) > 0.002) {
      this.raf = requestAnimationFrame((t) => this.tick(t));
    }
  }

  private draw(amount: number): void {
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
    ctx.globalCompositeOperation = 'lighter';
    const cx = w / 2;
    const cy = h / 2;
    const outer = Math.hypot(w, h) * 0.62;
    const inner = Math.min(w, h) * 0.12;
    const t = this.clock;
    const rel = this.release * this.release;
    if (amount > 0.002 || (this.releasing && this.release < 1)) {
      const fade = Math.min(1, this.shown * 3) * (1 - this.release);
      for (const s of this.streaks) {
        const on = Math.max(0, Math.min(1, (this.shown - s.rank) * 6));
        if (on <= 0) continue;
        const life = (s.phase + t * s.inward * 0.8) % 1;
        const lifeA = smooth(0, 0.12, life) * (1 - smooth(0.82, 1, life));
        const alpha = on * lifeA * fade;
        if (alpha < 0.01) continue;
        const r = outer + (inner - outer) * Math.pow(life, 0.8);
        const th = s.theta + t * s.omega * (0.6 + ((0.9 * outer) / Math.max(r, 1)) * 0.35);
        const pts: [number, number, number][] = [];
        for (let k = 0; k <= SEG; k++) {
          const u = k / SEG;
          const a = th - u * s.span;
          let rr = r * (1 + u * s.span * 0.2);
          rr += (noise(u * 2.6 + s.seed + t * 0.35) - 0.5) * s.wobble * outer;
          rr *= 1 + rel * 1.6;
          const taper = Math.pow(Math.sin(Math.PI * u), 0.55) * (1 - 0.45 * u);
          pts.push([cx + Math.sin(a) * rr, cy - Math.cos(a) * rr, taper]);
        }
        this.stroke(pts, s.width, s.col, alpha);
      }
    }
    if (this.burstT >= 0) this.drawBurst(cx, cy, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }

  // 一条笔触：紫晕（宽、淡）+ 白芯（窄、亮）
  private stroke(pts: [number, number, number][], width: number, col: [number, number, number], alpha: number): void {
    const ctx = this.ctx;
    const band = (scale: number, style: string) => {
      const left: [number, number][] = [];
      const right: [number, number][] = [];
      for (let i = 0; i < pts.length; i++) {
        const [x, y, tp] = pts[i];
        const [x2, y2] = pts[Math.min(pts.length - 1, i + 1)];
        const [x0, y0] = pts[Math.max(0, i - 1)];
        let dx = x2 - x0;
        let dy = y2 - y0;
        const l = Math.hypot(dx, dy) || 1;
        dx /= l;
        dy /= l;
        const hw = width * scale * tp * 0.5;
        left.push([x - dy * hw, y + dx * hw]);
        right.push([x + dy * hw, y - dx * hw]);
      }
      ctx.beginPath();
      ctx.moveTo(left[0][0], left[0][1]);
      for (const p of left) ctx.lineTo(p[0], p[1]);
      for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
      ctx.closePath();
      ctx.fillStyle = style;
      ctx.fill();
    };
    const [r, g, b] = col;
    band(2.2, `rgba(${r},${g},${b},${(alpha * 0.22).toFixed(3)})`);
    band(1, `rgba(${r},${g},${b},${(alpha * 0.55).toFixed(3)})`);
    band(0.3, `rgba(255,232,255,${(alpha * 0.7).toFixed(3)})`);
  }

  // 和牌的喷泉：从桌心偏下往上、往两边张开，中心一团白光
  private drawBurst(cx: number, cy: number, w: number, h: number): void {
    const ctx = this.ctx;
    const T = this.burstT;
    const fade = Math.pow(Math.max(0, 1 - T / 2.2), 1.4);
    const ox = cx;
    const oy = cy + h * 0.12;
    for (const r of this.rays) {
      const t = Math.max(0, T - r.delay);
      if (t <= 0) continue;
      const head = (r.speed * (1 - Math.exp(-t * 2.4))) / 2.4;
      const tail = Math.max(0, head - r.len);
      const pts: [number, number, number][] = [];
      for (let k = 0; k <= 10; k++) {
        const u = k / 10;
        const d = head + (tail - head) * u;
        const a = r.angle + (d / 900) * r.bend;
        pts.push([ox + Math.cos(a) * d, oy + Math.sin(a) * d, Math.pow(Math.sin(Math.PI * u), 0.5) * (1 - 0.3 * u)]);
      }
      this.stroke(pts, r.width * (1 + head / 800), r.col, fade * (1 + 1.5 * Math.exp(-head / 200)));
    }
    // 白光
    const a = Math.min(1, T * 10) * Math.pow(Math.max(0, 1 - T / 1.5), 1.5);
    const R = Math.max(w, h) * (0.35 + T * 0.2);
    const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, R);
    g.addColorStop(0, `rgba(255,250,255,${a})`);
    g.addColorStop(0.25, `rgba(245,190,255,${a * 0.8})`);
    g.addColorStop(0.6, `rgba(190,70,255,${a * 0.35})`);
    g.addColorStop(1, 'rgba(120,30,200,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
