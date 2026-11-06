import './himeko2d.css';

// 鹤田姬子拿到钥匙的那一局（2D 牌桌）：和 3D 一样，配牌时橙色光柱一道道从天上（画面上方）砸到她的手牌上，
// 砸到哪张哪张才出现；理完牌一团火从她右手边烧到左手边。
// 光柱和火画在盖住牌桌的一张 canvas 上（不挡点击）；牌的出现、被火烧到时发橙光是 CSS 动画（himeko2d.css），
// 牌桌每次重画后 apply() 用负的 animation-delay 接着放，不会从头再来。

const T = {
  first: 0.35, // 第一道光柱砸下来（秒，从开始算）
  gap: 0.085, // 每张隔多久
  drop: 0.18, // 光柱从天上落到牌上要多久
  fade: 0.5, // 落地以后光柱收细淡掉
  pause: 0.45, // 最后一张落下以后停一下再点火
  sweep: 1.0, // 火从右烧到左
  burn: 1.0, // 火头过去以后还烧多久
};

interface Spot {
  x: number; // 牌中心（牌桌坐标）
  y: number;
  w: number;
  h: number;
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

// 固定的伪随机数：每次烧起来样子一样
function flames(): Flame[] {
  let r = 0x51ed27;
  const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 2 ** 32);
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

const FLAMES = flames();

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

export class Himeko2D {
  private canvas: HTMLCanvasElement | null = null;
  private start: number | null = null; // 开始的 performance.now()（毫秒），没在放是 null
  private spots: Spot[] = [];
  private raf = 0;
  private sprites: HTMLCanvasElement[] | null = null;
  private calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  private count = 13;

  // 整段多久（秒）
  private get total(): number {
    return this.fireAt + T.sweep + T.burn;
  }

  private get fireAt(): number {
    return T.first + (this.count - 1) * T.gap + T.fade * 0.5 + T.pause;
  }

  get running(): boolean {
    return this.start !== null && (performance.now() - this.start) / 1000 < this.total;
  }

  // 还要放多久（毫秒），电脑先别出牌
  busyMs(): number {
    if (this.start === null) return 0;
    return Math.max(0, this.total * 1000 - (performance.now() - this.start));
  }

  begin(): void {
    this.start = performance.now();
    this.spots = [];
  }

  stop(): void {
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
    const measured = els.map((el) => {
      const r = el.getBoundingClientRect();
      const spot = { x: (r.left + r.width / 2 - box.left) / scale, y: (r.top + r.height / 2 - box.top) / scale, w: r.width / scale, h: r.height / scale };
      return { el, spot, along: spot.x * rx + spot.y * ry };
    });
    measured.sort((a, b) => a.along - b.along);
    const tiles = measured.map((m) => m.el);
    this.spots = measured.map((m) => m.spot);
    // 手里从左到右第 i 张（她自己看过去），光柱照这个顺序落；火从最后一张烧到第一张
    tiles.forEach((el, i) => {
      const land = T.first + i * T.gap - t;
      const burn = this.fireAt + (1 - i / Math.max(1, tiles.length - 1)) * T.sweep - t;
      el.classList.add('hk-tile');
      el.style.animationDelay = `${land.toFixed(3)}s, ${burn.toFixed(3)}s`;
    });
    if (this.calm) return;
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
    this.drawBeams(ctx, t);
    this.drawFire(ctx, t);
    this.raf = requestAnimationFrame(this.draw);
  };

  // 一道光柱：脚在 (x, y)，往上（angle 往右斜多少弧度）伸到画面外；head 是光柱的头离脚多远（落下来时从远到 0）
  private beam(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, w: number, head: number, alpha: number): void {
    const len = 1400;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    g.addColorStop(0, 'rgba(255,110,20,0)');
    g.addColorStop(0.3, `rgba(255,120,24,${0.55 * alpha})`);
    g.addColorStop(0.5, `rgba(255,226,170,${alpha})`);
    g.addColorStop(0.7, `rgba(255,120,24,${0.55 * alpha})`);
    g.addColorStop(1, 'rgba(255,110,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-w / 2, -len, w, len - head);
    ctx.restore();
  }

  private drawBeams(ctx: CanvasRenderingContext2D, t: number): void {
    // 先落下来的四道大光柱：又宽又斜，两两交叉（原作里那个“W”）
    const l = this.spots[0];
    const r = this.spots[this.spots.length - 1];
    if (l && r) {
      for (let i = 0; i < 4; i++) {
        const a = t - (T.first - 0.05 + i * 0.07);
        if (a < -T.drop || a > T.fade * 1.4) continue;
        const f = i * 0.25 + 0.125;
        const x = l.x + (r.x - l.x) * f;
        const y = l.y + (r.y - l.y) * f;
        const k = a < 0 ? 1 - Math.pow((a + T.drop) / T.drop, 2) : 0;
        const fade = a < 0 ? 1 : 1 - a / (T.fade * 1.4);
        this.beam(ctx, x, y, i % 2 ? 0.38 : -0.38, l.w * 3.2, k * 1400, fade * fade * 0.8);
      }
    }
    this.spots.forEach((s, i) => {
      const at = T.first + i * T.gap;
      const a = t - at;
      if (a < -T.drop || a > T.fade) return;
      const head = a < 0 ? (s.y + s.h / 2) * (1 - Math.pow((a + T.drop) / T.drop, 2)) : s.y + s.h / 2;
      const f = a < 0 ? 0 : a / T.fade;
      const hit = a > 0 ? Math.exp(-a * 9) : 0;
      const w = s.w * (1.25 + 0.7 * hit) * (1 - 0.6 * f);
      const alpha = (1 - f) * (1 - f) * (0.8 + 0.5 * hit);
      const foot = s.y + s.h / 2;
      this.beam(ctx, s.x, foot, 0, w, foot - head, alpha);
      // 砸到牌上那一下的闪光
      if (hit > 0.02) {
        const r = s.w * (1.2 + a * 5);
        const rg = ctx.createRadialGradient(s.x, head, 0, s.x, head, r);
        rg.addColorStop(0, `rgba(255,236,190,${hit})`);
        rg.addColorStop(0.4, `rgba(255,130,30,${0.6 * hit})`);
        rg.addColorStop(1, 'rgba(255,100,20,0)');
        ctx.fillStyle = rg;
        ctx.fillRect(s.x - r, head - r, r * 2, r * 2);
      }
    });
  }

  private drawFire(ctx: CanvasRenderingContext2D, now: number): void {
    const t = now - this.fireAt;
    if (t < 0 || this.spots.length === 0) return;
    this.sprites ??= [0.1, 0.35, 0.6, 0.9].map(sprite);
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
      const x = x0 + (bx - ax) * 0.0 - ox * drift + Math.sin(age * 10 + f.wob) * 4 * k;
      const y = y0 - oy * drift - f.rise * Math.pow(k, 0.85);
      const heat = (1 - k) * (f.spark ? 1 : 0.8);
      const img = this.sprites[heat > 0.75 ? 3 : heat > 0.5 ? 2 : heat > 0.25 ? 1 : 0];
      const s = f.spark ? f.size * (1 - k) : f.size * (1 - 0.45 * k) * Math.min(1, k * 10);
      ctx.globalAlpha = f.spark ? 1 - k : (1 - k) * 0.5;
      ctx.drawImage(img, x - s, y - s * 1.4, s * 2, s * 2.6);
    }
    ctx.globalAlpha = 1;
  }
}
