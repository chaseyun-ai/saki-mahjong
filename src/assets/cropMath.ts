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
