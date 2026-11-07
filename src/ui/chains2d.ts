import { BREAK, ChainOutcome, FADE, FAINT, GOLD, LOCK, LinkSpot, QUICK_LOCK, chainLinks, chainPlan, clamp01, dissolveAt, easeIn, easeInOut, easeOut, lockTime, outcomeTime } from './riiChainPlan';
import { ChainLook, chainLook } from './riiLook';

// 白水哩的番缚（2D 牌桌）：同 3D 一样的锁链画在一张盖住整个画面的 canvas 上（只画在牌桌里，不挡点击）。
// 布局和时间见 riiChainPlan.ts，锁链的样子见 riiLook.ts。平躺的一节画成椭圆环、立着的一节画成一根短杠，
// 交替着看上去扣在一起。

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  life: number;
  color: string;
  r: number;
}

type Stage = { kind: 'lock'; t0: number; quick: boolean } | { kind: ChainOutcome; t0: number; shown: number };

interface Built {
  links: LinkSpot[];
  length: number;
  contactS: number;
  start: number;
  clanks: number;
}

class SeatChains {
  stage: Stage;
  lockedAt: number;
  done = false;
  rose = false;
  built: Built[] | null = null;
  builtFor = '';
  dusted = new Set<string>();
  constructor(
    readonly n: number,
    readonly rect: () => Rect | null,
    now: number,
    mode: 'lock' | 'quick' | 'settled',
    readonly look: ChainLook,
  ) {
    const quick = mode !== 'lock';
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
  // 截图测试：不按真实时间走（见 advance）
  private manual = false;

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

  // 锁好以后锁链已经消散了（结算时要重新射出来）
  vanished(seat: number): boolean {
    const sc = this.seats.get(seat);
    return !!sc && sc.stage.kind === 'lock' && this.opacity(sc) < 0.02;
  }

  styleOf(seat: number): string | null {
    return this.seats.get(seat)?.look.id ?? null;
  }

  lock(seat: number, n: number, rect: () => Rect | null, mode: 'lock' | 'quick' | 'settled', look = chainLook()): void {
    this.seats.set(seat, new SeatChains(n, rect, this.now, this.reduced && mode === 'lock' ? 'settled' : mode, look));
    this.kick();
  }

  finish(seat: number, kind: ChainOutcome, delay = 0): void {
    const sc = this.seats.get(seat);
    if (!sc) return;
    const go = () => {
      if (this.seats.get(seat) !== sc || sc.stage.kind !== 'lock') return;
      sc.stage = { kind, t0: this.now, shown: this.opacity(sc) };
      this.kick();
    };
    if (this.manual) this.pending.push({ at: this.now + delay / 1000, fn: go });
    else window.setTimeout(go, delay);
  }

  private pending: { at: number; fn: () => void }[] = [];
  // 正在画的那个座位的锁链样子
  private look: ChainLook = chainLook();

  remainingMs(seat: number, kind: ChainOutcome): number {
    return this.seats.has(seat) ? outcomeTime(kind) * 1000 : 0;
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

  // 调试用：按固定步长快进再画一帧
  advance(sec: number): void {
    this.manual = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (let t = 0; t < sec - 1e-6; t += 1 / 30) {
      this.now += 1 / 30;
      const due = this.pending.filter((p) => this.now >= p.at);
      this.pending = this.pending.filter((p) => this.now < p.at);
      due.forEach((p) => p.fn());
      this.draw(1 / 30);
    }
  }

  private kick(): void {
    if (this.raf || this.manual) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  private loop = (t: number): void => {
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    this.now += dt;
    this.draw(dt);
    // 只剩淡淡箍着的锁链：不用每帧画（app 重画牌桌时会叫 redraw）
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

  private build(sc: SeatChains, r: Rect, W: number, H: number): Built[] {
    const key = `${Math.round(r.w)}x${Math.round(r.h)}`;
    if (sc.built && sc.builtFor === key) return sc.built;
    const look = sc.look;
    const link = r.h * 0.42 * look.size;
    const dims = { width: r.w, depth: r.h * 0.5, far: Math.hypot(W, H) * 0.9, pitch: link * (0.58 * look.stretch - 0.28 * look.thick) };
    const quick = sc.stage.kind === 'lock' && sc.stage.quick;
    const gap = quick ? QUICK_LOCK / Math.max(1, sc.n) / 3 : LOCK.stagger;
    sc.built = chainPlan(sc.n).map((line, i) => {
      const b = chainLinks(line, dims);
      return { links: b.links, length: b.length, contactS: b.contactS, start: i * gap, clanks: quick ? 2 : 0 };
    });
    sc.builtFor = key;
    return sc.built;
  }

  private drawSeat(sc: SeatChains, r: Rect, W: number, H: number): void {
    const chains = this.build(sc, r, W, H);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const link = r.h * 0.42 * sc.look.size;
    this.look = sc.look;
    const sx = (l: LinkSpot) => cx + l.p[0];
    const sy = (l: LinkSpot) => cy - l.p[1];
    const st = sc.stage;
    const t = this.now - st.t0;
    const draw = (fn: (l: LinkSpot, k: number, ci: number) => void) => chains.forEach((c, ci) => c.links.forEach((l, k) => fn(l, k, ci)));
    const at = (c: Built) => c.links[Math.round((c.contactS / c.length) * (c.links.length - 1))];
    if (st.kind === 'lock') {
      const op = this.opacity(sc);
      const fly = st.quick ? QUICK_LOCK * 0.6 : LOCK.fly;
      for (const c of chains) {
        const u = (t - c.start) / fly;
        if (c.clanks === 0 && easeOut(u) * c.length >= c.contactS) {
          c.clanks = 1;
          const l = at(c);
          if (l) this.burst(sx(l), sy(l), '#e8eeff', 16, link * 5, 0.45);
        }
      }
      draw((l, k, ci) => {
        const c = chains[ci];
        const u = (t - c.start) / fly;
        if (u <= 0) return;
        const head = easeOut(u) * c.length;
        if (l.s > head) return;
        // 压住时绷一下
        const since = t - c.start - fly;
        const j = since > 0 ? Math.exp(-since * 7) * Math.sin(since * 26) * link * 0.12 * Math.exp(-Math.abs(l.s - c.contactS) / (r.w * 0.4)) : 0;
        this.link(sx(l) + l.t[1] * j, sy(l) + l.t[0] * j, l.t[0], -l.t[1], link, k, op, 0, 0);
      });
      return;
    }
    if (st.kind === 'fade') {
      const op = FAINT * (1 - clamp01(t / FADE));
      draw((l, k) => this.link(sx(l), sy(l), l.t[0], -l.t[1], link, k, op, 0, 0));
      if (t > FADE) sc.done = true;
      return;
    }
    if (st.kind === 'key') {
      const { show, sweep, crack, rise } = GOLD;
      const op = st.shown + (1 - st.shown) * easeOut(t / show);
      const ts = t - show;
      const tc = ts - sweep;
      if (tc <= 0) {
        draw((l, k, ci) => {
          const c = chains[ci];
          const front = easeInOut(ts / sweep) * (Math.max(W, H) * 0.7 + link * 2);
          const d = front - Math.abs(l.s - c.contactS);
          const hot = d > 0 && d < link * 2 ? 1 - d / (link * 2) : 0;
          this.link(sx(l), sy(l), l.t[0], -l.t[1], link, k, op, clamp01(d / (link * 1.2)), hot);
        });
        return;
      }
      if (!sc.rose) {
        sc.rose = true;
        for (const c of chains) {
          const l = at(c);
          if (l) this.burst(sx(l), sy(l), '#ffe7a8', 20, link * 6, 0.6);
        }
      }
      this.rise(chains, tc, crack, rise, link, sx, sy, true, () => true);
      if (tc - crack > rise) sc.done = true;
      return;
    }
    // 崩断：绷紧发白，一节节化成粒子消散，剩下的化成光冲上天
    const { show, crack, dissolve, rise, keep } = BREAK;
    const op = st.shown + (1 - st.shown) * easeOut(t / show);
    const tc = t - show;
    const td = tc - crack;
    if (td <= dissolve) {
      const k0 = clamp01(tc / crack);
      draw((l, k, ci) => {
        const r0 = dissolveAt(ci, k);
        let scale = 1;
        if (r0 < 1 - keep && td > 0) {
          const when = (r0 / (1 - keep)) * dissolve;
          scale = 1 - clamp01((td - when) / 0.08);
          const id = `${ci}-${k}`;
          if (td >= when && !sc.dusted.has(id)) {
            sc.dusted.add(id);
            this.dust(sx(l), sy(l), link);
          }
        }
        if (scale <= 0) return;
        const j = Math.sin(k * 2.3 + t * 70) * k0 * link * 0.06 * (1 - clamp01(td / 0.3));
        this.link(sx(l) + l.t[1] * j, sy(l) + l.t[0] * j, l.t[0], -l.t[1], link * scale, k, op, 0, 0, k0 * 0.8 + (td > 0 ? 0.3 : 0));
      });
      return;
    }
    this.rise(chains, td - dissolve, 0, rise, link, sx, sy, false, (ci, k) => dissolveAt(ci, k) >= 1 - keep);
    if (td > dissolve + rise) sc.done = true;
  }

  // 碎成两片半环、先弹开一点，再越来越快冲上天，拖着光
  private rise(chains: Built[], tc: number, crack: number, rise: number, link: number, sx: (l: LinkSpot) => number, sy: (l: LinkSpot) => number, gold: boolean, who: (ci: number, k: number) => boolean): void {
    const ctx = this.ctx;
    const tr = tc - crack;
    const far = Math.max(window.innerHeight, 600) * 1.3;
    const fade = 1 - clamp01((tr / rise - 0.7) / 0.3);
    chains.forEach((c, ci) =>
      c.links.forEach((l, k) => {
        if (!who(ci, k)) return;
        for (let side = 0; side < 2; side++) {
          const h = hash(ci * 977 + k * 2 + side);
          const h2 = hash(ci * 313 + k * 5 + side + 7);
          const pos = (x: number) => {
            const dr = 1 - Math.exp(-x * 7);
            const y = easeIn(clamp01((x - crack) / rise)) * far * (0.8 + h * 0.5);
            return [sx(l) + (h - 0.5) * link * 1.6 * dr + (h2 - 0.5) * y * 0.35, sy(l) + (h2 - 0.5) * link * 1.6 * dr - y];
          };
          const [x, y] = pos(tc);
          if (tr > 0) {
            const [bx, by] = pos(Math.max(0, tc - 0.09));
            ctx.globalCompositeOperation = 'lighter';
            ctx.strokeStyle = gold ? `rgba(255,182,64,${0.8 * fade})` : `rgba(200,220,255,${0.8 * fade})`;
            ctx.lineWidth = Math.max(1.5, link * 0.1);
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(bx, by);
            ctx.stroke();
            ctx.globalCompositeOperation = 'source-over';
          }
          const ang = Math.atan2(-l.t[1], l.t[0]) + (side ? Math.PI : 0) + (h - 0.5) * 6 * tc;
          this.half(x, y, ang, link * (1 - 0.4 * clamp01(tr / rise)), fade, k, gold);
        }
      }),
    );
  }

  // 一节锁链。gold：0 铁色到 1 金色；hot：刚变金那一下发白；pale：发白光（崩断前）
  private link(x: number, y: number, dx: number, dy: number, len: number, k: number, alpha: number, gold: number, hot: number, pale = 0): void {
    if (alpha <= 0.01 || len <= 0.5) return;
    const ctx = this.ctx;
    const look = this.look;
    const spirit = look.glow > 0.5;
    const c0 = mix(rgb(look.color).map((v) => v * 0.72), [255, 197, 72], gold);
    const c = mix(mix(c0, [255, 246, 220], hot), [235, 242, 255], pale);
    const dark = spirit ? rgb(look.dark).map((v) => Math.round(v * 0.6)) : c.map((v) => Math.round(v * 0.42));
    const light = c.map((v) => Math.round(v + (255 - v) * 0.65));
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(dy, dx));
    ctx.globalAlpha = alpha;
    // 粗细、长短照挑的样子；0.29 是钢链的粗细
    const th = Math.max(2, len * 0.22 * (look.thick / 0.29));
    const rx = len * 0.56 * (look.stretch / 1.38) ** 0.5;
    const ry = (rx * 0.79) / look.stretch;
    if (spirit && gold < 0.5 && pale < 0.5) {
      // 光之锁链：一圈柔光衬在后面
      ctx.shadowColor = look.glowColor;
      ctx.shadowBlur = len * 0.45;
    }
    if (k % 2 === 0) {
      // 平躺的一节：椭圆环，外沿一圈暗、上沿一道亮
      ctx.lineWidth = th + 2;
      ctx.strokeStyle = `rgba(${dark.join(',')},${spirit ? 0.55 : 0.95})`;
      ctx.beginPath();
      if (look.square) ctx.roundRect(-rx, -ry, rx * 2, ry * 2, ry * 0.42);
      else ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = th;
      ctx.shadowBlur = 0;
      const g = ctx.createLinearGradient(0, -ry, 0, ry);
      g.addColorStop(0, `rgb(${light.join(',')})`);
      g.addColorStop(0.45, `rgb(${c.join(',')})`);
      g.addColorStop(1, `rgb(${dark.join(',')})`);
      ctx.strokeStyle = g;
      ctx.stroke();
    } else {
      // 立着的一节：从侧面看是一根两头圆的短杠
      ctx.lineCap = 'round';
      ctx.lineWidth = th * 1.5 + 2;
      ctx.strokeStyle = `rgba(${dark.join(',')},${spirit ? 0.55 : 0.95})`;
      ctx.beginPath();
      ctx.moveTo(-rx * 0.9, 0);
      ctx.lineTo(rx * 0.9, 0);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.lineWidth = th * 1.5;
      ctx.strokeStyle = `rgb(${c.join(',')})`;
      ctx.stroke();
      ctx.lineWidth = th * 0.45;
      ctx.strokeStyle = `rgb(${light.join(',')})`;
      ctx.beginPath();
      ctx.moveTo(-rx * 0.75, -th * 0.25);
      ctx.lineTo(rx * 0.75, -th * 0.25);
      ctx.stroke();
    }
    const glow = Math.max(gold > 0.5 ? gold * 0.25 : 0, pale * 0.3, spirit ? 0.18 : 0);
    if (glow > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha * glow;
      ctx.fillStyle = pale > gold && pale > 0 ? '#cfe0ff' : gold > 0.5 ? '#ffb83a' : look.glowColor;
      ctx.beginPath();
      ctx.ellipse(0, 0, len * 0.75, len * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 碎开的半环（金色的、发白光的）
  private half(x: number, y: number, ang: number, len: number, alpha: number, k: number, gold: boolean): void {
    if (alpha <= 0.01 || len <= 0.5) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.globalAlpha = alpha;
    ctx.lineWidth = Math.max(2.5, len * 0.22);
    ctx.lineCap = 'round';
    ctx.strokeStyle = gold ? (k % 2 ? '#ffd76a' : '#f2b640') : k % 2 ? '#f2f6ff' : '#d6e2ff';
    ctx.shadowColor = gold ? 'rgba(255,170,40,0.9)' : 'rgba(170,200,255,0.9)';
    ctx.shadowBlur = len * 0.5;
    ctx.beginPath();
    if (this.look.square) {
      // 方形链环的半片：一个「冂」
      const w = len * 0.5;
      const h = len * 0.32;
      ctx.moveTo(-w, 0);
      ctx.lineTo(-w, -h);
      ctx.lineTo(w, -h);
      ctx.lineTo(w, 0);
    } else ctx.ellipse(0, 0, len * 0.56, len * 0.32, 0, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
    ctx.restore();
  }

  private burst(x: number, y: number, color: string, count: number, speed: number, life: number): void {
    if (this.reduced) return;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.3 + Math.random());
      this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: life * (0.6 + Math.random() * 0.4), color, r: 1.6 });
    }
  }

  // 一节锁链化成的尘埃：细细的一团，慢慢往上飘着散开
  private dust(x: number, y: number, link: number): void {
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = link * (0.4 + Math.random() * 1.4);
      this.sparks.push({ x: x + (Math.random() - 0.5) * link * 0.6, y: y + (Math.random() - 0.5) * link * 0.4, vx: Math.cos(a) * v, vy: Math.sin(a) * v - link * 1.5, t: 0, life: 0.6 + Math.random() * 0.5, color: '#dfe7f5', r: 1.2 + Math.random() });
    }
  }

  private drawSparks(dt: number): void {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'lighter';
    const drag = Math.exp(-dt * 3);
    for (const s of this.sparks) {
      s.t += dt;
      s.vx *= drag;
      s.vy *= drag;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      ctx.globalAlpha = 1 - clamp01(s.t / s.life) ** 2;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    this.sparks = this.sparks.filter((s) => s.t < s.life);
  }
}

function rgb(hex: string): number[] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: number[], b: number[], t: number): number[] {
  return a.map((v, i) => Math.round(v + (b[i] - v) * clamp01(t)));
}

// 0..1 的伪随机（每帧要一样）
function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
