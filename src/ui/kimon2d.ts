import { sigilParts, sigilReveal } from '../ui3d/kimonSigil';

// 2D 牌桌上的鬼门法阵：和 3D 的（ui3d/kimonSigil.ts）同一个图案、同样的描线顺序，用 SVG 画。
// 线条是白色的灯丝，外面靠 drop-shadow 罩一层紫光；每一段用 pathLength=1 的虚线描出来，
// 描的进度像笔一样匀速追上小四喜的进度，笔尖有一个亮点。

const NS = 'http://www.w3.org/2000/svg';
// 后天八卦，从正上方顺时针：坎 艮 震 巽 离 坤 兑 乾。第 i 位是从里往外第 i 爻（1 是阳爻）
const BITS = [2, 4, 1, 6, 5, 0, 3, 7];
const STAR = [0, 2, 4, 1, 3, 0];

const polar = (deg: number, r: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [Math.sin(a) * r, -Math.cos(a) * r];
};
const f = (n: number) => n.toFixed(4);

function trigram(bits: number): string {
  let d = '';
  for (let i = 0; i < 3; i++) {
    const y = (1 - i) * 0.036; // 第 0 爻在最里面（SVG 里是下面，组会转过去）
    if ((bits >> i) & 1) d += `M-0.07 ${f(y)}H0.07`;
    else d += `M-0.07 ${f(y)}H-0.016M0.016 ${f(y)}H0.07`;
  }
  return d;
}

export class Kimon2D {
  readonly el: HTMLDivElement;
  private svg: SVGSVGElement;
  private paths: Record<'outer' | 'outer2' | 'ticks' | 'inner' | 'dash' | 'star', SVGGeometryElement>;
  private tickMarks: SVGPathElement;
  private trigs: SVGGElement[] = [];
  private spin: SVGGElement;
  private pen: SVGCircleElement;
  private level = 0;
  private reveal = 0;
  private raf = 0;
  private last = 0;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'kimon2d';
    const ticks = Array.from({ length: 48 }, (_, i) => {
      const len = i % 4 === 0 ? 0.035 : 0.018;
      const [x0, y0] = polar(i * 7.5, 0.815);
      const [x1, y1] = polar(i * 7.5, 0.815 - len);
      return `M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}`;
    }).join('');
    const star = STAR.map((v, i) => {
      const [x, y] = polar(v * 72, 0.79);
      return `${i ? 'L' : 'M'}${f(x)} ${f(y)}`;
    }).join('');
    const trigs = BITS.map((b, k) => `<g class="kt${k === 1 ? ' gen' : ''}" transform="rotate(${k * 45}) translate(0 -0.885)"><path d="${trigram(b)}"/></g>`).join('');
    this.el.innerHTML = `<svg viewBox="-1.15 -1.15 2.3 2.3" xmlns="${NS}">
      <circle class="kw" r="1.02"/>
      <g class="ks">
        <circle data-p="outer" r="1" pathLength="1" transform="rotate(-90)" stroke-width="0.012"/>
        <circle data-p="outer2" r="0.965" pathLength="1" transform="rotate(-90)" stroke-width="0.005"/>
        <g class="kspin">${trigs}</g>
        <circle data-p="ticks" r="0.815" pathLength="1" transform="rotate(90) scale(1 -1)" stroke-width="0.004"/>
        <path class="kticks" d="${ticks}" stroke-width="0.004"/>
        <circle data-p="dash" r="0.55" pathLength="1" transform="rotate(-45)" stroke-width="0.004"/>
        <circle data-p="inner" r="0.42" pathLength="1" transform="rotate(-45)" stroke-width="0.008"/>
        <path data-p="star" d="${star}" pathLength="1" stroke-width="0.009"/>
      </g>
      <circle class="kpen" r="0.03"/>
    </svg>`;
    this.svg = this.el.querySelector('svg')!;
    const get = (k: string) => this.svg.querySelector<SVGGeometryElement>(`[data-p="${k}"]`)!;
    this.paths = { outer: get('outer'), outer2: get('outer2'), ticks: get('ticks'), inner: get('inner'), dash: get('dash'), star: get('star') };
    this.tickMarks = this.svg.querySelector('.kticks')!;
    this.trigs = [...this.svg.querySelectorAll<SVGGElement>('.kt')];
    this.spin = this.svg.querySelector('.kspin')!;
    this.pen = this.svg.querySelector('.kpen')!;
    this.draw();
  }

  // gen：艮卦朝哪里（从正上方顺时针的度数）
  setGen(gen: number): void {
    this.spin.style.setProperty('--gen', `${gen - 45}deg`);
  }

  setLevel(level: number): void {
    if (level > 0 && this.level === 0) this.el.classList.remove('gone', 'flare');
    this.level = level;
    this.el.classList.toggle('on', level > 0);
    this.el.classList.toggle('tenpai', level >= 1);
    if (level <= 0) this.reveal = 0;
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame((t) => this.tick(t));
    }
  }

  // 和牌：阵爆亮一下再淡掉
  burst(): void {
    this.el.classList.remove('flare');
    void this.el.offsetWidth;
    this.el.classList.add('flare', 'gone');
  }

  private tick(now: number): void {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const target = sigilReveal(this.level);
    const step = dt * 0.32;
    this.reveal += Math.max(-step * 3, Math.min(step, target - this.reveal));
    this.draw();
    this.raf = Math.abs(target - this.reveal) > 1e-4 && this.el.isConnected ? requestAnimationFrame((t) => this.tick(t)) : 0;
  }

  private draw(): void {
    const p = sigilParts(this.reveal);
    const dash = (el: SVGGeometryElement, v: number, gap = 2) => {
      el.style.strokeDasharray = v >= 1 ? 'none' : `${f(v)} ${gap}`;
      el.style.opacity = v > 0 ? '1' : '0';
    };
    dash(this.paths.outer, p.outer);
    dash(this.paths.outer2, p.outer2);
    dash(this.paths.ticks, p.ticks);
    dash(this.paths.inner, p.inner);
    dash(this.paths.star, p.star);
    // 虚线圈：自己是虚线，描出来的部分用不透明度渐显
    this.paths.dash.style.opacity = String(p.inner);
    this.tickMarks.style.opacity = String(p.ticks);
    this.trigs.forEach((g, k) => g.classList.toggle('lit', p.trig[k]));
    // 笔尖：正在描的那一段的端头
    const tip = sigilTip(p);
    this.pen.style.opacity = tip ? '1' : '0';
    if (tip) {
      this.pen.setAttribute('cx', f(tip[0]));
      this.pen.setAttribute('cy', f(tip[1]));
    }
  }
}

function sigilTip(p: ReturnType<typeof sigilParts>): [number, number] | null {
  if (p.outer > 0 && p.outer < 1) return polar(p.outer * 360, 1);
  if (p.ticks > 0 && p.ticks < 1) return polar(180 - p.ticks * 360, 0.815);
  if (p.inner > 0 && p.inner < 1) return polar(45 + p.inner * 360, 0.42);
  if (p.star > 0 && p.star < 1) {
    const s = p.star * 5;
    const j = Math.floor(s);
    const [ax, ay] = polar(STAR[j] * 72, 0.79);
    const [bx, by] = polar(STAR[j + 1] * 72, 0.79);
    const t = s - j;
    return [ax + (bx - ax) * t, ay + (by - ay) * t];
  }
  return null;
}
