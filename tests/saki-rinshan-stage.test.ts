import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { Game } from '../src/engine/game';
import { kindOf } from '../src/engine/tiles';
import { RINSHAN_TIERS, RinshanTier, rinshanHand, rinshanStage } from '../src/ui/sakiStage';
import { lilyCount } from '../src/ui3d/lilyFx';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

// 每一档期望的番数（不算宝牌）和满贯名
const EXPECT: Record<RinshanTier, { han?: number; limit: string; yakuman?: number }> = {
  small: { han: 2, limit: '' },
  mangan: { han: 5, limit: '满贯' },
  haneman: { han: 7, limit: '跳满' },
  baiman: { han: 8, limit: '倍满' },
  sanbaiman: { han: 11, limit: '三倍满' },
  yakuman: { limit: '役满', yakuman: 1 },
  double: { limit: '2 倍役满', yakuman: 2 },
};

// 咲坐庄，第一张摸到暗刻的第四张，暗杠，岭上自摸
function playRound(g: Game): ReturnType<typeof g.legalActions> | null {
  const kan = g.legalActions(0).find((a) => a.type === 'ankan');
  if (!kan) return null;
  g.act(0, kan);
  return g.legalActions(0);
}

// 和测试窗口开的局一样：咲坐庄，对手照坐但不用能力
function testGame(seed: number, tier: RinshanTier | 'cycle', ids: string[], format: 'east' | 'south' = 'east'): Game {
  const seats = ['saki', ...ids].map(byId);
  return new Game({ seed, format, firstDealer: 0, rules: { tobi: false }, stage: rinshanStage(0, tier), players: seats.map((c, s) => ({ name: c.id, ability: s === 0 ? c.ability : null, manual: s === 0 })) });
}

const OPPONENTS = [
  ['kuro', 'koromo', 'shizuno'],
  ['awai', 'nodoka', 'himeko'],
  ['teru', 'toki', 'sae'],
  ['yuuki', 'kirame', 'nelly'],
];

describe('宫永咲 · 岭上开花测试局', () => {
  for (const t of RINSHAN_TIERS) {
    it(`${t.label}（${t.note}）：暗杠以后岭上自摸，番数对得上（几个种子、几桌对手）`, () => {
      for (let seed = 1; seed <= 12; seed++) {
        const g = testGame(seed * 31 + t.id.length, t.id, OPPONENTS[seed % OPPONENTS.length]);
        checkTier(g, t.id);
      }
    });
  }

  it('一局一档轮着来：连庄时下一局换下一档，一直到两倍役满', () => {
    const g = testGame(5, 'cycle', ['nodoka', 'kuro', 'toki'], 'south');
    const got: number[] = [];
    for (let r = 0; r < RINSHAN_TIERS.length; r++) {
      while (g.phase === 'predeal' || g.phase === 'postdeal') g.deal();
      playRound(g);
      g.act(0, { type: 'tsumo' });
      got.push(g.roundResult!.wins[0].result.base);
      g.nextRound();
      expect(g.phase).not.toBe('gameEnd');
    }
    for (let i = 1; i < got.length; i++) expect(got[i]).toBeGreaterThan(got[i - 1]);
  });
});

// 咲第一张摸到暗刻的第四张，暗杠，岭上摸到和了牌自摸：番数、满贯名对得上，没有宝牌、赤宝牌
function checkTier(g: Game, tier: RinshanTier): void {
  while (g.phase === 'predeal' || g.phase === 'postdeal') g.deal();
  const p = g.players[0];
  expect(g.turn).toBe(0);
  const want = rinshanHand(tier, 28);
  expect(kindOf(p.drawn!)).toBe(want.kan);
  const after = playRound(g);
  expect(after?.some((a) => a.type === 'tsumo')).toBe(true);
  expect(kindOf(p.drawn!)).toBe(want.win);
  g.act(0, { type: 'tsumo' });
  const win = g.roundResult!.wins[0];
  const names = win.result.yaku.map((y) => y.name);
  const e = EXPECT[tier];
  if (e.yakuman) expect(win.result.yakuman).toBe(e.yakuman);
  else {
    expect(names).toContain('岭上开花');
    expect(win.result.han).toBe(e.han);
  }
  expect(win.result.aka + win.result.dora).toBe(0);
  if (e.limit) expect(win.result.limitName).toBe(e.limit);
}

describe('百合花瓣的数量', () => {
  it('和得越大花瓣越多，两倍役满封顶', () => {
    const bases = [240, 640, 2000, 3000, 4000, 6000, 8000, 16000, 24000];
    const n = bases.map(lilyCount);
    for (let i = 1; i < n.length; i++) expect(n[i]).toBeGreaterThanOrEqual(n[i - 1]);
    expect(n[0]).toBeGreaterThanOrEqual(30);
    expect(n[2]).toBeGreaterThan(n[1] * 1.5);
    expect(n.at(-1)).toBe(n.at(-2));
  });
});
