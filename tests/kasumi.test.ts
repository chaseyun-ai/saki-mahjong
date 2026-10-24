import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { kasumiSuit } from '../src/abilities/kasumi';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { shanten } from '../src/engine/shanten';
import { TileId, kindOf, suitOf, toCounts } from '../src/engine/tiles';

const lineup = ['kasumi', 'saki', 'nodoka', 'kuro'].map((id) => CHARACTERS.find((c) => c.id === id)!);
const inSuit = (suit: number) => (t: TileId) => kindOf(t) < 27 && suitOf(kindOf(t)) === suit;

describe('石户霞', () => {
  it('落后才请神，请神后整场不退；别人配牌里没有那种花色，摸牌也摸不到（岭上牌除外）', () => {
    let rounds = 0;
    let summonedRounds = 0;
    let checkedDraws = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const seats = [0, 1, 2, 3].map((i) => lineup[(i + seed) % 4]);
      const g = new Game({ seed, players: seats.map((c) => ({ name: c.id, ability: c.ability })) });
      const me = seats.findIndex((c) => c.id === 'kasumi');
      // 第一局大家同分，不算落后
      expect(kasumiSuit(g, me)).toBeNull();
      let summoned = false;
      g.onEvent((e) => {
        if (e.type === 'roundStart') {
          rounds++;
          const suit = kasumiSuit(g, me);
          if (summoned) expect(suit).not.toBeNull();
          if (suit === null) return;
          summoned = true;
          summonedRounds++;
          for (const p of g.players) if (p.seat !== me) expect(p.hand.some(inSuit(suit))).toBe(false);
        }
        if (e.type === 'draw' && e.seat !== me && !g.rinshanDraw) {
          const suit = kasumiSuit(g, me);
          if (suit === null) return;
          const p = g.players[e.seat];
          // 牌山里别的花色被摸光（或被锁住）时才挡不住
          const other = g.wall.live.some((t) => !inSuit(suit)(t) && !g.wall.locked.has(t));
          if (!other) return;
          checkedDraws++;
          expect(inSuit(suit)(p.drawn!)).toBe(false);
        }
      });
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
    console.log({ rounds, summonedRounds, checkedDraws });
    expect(summonedRounds).toBeGreaterThan(10);
    expect(checkedDraws).toBeGreaterThan(100);
  }, 120000);

  it('和大星淡同场：淡定的配牌霞不能改（配牌锁住），淡的配牌照样听牌', async () => {
    const { AWAI } = await import('../src/abilities/awai');
    const saved = { ...AWAI };
    Object.assign(AWAI, { circleChance: 1, cornerKanChance: 1 });
    try {
      const both = ['kasumi', 'awai', 'nodoka', 'saki'].map((id) => CHARACTERS.find((c) => c.id === id)!);
      let checked = 0;
      for (let seed = 1; seed <= 6; seed++) {
        const g = new Game({ seed, players: both.map((c) => ({ name: c.id, ability: c.ability })) });
        g.onEvent((e) => {
          if (e.type !== 'roundStart' || kasumiSuit(g, 0) === null) return;
          expect(shanten(toCounts(g.players[1].hand))).toBe(0);
          checked++;
        });
        let steps = 0;
        while (g.phase !== 'gameEnd' && ++steps < 20000) {
          if (g.phase === 'roundEnd') {
            g.nextRound();
            continue;
          }
          const s = g.waitingSeats()[0];
          g.act(s, chooseAction(g, s, both[s].ai));
        }
      }
      expect(checked).toBeGreaterThan(0);
    } finally {
      Object.assign(AWAI, saved);
    }
  }, 120000);
});
