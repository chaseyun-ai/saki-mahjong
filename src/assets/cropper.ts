import './cropper.css';
import { type Box, type Handle, boxCovered, carryBox, clampBox, coverBox, fitBox, fromCorner, moveBox, outSize, ratioText, reshapeBox, resizeBox, rotatedSize, scaleBox } from './cropMath';

// 放图之前裁一下：弹一个框，原图上一个裁剪框（拖着挪、拉四个角改大小、滚轮缩放、框外拖一下重画），
// 右边小预览是游戏里大概的样子（睁眼特写的斜长条、头像框）。比例按格子来，也能换成不限。
// 图能转：左转、右转 90°（横着拍的竖过来），拉条微调 ±45°（歪着的头摆正）。框跟着图上同一个地方走；
// 转出来的角是透明的，框到了会提醒，一下就能缩到没有空角。图本身不改，存的时候一次转好、裁好（cropMath.ts 管坐标）。
// 素材导入页（格子上放图、对照表、已换的重新裁）和睁眼特写预览页的「导入头像图」都用它。
// 裁好的存成 WebP（浏览器不会存 WebP 就存 PNG），透明背景留着；长边不超过格子建议的大小，不放大。

export interface CropSource {
  label: string; // 下面一排里写的：你选的图、换上的头像、自带头像……
  url: string;
  name: string; // 文件名（存的时候给人看的名字）
  file?: File; // 自己选的文件：可以「不裁，原图放进去」
}

export interface CropOptions {
  title: string;
  hint?: string;
  sources: CropSource[];
  ratios: { label: string; r: number | null }[];
  long: number; // 存出来长边最多多少像素
  focusY?: number; // 一开始框的中心放在多高（0 顶，1 底）
  look?: 'face' | 'eyes' | 'plain';
  ok?: string; // 确定按钮上的字
  skip?: string; // 有这个就多一个“不裁，原图放进去”（只对自己选的文件）
  extra?: { label: string; checked: boolean }; // 多一个勾选（只对自己选的文件），结果里带回去
  color?: string;
  angle?: number; // 一开始转多少度（顺时针；接着裁同一张图时沿用上一次的）
}

// angle：裁的时候转了多少度（顺时针）
export type CropResult =
  | { kind: 'crop'; blob: Blob; w: number; h: number; name: string; from: CropSource; extra: boolean; angle: number }
  | { kind: 'skip'; from: CropSource; extra: boolean; angle: 0 };

// 微调最多转多少度
const TILT = 45;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const HANDLES: Handle[] = ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'];
// 预览画多大（CSS 像素）
const PREVIEW = { face: [120, 160], eyes: [256, 80] } as const;

// 读得出来的静态图才裁：GIF、动图、视频不裁（裁了就不动了）
export function canCrop(mime: string, animated?: boolean): boolean {
  return /^image\/(png|jpeg|webp|bmp|avif)$/.test(mime) && !animated;
}

// 存成什么名字：原来的名字去掉扩展名，加“（裁过）”
export function croppedName(name: string, ext: string): string {
  const stem = name.replace(/\.[a-z0-9]+$/i, '').replace(/（裁过）$/, '');
  return `${stem}（裁过）.${ext}`;
}

// 微调的角度：±45° 以内，半度一格
function clampTilt(a: number): number {
  const m = ((((a + 180) % 360) + 360) % 360) - 180;
  const q = Math.round(m / 90) * 90;
  return Math.round(Math.max(-TILT, Math.min(TILT, m - q)) * 2) / 2;
}

export function cropImage(o: CropOptions): Promise<CropResult | null> {
  return new Promise((resolve) => new Cropper(o, resolve));
}

class Cropper {
  private el: HTMLElement;
  private stage: HTMLElement;
  private view: HTMLCanvasElement; // 左边显示的（转过的）图
  private src: HTMLImageElement | null = null; // 读进来的原图
  private boxEl: HTMLElement;
  private preview: HTMLCanvasElement;
  private sources: CropSource[];
  private made: string[] = []; // 这里自己建的 blob 网址，关的时候收回
  private cur = -1;
  // IW×IH 原图大小；W×H 转过以后外接框的大小（框的坐标都在这里面）
  private IW = 0;
  private IH = 0;
  private W = 0;
  private H = 0;
  // 转了几个 90°（0～3）、再微调多少度
  private quarter = 0;
  private tilt = 0;
  private box: Box = { x: 0, y: 0, w: 0, h: 0 };
  private r: number | null;
  private drag: { mode: 'move' | 'resize' | 'draw'; handle?: Handle; px: number; py: number; start: Box; moved: boolean } | null = null;
  private raf = 0;
  private loading = 0;
  private back: Element | null = document.activeElement;
  private readonly onResize = () => this.fit();
  private readonly onKey = (e: KeyboardEvent) => this.key(e);

  constructor(
    private o: CropOptions,
    private done: (r: CropResult | null) => void,
  ) {
    this.sources = [...o.sources];
    this.r = o.ratios[0]?.r ?? null;
    const look = o.look ?? 'plain';
    this.el = document.createElement('div');
    this.el.className = 'crop-modal';
    this.el.innerHTML = `
      <div class="crop-dialog" role="dialog" aria-modal="true" aria-labelledby="crop-title" style="--c:${esc(o.color ?? '#f0c35a')}">
        <header class="crop-head">
          <div><h2 id="crop-title">${esc(o.title)}</h2>${o.hint ? `<p>${esc(o.hint)}</p>` : ''}</div>
          <button class="crop-x" data-crop="cancel" aria-label="取消" title="取消（Esc）">×</button>
        </header>
        <div class="crop-main">
          <div class="crop-wrap">
            <div class="crop-stage" hidden>
              <canvas class="crop-view"></canvas>
              <div class="crop-box" tabindex="0" role="group" aria-label="裁剪框：拖着挪位置，拉角改大小，方向键微调，加减号缩放">
                <i class="crop-third"></i>${HANDLES.map((h) => `<b class="crop-h ${h}" data-h="${h}"></b>`).join('')}
              </div>
            </div>
            <label class="crop-empty" hidden><b>选一张图</b><span>或者把图拖到这里</span><input type="file" accept="image/*" data-crop-pick /></label>
          </div>
          <aside class="crop-side">
            <div class="crop-ratios" role="radiogroup" aria-label="比例">${o.ratios.map((x, i) => `<button class="crop-ratio${i === 0 ? ' on' : ''}" data-ratio="${i}" role="radio" aria-checked="${i === 0}">${esc(x.label)}</button>`).join('')}</div>
            <div class="crop-rot">
              <span class="crop-rot-head">旋转</span>
              <button class="crop-ratio" data-turn="-1" title="向左转 90°" aria-label="向左转 90°">左转 90°</button>
              <button class="crop-ratio" data-turn="1" title="向右转 90°" aria-label="向右转 90°">右转 90°</button>
              <button class="crop-ratio ghost" data-crop="unrotate" title="转回原来的样子" hidden>转回去</button>
              <label class="crop-tilt"><span>微调</span><input type="range" min="${-TILT}" max="${TILT}" step="0.5" value="0" data-crop-tilt aria-label="微调角度" /><output>0°</output></label>
            </div>
            <figure class="crop-look ${look}">
              <div class="crop-look-frame"><canvas></canvas></div>
              <figcaption>${look === 'eyes' ? '游戏里大概这样（斜着的长条）' : look === 'face' ? '头像框里大概这样' : '裁出来是这样'}</figcaption>
            </figure>
            <p class="crop-info" role="status"></p>
            <button class="crop-btn ghost crop-cover" data-crop="cover" hidden>缩到没有空角</button>
            <p class="crop-tips">拖框挪位置，拉四个角改大小，滚轮缩放；在框外按住拖一下，重新画一个框。图是歪的、横的，用上面的「旋转」摆正。</p>
            ${o.extra ? `<label class="crop-extra" hidden><input type="checkbox" data-crop-extra${o.extra.checked ? ' checked' : ''} /> ${esc(o.extra.label)}</label>` : ''}
          </aside>
        </div>
        <footer class="crop-foot">
          <div class="crop-sources"></div>
          <div class="crop-acts">
            <button class="crop-btn ghost" data-crop="reset" title="框回到最大">框放到最大</button>
            ${o.skip ? `<button class="crop-btn ghost" data-crop="skip" hidden>${esc(o.skip)}</button>` : ''}
            <button class="crop-btn ghost" data-crop="cancel">取消</button>
            <button class="crop-btn crop-ok" data-crop="ok" disabled>${esc(o.ok ?? '裁好了，换上')}</button>
          </div>
        </footer>
      </div>`;
    document.body.appendChild(this.el);
    this.stage = this.el.querySelector('.crop-stage')!;
    this.view = this.stage.querySelector('canvas')!;
    this.boxEl = this.stage.querySelector('.crop-box')!;
    this.preview = this.el.querySelector('.crop-look canvas')!;
    this.el.addEventListener('click', (e) => this.click(e));
    this.el.addEventListener('change', (e) => this.change(e));
    this.el.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.cropTilt !== undefined) this.rotate(this.quarter, Number(t.value));
    });
    this.el.addEventListener('dragover', (e) => {
      if (![...(e.dataTransfer?.types ?? [])].includes('Files')) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
      this.el.classList.add('drop');
    });
    this.el.addEventListener('dragleave', (e) => {
      if (!this.el.contains(e.relatedTarget as Node | null)) this.el.classList.remove('drop');
    });
    this.el.addEventListener('drop', (e) => {
      e.preventDefault();
      this.el.classList.remove('drop');
      const f = [...(e.dataTransfer?.files ?? [])].find((x) => x.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|avif)$/i.test(x.name));
      if (f) this.addFile(f);
    });
    this.stage.addEventListener('pointerdown', (e) => this.down(e));
    this.stage.addEventListener('pointermove', (e) => this.move(e));
    this.stage.addEventListener('pointerup', (e) => this.up(e));
    this.stage.addEventListener('pointercancel', (e) => this.up(e));
    this.stage.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    window.addEventListener('resize', this.onResize);
    document.addEventListener('keydown', this.onKey, true);
    this.renderSources();
    if (this.sources.length) void this.use(0);
    else this.empty();
  }

  // ---------- 换图 ----------

  private empty(): void {
    this.stage.hidden = true;
    (this.el.querySelector('.crop-empty') as HTMLElement).hidden = false;
    this.info('');
    this.sync();
  }

  private addFile(f: File): void {
    const url = URL.createObjectURL(f);
    this.made.push(url);
    // 同一次里再选一张：替换掉上一张自己选的，不越排越长
    const old = this.sources.findIndex((s) => s.file && s.label === '你选的图');
    const src: CropSource = { label: '你选的图', url, name: f.name, file: f };
    if (old >= 0) this.sources[old] = src;
    else this.sources.unshift(src);
    this.renderSources();
    void this.use(old >= 0 ? old : 0);
  }

  private async use(i: number): Promise<void> {
    const s = this.sources[i];
    if (!s) return;
    const ticket = ++this.loading;
    const img = new Image();
    img.decoding = 'async';
    img.src = s.url;
    try {
      await img.decode();
    } catch {
      if (ticket === this.loading) this.info(`「${s.label}」读不出来，换一张试试。`, true);
      return;
    }
    if (ticket !== this.loading) return;
    // 第一张照选项里给的角度转好（接着裁同一张图），换别的图就转回 0
    const first = this.cur < 0;
    const a = first ? (this.o.angle ?? 0) : 0;
    this.cur = i;
    this.src = img;
    this.IW = img.naturalWidth;
    this.IH = img.naturalHeight;
    this.quarter = (((Math.round((a - clampTilt(a)) / 90) % 4) + 4) % 4) as number;
    this.tilt = clampTilt(a);
    this.measure();
    this.box = this.maxBox();
    this.syncTilt();
    this.stage.hidden = false;
    (this.el.querySelector('.crop-empty') as HTMLElement).hidden = true;
    this.renderSources();
    this.fit();
    this.sync();
    this.draw();
    // 键盘能直接用：方向键挪框、回车裁好
    if (!this.el.contains(document.activeElement)) this.boxEl.focus({ preventScroll: true });
  }

  private renderSources(): void {
    const box = this.el.querySelector('.crop-sources')!;
    const list = this.sources
      .map(
        (s, i) =>
          `<button class="crop-src${i === this.cur ? ' on' : ''}" data-src="${i}" aria-pressed="${i === this.cur}" title="${esc(s.name)}"><img src="${esc(s.url)}" alt="" /><span>${esc(s.label)}</span></button>`,
      )
      .join('');
    box.innerHTML = `${this.sources.length ? `<span class="crop-src-head">用哪张</span>` : ''}${list}<label class="crop-src pick"><b>＋</b><span>${this.sources.length ? '换一张图…' : '选一张图…'}</span><input type="file" accept="image/*" data-crop-pick /></label>`;
  }

  // 图在框里放多大：铺满左边那块（小图也放大，好拉框）
  private fit(): void {
    if (!this.W) return;
    const wrap = this.el.querySelector<HTMLElement>('.crop-wrap')!;
    const aw = Math.max(120, wrap.clientWidth - 8);
    const ah = Math.max(120, wrap.clientHeight - 8);
    const k = Math.min(aw / this.W, ah / this.H, 4);
    const w = Math.max(1, Math.round(this.W * k));
    const h = Math.max(1, Math.round(this.H * k));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.view.style.width = `${w}px`;
    this.view.style.height = `${h}px`;
    this.view.width = Math.round(w * dpr);
    this.view.height = Math.round(h * dpr);
    this.region(this.view.getContext('2d')!, { x: 0, y: 0, w: this.W, h: this.H }, 0, 0, this.view.width, this.view.height);
  }

  // ---------- 转 ----------

  private deg(): number {
    return this.quarter * 90 + this.tilt;
  }

  // 最大的框：没微调过（只转了 90° 的倍数）就是整张；微调过的到没有空角为止
  private maxBox(): Box {
    return this.tilt ? coverBox(this.IW, this.IH, this.deg(), this.r) : fitBox(this.W, this.H, this.r, this.o.focusY ?? 0.5);
  }

  // 转过以后外接框多大
  private measure(): void {
    const R = rotatedSize(this.IW, this.IH, this.deg());
    this.W = R.w;
    this.H = R.h;
  }

  // 转到 quarter 个 90° 加 tilt 度：框的中心跟着图上同一个地方走
  private rotate(quarter: number, tilt: number): void {
    if (!this.src) return;
    const from = this.deg();
    this.quarter = ((quarter % 4) + 4) % 4;
    this.tilt = clampTilt(tilt);
    this.box = carryBox(this.box, this.IW, this.IH, from, this.deg());
    this.measure();
    this.box = clampBox(this.box, this.W, this.H);
    this.syncTilt();
    this.fit();
    this.sync();
    this.draw();
  }

  private syncTilt(): void {
    const range = this.el.querySelector<HTMLInputElement>('[data-crop-tilt]')!;
    range.value = String(this.tilt);
    this.el.querySelector('.crop-tilt output')!.textContent = `${this.tilt > 0 ? '+' : ''}${this.tilt}°`;
    (this.el.querySelector('[data-crop="unrotate"]') as HTMLElement).hidden = !this.deg();
  }

  // 转过的图上的 b 这一块画到 ctx 的 (dx, dy, dw, dh)：原图不改，每次照角度现转现画
  private region(ctx: CanvasRenderingContext2D, b: Box, dx: number, dy: number, dw: number, dh: number): void {
    if (!this.src) return;
    ctx.save();
    ctx.clearRect(dx, dy, dw, dh);
    ctx.beginPath();
    ctx.rect(dx, dy, dw, dh);
    ctx.clip();
    ctx.translate(dx, dy);
    ctx.scale(dw / b.w, dh / b.h);
    ctx.translate(-b.x + this.W / 2, -b.y + this.H / 2);
    ctx.rotate((this.deg() * Math.PI) / 180);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.src, -this.IW / 2, -this.IH / 2);
    ctx.restore();
  }

  // ---------- 框 ----------

  private scale(): number {
    return this.view.getBoundingClientRect().width / this.W || 1;
  }

  // 最小的框：屏幕上 28 像素
  private min(): number {
    return Math.max(4, 28 / this.scale());
  }

  private at(e: PointerEvent): { x: number; y: number } {
    const rc = this.view.getBoundingClientRect();
    return { x: Math.max(0, Math.min(this.W, ((e.clientX - rc.left) / rc.width) * this.W)), y: Math.max(0, Math.min(this.H, ((e.clientY - rc.top) / rc.height) * this.H)) };
  }

  private down(e: PointerEvent): void {
    if (!this.W || e.button > 0) return;
    const p = this.at(e);
    const h = (e.target as HTMLElement).dataset?.h as Handle | undefined;
    const inside = p.x >= this.box.x && p.x <= this.box.x + this.box.w && p.y >= this.box.y && p.y <= this.box.y + this.box.h;
    this.drag = { mode: h ? 'resize' : inside ? 'move' : 'draw', handle: h, px: p.x, py: p.y, start: this.box, moved: false };
    this.stage.setPointerCapture(e.pointerId);
    this.stage.classList.add('dragging');
    if (h || inside) this.boxEl.focus({ preventScroll: true });
    e.preventDefault();
  }

  private move(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    const p = this.at(e);
    if (!d.moved && Math.hypot(p.x - d.px, p.y - d.py) * this.scale() < 6) return;
    d.moved = true;
    if (d.mode === 'move') this.box = moveBox(d.start, p.x - d.px, p.y - d.py, this.W, this.H);
    else if (d.mode === 'resize') this.box = resizeBox(d.start, d.handle!, p.x, p.y, this.W, this.H, this.r, this.min());
    else this.box = fromCorner(d.px, d.py, p.x, p.y, this.W, this.H, this.r, this.min());
    this.draw();
  }

  private up(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.stage.classList.remove('dragging');
    if (this.stage.hasPointerCapture(e.pointerId)) this.stage.releasePointerCapture(e.pointerId);
    // 框外点一下（没拖）：框挪过去，中心对着点的地方
    if (d.mode === 'draw' && !d.moved) this.box = clampBox({ ...d.start, x: d.px - d.start.w / 2, y: d.py - d.start.h / 2 }, this.W, this.H);
    this.draw();
  }

  private wheel(e: WheelEvent): void {
    if (!this.W) return;
    e.preventDefault();
    this.box = scaleBox(this.box, e.deltaY > 0 ? 1.08 : 1 / 1.08, this.W, this.H, this.min());
    this.draw();
  }

  private key(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.close(null);
      return;
    }
    if (!this.W) return;
    const t = e.target as HTMLElement;
    if (e.key === 'Enter' && (t === this.boxEl || t === this.el || t === document.body)) {
      e.preventDefault();
      void this.ok();
      return;
    }
    if (t !== this.boxEl) return;
    const step = Math.max(1, Math.max(this.W, this.H) * (e.shiftKey ? 0.05 : 0.01));
    const mv: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (mv[e.key]) this.box = moveBox(this.box, mv[e.key][0], mv[e.key][1], this.W, this.H);
    else if (e.key === '+' || e.key === '=') this.box = scaleBox(this.box, 1 / 1.08, this.W, this.H, this.min());
    else if (e.key === '-' || e.key === '_') this.box = scaleBox(this.box, 1.08, this.W, this.H, this.min());
    else return;
    e.preventDefault();
    this.draw();
  }

  // 框画到图上（用百分比，窗口变大变小不用重算），预览、尺寸下一帧再画
  private draw(): void {
    const b = this.box;
    Object.assign(this.boxEl.style, { left: `${(b.x / this.W) * 100}%`, top: `${(b.y / this.H) * 100}%`, width: `${(b.w / this.W) * 100}%`, height: `${(b.h / this.H) * 100}%` });
    this.boxEl.classList.toggle('free', !this.r);
    if (!this.raf) this.raf = requestAnimationFrame(() => this.paint());
  }

  private paint(): void {
    this.raf = 0;
    if (!this.W) return;
    const b = this.box;
    const look = this.o.look ?? 'plain';
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // 预览框：头像、睁眼特写是固定的样子（游戏里铺满、多的裁掉），别的照框的比例
    let [pw, ph] = look === 'plain' ? [0, 0] : PREVIEW[look];
    if (look === 'plain') {
      const k = Math.min(200 / b.w, 170 / b.h);
      pw = Math.max(20, Math.round(b.w * k));
      ph = Math.max(20, Math.round(b.h * k));
    }
    const c = this.preview;
    c.width = Math.round(pw * dpr);
    c.height = Math.round(ph * dpr);
    c.style.width = `${pw}px`;
    c.style.height = `${ph}px`;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    const s = Math.max(c.width / b.w, c.height / b.h);
    const sw = c.width / s;
    const sh = c.height / s;
    this.region(ctx, { x: b.x + (b.w - sw) / 2, y: b.y + (b.h - sh) / 2, w: sw, h: sh }, 0, 0, c.width, c.height);
    const out = outSize(b, this.o.long);
    const small = Math.max(out.w, out.h) < this.o.long * 0.5;
    // 转过的图：框到了转出来的空角（透明）就提醒，给一个“缩到没有空角”
    const gap = !!this.deg() && !boxCovered(b, this.IW, this.IH, this.deg());
    const turned = this.deg() ? ` · 转了 ${this.deg() > 180 ? this.deg() - 360 : this.deg()}°` : '';
    const notes = [small ? '有点小，游戏里放大了会糊，能找到大一点的图更好' : '', gap ? '框到了转出来的空角，那里会是透明的' : ''].filter(Boolean);
    this.info(`裁出来 ${out.w}×${out.h}（${ratioText(b.w, b.h)}）· 原图 ${this.IW}×${this.IH}${turned}${notes.length ? `。${notes.join('；')}` : ''}`, notes.length > 0);
    (this.el.querySelector('[data-crop="cover"]') as HTMLElement).hidden = !gap;
  }

  private info(text: string, warn = false): void {
    const p = this.el.querySelector('.crop-info')!;
    p.textContent = text;
    p.classList.toggle('warn', warn);
  }

  // 按钮能不能点：有图才能裁；“不裁”和额外的勾选只对自己选的文件
  private sync(): void {
    const s = this.sources[this.cur];
    const ok = this.el.querySelector<HTMLButtonElement>('[data-crop="ok"]')!;
    ok.disabled = !this.W;
    const skip = this.el.querySelector<HTMLElement>('[data-crop="skip"]');
    // 转过了就不能“原图放进去”（原图没转）
    if (skip) skip.hidden = !s?.file || !!this.deg();
    const extra = this.el.querySelector<HTMLElement>('.crop-extra');
    if (extra) extra.hidden = !s?.file;
    (this.el.querySelector('[data-crop="reset"]') as HTMLElement).hidden = !this.W;
  }

  private setRatio(i: number): void {
    const x = this.o.ratios[i];
    if (!x) return;
    this.r = x.r;
    for (const b of this.el.querySelectorAll<HTMLElement>('.crop-ratio')) {
      const on = b.dataset.ratio === String(i);
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
    if (this.W) {
      this.box = reshapeBox(this.box, this.r, this.W, this.H);
      this.draw();
    }
  }

  // ---------- 按钮 ----------

  private click(e: Event): void {
    const t = e.target as HTMLElement;
    if (t === this.el) return; // 点到外面的暗处不关（免得拖框拖出去松手就没了）
    const el = t.closest<HTMLElement>('[data-crop],[data-ratio],[data-src],[data-turn]');
    if (!el) return;
    if (el.dataset.ratio) this.setRatio(Number(el.dataset.ratio));
    else if (el.dataset.turn) this.rotate(this.quarter + Number(el.dataset.turn), this.tilt);
    else if (el.dataset.crop === 'unrotate') this.rotate(0, 0);
    else if (el.dataset.crop === 'cover' && this.W) {
      // 中心不动、比例不变，缩到四个角都在图上；中心本身在空角里就放回图的正中间
      const b = this.box;
      let c = coverBox(this.IW, this.IH, this.deg(), this.r ?? b.w / b.h, [b.x + b.w / 2, b.y + b.h / 2]);
      if (c.w < this.min()) c = coverBox(this.IW, this.IH, this.deg(), this.r ?? b.w / b.h);
      this.box = c;
      this.draw();
    }
    else if (el.dataset.src) void this.use(Number(el.dataset.src));
    else if (el.dataset.crop === 'cancel') this.close(null);
    else if (el.dataset.crop === 'reset' && this.W) {
      // 转过的图：最大到没有空角为止
      this.box = this.maxBox();
      this.draw();
    } else if (el.dataset.crop === 'skip') {
      const s = this.sources[this.cur];
      if (s?.file) this.close({ kind: 'skip', from: s, extra: this.extra(), angle: 0 });
    } else if (el.dataset.crop === 'ok') void this.ok();
  }

  private change(e: Event): void {
    const t = e.target as HTMLInputElement;
    if (t.dataset.cropPick !== undefined && t.files?.[0]) {
      this.addFile(t.files[0]);
      t.value = '';
    }
  }

  private extra(): boolean {
    const box = this.el.querySelector<HTMLInputElement>('[data-crop-extra]');
    return !!box && !(box.closest('label') as HTMLElement).hidden && box.checked;
  }

  private async ok(): Promise<void> {
    const s = this.sources[this.cur];
    if (!s || !this.W) return;
    const b = this.box;
    const out = outSize(b, this.o.long);
    const c = document.createElement('canvas');
    c.width = out.w;
    c.height = out.h;
    this.region(c.getContext('2d')!, b, 0, 0, out.w, out.h);
    let blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/webp', 0.92));
    if (!blob || blob.type !== 'image/webp') blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
    if (!blob) {
      this.info('没裁成（浏览器存不出图），再试一次。', true);
      return;
    }
    this.close({ kind: 'crop', blob, w: out.w, h: out.h, name: croppedName(s.name, blob.type === 'image/webp' ? 'webp' : 'png'), from: s, extra: this.extra(), angle: this.deg() });
  }

  private close(r: CropResult | null): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('keydown', this.onKey, true);
    this.el.remove();
    // 选的文件结果里还要用（“不裁”时读它），网址收回不影响 File
    for (const u of this.made) URL.revokeObjectURL(u);
    if (this.back instanceof HTMLElement && this.back.isConnected) this.back.focus({ preventScroll: true });
    this.done(r);
  }
}
