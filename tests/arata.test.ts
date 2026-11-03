import { describe, expect, it } from 'vitest';
import { ARATA, arataAbility, bowlingOf, bowlingShape } from '../src/abilities/arata';
import { CHARACTERS } from '../src/abilities/characters';
import { Game } from '../src/engine/game';
import { waitingKinds } from '../src/engine/shanten';
import { TileId, kindOf, toCounts } from '../src/engine/tiles';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

// 牌种：一万 0 … 九万 8，一饼 9 … 九饼 17，一索 18 … 九索 26，字牌 27–33
const P = (n: number) => 8 + n;
const S = (n: number) => 17 + n;
const M = (n: number) => n - 1;
// 牌种列表 → 每种牌几张
const counts = (kinds: number[]) => {
  const c = new Array(34).fill(0);
  for (const k of kinds) c[k]++;
  return c;
};

// 开局以后把灼（0 号位）的手牌换成指定的 13 张：要的牌从牌山、王牌、别人手里换过来，牌不多不少
function withHand(seed: number, kinds: number[]) {
  const g = new Game({ seed, format: 'east', players: ['arata', 'izumi', 'izumi', 'izumi'].map((id, i) => ({ name: id, ability: i === 0 ? arataAbility : null })) });
  const p = g.players[0];
  if (p.hand.length === 14) {
    g.wall.live.push(p.drawn!);
    p.hand = p.hand.filter((t) => t !== p.drawn);
    p.drawn = null;
  }
  const shown = new Set(g.wall.visibleDoraIndicators());
  const want: TileId[] = [];
  for (const k of kinds) {
    const t = [0, 1, 2, 3].map((j) => k * 4 + j).find((t) => !want.includes(t) && !shown.has(t))!;
    want.push(t);
  }
  const pools = [g.wall.live, g.wall.rinshan, g.wall.uraIndicators, g.wall.doraIndicators, ...[1, 2, 3].map((s) => g.players[s].hand)];
  for (const t of want) {
    if (p.hand.includes(t)) continue;
    const spare = p.hand.findIndex((x) => !want.includes(x));
    const pool = pools.find((a) => a.includes(t))!;
    pool[pool.indexOf(t)] = p.hand[spare];
    p.hand[spare] = t;
  }
  expect(toCounts(p.hand)).toEqual(counts(kinds));
  return g;
}

// 换过手牌以后摸牌前发动一次（或者不发动），下一张摸到和了牌的比例
function hitRate(kinds: number[], on: boolean) {
  const waits = waitingKinds(counts(kinds), 0);
  let hits = 0;
  const n = 300;
  for (let seed = 1; seed <= n; seed++) {
    const g = withHand(seed, kinds);
    if (on) arataAbility.beforeDraw!(g, 0, false);
    if (waits.includes(kindOf(g.wall.live[0]))) hits++;
  }
  return hits / n;
}

const BASE = [M(1), M(2), M(3), M(5), M(6), M(7), S(1), S(2), S(3), 27, 27];

describe('鹭森灼', () => {
  it('2 费，阿知贺', () => {
    expect(byId('arata').cost).toBe(2);
    expect(byId('arata').school).toBe('阿知贺女子学院');
  });

  it('保龄球型：听的牌全是四、六、七、八、九饼；四饼加六到九饼是希腊教堂', () => {
    expect(bowlingShape([P(6), P(9)])).toBe('bowl');
    expect(bowlingShape([P(7)])).toBe('bowl');
    expect(bowlingShape([P(4), P(7)])).toBe('church');
    expect(bowlingShape([P(4)])).toBe('bowl');
    // 五饼、一到三饼、别的花色都不算
    expect(bowlingShape([P(5), P(8)])).toBeNull();
    expect(bowlingShape([P(1), P(4), P(7)])).toBeNull();
    expect(bowlingShape([S(4), S(7)])).toBeNull();
    expect(bowlingShape([])).toBeNull();
    // 一二三万 五六七万 一二三索 東東 五六饼：听四七饼，希腊教堂
    expect(bowlingOf(counts([M(1), M(2), M(3), M(5), M(6), M(7), S(1), S(2), S(3), 27, 27, P(5), P(6)]), 0)).toBe('church');
    // 七八饼：听六九饼
    expect(bowlingOf(counts([M(1), M(2), M(3), M(5), M(6), M(7), S(1), S(2), S(3), 27, 27, P(7), P(8)]), 0)).toBe('bowl');
    // 二三饼：听一四饼，不算
    expect(bowlingOf(counts([M(1), M(2), M(3), M(5), M(6), M(7), S(1), S(2), S(3), 27, 27, P(2), P(3)]), 0)).toBeNull();
  });

  it('保龄球听牌时自摸率大幅上升，希腊教堂更高', () => {
    // 七八饼听六九饼：保龄球
    const bowlOff = hitRate([...BASE, P(7), P(8)], false);
    const bowlOn = hitRate([...BASE, P(7), P(8)], true);
    expect(bowlOn).toBeGreaterThan(bowlOff + ARATA.bowl * 0.7);
    // 五六饼听四七饼：希腊教堂
    const churchOn = hitRate([...BASE, P(5), P(6)], true);
    expect(churchOn).toBeGreaterThan(bowlOn);
    // 二三饼听一四饼：不算，摸牌不动
    expect(hitRate([...BASE, P(2), P(3)], true)).toBe(hitRate([...BASE, P(2), P(3)], false));
  });
});
