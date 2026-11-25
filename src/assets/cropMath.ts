// 裁剪框的几何（cropper.ts 用）：都在原图的像素坐标里，W×H 是原图大小，r 是框的宽:高（null 是不限比例）。
// 不碰页面，单独拿出来好测（tests/assets-crop.test.ts）

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

// 四个角、四条边
export type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

// 比例 r 的框在 W×H 里最大能多大
function maxSize(W: number, H: number, r: number | null): { w: number; h: number } {
  if (!r) return { w: W, h: H };
  return W / H > r ? { w: H * r, h: H } : { w: W, h: W / r };
}

// 一开始的框：原图里放得下的最大一个，左右居中，上下中心放在 focusY（0 顶，1 底；头像、眼睛偏上一点）
export function fitBox(W: number, H: number, r: number | null, focusY = 0.5): Box {
  const { w, h } = maxSize(W, H, r);
  return { x: (W - w) / 2, y: clamp(focusY * H - h / 2, 0, H - h), w, h };
}

// 框整个挪回原图里面（比原图大就先缩到放得下）
export function clampBox(b: Box, W: number, H: number): Box {
  const w = Math.min(b.w, W);
  const h = Math.min(b.h, H);
  return { x: clamp(b.x, 0, W - w), y: clamp(b.y, 0, H - h), w, h };
}

export function moveBox(b: Box, dx: number, dy: number, W: number, H: number): Box {
  return clampBox({ ...b, x: b.x + dx, y: b.y + dy }, W, H);
}

// 从 (ax, ay) 这个角拉到 (px, py)：拉一个角改大小（对角不动），在框外拖着画一个新框也是它。
// 有比例时跟着拉得多的那一边走，碰到原图的边就停；最小 min（宽、高都不小于它）
export function fromCorner(ax: number, ay: number, px: number, py: number, W: number, H: number, r: number | null, min: number): Box {
  const right = px >= ax;
  const down = py >= ay;
  const roomW = right ? W - ax : ax;
  const roomH = down ? H - ay : ay;
  let w = Math.abs(px - ax);
  let h = Math.abs(py - ay);
  if (r) {
    const minW = Math.max(min, min * r);
    w = Math.min(Math.max(w, h * r, minW), roomW, roomH * r);
    h = w / r;
  } else {
    w = clamp(w, Math.min(min, roomW), roomW);
    h = clamp(h, Math.min(min, roomH), roomH);
  }
  return { x: right ? ax : ax - w, y: down ? ay : ay - h, w, h };
}

// 拉某个角、某条边到 (px, py)
export function resizeBox(b: Box, handle: Handle, px: number, py: number, W: number, H: number, r: number | null, min: number): Box {
  if (handle.length === 2) {
    const ax = handle.includes('w') ? b.x + b.w : b.x;
    const ay = handle.includes('n') ? b.y + b.h : b.y;
    // 不让拉过对角翻过去：指针过了对角就当贴着对角
    const qx = handle.includes('w') ? Math.min(px, ax) : Math.max(px, ax);
    const qy = handle.includes('n') ? Math.min(py, ay) : Math.max(py, ay);
    return fromCorner(ax, ay, qx, qy, W, H, r, min);
  }
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  if (handle === 'e' || handle === 'w') {
    const ax = handle === 'w' ? b.x + b.w : b.x;
    let w = clamp(handle === 'w' ? ax - px : px - ax, min, handle === 'w' ? ax : W - ax);
    let h = b.h;
    // 有比例：高跟着变，上下以原来的中心为准
    if (r) {
      w = Math.min(w, H * r);
      h = w / r;
    }
    return clampBox({ x: handle === 'w' ? ax - w : ax, y: r ? cy - h / 2 : b.y, w, h }, W, H);
  }
  const ay = handle === 'n' ? b.y + b.h : b.y;
  let h = clamp(handle === 'n' ? ay - py : py - ay, min, handle === 'n' ? ay : H - ay);
  let w = b.w;
  if (r) {
    h = Math.min(h, W / r);
    w = h * r;
  }
  return clampBox({ x: r ? cx - w / 2 : b.x, y: handle === 'n' ? ay - h : ay, w, h }, W, H);
}

// 以框的中心放大缩小（滚轮、+ -）：k > 1 变大。不超出原图，不小于 min
export function scaleBox(b: Box, k: number, W: number, H: number, min: number): Box {
  const lo = Math.max(min / b.w, min / b.h, 0);
  const hi = Math.min(W / b.w, H / b.h);
  const s = clamp(k, Math.min(lo, 1), Math.max(hi, 1));
  const w = b.w * s;
  const h = b.h * s;
  return clampBox({ x: b.x + (b.w - w) / 2, y: b.y + (b.h - h) / 2, w, h }, W, H);
}

// 换比例：中心不动，面积差不多，放不下就缩
export function reshapeBox(b: Box, r: number | null, W: number, H: number): Box {
  if (!r) return b;
  let w = Math.sqrt(b.w * b.h * r);
  let h = w / r;
  const m = maxSize(W, H, r);
  if (w > m.w || h > m.h) {
    w = m.w;
    h = m.h;
  }
  return clampBox({ x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w, h }, W, H);
}

// 存成多大：不放大，长边不超过 long
export function outSize(b: Box, long: number): { w: number; h: number } {
  const k = Math.min(1, long / Math.max(b.w, b.h));
  return { w: Math.max(1, Math.round(b.w * k)), h: Math.max(1, Math.round(b.h * k)) };
}

// 宽:高写成人看的样子：接近常见比例就写比例（3:4、16:5），不然写宽×高
export function ratioText(w: number, h: number): string {
  const r = w / h;
  const common: [number, string][] = [
    [3 / 4, '3:4'],
    [4 / 3, '4:3'],
    [1, '1:1'],
    [16 / 9, '16:9'],
    [9 / 16, '9:16'],
    [16 / 5, '16:5'],
    [2 / 3, '2:3'],
    [3 / 2, '3:2'],
  ];
  const hit = common.find(([v]) => Math.abs(r / v - 1) < 0.03);
  return hit ? hit[1] : `${Math.round(w)}×${Math.round(h)}`;
}

// ---------- 旋转：原图 W×H 绕自己的中心顺时针转 deg 度，转过的图放在一个刚好装得下的外接框里（框外是透明的空角） ----------

// 正好 90° 的倍数时 cos、sin 取整，免得 1e-17 这种零头让尺寸多出一点
function trig(deg: number): [number, number] {
  const t = (deg * Math.PI) / 180;
  const snap = (v: number) => (Math.abs(v) < 1e-12 ? 0 : Math.abs(Math.abs(v) - 1) < 1e-12 ? Math.sign(v) : v);
  return [snap(Math.cos(t)), snap(Math.sin(t))];
}

export function rotatedSize(W: number, H: number, deg: number): { w: number; h: number } {
  const [c, s] = trig(deg);
  return { w: Math.abs(W * c) + Math.abs(H * s), h: Math.abs(W * s) + Math.abs(H * c) };
}

// 原图上的一点 → 转过的图上的一点
export function toRotated(x: number, y: number, W: number, H: number, deg: number): [number, number] {
  const [c, s] = trig(deg);
  const R = rotatedSize(W, H, deg);
  const dx = x - W / 2;
  const dy = y - H / 2;
  return [dx * c - dy * s + R.w / 2, dx * s + dy * c + R.h / 2];
}

// 转过的图上的一点 → 原图上的一点
export function fromRotated(x: number, y: number, W: number, H: number, deg: number): [number, number] {
  const [c, s] = trig(deg);
  const R = rotatedSize(W, H, deg);
  const dx = x - R.w / 2;
  const dy = y - R.h / 2;
  return [dx * c + dy * s + W / 2, -dx * s + dy * c + H / 2];
}

// 框整个等比缩到放得下，再挪进来（换比例、换角度时不改框的形状）
export function fitInside(b: Box, W: number, H: number): Box {
  const k = Math.min(1, W / b.w, H / b.h);
  const w = b.w * k;
  const h = b.h * k;
  return clampBox({ x: b.x + (b.w - w) / 2, y: b.y + (b.h - h) / 2, w, h }, W, H);
}

// 换角度：框的中心跟着原图上的同一个点走（框着眼睛转，转完还框着眼睛），大小不变，放不下就缩
export function carryBox(b: Box, W: number, H: number, from: number, to: number): Box {
  const [ox, oy] = fromRotated(b.x + b.w / 2, b.y + b.h / 2, W, H, from);
  const [cx, cy] = toRotated(ox, oy, W, H, to);
  const R = rotatedSize(W, H, to);
  return fitInside({ x: cx - b.w / 2, y: cy - b.h / 2, w: b.w, h: b.h }, R.w, R.h);
}

// 框是不是整个落在图上（没框到转出来的透明空角）：四个角转回原图都在原图里
export function boxCovered(b: Box, W: number, H: number, deg: number): boolean {
  const e = 0.5;
  const corners: [number, number][] = [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x, b.y + b.h],
    [b.x + b.w, b.y + b.h],
  ];
  return corners.every(([x, y]) => {
    const [px, py] = fromRotated(x, y, W, H, deg);
    return px >= -e && py >= -e && px <= W + e && py <= H + e;
  });
}

// 不留空角时框最大多大：比例 r 的框放在转过的图正中间，四个角都落在原图上（二分找）
export function coverBox(W: number, H: number, deg: number, r: number | null, focus?: [number, number]): Box {
  const R = rotatedSize(W, H, deg);
  const ratio = r ?? W / H;
  const [fx, fy] = focus ?? [R.w / 2, R.h / 2];
  let lo = 0;
  let hi = Math.min(R.w, R.h * ratio);
  for (let i = 0; i < 40; i++) {
    const w = (lo + hi) / 2;
    const h = w / ratio;
    const b = clampBox({ x: fx - w / 2, y: fy - h / 2, w, h }, R.w, R.h);
    if (boxCovered(b, W, H, deg)) lo = w;
    else hi = w;
  }
  const h = lo / ratio;
  return clampBox({ x: fx - lo / 2, y: fy - h / 2, w: lo, h }, R.w, R.h);
}
