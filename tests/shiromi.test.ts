import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { SHIROMI, completeHands, shiromiPlan } from '../src/abilities/shiromi';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { shanten } from '../src/engine/shanten';
import { parseKinds, toCounts } from '../src/engine/tiles';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

function play(seed: number, ids: string[], step?: (g: Game) => void) {
  const seats = ids.map(byId);
  const g = new Game({ seed, players: seats.map((c) => ({ name: c.id, ability: c.ability })) });
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 20000) {
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    step?.(g);
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, seats[s].ai));
  }
  return g;
}

const kinds = (s: string) => {
  const c = new Array(34).fill(0);
  for (const k of parseKinds(s)) c[k]++;
  return c;
};

describe('小濑川白望', () => {
  it('宫守女子，3 费', () => {
    expect(byId('shiromi').school).toBe('宫守女子');
    expect(byId('shiromi').cost).toBe(3);
  });

  it('凑得出的和牌型都用到和了牌', () => {
    // 123m 456m 789m 11p 22p + 和了牌 2p
    const hands = completeHands(kinds('123456789m1122p2p'), 4, parseKinds('2p')[0]);
    expect(hands.length).toBeGreaterThan(0);
    for (const h of hands) {
      expect(h[parseKinds('2p')[0]]).toBeGreaterThan(0);
      expect(shanten(h, 0)).toBe(-1);
    }
    expect(completeHands(kinds('123456789m1122p'), 4, parseKinds('5s')[0])).toEqual([]);
  });

  it('三成左右发动；算出来的牌型照牌山摸得到，打水波纹那张以后凑得齐', () => {
    let turns = 0;
    let fired = 0;
    for (let seed = 1; seed <= 6; seed++) {
      play(seed, ['shiromi', 'izumi', 'izumi', 'izumi'], (g) => {
        if (g.phase !== 'turn' || g.turn !== 0 || g.players[0].riichi) return;
        turns++;
        const plan = shiromiPlan(g, 0);
        if (!plan) return;
        fired++;
        const p = g.players[0];
        expect(p.hand).toContain(plan.tile);
        expect(plan.value).toBeGreaterThan(0);
        // 和了牌就是她第 draws 次摸到的那张
        expect(g.wall.live[3 + 4 * (plan.draws - 1)]).toBe(plan.winTile);
        expect(shanten(toCounts(plan.hand), p.melds.length)).toBe(-1);
        // 最终牌型 = 手里留下的 + 以后摸到的
        const future = Array.from({ length: plan.draws }, (_, i) => g.wall.live[3 + 4 * i]);
        const rest = p.hand.filter((t) => t !== plan.tile);
        for (const t of plan.hand) {
          const i = future.indexOf(t);
          if (i >= 0) future.splice(i, 1);
          else expect(rest).toContain(t);
        }
      });
    }
    const rate = fired / turns;
    // 发动了也可能这一局怎么都和不了（不出水波纹），所以比 30% 低一些
    expect(rate).toBeGreaterThan(0.03);
    expect(rate).toBeLessThan(SHIROMI.chance + 0.05);
  }, 60000);

  it('看不看迷途之家都不改变牌局', () => {
    for (const seed of [3, 11]) {
      const a = play(seed, ['shiromi', 'toyone', 'saki', 'nodoka']);
      const b = play(seed, ['shiromi', 'toyone', 'saki', 'nodoka'], (g) => {
        for (let s = 0; s < 4; s++) shiromiPlan(g, s);
      });
      expect(b.players.map((p) => p.score)).toEqual(a.players.map((p) => p.score));
      expect(b.events.length).toBe(a.events.length);
    }
  }, 60000);
});
