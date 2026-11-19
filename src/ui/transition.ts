// 页面之间的过场，照用户给的两段动画参考做的：
//
// pin（一筒）：一枚一筒从画面上方掉下来，在中间弹一下；然后一下切到一枚很大的一筒，盖在已经换好的新页面上，
//   镜头往一筒的中心冲进去（绿圈、花瓣、红圈、蓝点一层层飞出画面），最后满屏是花心的白；
//   白里开一个圆窗，越开越大，露出新页面。
// tiles（牌背）：一整面扣着的牌（牌背朝上排满屏幕）一边转一边缩小，慢慢盖住旧页面；摆正以后在下面换页面，
//   停一下，再从右上角往左下角一斜排一斜排地抽掉，露出新页面。
//
// 都画在一块盖住整个窗口的 canvas 上（过场时也挡住点击）。换页（swap）在切镜（一筒）或完全盖住（牌背）的那一刻做。
// 换页可能很重（建 3D 牌桌、读模型），所以换完以后的那一半从下一帧重新计时，卡一下也不会跳掉。
// 系统开了「减少动态效果」、或者画不了 canvas（测试环境），直接换页。

export type TransitionKind = 'pin' | 'tiles';

interface Look {
  // 前一半（盖住旧页面）多长，秒
  cover: number;
  // 前一半第 t 秒；画在 CSS 像素坐标里
  drawCover(ctx: CanvasRenderingContext2D, t: number, w: number, h: number, dpr: number): void;
  // 后一半第 t 秒（换完页以后重新计时）；画完了返回 true
  drawReveal(ctx: CanvasRenderingContext2D, t: number, w: number, h: number, dpr: number): boolean;
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

  const look: Look = kind === 'pin' ? pinLook() : tilesLook();
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

const GREEN = '#17734a';
const GREEN_DARK = '#0b4429';
const RED = '#c4212c';
const RED_DARK = '#7d1119';
const BLUE = '#1c4c8f';
const BLUE_DARK = '#0f2c57';
const IVORY = '#fbf8ef';

const TAU = Math.PI * 2;

function disc(ctx: CanvasRenderingContext2D, r: number, fill: string | CanvasGradient): void {
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fillStyle = fill;
  ctx.fill();
}

// 一枚大一筒（和牌面上的一筒同一套颜色：绿外圈、绿花瓣、红圈、蓝点、蓝花心），画在原点，半径 R。
// shadow：弹跳时底下一层影子；画面比它大很多的时候，只画还看得见的那几圈
function drawPin(ctx: CanvasRenderingContext2D, R: number, view: number, shadow: boolean): void {
  // view：从中心到画面最远角的距离。某一圈的内半径比它还大，就整圈看不见
  const seen = (inner: number) => inner * R < view;
  if (seen(0.9)) {
    ctx.save();
    if (shadow) {
      ctx.shadowColor = 'rgba(20, 12, 0, 0.38)';
      ctx.shadowBlur = R * 0.22;
      ctx.shadowOffsetY = R * 0.09;
    }
    disc(ctx, R, GREEN);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.985, 0, TAU);
    ctx.lineWidth = R * 0.03;
    ctx.strokeStyle = GREEN_DARK;
    ctx.stroke();
  }
  if (seen(0.58)) {
    // 象牙白的一圈，左上亮一点
    const g = ctx.createRadialGradient(-R * 0.3, -R * 0.35, R * 0.1, 0, 0, R * 0.9);
    g.addColorStop(0, '#fffdf6');
    g.addColorStop(1, '#f1eadb');
    disc(ctx, R * 0.9, g);
    // 十六片花瓣：尖头的叶子形，从里往外
    ctx.fillStyle = GREEN;
    for (let i = 0; i < 16; i++) {
      ctx.save();
      ctx.rotate((i / 16) * TAU);
      ctx.beginPath();
      ctx.moveTo(R * 0.61, 0);
      ctx.quadraticCurveTo(R * 0.72, -R * 0.105, R * 0.86, 0);
      ctx.quadraticCurveTo(R * 0.72, R * 0.105, R * 0.61, 0);
      ctx.fill();
      ctx.restore();
    }
  }
  if (seen(0.45)) {
    disc(ctx, R * 0.58, RED);
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.57, 0, TAU);
    ctx.lineWidth = R * 0.022;
    ctx.strokeStyle = RED_DARK;
    ctx.stroke();
  }
  if (seen(0.194)) {
    disc(ctx, R * 0.45, IVORY);
    ctx.fillStyle = BLUE;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + Math.PI / 8;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * R * 0.315, Math.sin(a) * R * 0.315, R * 0.076, 0, TAU);
      ctx.fill();
    }
  }
  if (seen(0.085)) {
    disc(ctx, R * 0.194, BLUE);
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.188, 0, TAU);
    ctx.lineWidth = R * 0.012;
    ctx.strokeStyle = BLUE_DARK;
    ctx.stroke();
  }
  disc(ctx, R * 0.085, IVORY);
  // 整枚一筒左上角一道高光（像一枚有釉的牌面）
  if (shadow) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TAU);
    ctx.clip();
    const hl = ctx.createLinearGradient(-R, -R, R * 0.2, R * 0.2);
    hl.addColorStop(0, 'rgba(255,255,255,0.32)');
    hl.addColorStop(0.45, 'rgba(255,255,255,0.06)');
    hl.addColorStop(0.46, 'rgba(255,255,255,0)');
    ctx.fillStyle = hl;
    ctx.fillRect(-R, -R, R * 2, R * 2);
    ctx.restore();
  }
}

const easeOut = (u: number) => 1 - (1 - u) ** 3;
const clamp01 = (u: number) => Math.max(0, Math.min(1, u));

function pinLook(): Look {
  // 前一半：从上面掉下来（0.27 秒落到底），弹起来，往下落的半路上切镜
  const FLOOR = 0.8;
  const PEAK = 0.56;
  const LAND = 0.27;
  const HOP = 0.1; // 弹起来到最高点用的时间
  const CUT = 0.44;
  // 后一半：冲进中心（ZOOM 秒）以后，白里开圆窗（OPEN 秒）
  const ZOOM = 0.17;
  const OPEN = 0.4;
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
      drawPin(ctx, R, Infinity, true);
    },
    drawReveal(ctx, t, w, h, dpr) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const view = Math.hypot(w, h) / 2;
      const R0 = Math.min(w, h) * 0.47;
      // 冲进去：花心的白（半径 0.085R）盖满画面时停
      const Rend = (view / 0.085) * 1.05;
      const R = R0 * (Rend / R0) ** clamp01(t / ZOOM);
      ctx.translate(w / 2, h / 2);
      drawPin(ctx, R, view, false);
      if (t <= ZOOM) return false;
      // 圆窗：先匀着开，最后一下冲出画面
      const u = clamp01((t - ZOOM) / OPEN);
      const r0 = Math.min(w, h) * 0.06;
      const r = r0 + (view * 1.02 - r0) * (0.6 * u + 0.4 * u ** 6);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      return u >= 1;
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
