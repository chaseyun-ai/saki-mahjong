import { describe, expect, it } from 'vitest';
import { KURUMI, kurumiAbility } from '../src/abilities/kurumi';
import { waitingKinds } from '../src/engine/shanten';
import { toCounts } from '../src/engine/tiles';
import { CHARACTERS } from '../src/abilities/characters';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

// 胡桃坐 0 号位，统计她听牌没立直时每次摸牌摸到（能自摸的）和了牌的比例
function play(seed: number, ability: typeof kurumiAbility | null) {
  const seats = [byId('kurumi'), byId('izumi'), byId('izumi'), byId('izumi')];
  const g = new Game({ seed, format: 'east', players: seats.map((c, i) => ({ name: c.id, ability: i === 0 ? ability : null })) });
  let draws = 0;
  let hits = 0;
  let riichi = 0;
  let steps = 0;
  g.onEvent((e) => {
    if (e.type === 'discard' && e.seat === 0 && e.riichi) riichi++;
    if (e.type !== 'draw' || e.seat !== 0) return;
    const p = g.players[0];
    const before = p.hand.filter((t) => t !== p.drawn);
    if (p.riichi || waitingKinds(toCounts(before), p.melds.length).length === 0) return;
    draws++;
    if (g.legalActions(0).some((a) => a.type === 'tsumo')) hits++;
  });
  while (g.phase !== 'gameEnd' && ++steps < 20000) {
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, seats[s].ai));
  }
  expect(g.phase).toBe('gameEnd');
  return { draws, hits, riichi };
}

describe('鹿仓胡桃', () => {
  it('1 费，宫守', () => {
    expect(byId('kurumi').cost).toBe(1);
    expect(byId('kurumi').school).toBe('宫守女子');
  });

  it('电脑的胡桃从不立直', () => {
    for (let seed = 1; seed <= 8; seed++) expect(play(seed, kurumiAbility).riichi).toBe(0);
  }, 60000);

  it('听牌没立直时自摸率上升', () => {
    const sum = (ab: typeof kurumiAbility | null) => {
      let d = 0;
      let h = 0;
      for (let seed = 1; seed <= 16; seed++) {
        const r = play(seed, ab);
        d += r.draws;
        h += r.hits;
      }
      return h / d;
    };
    const base = sum(null);
    const boosted = sum(kurumiAbility);
    expect(boosted).toBeGreaterThan(base + KURUMI.boost * 0.5);
  }, 120000);
});
