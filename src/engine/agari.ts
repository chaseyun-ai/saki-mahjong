import { KIND_COUNT, Kind } from './tiles';

// 把和了时的门内手牌拆成 雀头 + 面子。一手牌可能有好几种拆法，算分时取最高的。

export interface Block {
  type: 'shuntsu' | 'koutsu';
  kind: Kind; // 顺子取最小的那张
}

export interface Decomposition {
  head: Kind;
  blocks: Block[];
}

export function decompose(counts: readonly number[]): Decomposition[] {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total % 3 !== 2) return [];
  const out: Decomposition[] = [];
  const c = counts.slice();
  for (let h = 0; h < KIND_COUNT; h++) {
    if (c[h] < 2) continue;
    c[h] -= 2;
    const blocks: Block[] = [];
    extract(c, 0, blocks, (bs) => out.push({ head: h, blocks: bs.slice() }));
    c[h] += 2;
  }
  return out;
}

function extract(c: number[], i: number, blocks: Block[], emit: (b: Block[]) => void): void {
  while (i < KIND_COUNT && c[i] === 0) i++;
  if (i >= KIND_COUNT) {
    emit(blocks);
    return;
  }
  if (c[i] >= 3) {
    c[i] -= 3;
    blocks.push({ type: 'koutsu', kind: i });
    extract(c, i, blocks, emit);
    blocks.pop();
    c[i] += 3;
  }
  if (i < 27 && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
    c[i]--; c[i + 1]--; c[i + 2]--;
    blocks.push({ type: 'shuntsu', kind: i });
    extract(c, i, blocks, emit);
    blocks.pop();
    c[i]++; c[i + 1]++; c[i + 2]++;
  }
}

export function isChiitoi(counts: readonly number[]): boolean {
  let pairs = 0;
  for (const n of counts) {
    if (n === 2) pairs++;
    else if (n !== 0) return false;
  }
  return pairs === 7;
}

export function isKokushi(counts: readonly number[]): boolean {
  const yaochu = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
  let pair = false;
  for (let k = 0; k < KIND_COUNT; k++) {
    const n = counts[k];
    if (!yaochu.includes(k)) {
      if (n) return false;
      continue;
    }
    if (n === 0) return false;
    if (n === 2) pair = true;
    if (n > 2) return false;
  }
  return pair;
}
