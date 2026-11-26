import { describe, expect, it } from 'vitest';
import { SHIZUNO } from '../src/abilities/shizuno';
import { stackAt, stackOrder } from '../src/engine/wall';
import { fogNoise } from '../src/ui/fogNoise';
import { DEAD_STACKS, WALL_STACKS, mistCover, mistLook, mistTone, stackDepth } from '../src/ui/mistLook';

describe('深山的雾：罩多远、多浓', () => {
  it('不到起雾的标记数没有雾', () => {
    for (let m = 0; m < SHIZUNO.doraAt; m++) expect(mistLook(m)).toBeNull();
    expect(mistLook(SHIZUNO.doraAt)).not.toBeNull();
  });

  it('标记每多一个，雾往前多罩一截、也浓一点', () => {
    let last = mistLook(SHIZUNO.doraAt)!;
    // 刚起雾：王牌 7 墩加上最后 10 张牌（5 墩）
    expect(last.reach).toBe(DEAD_STACKS + 5);
    for (let m = SHIZUNO.doraAt + 1; m <= 12; m++) {
      const look = mistLook(m)!;
      expect(look.reach).toBeGreaterThan(last.reach);
      expect(look.density).toBeGreaterThan(last.density);
      // 12 个之前每个标记多罩 5 墩（10 张牌）
      if (m < 12) expect(look.reach - last.reach).toBe(5);
      last = look;
    }
  });

  it('12 个标记罩满整座牌山、最浓，再多也一样', () => {
    const full = mistLook(12)!;
    expect(full.reach).toBe(WALL_STACKS);
    expect(full.density).toBeCloseTo(1);
    expect(mistLook(20)).toEqual(full);
    for (let depth = 0; depth < WALL_STACKS; depth++) expect(mistCover(full, depth)).toBe(1);
  });

  it('11 个标记时配牌以后剩下的牌山差不多都在雾里，只留最前面几墩', () => {
    const look = mistLook(11)!;
    // 配牌拿走 26 墩，剩 42 墩（王牌 7 + 能摸的 35）
    expect(look.reach).toBeLessThan(42);
    expect(look.reach).toBeGreaterThanOrEqual(42 - 5);
  });

  it('雾从最深处起：越深的墩罩得越实，前沿之外没有雾', () => {
    const look = mistLook(8)!;
    expect(mistCover(look, 0)).toBe(1);
    expect(mistCover(look, look.reach)).toBe(0);
    expect(mistCover(look, look.reach + 10)).toBe(0);
    for (let depth = 1; depth < WALL_STACKS; depth++) expect(mistCover(look, depth)).toBeLessThanOrEqual(mistCover(look, depth - 1));
    expect(mistCover(null, 0)).toBe(0);
  });
});

describe('牌山上每一墩离最深处多远', () => {
  it('stackOrder 是 stackAt 反过来', () => {
    for (let dealer = 0; dealer < 4; dealer++) {
      for (let sum = 2; sum <= 12; sum++) {
        for (let p = 0; p < WALL_STACKS; p++) {
          const s = stackAt(dealer, sum, p);
          expect(stackOrder(dealer, sum, s.wall, s.stack)).toBe(p);
        }
      }
    }
  });

  it('最深的是紧挨分开处的那墩王牌，最浅的是最先摸的那一墩', () => {
    for (let dealer = 0; dealer < 4; dealer++) {
      for (let sum = 2; sum <= 12; sum++) {
        const first = stackAt(dealer, sum, 0);
        const dead = stackAt(dealer, sum, WALL_STACKS - 1);
        const haitei = stackAt(dealer, sum, WALL_STACKS - 1 - DEAD_STACKS);
        expect(stackDepth(dealer, sum, first.wall, first.stack)).toBe(WALL_STACKS - 1);
        expect(stackDepth(dealer, sum, dead.wall, dead.stack)).toBe(0);
        expect(stackDepth(dealer, sum, haitei.wall, haitei.stack)).toBe(DEAD_STACKS);
      }
    }
  });
});

describe('雾的颜色和底纹', () => {
  it('浅色桌布上用灰一点的雾', () => {
    expect(mistTone('#285488').pale).toBe(false); // 大赛转播
    expect(mistTone('#2a6d4f').pale).toBe(false); // 绿呢
    expect(mistTone('#d3e5da').pale).toBe(true); // 白瓷
    expect(mistTone('#efd9b2').pale).toBe(true); // 沙滩
    expect(mistTone('不是颜色').pale).toBe(false);
  });

  it('底纹每次算出来一样，值在 0–1，首尾相接', () => {
    const size = 32;
    const a = fogNoise(size, 7);
    expect(Array.from(fogNoise(size, 7))).toEqual(Array.from(a));
    let min = Infinity;
    let max = -Infinity;
    for (const v of a) {
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(1);
    expect(max - min).toBeGreaterThan(0.5);
    // 最后一列接回第一列，跳变不比相邻两列之间大多少
    let seam = 0;
    let inner = 0;
    for (let y = 0; y < size; y++) {
      seam = Math.max(seam, Math.abs(a[y * size + size - 1] - a[y * size]));
      for (let x = 1; x < size; x++) inner = Math.max(inner, Math.abs(a[y * size + x] - a[y * size + x - 1]));
    }
    expect(seam).toBeLessThanOrEqual(inner * 1.5);
  });
});
