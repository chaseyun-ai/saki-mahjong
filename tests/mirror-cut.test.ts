import { describe, expect, it } from 'vitest';
import { MIRROR_CUT, MIRROR_CUT_MS, SLABS_GONE, mirrorBeat, mirrorShards, mirrorSlabs } from '../src/ui/mirrorCut';

describe('照魔镜的演出（mirrorCut）', () => {
  it('三拍接着放，最后淡出：裂地、碎裂、镜中人', () => {
    expect(MIRROR_CUT_MS).toBe(MIRROR_CUT.crack + MIRROR_CUT.shatter + MIRROR_CUT.reveal + MIRROR_CUT.fade);
    expect(mirrorBeat(0)).toEqual({ beat: 'crack', t: 0 });
    expect(mirrorBeat(MIRROR_CUT.crack - 1).beat).toBe('crack');
    expect(mirrorBeat(MIRROR_CUT.crack)).toEqual({ beat: 'shatter', t: 0 });
    expect(mirrorBeat(MIRROR_CUT.crack + MIRROR_CUT.shatter).beat).toBe('reveal');
    expect(mirrorBeat(MIRROR_CUT_MS - 1).beat).toBe('fade');
    expect(mirrorBeat(MIRROR_CUT_MS).beat).toBe('done');
    expect(mirrorBeat(-50)).toEqual({ beat: 'crack', t: 0 });
    // 整段不超过四秒：两局之间不让人等太久
    expect(MIRROR_CUT_MS).toBeLessThanOrEqual(4000);
    // 镜中人那一拍最长：看得清是哪三家
    expect(MIRROR_CUT.reveal).toBeGreaterThan(MIRROR_CUT.crack);
  });

  it('石板：每次都是同一套；压在镜面上的全都会崩开，从裂口往外一圈圈传，镜子外面的地面不动', () => {
    const a = mirrorSlabs();
    expect(mirrorSlabs()).toEqual(a);
    const over = a.filter((s) => s.over);
    expect(over.length).toBeGreaterThan(30);
    expect(a.length - over.length).toBeGreaterThan(10);
    for (const s of a) {
      expect(s.pts.length === 3 || s.pts.length === 4).toBe(true);
      expect(s.breakAt).toBeGreaterThan(0.1);
      expect(s.breakAt).toBeLessThanOrEqual(SLABS_GONE);
      expect(Math.hypot(s.dx, s.dy)).toBeCloseTo(1, 5);
    }
    // 离裂口近的先崩
    const near = over.filter((s) => Math.hypot(s.cx - 0.12, s.cy - 0.18) < 0.4);
    const far = over.filter((s) => Math.hypot(s.cx - 0.12, s.cy - 0.18) > 0.9);
    const mean = (l: typeof over) => l.reduce((n, s) => n + s.breakAt, 0) / l.length;
    expect(near.length).toBeGreaterThan(3);
    expect(far.length).toBeGreaterThan(3);
    expect(mean(near)).toBeLessThan(mean(far) - 0.2);
  });

  it('碎片：绕中心一圈都有，大片的少、细的多', () => {
    const a = mirrorShards(3);
    expect(mirrorShards(3)).toEqual(a);
    expect(mirrorShards(17)).not.toEqual(a);
    const big = a.filter((s) => s.big);
    expect(big.length).toBeGreaterThan(4);
    expect(big.length).toBeLessThan(a.length / 2);
    for (const s of a) {
      expect(s.r1).toBeGreaterThan(s.r0);
      expect(s.jag.length).toBe(12);
    }
    // 八个方向每一个都有碎片
    const dirs = new Set(a.map((s) => Math.floor((s.angle % (Math.PI * 2)) / (Math.PI / 4))));
    expect(dirs.size).toBe(8);
  });
});
