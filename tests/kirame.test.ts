import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

// 花田煌坐 0 号位，点数很少，跟强的人打团体赛（有人小于 0 立刻结束）
function play(seed: number, ids: string[], score: number, after?: (g: Game) => void) {
  const seats = ids.map(byId);
  const g = new Game({ seed, format: 'team', scores: [score, 25000, 25000, 25000], players: seats.map((c) => ({ name: c.id, ability: c.ability })) });
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 20000) {
    if (g.phase === 'roundEnd') {
      expect(g.players[0].score).toBeGreaterThanOrEqual(0);
      g.nextRound();
      continue;
    }
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, seats[s].ai));
    after?.(g);
  }
  expect(g.phase).toBe('gameEnd');
  return g;
}

describe('花田煌', () => {
  it('1 费，新道寺', () => {
    expect(byId('kirame').cost).toBe(1);
    expect(byId('kirame').school).toBe('新道寺女子');
  });

  it('点数再少也不会被击飞：别人摸不到击飞她的自摸，她打不出击飞自己的铳牌', () => {
    let guarded = 0;
    let banned = 0;
    for (let seed = 1; seed <= 16; seed++) {
      const g = play(seed, ['kirame', 'teru', 'sera', 'awai'], 1500 + (seed % 4) * 500, (g) => {
        if (g.phase !== 'turn' || g.turn !== 0) return;
        const legal = g.legalActions(0);
        for (const a of legal) if (a.type === 'discard') expect(g.dealInBusts(0, a.tile)).toBe(false);
        if (g.players[0].hand.some((t) => g.dealInBusts(0, t))) banned++;
      });
      guarded += g.events.filter((e) => e.type === 'ability' && e.ability === 'kirame').length;
      expect(g.players[0].score).toBeGreaterThanOrEqual(0);
    }
    expect(guarded).toBeGreaterThan(0);
    expect(banned).toBeGreaterThan(0);
  }, 60000);

  it('封印、佛灭也挡不住', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const g = play(seed, ['kirame', 'sawaya', 'toyone', 'teru'], 2000);
      expect(g.players[0].score).toBeGreaterThanOrEqual(0);
    }
  }, 60000);

  it('流局不听罚符最多付到 0 点，点数总和不变', () => {
    const g = new Game({ seed: 3, format: 'team', scores: [500, 25000, 25000, 25000], players: [byId('kirame'), byId('izumi'), byId('izumi'), byId('izumi')].map((c) => ({ name: c.id, ability: c.ability })) });
    const total = g.players.reduce((n, p) => n + p.score, 0);
    // 让牌山摸完：每家一直摸切
    while (g.phase === 'turn' || g.phase === 'calls') {
      const s = g.waitingSeats()[0];
      if (g.phase === 'calls') g.act(s, { type: 'pass' });
      else {
        const legal = g.legalActions(s).filter((a) => a.type === 'discard' && !a.riichi);
        g.act(s, legal.find((a) => a.type === 'discard' && a.tile === g.players[s].drawn) ?? legal[0]);
      }
    }
    expect(g.roundResult?.kind).toBe('exhaustive');
    expect(g.players[0].score).toBeGreaterThanOrEqual(0);
    expect(g.players.reduce((n, p) => n + p.score, 0)).toBe(total);
  });
});
