import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { Rng } from '../src/engine/rng';
import { isRed, kindOf } from '../src/engine/tiles';

describe('电脑打牌', () => {
  it('手里有同一种的普通牌时，不打赤宝牌', () => {
    let red = 0;
    let bad = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const order = new Rng(seed * 31 + 7).shuffle([...CHARACTERS]).slice(0, 4);
      const g = new Game({ seed, format: 'east', players: order.map((c) => ({ name: c.id, ability: c.ability })) });
      let steps = 0;
      while (g.phase !== 'gameEnd' && ++steps < 20000) {
        if (g.phase === 'roundEnd') {
          g.nextRound();
          continue;
        }
        const s = g.waitingSeats()[0];
        const a = chooseAction(g, s, order[s].ai);
        if (a.type === 'discard' && isRed(a.tile) && !g.players[s].riichi) {
          red++;
          if (g.players[s].hand.some((t) => t !== a.tile && kindOf(t) === kindOf(a.tile))) bad++;
        }
        g.act(s, a);
      }
    }
    console.log({ red, bad });
    expect(red).toBeGreaterThan(10);
    expect(bad).toBe(0);
  }, 120000);
});
