import './teruFx.css';

// 宫永照的两段演出，三种视角共用：都画在盖住整个页面的一层上（position: fixed），不跟着牌桌重画。
// - 照魔镜：镜子局开始时，另外三家的头像上各罩一面镜子，镜面扫过一道光（原作里对手背后升起的那面镜子）
// - 旋风自摸：连和中自摸，从她手边朝桌心卷出一道旋风（原作里卷在右手上的那股风），连和的次数越多越粗、越长

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// 镜子从出现到散掉多久（毫秒），三面镜子一面接一面，隔 MIRROR_GAP
export const MIRROR_MS = 2400;
const MIRROR_GAP = 180;

// 八瓣的镜缘：外圈一圈小珠，里面两道细线
function mirrorSvg(): string {
  const studs = Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2;
    return `<circle cx="${(Math.cos(a) * 53).toFixed(2)}" cy="${(Math.sin(a) * 53).toFixed(2)}" r="${i % 2 ? 1.5 : 2.6}"/>`;
  }).join('');
  return `<svg viewBox="-60 -60 120 120" aria-hidden="true">
    <circle r="53" fill="none" stroke="currentColor" stroke-width="5.5"/>
    <circle r="47.5" fill="none" stroke="rgba(60,40,10,0.55)" stroke-width="1.2"/>
    <circle r="45.5" fill="none" stroke="currentColor" stroke-width="1.4" opacity="0.8"/>
    <g fill="#fff8dc">${studs}</g>
  </svg>`;
}

// 照魔镜：spots 是三家头像在页面上的位置（getBoundingClientRect）
export function teruMirrors(spots: { left: number; top: number; width: number; height: number }[]): void {
  if (reduced()) return;
  spots.forEach((r, i) => {
    if (r.width <= 0) return;
    const el = document.createElement('div');
    el.className = 'teru-mirror';
    // 比头像大一圈；大头像框上不超过 200px（不然伸出画面）
    const d = Math.min(200, Math.max(96, Math.max(r.width, r.height) * 1.25));
    el.style.left = `${r.left + r.width / 2}px`;
    el.style.top = `${r.top + r.height / 2}px`;
    el.style.setProperty('--d', `${d.toFixed(0)}px`);
    el.style.setProperty('--delay', `${i * MIRROR_GAP}ms`);
    el.innerHTML = `<i class="tm-glass"><i class="tm-shine"></i></i>${mirrorSvg()}<i class="tm-glint"></i>`;
    document.body.appendChild(el);
    window.setTimeout(() => el.remove(), MIRROR_MS + i * MIRROR_GAP + 200);
  });
}

// ---------- 旋风 ----------

const SEG = 12;
const TORNADO_S = 2.2;
// 白的风丝里掺几道她的绯红
const PALETTE: [number, number, number][] = [
  [255, 255, 255],
  [255, 236, 240],
  [255, 196, 208],
  [236, 96, 128],
  [255, 255, 255],
  [200, 58, 92],
];

interface Wisp {
  f0: number; // 一开始在轴上的哪一段（0 手边、1 桌心那头）
  rise: number; // 沿着轴往前卷多快
  theta: number;
  omega: number;
  span: number;
  width: number;
  col: [number, number, number];
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// 连和到第几次时旋风多大（0–1）：第 2 次刚看得出，第 6 次起最大
export function tornadoSize(streak: number): number {
  return Math.max(0, Math.min(1, (streak - 1) / 5));
}

// 旋风自摸：from 是她手边、to 是桌心（页面上的坐标），streak 是这一次和了以后连和到第几次
export function teruTornado(from: { x: number; y: number }, to: { x: number; y: number }, streak: number): void {
  if (reduced() || streak < 2) return;
  const size = tornadoSize(streak);
  const canvas = document.createElement('canvas');
  canvas.className = 'teru-tornado';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return;
  }
  const dist = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const ax = (to.x - from.x) / dist;
  const ay = (to.y - from.y) / dist;
  // 垂直于轴的方向
  const nx = -ay;
  const ny = ax;
  // 卷多长、多粗：连和越多越大（最长伸过桌心一点）
  const length = dist * (0.55 + 0.6 * size);
  const wide = length * (0.2 + 0.16 * size);
  const narrow = wide * 0.16;
  const wisps: Wisp[] = Array.from({ length: Math.round(34 + 60 * size) }, (_, i) => ({
    f0: Math.random(),
    rise: 0.45 + Math.random() * 0.6,
    theta: Math.random() * Math.PI * 2,
    omega: 7 + Math.random() * 6,
    span: 1.1 + Math.random() * 1.7,
    width: (2.5 + Math.pow(Math.random(), 1.6) * 8) * (0.8 + 0.8 * size),
    col: PALETTE[i % PALETTE.length],
  }));
  const t0 = performance.now();

  const band = (pts: [number, number, number][], width: number, style: string) => {
    const left: [number, number][] = [];
    const right: [number, number][] = [];
    for (let i = 0; i < pts.length; i++) {
      const [x, y, tp] = pts[i];
      const [x2, y2] = pts[Math.min(pts.length - 1, i + 1)];
      const [x0, y0] = pts[Math.max(0, i - 1)];
      let dx = x2 - x0;
      let dy = y2 - y0;
      const l = Math.hypot(dx, dy) || 1;
      dx /= l;
      dy /= l;
      const hw = width * tp * 0.5;
      left.push([x - dy * hw, y + dx * hw]);
      right.push([x + dy * hw, y - dx * hw]);
    }
    ctx.beginPath();
    ctx.moveTo(left[0][0], left[0][1]);
    for (const p of left) ctx.lineTo(p[0], p[1]);
    for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
    ctx.closePath();
    ctx.fillStyle = style;
    ctx.fill();
  };

  const frame = (now: number) => {
    const t = (now - t0) / 1000;
    if (t >= TORNADO_S || !canvas.isConnected) {
      canvas.remove();
      return;
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    // 先卷起来，停一会儿，再散开
    const grow = smooth(0, 0.4, t);
    const fade = 1 - smooth(TORNADO_S - 0.7, TORNADO_S, t);
    const reach = length * (0.25 + 0.75 * grow);
    const spread = 1 + 0.5 * smooth(TORNADO_S - 0.7, TORNADO_S, t);
    const radius = (f: number) => (narrow + (wide - narrow) * Math.pow(f, 1.25)) * spread;
    // 手边一团光
    const glow = Math.min(1, t * 8) * fade * (0.35 + 0.35 * size);
    const g = ctx.createRadialGradient(from.x, from.y, 0, from.x, from.y, wide * 1.6);
    g.addColorStop(0, `rgba(255,255,255,${glow.toFixed(3)})`);
    g.addColorStop(0.3, `rgba(255,190,205,${(glow * 0.5).toFixed(3)})`);
    g.addColorStop(1, 'rgba(200,58,92,0)');
    ctx.fillStyle = g;
    ctx.fillRect(from.x - wide * 1.6, from.y - wide * 1.6, wide * 3.2, wide * 3.2);
    for (const s of wisps) {
      const f = (s.f0 + t * s.rise) % 1;
      const th = s.theta + t * s.omega;
      const life = smooth(0, 0.12, f) * (1 - smooth(0.78, 1, f));
      const pts: [number, number, number][] = [];
      let depth = 0;
      for (let k = 0; k <= SEG; k++) {
        const u = k / SEG;
        const a = th - u * s.span;
        const fu = Math.max(0, f - u * s.span * 0.05);
        const r = radius(fu);
        // 圆截面斜着看是个扁椭圆：沿轴方向压扁
        const along = fu * reach + Math.cos(a) * r * 0.3;
        const side = Math.sin(a) * r;
        pts.push([from.x + ax * along + nx * side, from.y + ay * along + ny * side, Math.pow(Math.sin(Math.PI * u), 0.6) * (1 - 0.4 * u)]);
        if (k === 0) depth = Math.cos(a);
      }
      // 转到背面的那一段淡一些
      const alpha = grow * fade * life * (0.4 + 0.6 * (depth + 1) * 0.5);
      if (alpha < 0.01) continue;
      const [r, gg, b] = s.col;
      band(pts, s.width * 2.4, `rgba(${r},${gg},${b},${(alpha * 0.2).toFixed(3)})`);
      band(pts, s.width, `rgba(${r},${gg},${b},${(alpha * 0.55).toFixed(3)})`);
      band(pts, s.width * 0.3, `rgba(255,255,255,${(alpha * 0.8).toFixed(3)})`);
    }
    ctx.globalCompositeOperation = 'source-over';
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  // 页面切到后台时动画帧不走：到点自己收掉
  window.setTimeout(() => canvas.remove(), TORNADO_S * 1000 + 400);
}
