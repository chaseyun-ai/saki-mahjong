import type { EyeLook, EyeShape } from './eyeLooks';

// 睁眼特写的眼睛模板：用 Canvas 2D 一笔笔画出来，不用图片。
// 一帧画一次：drawEyeShot(ctx, w, h, look, state)。state 是这一刻的睁眼程度、瞳孔缩放、光……（eyeShot.ts 按时间算好传进来）
//
// 眼睛自己的坐标：眼宽 2（内眼角 x=-1，外眼角 x=1），y 向下。画面左边那只眼睛左右翻过来画，高光不翻（光从同一边来）

type P = [number, number];

export interface EyeState {
  open: number; // 0 闭着，1 睁开（可以略大于 1：睁眼那一下瞪一下）
  pupil: number; // 瞳孔缩放，1 是平常
  glint: number; // 高光缩放（睁开那一下弹出来）
  glow: number; // 0～1，瞳孔周围的光
  flash: number; // 0～1，整格闪白
  ring: number; // 0～1，从瞳孔扩散出去的一圈光（-1 不画）
  trail: number; // 0～1，眼尾光尾的长度
  shine: number; // 眼镜反光扫过去的位置，0～1（-1 不画）
  time: number; // 秒，光尾抖动用
}

// ---------- 颜色 ----------

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const css = (c: [number, number, number], a = 1): string => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
// k < 0 往黑里调，k > 0 往白里调
function shade(hex: string, k: number, a = 1): string {
  const c = rgb(hex);
  const t = k < 0 ? 0 : 255;
  const f = Math.abs(k);
  return css([c[0] + (t - c[0]) * f, c[1] + (t - c[1]) * f, c[2] + (t - c[2]) * f], a);
}
function mix(a: string, b: string, k: number): string {
  const x = rgb(a);
  const y = rgb(b);
  const h = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  return `#${h(x[0] + (y[0] - x[0]) * k)}${h(x[1] + (y[1] - x[1]) * k)}${h(x[2] + (y[2] - x[2]) * k)}`;
}

// ---------- 曲线 ----------

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpP = (a: P, b: P, t: number): P => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

interface Curve {
  a: P;
  b: P;
  c: P;
  d: P;
}
function at(k: Curve, t: number): P {
  const u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [w[0] * k.a[0] + w[1] * k.b[0] + w[2] * k.c[0] + w[3] * k.d[0], w[0] * k.a[1] + w[1] * k.b[1] + w[2] * k.c[1] + w[3] * k.d[1]];
}
function tangent(k: Curve, t: number): P {
  const u = 1 - t;
  const x = 3 * u * u * (k.b[0] - k.a[0]) + 6 * u * t * (k.c[0] - k.b[0]) + 3 * t * t * (k.d[0] - k.c[0]);
  const y = 3 * u * u * (k.b[1] - k.a[1]) + 6 * u * t * (k.c[1] - k.b[1]) + 3 * t * t * (k.d[1] - k.c[1]);
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
}
const lerpCurve = (p: Curve, q: Curve, t: number): Curve => ({ a: lerpP(p.a, q.a, t), b: lerpP(p.b, q.b, t), c: lerpP(p.c, q.c, t), d: lerpP(p.d, q.d, t) });

// ---------- 眼型 ----------

interface Form {
  upper: Curve; // 睁开时的上眼睑（睫毛线），内眼角到外眼角
  lower: Curve; // 下眼睑。闭眼时上眼睑落到这条线上（弯成 ‿）
  flick: P; // 眼尾睫毛甩出去的尖
  iris: [number, number, number, number]; // 虹膜中心 x、y，半径 rx、ry
}

const FORMS: Record<EyeShape, Form> = {
  round: {
    upper: { a: [-1, 0.12], b: [-0.62, -0.8], c: [0.45, -0.98], d: [1, -0.14] },
    lower: { a: [-1, 0.12], b: [-0.55, 0.92], c: [0.55, 0.92], d: [1, -0.14] },
    flick: [1.22, 0.06],
    iris: [0.02, 0.1, 0.56, 0.8],
  },
  sharp: {
    upper: { a: [-1, 0.16], b: [-0.6, -0.62], c: [0.5, -0.95], d: [1.04, -0.4] },
    lower: { a: [-1, 0.16], b: [-0.5, 0.86], c: [0.62, 0.66], d: [1.04, -0.4] },
    flick: [1.26, -0.5],
    iris: [0.04, 0.06, 0.54, 0.76],
  },
  droopy: {
    upper: { a: [-1, 0.06], b: [-0.62, -0.86], c: [0.52, -0.86], d: [1, 0.2] },
    lower: { a: [-1, 0.06], b: [-0.55, 0.92], c: [0.6, 0.9], d: [1, 0.2] },
    flick: [1.2, 0.42],
    iris: [0.02, 0.12, 0.56, 0.8],
  },
  narrow: {
    upper: { a: [-1, 0.14], b: [-0.6, -0.5], c: [0.5, -0.66], d: [1.04, -0.3] },
    lower: { a: [-1, 0.14], b: [-0.5, 0.66], c: [0.62, 0.56], d: [1.04, -0.3] },
    flick: [1.26, -0.38],
    iris: [0.03, 0.06, 0.5, 0.72],
  },
};

// 虹膜纹路：每只眼睛一样，用固定的伪随机
const FIBERS: { a: number; r0: number; r1: number; w: number }[] = [];
{
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) FIBERS.push({ a: (i / 26) * Math.PI * 2 + rnd() * 0.2, r0: 0.42 + rnd() * 0.12, r1: 0.78 + rnd() * 0.18, w: 0.012 + rnd() * 0.014 });
}

// ---------- 一只眼睛 ----------

interface EyeOpts {
  x: number; // 画面上的中心
  y: number;
  u: number; // 半个眼宽多少像素
  flip: boolean; // 画面左边那只：左右翻过来
  open: number;
}

function eyePath(ctx: CanvasRenderingContext2D, k: Curve): void {
  ctx.moveTo(k.a[0], k.a[1]);
  ctx.bezierCurveTo(k.b[0], k.b[1], k.c[0], k.c[1], k.d[0], k.d[1]);
}

// 上眼睑以下、下眼睑以上：两次 clip 取交集，闭眼时自然什么都不剩
function clipOpening(ctx: CanvasRenderingContext2D, up: Curve, low: Curve): void {
  ctx.beginPath();
  eyePath(ctx, up);
  ctx.lineTo(3, up.d[1]);
  ctx.lineTo(3, 3);
  ctx.lineTo(-3, 3);
  ctx.lineTo(-3, up.a[1]);
  ctx.closePath();
  ctx.clip();
  ctx.beginPath();
  eyePath(ctx, low);
  ctx.lineTo(3, low.d[1]);
  ctx.lineTo(3, -3);
  ctx.lineTo(-3, -3);
  ctx.lineTo(-3, low.a[1]);
  ctx.closePath();
  ctx.clip();
}

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, inner: number, n: number, rot = -Math.PI / 2): void {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const rr = i % 2 ? r * inner : r;
    const a = rot + (i * Math.PI) / n;
    const px = cx + Math.cos(a) * rr;
    const py = cy + Math.sin(a) * rr;
    if (i) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  }
  ctx.closePath();
}

function drawIris(ctx: CanvasRenderingContext2D, look: EyeLook, f: Form, s: EyeState, flip: boolean): void {
  const [ix, iy, rx, ry] = f.iris;
  const blank = look.pupil === 'none';
  // 底色：上深下浅
  const g = ctx.createLinearGradient(0, iy - ry, 0, iy + ry);
  if (blank) {
    g.addColorStop(0, shade(look.iris, 0.35));
    g.addColorStop(1, shade(look.iris, 0.75));
  } else {
    g.addColorStop(0, shade(look.iris, -0.62));
    g.addColorStop(0.42, look.iris);
    g.addColorStop(1, shade(look.iris, 0.38));
  }
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(ix, iy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(ix, iy, rx, ry, 0, 0, Math.PI * 2);
  ctx.clip();
  if (!blank) {
    // 纹路
    ctx.strokeStyle = shade(look.iris, -0.5, 0.35);
    ctx.lineCap = 'round';
    for (const fb of FIBERS) {
      ctx.lineWidth = fb.w;
      ctx.beginPath();
      ctx.moveTo(ix + Math.cos(fb.a) * rx * fb.r0, iy + Math.sin(fb.a) * ry * fb.r0);
      ctx.lineTo(ix + Math.cos(fb.a) * rx * fb.r1, iy + Math.sin(fb.a) * ry * fb.r1);
      ctx.stroke();
    }
    // 下半截反光（动画眼睛那块亮的月牙）
    const lg = ctx.createRadialGradient(ix, iy + ry * 0.62, 0, ix, iy + ry * 0.62, rx * 1.05);
    lg.addColorStop(0, shade(look.iris, 0.62, 0.85));
    lg.addColorStop(1, shade(look.iris, 0.62, 0));
    ctx.fillStyle = lg;
    ctx.fillRect(ix - rx, iy, rx * 2, ry);
  }
  // 瞳孔
  const pr = s.pupil;
  const dark = shade(look.iris, -0.86);
  ctx.fillStyle = dark;
  const py = iy - ry * 0.06;
  switch (look.pupil) {
    case 'round':
      ctx.beginPath();
      ctx.ellipse(ix, py, rx * 0.36 * pr, ry * 0.4 * pr, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'slit':
      ctx.beginPath();
      ctx.moveTo(ix, py - ry * 0.7);
      ctx.quadraticCurveTo(ix + rx * 0.24 * pr, py, ix, py + ry * 0.7);
      ctx.quadraticCurveTo(ix - rx * 0.24 * pr, py, ix, py - ry * 0.7);
      ctx.fill();
      break;
    case 'ring':
      ctx.beginPath();
      ctx.ellipse(ix, py, rx * 0.3 * pr, ry * 0.34 * pr, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = shade(look.glow, 0.3, 0.55 + 0.45 * s.glow);
      ctx.lineWidth = 0.045;
      ctx.beginPath();
      ctx.ellipse(ix, py, rx * 0.56, ry * 0.58, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'star':
      star(ctx, ix, py, rx * 0.48 * pr, 0.45, 5);
      ctx.fill();
      break;
    case 'reticle': {
      ctx.beginPath();
      ctx.ellipse(ix, py, rx * 0.2 * pr, ry * 0.22 * pr, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = shade(look.glow, 0.4, 0.5 + 0.5 * s.glow);
      ctx.lineWidth = 0.035;
      ctx.beginPath();
      ctx.ellipse(ix, py, rx * 0.5, ry * 0.52, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        ctx.moveTo(ix + dx * rx * 0.3, py + dy * ry * 0.3);
        ctx.lineTo(ix + dx * rx * 0.86, py + dy * ry * 0.86);
      }
      ctx.stroke();
      break;
    }
    case 'spiral': {
      ctx.beginPath();
      ctx.ellipse(ix, py, rx * 0.24 * pr, ry * 0.27 * pr, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = shade(look.iris, -0.7, 0.85);
      ctx.lineWidth = 0.05;
      ctx.beginPath();
      const turn = s.time * 2.2;
      for (let i = 0; i <= 60; i++) {
        const t = i / 60;
        const a = turn + t * Math.PI * 4.2 * (flip ? -1 : 1);
        const r = 0.22 + t * 0.66;
        const px = ix + Math.cos(a) * rx * r;
        const ppy = py + Math.sin(a) * ry * r;
        if (i) ctx.lineTo(px, ppy);
        else ctx.moveTo(px, ppy);
      }
      ctx.stroke();
      break;
    }
    case 'none':
      break;
  }
  ctx.restore();
  // 虹膜外圈
  ctx.strokeStyle = blank ? shade(look.iris, -0.1, 0.6) : shade(look.iris, -0.75);
  ctx.lineWidth = 0.05;
  ctx.beginPath();
  ctx.ellipse(ix, iy, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
}

// 高光：位置按画面算（光从左上来），所以翻过来的那只眼睛把 x 再翻回去
function drawGlint(ctx: CanvasRenderingContext2D, look: EyeLook, f: Form, s: EyeState, flip: boolean): void {
  const [ix, iy, rx, ry] = f.iris;
  const k = s.glint;
  if (k <= 0) return;
  const X = (x: number) => ix + (flip ? -x : x) * rx;
  const Y = (y: number) => iy + y * ry;
  ctx.fillStyle = '#ffffff';
  const blob = (x: number, y: number, w: number, h: number, a = 1) => {
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.ellipse(X(x), Y(y), w * rx * k, h * ry * k, flip ? 0.5 : -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  };
  switch (look.glint) {
    case 'twin':
      blob(-0.34, -0.3, 0.3, 0.2);
      blob(0.36, 0.46, 0.12, 0.09, 0.9);
      break;
    case 'single':
      blob(-0.3, -0.3, 0.34, 0.24);
      break;
    case 'star':
      star(ctx, X(-0.3), Y(-0.32), rx * 0.36 * k, 0.22, 4, 0);
      ctx.fill();
      blob(0.36, 0.48, 0.1, 0.08, 0.9);
      break;
    case 'moon': {
      // 月牙：大圆挖掉一块
      const cx = X(-0.3);
      const cy = Y(-0.3);
      const r = rx * 0.3 * k;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.arc(cx + (flip ? -1 : 1) * r * 0.5, cy - r * 0.18, r * 0.86, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
      blob(0.38, 0.46, 0.1, 0.08, 0.9);
      break;
    }
    case 'sparkle':
      blob(-0.32, -0.3, 0.3, 0.2);
      star(ctx, X(0.34), Y(0.38), rx * 0.2 * k, 0.2, 4, 0);
      ctx.fill();
      star(ctx, X(0.1), Y(-0.55), rx * 0.11 * k, 0.2, 4, 0);
      ctx.fill();
      break;
    case 'flower': {
      const cx = X(-0.3);
      const cy = Y(-0.3);
      const r = rx * 0.15 * k;
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
        ctx.beginPath();
        ctx.ellipse(cx + Math.cos(a) * r, cy + Math.sin(a) * r, r * 0.78, r * 0.52, a, 0, Math.PI * 2);
        ctx.fill();
      }
      blob(0.36, 0.46, 0.1, 0.08, 0.9);
      break;
    }
    case 'dull':
      blob(-0.3, -0.28, 0.14, 0.1, 0.55);
      break;
    case 'none':
      break;
  }
}

// 上眼睑的睫毛线：沿着曲线加厚，内眼角细、外眼角粗，眼尾甩出一个尖
function lashShape(up: Curve, flick: P, open: number): P[] {
  const outer: P[] = [];
  const inner: P[] = [];
  const N = 28;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const p = at(up, t);
    const tg = tangent(up, t);
    const n: P = [tg[1], -tg[0]];
    const th = 0.03 + 0.15 * smooth(0.08, 0.86, t) * (0.6 + 0.4 * open);
    outer.push([p[0] + n[0] * th, p[1] + n[1] * th]);
    inner.push([p[0] - n[0] * 0.02, p[1] - n[1] * 0.02]);
  }
  // 闭眼时眼尾的尖收短，贴着弧线
  const end = up.d;
  const tip = lerpP([end[0] + 0.14, end[1] + 0.04], flick, 0.35 + 0.65 * clamp01(open));
  return [...outer, tip, ...inner.reverse()];
}

function drawEye(ctx: CanvasRenderingContext2D, look: EyeLook, s: EyeState, o: EyeOpts): void {
  const f = FORMS[look.shape];
  const open = o.open;
  const up = lerpCurve(f.lower, f.upper, open);
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.scale(o.flip ? -o.u : o.u, o.u);
  const lash = mix('#1a1012', look.hair, 0.18);

  if (open > 0.02) {
    // 眼睛里面
    ctx.save();
    clipOpening(ctx, up, f.lower);
    const sc = ctx.createRadialGradient(0.05, 0.05, 0.2, 0.05, 0.05, 1.15);
    sc.addColorStop(0, '#fdfcff');
    sc.addColorStop(1, '#d9d6e6');
    ctx.fillStyle = sc;
    ctx.fillRect(-2, -2, 4, 4);
    drawIris(ctx, look, f, s, o.flip);
    // 上眼睑投下来的影子
    const N = 20;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const p = at(up, i / N);
      if (i) ctx.lineTo(p[0], p[1]);
      else ctx.moveTo(p[0], p[1]);
    }
    for (let i = N; i >= 0; i--) {
      const p = at(up, i / N);
      ctx.lineTo(p[0], p[1] + 0.34);
    }
    ctx.closePath();
    const sg = ctx.createLinearGradient(0, up.c[1] * 0.75, 0, up.c[1] * 0.75 + 0.5);
    sg.addColorStop(0, 'rgba(40,24,40,0.5)');
    sg.addColorStop(1, 'rgba(40,24,40,0)');
    ctx.fillStyle = sg;
    ctx.fill();
    // 瞳孔周围的光
    if (s.glow > 0) {
      const [ix, iy, rx] = f.iris;
      ctx.globalCompositeOperation = 'lighter';
      const gg = ctx.createRadialGradient(ix, iy, rx * 0.15, ix, iy, rx * 1.2);
      gg.addColorStop(0, shade(look.glow, 0.2, 0.55 * s.glow));
      gg.addColorStop(1, shade(look.glow, 0, 0));
      ctx.fillStyle = gg;
      ctx.fillRect(-2, -2, 4, 4);
      ctx.globalCompositeOperation = 'source-over';
    }
    drawGlint(ctx, look, f, s, o.flip);
    ctx.restore();
  }

  // 睫毛线
  ctx.fillStyle = lash;
  ctx.beginPath();
  lashShape(up, f.flick, open).forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.closePath();
  ctx.fill();
  // 几根睫毛：睁着朝外上方翘，闭着朝下垂
  ctx.beginPath();
  for (const t of [0.66, 0.78, 0.9]) {
    const p = at(up, t);
    const tg = tangent(up, t);
    const n: P = [tg[1], -tg[0]];
    const th = 0.03 + 0.15 * smooth(0.08, 0.86, t);
    const upTip: P = [p[0] + n[0] * (th + 0.16) + tg[0] * 0.14, p[1] + n[1] * (th + 0.16) + tg[1] * 0.14];
    const downTip: P = [p[0] - n[0] * 0.2 + tg[0] * 0.1, p[1] - n[1] * 0.2 + tg[1] * 0.1];
    const tip = lerpP(downTip, upTip, clamp01(open));
    ctx.moveTo(p[0] - tg[0] * 0.05, p[1] - tg[1] * 0.05);
    ctx.lineTo(tip[0], tip[1]);
    ctx.lineTo(p[0] + tg[0] * 0.05, p[1] + tg[1] * 0.05);
  }
  ctx.fill();
  // 双眼皮
  if (open > 0.3) {
    ctx.strokeStyle = shade(look.skin, -0.45, 0.55 * smooth(0.3, 0.9, open));
    ctx.lineWidth = 0.035;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i <= 14; i++) {
      const t = 0.3 + (i / 14) * 0.6;
      const p = at(up, t);
      const tg = tangent(up, t);
      const n: P = [tg[1], -tg[0]];
      const d = 0.34;
      if (i) ctx.lineTo(p[0] + n[0] * d, p[1] + n[1] * d);
      else ctx.moveTo(p[0] + n[0] * d, p[1] + n[1] * d);
    }
    ctx.stroke();
  }
  // 下睫毛：外侧一段细线
  ctx.strokeStyle = mix(lash, look.skin, 0.15);
  ctx.globalAlpha = 0.9;
  ctx.lineCap = 'round';
  for (let i = 0; i < 10; i++) {
    const t0 = 0.4 + i * 0.05;
    const a = at(f.lower, t0);
    const b = at(f.lower, t0 + 0.05);
    ctx.lineWidth = 0.016 + 0.04 * (i / 9);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ---------- 眼尾的光尾、扩散的光圈 ----------

function drawTrail(ctx: CanvasRenderingContext2D, look: EyeLook, s: EyeState, o: EyeOpts): void {
  if (s.trail <= 0) return;
  const f = FORMS[look.shape];
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.scale(o.flip ? -o.u : o.u, o.u);
  ctx.globalCompositeOperation = 'screen';
  const start: P = [f.flick[0] - 0.06, f.flick[1] - 0.04];
  const len = 2.3 * s.trail;
  const N = 24;
  const lift = f.flick[1] - f.upper.d[1] - 0.2;
  const mid = (t: number): P => [start[0] + t * len, start[1] + t * len * lift * 0.5 + Math.sin(s.time * 16 + t * 8) * 0.06 * t];
  const ribbon = (width: number, color: CanvasGradient | string) => {
    const top: P[] = [];
    const bot: P[] = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const p = mid(t);
      const wv = width * Math.pow(1 - t, 0.8) * smooth(0, 0.12, t) * (0.85 + 0.15 * Math.sin(s.time * 29 + t * 12));
      top.push([p[0], p[1] - wv]);
      bot.push([p[0], p[1] + wv * 0.6]);
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    [...top, ...bot.reverse()].forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
    ctx.fill();
  };
  ctx.globalCompositeOperation = 'source-over';
  const halo = ctx.createLinearGradient(start[0], 0, start[0] + len, 0);
  halo.addColorStop(0, shade(look.glow, 0, 0.35));
  halo.addColorStop(1, shade(look.glow, 0, 0));
  ribbon(0.5, halo);
  const g = ctx.createLinearGradient(start[0], 0, start[0] + len, 0);
  g.addColorStop(0, shade(look.glow, -0.05, 0.95));
  g.addColorStop(0.6, shade(look.glow, -0.15, 0.55));
  g.addColorStop(1, shade(look.glow, -0.2, 0));
  ribbon(0.28, g);
  ctx.globalCompositeOperation = 'screen';
  const c = ctx.createLinearGradient(start[0], 0, start[0] + len * 0.7, 0);
  c.addColorStop(0, 'rgba(255,255,255,0.95)');
  c.addColorStop(1, 'rgba(255,255,255,0)');
  ribbon(0.08, c);
  ctx.restore();
}

function drawAura(ctx: CanvasRenderingContext2D, look: EyeLook, s: EyeState, o: EyeOpts): void {
  const f = FORMS[look.shape];
  const cx = o.x + (o.flip ? -1 : 1) * f.iris[0] * o.u;
  const cy = o.y + f.iris[1] * o.u;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  if (s.glow > 0) {
    const g = ctx.createRadialGradient(cx, cy, o.u * 0.3, cx, cy, o.u * 1.9);
    g.addColorStop(0, shade(look.glow, 0, 0.3 * s.glow));
    g.addColorStop(1, shade(look.glow, 0, 0));
    ctx.fillStyle = g;
    ctx.fillRect(cx - o.u * 2, cy - o.u * 2, o.u * 4, o.u * 4);
  }
  if (s.ring >= 0 && s.ring < 1) {
    const r = o.u * (0.5 + s.ring * 2.4);
    ctx.strokeStyle = shade(look.glow, 0.3, 0.7 * (1 - s.ring));
    ctx.lineWidth = o.u * 0.08 * (1 - s.ring) + 1;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * 0.8, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------- 眼镜 ----------

function drawGlasses(ctx: CanvasRenderingContext2D, look: EyeLook, s: EyeState, eyes: EyeOpts[]): void {
  ctx.save();
  const frame = mix('#202028', look.hair, 0.3);
  for (const o of eyes) {
    const x0 = o.x - o.u * 1.32;
    const w = o.u * 2.64;
    const y0 = o.y - o.u * 1.12;
    const h = o.u * 2.12;
    const r = o.u * 0.4;
    ctx.beginPath();
    ctx.roundRect(x0, y0, w, h, r);
    ctx.fillStyle = 'rgba(220,235,255,0.07)';
    ctx.fill();
    // 反光扫过去：一条斜的白带，扫到中间时整片镜片发白
    if (s.shine >= 0 && s.shine <= 1) {
      ctx.save();
      ctx.clip();
      const bx = x0 - w * 0.6 + s.shine * w * 2.2;
      const glare = 1 - Math.abs(s.shine - 0.5) * 2;
      ctx.fillStyle = `rgba(255,255,255,${0.85 * glare})`;
      ctx.fillRect(x0, y0, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath();
      ctx.moveTo(bx, y0 - 4);
      ctx.lineTo(bx + w * 0.38, y0 - 4);
      ctx.lineTo(bx + w * 0.08, y0 + h + 4);
      ctx.lineTo(bx - w * 0.3, y0 + h + 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.strokeStyle = frame;
    ctx.lineWidth = Math.max(2, o.u * 0.07);
    ctx.beginPath();
    ctx.roundRect(x0, y0, w, h, r);
    ctx.stroke();
  }
  // 鼻梁上的横梁
  if (eyes.length === 2) {
    const [a, b] = eyes[0].x < eyes[1].x ? eyes : [eyes[1], eyes[0]];
    ctx.beginPath();
    ctx.moveTo(a.x + a.u * 1.32, a.y - a.u * 0.55);
    ctx.quadraticCurveTo((a.x + b.x) / 2, a.y - a.u * 0.85, b.x - b.u * 1.32, b.y - b.u * 0.55);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------- 脸（前发、眉毛、皮肤）：一格画一次，存成底图 ----------

export interface Layout {
  eyes: { x: number; y: number; u: number; flip: boolean; side: 'left' | 'right' }[];
}

// 两只眼睛在格子里的位置。side 是角色自己的左右：画面左边那只是她的右眼
export function eyeLayout(w: number, h: number): Layout {
  const u = Math.min(w * 0.095, h * 0.32);
  const y = h * 0.62;
  return {
    eyes: [
      { x: w * 0.5 - u * 1.95, y, u, flip: true, side: 'right' },
      { x: w * 0.5 + u * 1.95, y, u, flip: false, side: 'left' },
    ],
  };
}

interface Strand {
  x0: number; // 发根左右两边
  x1: number;
  tx: number; // 发梢
  ty: number;
}

// 前发一绺绺：固定的伪随机，同一个人每次一样。分两层，后面一层深一点、错开半绺
function bangs(seed: string, w: number, h: number): { back: Strand[]; front: Strand[] } {
  let s = 0;
  for (const ch of seed) s = (s * 31 + ch.charCodeAt(0)) % 2147483647;
  s = s || 11;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  // 分缝的位置：发梢都往分缝外侧弯
  const part = w * (0.38 + rnd() * 0.24);
  const row = (offset: number, long: number): Strand[] => {
    const out: Strand[] = [];
    let x = -w * 0.06 + offset;
    while (x < w * 1.04) {
      const sw = w * (0.06 + rnd() * 0.045);
      const c = x + sw / 2;
      const away = c < part ? -1 : 1;
      // 眉心那绺长一点，两边鬓角长一点，正对眼睛的短一点
      const mid = Math.abs(c - w / 2) / (w / 2);
      const ty = h * (0.16 + rnd() * 0.1 + (mid < 0.1 ? 0.08 : 0) + (mid > 0.78 ? 0.15 : 0) + long);
      out.push({ x0: x, x1: x + sw, tx: c + away * sw * (0.35 + rnd() * 0.45), ty });
      x += sw * (0.62 + rnd() * 0.16);
    }
    return out;
  };
  const back = row(w * 0.05, 0.05);
  const front = row(0, 0);
  return { back, front };
}

function strandPath(ctx: CanvasRenderingContext2D, b: Strand, top: number, dy = 0, fresh = true): void {
  const sw = b.x1 - b.x0;
  if (fresh) ctx.beginPath();
  ctx.moveTo(b.x0, top);
  ctx.bezierCurveTo(b.x0 + sw * 0.02, b.ty * 0.55 + dy, b.tx - sw * 0.18, b.ty * 0.9 + dy, b.tx, b.ty + dy);
  ctx.bezierCurveTo(b.x1 - sw * 0.3, b.ty * 0.66 + dy, b.x1, b.ty * 0.3 + dy, b.x1, top);
  ctx.closePath();
}

export function drawFace(ctx: CanvasRenderingContext2D, w: number, h: number, look: EyeLook, seed: string): void {
  // 皮肤：上面压着前发的影子，下面亮一点
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, shade(look.skin, -0.2));
  g.addColorStop(0.5, look.skin);
  g.addColorStop(1, shade(look.skin, 0.1));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const lay = eyeLayout(w, h);
  const top = -h * 0.06;
  const { back, front } = bangs(seed, w, h);
  // 前发落在额头上的影子
  ctx.fillStyle = shade(look.skin, -0.45, 0.42);
  for (const b of front) {
    strandPath(ctx, b, top, h * 0.06);
    ctx.fill();
  }
  // 后面一层、前面一层
  const layer = (list: Strand[], k: number) => {
    const hg = ctx.createLinearGradient(0, 0, 0, h * 0.42);
    hg.addColorStop(0, shade(look.hair, 0.1 + k));
    hg.addColorStop(1, shade(look.hair, -0.25 + k));
    for (const b of list) {
      strandPath(ctx, b, top);
      ctx.fillStyle = hg;
      ctx.fill();
      ctx.strokeStyle = shade(look.hair, -0.6, 0.75);
      ctx.lineWidth = Math.max(1, w * 0.0018);
      ctx.stroke();
    }
  };
  layer(back, -0.18);
  layer(front, 0);
  // 头发上的一道光（天使环）：只画在前面那层头发上
  ctx.save();
  ctx.beginPath();
  for (const b of front) strandPath(ctx, b, top, 0, false);
  ctx.clip();
  const ring = ctx.createLinearGradient(0, h * 0.015, 0, h * 0.11);
  ring.addColorStop(0, shade(look.hair, 0.5, 0));
  ring.addColorStop(0.5, shade(look.hair, 0.5, 0.45));
  ring.addColorStop(1, shade(look.hair, 0.5, 0));
  ctx.fillStyle = ring;
  ctx.fillRect(0, h * 0.015, w, h * 0.1);
  ctx.restore();
  // 眉毛：画在头发上面、半透明（动画里眉毛常常透过前发露出来）。认真起来，眉头往下压
  ctx.save();
  ctx.fillStyle = shade(look.hair, -0.4, 0.6);
  for (const e of lay.eyes) {
    const sx = e.flip ? -1 : 1;
    const X = (x: number) => e.x + sx * x * e.u;
    const Y = (y: number) => e.y + y * e.u;
    ctx.beginPath();
    ctx.moveTo(X(-0.92), Y(-1.3));
    ctx.quadraticCurveTo(X(0.1), Y(-1.84), X(1.12), Y(-1.6));
    ctx.quadraticCurveTo(X(0.12), Y(-1.74), X(-0.9), Y(-1.22));
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  // 发动的那一下：额头往上压暗（动画里能力发动时脸上半截罩着阴影、只剩眼睛亮着）
  const d = ctx.createLinearGradient(0, 0, 0, lay.eyes[0].y);
  d.addColorStop(0, 'rgba(14,8,22,0.62)');
  d.addColorStop(0.55, 'rgba(14,8,22,0.25)');
  d.addColorStop(1, 'rgba(14,8,22,0)');
  ctx.fillStyle = d;
  ctx.fillRect(0, 0, w, h);
  // 两边压暗
  const v = ctx.createLinearGradient(0, 0, w, 0);
  v.addColorStop(0, 'rgba(10,6,16,0.55)');
  v.addColorStop(0.16, 'rgba(10,6,16,0)');
  v.addColorStop(0.84, 'rgba(10,6,16,0)');
  v.addColorStop(1, 'rgba(10,6,16,0.55)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
}

// ---------- 一整格 ----------

export function drawEyeShot(ctx: CanvasRenderingContext2D, w: number, h: number, look: EyeLook, s: EyeState, face: CanvasImageSource | null): void {
  if (face) ctx.drawImage(face, 0, 0, w, h);
  const lay = eyeLayout(w, h);
  const eyes: EyeOpts[] = lay.eyes.map((e) => ({ ...e, open: look.only && look.only !== e.side ? 0 : s.open }));
  for (const e of eyes) if (e.open > 0.05) drawAura(ctx, look, s, e);
  for (const e of eyes) drawEye(ctx, look, s, e);
  if (look.trail) for (const e of eyes) if (e.open > 0.05) drawTrail(ctx, look, s, e);
  if (look.glasses) drawGlasses(ctx, look, s, eyes);
  if (s.flash > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255,255,255,${0.4 * s.flash})`;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}

// ---------- 时间线 ----------

// 一格从出现开始各个时刻（秒）：闭着眼滑进来，停一下，睁开（瞪一下再回到平常），光慢慢呼吸
export const EYE_TIMES = { open: 0.34, opened: 0.52, settle: 0.8 };

const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);

export function eyeStateAt(t: number, look: EyeLook): EyeState {
  const { open: t0, opened: t1, settle: t2 } = EYE_TIMES;
  let open = 0;
  if (t >= t0) open = t < t1 ? 1.08 * easeOut((t - t0) / (t1 - t0)) : lerp(1.08, 1, smooth(t1, t2, t));
  // 戴眼镜的：反光盖住镜片那一下眼睛睁开
  const shine = look.glasses ? (t >= t0 - 0.16 && t <= t1 + 0.1 ? (t - (t0 - 0.16)) / (t1 + 0.26 - t0) : -1) : -1;
  const pupil = t < t0 ? 1.25 : t < t1 ? lerp(1.25, 0.78, easeOut((t - t0) / (t1 - t0))) : lerp(0.78, 1, smooth(t1, t2 + 0.2, t));
  const glint = t < t0 + 0.06 ? 0 : t < t1 + 0.06 ? 1.2 * easeOut((t - t0 - 0.06) / (t1 - t0)) : lerp(1.2, 1, smooth(t1 + 0.06, t2, t));
  const glow = t < t0 ? 0 : Math.min(1, (t - t0) / 0.2) * (0.75 + 0.25 * Math.sin((t - t0) * 6));
  const flash = t < t0 + 0.04 ? 0 : Math.max(0, 1 - (t - t0 - 0.04) / 0.2) ** 2;
  const ring = t < t0 + 0.04 ? -1 : (t - t0 - 0.04) / 0.5;
  const trail = t < t0 + 0.05 ? 0 : easeOut((t - t0 - 0.05) / 0.35);
  return { open, pupil, glint, glow, flash, ring: ring >= 1 ? -1 : ring, trail, shine, time: t };
}
