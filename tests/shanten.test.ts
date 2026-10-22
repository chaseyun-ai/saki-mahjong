import { describe, expect, it } from 'vitest';
import { shanten, waitingKinds } from '../src/engine/shanten';
import { parseKinds, KIND_COUNT, kindName } from '../src/engine/tiles';

const counts = (s: string) => {
  const c = new Array(KIND_COUNT).fill(0);
  for (const k of parseKinds(s)) c[k]++;
  return c;
};

describe('向听数', () => {
  it('和了是 -1', () => expect(shanten(counts('123456m789p234s55s'))).toBe(-1));
  it('听牌是 0', () => expect(shanten(counts('23456m789p234s55s'))).toBe(0));
  it('七对子一向听', () => expect(shanten(counts('1133m2288p4466s7z'))).toBe(0));
  it('国士无双', () => expect(shanten(counts('19m19p19s1234567z'))).toBe(0));
  it('乱牌', () => expect(shanten(counts('147m258p369s1234z'))).toBeGreaterThanOrEqual(5));
  it('有副露时', () => expect(shanten(counts('2345m'), 3)).toBe(0));
  it('听牌种类', () => {
    expect(waitingKinds(counts('23456m789p234s55s')).map(kindName)).toEqual(['1m', '4m', '7m']);
  });
});

// 慢但直接的参考实现，用来核对带缓存的快速版本
function referenceShanten(counts: number[], meldCount: number): number {
  const limit = 4 - meldCount;
  const blocks = (c: number[], i: number, m: number, t: number): number => {
    while (i < 34 && c[i] === 0) i++;
    if (i >= 34) {
      const mm = Math.min(m, limit);
      return 2 * mm + Math.min(t, limit - mm);
    }
    let best = 0;
    const suited = i < 27;
    const n = i % 9;
    const tryRemove = (ks: number[], dm: number, dt: number) => {
      if (ks.some((k, j) => c[k] < ks.filter((x, y) => x === k && y <= j).length)) return;
      ks.forEach((k) => c[k]--);
      best = Math.max(best, blocks(c, i, m + dm, t + dt));
      ks.forEach((k) => c[k]++);
    };
    tryRemove([i, i, i], 1, 0);
    if (suited && n <= 6) tryRemove([i, i + 1, i + 2], 1, 0);
    tryRemove([i, i], 0, 1);
    if (suited && n <= 7) tryRemove([i, i + 1], 0, 1);
    if (suited && n <= 6) tryRemove([i, i + 2], 0, 1);
    const saved = c[i];
    c[i] = 0;
    best = Math.max(best, blocks(c, i + 1, m, t));
    c[i] = saved;
    return best;
  };
  const c = counts.slice();
  let best = 8 - 2 * meldCount - blocks(c, 0, 0, 0);
  for (let k = 0; k < 34; k++) {
    if (c[k] < 2) continue;
    c[k] -= 2;
    best = Math.min(best, 7 - 2 * meldCount - blocks(c, 0, 0, 0));
    c[k] += 2;
  }
  return best;
}

describe('快速向听和参考实现一致', () => {
  it('随机 3000 手', async () => {
    const { Rng } = await import('../src/engine/rng');
    const { standardShanten } = await import('../src/engine/shanten');
    const rng = new Rng(42);
    for (let n = 0; n < 3000; n++) {
      const melds = rng.int(4);
      const size = 14 - 3 * melds - rng.int(2);
      const wall = rng.shuffle(Array.from({ length: 136 }, (_, i) => i >> 2)).slice(0, size);
      // 一半的手牌集中在一两种花色，覆盖更多复杂形状
      const c = new Array(34).fill(0);
      for (const k of n % 2 ? wall : wall.map((k) => (k % 18))) c[k] = Math.min(4, c[k] + 1);
      expect(standardShanten(c, melds)).toBe(referenceShanten(c, melds));
    }
  });
});
