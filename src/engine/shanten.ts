import { KIND_COUNT, YAOCHU_KINDS } from './tiles';

// 向听数：-1 = 和了，0 = 听牌
// counts 是手里（不含副露）的牌种计数，meldCount 是副露面子数

export function shanten(counts: readonly number[], meldCount = 0): number {
  let s = standardShanten(counts, meldCount);
  if (meldCount === 0) {
    s = Math.min(s, chiitoiShanten(counts), kokushiShanten(counts));
  }
  return s;
}

export function standardShanten(counts: readonly number[], meldCount = 0): number {
  const limit = 4 - meldCount;
  // 每组（三种数牌 + 字牌）给出不取雀头 / 取雀头时能达到的 (面子, 搭子) 组合
  const groups = [0, 1, 2].map((s) => suitOptions(counts, s * 9));
  groups.push(honorOptions(counts));
  let best = 8;
  const score = (m: number, t: number) => {
    const mm = Math.min(m, limit);
    return 2 * mm + Math.min(t, limit - mm);
  };
  // 不取雀头
  const combine = (lists: Pair[][]): Pair[] => {
    let acc: Pair[] = [[0, 0]];
    for (const l of lists) {
      const next: Pair[] = [];
      for (const [am, at] of acc) for (const [bm, bt] of l) next.push([am + bm, at + bt]);
      acc = pareto(next);
    }
    return acc;
  };
  for (const [m, t] of combine(groups.map((g) => g.noHead))) {
    best = Math.min(best, 8 - 2 * meldCount - score(m, t));
  }
  for (let h = 0; h < 4; h++) {
    if (groups[h].withHead.length === 0) continue;
    const lists = groups.map((g, i) => (i === h ? g.withHead : g.noHead));
    for (const [m, t] of combine(lists)) {
      best = Math.min(best, 7 - 2 * meldCount - score(m, t));
    }
  }
  return best;
}

type Pair = [number, number];

interface GroupOptions {
  noHead: Pair[];
  withHead: Pair[];
}

function pareto(list: Pair[]): Pair[] {
  const out: Pair[] = [];
  for (const p of list) {
    if (list.some((q) => q !== p && q[0] >= p[0] && q[1] >= p[1] && (q[0] > p[0] || q[1] > p[1]))) continue;
    if (out.some((q) => q[0] === p[0] && q[1] === p[1])) continue;
    out.push(p);
  }
  return out;
}

const suitCache = new Map<number, GroupOptions>();

function suitOptions(counts: readonly number[], offset: number): GroupOptions {
  let key = 0;
  for (let i = 0; i < 9; i++) key = key * 5 + counts[offset + i];
  const cached = suitCache.get(key);
  if (cached) return cached;
  const c = counts.slice(offset, offset + 9);
  const noHead: Pair[] = [];
  suitBlocks(c, 0, 0, 0, noHead);
  const withHead: Pair[] = [];
  for (let i = 0; i < 9; i++) {
    if (c[i] < 2) continue;
    c[i] -= 2;
    suitBlocks(c, 0, 0, 0, withHead);
    c[i] += 2;
  }
  const res = { noHead: pareto(noHead), withHead: pareto(withHead) };
  suitCache.set(key, res);
  return res;
}

function suitBlocks(c: number[], i: number, m: number, t: number, out: Pair[]): void {
  while (i < 9 && c[i] === 0) i++;
  if (i >= 9) {
    out.push([m, t]);
    return;
  }
  if (c[i] >= 3) {
    c[i] -= 3;
    suitBlocks(c, i, m + 1, t, out);
    c[i] += 3;
  }
  if (i <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
    c[i]--; c[i + 1]--; c[i + 2]--;
    suitBlocks(c, i, m + 1, t, out);
    c[i]++; c[i + 1]++; c[i + 2]++;
  }
  if (c[i] >= 2) {
    c[i] -= 2;
    suitBlocks(c, i, m, t + 1, out);
    c[i] += 2;
  }
  if (i <= 7 && c[i + 1] > 0) {
    c[i]--; c[i + 1]--;
    suitBlocks(c, i, m, t + 1, out);
    c[i]++; c[i + 1]++;
  }
  if (i <= 6 && c[i + 2] > 0) {
    c[i]--; c[i + 2]--;
    suitBlocks(c, i, m, t + 1, out);
    c[i]++; c[i + 2]++;
  }
  const saved = c[i];
  c[i] = 0;
  suitBlocks(c, i + 1, m, t, out);
  c[i] = saved;
}

function honorOptions(counts: readonly number[]): GroupOptions {
  let m = 0;
  let t = 0;
  let pairs = 0;
  for (let k = 27; k < 34; k++) {
    if (counts[k] >= 3) m++;
    else if (counts[k] === 2) {
      t++;
      pairs++;
    }
  }
  // 取雀头只会从对子里取（刻子拆成雀头不会更好）
  const withHead: Pair[] = pairs > 0 ? [[m, t - 1]] : [];
  return { noHead: [[m, t]], withHead };
}

export function chiitoiShanten(counts: readonly number[]): number {
  let pairs = 0;
  let kinds = 0;
  for (const n of counts) {
    if (n >= 1) kinds++;
    if (n >= 2) pairs++;
  }
  return 6 - pairs + Math.max(0, 7 - kinds);
}

export function kokushiShanten(counts: readonly number[]): number {
  let kinds = 0;
  let pair = 0;
  for (const k of YAOCHU_KINDS) {
    if (counts[k] >= 1) kinds++;
    if (counts[k] >= 2) pair = 1;
  }
  return 13 - kinds - pair;
}

// 听牌时能和的牌种（不考虑是否有役）
export function waitingKinds(counts: readonly number[], meldCount = 0): number[] {
  const c = counts.slice();
  const out: number[] = [];
  for (let k = 0; k < KIND_COUNT; k++) {
    if (c[k] >= 4) continue;
    c[k]++;
    if (shanten(c, meldCount) === -1) out.push(k);
    c[k]--;
  }
  return out;
}
