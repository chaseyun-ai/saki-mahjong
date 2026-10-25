import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { NELLY, nellyAiPlan, nellyBlocked, nellyLuck, nellyPlanError, nellySisters } from '../src/abilities/nelly';
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

// plan：玩家操作她时开场分的运势（不给就是电脑）
function play(seed: number, ids: string[], setup: (g: Game, me: number) => void, opts: { plan?: number[]; format?: 'east' | 'team' } = {}) {
  const seats = ids.map(byId);
  const me = ids.indexOf('nelly');
  const g = new Game({ seed, format: opts.format, players: seats.map((c, i) => ({ name: c.id, ability: c.ability, manual: !!opts.plan && i === me })) });
  setup(g, me);
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 20000) {
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    if (g.phase === 'predeal') {
      const ab = g.abilities[me]!;
      const values = Object.fromEntries(opts.plan!.map((v, i) => [`luck${i}`, v]));
      expect(ab.preDeal!(g, me).length).toBe(opts.plan!.length);
      ab.setPreDeal!(g, me, [], values);
      g.deal();
      continue;
    }
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, seats[s].ai));
  }
  return g;
}

const label = (g: Game) => g.roundWind * 4 + g.roundNumber;

describe('涅莉·薇萨拉兹', () => {
  it('运势加起来是 0；电脑前面负、最后两局正；玩家分的照用，同一局连庄沿用', () => {
    for (const n of [4, 8]) {
      const plan = nellyAiPlan(n);
      expect(plan.reduce((a, b) => a + b, 0)).toBe(0);
      expect(nellyPlanError(plan)).toBeNull();
      expect(plan.at(-1)).toBeGreaterThan(0);
    }
    expect(nellyPlanError([1, 0, 0, 0])).not.toBeNull();
    expect(nellyPlanError([NELLY.min - 1, 0, 0, -NELLY.min + 1])).not.toBeNull();
    const mine = [3, -1, -1, -1];
    for (let seed = 1; seed <= 6; seed++) {
      play(
        seed,
        LINEUPS[seed % 4],
        (g, me) => {
          const sisters = () => NELLY.sisters - nellySisters(g, me);
          g.onEvent((e) => {
            if (e.type !== 'roundStart') return;
            // 用过七姐妹的局运势被扣掉，所以只会比分的小
            const want = mine[label(g)] ?? 0;
            expect(nellyLuck(g, me)).toBeLessThanOrEqual(want);
            expect(nellyLuck(g, me)).toBeGreaterThanOrEqual(want - sisters());
          });
        },
        { plan: mine },
      );
    }
  }, 120000);

  it('七姐妹：只在运势为正的局用，一场最多 7 次，封住的人这一局和不了，每用一次运势减 1', () => {
    let used = 0;
    for (let seed = 1; seed <= 24; seed++) {
      play(
        seed,
        LINEUPS[seed % 4],
        (g, me) => {
          let before = 0;
          g.onEvent((e) => {
            if (e.type === 'roundStart') before = nellyLuck(g, me);
            if (e.type === 'ability' && e.seat === me && e.text === '七姐妹') {
              used++;
              expect(before).toBeGreaterThan(0);
              expect(nellyLuck(g, me)).toBe(before - 1);
              before = nellyLuck(g, me);
              expect(nellySisters(g, me)).toBeGreaterThanOrEqual(0);
            }
            if (e.type === 'roundEnd') for (const w of e.result.wins) expect(nellyBlocked(g, me)).not.toContain(w.seat);
          });
        },
        { format: 'team' },
      );
    }
    expect(used).toBeGreaterThan(2);
  }, 120000);

  it('运势正的局摸牌明显比负的局顺', () => {
    const stat = { up: [0, 0], down: [0, 0] };
    for (let seed = 1; seed <= 20; seed++) {
      play(
        seed,
        LINEUPS[seed % 4],
        (g, me) => {
          g.onEvent((e) => {
            if (e.type !== 'draw' || e.seat !== me || g.rinshanDraw) return;
            const v = nellyLuck(g, me);
            if (!v) return;
            const p = g.players[me];
            const before = shanten(toCounts(p.hand.filter((t) => t !== p.drawn)), p.melds.length);
            const s = v > 0 ? stat.up : stat.down;
            s[0]++;
            if (shanten(toCounts(p.hand), p.melds.length) < before) s[1]++;
          });
        },
        { format: 'team' },
      );
    }
    console.log(stat);
    expect(stat.up[0]).toBeGreaterThan(100);
    expect(stat.up[1] / stat.up[0]).toBeGreaterThan(stat.down[1] / stat.down[0] + 0.1);
  }, 120000);
});
