import { BREAK, ChainLine, ChainOutcome, FADE, FAINT, GOLD, LOCK, QUICK_LOCK, chainPlan, clamp01, easeInOut, easeOut, goldTime, linkOffsets, lockTime } from './riiChainPlan';
import { keyArt } from './keyArt';

// 白水哩的番缚（2D 牌桌）：同 3D 一样的锁链画在一张盖住整个画面的 canvas 上（不挡点击）。
// 布局和时间见 riiChainPlan.ts。锁链一节一节画：平躺的一节画成椭圆环，立着的一节画成一根短杠，
// 交替着看上去是扣在一起的。碎开时一节变两个半环，按初速度、自转和重力解析地算位置。

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Chain2 {
  line: ChainLine;
  dx: number;
  dy: number;
  start: number;
  clanked: boolean;
  shards?: { vx: number; vy: number; spin: number }[];
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  life: number;
  color: string;
}

type Stage = { kind: 'lock'; t0: number; quick: boolean } | { kind: ChainOutcome; t0: number; shown: number };

class SeatChains {
  chains: Chain2[];
  stage: Stage;
  lockedAt: number;
  done = false;
  flashed = false;
  cracked = false;
  tag = '';
  constructor(
    readonly n: number,
    readonly rect: () => Rect | null,
    now: number,
    mode: 'lock' | 'quick' | 'settled',
  ) {
    const quick = mode !== 'lock';
    const gap = quick ? QUICK_LOCK / Math.max(1, n) / 2 : LOCK.stagger;
    // 屏幕坐标 y 朝下：夹角往上算
    this.chains = chainPlan(n).map((line, i) => ({ line, dx: Math.cos(line.angle), dy: -Math.sin(line.angle), start: i * gap, clanked: quick }));
    const t0 = mode === 'settled' ? now - 99 : now;
    this.stage = { kind: 'lock', t0, quick };
    this.lockedAt = t0 + (quick ? QUICK_LOCK : lockTime(n) + LOCK.hold);
  }
}

export class Chains2D {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private seats = new Map<number, SeatChains>();
  private sparks: Spark[] = [];
  private raf = 0;
  private last = 0;
  private now = 0;
  private reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // clip：只画在牌桌里面（2D 牌桌两边是空的深色底）
  constructor(host: HTMLElement, private clip: () => DOMRect | null = () => null) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'rii-chains';
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }

  has(seat: number): boolean {
    return this.seats.has(seat);
  }

  lock(seat: number, n: number, rect: () => Rect | null, mode: 'lock' | 'quick' | 'settled'): void {
    this.seats.set(seat, new SeatChains(n, rect, this.now, this.reduced && mode === 'lock' ? 'settled' : mode));
    this.kick();
  }

  finish(seat: number, kind: ChainOutcome, delay = 0, tag = ''): void {
    const sc = this.seats.get(seat);
    if (!sc) return;
    sc.tag = tag;
    window.setTimeout(() => {
      if (this.seats.get(seat) !== sc || sc.stage.kind !== 'lock') return;
      sc.stage = { kind, t0: this.now, shown: this.opacity(sc) };
      sc.flashed = false;
      if (kind === 'broken') {
        let seed = 7;
        const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
        for (const c of sc.chains) c.shards = Array.from({ length: 200 }, () => ({ vx: (rnd() - 0.5) * 2, vy: -0.6 - rnd() * 1.2, spin: (rnd() * 2 - 1) * 12 }));
      }
      this.kick();
    }, delay);
  }

  // 还要放多久（毫秒），算结算什么时候弹出来用
  remainingMs(seat: number, kind: ChainOutcome): number {
    const total = kind === 'key' ? goldTime() : kind === 'broken' ? BREAK.show + BREAK.crack + BREAK.scatter : FADE;
    return this.seats.has(seat) ? total * 1000 : 0;
  }

  clear(): void {
    this.seats.clear();
    this.sparks = [];
    this.draw();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.canvas.remove();
  }

  private kick(): void {
    if (this.raf) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  private loop = (t: number): void => {
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    this.now += dt;
    this.draw(dt);
    // 只剩淡淡挂着的锁链：不用每帧画（窗口大小变了 app 会再叫一次 redraw）
    const moving = this.sparks.length > 0 || [...this.seats.values()].some((s) => s.stage.kind !== 'lock' || this.now < s.lockedAt + LOCK.dim + 0.1);
    this.raf = moving && this.canvas.isConnected ? requestAnimationFrame(this.loop) : 0;
  };

  redraw(): void {
    this.draw();
  }

  private opacity(sc: SeatChains): number {
    if (sc.stage.kind !== 'lock') return 1;
    return 1 + (FAINT - 1) * easeInOut((this.now - sc.lockedAt) / LOCK.dim);
  }

  private draw(dt = 0): void {
    const c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = window.innerWidth;
    const H = window.innerHeight;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    const box = this.clip();
    if (box) {
      ctx.beginPath();
      ctx.rect(box.x, box.y, box.width, box.height);
      ctx.clip();
    }
    for (const [seat, sc] of [...this.seats]) {
      const r = sc.rect();
      if (!r) continue;
      // 左右两家的手牌竖着：整套转 90 度画
      if (r.h > r.w * 1.5) {
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(Math.PI / 2);
        ctx.translate(-cx, -cy);
        this.drawSeat(sc, { x: cx - r.h / 2, y: cy - r.w / 2, w: r.h, h: r.w }, W, H);
        ctx.restore();
      } else this.drawSeat(sc, r, W, H);
      if (sc.done) this.seats.delete(seat);
    }
    this.drawSparks(dt);
    ctx.restore();
  }

  private drawSeat(sc: SeatChains, r: Rect, W: number, H: number): void {
    const size = Math.max(14, Math.min(r.w / 12, r.h * 0.75));
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const len = Math.hypot(W, H);
    const link = size * 0.72;
    const pitch = link * 0.8;
    const offs = linkOffsets(len, pitch);
    const st = sc.stage;
    const t = this.now - st.t0;
    const key = { x: cx, y: cy - size * 3.6, len: Math.min(r.w * 0.68, size * 11) };
    if (st.kind === 'lock') {
      const op = this.opacity(sc);
      const fly = st.quick ? QUICK_LOCK / 2 : LOCK.fly;
      for (const ch of sc.chains) {
        const u = (t - ch.start) / fly;
        if (u <= 0) continue;
        const p = easeOut(u);
        const head = ch.line.from * len * (1 - 2 * p);
        const ox = cx + ch.line.x * r.w;
        if (!ch.clanked && p >= 0.5) {
          ch.clanked = true;
          this.burst(ox, cy, '#e8eeff', 22, size * 6, 0.5);
        }
        const since = t - ch.start - fly;
        const wob = since > 0 ? Math.exp(-since * 7) * Math.sin(since * 38) * size * 0.2 : 0;
        for (let k = 0; k < offs.length; k++) {
          const s = offs[k];
          if (ch.line.from === 1 ? s < head : s > head) continue;
          const bend = wob * Math.cos((s / len) * Math.PI * 0.5);
          this.link(ox + ch.dx * s - ch.dy * bend, cy + ch.dy * s + ch.dx * bend, ch.dx, ch.dy, link, k, op, 0, 0);
        }
      }
      return;
    }
    if (st.kind === 'fade') {
      const op = FAINT * (1 - clamp01(t / FADE));
      for (const ch of sc.chains) for (let k = 0; k < offs.length; k++) this.link(cx + ch.line.x * r.w + ch.dx * offs[k], cy + ch.dy * offs[k], ch.dx, ch.dy, link, k, op, 0, 0);
      if (t > FADE) sc.done = true;
      return;
    }
    if (st.kind === 'broken') {
      const op = st.shown + (1 - st.shown) * easeOut(t / BREAK.show);
      const tc = t - BREAK.show;
      const tf = tc - BREAK.crack;
      for (const ch of sc.chains) {
        const ox = cx + ch.line.x * r.w;
        if (tf <= 0) {
          const k0 = clamp01(tc / BREAK.crack);
          for (let k = 0; k < offs.length; k++) {
            const j = Math.sin(k * 2.3 + t * 70) * k0 * size * 0.08;
            this.link(ox + ch.dx * offs[k] - ch.dy * j, cy + ch.dy * offs[k] + ch.dx * j, ch.dx, ch.dy, link, k, op, 0, k0 * 0.7);
          }
          continue;
        }
        if (!ch.shards!.length) continue;
        if (tf < 1 / 60 + 0.001 || !sc.flashed) this.burst(ox, cy, '#dfe6f5', 36, size * 9, 0.8);
        const a = 1 - clamp01((tf / BREAK.scatter - 0.45) / 0.55);
        const g = size * 14;
        for (let k = 0; k < offs.length * 2 && k < ch.shards!.length; k++) {
          const sh = ch.shards![k];
          const s = offs[k >> 1];
          const sign = Math.sign(s || 1);
          const x = ox + ch.dx * s + (ch.dx * sign * 3 + sh.vx * 5) * size * tf;
          const y = cy + ch.dy * s + (ch.dy * sign * 3 + sh.vy * 4) * size * tf + 0.5 * g * tf * tf;
          const ang = Math.atan2(ch.dy, ch.dx) + sh.spin * tf + (k % 2 ? Math.PI : 0);
          this.half(x, y, ang, link, a, k >> 1);
        }
      }
      if (tf > 0) sc.flashed = true;
      if (tf > BREAK.scatter) sc.done = true;
      return;
    }
    // 钥匙（照原作的顺序）：变金 → 碎成金色碎片 → 拖着光汇到一点 → 放射的光和星光 → 钥匙
    const { show, sweep, crack, gather, burst, hold, fade } = GOLD;
    const op = st.shown + (1 - st.shown) * easeOut(t / show);
    const ts = t - show;
    const tc = ts - sweep;
    const tg = tc - crack;
    const tb = tg - gather;
    const front = easeInOut(ts / sweep) * (len * 0.6);
    const ctx = this.ctx;
    if (tc > 0 && !sc.cracked) {
      sc.cracked = true;
      for (const ch of sc.chains) this.burst(cx + ch.line.x * r.w, cy, '#ffd36a', 26, size * 7, 0.7);
    }
    for (const ch of sc.chains) {
      const ox = cx + ch.line.x * r.w;
      if (tc <= 0) {
        for (let k = 0; k < offs.length; k++) {
          const s = offs[k];
          const d = front - Math.abs(s);
          const gold = clamp01(d / (size * 1.6));
          const hot = d > 0 && d < size * 2.4 ? 1 - d / (size * 2.4) : 0;
          this.link(ox + ch.dx * s, cy + ch.dy * s, ch.dx, ch.dy, link, k, op, gold, hot);
        }
        continue;
      }
      if (tb > 0) continue;
      for (let k = 0; k < offs.length * 2; k++) {
        const s = offs[k >> 1];
        const h = hash(k + ch.start * 1000);
        const h2 = hash(k * 3 + 11);
        // 飘开的方向：垂直锁链往两边、顺着锁链一点
        const vx = (-ch.dy * (h - 0.5) * 4 + ch.dx * (h2 - 0.5) * 2) * size;
        const vy = (ch.dx * (h - 0.5) * 4 + ch.dy * (h2 - 0.5) * 2) * size;
        const dr = (x: number) => (1 - Math.exp(-x * 3)) / 3;
        const hx = ox + ch.dx * s;
        const hy = cy + ch.dy * s;
        let x = hx + vx * dr(tc);
        let y = hy + vy * dr(tc);
        let sz = link;
        if (tg > 0) {
          const fx = hx + vx * dr(crack);
          const fy = hy + vy * dr(crack);
          const lag = (Math.abs(s) / (len * 0.6)) * 0.35;
          const at = (u: number) => {
            const e = clamp01((u - lag) / 0.65) ** 3;
            return [fx + (key.x - fx) * e, fy + (key.y - fy) * e];
          };
          const u = tg / gather;
          [x, y] = at(u);
          const [bx, by] = at(u - 0.22);
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = 'rgba(255,182,64,0.75)';
          ctx.lineWidth = Math.max(1.5, size * 0.08);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(bx, by);
          ctx.stroke();
          ctx.globalCompositeOperation = 'source-over';
          sz = link * Math.max(0.05, 1 - 0.85 * clamp01(u) ** 2);
        }
        const ang = Math.atan2(ch.dy, ch.dx) + (k % 2 ? Math.PI : 0) + (h2 - 0.5) * 10 * tc;
        this.half(x, y, ang, sz, 1, k, true);
      }
    }
    if (tb <= 0) return;
    if (!sc.flashed) {
      sc.flashed = true;
      this.burst(key.x, key.y, '#fff1c0', 70, size * 11, 1.1);
    }
    const out = clamp01((tb - burst - hold) / fade);
    const a = 1 - out;
    const ky = key.y - out * size * 1.4;
    // 放射的光
    ctx.save();
    ctx.translate(key.x, key.y);
    ctx.rotate(tb * 0.25);
    ctx.globalCompositeOperation = 'lighter';
    const R = key.len * 0.95 * easeOut(tb / 0.45);
    for (let i = 0; i < 28; i++) {
      const ang = (i / 28) * Math.PI * 2;
      const w = 0.025 + (i % 4) * 0.012;
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
      g.addColorStop(0, `rgba(255,246,214,${0.6 * a})`);
      g.addColorStop(1, 'rgba(255,190,80,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R * (0.7 + (i % 5) * 0.06), ang - w, ang + w);
      ctx.closePath();
      ctx.fill();
    }
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.6);
    core.addColorStop(0, `rgba(255,240,200,${0.55 * a})`);
    core.addColorStop(1, 'rgba(255,200,100,0)');
    ctx.fillStyle = core;
    ctx.fillRect(-R, -R, R * 2, R * 2);
    ctx.restore();
    // 星光
    for (let i = 0; i < 14; i++) {
      const ang = (i / 14) * Math.PI * 2 + i * 0.7;
      const rr = 0.35 + ((i * 37) % 10) / 16;
      const tw = Math.max(0, Math.sin(tb * 4 + i * 1.3));
      this.star(key.x + Math.cos(ang) * rr * key.len, key.y + Math.sin(ang) * rr * key.len * 0.55, key.len * (0.03 + ((i * 13) % 5) * 0.009) * (0.3 + tw) * easeOut(tb / 0.4), a * tw);
    }
    // 钥匙：光炸开一会儿以后从斜着转正
    const tk = tb - burst * 0.5;
    if (tk > 0) {
      const kl = key.len * backOut(tk / 0.45) * (1 + out * 0.12);
      const art = keyArt(sc.n, sc.tag);
      ctx.save();
      ctx.translate(key.x, ky + Math.sin(tk * 2.2) * size * 0.1);
      ctx.rotate(-((1 - easeOut(tk / 0.6)) * 0.9 + 0.12));
      ctx.globalAlpha = a;
      ctx.shadowColor = 'rgba(255,170,40,0.9)';
      ctx.shadowBlur = size * (0.8 + 0.4 * Math.sin(tk * 5) ** 2);
      const kh = (kl * art.height) / art.width;
      ctx.drawImage(art, -kl / 2, -kh / 2, kl, kh);
      ctx.restore();
    }
    if (out >= 1) sc.done = true;
  }

  // 四角的星光
  private star(x: number, y: number, r: number, alpha: number): void {
    if (alpha <= 0.01) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#fffbe8';
    for (const rot of [0, Math.PI / 2]) {
      ctx.rotate(rot);
      ctx.beginPath();
      ctx.moveTo(-r, 0);
      ctx.quadraticCurveTo(0, -r * 0.08, r, 0);
      ctx.quadraticCurveTo(0, r * 0.08, -r, 0);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 一节锁链。gold：0 钢色到 1 金色；hot：刚变金那一下发白
  private link(x: number, y: number, dx: number, dy: number, len: number, k: number, alpha: number, gold: number, hot: number): void {
    if (alpha <= 0.01) return;
    const ctx = this.ctx;
    const c0 = mix([142, 151, 166], [255, 197, 72], gold);
    const c = mix(c0, [255, 246, 220], hot);
    const dark = c.map((v) => Math.round(v * 0.45));
    const light = c.map((v) => Math.round(v + (255 - v) * 0.6));
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(dy, dx));
    ctx.globalAlpha = alpha;
    const th = Math.max(2, len * 0.2);
    if (k % 2 === 0) {
      // 平躺的一节：椭圆环，外沿一圈暗、里面一道亮
      ctx.lineWidth = th + 2;
      ctx.strokeStyle = `rgba(${dark.join(',')},0.9)`;
      ctx.beginPath();
      ctx.ellipse(0, 0, len * 0.55, len * 0.3, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = th;
      const g = ctx.createLinearGradient(0, -len * 0.3, 0, len * 0.3);
      g.addColorStop(0, `rgb(${light.join(',')})`);
      g.addColorStop(0.5, `rgb(${c.join(',')})`);
      g.addColorStop(1, `rgb(${dark.join(',')})`);
      ctx.strokeStyle = g;
      ctx.stroke();
    } else {
      // 立着的一节：从侧面看是一根两头圆的短杠
      ctx.lineCap = 'round';
      ctx.lineWidth = th * 1.5 + 2;
      ctx.strokeStyle = `rgba(${dark.join(',')},0.9)`;
      ctx.beginPath();
      ctx.moveTo(-len * 0.5, 0);
      ctx.lineTo(len * 0.5, 0);
      ctx.stroke();
      ctx.lineWidth = th * 1.5;
      ctx.strokeStyle = `rgb(${c.join(',')})`;
      ctx.stroke();
      ctx.lineWidth = th * 0.45;
      ctx.strokeStyle = `rgb(${light.join(',')})`;
      ctx.beginPath();
      ctx.moveTo(-len * 0.42, -th * 0.25);
      ctx.lineTo(len * 0.42, -th * 0.25);
      ctx.stroke();
    }
    if (gold > 0.5) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha * 0.25 * gold;
      ctx.fillStyle = '#ffb83a';
      ctx.beginPath();
      ctx.ellipse(0, 0, len * 0.75, len * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 碎开的半环
  private half(x: number, y: number, ang: number, len: number, alpha: number, k: number, gold = false): void {
    if (alpha <= 0.01) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.globalAlpha = alpha;
    ctx.lineWidth = Math.max(2, len * 0.2);
    ctx.lineCap = 'round';
    ctx.strokeStyle = gold ? (k % 2 ? '#ffd76a' : '#f2b640') : k % 2 ? '#aab2c0' : '#8e97a6';
    if (gold) {
      ctx.shadowColor = 'rgba(255,170,40,0.9)';
      ctx.shadowBlur = len * 0.5;
    }
    ctx.beginPath();
    ctx.ellipse(0, 0, len * 0.55, len * 0.3, 0, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
    ctx.restore();
  }

  private burst(x: number, y: number, color: string, count: number, speed: number, life: number): void {
    if (this.reduced) return;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.3 + Math.random());
      this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: life * (0.6 + Math.random() * 0.4), color });
    }
  }

  private drawSparks(dt: number): void {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    const drag = Math.exp(-dt * 4);
    for (const s of this.sparks) {
      s.t += dt;
      s.vx *= drag;
      s.vy *= drag;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      const a = 1 - clamp01(s.t / s.life) ** 2;
      ctx.globalAlpha = a;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    this.sparks = this.sparks.filter((s) => s.t < s.life);
  }
}

function mix(a: number[], b: number[], t: number): number[] {
  return a.map((v, i) => Math.round(v + (b[i] - v) * clamp01(t)));
}

function backOut(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = clamp01(t);
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

// 0..1 的伪随机（碎片飘的方向每帧要一样）
function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
