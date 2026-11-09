import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { himekoKeySeat } from '../src/abilities/himeko';
import type { BindKey } from '../src/abilities/types';
import { Game } from '../src/engine/game';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

function game(keys: BindKey[][], ids = ['teru', 'himeko', 'kuro', 'koromo']) {
  const seats = ids.map(byId);
  const g = new Game({ seed: 3, format: 'east', keys, players: seats.map((c) => ({ name: c.id, ability: c.ability })) });
  g.deal();
  return g;
}

// 配牌时的光柱和火（himekoFx.ts、himeko2d.ts）只在姬子拿着钥匙的那一局放
describe('姬子配牌特效的触发', () => {
  it('拿着这一局的钥匙：找得到她的座位', () => {
    expect(himekoKeySeat(game([[], [{ label: '东1局 0本场', round: 1, bind: 3, broken: false }], [], []]))).toBe(1);
  });
  it('破碎的钥匙、别的局的钥匙、没有姬子：都不放', () => {
    expect(himekoKeySeat(game([[], [{ label: '东1局 0本场', round: 1, bind: 3, broken: true }], [], []]))).toBeNull();
    expect(himekoKeySeat(game([[], [{ label: '东2局 0本场', round: 2, bind: 3, broken: false }], [], []]))).toBeNull();
    expect(himekoKeySeat(game([[], [], [], []], ['teru', 'kuro', 'koromo', 'saki']))).toBeNull();
  });
});

describe('姬子配牌的节奏（错落着砸下来）', () => {
  it('每张砸一次，不按从左到右，前后两张在手里隔得开，间隔有长有短，最后一张是重拍', async () => {
    const { beatHit, beatFinal, beatLength, beatSeed } = await import('../src/ui/himekoBeat');
    for (const n of [13, 14]) {
      const orders = new Set<string>();
      for (const seed of [1, 7, 12345, beatSeed(99, 3)]) {
        const at = Array.from({ length: n }, (_, i) => beatHit(i, n, seed).at);
        const seq = [...at.keys()].sort((a, b) => at[a] - at[b]);
        orders.add(seq.join());
        expect(seq).not.toEqual([...Array(n).keys()]);
        const gaps = seq.slice(1).map((i, k) => at[i] - at[seq[k]]);
        for (const d of gaps) expect(d).toBeGreaterThan(0.05);
        expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(0.06);
        for (let k = 1; k < n; k++) expect(Math.abs(seq[k] - seq[k - 1])).toBeGreaterThanOrEqual(2);
        // 重拍只有一张，是最后砸下来的那张
        const accents = Array.from({ length: n }, (_, i) => beatHit(i, n, seed).accent);
        expect(accents.filter((x) => x === 2)).toHaveLength(1);
        expect(accents[seq[n - 1]]).toBe(2);
        expect(beatFinal(n, seed)).toBe(at[seq[n - 1]]);
        expect(beatLength(n, seed)).toBeGreaterThan(beatFinal(n, seed));
        // 同一个种子每次一样（3D、2D 对得上）
        expect(Array.from({ length: n }, (_, i) => beatHit(i, n, seed).at)).toEqual(at);
      }
      // 每一局不一样
      expect(orders.size).toBeGreaterThan(1);
    }
  });
});
