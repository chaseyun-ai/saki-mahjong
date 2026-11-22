import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AWAI } from '../src/abilities/awai';
import { CHARACTERS } from '../src/abilities/characters';
import { NELLY, NELLY_REMAKE, nellyDue, nellyPool, nellyRemade, nellyRemakePlan, nellyTier } from '../src/abilities/nelly';
import { planBest, planRecipe } from '../src/abilities/nellyRecipe';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { parseTiles, toCounts } from '../src/engine/tiles';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

// 电脑的淡不放主动技能，免得测出来的是淡的效果
beforeAll(() => Object.assign(AWAI, { aiSkills: false }));
afterAll(() => Object.assign(AWAI, { aiSkills: true }));

const LINEUPS = [
  ['nelly', 'saki', 'nodoka', 'hiroe'],
  ['koromo', 'nelly', 'hiroe', 'mihoko'],
  ['toki', 'kasumi', 'nelly', 'teru'],
  ['nodoka', 'mihoko', 'hiroe', 'nelly'],
];

// classic：玩家选了初版（startForm）；plan：照这个排运势（第一局开打以后才放进去，所以从第二局起算）
function play(seed: number, ids: string[], setup: (g: Game, me: number) => void, opts: { classic?: boolean; plan?: number[]; format?: 'east' | 'south' | 'one' } = {}) {
  const seats = ids.map(byId);
  const me = ids.indexOf('nelly');
  const g = new Game({ seed, format: opts.format ?? 'south', players: seats.map((c, i) => ({ name: c.id, ability: c.ability, startForm: !!opts.classic && i === me })) });
  if (opts.plan) (g.abilityGameState[me] as { plan?: number[] }).plan = opts.plan;
  setup(g, me);
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 40000) {
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, seats[s].ai));
  }
  return g;
}

describe('涅莉（重做）', () => {
  it('电脑排运势：一局押 1 点，坐庄的局先，剩下的从最后一局往前，别人最强的局不排；局比点数少只押局数那么多', () => {
    expect(nellyRemakePlan(8, [1, 5])).toEqual([0, 1, 0, 0, 0, 1, 0, 1]);
    expect(nellyRemakePlan(8, [1, 5], [6, 7])).toEqual([0, 1, 0, 0, 1, 1, 0, 0]);
    expect(nellyRemakePlan(4, [2])).toEqual([0, 0, 1, 1].map((v, i) => (i === 1 ? 1 : v)));
    expect(nellyRemakePlan(1, [0])).toEqual([1]);
    expect(nellyRemakePlan(8, [0, 4]).reduce((a, b) => a + b, 0)).toBe(NELLY_REMAKE.total);
  });

  it('开场 3 点；分运势要分完（一局战押 1 到 3 点都行），不能多分；电脑和没选初版的玩家都是重做，选了初版是原来的 10 点', () => {
    const g = new Game({ seed: 3, format: 'south', players: LINEUPS[0].map((id, i) => ({ name: id, ability: byId(id).ability, manual: i === 0 })) });
    const ab = g.abilities[0]!;
    expect(nellyRemade(g, 0)).toBe(true);
    expect(nellyPool(g, 0)).toBe(3);
    const vals = (xs: number[]) => Object.fromEntries(xs.map((v, i) => [`slot${i}`, v]));
    expect(ab.preDealCheck!(g, 0, vals([0, 1, 0, 0, 0, 1, 0, 1]))).toBeNull();
    expect(ab.preDealCheck!(g, 0, vals([0, 0, 0, 0, 0, 3, 0, 0]))).toBeNull();
    expect(ab.preDealCheck!(g, 0, vals([0, 1, 0, 0, 0, 0, 0, 1]))).toBe('还有 1 点没分');
    expect(ab.preDealCheck!(g, 0, vals([1, 1, 0, 0, 0, 1, 0, 1]))).toBe('多分了 1 点');
    const one = new Game({ seed: 3, format: 'one', players: LINEUPS[0].map((id, i) => ({ name: id, ability: byId(id).ability, manual: i === 0 })) });
    expect(ab.preDealCheck!(one, 0, vals([1]))).toBeNull();
    expect(ab.preDealCheck!(one, 0, vals([3]))).toBeNull();
    expect(ab.preDealCheck!(one, 0, vals([0]))).toBe('还有 1 点没分');
    const old = new Game({ seed: 3, format: 'south', players: LINEUPS[0].map((id, i) => ({ name: id, ability: byId(id).ability, manual: i === 0, startForm: i === 0 })) });
    expect(nellyRemade(old, 0)).toBe(false);
    expect(nellyPool(old, 0)).toBe(NELLY.plan!.total);
  });

  it('挑三倍满：役种照配牌换着做，番数（算上宝牌、里宝牌）正好 11–12 番，缺的牌不超过能摸的次数；宝牌里宝牌都用不上时只看一门花色', () => {
    const ask = (s: string, extra: Partial<Parameters<typeof planRecipe>[0]> = {}) => {
      const held = parseTiles(s);
      const have = toCounts(held);
      const all = Array.from({ length: 34 }, (_, k) => k);
      return { have, held, cap: have.map((n) => Math.min(4, n + 2)), budget: 7, seatWind: 28, roundWind: 27, isDealer: false, dora: { free: true, kinds: all }, ura: all, ...extra };
    };
    const seen = new Set<string>();
    for (const s of ['234m567m3p45p78s1z6z', '112m345p66p789s1z2z3z', '22m44m66p88p3s5s7s9s', '111p23p456p789p5z6z7z', '13m579m24p68p13s5z']) {
      const r = planRecipe(ask(s));
      expect(r, s).not.toBeNull();
      expect(r!.missing).toBeLessThanOrEqual(7);
      expect(r!.plan.reduce((a, b) => a + b, 0)).toBe(14);
      expect(r!.han + r!.ura).toBeGreaterThanOrEqual(11);
      expect(r!.han + r!.ura).toBeLessThanOrEqual(12);
      // 最后自摸的那张是缺的牌
      expect(r!.plan[r!.win]).toBeGreaterThan(toCounts(parseTiles(s))[r!.win]);
      seen.add(r!.yaku.join('+'));
    }
    expect(seen.size).toBeGreaterThanOrEqual(4);
    // 玄在场：宝牌、里宝牌都用不上，只能靠役（缺得多也要挑得出来，多出来的换配牌）
    const kuro = planBest(ask('13m579m24p68p13s5z', { dora: { free: false, kinds: [] }, ura: null }), 11);
    expect(kuro).not.toBeNull();
    expect(kuro!.han).toBeGreaterThanOrEqual(11);
    expect(kuro!.ura).toBe(0);
  });

  it('电脑押了 1 点的局：第 7 巡一发自摸三倍满（没被别人先和的局都准时），役种五花八门', () => {
    let bets = 0;
    let onTime = 0;
    let missed = 0;
    const combos = new Set<string>();
    for (let seed = 1; seed <= 16; seed++) {
      play(seed, LINEUPS[seed % 4], (g, me) => {
        g.onEvent((e) => {
          if (e.type !== 'roundEnd' || nellyTier(g, me) <= 0) return;
          bets++;
          expect(nellyTier(g, me)).toBe(1);
          expect(nellyDue(g, me)).toBe(7);
          const w = e.result.wins.find((x) => x.seat === me);
          if (!w || w.from !== null || w.result.limitName !== '三倍满') {
            if (!e.result.wins.some((x) => x.seat !== me)) missed++;
            return;
          }
          if (g.players[me].discards.length + 1 === 7) onTime++;
          else missed++;
          expect(w.result.yaku.map((y) => y.name)).toContain('立直');
          combos.add(w.result.yaku.map((y) => y.name).filter((n) => !['立直', '一发', '门前清自摸和'].includes(n)).join('+'));
        });
      });
    }
    console.log(`重做押 1 点：${bets} 局，第 7 巡自摸三倍满 ${onTime} 局，没被先和却没准时 ${missed} 局，役种组合 ${combos.size} 种：${[...combos].join('，')}`);
    expect(bets).toBeGreaterThan(20);
    expect(missed).toBeLessThanOrEqual(1);
    expect(onTime / bets).toBeGreaterThan(0.85);
    expect(combos.size).toBeGreaterThan(8);
  }, 240000);

  it('同一局叠着押：2 点第 13 巡、3 点到她最后一次摸牌自摸三倍满（拖得越久越容易被别人先和，没被别人先和的都准时），七姐妹押几点封几家', () => {
    const late: Record<number, { bets: number; onTime: number }> = { 2: { bets: 0, onTime: 0 }, 3: { bets: 0, onTime: 0 } };
    // 没被别人先和、却没准时自摸三倍满的局
    let missed = 0;
    for (let seed = 1; seed <= 16; seed++) {
      play(
        seed,
        LINEUPS[seed % 4],
        (g, me) => {
          let sealed = 0;
          g.onEvent((e) => {
            if (e.type === 'roundStart') sealed = 0;
            if (e.type === 'ability' && e.seat === me && e.text === '七姐妹' && e.target === undefined) sealed++;
            if (e.type !== 'roundEnd') return;
            const bet = nellyTier(g, me);
            if (bet < 2) return;
            expect(sealed).toBeLessThanOrEqual(bet);
            expect(nellyDue(g, me)).toBe(bet === 2 ? 13 : 19);
            late[bet].bets++;
            const w = e.result.wins.find((x) => x.seat === me);
            const turn = g.players[me].discards.length + 1;
            if (w && w.from === null && w.result.limitName === '三倍满' && (bet === 2 ? turn === 13 : g.wall.remaining < 4)) late[bet].onTime++;
            else if (!e.result.wins.some((x) => x.seat !== me)) missed++;
          });
        },
        { plan: [0, 2, 0, 0, 3, 0, 0, 0] },
      );
    }
    console.log(`叠着押：2 点 ${late[2].bets} 局准时 ${late[2].onTime}，3 点 ${late[3].bets} 局准时 ${late[3].onTime}，没被先和却没做成 ${missed} 局`);
    expect(missed).toBeLessThanOrEqual(1);
    // 这几组对手里有照、衣、和：拖到第 13 巡、最后一次摸牌，常被他们先和
    expect(late[2].onTime / late[2].bets).toBeGreaterThan(0.45);
    expect(late[3].onTime / late[3].bets).toBeGreaterThan(0.25);
  }, 240000);
});
