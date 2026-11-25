import { Frame, Painter, composite } from './core';
import { type PixelFx, type PixelFxKind, makePixelFx } from './effects';
import { PIXEL_FAMILY } from './text';

// 像素特效的那一层：盖在牌桌上面的一张低分辨率 canvas（一格像素是整数个屏幕像素，不插值放大），点不到。
// 有特效在放的时候每帧清掉重画（颜色一层、光一层，合成到一起），都放完了就停下来，不白占一帧。
// 座位：bottom 自己、right 下家、top 对家、left 上家（和 app.ts 的 POS 一样），特效放在那家那边

type Pos = 'bottom' | 'right' | 'top' | 'left';
const AT: Record<Pos, [number, number]> = { bottom: [0.5, 0.74], right: [0.8, 0.46], top: [0.5, 0.24], left: [0.2, 0.46] };
// 一屏横着大约多少格像素（1280 宽时一格 4 个屏幕像素，方块粒子 2、3 格就是 8～12 个屏幕像素）
const COLS = 320;

interface Running {
  fx: PixelFx;
  start: number;
}

export class PixelFxLayer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private frame = new Frame(1, 1);
  private paint = new Painter(this.frame);
  private image: ImageData | null = null;
  private list: Running[] = [];
  private raf = 0;
  private seed = 1;
  private scale = 2;
  // 调试截图时停住（debugAt 画好的那一帧不被正在放的特效盖掉）
  private frozenUntil = 0;

  constructor(private host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'px-fx';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.ctx = this.canvas.getContext('2d')!;
    // 字体先要一下，第一次放特效时字已经是像素字了
    void document.fonts?.load(`12px ${PIXEL_FAMILY}`).catch(() => {});
  }

  // 量一下宿主多大，算一格几个屏幕像素、帧多大
  private fit(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    const dpr = window.devicePixelRatio || 1;
    // 一格是整数个屏幕（设备）像素，至少 2 个
    const step = Math.max(2, Math.round((w * dpr) / COLS));
    this.scale = step / dpr;
    const fw = Math.ceil(w / this.scale);
    const fh = Math.ceil(h / this.scale);
    if (fw !== this.frame.w || fh !== this.frame.h) {
      this.frame = new Frame(fw, fh);
      this.paint = new Painter(this.frame);
      this.canvas.width = fw;
      this.canvas.height = fh;
      this.image = this.ctx.createImageData(fw, fh);
    }
    this.canvas.style.width = `${fw * this.scale}px`;
    this.canvas.style.height = `${fh * this.scale}px`;
  }

  // 放一个特效：pos 是哪家那边，color 是角色色
  play(kind: PixelFxKind, pos: Pos, word: string, color: string): void {
    if (performance.now() < this.frozenUntil) return;
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches && kind !== 'win') return;
    if (!this.canvas.isConnected) this.host.appendChild(this.canvas);
    this.fit();
    const [ax, ay] = AT[pos];
    const fx = makePixelFx({ kind, word, color, x: Math.round(this.frame.w * ax), y: Math.round(this.frame.h * ay), w: this.frame.w, h: this.frame.h, seed: this.seed++ * 977 });
    this.list.push({ fx, start: performance.now() });
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (): void => {
    this.raf = 0;
    if (!this.host.isConnected) {
      this.list = [];
      return;
    }
    const now = performance.now();
    this.list = this.list.filter((r) => (now - r.start) / 1000 < r.fx.dur);
    this.frame.clear();
    for (const r of this.list) {
      this.paint.fade = 1;
      this.paint.place(0, 0);
      r.fx.draw(this.paint, (now - r.start) / 1000);
    }
    if (this.image) {
      composite(this.frame, this.image.data);
      this.ctx.putImageData(this.image, 0, 0);
    }
    if (this.list.length) this.raf = requestAnimationFrame(this.tick);
    else this.canvas.remove();
  };

  // 调试、截图用：直接画 t 秒时的样子（不等动画）
  debugAt(kind: PixelFxKind, pos: Pos, word: string, color: string, t: number): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.list = [];
    this.frozenUntil = performance.now() + 10000;
    if (!this.canvas.isConnected) this.host.appendChild(this.canvas);
    this.fit();
    const [ax, ay] = AT[pos];
    const fx = makePixelFx({ kind, word, color, x: Math.round(this.frame.w * ax), y: Math.round(this.frame.h * ay), w: this.frame.w, h: this.frame.h, seed: 977 });
    this.frame.clear();
    fx.draw(this.paint, t);
    if (this.image) {
      composite(this.frame, this.image.data);
      this.ctx.putImageData(this.image, 0, 0);
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.list = [];
    this.canvas.remove();
  }
}
