import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { type Box, boxCovered, carryBox, clampBox, coverBox, fitBox, fromCorner, fromRotated, moveBox, outSize, ratioText, reshapeBox, resizeBox, rotatedSize, scaleBox, toRotated } from '../src/assets/cropMath';
import { canCrop, croppedName } from '../src/assets/cropper';
import { cropOf, ratioWarn } from '../src/assets/guide';
import { GLOBAL, slotsFor } from '../src/assets/slots';

const inside = (b: Box, W: number, H: number) => b.x >= -1e-6 && b.y >= -1e-6 && b.x + b.w <= W + 1e-6 && b.y + b.h <= H + 1e-6;
const ratio = (b: Box) => b.w / b.h;

// 素材导入页放图前的裁剪框（cropper.ts）：框的几何、每一格的比例
describe('素材导入：裁剪框', () => {
  it('一开始是放得下的最大的框，比例对、在图里面', () => {
    const eyes = fitBox(1024, 1024, 16 / 5, 0.42);
    expect(eyes.w).toBe(1024);
    expect(ratio(eyes)).toBeCloseTo(3.2);
    expect(eyes.y + eyes.h / 2).toBeCloseTo(1024 * 0.42);
    const face = fitBox(1920, 1080, 3 / 4);
    expect(face.h).toBe(1080);
    expect(face.x).toBeCloseTo((1920 - 810) / 2);
    // 中心太靠上就贴着顶
    expect(fitBox(1000, 2000, 1, 0).y).toBe(0);
    expect(fitBox(800, 600, null)).toEqual({ x: 0, y: 0, w: 800, h: 600 });
  });

  it('挪、拉角、缩放、换比例都不出图，比例不变', () => {
    const W = 1200;
    const H = 900;
    const r = 3 / 4;
    let b = fitBox(W, H, r);
    b = moveBox(b, 5000, -5000, W, H);
    expect(inside(b, W, H)).toBe(true);
    expect(b.x + b.w).toBeCloseTo(W);
    expect(b.y).toBe(0);
    // 右下角往里拉一半
    const s = resizeBox(b, 'se', b.x + b.w / 2, b.y + b.h / 2, W, H, r, 20);
    expect(ratio(s)).toBeCloseTo(r);
    expect(s.x).toBe(b.x);
    expect(s.y).toBe(b.y);
    expect(inside(s, W, H)).toBe(true);
    // 左上角拉到图外面：碰到边就停，对角不动
    const n = resizeBox(s, 'nw', -500, -500, W, H, r, 20);
    expect(ratio(n)).toBeCloseTo(r);
    expect(n.x + n.w).toBeCloseTo(s.x + s.w);
    expect(n.y + n.h).toBeCloseTo(s.y + s.h);
    expect(inside(n, W, H)).toBe(true);
    // 拉过对角也不翻过去，最小 20
    const tiny = resizeBox(s, 'se', 0, 0, W, H, r, 20);
    expect(tiny.w).toBeGreaterThanOrEqual(20 - 1e-6);
    expect(tiny.h).toBeGreaterThanOrEqual(20 - 1e-6);
    // 放大到顶也在图里
    let z = s;
    for (let i = 0; i < 30; i++) z = scaleBox(z, 1.2, W, H, 20);
    expect(inside(z, W, H)).toBe(true);
    expect(ratio(z)).toBeCloseTo(r);
    expect(z.h).toBeCloseTo(H);
    for (let i = 0; i < 80; i++) z = scaleBox(z, 1 / 1.2, W, H, 20);
    expect(Math.min(z.w, z.h)).toBeGreaterThanOrEqual(20 - 1e-6);
    // 换成 16:5：中心不动、放得下
    const e = reshapeBox(fitBox(W, H, r), 16 / 5, W, H);
    expect(ratio(e)).toBeCloseTo(3.2);
    expect(inside(e, W, H)).toBe(true);
    expect(clampBox({ x: -10, y: -10, w: 5000, h: 5000 }, W, H)).toEqual({ x: 0, y: 0, w: W, h: H });
  });

  it('框外拖一下画新框：往哪边拖都行，不限比例时四边也能拉', () => {
    const b = fromCorner(500, 400, 300, 100, 1000, 800, 16 / 5, 10);
    expect(ratio(b)).toBeCloseTo(3.2);
    expect(b.x + b.w).toBe(500);
    expect(b.y + b.h).toBe(400);
    const free = fromCorner(100, 100, 400, 700, 1000, 800, null, 10);
    expect(free).toEqual({ x: 100, y: 100, w: 300, h: 600 });
    const e = resizeBox(free, 'e', 2000, 0, 1000, 800, null, 10);
    expect(e.x + e.w).toBe(1000);
    expect(e.h).toBe(600);
  });

  it('存出来不放大，长边不超过建议的大小', () => {
    expect(outSize({ x: 0, y: 0, w: 2400, h: 3200 }, 800)).toEqual({ w: 600, h: 800 });
    expect(outSize({ x: 0, y: 0, w: 3200, h: 1000 }, 1600)).toEqual({ w: 1600, h: 500 });
    expect(outSize({ x: 0, y: 0, w: 188.4, h: 58.9 }, 1600)).toEqual({ w: 188, h: 59 });
    expect(ratioText(1600, 500)).toBe('16:5');
    expect(ratioText(600, 800)).toBe('3:4');
    expect(ratioText(700, 300)).toBe('700×300');
  });

  it('旋转：90° 宽高对调，转过去再转回来是同一个点，框跟着图上同一个地方走', () => {
    expect(rotatedSize(1600, 900, 90)).toEqual({ w: 900, h: 1600 });
    expect(rotatedSize(1600, 900, 180)).toEqual({ w: 1600, h: 900 });
    expect(rotatedSize(1600, 900, -90)).toEqual({ w: 900, h: 1600 });
    const r45 = rotatedSize(1000, 1000, 45);
    expect(r45.w).toBeCloseTo(1000 * Math.SQRT2);
    // 顺时针转 90°：原图左上角跑到右上角
    const [x, y] = toRotated(0, 0, 1600, 900, 90);
    expect(x).toBeCloseTo(900);
    expect(y).toBeCloseTo(0);
    for (const deg of [-45, -18, 7.5, 90, 135, 270]) {
      const [rx, ry] = toRotated(300, 200, 1600, 900, deg);
      const [ox, oy] = fromRotated(rx, ry, 1600, 900, deg);
      expect(ox).toBeCloseTo(300);
      expect(oy).toBeCloseTo(200);
    }
    // 框着原图上 (400, 300) 这一块，转 -18° 以后框的中心还对着它
    const b: Box = { x: 300, y: 250, w: 200, h: 100 };
    const t = carryBox(b, 1600, 900, 0, -18);
    const [cx, cy] = fromRotated(t.x + t.w / 2, t.y + t.h / 2, 1600, 900, -18);
    expect(cx).toBeCloseTo(400);
    expect(cy).toBeCloseTo(300);
    expect(t.w).toBeCloseTo(200);
    // 转四次 90° 回到原样
    let q = b;
    for (let i = 1; i <= 4; i++) q = carryBox(q, 1600, 900, (i - 1) * 90, i * 90);
    expect(q.x).toBeCloseTo(b.x);
    expect(q.y).toBeCloseTo(b.y);
  });

  it('旋转：框到转出来的空角会认出来，缩到没有空角的框四个角都在图上', () => {
    const R = rotatedSize(1024, 1024, -18);
    expect(boxCovered({ x: 0, y: 0, w: R.w, h: R.h }, 1024, 1024, -18)).toBe(false);
    expect(boxCovered({ x: R.w / 2 - 50, y: R.h / 2 - 50, w: 100, h: 100 }, 1024, 1024, -18)).toBe(true);
    expect(boxCovered(fitBox(1024, 1024, null), 1024, 1024, 0)).toBe(true);
    for (const [deg, r] of [
      [-18, 16 / 5],
      [30, 3 / 4],
      [45, 1],
      [-7, null],
    ] as [number, number | null][]) {
      const c = coverBox(1024, 768, deg, r);
      expect(boxCovered(c, 1024, 768, deg)).toBe(true);
      if (r) expect(c.w / c.h).toBeCloseTo(r);
      // 再大一点就有空角了（是最大的）
      const big = { x: c.x - c.w * 0.01, y: c.y - c.h * 0.01, w: c.w * 1.02, h: c.h * 1.02 };
      expect(boxCovered(big, 1024, 768, deg)).toBe(false);
    }
  });

  it('每个放图的格子都有裁剪比例：头像 3:4、睁眼特写 16:5，模型和声音没有', () => {
    const awai = slotsFor('awai', CHARACTERS);
    const of = (slot: string) => cropOf(awai.find((d) => d.slot === slot)!);
    expect(of('face')?.ratios[0].r).toBeCloseTo(3 / 4);
    expect(of('face')?.long).toBe(800);
    expect(of('eyes')?.ratios[0].r).toBeCloseTo(16 / 5);
    expect(of('eyes')?.look).toBe('eyes');
    expect(of('win')?.ratios[0].r).toBeCloseTo(3 / 4);
    expect(of('result')?.ratios[0].r).toBeNull();
    expect(of('model')).toBeNull();
    expect(of('voice-riichi')).toBeNull();
    for (const d of slotsFor(GLOBAL, CHARACTERS)) expect(cropOf(d)).toBeNull();
    for (const c of CHARACTERS) for (const d of slotsFor(c.id, CHARACTERS)) if (d.media.includes('image')) expect(cropOf(d)?.ratios.length).toBeGreaterThan(0);
  });

  it('比例差太多才提醒；动图不裁；裁过的名字', () => {
    const awai = slotsFor('awai', CHARACTERS);
    const d = (slot: string) => awai.find((x) => x.slot === slot)!;
    expect(ratioWarn(d('face'), 600, 800)).toBeNull();
    expect(ratioWarn(d('face'), 1920, 1080)).toMatch(/3:4/);
    expect(ratioWarn(d('eyes'), 1600, 500)).toBeNull();
    expect(ratioWarn(d('eyes'), 1024, 1024)).toMatch(/16:5/);
    expect(ratioWarn(d('win'), 1600, 1200)).toBeNull();
    expect(canCrop('image/png')).toBe(true);
    expect(canCrop('image/jpeg')).toBe(true);
    expect(canCrop('image/gif')).toBe(false);
    expect(canCrop('image/webp', true)).toBe(false);
    expect(canCrop('video/mp4')).toBe(false);
    expect(croppedName('咲.png', 'webp')).toBe('咲（裁过）.webp');
    expect(croppedName('咲（裁过）.webp', 'webp')).toBe('咲（裁过）.webp');
  });
});
