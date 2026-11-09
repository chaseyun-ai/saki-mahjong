import { SKY, clamp01, easeInOut, easeOut } from './riiChainPlan';
import { KEY_RING_AT, keyArt } from './keyArt';

// 白水哩拿到钥匙（照原作）：锁链碎片冲上天以后，天空放晴——整个画面从上往下亮起来，
// 天顶洒下一道道光、到处一闪一闪的星光，钥匙从画面上方缓缓落下，停在手牌上方，再淡掉。
// 落下时和原作一样斜着：吊牌在右上、齿朝左下，边落边转平，落定时吊牌在右边、稍微往下垂（像姬子手上那一幕）。
// 三种视角都画在盖住整个画面的一张 canvas 上（不挡点击）。

interface Play {
  t0: number;
  x: number; // 钥匙落到哪（页面坐标）
  y: number;
  len: number; // 钥匙多长
  art: HTMLCanvasElement;
}

export class SkyKey {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private plays: Play[] = [];
  private raf = 0;
  private reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  // 截图测试：不按真实时间走（见 advance）
  manual = false;
  private clock = 0;

  constructor(host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'rii-sky';
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }

  // delay 秒后开始放
  play(at: { x: number; y: number; w: number }, bind: number, tag: string, delay: number): void {
    const len = Math.min(window.innerWidth * 0.46, Math.max(260, at.w * 1.1), 620);
    this.plays.push({ t0: this.time() + delay, x: at.x, y: at.y - len * 0.32, len, art: keyArt(bind, tag) });
    if (!this.raf && !this.manual) this.raf = requestAnimationFrame(this.loop);
  }

  busyUntil(): number {
    return Math.max(0, ...this.plays.map((p) => p.t0 + SKY.clear + SKY.fall + SKY.hold + SKY.fade - this.time()));
  }

  clear(): void {
    this.plays = [];
    this.draw();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.canvas.remove();
  }

  // 调试用：按固定时间画一帧
  advance(sec: number): void {
    if (!this.manual) this.clock = performance.now() / 1000;
    this.manual = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.clock += sec;
    this.draw();
  }

  private time(): number {
    return this.manual ? this.clock : performance.now() / 1000;
  }

  private loop = (): void => {
    this.draw();
    this.raf = this.plays.length && this.canvas.isConnected ? requestAnimationFrame(this.loop) : 0;
  };

  private draw(): void {
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
    const now = this.time();
    const total = SKY.clear + SKY.fall + SKY.hold + SKY.fade;
    this.plays = this.plays.filter((p) => now - p.t0 < total);
    for (const p of this.plays) {
      const t = now - p.t0;
      if (t < 0) continue;
      this.drawOne(p, t, W, H);
    }
  }

  private drawOne(p: Play, t: number, W: number, H: number): void {
    const ctx = this.ctx;
    const { clear, fall, hold, fade } = SKY;
    const end = clear + fall + hold;
    const sky = easeOut(t / clear) * (1 - clamp01((t - end) / fade));
    // 天空放晴：从上往下一层淡蓝的亮光
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, `rgba(196,228,255,${0.62 * sky})`);
    g.addColorStop(0.45, `rgba(150,200,255,${0.32 * sky})`);
    g.addColorStop(1, `rgba(120,170,255,${0.08 * sky})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // 天顶洒下来的光：从画面上方正中往下张开，一道道慢慢摆动
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const ox = W / 2;
    const oy = -H * 0.18;
    const R = Math.hypot(W, H) * 1.1;
    for (let i = 0; i < 18; i++) {
      const base = Math.PI / 2 + (i / 17 - 0.5) * 1.9;
      const a = base + Math.sin(t * 0.5 + i * 1.7) * 0.03;
      const w = 0.018 + ((i * 7) % 5) * 0.008;
      const rg = ctx.createRadialGradient(ox, oy, 0, ox, oy, R);
      const k = (0.16 + ((i * 13) % 4) * 0.05) * sky;
      rg.addColorStop(0, `rgba(255,255,255,${k})`);
      rg.addColorStop(0.55, `rgba(220,240,255,${k * 0.45})`);
      rg.addColorStop(1, 'rgba(220,240,255,0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.arc(ox, oy, R, a - w, a + w);
      ctx.closePath();
      ctx.fill();
    }
    // 星光：满画面一闪一闪
    for (let i = 0; i < 34; i++) {
      const x = hash(i * 3 + 1) * W;
      const y = hash(i * 7 + 2) * H * 0.85;
      const tw = Math.max(0, Math.sin(t * (2.5 + hash(i) * 2) + i * 2.1));
      this.star(x, y, (6 + hash(i * 5) * 16) * (0.4 + tw), sky * tw);
    }
    ctx.restore();
    // 钥匙：从画面上方缓缓落下，左右轻轻摆，落到手牌上方停住
    const tf = t - clear * 0.6;
    if (tf <= 0) return;
    const u = easeInOut(tf / fall);
    const out = clamp01((t - end) / fade);
    const y = -p.len * 0.6 + (p.y + p.len * 0.6) * u + Math.sin(tf * 1.8) * 6 * u;
    const x = p.x + Math.sin(tf * 1.3) * p.len * 0.06 * (1 - u);
    // 前一段斜着落（像原作那一格），后一段慢慢转平
    const rot = FALL_TILT + (REST_TILT - FALL_TILT) * easeInOut((u - 0.3) / 0.7) + Math.sin(tf * 1.6) * 0.1 * (1 - u * 0.7);
    ctx.save();
    ctx.translate(x, y);
    // 钥匙后面一团柔光
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, p.len * 0.7);
    halo.addColorStop(0, `rgba(255,244,210,${0.5 * (1 - out)})`);
    halo.addColorStop(1, 'rgba(255,220,140,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(-p.len, -p.len, p.len * 2, p.len * 2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.rotate(rot);
    ctx.globalAlpha = (1 - out) * easeOut(tf / 0.4);
    ctx.shadowColor = 'rgba(255,190,70,0.85)';
    ctx.shadowBlur = p.len * 0.05;
    const kh = (p.len * p.art.height) / p.art.width;
    ctx.drawImage(p.art, -p.len / 2, -kh / 2, p.len, kh);
    ctx.restore();
    // 钥匙身上一闪
    if (!this.reduced) {
      const tw = Math.max(0, Math.sin(tf * 3));
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      this.star(x + Math.cos(rot) * p.len * KEY_RING_AT, y + Math.sin(rot) * p.len * KEY_RING_AT, p.len * 0.07 * tw, (1 - out) * tw);
      ctx.restore();
    }
  }

  private star(x: number, y: number, r: number, alpha: number): void {
    if (alpha <= 0.01 || r <= 0.5) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#ffffff';
    for (const rot of [0, Math.PI / 2]) {
      ctx.rotate(rot);
      ctx.beginPath();
      ctx.moveTo(-r, 0);
      ctx.quadraticCurveTo(0, -r * 0.09, r, 0);
      ctx.quadraticCurveTo(0, r * 0.09, -r, 0);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.14, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// 钥匙落下时的角度（弧度）：一开始吊牌在右上、齿朝左下斜着，落定时吊牌在右边稍微往下垂
const FALL_TILT = -1.0;
const REST_TILT = 0.38;

function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
