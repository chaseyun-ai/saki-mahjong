import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { NELLY, nellyAiPlan, nellyBlocked, nellyDeclared, nellyLuck, nellyPlanError, nellySisters, nellySuit } from '../src/abilities/nelly';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { shanten } from '../src/engine/shanten';
import { kindOf, toCounts } from '../src/engine/tiles';

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
  it('运势加起来是 0；电脑挑几局押上（8 局押 3 局、都是宣言局），避开别人能力最强的局；玩家分的照用；流局重打沿用，她和过一次这一局的运势就用完', () => {
    for (const n of [4, 8]) {
      for (let d = 0; d < 4; d++) {
        for (const contested of [[], [n - 2, n - 1], [0, 1, 2, 3]]) {
          const plan = nellyAiPlan(n, d, contested);
          const bet = plan.filter((v) => v > 0);
          expect(nellyPlanError(plan)).toBeNull();
          expect(bet.length).toBe(n === 8 ? 3 : 2);
          expect(plan.filter((v) => v <= 0).every((v) => v === NELLY.min)).toBe(true);
          if (n === 8) expect(bet.every((v) => v >= NELLY.declare)).toBe(true);
          else expect(bet.some((v) => v >= NELLY.declare)).toBe(true);
          // 没被抢的局够押时，没坐庄的抢手局不押
          if (n - contested.length >= bet.length) for (const c of contested) if (c % 4 !== d) expect(plan[c]).toBe(NELLY.min);
        }
      }
    }
    expect(nellyPlanError([1, 0, 0, 0])).not.toBeNull();
    expect(nellyPlanError([NELLY.min - 1, 0, 0, -NELLY.min + 1])).not.toBeNull();
    const mine = [3, -1, -1, -1];
    let spent = 0;
    for (let seed = 1; seed <= 12; seed++) {
      play(
        seed,
        LINEUPS[seed % 4],
        (g, me) => {
          const sisters = () => NELLY.sisters - nellySisters(g, me);
          const won = new Set<number>();
          g.onEvent((e) => {
            if (e.type === 'roundEnd' && e.result.wins.some((w) => w.seat === me)) won.add(label(g));
            if (e.type !== 'roundStart') return;
            // 和过的局（连庄）运势是 0
            if (won.has(label(g))) {
              expect(nellyLuck(g, me)).toBe(0);
              spent++;
              return;
            }
            // 用过七姐妹的局运势被扣掉，所以只会比分的小
            const want = mine[label(g)] ?? 0;
            expect(nellyLuck(g, me)).toBeLessThanOrEqual(want);
            expect(nellyLuck(g, me)).toBeGreaterThanOrEqual(want - sisters());
          });
        },
        { plan: mine },
      );
    }
    expect(spent).toBeGreaterThan(0);
  }, 120000);

  it('七姐妹：只在运势为正的局用，一场最多 7 次，封住的人这一局和不了，顺流的局每用一次运势减 1，宣言局不扣', () => {
    let used = 0;
    for (let seed = 1; seed <= 24; seed++) {
      play(
        seed,
        LINEUPS[seed % 4],
        (g, me) => {
          let before = 0;
          // 每个事件之后记一下运势（第一局的庄家第一次摸牌在 roundStart 之前）
          g.onEvent((e) => {
            if (e.type === 'ability' && e.seat === me && e.text === '七姐妹') {
              used++;
              expect(before).toBeGreaterThan(0);
              expect(nellyLuck(g, me)).toBe(before >= NELLY.declare ? before : before - 1);
              before = nellyLuck(g, me);
              expect(nellySisters(g, me)).toBeGreaterThanOrEqual(0);
            }
            if (e.type === 'roundEnd') for (const w of e.result.wins) expect(nellyBlocked(g, me)).not.toContain(w.seat);
            before = nellyLuck(g, me);
          });
        },
        { format: 'team' },
      );
    }
    expect(used).toBeGreaterThan(2);
  }, 120000);

  it('运势正的局摸牌明显比负的局顺（还没听牌时）', () => {
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
            // 宣言局听牌以后先换花色，不算
            if (before <= 0) return;
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

describe('涅莉的宣言局', () => {
  it('宣言局：配牌偏向一种花色、几乎都能和、和得大；电脑的涅莉不挂运势标志', () => {
    let rounds = 0;
    let wins = 0;
    let big = 0;
    let suitTiles = 0;
    let tiles = 0;
    for (let seed = 1; seed <= 32; seed++) {
      play(
        seed,
        LINEUPS[seed % 4],
        (g, me) => {
          let decl = false;
          g.onEvent((e) => {
            if (e.type === 'roundStart') {
              decl = nellyDeclared(g, me);
              expect(g.abilities[me]!.badge!(g, me)).toBeNull();
              if (!decl) return;
              rounds++;
              const suit = nellySuit(g, me)!;
              const nums = g.players[me].hand.filter((t) => kindOf(t) < 27);
              tiles += nums.length;
              suitTiles += nums.filter((t) => Math.floor(kindOf(t) / 9) === suit).length;
            }
            if (e.type === 'roundEnd' && decl) {
              const w = e.result.wins.find((x) => x.seat === me);
              if (w) {
                wins++;
                if (e.result.deltas[me] >= 16000) big++;
              }
            }
          });
        },
        { format: 'team' },
      );
    }
    expect(rounds).toBeGreaterThan(10);
    expect(suitTiles / tiles).toBeGreaterThan(0.6);
    expect(wins / rounds).toBeGreaterThan(0.4);
    expect(big / wins).toBeGreaterThan(0.6);
  }, 240000);
});
