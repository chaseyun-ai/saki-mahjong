import { describe, expect, it } from 'vitest';
import { sigilParts, sigilReveal } from '../src/ui3d/kimonSigil';

describe('初美的鬼门法阵：描线进度', () => {
  it('没开鬼门时什么都不画', () => {
    expect(sigilReveal(0)).toBe(0);
    const p = sigilParts(0);
    expect([p.outer, p.ticks, p.inner, p.star]).toEqual([0, 0, 0, 0]);
    expect(p.trig.some(Boolean)).toBe(false);
  });

  it('刚鸣出东北（0.2）：外圈画满，亮起头一个卦，星还没开始', () => {
    const p = sigilParts(sigilReveal(0.2));
    expect(p.outer).toBe(1);
    expect(p.trig[0]).toBe(true);
    expect(p.star).toBe(0);
  });

  it('越接近听牌描得越多，听牌（1）时整个阵画完', () => {
    let last = -1;
    for (const lv of [0.2, 0.31, 0.42, 0.53, 0.64, 0.75, 0.85, 1]) {
      const r = sigilReveal(lv);
      expect(r).toBeGreaterThan(last);
      last = r;
    }
    const p = sigilParts(sigilReveal(1));
    expect([p.outer, p.outer2, p.ticks, p.inner, p.star]).toEqual([1, 1, 1, 1, 1]);
    expect(p.trig.every(Boolean)).toBe(true);
  });
});
