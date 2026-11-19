import { playClick } from './sound';
import { STICK_TIMES, StickToss } from './stickToss';

// 页面之间的过场，照用户给的两段动画参考做的：
//
// pin（一筒）：一枚一筒从画面上方掉下来，在中间弹一下；然后一下切到一枚很大的一筒，盖在已经换好的新页面上，
//   停一下看整朵花，再一下推进花心的轮毂，正中的宝石变成圆窗；
//   轮毂的橙格子往外退出画面，圆窗跟着越开越大，露出新页面。
// tiles（牌背）：一整面扣着的牌（牌背朝上排满屏幕）一边转一边缩小，慢慢盖住旧页面；摆正以后在下面换页面，
//   停一下，再从右上角往左下角一斜排一斜排地抽掉，露出新页面。
//
// 都画在一块盖住整个窗口的 canvas 上（过场时也挡住点击）。换页（swap）在切镜（一筒）或完全盖住（牌背）的那一刻做。
// 换页可能很重（建 3D 牌桌、读模型），所以换完以后的那一半从下一帧重新计时，卡一下也不会跳掉。
// 系统开了「减少动态效果」、或者画不了 canvas（测试环境），直接换页。

// stick（立直棒）：贴着桌面的低机位，一根立直棒飞进来、磕桌竖起、翻过去拍在牌河前面躺平（stickToss.ts 画），
//   然后从落点泛白盖满画面，换页，白色退掉。
export type TransitionKind = 'pin' | 'tiles' | 'stick';

interface Look {
  // 前一半（盖住旧页面）多长，秒
  cover: number;
  // 前一半第 t 秒；画在 CSS 像素坐标里
  drawCover(ctx: CanvasRenderingContext2D, t: number, w: number, h: number, dpr: number): void;
  // 后一半第 t 秒（换完页以后重新计时）；画完了返回 true
  drawReveal(ctx: CanvasRenderingContext2D, t: number, w: number, h: number, dpr: number): boolean;
  // 过场结束：收拾自己占的东西（立直棒那个有一个 WebGL 画面）
  dispose?(): void;
}

let running = false;

// 正在过场：重复点的不理
export function inTransition(): boolean {
  return running;
}

export function transition(kind: TransitionKind, swap: () => void): void {
  if (running) return;
  const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = reduce ? null : document.createElement('canvas');
  const ctx = canvas?.getContext('2d') ?? null;
  if (!canvas || !ctx || typeof requestAnimationFrame !== 'function') {
    swap();
    return;
  }
  running = true;
  canvas.className = 'xfade';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:2147483000;pointer-events:auto;touch-action:none;';
  document.body.appendChild(canvas);

  const look: Look = kind === 'pin' ? pinLook() : kind === 'stick' ? (stickLook() ?? pinLook()) : tilesLook();
  let w = 0;
  let h = 0;
  let dpr = 1;
  const fit = (): void => {
    const nw = window.innerWidth;
    const nh = window.innerHeight;
    const nd = Math.min(2, window.devicePixelRatio || 1);
    if (nw === w && nh === h && nd === dpr) return;
    w = nw;
    h = nh;
    dpr = nd;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  };
  const finish = (): void => {
    running = false;
    canvas.remove();
    look.dispose?.();
  };

  let phase: 'cover' | 'reveal' = 'cover';
  let t0 = performance.now();
  // 换完页以后第一帧才开始计时
  let restart = false;

  const frame = (now: number): void => {
    fit();
    if (phase === 'cover') {
      const t = (now - t0) / 1000;
      if (t < look.cover) {
        look.drawCover(ctx, t, w, h, dpr);
        requestAnimationFrame(frame);
        return;
      }
      look.drawCover(ctx, look.cover, w, h, dpr);
      phase = 'reveal';
      try {
        swap();
      } catch (e) {
        finish();
        throw e;
      }
      // 换完马上画后一半的第一帧（一筒是切镜：不能让小一筒在新页面上多停一帧）
      fit();
      look.drawReveal(ctx, 0, w, h, dpr);
      restart = true;
      requestAnimationFrame(frame);
      return;
    }
    if (restart) {
      restart = false;
      t0 = now - 1000 / 60;
    }
    if (look.drawReveal(ctx, (now - t0) / 1000, w, h, dpr)) finish();
    else requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// ---------------- 一筒 ----------------
// 照参考动画里那枚一筒画：外圈蓝底，一圈粗白笔画的花纹；里面一道白环、橙底上一朵白菊（花瓣中间一道橙线）；
// 花心是白轮毂：一圈白环，里面五块圆角的橙色格子、五根白辐条，正中一颗淡紫色的宝石。全是平涂，没有渐变。
// 尺寸都按外圈半径 R 的比例。

const PIN_BLUE = '#1b93e6';
const PIN_ORANGE = '#f7a01b';
const PIN_WHITE = '#fffefb';
const GEM = '#a69fe4';
const GEM_EDGE = '#8a82d4';

const TAU = Math.PI * 2;
const easeOut = (u: number) => 1 - (1 - u) ** 3;
const clamp01 = (u: number) => Math.max(0, Math.min(1, u));

const RING_IN = 0.575; // 蓝圈的内边
const ORANGE_R = 0.52; // 橙底的外边（和蓝圈之间是白环）
const PETAL_IN = 0.222;
const PETAL_OUT = 0.475;
const HUB_R = 0.195; // 白轮毂外边
const CELL_OUT = 0.168; // 橙格子外边
const CELL_IN = 0.074; // 橙格子里边（再往里是白的花心）
const SPOKE_W = 0.03; // 辐条宽
const GEM_R = 0.044; // 宝石：参考里放大以后就是它变成圆窗
const SPOKE0 = (-86 * Math.PI) / 180;

// 蓝圈里的白笔画：几种钩、弯的形状轮着用，正反交替，再各歪一点，像手画的。坐标：x 沿圆周，y 朝外
type Stroke = [number, number][][]; // 每段是三次贝塞尔的 4 个点；第一段从第 1 个点开始
const MARKS: Stroke[] = [
  // つ
  [[[-0.06, 0.025], [-0.045, -0.06], [0.06, -0.06], [0.06, 0.005]], [[0.06, 0.005], [0.06, 0.055], [0.015, 0.065], [-0.012, 0.055]]],
  // し
  [[[-0.032, -0.065], [-0.032, -0.02], [-0.034, 0.0], [-0.032, 0.015]], [[-0.032, 0.015], [-0.03, 0.06], [0.03, 0.065], [0.06, 0.03]]],
  // 倒过来的钩
  [[[-0.06, 0.045], [-0.07, -0.025], [-0.01, -0.065], [0.035, -0.048]], [[0.035, -0.048], [0.07, -0.035], [0.07, 0.012], [0.035, 0.022]]],
  // へ
  [[[-0.065, 0.035], [-0.045, 0.0], [-0.03, -0.035], [-0.01, -0.045]], [[-0.01, -0.045], [0.015, -0.055], [0.03, -0.02], [0.065, 0.04]]],
];
const MARK_COUNT = 22;

function pinMarks(ctx: CanvasRenderingContext2D, R: number): void {
  ctx.strokeStyle = PIN_WHITE;
  ctx.lineWidth = R * 0.052;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 0; i < MARK_COUNT; i++) {
    const m = MARKS[(i * 3) % MARKS.length];
    const jitter = Math.sin(i * 12.9898) * 0.35;
    ctx.save();
    ctx.rotate((i / MARK_COUNT) * TAU);
    ctx.translate(0, -R * 0.79);
    ctx.rotate(jitter);
    ctx.scale((i % 2 ? -1 : 1) * R * 1.25, -R * 1.25);
    ctx.beginPath();
    ctx.moveTo(m[0][0][0], m[0][0][1]);
    for (const seg of m) ctx.bezierCurveTo(seg[1][0], seg[1][1], seg[2][0], seg[2][1], seg[3][0], seg[3][1]);
    ctx.restore();
    ctx.stroke();
  }
}

function pinPetals(ctx: CanvasRenderingContext2D, R: number): void {
  const n = 24;
  for (let i = 0; i < n; i++) {
    ctx.save();
    ctx.rotate((i / n) * TAU + Math.PI / n);
    // 花瓣：根部窄、往外变宽、头是圆的；x 朝外
    const a = R * PETAL_IN;
    const b = R * PETAL_OUT;
    const w = R * 0.037;
    ctx.beginPath();
    ctx.moveTo(a, 0);
    ctx.bezierCurveTo(a + (b - a) * 0.28, -w * 0.95, b - w * 2.2, -w * 1.3, b - w * 0.9, -w * 1.1);
    ctx.bezierCurveTo(b + w * 0.25, -w * 0.75, b + w * 0.25, w * 0.75, b - w * 0.9, w * 1.1);
    ctx.bezierCurveTo(b - w * 2.2, w * 1.3, a + (b - a) * 0.28, w * 0.95, a, 0);
    ctx.fillStyle = PIN_WHITE;
    ctx.fill();
    // 中间一道橙线（像花瓣的脉），从根部附近一直到快到头
    ctx.beginPath();
    ctx.moveTo(a + (b - a) * 0.14, 0);
    ctx.lineTo(b - w * 1.5, 0);
    ctx.lineWidth = R * 0.019;
    ctx.lineCap = 'round';
    ctx.strokeStyle = PIN_ORANGE;
    ctx.stroke();
    ctx.restore();
  }
}

// 轮毂里五块橙格子：两根辐条之间的扇形，四个角都是圆的
function pinCells(ctx: CanvasRenderingContext2D, R: number): void {
  const ri = R * CELL_IN;
  const ro = R * CELL_OUT;
  const half = (R * SPOKE_W) / 2;
  const rr = R * 0.026;
  ctx.fillStyle = PIN_ORANGE;
  for (let k = 0; k < 5; k++) {
    const a0 = SPOKE0 + (k * TAU) / 5;
    const a1 = a0 + TAU / 5;
    const di = Math.asin(Math.min(1, half / ri));
    const dout = Math.asin(Math.min(1, half / ro));
    const p = (r: number, a: number): [number, number] => [Math.cos(a) * r, Math.sin(a) * r];
    const pts = [p(ri, a0 + di), p(ro, a0 + dout), p(ro, (a0 + a1) / 2), p(ro, a1 - dout), p(ri, a1 - di)];
    ctx.beginPath();
    const mid = (u: [number, number], v: [number, number]): [number, number] => [(u[0] + v[0]) / 2, (u[1] + v[1]) / 2];
    const start = mid(pts[4], pts[0]);
    ctx.moveTo(start[0], start[1]);
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i];
      const next = pts[(i + 1) % pts.length];
      // 外边中间那个点不倒角（外边是两段几乎连成一条的弧）
      ctx.arcTo(cur[0], cur[1], next[0], next[1], i === 2 ? R * 0.2 : rr);
    }
    ctx.closePath();
    ctx.fill();
  }
}

function pinGem(ctx: CanvasRenderingContext2D, R: number): void {
  const r = R * GEM_R;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fillStyle = GEM;
  ctx.fill();
  ctx.lineWidth = r * 0.12;
  ctx.strokeStyle = GEM_EDGE;
  ctx.stroke();
  // 斜着一道亮光
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.94, 0, TAU);
  ctx.clip();
  ctx.rotate(-Math.PI / 4);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillRect(-r, -r * 0.62, r * 2, r * 0.3);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(-r, -r * 0.22, r * 2, r * 0.12);
  ctx.restore();
}

function disc(ctx: CanvasRenderingContext2D, r: number, fill: string): void {
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fillStyle = fill;
  ctx.fill();
}

// 画在原点，半径 R。view：从中心到画面最远角的距离，整圈都在画面外的就不画。
// gem：false 时不画宝石（宝石已经变成圆窗）；shadow：弹跳时底下一层影子
function drawPin(ctx: CanvasRenderingContext2D, R: number, view: number, gem: boolean, shadow: boolean): void {
  const seen = (inner: number) => inner * R < view;
  if (seen(RING_IN)) {
    ctx.save();
    if (shadow) {
      ctx.shadowColor = 'rgba(10, 20, 40, 0.35)';
      ctx.shadowBlur = R * 0.2;
      ctx.shadowOffsetY = R * 0.08;
    }
    disc(ctx, R, PIN_BLUE);
    ctx.restore();
    pinMarks(ctx, R);
    disc(ctx, R * RING_IN, PIN_WHITE);
  } else if (seen(ORANGE_R)) disc(ctx, R * RING_IN, PIN_WHITE);
  if (seen(HUB_R)) {
    disc(ctx, R * ORANGE_R, PIN_ORANGE);
    pinPetals(ctx, R);
  }
  if (seen(0)) {
    disc(ctx, R * HUB_R, PIN_WHITE);
    pinCells(ctx, R);
  }
  if (gem) pinGem(ctx, R);
}

// 按关键帧插值（t 递增）；log：在对数上插（放大用，看起来匀速）
function keyed(keys: [number, number][], t: number, log = false): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    if (t > t1) continue;
    const [t0, v0] = keys[i - 1];
    const u = (t - t0) / (t1 - t0);
    return log ? v0 * (v1 / v0) ** u : v0 + (v1 - v0) * u;
  }
  return keys[keys.length - 1][1];
}

function pinLook(): Look {
  // 前一半：从上面掉下来（0.27 秒落到底），弹起来，往下落的半路上切镜
  const FLOOR = 0.8;
  const PEAK = 0.56;
  const LAND = 0.27;
  const HOP = 0.1; // 弹起来到最高点用的时间
  const CUT = 0.44;
  // 后一半（照参考逐帧量的，秒）：切到大一筒停一下 → 推到整朵花停一下 → 一下推进轮毂，宝石变成圆窗 →
  // 橙格子往外退出画面，圆窗跟着开大，最后冲出画面
  const OPEN = 0.15; // 宝石变圆窗
  const DONE = 0.5;
  return {
    cover: CUT,
    drawCover(ctx, t, w, h, dpr) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const unit = Math.min(h, w * 0.9);
      const R = unit * 0.12;
      let y: number;
      if (t < LAND) y = -0.15 + (FLOOR + 0.15) * (t / LAND) ** 2;
      else {
        const v = (t - LAND - HOP) / HOP;
        y = PEAK + (FLOOR - PEAK) * v * v;
      }
      // 落地那一下压扁一点
      const squash = 0.16 * Math.exp(-(((t - LAND) / 0.035) ** 2));
      ctx.translate(w / 2, y * h);
      ctx.scale(1 + squash * 0.6, 1 - squash);
      ctx.rotate(-0.35 + t * 1.1);
      drawPin(ctx, R, Infinity, true, true);
    },
    drawReveal(ctx, t, w, h, dpr) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const u = Math.min(w, h);
      const view = Math.hypot(w, h) / 2;
      // 白花心（橙格子的里边）盖过画面四角的时候，格子就都退出去了
      const gone = (view * 1.05) / CELL_IN / u;
      const R =
        u *
        keyed(
          [
            [0, 0.46],
            [0.035, 0.46],
            [0.065, 1.28],
            [0.13, 1.4],
            [OPEN, 3.9],
            [0.33, gone],
            [DONE, gone * 1.4],
          ],
          t,
          true,
        );
      ctx.translate(w / 2, h / 2);
      // 推进轮毂的时候顺手转一点，像参考里那样格子边退边歪
      ctx.rotate(t < OPEN ? 0 : (t - OPEN) * 0.5);
      drawPin(ctx, R, view, t < OPEN, false);
      if (t < OPEN) return false;
      // 圆窗：从宝石那么大开始，先停一下、再一段段开大，最后一下冲出画面
      const r =
        u *
        keyed(
          [
            [OPEN, 0.17],
            [0.19, 0.25],
            [0.24, 0.42],
            [0.3, 0.55],
            [0.36, 0.65],
            [0.43, 0.86],
            [0.47, 1.0],
            [DONE, (view / u) * 1.03],
          ],
          t,
        );
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      return t >= DONE;
    },
  };
}

// ---------------- 牌背 ----------------

const GAP = '#3a2509';

// 一格：深色的缝 + 一张扣着的牌（上边、右边一道亮边）。尺寸是设备像素
function tileSprite(tw: number, th: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.round(tw));
  c.height = Math.max(2, Math.round(th));
  const g = c.getContext('2d')!;
  const W = c.width;
  const H = c.height;
  g.fillStyle = GAP;
  g.fillRect(0, 0, W, H);
  const gap = Math.max(1.5, H * 0.016);
  const x = gap / 2;
  const y = gap / 2;
  const iw = W - gap;
  const ih = H - gap;
  const r = Math.min(iw, ih) * 0.07;
  const round = (): void => {
    g.beginPath();
    g.moveTo(x + r, y);
    g.lineTo(x + iw - r, y);
    g.quadraticCurveTo(x + iw, y, x + iw, y + r);
    g.lineTo(x + iw, y + ih - r);
    g.quadraticCurveTo(x + iw, y + ih, x + iw - r, y + ih);
    g.lineTo(x + r, y + ih);
    g.quadraticCurveTo(x, y + ih, x, y + ih - r);
    g.lineTo(x, y + r);
    g.quadraticCurveTo(x, y, x + r, y);
    g.closePath();
  };
  const body = g.createLinearGradient(0, y, 0, y + ih);
  body.addColorStop(0, '#eeaa3c');
  body.addColorStop(1, '#e09a2e');
  round();
  g.fillStyle = body;
  g.fill();
  // 亮边：上边和右边；暗边：下边和左边，都很细
  const lw = Math.max(1, H * 0.012);
  g.save();
  round();
  g.clip();
  g.lineWidth = lw * 2;
  g.strokeStyle = 'rgba(255, 226, 150, 0.85)';
  g.beginPath();
  g.moveTo(x + r * 0.6, y);
  g.lineTo(x + iw, y);
  g.lineTo(x + iw, y + ih - r * 0.6);
  g.stroke();
  g.strokeStyle = 'rgba(150, 85, 10, 0.35)';
  g.beginPath();
  g.moveTo(x, y + r * 0.6);
  g.lineTo(x, y + ih);
  g.lineTo(x + iw - r * 0.6, y + ih);
  g.stroke();
  g.restore();
  return c;
}

function tilesLook(): Look {
  const SPIN = 0.45; // 转进来
  const HOLD = 0.16; // 摆正以后停一下
  const WIPE = 0.3; // 斜着抽掉
  let sprite: HTMLCanvasElement | null = null;
  let pattern: CanvasPattern | null = null;
  let acc: HTMLCanvasElement | null = null;
  let key = '';
  // 一格的大小（设备像素）：短边分六排，牌宽是高的 0.76；格子的角对准画面正中
  const cell = (w: number, h: number, dpr: number) => {
    const th = Math.round((Math.min(w, h) / 6) * dpr);
    return { th, tw: Math.round(th * 0.76) };
  };
  const prepare = (ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number) => {
    const k = `${w}x${h}@${dpr}`;
    if (k === key && sprite && pattern) return;
    key = k;
    const { tw, th } = cell(w, h, dpr);
    sprite = tileSprite(tw, th);
    pattern = ctx.createPattern(sprite, 'repeat');
    acc = document.createElement('canvas');
    acc.width = ctx.canvas.width;
    acc.height = ctx.canvas.height;
  };
  return {
    cover: SPIN,
    drawCover(ctx, t, w, h, dpr) {
      prepare(ctx, w, h, dpr);
      const { tw, th } = cell(w, h, dpr);
      const W = ctx.canvas.width;
      const H = ctx.canvas.height;
      const a = acc!.getContext('2d')!;
      // 转着缩小：开头转得快，有拖影（同一帧里叠几张稍早一点的样子，取平均）
      const N = t < SPIN * 0.85 ? 5 : 1;
      a.setTransform(1, 0, 0, 1, 0, 0);
      a.clearRect(0, 0, W, H);
      for (let i = 0; i < N; i++) {
        const ts = Math.max(0, t - i * 0.012);
        const e = easeOut(clamp01(ts / SPIN));
        const ang = -1.15 * (1 - e);
        const sc = 1 + 1.8 * (1 - e);
        a.globalAlpha = 1 / (i + 1);
        a.setTransform(1, 0, 0, 1, 0, 0);
        a.translate(W / 2, H / 2);
        a.rotate(ang);
        a.scale(sc, sc);
        a.fillStyle = pattern!;
        // 花纹从原点开始铺：原点就是画面中心，正好是四张牌的角
        const ext = Math.hypot(W, H) / sc / 2 + Math.max(tw, th);
        const x0 = -Math.ceil(ext / tw) * tw;
        const y0 = -Math.ceil(ext / th) * th;
        a.fillRect(x0, y0, -2 * x0, -2 * y0);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      // 一点下去就看得见一点影子，越转越实
      ctx.globalAlpha = Math.min(1, 0.12 + 0.88 * clamp01(t / SPIN) ** 1.25);
      ctx.drawImage(acc!, 0, 0);
      ctx.globalAlpha = 1;
    },
    drawReveal(ctx, t, w, h, dpr) {
      prepare(ctx, w, h, dpr);
      const { tw, th } = cell(w, h, dpr);
      const W = ctx.canvas.width;
      const H = ctx.canvas.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const cx = Math.round(W / 2);
      const cy = Math.round(H / 2);
      const i0 = -Math.ceil(cx / tw);
      const i1 = Math.ceil((W - cx) / tw);
      const j0 = -Math.ceil(cy / th);
      const j1 = Math.ceil((H - cy) / th);
      const cols = i1 - i0;
      const rows = j1 - j0;
      const last = cols + rows - 2;
      let left = 0;
      for (let j = j0; j < j1; j++) {
        for (let i = i0; i < i1; i++) {
          // 右上角先走，一斜排一斜排往左下
          const d = i1 - 1 - i + (j - j0);
          // 到点就整张没了（参考里就是一格一格硬切的）
          if (t >= HOLD + (WIPE * d) / Math.max(1, last)) continue;
          left++;
          ctx.drawImage(sprite!, cx + i * tw, cy + j * th);
        }
      }
      return left === 0;
    },
  };
}

// ---------------- 立直棒 ----------------

function stickLook(): Look | null {
  let scene: StickToss;
  try {
    scene = new StickToss();
  } catch {
    // 画不了 WebGL：换成一筒
    return null;
  }
  const T = STICK_TIMES;
  const FADE_IN = 0.12; // 牌桌盖上来
  const GLOW = 1.12; // 开始泛白
  const COVER = 1.6; // 全白，换页
  const CLEAR = 0.45; // 白色退掉
  // 磕桌、落地、弹第二下各响一声
  const hits = [
    { at: T.hit, vol: 0.7 },
    { at: T.land, vol: 1 },
    { at: T.land + 0.17, vol: 0.5 },
  ];
  let fired = 0;
  let land = { x: 0.45, y: 0.62 };
  // 泛白：从落点一圈圈亮开，最后整片白
  const glow = (ctx: CanvasRenderingContext2D, k: number, w: number, h: number): void => {
    if (k <= 0) return;
    const cx = land.x * w;
    const cy = land.y * h;
    const R = Math.hypot(w, h);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * (0.25 + k * 0.9));
    g.addColorStop(0, `rgba(255,255,255,${Math.min(1, k * 1.6)})`);
    g.addColorStop(0.55, `rgba(255,255,255,${Math.min(1, k * 1.1)})`);
    g.addColorStop(1, `rgba(255,255,255,${k ** 2})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  };
  // 四角压暗一点（低机位，像镜头的暗角）
  const vignette = (ctx: CanvasRenderingContext2D, w: number, h: number): void => {
    const g = ctx.createRadialGradient(w * 0.48, h * 0.5, Math.min(w, h) * 0.35, w * 0.5, h * 0.5, Math.hypot(w, h) * 0.62);
    g.addColorStop(0, 'rgba(0,10,6,0)');
    g.addColorStop(1, 'rgba(0,10,6,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  };
  return {
    cover: COVER,
    drawCover(ctx, t, w, h, dpr) {
      const W = Math.round(w * dpr);
      const H = Math.round(h * dpr);
      scene.render(Math.min(t, T.settle + 0.3), W, H);
      if (fired === 0) land = scene.landingOnScreen();
      while (fired < hits.length && t >= hits[fired].at) {
        playClick({ varied: true });
        fired++;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.globalAlpha = clamp01(t / FADE_IN);
      ctx.drawImage(scene.canvas, 0, 0, W, H);
      ctx.globalAlpha = 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      vignette(ctx, w, h);
      glow(ctx, clamp01((t - GLOW) / (COVER - GLOW)) ** 1.2, w, h);
    },
    drawReveal(ctx, t, w, h, dpr) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const u = clamp01(t / CLEAR);
      ctx.fillStyle = `rgba(255,255,255,${1 - easeOut(u)})`;
      ctx.fillRect(0, 0, w, h);
      return u >= 1;
    },
    dispose() {
      scene.dispose();
    },
  };
}
