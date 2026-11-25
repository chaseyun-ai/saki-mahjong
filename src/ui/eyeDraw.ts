import type { EyeLook, EyeShape } from './eyeLooks';

// 睁眼特写的眼睛模板：用 Canvas 2D 一笔笔画出来，不用图片。
// 一帧画一次：drawEyeShot(ctx, w, h, look, state)。state 是这一刻的睁眼程度、瞳孔缩放、光……（eyeShot.ts 按时间算好传进来）
//
// 画法照着动画（咲-Saki-）的眼睛来，对着动画截图放大看过：
//   赛璐璐平涂、硬边，不用柔光和渐变堆质感（写实的虹膜纹路、发光的瞳孔放大了看很吓人）
//   上睫毛是一条又粗又黑的带子，眼尾两根小刺；下眼睑只有外侧一小段细线，内眼角不封口
//   虹膜是竖着的方圆形，几乎占满眼眶，粗黑边；上半截接近黑，往下透出瞳色，底下最亮；瞳孔是中间一块深色，下缘看得见
//   高光是两颗硬边的白圆：大的压在虹膜靠光那一侧的边上，小的在另一侧偏下
//   眼白上半截罩着眼睑的淡蓝灰影子；皮肤平涂，前发在额头上投一块硬边的影子；脸颊一团红晕加三道斜线
//   头发平涂加细的深色勾线，上面一道硬边的高光带；眉毛是细线，画在头发上面
//
// 眼睛自己的坐标：眼宽 2（内眼角 x=-1，外眼角 x=1），y 向下。画面左边那只眼睛左右翻过来画，高光不翻（光从同一边来）

type P = [number, number];

export interface EyeState {
  open: number; // 0 闭着，1 睁开（可以略大于 1：睁眼那一下稍微过一点）
  pupil: number; // 瞳孔缩放，1 是平常
  glint: number; // 高光缩放（睁开那一下弹出来）
  glow: number; // 0～1，虹膜下半截亮起来多少
  flash: number; // 0～1，整格闪白
  ring: number; // 0～1，高光上“叮”地一闪的进度（-1 不画）
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
// 同上，但返回 #rrggbb（好接着拿去 mix）
function tone(hex: string, k: number): string {
  return mix(hex, k < 0 ? '#000000' : '#ffffff', Math.abs(k));
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
  upper: Curve; // 睁开时的上眼睑（睫毛带的下缘），内眼角到外眼角
  lower: Curve; // 下眼睑。闭眼时上眼睑落到这条线上（弯成 ‿）
  flick: P; // 眼尾睫毛甩出去的尖
  iris: [number, number, number, number]; // 虹膜中心 x、y，半径 rx、ry
}

// 圆眼、垂眼的外眼角在中线以下（睫毛带顺着外侧弯下来），吊眼的外眼角往上挑
const FORMS: Record<EyeShape, Form> = {
  round: {
    upper: { a: [-1, 0.08], b: [-0.74, -0.84], c: [0.52, -1.0], d: [1.02, 0.14] },
    lower: { a: [-1, 0.08], b: [-0.6, 0.94], c: [0.6, 0.98], d: [1.02, 0.14] },
    flick: [1.22, 0.3],
    iris: [0, 0, 0.62, 0.8],
  },
  sharp: {
    upper: { a: [-1, 0.2], b: [-0.68, -0.62], c: [0.42, -0.96], d: [1.03, -0.34] },
    lower: { a: [-1, 0.2], b: [-0.52, 0.88], c: [0.62, 0.76], d: [1.03, -0.34] },
    flick: [1.26, -0.5],
    iris: [0.02, -0.04, 0.58, 0.74],
  },
  droopy: {
    upper: { a: [-1, -0.02], b: [-0.7, -0.9], c: [0.5, -0.94], d: [1.0, 0.32] },
    lower: { a: [-1, -0.02], b: [-0.58, 0.94], c: [0.6, 1.0], d: [1.0, 0.32] },
    flick: [1.18, 0.5],
    iris: [0, 0.02, 0.62, 0.8],
  },
  narrow: {
    upper: { a: [-1, 0.14], b: [-0.62, -0.52], c: [0.48, -0.72], d: [1.04, -0.26] },
    lower: { a: [-1, 0.14], b: [-0.5, 0.72], c: [0.62, 0.64], d: [1.04, -0.26] },
    flick: [1.27, -0.4],
    iris: [0.02, 0, 0.58, 0.62],
  },
};

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

// 方圆形（超椭圆）：动画里的虹膜、瞳孔不是正椭圆，是四角圆掉的竖长方
function squircle(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, n = 2.7): void {
  ctx.beginPath();
  for (let i = 0; i < 56; i++) {
    const a = (i / 56) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const x = cx + rx * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
    const y = cy + ry * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.closePath();
}

// 虹膜上半截的深色、粗边用的颜色：瞳色压到接近黑，带一点蓝紫
const deep = (iris: string): string => mix(tone(iris, -0.78), '#170f26', 0.45);

function drawIris(ctx: CanvasRenderingContext2D, look: EyeLook, f: Form, s: EyeState, flip: boolean): void {
  const [ix, iy, rx, ry] = f.iris;
  const blank = look.pupil === 'none';
  const dark = deep(look.iris);
  const light = tone(look.iris, 0.42);
  // 底：平涂瞳色
  squircle(ctx, ix, iy, rx, ry);
  ctx.fillStyle = blank ? tone(look.iris, 0.25) : look.iris;
  ctx.fill();
  ctx.save();
  squircle(ctx, ix, iy, rx, ry);
  ctx.clip();
  // 往下越来越亮，底下一道最亮；发动时这一截更亮一点
  const lg = ctx.createLinearGradient(0, iy, 0, iy + ry);
  lg.addColorStop(0, shade(light, 0, 0));
  lg.addColorStop(1, shade(light, 0.15 + 0.25 * s.glow, 1));
  ctx.fillStyle = lg;
  ctx.fillRect(ix - rx, iy, rx * 2, ry);
  // 上半截压深，边缘收得比较硬
  const tg = ctx.createLinearGradient(0, iy - ry, 0, iy + ry);
  if (blank) {
    tg.addColorStop(0, shade(dark, 0, 0.5));
    tg.addColorStop(0.5, shade(dark, 0, 0));
  } else {
    tg.addColorStop(0, shade(dark, 0, 1));
    tg.addColorStop(0.44, shade(dark, 0, 1));
    tg.addColorStop(0.62, shade(dark, 0, 0));
  }
  ctx.fillStyle = tg;
  ctx.fillRect(ix - rx, iy - ry, rx * 2, ry * 2);
  // 瞳孔：中间一块深色，上面和压深的那截连成一片，下缘露在瞳色上
  const pr = s.pupil;
  const py = iy + ry * 0.04;
  const pupil = (kx: number, ky: number, n = 2.5) => {
    squircle(ctx, ix, py, rx * kx * pr, ry * ky * pr, n);
    ctx.fillStyle = dark;
    ctx.fill();
  };
  const line = (wd: number) => {
    ctx.strokeStyle = light;
    ctx.lineWidth = wd;
    ctx.lineCap = 'round';
  };
  switch (look.pupil) {
    case 'round':
      pupil(0.52, 0.5);
      break;
    case 'slit':
      // 猫眼：竖着的窄瞳孔
      pupil(0.22, 0.66, 2);
      break;
    case 'ring':
      // 瞳孔外面一圈亮环（大星淡的眼睛就是：深色外圈、一圈亮色、深色瞳孔）
      pupil(0.42, 0.4);
      squircle(ctx, ix, py, rx * 0.68, ry * 0.66);
      line(0.075);
      ctx.stroke();
      break;
    case 'star':
      pupil(0.24, 0.22);
      ctx.fillStyle = dark;
      star(ctx, ix, py, rx * 0.62 * pr, 0.46, 5);
      ctx.fill();
      break;
    case 'reticle': {
      pupil(0.36, 0.34);
      line(0.04);
      squircle(ctx, ix, py, rx * 0.66, ry * 0.64);
      ctx.stroke();
      ctx.beginPath();
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        ctx.moveTo(ix + dx * rx * 0.5, py + dy * ry * 0.48);
        ctx.lineTo(ix + dx * rx * 0.84, py + dy * ry * 0.82);
      }
      ctx.stroke();
      break;
    }
    case 'spiral': {
      pupil(0.4, 0.38);
      line(0.045);
      ctx.beginPath();
      const turn = s.time * 0.7;
      for (let i = 0; i <= 48; i++) {
        const t = i / 48;
        const a = turn + t * Math.PI * 2.6 * (flip ? -1 : 1);
        const r = 0.48 + t * 0.3;
        const px = ix + Math.cos(a) * rx * r;
        const ppy = py + Math.sin(a) * ry * r;
        if (i) ctx.lineTo(px, ppy);
        else ctx.moveTo(px, ppy);
      }
      ctx.stroke();
      break;
    }
    case 'none':
      // 没有瞳孔（神附身、出神）：只是一片淡淡的瞳色，高光照画
      break;
  }
  ctx.restore();
  // 粗黑边
  squircle(ctx, ix, iy, rx, ry);
  ctx.strokeStyle = dark;
  ctx.lineWidth = 0.075;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

// 高光：硬边的白圆。位置按画面算（光从左边来），所以翻过来的那只眼睛把 x 再翻回去。
// 大的压在虹膜左边的边上（画在粗黑边上面，把边盖掉一块），小的在右下
const GLINT_BIG: [number, number, number] = [-0.84, -0.04, 0.19];
const GLINT_SMALL: [number, number, number] = [0.3, 0.3, 0.095];

function drawGlint(ctx: CanvasRenderingContext2D, look: EyeLook, f: Form, s: EyeState, flip: boolean): void {
  const [ix, iy, rx, ry] = f.iris;
  const k = s.glint;
  if (k <= 0) return;
  const X = (x: number) => ix + (flip ? -x : x) * rx;
  const Y = (y: number) => iy + y * ry;
  ctx.fillStyle = '#ffffff';
  const dot = ([x, y, r]: [number, number, number], a = 1) => {
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.arc(X(x), Y(y), r * k, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  };
  const twinkle = (x: number, y: number, r: number, color: string) => {
    ctx.fillStyle = color;
    star(ctx, X(x), Y(y), r * k, 0.2, 4);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
  };
  switch (look.glint) {
    case 'twin':
      dot(GLINT_BIG);
      dot(GLINT_SMALL);
      break;
    case 'single':
      dot(GLINT_BIG);
      break;
    case 'star':
      // 瞳孔里一大一小两颗四角星（大星淡发动时就是这样，星星是黄的）
      dot(GLINT_BIG);
      twinkle(0.1, -0.36, 0.3, look.spark ?? '#ffffff');
      twinkle(0.34, 0.46, 0.15, look.spark ?? '#ffffff');
      break;
    case 'moon': {
      // 大高光换成一弯月牙
      const cx = X(GLINT_BIG[0] + 0.1);
      const cy = Y(GLINT_BIG[1]);
      const r = 0.25 * k;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.beginPath();
      ctx.rect(cx - r * 2, cy - r * 2, r * 4, r * 4);
      ctx.arc(cx + (flip ? -1 : 1) * r * 0.62, cy - r * 0.22, r * 0.92, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
      ctx.restore();
      dot(GLINT_SMALL);
      break;
    }
    case 'sparkle':
      dot(GLINT_BIG);
      dot(GLINT_SMALL);
      twinkle(0.16, -0.44, 0.2, look.spark ?? '#ffffff');
      break;
    case 'flower': {
      // 小高光换成一朵五瓣的小花
      dot(GLINT_BIG);
      const cx = X(GLINT_SMALL[0]);
      const cy = Y(GLINT_SMALL[1]);
      const r = 0.085 * k;
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
        ctx.beginPath();
        ctx.ellipse(cx + Math.cos(a) * r, cy + Math.sin(a) * r, r * 0.82, r * 0.56, a, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'dull':
      dot(GLINT_SMALL, 0.85);
      break;
    case 'none':
      break;
  }
}

// 睫毛带多厚：内眼角细，到中间就粗起来，一直粗到眼尾
const lashWidth = (t: number, open: number): number => (0.035 + 0.135 * smooth(0, 0.42, t)) * (0.6 + 0.4 * clamp01(open));

// 上眼睑的睫毛带：沿着曲线往上加厚，眼尾甩出一个尖
function lashShape(up: Curve, flick: P, open: number): P[] {
  const outer: P[] = [];
  const inner: P[] = [];
  const N = 28;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const p = at(up, t);
    const tg = tangent(up, t);
    const n: P = [tg[1], -tg[0]];
    const th = lashWidth(t, open);
    outer.push([p[0] + n[0] * th, p[1] + n[1] * th]);
    inner.push([p[0] - n[0] * 0.015, p[1] - n[1] * 0.015]);
  }
  // 闭眼时眼尾的尖收短，贴着弧线
  const end = up.d;
  const tip = lerpP([end[0] + 0.14, end[1] + 0.04], flick, 0.35 + 0.65 * clamp01(open));
  return [...outer, tip, ...inner.reverse()];
}

// 勾线的颜色：深褐，带一点发色
const inkOf = (look: EyeLook): string => mix('#3a2226', look.hair, 0.22);

function drawEye(ctx: CanvasRenderingContext2D, look: EyeLook, s: EyeState, o: EyeOpts): void {
  const f = FORMS[look.shape];
  const open = o.open;
  const up = lerpCurve(f.lower, f.upper, open);
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.scale(o.flip ? -o.u : o.u, o.u);
  const lash = mix('#1b1220', look.hair, 0.12);
  const ink = inkOf(look);

  if (open > 0.02) {
    // 眼白：白的，上半截罩着眼睑的淡蓝灰影子（硬边）
    ctx.save();
    clipOpening(ctx, up, f.lower);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-2, -2, 4, 4);
    const N = 20;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const p = at(up, i / N);
      if (i) ctx.lineTo(p[0], p[1]);
      else ctx.moveTo(p[0], p[1]);
    }
    for (let i = N; i >= 0; i--) {
      const p = at(up, i / N);
      ctx.lineTo(p[0], p[1] + 0.36);
    }
    ctx.closePath();
    ctx.fillStyle = mix('#c9d6ea', look.iris, 0.06);
    ctx.fill();
    ctx.restore();
    // 虹膜、高光：上面被眼睑切掉一截；下面比下眼睑的线稍微出去一点（动画里眼睛的下缘就是虹膜的下缘）
    ctx.save();
    const k = clamp01(open);
    const low: Curve = { a: f.lower.a, b: [f.lower.b[0], f.lower.b[1] + 0.22 * k], c: [f.lower.c[0], f.lower.c[1] + 0.22 * k], d: f.lower.d };
    clipOpening(ctx, up, low);
    drawIris(ctx, look, f, s, o.flip);
    drawGlint(ctx, look, f, s, o.flip);
    ctx.restore();
  }

  // 睫毛带
  ctx.fillStyle = lash;
  ctx.beginPath();
  lashShape(up, f.flick, open).forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.closePath();
  ctx.fill();
  // 眼尾两根小刺：睁着朝外翘，闭着朝下垂
  ctx.beginPath();
  for (const t of [0.8, 0.93]) {
    const p = at(up, t);
    const tg = tangent(up, t);
    const n: P = [tg[1], -tg[0]];
    const th = lashWidth(t, open);
    const upTip: P = [p[0] + n[0] * (th + 0.12) + tg[0] * 0.16, p[1] + n[1] * (th + 0.12) + tg[1] * 0.16];
    const downTip: P = [p[0] - n[0] * 0.18 + tg[0] * 0.1, p[1] - n[1] * 0.18 + tg[1] * 0.1];
    const tip = lerpP(downTip, upTip, clamp01(open));
    ctx.moveTo(p[0] - tg[0] * 0.07, p[1] - tg[1] * 0.07);
    ctx.lineTo(tip[0], tip[1]);
    ctx.lineTo(p[0] + tg[0] * 0.07, p[1] + tg[1] * 0.07);
  }
  ctx.fill();
  ctx.lineCap = 'round';
  // 双眼皮：睫毛带上面一道细线
  if (open > 0.3) {
    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.85 * smooth(0.3, 0.9, open);
    ctx.lineWidth = 0.028;
    ctx.beginPath();
    for (let i = 0; i <= 14; i++) {
      const t = 0.24 + (i / 14) * 0.5;
      const p = at(up, t);
      const tg = tangent(up, t);
      const n: P = [tg[1], -tg[0]];
      const d = lashWidth(t, open) + 0.13;
      if (i) ctx.lineTo(p[0] + n[0] * d, p[1] + n[1] * d);
      else ctx.moveTo(p[0] + n[0] * d, p[1] + n[1] * d);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // 下眼睑：只有外侧一小段细线
  ctx.strokeStyle = ink;
  ctx.lineWidth = 0.03;
  ctx.beginPath();
  for (let i = 0; i <= 8; i++) {
    const p = at(f.lower, 0.6 + (i / 8) * 0.27);
    const y = p[1] + 0.07 * clamp01(open) + 0.02;
    if (i) ctx.lineTo(p[0], y);
    else ctx.moveTo(p[0], y);
  }
  ctx.stroke();
  ctx.restore();
}

// ---------- 发动的效果：眼尾的光尾、高光上“叮”的一闪 ----------

function drawTrail(ctx: CanvasRenderingContext2D, look: EyeLook, s: EyeState, o: EyeOpts): void {
  if (s.trail <= 0) return;
  const f = FORMS[look.shape];
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.scale(o.flip ? -o.u : o.u, o.u);
  const start: P = [f.flick[0] - 0.04, f.flick[1] - 0.06];
  const len = 1.7 * s.trail;
  const N = 24;
  const lift = -0.16;
  const mid = (t: number): P => [start[0] + t * len, start[1] + t * len * lift + Math.sin(s.time * 14 + t * 8) * 0.05 * t];
  const ribbon = (width: number, color: CanvasGradient | string) => {
    const top: P[] = [];
    const bot: P[] = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const p = mid(t);
      const wv = width * Math.pow(1 - t, 0.8) * smooth(0, 0.12, t) * (0.85 + 0.15 * Math.sin(s.time * 24 + t * 12));
      top.push([p[0], p[1] - wv]);
      bot.push([p[0], p[1] + wv * 0.6]);
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    [...top, ...bot.reverse()].forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
    ctx.fill();
  };
  // 两层平涂：外面一层这个人的光的颜色，里面一道白
  const g = ctx.createLinearGradient(start[0], 0, start[0] + len, 0);
  g.addColorStop(0, shade(look.glow, 0.1, 0.9));
  g.addColorStop(0.7, shade(look.glow, 0.1, 0.6));
  g.addColorStop(1, shade(look.glow, 0.1, 0));
  ribbon(0.2, g);
  const c = ctx.createLinearGradient(start[0], 0, start[0] + len * 0.75, 0);
  c.addColorStop(0, 'rgba(255,255,255,0.95)');
  c.addColorStop(1, 'rgba(255,255,255,0)');
  ribbon(0.07, c);
  ctx.restore();
}

// 睁开那一下，大高光上一颗四角星“叮”地闪一下，带一道横着的细光（动画里眼睛一亮的画法）
function drawTwinkle(ctx: CanvasRenderingContext2D, look: EyeLook, s: EyeState, o: EyeOpts): void {
  if (s.ring < 0 || s.ring >= 1) return;
  const f = FORMS[look.shape];
  const [ix, iy, rx, ry] = f.iris;
  const cx = o.x + ((o.flip ? -ix : ix) + GLINT_BIG[0] * rx) * o.u;
  const cy = o.y + (iy + GLINT_BIG[1] * ry) * o.u;
  const p = s.ring;
  const r = o.u * 0.95 * Math.sin(Math.PI * Math.min(1, p * 1.2)) ** 0.7;
  if (r <= 0) return;
  ctx.save();
  ctx.globalAlpha = 1 - p * p;
  const cross = (rr: number, color: string) => {
    ctx.fillStyle = color;
    star(ctx, cx, cy, rr, 0.13, 4);
    ctx.fill();
    // 横着的细光
    ctx.beginPath();
    ctx.moveTo(cx - rr * 2.6, cy);
    ctx.lineTo(cx, cy - rr * 0.07);
    ctx.lineTo(cx + rr * 2.6, cy);
    ctx.lineTo(cx, cy + rr * 0.07);
    ctx.closePath();
    ctx.fill();
  };
  cross(r * 1.18, tone(look.glow, 0.25));
  cross(r, '#ffffff');
  ctx.restore();
}

// ---------- 眼镜 ----------

function drawGlasses(ctx: CanvasRenderingContext2D, look: EyeLook, s: EyeState, eyes: EyeOpts[]): void {
  ctx.save();
  const frame = mix('#2a2430', look.hair, 0.25);
  for (const o of eyes) {
    const x0 = o.x - o.u * 1.42;
    const w = o.u * 2.84;
    const y0 = o.y - o.u * 1.2;
    const h = o.u * 2.3;
    const r = o.u * 0.5;
    ctx.beginPath();
    ctx.roundRect(x0, y0, w, h, r);
    ctx.fillStyle = 'rgba(225,238,255,0.1)';
    ctx.fill();
    // 反光扫过去：一条斜的白带，扫到中间时整片镜片发白
    if (s.shine >= 0 && s.shine <= 1) {
      ctx.save();
      ctx.clip();
      const bx = x0 - w * 0.6 + s.shine * w * 2.2;
      const glare = 1 - Math.abs(s.shine - 0.5) * 2;
      ctx.fillStyle = `rgba(255,255,255,${0.8 * glare})`;
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
    ctx.lineWidth = Math.max(1.5, o.u * 0.05);
    ctx.beginPath();
    ctx.roundRect(x0, y0, w, h, r);
    ctx.stroke();
  }
  // 鼻梁上的横梁
  if (eyes.length === 2) {
    const [a, b] = eyes[0].x < eyes[1].x ? eyes : [eyes[1], eyes[0]];
    ctx.beginPath();
    ctx.moveTo(a.x + a.u * 1.42, a.y - a.u * 0.5);
    ctx.quadraticCurveTo((a.x + b.x) / 2, a.y - a.u * 0.72, b.x - b.u * 1.42, b.y - b.u * 0.5);
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
  const u = Math.min(w * 0.092, h * 0.295);
  const y = h * 0.565;
  return {
    eyes: [
      { x: w * 0.5 - u * 1.9, y, u, flip: true, side: 'right' },
      { x: w * 0.5 + u * 1.9, y, u, flip: false, side: 'left' },
    ],
  };
}

interface Strand {
  x0: number; // 发根左右两边
  x1: number;
  tx: number; // 发梢
  ty: number;
}

// 前发一绺绺：固定的伪随机，同一个人每次一样。分两层，后面一层深一点、错开半绺。
// 正对着眼睛的短（不挡眼睛），两眼中间那几绺和两边鬓角长，垂到眼睛的高度
function bangs(seed: string, w: number, h: number): { back: Strand[]; front: Strand[] } {
  let s = 0;
  for (const ch of seed) s = (s * 31 + ch.charCodeAt(0)) % 2147483647;
  s = s || 11;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  // 分缝的位置：发梢都往分缝外侧弯
  const part = w * (0.4 + rnd() * 0.2);
  const row = (offset: number, long: number): Strand[] => {
    const out: Strand[] = [];
    let x = -w * 0.06 + offset;
    while (x < w * 1.04) {
      const sw = w * (0.045 + rnd() * 0.04);
      const c = x + sw / 2;
      const away = c < part ? -1 : 1;
      const mid = Math.abs(c - w / 2) / (w / 2);
      const extra = mid < 0.1 ? 0.2 + rnd() * 0.08 : mid > 0.62 ? 0.2 + rnd() * 0.25 : 0;
      const ty = h * (0.17 + rnd() * 0.1 + extra + long);
      out.push({ x0: x, x1: x + sw, tx: c + away * sw * (0.3 + rnd() * 0.5), ty });
      x += sw * (0.66 + rnd() * 0.2);
    }
    return out;
  };
  const back = row(w * 0.03, 0.045);
  const front = row(0, 0);
  return { back, front };
}

// 一绺：两边略弯、尖头的刀片形
function strandPath(ctx: CanvasRenderingContext2D, b: Strand, top: number, dy = 0, fresh = true): void {
  if (fresh) ctx.beginPath();
  ctx.moveTo(b.x0, top);
  ctx.quadraticCurveTo(b.x0 + (b.tx - b.x0) * 0.12, (b.ty + dy) * 0.62, b.tx, b.ty + dy);
  ctx.quadraticCurveTo(b.x1 + (b.tx - b.x1) * 0.12, (b.ty + dy) * 0.56, b.x1, top);
  ctx.closePath();
}

export function drawFace(ctx: CanvasRenderingContext2D, w: number, h: number, look: EyeLook, seed: string): void {
  // 皮肤：平涂
  ctx.fillStyle = look.skin;
  ctx.fillRect(0, 0, w, h);
  const lay = eyeLayout(w, h);
  const ink = inkOf(look);
  const top = -h * 0.06;
  const mass = h * 0.1; // 最上面一整片头发，一绺绺从这里垂下来
  const { back, front } = bangs(seed, w, h);
  // 脸颊：一团淡淡的红晕，上面三道斜线，旁边一颗小白点
  for (const e of lay.eyes) {
    const sx = e.flip ? -1 : 1;
    const cx = e.x + sx * e.u * 0.3;
    const cy = e.y + e.u * 1.28;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, 0.46);
    const bg = ctx.createRadialGradient(0, 0, 0, 0, 0, e.u * 1.1);
    bg.addColorStop(0, 'rgba(255,130,140,0.5)');
    bg.addColorStop(1, 'rgba(255,130,140,0)');
    ctx.fillStyle = bg;
    ctx.fillRect(-e.u * 1.2, -e.u * 1.2, e.u * 2.4, e.u * 2.4);
    ctx.restore();
    ctx.strokeStyle = 'rgba(236,110,120,0.75)';
    ctx.lineWidth = Math.max(1, e.u * 0.03);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const dx of [-0.24, 0, 0.24]) {
      ctx.moveTo(cx + (dx + 0.07) * e.u, cy - e.u * 0.1);
      ctx.lineTo(cx + (dx - 0.07) * e.u, cy + e.u * 0.1);
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(cx - e.u * 0.62, cy - e.u * 0.06, e.u * 0.05, 0, Math.PI * 2);
    ctx.fill();
  }
  // 前发落在额头上的影子：一块平涂的深一号的肤色，硬边
  ctx.fillStyle = mix(tone(look.skin, -0.13), '#d98a86', 0.22);
  ctx.fillRect(0, 0, w, mass + h * 0.05);
  for (const b of [...back, ...front]) {
    strandPath(ctx, b, top, h * 0.05);
    ctx.fill();
  }
  // 头发：平涂加细勾线。后面一层深一点
  const layer = (list: Strand[], fill: string) => {
    ctx.lineWidth = Math.max(1, w * 0.0022);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = tone(mix(look.hair, ink, 0.5), -0.25);
    for (const b of list) {
      strandPath(ctx, b, top);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.stroke();
    }
  };
  layer(back, tone(look.hair, -0.18));
  ctx.fillStyle = look.hair;
  ctx.fillRect(0, 0, w, mass);
  layer(front, look.hair);
  ctx.fillStyle = look.hair;
  ctx.fillRect(0, 0, w, mass * 0.8);
  // 头发上的高光（天使环）：横着一道硬边的亮带，上下缘都是锯齿，只画在前面一层头发上
  ctx.save();
  ctx.beginPath();
  // 和发绺同一个绕向（先往下再往右），不然重叠的地方会被抵消掉
  ctx.moveTo(0, 0);
  ctx.lineTo(0, mass);
  ctx.lineTo(w, mass);
  ctx.lineTo(w, 0);
  ctx.closePath();
  for (const b of front) strandPath(ctx, b, top, 0, false);
  ctx.clip();
  ctx.fillStyle = tone(look.hair, 0.3);
  ctx.beginPath();
  const teeth = 30;
  for (let i = 0; i <= teeth; i++) {
    const x = (i / teeth) * w;
    const y = h * (i % 2 ? 0.1 : 0.125);
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  for (let i = teeth; i >= 0; i--) ctx.lineTo((i / teeth) * w, h * (i % 2 ? 0.2 : 0.165));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // 眉毛：细线，画在头发上面（动画里眉毛透过前发露出来）。吊眼的眉头压低一点，其余是平平的一道弧
  ctx.save();
  ctx.strokeStyle = tone(mix(look.hair, ink, 0.6), -0.2);
  ctx.lineCap = 'round';
  const stern = look.shape === 'sharp' || look.shape === 'narrow' ? 0.14 : 0;
  for (const e of lay.eyes) {
    const sx = e.flip ? -1 : 1;
    const X = (x: number) => e.x + sx * x * e.u;
    const Y = (y: number) => e.y + y * e.u;
    ctx.lineWidth = Math.max(1.5, e.u * 0.05);
    ctx.beginPath();
    ctx.moveTo(X(-0.78), Y(-1.48 + stern));
    ctx.quadraticCurveTo(X(0.2), Y(-1.72), X(1.1), Y(-1.5 - stern * 0.4));
    ctx.stroke();
  }
  ctx.restore();
}

// ---------- 一整格 ----------

export function drawEyeShot(ctx: CanvasRenderingContext2D, w: number, h: number, look: EyeLook, s: EyeState, face: CanvasImageSource | null): void {
  if (face) ctx.drawImage(face, 0, 0, w, h);
  const lay = eyeLayout(w, h);
  const eyes: EyeOpts[] = lay.eyes.map((e) => ({ ...e, open: look.only && look.only !== e.side ? 0 : s.open }));
  for (const e of eyes) drawEye(ctx, look, s, e);
  if (look.trail) for (const e of eyes) if (e.open > 0.05) drawTrail(ctx, look, s, e);
  if (look.glasses) drawGlasses(ctx, look, s, eyes);
  for (const e of eyes) if (e.open > 0.05) drawTwinkle(ctx, look, s, e);
  if (s.flash > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255,255,255,${0.3 * s.flash})`;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}

// ---------- 时间线 ----------

// 一格从出现开始各个时刻（秒）：闭着眼滑进来，停一下，睁开（稍微过一点点再回到平常，不瞪眼），光慢慢呼吸
export const EYE_TIMES = { open: 0.34, opened: 0.52, settle: 0.8 };

const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);

export function eyeStateAt(t: number, look: EyeLook): EyeState {
  const { open: t0, opened: t1, settle: t2 } = EYE_TIMES;
  let open = 0;
  if (t >= t0) open = t < t1 ? 1.03 * easeOut((t - t0) / (t1 - t0)) : lerp(1.03, 1, smooth(t1, t2, t));
  // 戴眼镜的：反光盖住镜片那一下眼睛睁开
  const shine = look.glasses ? (t >= t0 - 0.16 && t <= t1 + 0.1 ? (t - (t0 - 0.16)) / (t1 + 0.26 - t0) : -1) : -1;
  // 瞳孔：睁开那一下略微放大再回来（缩成一小点是惊恐的眼神，不用）
  const pupil = t < t0 ? 0.92 : t < t1 ? lerp(0.92, 1.1, easeOut((t - t0) / (t1 - t0))) : lerp(1.1, 1, smooth(t1, t2 + 0.2, t));
  const glint = t < t0 + 0.06 ? 0 : t < t1 + 0.06 ? 1.2 * easeOut((t - t0 - 0.06) / (t1 - t0)) : lerp(1.2, 1, smooth(t1 + 0.06, t2, t));
  const glow = t < t0 ? 0 : Math.min(1, (t - t0) / 0.2) * (0.8 + 0.2 * Math.sin((t - t0) * 4));
  const flash = t < t0 + 0.04 ? 0 : Math.max(0, 1 - (t - t0 - 0.04) / 0.2) ** 2;
  const ring = t < t0 + 0.04 ? -1 : (t - t0 - 0.04) / 0.5;
  const trail = t < t0 + 0.05 ? 0 : easeOut((t - t0 - 0.05) / 0.35);
  return { open, pupil, glint, glow, flash, ring: ring >= 1 ? -1 : ring, trail, shine, time: t };
}
