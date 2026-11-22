import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AWAI } from '../src/abilities/awai';
import { CHARACTERS } from '../src/abilities/characters';
import { NELLY, NELLY_REMAKE, nellyTier } from '../src/abilities/nelly';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

const LINEUPS = [
  ['nelly', 'saki', 'nodoka', 'kuro'],
  ['koromo', 'nelly', 'hiroe', 'awai'],
  ['toki', 'kasumi', 'nelly', 'teru'],
  ['nodoka', 'mihoko', 'hiroe', 'nelly'],
];

// 涅莉押 3 点的开杠路线（试验，初版涅莉）：每一局都走开杠路线，玩家每局押 3 点
const saved = { plan: NELLY.plan, charge: NELLY.charge, kanRoute: NELLY.kanRoute };
beforeAll(() => {
  Object.assign(AWAI, { aiSkills: false });
  NELLY.plan = null;
  NELLY.charge = null;
  NELLY.kanRoute = 1;
  NELLY_REMAKE.on = false;
});
afterAll(() => {
  Object.assign(AWAI, { aiSkills: true });
  Object.assign(NELLY, saved);
  NELLY_REMAKE.on = true;
});

describe('涅莉：开杠路线', () => {
  it('押 3 点立直以后摸到暗刻的第四张开暗杠，岭上牌自摸三倍满（不冲累计役满）；杠了不改听牌', () => {
    let rinshan = 0;
    let kans = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const ids = LINEUPS[seed % 4];
      const seats = ids.map(byId);
      const me = ids.indexOf('nelly');
      const g = new Game({ seed, format: 'team', players: seats.map((c, i) => ({ name: c.id, ability: c.ability, manual: i === me })) });
      g.onEvent((e) => {
        if (e.type !== 'roundEnd' || nellyTier(g, me) < 3) return;
        const p = g.players[me];
        if (!p.melds.some((m) => m.type === 'ankan')) return;
        kans++;
        for (const w of e.result.wins) {
          if (w.seat !== me || !w.result.yaku.some((y) => y.name === '岭上开花')) continue;
          rinshan++;
          expect(p.riichi).toBe(true);
          expect(w.result.yakuman).toBe(0);
          expect(w.result.han).toBeLessThanOrEqual(NELLY.maxHan);
        }
      });
      let steps = 0;
      while (g.phase !== 'gameEnd' && ++steps < 20000) {
        if (g.phase === 'roundEnd') {
          g.nextRound();
          continue;
        }
        if (g.phase === 'predeal') {
          const ab = g.abilities[me]!;
          const opt = ab.preDeal!(g, me).find((o) => o.id === 'luck3' && o.enabled);
          ab.setPreDeal!(g, me, opt ? [opt.id] : []);
          g.deal();
          continue;
        }
        const s = g.waitingSeats()[0];
        g.act(s, chooseAction(g, s, seats[s].ai));
      }
    }
    console.log(`开杠路线：杠了 ${kans} 局，岭上开花 ${rinshan} 局`);
    expect(kans).toBeGreaterThan(0);
    // 杠了的局多半岭上开花
    expect(rinshan / kans).toBeGreaterThan(0.5);
  }, 240000);
});
