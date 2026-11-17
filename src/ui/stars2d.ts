// 2D 牌桌上大星淡的星空，和 3D、2.5D 的（ui3d/starFx.ts）同一个意思：
// 双立直的立直棒一落，金色的光圈从她那边扫开，扫过的桌面变成夜空；她头像旁边挂一颗四芒星，写着再摸几张到转角
// （被鸣牌错开了就暗下去）；转角暗杠时这颗星化成流星落到杠子上；杠里时四颗流星从里宝牌指示牌飞到杠的四张牌上。
// 技能发动的光圈、流星、北斗七星也画在这里。
// 夜空是一层铺在牌底下的 div（CSS 画星云，星星是一颗颗会闪的小点）；流星、闪光画在盖在最上面的 canvas 上。

export interface Pt {
  x: number;
  y: number;
}

interface Flare {
  at: Pt;
  size: number;
  dur: number;
  t: number;
  color: string;
  peak: number;
  grow: number;
}

interface Comet {
  from: Pt;
  to: Pt;
  t: number;
  dur: number;
  lift: number;
  size: number;
  trail: number;
  head: string;
  tail: string;
  delay: number;
  onHit?: () => void;
}

interface Ring {
  at: Pt;
  radius: number;
  dur: number;
  t: number;
  color: string;
  delay: number;
  inward: boolean;
}

interface Figure {
  points: Pt[];
  links: [number, number][];
  t: number;
  gap: number;
}

const GOLD = '#ffd36b';
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export class Stars2D {
  readonly sky: HTMLDivElement;
  readonly fx: HTMLDivElement;
  private beacon: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private on = false;
  private flares: Flare[] = [];
  private comets: Comet[] = [];
  private rings: Ring[] = [];
  private fig: Figure | null = null;
  private beaconLast: Pt | null = null; // 这一局星最后挂在哪（她摸走转角那张以后星收起来了，暗杠的流星还从这里出发）
  private raf = 0;
  private ticking = false;
  private last = 0;
  private clock = 0;

  constructor() {
    this.sky = document.createElement('div');
    this.sky.className = 'stars2d-sky';
    this.reseed();
    this.fx = document.createElement('div');
    this.fx.className = 'stars2d-fx';
    this.beacon = document.createElement('div');
    this.beacon.className = 'stars2d-beacon';
    this.beacon.innerHTML = '<span class="star"></span><b></b>';
    this.beacon.hidden = true;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d')!;
    this.fx.append(this.canvas, this.beacon);
  }

  get active(): boolean {
    return this.on;
  }

  // 换一片夜空，每一局开始换一次：星云的位置和色调、银河的方向、每颗星的位置都重新随机。
  // 星分两层，各自慢慢转（快慢、方向每局不同），彼此的位置一直在变；有几颗大星隔一阵闪一下十字光
  reseed(): void {
    const r = Math.random;
    const stars = (n: number) =>
      Array.from({ length: n }, () => {
        const d = 1.6 + r() * 3.4;
        const big = r() < 0.12;
        const glint = big && r() < 0.5;
        const g = 7 + r() * 14;
        return `<i class="${big ? 'big' : ''}${glint ? ' glint' : ''}${r() < 0.25 ? ' gold' : ''}" style="left:${(r() * 100).toFixed(1)}%;top:${(r() * 100).toFixed(1)}%;--s:${(big ? 3 + r() * 2 : 1 + r() * 1.6).toFixed(1)}px;--g:${g.toFixed(1)}s;--gd:${(-r() * g).toFixed(1)}s;animation-duration:${d.toFixed(2)}s;animation-delay:${(-r() * d).toFixed(2)}s"></i>`;
      }).join('');
    const dir = r() < 0.5 ? 'normal' : 'reverse';
    const turn = 500 + r() * 400;
    this.sky.innerHTML =
      `<div class="stars2d-neb" style="--n1x:${(15 + r() * 70).toFixed(0)}%;--n1y:${(15 + r() * 70).toFixed(0)}%;--n2x:${(15 + r() * 70).toFixed(0)}%;--n2y:${(15 + r() * 70).toFixed(0)}%;--n3x:${(15 + r() * 70).toFixed(0)}%;--n3y:${(15 + r() * 70).toFixed(0)}%;--hue:${(-45 + r() * 80).toFixed(0)}deg"></div>` +
      `<div class="stars2d-layer" style="--turn:${turn.toFixed(0)}s;--from:${(r() * 360).toFixed(0)}deg;animation-direction:${dir}"><div class="stars2d-band" style="--band:${(r() * 180).toFixed(0)}deg"></div>${stars(170)}</div>` +
      `<div class="stars2d-layer" style="--turn:${(turn * (0.45 + r() * 0.2)).toFixed(0)}s;--from:${(r() * 360).toFixed(0)}deg;animation-direction:${dir}">${stars(150)}</div>`;
  }

  // 流星：夜空开着时隔几秒划过一颗（画在夜空这一层里，在牌底下）
  private meteorTimer = 0;
  private meteor(): void {
    window.clearTimeout(this.meteorTimer);
    if (!this.on || reduced()) return;
    this.meteorTimer = window.setTimeout(() => {
      if (this.on && this.sky.isConnected) {
        const el = document.createElement('div');
        el.className = 'stars2d-meteor';
        const a = Math.random() * Math.PI * 2;
        const len = 180 + Math.random() * 260;
        el.style.cssText = `left:${(10 + Math.random() * 80).toFixed(1)}%;top:${(10 + Math.random() * 80).toFixed(1)}%;--a:${a.toFixed(3)}rad;--dx:${(Math.cos(a) * len).toFixed(0)}px;--dy:${(Math.sin(a) * len).toFixed(0)}px;--d:${(0.6 + Math.random() * 0.5).toFixed(2)}s`;
        el.addEventListener('animationend', () => el.remove());
        this.sky.append(el);
      }
      this.meteor();
    }, 2500 + Math.random() * 6000);
  }

  // 屏幕上的一点换成这一层里的坐标（牌桌整个缩放过）
  local(x: number, y: number): Pt {
    const box = this.fx.getBoundingClientRect();
    const k = box.width > 0 ? this.fx.offsetWidth / box.width : 1;
    return { x: (x - box.left) * k, y: (y - box.top) * k };
  }

  // 一个元素的正中在这一层里的坐标
  center(el: Element | null | undefined): Pt | null {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return this.local(r.left + r.width / 2, r.top + r.height / 2);
  }

  get middle(): Pt {
    return { x: this.fx.offsetWidth / 2, y: this.fx.offsetHeight / 2 };
  }

  // 夜空铺着没有。不经过宣言直接铺上（比如中途重画）就不放光圈；关掉时慢慢淡出
  setOn(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    if (on && !this.sky.classList.contains('open')) {
      this.sky.style.setProperty('--x', '50%');
      this.sky.style.setProperty('--y', '50%');
      this.sky.classList.add('open', 'instant');
    }
    if (!on) {
      this.sky.classList.remove('open', 'instant');
      this.beacon.hidden = true;
    }
    this.meteor();
  }

  // 双立直宣言：金色的光圈从 at 扫过整张桌子，扫过的地方变成夜空
  declare(at: Pt): void {
    this.on = true;
    const w = this.fx.offsetWidth || 1;
    const h = this.fx.offsetHeight || 1;
    this.sky.style.setProperty('--x', `${((at.x / w) * 100).toFixed(1)}%`);
    this.sky.style.setProperty('--y', `${((at.y / h) * 100).toFixed(1)}%`);
    this.sky.classList.remove('open', 'instant');
    // 先落回没铺开的样子，下一帧再铺，过渡才会走
    void this.sky.offsetWidth;
    this.sky.classList.add('open');
    this.flare(at, 150, 1.2, GOLD, 1, 0.8);
    this.flare(at, 70, 0.6, '#ffffff', 0.8, 0.3);
    this.ring(at, Math.hypot(w, h) * 0.5, 0.9, '#ffe9a8');
  }

  // 转角的星：挂在 at（一般是她头像的角上），n 是她再摸几张到转角；lost 被错开了。at 给 null 就收起来
  setBeacon(at: Pt | null, n = 0, lost = false): void {
    if (!at || !this.on) {
      this.beacon.hidden = true;
      return;
    }
    this.beacon.hidden = false;
    this.beaconLast = { ...at };
    this.beacon.style.left = `${at.x.toFixed(1)}px`;
    this.beacon.style.top = `${at.y.toFixed(1)}px`;
    this.beacon.classList.toggle('lost', lost);
    this.beacon.title = lost ? '转角暗杠被错开了' : `再摸 ${n} 张到转角`;
    const b = this.beacon.querySelector('b')!;
    b.textContent = lost ? '' : String(n);
  }

  // 星挂在哪（收起来以后是这一局它最后挂的地方；这一局没挂过是 null）
  get beaconAt(): Pt | null {
    return this.beaconLast ? { ...this.beaconLast } : null;
  }

  // 一颗四芒星闪一下。size：芒的全长（像素）
  flare(at: Pt, size = 60, dur = 0.7, color = GOLD, peak = 1, grow = 0.5): void {
    this.flares.push({ at: { ...at }, size, dur, t: 0, color, peak, grow });
    if (this.flares.length > 160) this.flares.shift();
    this.kick();
  }

  // 一颗流星从 from 划一道弧飞到 to，一路撒下星屑
  comet(from: Pt, to: Pt, o: { dur?: number; lift?: number; size?: number; delay?: number; head?: string; tail?: string; onHit?: () => void } = {}): void {
    this.comets.push({ from: { ...from }, to: { ...to }, t: 0, dur: o.dur ?? 0.55, lift: o.lift ?? 70, size: o.size ?? 46, trail: 0, head: o.head ?? '#fff3cf', tail: o.tail ?? GOLD, delay: o.delay ?? 0, onHit: o.onHit });
    this.kick();
  }

  // 一圈光往外推（inward：从外往里收）
  ring(at: Pt, radius = 120, dur = 0.7, color = GOLD, delay = 0, inward = false): void {
    this.rings.push({ at: { ...at }, radius, dur, t: 0, color, delay, inward });
    this.kick();
  }

  // 一个星座：星一颗颗亮起来，连线跟着画出来，一直挂到 dropFigure 或 clear
  figure(points: Pt[], links: [number, number][], gap = 0.16): void {
    this.fig = { points, links, t: 0, gap };
    this.kick();
  }

  dropFigure(): void {
    this.fig = null;
  }

  clear(): void {
    this.setOn(false);
    this.reseed();
    this.beaconLast = null;
    this.flares.length = 0;
    this.comets.length = 0;
    this.rings.length = 0;
    this.fig = null;
    this.draw();
  }

  private kick(): void {
    // 正在画的这一帧里又放了新的（流星一路撒星屑）：这一帧画完自己会接着排下一帧
    if (this.raf || this.ticking) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  private tick(now: number): void {
    this.raf = 0;
    if (!this.fx.isConnected) return;
    this.ticking = true;
    // 第一帧的时间戳可能比 kick 记下的那一刻还早一点：不让时间往回走
    const dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000));
    this.last = now;
    this.clock += dt;
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      if (r.delay > 0) r.delay -= dt;
      else if ((r.t += dt) >= r.dur) this.rings.splice(i, 1);
    }
    for (let i = this.comets.length - 1; i >= 0; i--) {
      const c = this.comets[i];
      if (c.delay > 0) {
        c.delay -= dt;
        continue;
      }
      c.t += dt;
      const k = Math.min(1, c.t / c.dur);
      const e = k * k * (3 - 2 * k);
      const p = { x: c.from.x + (c.to.x - c.from.x) * e, y: c.from.y + (c.to.y - c.from.y) * e - Math.sin(Math.PI * e) * c.lift };
      this.flare(p, c.size, 0.12, c.head, 1, 0);
      c.trail += dt;
      while (c.trail > 0.02) {
        c.trail -= 0.02;
        this.flare({ x: p.x + (Math.random() - 0.5) * 8, y: p.y + (Math.random() - 0.5) * 8 }, c.size * (0.25 + Math.random() * 0.3), 0.35 + Math.random() * 0.3, Math.random() < 0.3 ? '#bcd4ff' : c.tail, 0.6, 0.2);
      }
      if (k >= 1) {
        this.comets.splice(i, 1);
        c.onHit?.();
      }
    }
    for (let i = this.flares.length - 1; i >= 0; i--) if ((this.flares[i].t += dt) >= this.flares[i].dur) this.flares.splice(i, 1);
    if (this.fig) this.fig.t += dt;
    this.draw();
    this.ticking = false;
    if (this.flares.length || this.comets.length || this.rings.length || (this.fig && !reduced())) this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  private draw(): void {
    const w = this.fx.clientWidth;
    const h = this.fx.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    for (const r of this.rings) {
      if (r.delay > 0) continue;
      const k = r.t / r.dur;
      const rad = r.radius * (r.inward ? 1 - Math.pow(k, 0.6) * 0.92 : 0.04 + 0.96 * Math.pow(k, 0.4));
      const [cr, cg, cb] = rgb(r.color);
      const a = Math.pow(1 - k, 1.5);
      const th = Math.max(6, r.radius * 0.1 * (1 - 0.5 * k));
      const g = ctx.createRadialGradient(r.at.x, r.at.y, Math.max(0, rad - th * 2.5), r.at.x, r.at.y, rad + th * 0.5);
      g.addColorStop(0, `rgba(${cr},${cg},${cb},0)`);
      g.addColorStop(0.75, `rgba(${cr},${cg},${cb},${(a * 0.28).toFixed(3)})`);
      g.addColorStop(0.9, `rgba(255,255,255,${(a * 0.7).toFixed(3)})`);
      g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(r.at.x, r.at.y, rad + th, 0, Math.PI * 2);
      ctx.fill();
    }
    if (this.fig) {
      const f = this.fig;
      ctx.lineWidth = 1.2;
      for (const [a, b] of f.links) {
        const on = Math.max(0, Math.min(1, (f.t - Math.max(a, b) * f.gap) / 0.25));
        if (on <= 0) continue;
        ctx.strokeStyle = `rgba(190,210,255,${(on * 0.5).toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(f.points[a].x, f.points[a].y);
        ctx.lineTo(f.points[b].x, f.points[b].y);
        ctx.stroke();
      }
      f.points.forEach((p, i) => {
        const k = f.t - i * f.gap;
        if (k < 0) return;
        const pop = 1 + 1.6 * Math.exp(-k * 5);
        const tw = 0.82 + 0.18 * Math.sin(this.clock * (2 + i * 0.37) + i * 2.1);
        this.star(p, 34 * (0.85 + 0.3 * ((i * 0.618) % 1)), i % 3 === 1 ? '#cfe0ff' : '#ffe6a6', Math.min(1, k / 0.06) * pop * tw * 0.7, Math.sin(this.clock * 0.5 + i) * 0.1);
      });
    }
    for (const f of this.flares) {
      const k = f.t / f.dur;
      this.star(f.at, f.size * (1 + f.grow * Math.sqrt(k)), f.color, f.peak * Math.min(1, k / 0.08) * Math.pow(1 - k, 1.8), k * 0.5);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // 四芒星：中间一点白，横竖两道长芒，外面一圈淡晕
  private star(at: Pt, size: number, color: string, alpha: number, spin: number): void {
    if (alpha <= 0.004 || size <= 0.5) return;
    const ctx = this.ctx;
    const [r, g, b] = rgb(color);
    const R = size / 2;
    ctx.save();
    ctx.translate(at.x, at.y);
    ctx.rotate(spin);
    const a = Math.min(1, alpha);
    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.6);
    halo.addColorStop(0, `rgba(${r},${g},${b},${(a * 0.35).toFixed(3)})`);
    halo.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = halo;
    ctx.fillRect(-R, -R, size, size);
    for (let i = 0; i < 2; i++) {
      ctx.save();
      ctx.rotate((i * Math.PI) / 2);
      ctx.scale(1, 0.07);
      const ray = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
      ray.addColorStop(0, `rgba(255,255,255,${a.toFixed(3)})`);
      ray.addColorStop(0.25, `rgba(${r},${g},${b},${(a * 0.8).toFixed(3)})`);
      ray.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = ray;
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.16);
    core.addColorStop(0, `rgba(255,255,255,${a.toFixed(3)})`);
    core.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = core;
    ctx.fillRect(-R * 0.2, -R * 0.2, R * 0.4, R * 0.4);
    ctx.restore();
  }
}
