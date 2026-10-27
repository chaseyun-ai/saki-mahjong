import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { isDoraTile, kuroLost } from '../src/abilities/kuro';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

const LINEUPS = [
  ['kuro', 'teru', 'sawaya', 'nelly'],
  ['awai', 'kuro', 'kasumi', 'teru'],
  ['teru', 'koromo', 'kuro', 'sawaya'],
  ['nelly', 'sawaya', 'teru', 'kuro'],
];

function play(seed: number, ids: string[], setup: (g: Game, kuro: number) => void) {
  const seats = ids.map(byId);
  const g = new Game({ seed, players: seats.map((c) => ({ name: c.id, ability: c.ability })) });
  setup(g, ids.indexOf('kuro'));
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 20000) {
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, seats[s].ai));
  }
  return g;
}

describe('松实玄：宝牌绝对优先', () => {
  it('能力还在时，别人（包括照、爽）的配牌没有宝牌，也摸不到宝牌；谁也封印不了她', () => {
    let hands = 0;
    let draws = 0;
    for (let seed = 1; seed <= 16; seed++) {
      play(seed, LINEUPS[seed % 4], (g, kuro) => {
        // 一张宝牌被翻出来之前已经在手里（开杠翻新宝牌），不算摸到
        let kanSinceDraw = false;
        g.onEvent((e) => {
          expect(g.isSealed(kuro)).toBe(false);
          if (e.type === 'call' && e.call.includes('杠')) kanSinceDraw = true;
          if (e.type === 'roundStart' && !kuroLost(g, kuro)) {
            for (let s = 0; s < 4; s++) {
              if (s === kuro) continue;
              hands++;
              expect(g.players[s].hand.filter((t) => isDoraTile(g, t))).toEqual([]);
            }
          }
          if (e.type === 'draw') {
            const drawn = g.players[e.seat].drawn!;
            if (e.seat !== kuro && !kuroLost(g, kuro) && !kanSinceDraw) {
              // 牌山里只剩宝牌（或者别的都被锁住）时才挡不住
              const other = g.wall.live.some((t) => !isDoraTile(g, t) && !g.wall.locked.has(t));
              if (other) {
                draws++;
                expect(isDoraTile(g, drawn)).toBe(false);
              }
            }
            kanSinceDraw = false;
          }
        });
      });
    }
    expect(hands).toBeGreaterThan(150);
    expect(draws).toBeGreaterThan(1000);
  }, 120000);
});

describe('宫永照：别人的能力动不了她', () => {
  it('不被封印；别人对她定的配牌规矩只有玄的算数', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const ids = LINEUPS[seed % 4];
      const teru = ids.indexOf('teru');
      play(seed, ids, (g) => {
        g.onEvent((e) => {
          expect(g.isSealed(teru)).toBe(false);
          if (e.type !== 'roundStart') return;
          for (const r of g.dealRules) if (r.target === teru && r.seat !== teru) expect(r.ability).toBe('kuro');
        });
      });
    }
  }, 120000);
});
