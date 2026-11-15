import './teruFx.css';
import { TWISTER } from '../ui3d/twister';

// 2D 牌桌上宫永照的旋风自摸，和 3D 的（ui3d/twister.ts）同一个节奏、同一个样子，画成斜着看的一个立体漏斗：
// 从 at（结算里那张和了牌底下）拔地而起，下细上粗，一圈圈白色的风带绕着转（前半圈白、后半圈透出淡紫），
// 外面缠着细风丝，里面一柱紫光，风脚卷起一圈灰；风里卷着一点沙土和几块碎石，紫白色的电弧在风上爬、往天上劈；
// 卷完散成一片紫光，碎石被甩出去，残电再闪几下。牌在结算里转（style.css 的 .win.slam.twist），这里只画风。
// 叫的时候是牌刚砸下去那一下：照 TWISTER.erupt 等一下再起风。画在盖住整个页面的一层 canvas 上，放完自己收掉。
// 和了牌上面地方够（at 离画面上沿远）就斜着看（漏斗竖着）；不够（2D 的结算里那排牌就在画面上方）就从上往下看进漏斗里：
// 一圈圈风带差不多是圆的，越往上（离看的人越近）圈越大，风顶只往上偏一点

export interface Tornado2dOpts {
  k?: number; // 整体放大缩小（按画面大小）
  onErupt?: () => void; // 风拔地而起那一下（放风声）
  onBolt?: () => void; // 一道电劈到桌上、风散开（噼啪一声）
}

type Pt = [number, number];

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const PURPLE = '176,128,255';
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

interface Band {
  h: number; // 高度的几成
  span: number; // 绕多大一截（弧度）
  th0: number;
  w: number; // 转得多快
  thick: number; // 带子多宽（像素）
}
interface Wisp {
  phase: number;
  climb: number;
  th0: number;
  w: number;
  rMul: number;
  span: number;
}
interface Rock {
  a0: number;
  w: number;
  hT: number;
  rMul: number;
  size: number;
  flingAt: number;
  pts: Pt[];
  shade: number;
  p?: { x: number; y: number };
  v?: { x: number; y: number };
  floor?: number;
}
interface Grain {
  phase: number;
  climb: number;
  top: number;
  th0: number;
  w: number;
  rMul: number;
  r: number;
  tone: number;
}
interface Arc {
  pts: Pt[];
  branches: Pt[][];
  t0: number;
  dur: number;
  width: number;
}

// 两点之间一道折线（中点位移），jag 是折得多厉害
function jagged(a: Pt, b: Pt, jag: number, depth = 5): Pt[] {
  let pts: Pt[] = [a, b];
  let amp = Math.hypot(b[0] - a[0], b[1] - a[1]) * jag;
  for (let d = 0; d < depth; d++) {
    const next: Pt[] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1];
      const q = pts[i];
      const dx = q[0] - p[0];
      const dy = q[1] - p[1];
      const l = Math.hypot(dx, dy) || 1;
      const off = (Math.random() - 0.5) * 2 * amp;
      next.push([(p[0] + q[0]) / 2 - (dy / l) * off, (p[1] + q[1]) / 2 + (dx / l) * off], q);
    }
    pts = next;
    amp *= 0.55;
  }
  return pts;
}

export function tornado2d(at: { x: number; y: number }, size: number, opts: Tornado2dOpts = {}): void {
  if (reduced()) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'teru-tornado';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return;
  }
  const k = opts.k ?? Math.max(0.6, Math.min(1.3, window.innerHeight / 820));
  const z = Math.max(0, Math.min(1, size));
  const T = TWISTER;
  const side = at.y > (230 + 110 * z) * k * 0.9 + 20;
  const H = side ? (230 + 110 * z) * k : (55 + 25 * z) * k;
  const R0 = (side ? 9 : 12) * k;
  const R1 = (side ? 72 + 40 * z : 92 + 46 * z) * k;
  const SQ = side ? 0.3 : 0.74; // 斜着看横着的圈压扁成椭圆；从上往下看差不多是圆
  const wob = (side ? 14 + 8 * z : 6 + 4 * z) * k;
  // 风顶往画面中间歪
  const leanX = (window.innerWidth / 2 - at.x) * (side ? 0.12 : 0.04) + (Math.random() - 0.5) * (side ? 20 : 8) * k;
  const nb = Math.round(18 + 12 * z);
  const bands: Band[] = [];
  for (let i = 0; i < nb; i++) {
    const h = 0.03 + ((i + 0.5 + rnd(-0.3, 0.3)) / nb) * 0.95;
    bands.push({ h, span: rnd(1.15, 1.8) * Math.PI, th0: Math.random() * Math.PI * 2, w: rnd(9, 12.5) * (1.3 - 0.6 * h), thick: (5 + 10 * h) * k * rnd(0.85, 1.15) * (0.85 + 0.3 * z) });
  }
  bands.sort((a, b) => a.h - b.h);
  const wisps: Wisp[] = Array.from({ length: Math.round(26 + 30 * z) }, () => ({ phase: Math.random(), climb: rnd(0.6, 1.3), th0: Math.random() * Math.PI * 2, w: rnd(8, 13), rMul: rnd(1.08, 1.5), span: rnd(0.9, 2) }));
  const rocks: Rock[] = Array.from({ length: Math.round(6 + 7 * z) }, (_, i) => {
    const n = 5 + Math.floor(Math.random() * 3);
    const pts: Pt[] = Array.from({ length: n }, (_, j) => {
      const a = (j / n) * Math.PI * 2;
      const r = rnd(0.65, 1);
      return [Math.cos(a) * r, Math.sin(a) * r * rnd(0.65, 0.9)];
    });
    return {
      a0: Math.random() * Math.PI * 2,
      w: rnd(6, 9),
      hT: rnd(0.12, 0.65),
      rMul: rnd(1.05, 1.35),
      size: rnd(2.5, 5) * k * (0.85 + 0.3 * z),
      flingAt: i < 2 ? 0 : Math.random() < 0.3 ? rnd(0.35, T.hold - 0.2) : T.hold + rnd(-0.08, 0.12),
      pts,
      shade: rnd(0.55, 1),
    };
  });
  const sand: Grain[] = Array.from({ length: Math.round(60 + 70 * z) }, () => ({ phase: Math.random(), climb: rnd(0.5, 1.1), top: rnd(0.25, 0.6), th0: Math.random() * Math.PI * 2, w: rnd(6, 11), rMul: rnd(0.9, 1.9), r: rnd(0.7, 1.8) * k, tone: Math.random() }));
  const arcs: Arc[] = [];
  let nextArc = 0;
  let erupted = false;
  let broke = false;
  let flash = 0;
  const t0 = performance.now();
  let last = t0;

  const axis = (h: number, t: number): Pt => {
    const w = Math.pow(Math.max(h, 0), 1.5) * wob;
    return [at.x + leanX * h * h + Math.sin(t * 2.1 + h * 2 + 1.3) * w, at.y - h * H + Math.cos(t * 1.7 + h * 2.6) * w * SQ];
  };
  const radius = (h: number) => R0 + (R1 - R0) * Math.pow(Math.min(Math.max(h, 0), 1.2), 1.5);
  // 漏斗面上的一点：th 的 sin 大于 0 是朝着看的人的前半圈
  const onFunnel = (h: number, th: number, t: number, mul = 1): Pt => {
    const [cx, cy] = axis(h, t);
    const r = radius(h) * mul;
    return [cx + Math.cos(th) * r, cy + Math.sin(th) * r * SQ];
  };
  const addArc = (a: Pt, b: Pt, t: number, width: number, dur: number, branches = 1) => {
    const pts = jagged(a, b, 0.14);
    const br: Pt[][] = [];
    for (let i = 0; i < branches; i++) {
      const p = pts[Math.floor(rnd(0.2, 0.75) * pts.length)];
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) + rnd(-1, 1);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) * rnd(0.2, 0.45);
      br.push(jagged(p, [p[0] + Math.cos(ang) * len, p[1] + Math.sin(ang) * len], 0.18, 3));
    }
    arcs.push({ pts, branches: br, t0: t, dur, width });
  };
  const strokePath = (pts: Pt[], width: number, style: string) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts) ctx.lineTo(p[0], p[1]);
    ctx.stroke();
  };

  const frame = (now: number) => {
    if (!canvas.isConnected) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const tAll = (now - t0) / 1000;
    const tt = tAll - T.erupt;
    const end = T.hold + T.fade;
    const W = window.innerWidth;
    const VH = window.innerHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(VH * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(VH * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, VH);
    if (tt < 0) {
      requestAnimationFrame(frame);
      return;
    }
    if (!erupted) {
      erupted = true;
      flash = 1;
      opts.onErupt?.();
    }
    if (!broke && tt >= T.hold) {
      broke = true;
      flash = Math.max(flash, 0.8);
      opts.onBolt?.();
    }
    flash *= Math.exp(-dt * 9);
    const grow = tt < T.grow ? 1 - Math.pow(1 - tt / T.grow, 3) : 1;
    const fade = smooth(0, 1, (tt - T.hold) / T.fade);
    const alive = 1 - fade;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 风脚的灰：几道压扁的弧，转着往外散
    if (alive > 0.01) {
      const [bx, by] = axis(0, tt);
      ctx.globalCompositeOperation = 'source-over';
      for (let i = 0; i < 7; i++) {
        const r = (R0 * 4 + 26 * k) * (0.5 + 0.12 * i) * (1 + 0.5 * fade);
        const a0 = -tt * 7 + i * 0.9;
        ctx.strokeStyle = `rgba(214,198,176,${(0.35 * alive * Math.min(1, tt / 0.1)).toFixed(3)})`;
        ctx.lineWidth = (2 + i * 0.6) * k;
        ctx.beginPath();
        ctx.ellipse(bx, by, r, r * SQ, 0, a0, a0 + 1.6);
        ctx.stroke();
      }
    }
    // 风带：front 是前半圈（白），不是就是后半圈（漏斗里面，暗一点、带一点紫，淡一些）
    const bandPass = (front: boolean) => {
      for (const b of bands) {
        if (b.h > grow * 1.04) continue;
        const a = alive * (b.h > grow * 1.04 - 0.06 ? 0.5 : 1);
        if (a < 0.01) continue;
        const r = radius(b.h) * (1 + 0.9 * fade * fade);
        const [cx, cy0] = axis(b.h, tt);
        const cy = cy0 - fade * fade * H * 0.25 * b.h;
        const th0 = b.th0 + b.w * tt * (1 + 0.5 * fade);
        // 一截截连着的前半圈（或后半圈）画成一整块（一段段分开画，接缝处会叠出一道道细线），每 6 段换一次深浅
        const n = 24;
        const pt = (u: number, dy: number): Pt => {
          const th = th0 + u * b.span;
          const half = b.thick * 0.5 * Math.pow(Math.max(Math.sin(Math.PI * u), 0), 0.5);
          return [cx + Math.cos(th) * r, cy + Math.sin(th) * r * SQ + dy * half];
        };
        let i = 0;
        while (i < n) {
          if (front !== Math.sin(th0 + ((i + 0.5) / n) * b.span) > 0) {
            i++;
            continue;
          }
          let j = i;
          while (j < n && j - i < 6 && front === Math.sin(th0 + ((j + 0.5) / n) * b.span) > 0) j++;
          // 和下一截接上：多盖住半段，不留缝
          const u0 = i / n;
          const u1 = Math.min(1, (j + (j < n ? 0.5 : 0)) / n);
          const mid = (u0 + u1) / 2;
          const sA = Math.sin(th0 + mid * b.span);
          const along = Math.min(1, mid / 0.1) * Math.min(1, (1 - mid) / 0.25);
          ctx.beginPath();
          const steps = Math.max(2, Math.ceil((u1 - u0) * n * 2));
          for (let q = 0; q <= steps; q++) {
            const [x, y] = pt(u0 + ((u1 - u0) * q) / steps, -1);
            if (q === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          for (let q = steps; q >= 0; q--) {
            const [x, y] = pt(u0 + ((u1 - u0) * q) / steps, 1);
            ctx.lineTo(x, y);
          }
          ctx.closePath();
          if (front) {
            const g = Math.round(190 + 65 * Math.min(1, sA * 1.6));
            const bl = Math.round(225 + 30 * sA);
            ctx.fillStyle = `rgba(${g},${g},${bl},${(a * along * (0.72 + 0.25 * sA)).toFixed(3)})`;
          } else {
            // 从上往下看，越靠里（越低）越暗、越紫：像看进漏斗里
            const deep = side ? 0.5 : 0.35 + 0.65 * b.h;
            ctx.fillStyle = `rgba(${Math.round(150 + 80 * deep + 30 * flash)},${Math.round(135 + 85 * deep + 30 * flash)},${Math.round(215 + 30 * deep)},${(a * along * (side ? 0.5 : 0.62)).toFixed(3)})`;
          }
          ctx.fill();
          i = j;
        }
      }
    };
    // 从上往下看：漏斗底下一团紫光，先画（被风带盖住，从缝里透出来）
    ctx.globalCompositeOperation = 'lighter';
    if (alive > 0.01 && !side) {
      const [bx, by] = axis(0.15, tt);
      const a = alive * Math.min(1, tt / 0.12) * (0.85 + 0.15 * Math.sin(tt * 23)) * (1 + 1.2 * flash);
      const R = R1 * 0.5;
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, R);
      g.addColorStop(0, `rgba(240,232,255,${(0.5 * a).toFixed(3)})`);
      g.addColorStop(0.35, `rgba(150,95,255,${(0.3 * a).toFixed(3)})`);
      g.addColorStop(1, 'rgba(120,70,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(bx - R, by - R, R * 2, R * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
    bandPass(false);
    ctx.globalCompositeOperation = 'lighter';
    if (alive > 0.01 && side) {
      const [bx, by] = axis(0, tt);
      const [tx, ty] = axis(grow, tt);
      const g = ctx.createLinearGradient(bx, by, tx, ty);
      const a = alive * Math.min(1, tt / 0.12) * (0.85 + 0.15 * Math.sin(tt * 23)) * (1 + 1.5 * flash);
      g.addColorStop(0, `rgba(235,225,255,${(0.55 * a).toFixed(3)})`);
      g.addColorStop(0.35, `rgba(150,95,255,${(0.35 * a).toFixed(3)})`);
      g.addColorStop(1, 'rgba(120,70,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      const steps = 12;
      for (let i = 0; i <= steps; i++) {
        const h = (i / steps) * grow;
        const [cx, cy] = axis(h, tt);
        if (i === 0) ctx.moveTo(cx - radius(h) * 0.8, cy);
        else ctx.lineTo(cx - radius(h) * 0.8, cy);
      }
      for (let i = steps; i >= 0; i--) {
        const h = (i / steps) * grow;
        const [cx, cy] = axis(h, tt);
        ctx.lineTo(cx + radius(h) * 0.8, cy);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    // 沙土
    const drawSand = (back: boolean) => {
      for (const p of sand) {
        const life = (p.phase + tt * p.climb) % 1;
        const h = life * p.top;
        const th = p.th0 + p.w * tt;
        if (Math.sin(th) < 0 !== back || h > grow) continue;
        const a = smooth(0, 0.15, life) * (1 - smooth(0.75, 1, life)) * alive;
        if (a < 0.02) continue;
        const [x, y] = onFunnel(h, th, tt, p.rMul);
        const out = fade * 60 * k * (0.6 + p.tone);
        const c = Math.round(140 + 75 * p.tone);
        ctx.fillStyle = `rgba(${c},${Math.round(c * 0.88)},${Math.round(c * 0.72)},${(0.75 * a).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x + Math.cos(th) * out, y + Math.sin(th) * out * SQ - fade * 20 * k * p.tone, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    // 碎石：卷在风里转，到点甩出去、落下来、淡掉
    const rockAt = (r: Rock): { x: number; y: number; back: boolean; a: number; rot: number } => {
      if (tt < r.flingAt) {
        const h = 0.03 + r.hT * (1 - Math.exp(-tt * 2.4));
        const th = r.a0 + r.w * tt;
        const [x, y] = onFunnel(h, th, tt, r.rMul);
        return { x, y, back: Math.sin(th) < 0, a: Math.min(1, tt / 0.12), rot: tt * 9 };
      }
      if (!r.p || !r.v) {
        const h = r.flingAt === 0 ? 0 : 0.03 + r.hT * (1 - Math.exp(-r.flingAt * 2.4));
        const th = r.a0 + r.w * r.flingAt;
        const [x, y] = r.flingAt === 0 ? axis(0, 0) : onFunnel(h, th, r.flingAt, r.rMul);
        r.p = { x, y };
        const out = rnd(160, 300) * k;
        r.v = { x: Math.cos(th) * out - Math.sin(th) * r.w * 18 * k, y: -rnd(140, 280) * k + Math.sin(th) * out * SQ };
        r.floor = axis(0, 0)[1] + rnd(-10, 40) * k;
      }
      const kk = tt - r.flingAt;
      const x = Math.max(-50, Math.min(W + 50, r.p.x + r.v.x * kk));
      const y = Math.min(r.floor!, r.p.y + r.v.y * kk + 0.5 * 900 * k * kk * kk);
      return { x, y, back: false, a: 1 - smooth(0.9, 1.4, kk), rot: r.flingAt * 9 + kk * 6 };
    };
    const drawRocks = (back: boolean) => {
      for (const r of rocks) {
        const p = rockAt(r);
        if (p.back !== back || p.a < 0.02) continue;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.beginPath();
        r.pts.forEach(([px, py], i) => (i ? ctx.lineTo(px * r.size, py * r.size) : ctx.moveTo(px * r.size, py * r.size)));
        ctx.closePath();
        const c = Math.round(70 + 40 * r.shade);
        ctx.fillStyle = `rgba(${c},${Math.round(c * 0.9)},${Math.round(c * 0.82)},${p.a.toFixed(3)})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(30,24,20,${(0.6 * p.a).toFixed(3)})`;
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ctx.restore();
      }
    };
    drawSand(true);
    drawRocks(true);
    bandPass(true);
    drawSand(false);
    drawRocks(false);
    // 风丝（加法）
    ctx.globalCompositeOperation = 'lighter';
    if (alive > 0.01) {
      for (const w of wisps) {
        const life = (w.phase + tt * w.climb) % 1;
        const la = smooth(0, 0.1, life) * (1 - smooth(0.85, 1, life)) * alive;
        if (la < 0.02 || life * 1.1 > grow + 0.05) continue;
        const pts: Pt[] = [];
        for (let i = 0; i <= 10; i++) {
          const u = i / 10;
          const h = Math.min(1.1, life * 1.12 - u * w.span * 0.1);
          pts.push(onFunnel(Math.max(0, h), w.th0 + w.w * tt - u * w.span, tt, w.rMul * (1 + 1.3 * fade)));
        }
        strokePath(pts, 2.2 * k, `rgba(${PURPLE},${(0.35 * la).toFixed(3)})`);
        strokePath(pts, 0.9 * k, `rgba(255,250,255,${(0.75 * la).toFixed(3)})`);
      }
    }
    // 电弧：风还在时多是在风上爬、往天上劈，偶尔劈到桌上；风散以后是牌四周的残电
    if (tt < end + T.after * 0.75) {
      nextArc -= dt;
      while (nextArc <= 0) {
        nextArc += (tt < end ? 0.07 + 0.07 * (1 - z) : 0.14) * rnd(0.7, 1.4);
        if (tt >= end) {
          const [bx, by] = axis(0, tt);
          addArc([bx + rnd(-20, 20) * k, by - rnd(25, 70) * k], [bx + rnd(-50, 50) * k, by + rnd(-6, 6) * k], tAll, 0.8, 0.2, 1);
          flash = Math.max(flash, 0.25);
          continue;
        }
        const kind = Math.random();
        const front = () => rnd(0.2, Math.PI - 0.2);
        if (kind < 0.5) {
          const h1 = rnd(0.3, 0.95);
          const th1 = front();
          const h2 = Math.min(1.05, Math.max(0.15, h1 + rnd(-0.28, 0.12)));
          addArc(onFunnel(h1, th1, tt, 1.08), onFunnel(h2, th1 + rnd(0.5, 1.3) * (Math.random() < 0.5 ? -1 : 1), tt, 1.08), tAll, 1, rnd(0.14, 0.22), 1);
          flash = Math.max(flash, 0.35);
        } else if (kind < 0.82) {
          const th = rnd(-Math.PI, 0);
          const a = onFunnel(rnd(0.9, 1.02), th, tt, 1.02);
          addArc(a, [a[0] + Math.cos(th) * rnd(30, 70) * k, a[1] - rnd(40, 90) * k], tAll, 1.15, rnd(0.15, 0.24), 2);
          flash = Math.max(flash, 0.45);
        } else {
          const th = front();
          const [bx, by] = axis(0, tt);
          const d = rnd(60, 110) * k;
          addArc(onFunnel(rnd(0.45, 0.8), th, tt, 1.05), [bx + Math.cos(th) * d, by + Math.sin(th) * d * SQ], tAll, 1.5, 0.28, 2);
          flash = Math.max(flash, 0.7);
          opts.onBolt?.();
        }
      }
    }
    for (let i = arcs.length - 1; i >= 0; i--) {
      const a = arcs[i];
      const kk = (tAll - a.t0) / a.dur;
      if (kk >= 1) {
        arcs.splice(i, 1);
        continue;
      }
      // 很快摸过去，一闪，再弱弱地闪一下
      const env = kk < 0.18 ? 0.6 + 2 * kk : Math.max(Math.exp(-(kk - 0.15) / 0.09), kk > 0.58 ? 0.6 * Math.exp(-(kk - 0.58) / 0.09) : 0);
      const shown = Math.max(2, Math.ceil(a.pts.length * Math.min(1, kk / 0.18)));
      const pts = a.pts.slice(0, shown);
      strokePath(pts, 7 * a.width * k, `rgba(${PURPLE},${(0.22 * env).toFixed(3)})`);
      strokePath(pts, 2.6 * a.width * k, `rgba(196,160,255,${(0.6 * env).toFixed(3)})`);
      strokePath(pts, 1.1 * a.width * k, `rgba(255,250,255,${Math.min(1, env).toFixed(3)})`);
      if (kk > 0.18) for (const b of a.branches) strokePath(b, 1.2 * a.width * k, `rgba(220,200,255,${(0.6 * env).toFixed(3)})`);
    }
    // 起风、电闪、散开时的光
    if (flash > 0.02) {
      const [bx, by] = axis(broke ? 0.5 : 0, tt);
      const R = (broke ? 1.4 : 1) * (80 + 60 * z) * k;
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, R);
      g.addColorStop(0, `rgba(255,250,255,${(0.7 * flash).toFixed(3)})`);
      g.addColorStop(0.35, `rgba(190,150,255,${(0.4 * flash).toFixed(3)})`);
      g.addColorStop(1, 'rgba(120,60,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(bx - R, by - R, R * 2, R * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
    if (tt > end + T.after && arcs.length === 0 && rocks.every((r) => tt > r.flingAt + 1.4)) {
      canvas.remove();
      return;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  // 页面切到后台时动画帧不走：到点自己收掉
  window.setTimeout(() => canvas.remove(), (T.erupt + T.hold + T.fade + T.after + 2) * 1000);
}
