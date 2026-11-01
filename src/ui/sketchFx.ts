// 爱丽丝的手绘板：破碎和重组两段特效。都是盖在牌桌上的一层（不挡鼠标），放完自己拿掉。
// - 破碎：先在画面上裂开几道铅笔线，再碎成几十片往外飞、往下掉。碎片里是碎掉那一刻的手绘板
//   （3D 牌桌是那一帧的截图，2D 牌桌是复制的一份牌桌），后面的牌桌已经换回普通的
// - 重组：几道白纸色的大笔刷一笔一笔刷过整个牌桌，刷满时换成手绘板（onCover），再慢慢淡开

export type ShatterSource = { image: string } | { dom: HTMLElement };

const SVG_NS = 'http://www.w3.org/2000/svg';

function layer(rect: DOMRect, cls: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = `sketch-fx ${cls}`;
  Object.assign(el.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  document.body.appendChild(el);
  return el;
}

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// 从撞击点往外切：几道射线、三圈，切成扇形的碎片（坐标是像素）
function shards(w: number, h: number): { pts: [number, number][]; ring: number; cx: number; cy: number }[] {
  const cx = w * (0.4 + Math.random() * 0.2);
  const cy = h * (0.42 + Math.random() * 0.2);
  const n = 10;
  const angles = Array.from({ length: n }, (_, i) => ((i + 0.3 + Math.random() * 0.4) / n) * Math.PI * 2).sort((a, b) => a - b);
  const far = Math.hypot(w, h);
  const radii = [0, far * (0.1 + Math.random() * 0.04), far * (0.27 + Math.random() * 0.05), far * 1.2];
  // 每条射线在每一圈上的点稍微错开一点，碎片才不会太规整
  const at = (i: number, r: number): [number, number] => {
    const a = angles[i % n] + (r > 0 ? (Math.random() - 0.5) * 0.12 : 0);
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  };
  const grid = radii.map((r) => angles.map((_, i) => at(i, r)));
  const out: { pts: [number, number][]; ring: number; cx: number; cy: number }[] = [];
  for (let ring = 0; ring < 3; ring++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const pts: [number, number][] = ring === 0 ? [[cx, cy], grid[1][i], grid[1][j]] : [grid[ring][i], grid[ring + 1][i], grid[ring + 1][j], grid[ring][j]];
      // 外圈的大块再从中间劈开一刀
      if (ring === 2) {
        const mid = (a: [number, number], b: [number, number], t: number): [number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const t1 = 0.35 + Math.random() * 0.3;
        const m1 = mid(pts[0], pts[1], t1);
        const m2 = mid(pts[3], pts[2], t1);
        out.push({ pts: [pts[0], m1, m2, pts[3]], ring, cx, cy }, { pts: [m1, pts[1], pts[2], m2], ring: ring + 1, cx, cy });
      } else out.push({ pts, ring, cx, cy });
    }
  }
  return out;
}

export function playShatter(rect: DOMRect, source: ShatterSource, done?: () => void): void {
  const root = layer(rect, 'shatter');
  const w = rect.width;
  const h = rect.height;
  const list = shards(w, h);
  // 先画裂纹
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'cracks');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const pieces: HTMLDivElement[] = [];
  for (const s of list) {
    const piece = document.createElement('div');
    piece.className = 'shard';
    piece.style.clipPath = `polygon(${s.pts.map(([x, y]) => `${((x / w) * 100).toFixed(2)}% ${((y / h) * 100).toFixed(2)}%`).join(',')})`;
    if ('image' in source) {
      piece.style.backgroundImage = `url(${source.image})`;
      piece.style.backgroundSize = `${w}px ${h}px`;
    } else {
      const copy = source.dom.cloneNode(true) as HTMLElement;
      copy.removeAttribute('id');
      copy.classList.add('shard-copy');
      // 牌桌是按中心缩放的：复制品摆在碎片里同样的位置
      copy.style.left = `${(w - source.dom.offsetWidth) / 2}px`;
      copy.style.top = `${(h - source.dom.offsetHeight) / 2}px`;
      piece.appendChild(copy);
    }
    root.appendChild(piece);
    pieces.push(piece);
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', `M${s.pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L')} Z`);
    svg.appendChild(path);
  }
  root.appendChild(svg);
  if (reduced()) {
    root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 500, fill: 'forwards' }).onfinish = () => {
      root.remove();
      done?.();
    };
    return;
  }
  const crackMs = 260;
  svg.animate([{ opacity: 0 }, { opacity: 1, offset: 0.4 }, { opacity: 1 }], { duration: crackMs, fill: 'forwards' });
  let left = pieces.length;
  pieces.forEach((piece, i) => {
    const s = list[i];
    const mx = s.pts.reduce((a, p) => a + p[0], 0) / s.pts.length;
    const my = s.pts.reduce((a, p) => a + p[1], 0) / s.pts.length;
    const dx = mx - s.cx;
    const dy = my - s.cy;
    const len = Math.hypot(dx, dy) || 1;
    const push = 40 + Math.random() * 90 + s.ring * 30;
    const fall = h * (0.5 + Math.random() * 0.5);
    const spin = (Math.random() - 0.5) * 70;
    const tx = (dx / len) * push;
    const ty = (dy / len) * push;
    const delay = crackMs + s.ring * 60 + Math.random() * 80;
    const dur = 900 + Math.random() * 400;
    piece.style.transformOrigin = `${mx}px ${my}px`;
    const anim = piece.animate(
      [
        { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
        { transform: `translate(${tx * 0.5}px, ${ty * 0.5}px) rotate(${spin * 0.3}deg)`, opacity: 1, offset: 0.25 },
        { transform: `translate(${tx}px, ${ty + fall}px) rotate(${spin}deg)`, opacity: 0 },
      ],
      { duration: dur, delay, easing: 'cubic-bezier(.35,.05,.75,.55)', fill: 'forwards' },
    );
    anim.onfinish = () => {
      if (--left === 0) {
        root.remove();
        done?.();
      }
    };
  });
  svg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, delay: crackMs + 120, fill: 'forwards' });
}

// 重组：一道道笔刷刷满牌桌，刷满时调 onCover（换成手绘板），再淡开
export function playRebuild(rect: DOMRect, onCover: () => void): void {
  const root = layer(rect, 'rebuild');
  if (reduced()) {
    onCover();
    root.animate([{ opacity: 0.9 }, { opacity: 0 }], { duration: 400, fill: 'forwards' }).onfinish = () => root.remove();
    return;
  }
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  const rows = 7;
  const strokes: SVGPathElement[] = [];
  for (let i = 0; i < rows; i++) {
    const y = ((i + 0.5) / rows) * 100;
    const wob = () => (Math.random() - 0.5) * 5;
    // 来回刷：单数行从左往右，双数行从右往左
    const [x0, x1] = i % 2 ? [108, -8] : [-8, 108];
    const d = `M${x0} ${y + wob()} C${x0 + (x1 - x0) * 0.33} ${y + wob()} ${x0 + (x1 - x0) * 0.66} ${y + wob()} ${x1} ${y + wob()}`;
    for (const cls of ['edge', 'paint']) {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      p.setAttribute('class', cls);
      p.setAttribute('pathLength', '100');
      svg.appendChild(p);
      strokes.push(p);
    }
  }
  root.appendChild(svg);
  const each = 110;
  strokes.forEach((p, n) => {
    const row = Math.floor(n / 2);
    p.animate([{ strokeDashoffset: 100 }, { strokeDashoffset: 0 }], { duration: each * 1.6, delay: row * each, easing: 'ease-in-out', fill: 'both' });
  });
  const cover = rows * each + each * 0.8;
  setTimeout(() => {
    onCover();
    root.classList.add('covered');
    root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 520, delay: 120, easing: 'ease-out', fill: 'forwards' }).onfinish = () => root.remove();
  }, cover);
}
