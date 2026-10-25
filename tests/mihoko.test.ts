import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { MIHOKO, mihokoEnergy, mihokoEyeOpen } from '../src/abilities/mihoko';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

const LINEUPS = [
  ['mihoko', 'saki', 'nodoka', 'kuro'],
  ['koromo', 'mihoko', 'hiroe', 'awai'],
  ['toki', 'kasumi', 'mihoko', 'teru'],
  ['nodoka', 'saki', 'hiroe', 'mihoko'],
];

function play(seed: number, ids: string[], setup: (g: Game, me: number) => void, manual = false) {
  const seats = ids.map(byId);
  const me = ids.indexOf('mihoko');
  const g = new Game({ seed, players: seats.map((c, i) => ({ name: c.id, ability: c.ability, manual: manual && i === me })) });
  setup(g, me);
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 20000) {
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    if (g.phase === 'predeal') {
      // 玩家：体力够就每局都睁眼
      g.abilities[me]!.setPreDeal!(g, me, ['eye']);
      g.deal();
      continue;
    }
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, seats[s].ai));
  }
  return g;
}

describe('福路美穗子', () => {
  it('睁眼花体力、每局回一点，体力不够睁不开；玩家选了才睁', () => {
    for (let seed = 1; seed <= 6; seed++) {
      let opened = 0;
      let before = MIHOKO.energyMax;
      play(
        seed,
        LINEUPS[seed % 4],
        (g, me) => {
          g.onEvent((e) => {
            // 一局结束就回体力
            if (e.type === 'roundEnd') before = mihokoEnergy(g, me);
            if (e.type !== 'roundStart') return;
            const open = mihokoEyeOpen(g, me);
            if (open) opened++;
            expect(mihokoEnergy(g, me)).toBe(open ? before - MIHOKO.eyeCost : before);
            if (before < MIHOKO.eyeCost) expect(open).toBe(false);
            // 玩家每局都选了睁眼：体力够就一定睁
            else expect(open).toBe(true);
          });
        },
        true,
      );
      expect(opened).toBeGreaterThan(0);
    }
  }, 120000);

  it('电脑的美穗子睁眼时只会故意放铳：放给闲家、而且很便宜', () => {
    let openDealIns = 0;
    let openRounds = 0;
    for (let seed = 1; seed <= 40; seed++) {
      play(seed, LINEUPS[seed % 4], (g, me) => {
        let open = false;
        g.onEvent((e) => {
          if (e.type === 'roundStart') {
            open = mihokoEyeOpen(g, me);
            if (open) openRounds++;
          }
          if (e.type !== 'roundEnd' || !open || g.players[me].riichi) return;
          for (const w of e.result.wins) {
            if (w.from !== me) continue;
            openDealIns++;
            expect(w.seat).not.toBe(g.dealer);
            expect(w.result.ron).toBeLessThanOrEqual(MIHOKO.feedMax);
          }
        });
      });
    }
    expect(openRounds).toBeGreaterThan(100);
    console.log({ openRounds, openDealIns });
  }, 120000);
});
