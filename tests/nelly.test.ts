import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { NELLY, nellyRiding, nellyWave, rideRounds } from '../src/abilities/nelly';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { shanten } from '../src/engine/shanten';
import { toCounts } from '../src/engine/tiles';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

const LINEUPS = [
  ['nelly', 'saki', 'nodoka', 'kuro'],
  ['koromo', 'nelly', 'hiroe', 'awai'],
  ['toki', 'kasumi', 'nelly', 'teru'],
  ['nodoka', 'mihoko', 'hiroe', 'nelly'],
];

function play(seed: number, ids: string[], setup: (g: Game, me: number) => void, pick?: (g: Game, me: number) => string[]) {
  const seats = ids.map(byId);
  const me = ids.indexOf('nelly');
  const g = new Game({ seed, players: seats.map((c, i) => ({ name: c.id, ability: c.ability, manual: !!pick && i === me })) });
  setup(g, me);
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 20000) {
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    if (g.phase === 'predeal') {
      g.abilities[me]!.setPreDeal!(g, me, pick!(g, me));
      g.deal();
      continue;
    }
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, seats[s].ai));
  }
  return g;
}

describe('涅莉·薇萨拉兹', () => {
  it('蓄浪：没和牌涨一格、放铳再涨一格；乘浪花掉全部的波，每两格乘一局', () => {
    let rides = 0;
    for (let seed = 1; seed <= 16; seed++) {
      // 玩家操作：波一到 3 格就乘浪
      play(
        seed,
        LINEUPS[seed % 4],
        (g, me) => {
          let wave = 0;
          let ride = 0;
          let riding = false;
          g.onEvent((e) => {
            if (e.type === 'roundStart') {
              if (!ride && wave >= 3) {
                ride = rideRounds(wave);
                wave = 0;
                rides++;
              }
              riding = ride > 0;
              expect(nellyRiding(g, me)).toBe(riding);
              expect(nellyWave(g, me)).toBe(wave);
            }
            if (e.type !== 'roundEnd') return;
            if (riding) ride--;
            else {
              const won = e.result.wins.some((w) => w.seat === me);
              const dealt = e.result.wins.some((w) => w.from === me);
              wave = Math.min(NELLY.waveMax, wave + (won ? 0 : 1) + (dealt ? 1 : 0));
            }
          });
        },
        (g, me) => (nellyWave(g, me) >= 3 ? ['ride'] : []),
      );
    }
    expect(rides).toBeGreaterThan(5);
  }, 120000);

  it('乘浪的局摸牌明显比蓄浪的局顺', () => {
    const draws = { ride: [0, 0], store: [0, 0] };
    for (let seed = 1; seed <= 30; seed++) {
      play(seed, LINEUPS[seed % 4], (g, me) => {
        g.onEvent((e) => {
          if (e.type !== 'draw' || e.seat !== me || g.rinshanDraw) return;
          const p = g.players[me];
          const before = shanten(toCounts(p.hand.filter((t) => t !== p.drawn)), p.melds.length);
          const good = shanten(toCounts(p.hand), p.melds.length) < before;
          const d = nellyRiding(g, me) ? draws.ride : draws.store;
          d[0]++;
          if (good) d[1]++;
        });
      });
    }
    const rate = (d: number[]) => d[1] / d[0];
    console.log({ ride: rate(draws.ride).toFixed(2), store: rate(draws.store).toFixed(2) });
    expect(draws.ride[0]).toBeGreaterThan(100);
    expect(rate(draws.ride)).toBeGreaterThan(rate(draws.store) + 0.15);
  }, 120000);
});
