import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { koromoMoon } from '../src/abilities/koromo';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { shanten } from '../src/engine/shanten';
import { toCounts } from '../src/engine/tiles';

const lineup = ['koromo', 'saki', 'nodoka', 'kuro'].map((id) => CHARACTERS.find((c) => c.id === id)!);

function play(seed: number, setup: (g: Game, me: number) => void) {
  const seats = [0, 1, 2, 3].map((i) => lineup[(i + seed) % 4]);
  const g = new Game({ seed, players: seats.map((c) => ({ name: c.id, ability: c.ability })) });
  const me = seats.findIndex((c) => c.id === 'koromo');
  setup(g, me);
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 20000) {
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, seats[s].ai));
  }
}

describe('天江衣', () => {
  it('月相整场不变', () => {
    for (let seed = 1; seed <= 5; seed++) {
      play(seed, (g, me) => {
        const moon = koromoMoon(g, me);
        expect(moon).not.toBeNull();
        g.onEvent((e) => {
          if (e.type === 'roundStart') expect(koromoMoon(g, me)).toBe(moon);
        });
      });
    }
  }, 60000);

  it('满月：别人一向听、两向听时摸不到进张；海底安排好、没人打乱时，最后一张就是她的和了牌', () => {
    let checked = 0;
    let leaks = 0;
    let haitei = 0;
    for (let seed = 1; seed <= 16; seed++) {
      play(seed, (g, me) => {
        (g.abilityGameState[me] as { moon?: number }).moon = 4;
        expect(koromoMoon(g, me)!.name).toBe('满月');
        g.onEvent((e) => {
          if (e.type !== 'draw') return;
          const p = g.players[e.seat];
          if (e.seat === me) {
            const planned = (g.abilityState[me] as { haitei?: number }).haitei;
            if (planned !== undefined && p.drawn === planned && g.wall.remaining === 0) {
              haitei++;
              expect(g.legalActions(me).some((a) => a.type === "tsumo")).toBe(true);
            }
            return;
          }
          if (g.rinshanDraw) return;
          const before = shanten(toCounts(p.hand.filter((t) => t !== p.drawn)), p.melds.length);
          if (before < 1 || before > 2) return;
          checked++;
          if (shanten(toCounts(p.hand), p.melds.length) < before) leaks++;
        });
      });
    }
    console.log({ checked, leaks, haitei });
    expect(checked).toBeGreaterThan(200);
    // 进张被换光、或者被怜和淡锁住时才挡不住
    expect(leaks).toBeLessThan(checked * 0.05);
    expect(haitei).toBeGreaterThan(0);
  }, 120000);
});
