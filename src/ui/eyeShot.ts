import './eyeShot.css';
import { skinOf } from '../ui3d/looks';
import { EYE_TIMES, drawEyeShot, drawFace, eyeStateAt } from './eyeDraw';
import { type EyeLook, eyeLookOf } from './eyeLooks';

// 能力发动时的睁眼特写：一格斜着的长条，里面是这个人的眼睛，闭着滑进来、猛地睁开、瞳孔一缩、眼尾拖出光。
// 不是横贯整个画面的横幅；几个人差不多同时发动（一局开始时几个人的能力一起亮）就一人一格叠起来，最多四格。
// 眼睛是 eyeDraw.ts 的模板现画的，每人的瞳色、瞳孔、高光见 eyeLooks.ts。
// 素材导入页换了「睁眼特写」（图或视频）就放换上的：图从中间一条缝张开，视频照放。
// 只是画面效果：不挡点击，不等它放完牌局就往下走。

export interface EyeSpec {
  seat: number;
  pos: string; // 座位在画面上的方位：bottom、right、top、left（从那一侧滑进来）
  id: string;
  name: string;
  color: string;
  word: string; // 能力名
}

// 一格放多久（秒，含滑进来）、退场多久。后来的人加进来时整组一起等到最后一格放完才走，但最多 MAX_HOLD 秒
const LIFE = 2.1;
const OUT = 0.3;
const MAX_HOLD = 4.4;
const MAX_PANELS = 4;
// 格子倾斜的角度（度）
export const EYE_TILT = -6;

export interface Rect {
  x: number; // 中心
  y: number;
  w: number;
  h: number;
}

// n 格在 W×H 的画面里怎么摆：一格在画面中间偏上；几格就一格格往下叠，越往下越往左错一点，像一串斜着的分镜。
// 叠起来太高就整体缩小，留出上下的边（格子斜着，一头翘起来、一头压下去，这段高度也算进去）
export function eyeShotLayout(n: number, W: number, H: number): Rect[] {
  if (n <= 0) return [];
  const portrait = W < H * 0.9;
  let w = portrait ? W * 0.94 : Math.min(W * 0.6, H * 1.45, 940);
  let h = w / 3.2;
  let gap = h * 0.16;
  const lean = Math.sin((Math.abs(EYE_TILT) * Math.PI) / 180);
  const room = H * (n === 1 ? 0.5 : 0.86);
  let total = n * h + (n - 1) * gap;
  const span = total + w * lean;
  if (span > room) {
    const k = room / span;
    w *= k;
    h *= k;
    gap *= k;
    total *= k;
  }
  const cy = n === 1 ? H * 0.42 : H * 0.47;
  const step = portrait ? 0 : w * 0.08;
  return Array.from({ length: n }, (_, i) => ({
    x: W / 2 + ((n - 1) / 2 - i) * step,
    y: cy - total / 2 + h / 2 + i * (h + gap),
    w,
    h,
  }));
}

interface Panel {
  spec: EyeSpec;
  look: EyeLook;
  el: HTMLElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  face: HTMLCanvasElement | null;
  size: [number, number];
  start: number;
  image: HTMLImageElement | null; // 素材页换上的图
}

const now = () => performance.now() / 1000;
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export class EyeShots {
  private panels: Panel[] = [];
  private group: HTMLElement | null = null;
  private raf = 0;
  private endAt = 0;
  private leaveAt = 0;
  private readonly onResize = () => this.layout();

  constructor(private layer: HTMLElement) {}

  // 放一格，返回是否真的放了。这个座位已经有一格在放、已经四格了，就不放（照旧出一行小字）
  show(spec: EyeSpec): boolean {
    if (this.leaveAt) this.clear();
    if (this.panels.some((p) => p.spec.seat === spec.seat) || this.panels.length >= MAX_PANELS) return false;
    if (!this.group || !this.group.isConnected) {
      this.group = document.createElement('div');
      this.group.className = 'eye-shots';
      this.layer.appendChild(this.group);
      window.addEventListener('resize', this.onResize);
    }
    const look = eyeLookOf(spec.id, spec.color);
    const el = document.createElement('div');
    const from = spec.pos === 'right' || spec.pos === 'top' ? 'from-right' : 'from-left';
    el.className = `eye-shot ${from}`;
    el.style.setProperty('--c', spec.color);
    el.style.setProperty('--glow', look.glow);
    el.style.setProperty('--tilt', `${EYE_TILT}deg`);
    el.innerHTML = `<div class="es-back"></div><div class="es-frame"><canvas></canvas><video muted playsinline></video></div><div class="es-tag">${esc(spec.name)}</div><div class="es-word"><span>${esc(spec.word)}</span></div>`;
    const canvas = el.querySelector('canvas')!;
    const video = el.querySelector('video')!;
    const panel: Panel = { spec, look, el, canvas, ctx: canvas.getContext('2d')!, face: null, size: [0, 0], start: now(), image: null };
    // 素材页换上的睁眼特写：视频直接放，图画进格子里
    const own = skinOf(spec.id, 'eyes');
    if (own?.video) {
      el.classList.add('own-video');
      video.src = own.url;
      void video.play().catch(() => {});
    } else {
      video.remove();
      if (own) {
        const img = new Image();
        img.onload = () => (panel.image = img);
        img.src = own.url;
      }
    }
    this.group.appendChild(el);
    const t = now();
    const first = this.panels[0]?.start ?? t;
    this.panels.push(panel);
    this.endAt = Math.min(Math.max(this.endAt, t + LIFE), first + MAX_HOLD);
    this.layout();
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
    return true;
  }

  // 正在放的座位
  seats(): number[] {
    return this.panels.map((p) => p.spec.seat);
  }

  clear(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.group?.remove();
    this.group = null;
    this.panels = [];
    this.endAt = 0;
    this.leaveAt = 0;
    window.removeEventListener('resize', this.onResize);
  }

  private layout(): void {
    const W = this.layer.clientWidth || window.innerWidth;
    const H = this.layer.clientHeight || window.innerHeight;
    const rects = eyeShotLayout(this.panels.length, W, H);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.panels.forEach((p, i) => {
      const r = rects[i];
      p.el.style.left = `${r.x - r.w / 2}px`;
      p.el.style.top = `${r.y - r.h / 2}px`;
      p.el.style.width = `${r.w}px`;
      p.el.style.height = `${r.h}px`;
      p.el.style.setProperty('--k', `${Math.round(r.h * 0.22)}px`);
      const cw = Math.round(r.w * dpr);
      const ch = Math.round(r.h * dpr);
      if (cw !== p.size[0] || ch !== p.size[1]) {
        p.canvas.width = cw;
        p.canvas.height = ch;
        p.size = [cw, ch];
        p.face = null;
      }
    });
  }

  private readonly tick = () => {
    this.raf = 0;
    const t = now();
    if (!this.leaveAt && t >= this.endAt) {
      this.leaveAt = t + OUT;
      this.panels.forEach((p, i) => {
        p.el.style.setProperty('--d', `${i * 0.05}s`);
        p.el.classList.add('out');
      });
    }
    if (this.leaveAt && t >= this.leaveAt + 0.05 * this.panels.length) {
      this.clear();
      return;
    }
    const still = reduced();
    for (const p of this.panels) this.paint(p, still ? EYE_TIMES.settle + 0.4 : t - p.start);
    this.raf = requestAnimationFrame(this.tick);
  };

  private paint(p: Panel, t: number): void {
    const [w, h] = p.size;
    if (!w || !h || p.el.classList.contains('own-video')) return;
    if (!p.face && !p.image) {
      p.face = document.createElement('canvas');
      p.face.width = w;
      p.face.height = h;
      drawFace(p.face.getContext('2d')!, w, h, p.look, p.spec.id);
    }
    const s = eyeStateAt(t, p.look);
    p.ctx.setTransform(1, 0, 0, 1, 0, 0);
    p.ctx.clearRect(0, 0, w, h);
    if (p.image) drawOwn(p.ctx, w, h, p.image, s.open, s.flash, p.look.glow);
    else drawEyeShot(p.ctx, w, h, p.look, s, p.face);
  }
}

// 换上的图：先是黑底上一条发光的缝，睁眼时从中间上下张开
function drawOwn(ctx: CanvasRenderingContext2D, w: number, h: number, img: HTMLImageElement, open: number, flash: number, glow: string): void {
  ctx.fillStyle = '#08060c';
  ctx.fillRect(0, 0, w, h);
  const k = Math.max(0, Math.min(1, open));
  const half = (h / 2) * k;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, h / 2 - half, w, half * 2);
  ctx.clip();
  // 铺满格子（cover），多出来的上下或左右裁掉
  const s = Math.max(w / img.width, h / img.height);
  ctx.drawImage(img, (w - img.width * s) / 2, (h - img.height * s) / 2, img.width * s, img.height * s);
  ctx.restore();
  if (k < 1) {
    ctx.fillStyle = glow;
    ctx.globalAlpha = 0.9 * (1 - k);
    ctx.fillRect(0, h / 2 - half - 2, w, 2);
    ctx.fillRect(0, h / 2 + half, w, 2);
    ctx.globalAlpha = 1;
  }
  if (flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${0.5 * flash})`;
    ctx.fillRect(0, 0, w, h);
  }
}

// 素材导入页上「睁眼特写」格子没换时的预览：现画一张睁开的样子（按人存一份）
const templates = new Map<string, string>();
export function eyeTemplateUrl(id: string, color: string): string {
  let url = templates.get(id);
  if (url === undefined) {
    const w = 640;
    const h = 200;
    const look = eyeLookOf(id, color);
    const face = document.createElement('canvas');
    face.width = w;
    face.height = h;
    drawFace(face.getContext('2d')!, w, h, look, id);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    drawEyeShot(c.getContext('2d')!, w, h, look, { ...eyeStateAt(EYE_TIMES.settle + 0.4, look), flash: 0, ring: -1 }, face);
    url = c.toDataURL('image/webp', 0.9);
    templates.set(id, url);
  }
  return url;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
