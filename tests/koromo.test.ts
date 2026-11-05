import { describe, expect, it } from 'vitest';
import { CHARACTERS, baseAi, type AiStyle } from '../src/abilities/characters';
import { KOROMO, KOROMO_READERS, koromoAbility, koromoDisruptor, koromoHaiteiTile, koromoMoon, koromoResist, koromoRouteOn } from '../src/abilities/koromo';
import type { Ability } from '../src/abilities/types';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { shanten } from '../src/engine/shanten';
import { kindOf, toCounts } from '../src/engine/tiles';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;
const koromo = byId('koromo');

interface Seat {
  id: string;
  ability: Ability | null;
  ai: AiStyle;
}
const plain: Seat = { id: 'none', ability: null, ai: baseAi };

// 衣和三家没能力的电脑打一个半庄（座位随种子转）
function play(seed: number, setup: (g: Game, me: number) => void, me: Seat = koromo, others: Seat[] = [plain, plain, plain]) {
  const seats = [me, ...others];
  const order = [0, 1, 2, 3].map((i) => seats[(i + seed) % 4]);
  const g = new Game({ seed, format: 'east', players: order.map((c) => ({ name: c.id, ability: c.ability })) });
  const mine = order.indexOf(me);
  setup(g, mine);
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 20000) {
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, order[s].ai));
  }
}

const fullMoon = (g: Game, me: number) => ((g.abilityGameState[me] as { moon?: number }).moon = 4);

describe('天江衣', () => {
  it('月相整场不变；月相只管挡别人的干扰：满月 60%，新月 15%，霞和玄挡不住', () => {
    for (let seed = 1; seed <= 3; seed++) {
      play(seed, (g, me) => {
        const moon = koromoMoon(g, me);
        expect(moon).not.toBeNull();
        g.onEvent((e) => {
          if (e.type === 'roundStart') expect(koromoMoon(g, me)).toBe(moon);
        });
      });
    }
    const g = new Game({ seed: 1, players: ['koromo', 'kasumi', 'kuro', 'teru'].map((id) => ({ name: id, ability: byId(id).ability })) });
    const gs = g.abilityGameState[0] as { moon?: number };
    gs.moon = 4;
    expect(koromoResist(g, 0)).toBeCloseTo(0.6);
    expect(koromoAbility.resist!(g, 0, 3)).toBeCloseTo(0.6);
    expect(koromoAbility.resist!(g, 0, 1)).toBe(0);
    expect(koromoAbility.resist!(g, 0, 2)).toBe(0);
    gs.moon = 0;
    expect(koromoResist(g, 0)).toBeCloseTo(0.15);
  });

  it('海底捞月：配完牌海底归她才发动；海底牌只给她看，没人打乱、她听着它时，最后一张就是她的和了牌', () => {
    let deals = 0;
    let haitei = 0;
    for (let seed = 1; seed <= 30; seed++) {
      play(seed, (g, me) => {
        fullMoon(g, me);
        g.onEvent((e) => {
          if (e.type === 'ability' && e.seat === me && e.text === '海底捞月') {
            deals++;
            // 没人鸣牌的话最后一张归她，牌山最后一张就是那张海底牌
            expect((g.dealer + g.wall.live.length - 1) % 4).toBe(me);
            expect(g.wall.live.at(-1)).toBe(koromoHaiteiTile(g, me));
            expect(koromoRouteOn(g, me)).toBe(true);
            expect(koromoAbility.skill!(g, me)!.note).toContain('海底是');
          }
          if (e.type !== 'draw' || e.seat !== me || g.wall.remaining !== 0 || g.rinshanDraw) return;
          const p = g.players[me];
          if (koromoRouteOn(g, me) && p.drawn === koromoHaiteiTile(g, me) && g.waits(me).length === 0) {
            const before = p.hand.filter((t) => t !== p.drawn);
            if (shanten(toCounts(before), p.melds.length) === 0) {
              haitei++;
              expect(g.legalActions(me).some((a) => a.type === 'tsumo')).toBe(true);
            }
          }
        });
      });
    }
    console.log({ deals, haitei });
    expect(deals).toBeGreaterThan(3);
    expect(haitei).toBeGreaterThan(0);
  }, 120000);

  it('海底路线上：别家一向听、两向听摸不到进张，听了牌的不能自摸；不在路线上没有地狱', () => {
    let checked = 0;
    let leaks = 0;
    let off = 0;
    let offLeaks = 0;
    let tsumoChecks = 0;
    for (let seed = 1; seed <= 16; seed++) {
      play(seed, (g, me) => {
        fullMoon(g, me);
        g.onEvent((e) => {
          if (e.type !== 'draw' || e.seat === me || g.rinshanDraw) return;
          const p = g.players[e.seat];
          if (koromoRouteOn(g, me) && g.legalActions(e.seat).length) {
            tsumoChecks++;
            expect(g.legalActions(e.seat).some((a) => a.type === 'tsumo')).toBe(false);
          }
          const before = shanten(toCounts(p.hand.filter((t) => t !== p.drawn)), p.melds.length);
          if (before < 1 || before > 2) return;
          const better = shanten(toCounts(p.hand), p.melds.length) < before;
          if (koromoRouteOn(g, me)) {
            checked++;
            if (better) leaks++;
          } else {
            off++;
            if (better) offLeaks++;
          }
        });
      });
    }
    console.log({ checked, leaks, off, offLeaks, tsumoChecks });
    expect(checked).toBeGreaterThan(50);
    expect(leaks).toBeLessThan(checked * 0.05);
    expect(offLeaks).toBeGreaterThan(off * 0.15);
  }, 120000);

  it('海底路线上她立直以后，谁打的牌都鸣不了', () => {
    let frozen = 0;
    for (let seed = 1; seed <= 24; seed++) {
      play(seed, (g, me) => {
        fullMoon(g, me);
        g.onEvent((e) => {
          if (e.type !== 'discard' || !koromoRouteOn(g, me) || !(g.players[me].riichi || g.players[me].riichiPending)) return;
          frozen++;
          for (const acts of g.pending.values()) expect(acts.every((a) => a.type === 'ron' || a.type === 'pass')).toBe(true);
        });
      });
    }
    console.log({ frozen });
    expect(frozen).toBeGreaterThan(0);
  }, 120000);

  it('电脑的衣：海底路线上先默听，牌山剩 4 张时才立直', () => {
    let riichi = 0;
    for (let seed = 1; seed <= 24; seed++) {
      play(seed, (g, me) => {
        fullMoon(g, me);
        g.onEvent((e) => {
          if (e.type !== 'discard' || e.seat !== me || !e.riichi || !koromoRouteOn(g, me)) return;
          riichi++;
          expect(g.wall.remaining).toBeLessThanOrEqual(KOROMO.riichiAt);
        });
      });
    }
    console.log('海底路线上立直', riichi);
    expect(riichi).toBeGreaterThan(0);
  }, 120000);

  it('海底挪移：一向听以内鸣牌听牌、最后一张轮到她时，海底换成她的和了牌', () => {
    let moved = 0;
    for (let seed = 1; seed <= 24; seed++) {
      play(seed, (g, me) => {
        fullMoon(g, me);
        g.onEvent((e) => {
          if (e.type !== 'ability' || e.seat !== me || e.text !== '海底挪移') return;
          moved++;
          expect(g.players[me].melds.some((m) => m.type === 'chi' || m.type === 'pon')).toBe(true);
          const t = koromoHaiteiTile(g, me)!;
          expect(g.wall.live.at(-1)).toBe(t);
          expect(g.waits(me)).toContain(kindOf(t));
          expect(koromoRouteOn(g, me)).toBe(true);
        });
      });
    }
    console.log({ moved });
    expect(moved).toBeGreaterThan(0);
  }, 120000);

  it('潮起潮落：不在海底路线上、她还没听牌时，大约 15% 的摸牌换成进张', () => {
    let eligible = 0;
    let tide = 0;
    const spy: Ability = {
      ...koromoAbility,
      beforeAnyDraw(g, seat, drawer, rinshan) {
        const pre = !rinshan && drawer === seat && !koromoRouteOn(g, seat) && shanten(toCounts(g.players[seat].hand), g.players[seat].melds.length) >= 1;
        const r = koromoAbility.beforeAnyDraw!(g, seat, drawer, rinshan);
        if (pre && !koromoRouteOn(g, seat)) {
          eligible++;
          if (r?.text === '潮起潮落') tide++;
        }
        return r;
      },
    };
    for (let seed = 1; seed <= 12; seed++) play(seed, () => {}, { ...koromo, ability: spy });
    console.log({ eligible, tide, rate: tide / eligible });
    expect(eligible).toBeGreaterThan(300);
    expect(tide / eligible).toBeGreaterThan(0.1);
    expect(tide / eligible).toBeLessThan(0.2);
  }, 120000);

  it('别家电脑：咲、久、真子、美穗子每局都会去错开她的海底，别人大约三成', () => {
    let readers = 0;
    let others = 0;
    const N = 400;
    for (let i = 0; i < N; i++) {
      const g = new Game({ seed: i + 1, players: ['koromo', 'saki', 'nodoka', 'kuro'].map((id) => ({ name: id, ability: byId(id).ability })) });
      if (koromoDisruptor(g, 0, 1, true)) readers++;
      if (koromoDisruptor(g, 0, 2, false)) others++;
      // 同一局再问一次答案不变
      expect(koromoDisruptor(g, 0, 2, false)).toBe(koromoDisruptor(g, 0, 2, false));
    }
    expect(readers).toBe(N);
    expect(others / N).toBeGreaterThan(0.22);
    expect(others / N).toBeLessThan(0.38);
    expect(KOROMO_READERS).toContain('saki');
  });
});
