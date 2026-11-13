import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AWAI } from '../src/abilities/awai';
import { CHARACTERS } from '../src/abilities/characters';
import { NELLY, nellyAiBet, nellyAiCharge, nellyAiPlan, nellyBlocked, nellyPool, nellySenses, nellySensesTenpai, nellySisters, nellyTier } from '../src/abilities/nelly';
import { teruWinValue } from '../src/abilities/teru';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { shanten } from '../src/engine/shanten';
import { toCounts } from '../src/engine/tiles';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

// 电脑的淡不放主动技能，免得测出来的是淡的效果
beforeAll(() => Object.assign(AWAI, { aiSkills: false }));
afterAll(() => Object.assign(AWAI, { aiSkills: true }));

const LINEUPS = [
  ['nelly', 'saki', 'nodoka', 'kuro'],
  ['koromo', 'nelly', 'hiroe', 'awai'],
  ['toki', 'kasumi', 'nelly', 'teru'],
  ['nodoka', 'mihoko', 'hiroe', 'nelly'],
];

// pick：玩家操作她时每一局发牌前押几点（不给就是电脑）
function play(seed: number, ids: string[], setup: (g: Game, me: number) => void, opts: { pick?: number; format?: 'east' | 'team' } = {}) {
  const seats = ids.map(byId);
  const me = ids.indexOf('nelly');
  const manual = opts.pick !== undefined;
  const g = new Game({ seed, format: opts.format, players: seats.map((c, i) => ({ name: c.id, ability: c.ability, manual: manual && i === me })) });
  setup(g, me);
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 20000) {
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    if (g.phase === 'predeal') {
      const ab = g.abilities[me]!;
      const opt = ab.preDeal!(g, me).find((o) => o.id === `luck${opts.pick}` && o.enabled);
      ab.setPreDeal!(g, me, opt ? [opt.id] : []);
      g.deal();
      continue;
    }
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, seats[s].ai));
  }
  return g;
}

// 这一组测押了以后的打法、七姐妹，用原来的运势池（开场一大笔，NELLY.plan、NELLY.charge 都是 null），每一局都押得出去；
// 攒运势、开局排运势在后面各一组
const PLAN = NELLY.plan;
const CHARGE = NELLY.charge;

describe('涅莉·薇萨拉兹', () => {
  beforeAll(() => {
    NELLY.plan = null;
    NELLY.charge = null;
  });
  afterAll(() => {
    NELLY.plan = PLAN;
    NELLY.charge = CHARGE;
  });

  it('电脑押运势：坐庄押 3 点，后面坐庄的局留着，多出来的 3 点落后或快结束时押，零头最后押光', () => {
    const spot = { pool: 10, plan: 11, left: 8, dealer: false, dealersLeft: 2, contested: false, behind: false };
    expect(nellyAiBet({ ...spot, dealer: true })).toBe(3);
    // 平时不押 1 点：留给坐庄的局
    expect(nellyAiBet(spot)).toBe(0);
    expect(nellyAiBet({ ...spot, behind: true })).toBe(3);
    expect(nellyAiBet({ ...spot, behind: true, contested: true })).toBe(0);
    // 快结束了，多出来的 3 点押掉
    expect(nellyAiBet({ ...spot, pool: 4, plan: 4, left: 2, dealersLeft: 0 })).toBe(3);
    // 最后一局押光
    expect(nellyAiBet({ ...spot, pool: 1, plan: 1, left: 1, dealersLeft: 0 })).toBe(1);
    expect(nellyAiBet({ ...spot, pool: 5, plan: 5, left: 1, dealersLeft: 0 })).toBe(3);
    expect(nellyAiBet({ ...spot, pool: 0, plan: 0, dealer: true })).toBe(0);
    for (let pool = 0; pool <= 12; pool++)
      for (let left = 1; left <= 8; left++)
        for (const dealer of [false, true]) expect(nellyAiBet({ ...spot, pool, plan: pool + 1, left, dealer, dealersLeft: Math.min(2, left - 1) })).toBeLessThanOrEqual(Math.min(3, pool));
  });

  it('电脑一场下来押的多半是 3 点，不会每局押 1 点', () => {
    const count = [0, 0, 0, 0];
    for (let seed = 1; seed <= 8; seed++) {
      play(seed, LINEUPS[seed % 4], (g, me) => {
        g.onEvent((e) => {
          if (e.type === 'roundStart') count[nellyTier(g, me)]++;
        });
      });
    }
    console.log(`电脑押运势：不押 ${count[0]} 局，1 点 ${count[1]}，2 点 ${count[2]}，3 点 ${count[3]}`);
    expect(count[3]).toBeGreaterThan(count[1] + count[2]);
    expect(count[1]).toBeLessThan(count[3] / 2);
  }, 120000);

  it('运势开场 10 点、每 4 局恢复 1 点，押了就扣；玩家押的照用、不够就押不了；有运势才看得出谁听牌', () => {
    for (const pick of [undefined, 2, 3]) {
      for (let seed = 1; seed <= 6; seed++) {
        play(
          seed,
          LINEUPS[seed % 4],
          (g, me) => {
            // 第一局在 setup 之前就开始了
            let spent = NELLY.start - nellyPool(g, me);
            g.onEvent((e) => {
              if (e.type !== 'roundStart') return;
              const before = NELLY.start + Math.floor((g.round - 1) / NELLY.every) - spent;
              const bet = nellyTier(g, me);
              spent += bet;
              expect(bet).toBeLessThanOrEqual(Math.min(NELLY.maxBet, before));
              if (pick !== undefined) expect(bet).toBe(pick <= before ? pick : 0);
              expect(nellyPool(g, me)).toBe(before - bet);
              expect(nellyPool(g, me)).toBeGreaterThanOrEqual(0);
              expect(nellySenses(g, me)).toBe(before - bet > 0);
              // 押了 3 点的局别人的能力管不到她
              expect(g.isImmune(me)).toBe(bet >= 3);
              // 押了几点只有她自己知道：电脑的涅莉不挂标志
              if (pick === undefined) expect(g.abilities[me]!.badge!(g, me)).toBeNull();
            });
          },
          { pick, format: 'team' },
        );
      }
    }
  }, 240000);

  it('七姐妹：押了运势的局自动开着，听牌的人用掉一次上软封印，押几点最多封几家；被封的人摸不到和了牌（自摸不了），荣和照样可以', () => {
    let used = 0;
    let swapped = 0;
    let rons = 0;
    for (let seed = 1; seed <= 16; seed++) {
      play(
        seed,
        LINEUPS[seed % 4],
        (g, me) => {
          g.onEvent((e) => {
            if (e.type === 'ability' && e.seat === me && e.text === '七姐妹') {
              expect(nellyTier(g, me)).toBeGreaterThan(0);
              if (e.target === undefined) {
                // 封人：放切入
                used++;
                const victim = nellyBlocked(g, me).at(-1)!;
                expect(nellyBlocked(g, me).length).toBeLessThanOrEqual(nellyTier(g, me));
                expect(nellySensesTenpai(g, victim)).toBe(true);
                expect(nellySisters(g, me)).toBeGreaterThanOrEqual(0);
              } else {
                // 换走被封的人要摸的和了牌（不放切入）
                swapped++;
                expect(nellyBlocked(g, me)).toContain(e.target);
              }
            }
            if (e.type === 'roundEnd') {
              for (const w of e.result.wins) {
                if (!nellyBlocked(g, me).includes(w.seat)) continue;
                expect(w.from).not.toBeNull();
                rons++;
              }
            }
          });
        },
        { format: 'team' },
      );
    }
    expect(used).toBeGreaterThan(5);
    expect(swapped).toBeGreaterThan(0);
    // 软封印：打出来的照样能荣和
    expect(rons).toBeGreaterThan(0);
  }, 120000);

  it('七姐妹一场 7 次、不恢复', () => {
    for (let seed = 1; seed <= 4; seed++) {
      play(
        seed,
        LINEUPS[seed % 4],
        (g, me) => {
          let last = NELLY.sisters;
          g.onEvent(() => {
            const n = nellySisters(g, me);
            expect(n).toBeLessThanOrEqual(last);
            expect(n).toBeGreaterThanOrEqual(0);
            last = n;
          });
        },
        { pick: 3, format: 'team' },
      );
    }
  }, 120000);

  it('押了运势：配牌照常发，到那一巡左右才和（3 点 8 巡、2 点 12 巡、1 点 15 巡），档越高和得越大，3 点大多和出三倍满', () => {
    const stat = [0, 1, 2, 3].map(() => ({ rounds: 0, wins: 0, value: 0, big: 0, early: 0, turns: 0, sh: 0, over: 0 }));
    for (let seed = 1; seed <= 24; seed++) {
      for (const pick of [1, 2, 3]) {
        play(
          seed,
          LINEUPS[seed % 4],
          (g, me) => {
            let v = 0;
            g.onEvent((e) => {
              if (e.type === 'roundStart') {
                v = nellyTier(g, me);
                const s = stat[v];
                s.rounds++;
                const p = g.players[me];
                s.sh += shanten(toCounts(p.hand.slice(0, 13)), 0);
              }
              const win = e.type === 'roundEnd' ? e.result.wins.find((w) => w.seat === me) : undefined;
              if (win) {
                const s = stat[v];
                const target = NELLY.target[v] * (me === g.dealer ? 1.5 : 1);
                const turn = g.players[me].discards.length + 1;
                const value = teruWinValue(win.result, win.from === null, me === g.dealer);
                s.wins++;
                s.turns += turn;
                s.value += value;
                // 牌山快摸完了（有什么和什么）不算提早
                if (v && turn < NELLY.turn[v] - 1 && g.wall.remaining > NELLY.late) s.early++;
                if (v && value >= target) s.big++;
                // 押 3 点：不冲累计役满（超过 12 番）
                if (v === 3 && (win.result.yakuman > 0 || win.result.han > NELLY.maxHan)) s.over++;
              }
            });
          },
          { pick, format: 'team' },
        );
      }
    }
    const avg = (a: number, b: number) => a / Math.max(1, b);
    console.log(stat.map((s, i) => `${i}: ${s.rounds} 局 和${s.wins} 平均${Math.round(avg(s.value, s.wins))} 够大${s.big} 平均第${avg(s.turns, s.wins).toFixed(1)}巡 提早${s.early} 配牌向听${avg(s.sh, s.rounds).toFixed(2)} 超过12番${s.over}`));
    for (const v of [1, 2, 3]) {
      expect(stat[v].rounds).toBeGreaterThan(20);
      // 配牌照常发：向听数和没押的局差不多
      expect(Math.abs(avg(stat[v].sh, stat[v].rounds) - avg(stat[0].sh, stat[0].rounds))).toBeLessThan(0.5);
      // 装装样子：几乎不会提早和
      expect(stat[v].early / Math.max(1, stat[v].wins)).toBeLessThan(0.1);
    }
    expect(stat[3].wins / stat[3].rounds).toBeGreaterThan(0.6);
    // 七姐妹是软封印（被封的人荣和照样可以，别家互相点炮也会把这一局提前结束），大多和出三倍满但不到七成
    expect(stat[3].big / stat[3].rounds).toBeGreaterThan(0.5);
    expect(stat[3].over / Math.max(1, stat[3].big)).toBeLessThan(0.1);
    expect(avg(stat[3].turns, stat[3].wins)).toBeLessThan(avg(stat[2].turns, stat[2].wins));
    expect(avg(stat[2].turns, stat[2].wins)).toBeLessThan(avg(stat[1].turns, stat[1].wins));
    expect(avg(stat[3].value, stat[3].wins)).toBeGreaterThan(avg(stat[2].value, stat[2].wins));
    expect(avg(stat[2].value, stat[2].wins)).toBeGreaterThan(avg(stat[1].value, stat[1].wins));
  }, 780000);

  it('玄在场（宝牌、里宝牌都动不了）押 3 点也有一半左右和出三倍满（做清一色）', () => {
    const KURO = [
      ['nelly', 'kuro', 'nodoka', 'saki'],
      ['kuro', 'nelly', 'hiroe', 'awai'],
      ['toki', 'kuro', 'nelly', 'teru'],
      ['kuro', 'mihoko', 'koromo', 'nelly'],
    ];
    let rounds = 0;
    let big = 0;
    let over = 0;
    for (let seed = 1; seed <= 16; seed++) {
      play(
        seed,
        KURO[seed % 4],
        (g, me) => {
          let v = 0;
          g.onEvent((e) => {
            if (e.type === 'roundStart') {
              v = nellyTier(g, me);
              if (v === 3) rounds++;
            }
            if (e.type !== 'roundEnd' || v !== 3) return;
            const win = e.result.wins.find((w) => w.seat === me);
            if (win && teruWinValue(win.result, win.from === null, me === g.dealer) >= NELLY.target[3] * (me === g.dealer ? 1.5 : 1)) big++;
            if (win && (win.result.yakuman > 0 || win.result.han > NELLY.maxHan)) over++;
          });
        },
        { pick: 3, format: 'team' },
      );
    }
    console.log(`玄在场：押 3 点 ${rounds} 局，三倍满 ${big} 局，超过 12 番 ${over} 局`);
    expect(rounds).toBeGreaterThan(20);
    // 玄的能力还在时连里宝牌也中不了，清一色只能靠七对子、一气通贯、断幺九加一盃口凑番；七姐妹是软封印，别家照样能荣和，三四成
    expect(big / rounds).toBeGreaterThan(0.3);
  }, 600000);
});

describe('涅莉：攒运势', () => {
  beforeAll(() => {
    NELLY.plan = null;
  });
  afterAll(() => {
    NELLY.plan = PLAN;
  });

  it('开场 0 点，没押的局打完攒 1 点、最多 6 点，押了就扣；攒够了才押得出去，有运势才看得出谁听牌', () => {
    const c = NELLY.charge!;
    expect(c).toEqual({ start: 0, gain: 1, cap: 6 });
    let bets = 0;
    for (const pick of [undefined, 1, 3]) {
      for (let seed = 1; seed <= 4; seed++) {
        play(
          seed,
          LINEUPS[seed % 4],
          (g, me) => {
            let pool = c.start;
            const check = () => {
              const bet = nellyTier(g, me);
              expect(bet).toBeLessThanOrEqual(Math.min(NELLY.maxBet, pool));
              if (pick !== undefined) expect(bet).toBe(pick <= pool ? pick : 0);
              expect(nellyPool(g, me)).toBe(pool - bet);
              expect(nellySenses(g, me)).toBe(pool - bet > 0);
              expect(g.isImmune(me)).toBe(bet >= 3);
              if (bet > 0) bets++;
              return bet;
            };
            // 电脑的局第一局在 setup 之前就开始了；玩家的局还停在发牌前
            let bet: number | null = g.phase !== 'predeal' && g.round >= 1 ? check() : null;
            // 开场没有运势，第一局押不了
            if (bet !== null) expect(bet).toBe(0);
            g.onEvent((e) => {
              if (e.type !== 'roundStart') return;
              if (bet !== null) pool = bet > 0 ? pool - bet : Math.min(c.cap, pool + c.gain);
              bet = check();
              if (g.round === 1) expect(bet).toBe(0);
            });
          },
          { pick, format: 'team' },
        );
      }
    }
    expect(bets).toBeGreaterThan(10);
  }, 120000);

  it('电脑把剩下的局怎么押都算一遍：攒够 3 点等自己坐庄的局押，别人能力最强的局不押，最后一局押光', () => {
    const r = (n: number, dealers: number[] = [], hot: number[] = []) => Array.from({ length: n }, (_, i) => ({ dealer: dealers.includes(i), contested: hot.includes(i) }));
    expect(nellyAiCharge(0, r(8))).toBe(0);
    // 最后一局押光
    expect(nellyAiCharge(3, r(1))).toBe(3);
    expect(nellyAiCharge(2, r(1))).toBe(2);
    expect(nellyAiCharge(6, r(2))).toBe(3);
    // 攒够 3 点：这一局坐庄就押；下一局才坐庄就留给那一局
    expect(nellyAiCharge(3, r(4, [0]))).toBe(3);
    expect(nellyAiCharge(3, r(4, [1]))).toBe(0);
    // 别人能力最强的局不押
    expect(nellyAiCharge(3, r(3, [], [0]))).toBe(0);
    for (let pool = 0; pool <= 6; pool++) for (let n = 1; n <= 8; n++) for (const d of [[], [0], [2]]) expect(nellyAiCharge(pool, r(n, d))).toBeLessThanOrEqual(Math.min(3, pool));
  });

  it('电脑前面忍着：前三局押不出三倍满，三倍满出在第四局以后', () => {
    let big = 0;
    let quiet = 0;
    for (let seed = 1; seed <= 8; seed++) {
      play(seed, LINEUPS[seed % 4], (g, me) => {
        g.onEvent((e) => {
          if (e.type !== 'roundStart') return;
          const bet = nellyTier(g, me);
          if (g.round <= 3) expect(bet).toBeLessThan(3);
          if (bet >= 3) big++;
          if (bet === 0) quiet++;
        });
      });
    }
    console.log(`攒运势：电脑押 3 点 ${big} 局，没押 ${quiet} 局`);
    expect(big).toBeGreaterThan(3);
    expect(quiet).toBeGreaterThan(big * 2);
  }, 120000);
});

describe('涅莉：开局排运势', () => {
  const sum = (a: number[]) => a.reduce((n, v) => n + v, 0);

  it('电脑的排法：坐庄的局排 3 点，剩下的从最后一局往前排，别人能力最强的局不排，加起来 10 点', () => {
    expect(NELLY.plan).toEqual({ total: 10 });
    expect(nellyAiPlan(8, [1, 5])).toEqual([0, 3, 0, 0, 0, 3, 1, 3]);
    expect(nellyAiPlan(8, [3, 7])).toEqual([0, 0, 0, 3, 0, 1, 3, 3]);
    expect(nellyAiPlan(4, [0])).toEqual([3, 1, 3, 3]);
    // 优希的东场、最后一局不排
    expect(nellyAiPlan(8, [0, 4], [0, 1, 2, 3, 7])).toEqual([0, 0, 0, 0, 3, 3, 3, 1]);
    // 一局战只有一局：排满 3 点
    expect(nellyAiPlan(1, [0])).toEqual([3]);
    for (const slots of [4, 8]) for (let d = 0; d < 4; d++) expect(sum(nellyAiPlan(slots, slots === 8 ? [d, d + 4] : [d]))).toBe(10);
  });

  it('电脑照排好的押：每一局第一次打时押排的点数，连庄、流局重打的本场不押；还剩的运势是后面没打的局排的', () => {
    let repeats = 0;
    for (let seed = 1; seed <= 8; seed++) {
      play(
        seed,
        LINEUPS[seed % 4],
        (g, me) => {
          const seen = new Set<number>();
          const check = () => {
            const slot = g.roundWind * 4 + g.roundNumber;
            const bet = nellyTier(g, me);
            const plan = (g.abilityGameState[me] as { plan: number[] }).plan;
            expect(plan.length).toBe(8);
            expect(sum(plan)).toBe(10);
            if (seen.has(slot)) repeats++;
            expect(bet).toBe(seen.has(slot) ? 0 : plan[slot] ?? 0);
            seen.add(slot);
            const rest = sum(plan.filter((_, i) => !seen.has(i)));
            expect(nellyPool(g, me)).toBe(rest);
            expect(nellySenses(g, me)).toBe(rest > 0);
            expect(g.isImmune(me)).toBe(bet >= 3);
            // 她坐庄的局排的是 3 点
            if (g.dealer === me && g.honba === 0 && slot < 8) expect(plan[slot]).toBe(3);
          };
          // 第一局在 setup 之前就开始了
          check();
          g.onEvent((e) => {
            if (e.type === 'roundStart') check();
          });
        },
        { format: 'team' },
      );
    }
    // 连庄、流局重打的局出现过（不然上面那条没测到）
    expect(repeats).toBeGreaterThan(0);
  }, 120000);

  it('玩家：东一局发牌前排一次，加起来要正好 10 点，排好就不再问，每一局照排的押', () => {
    const ids = LINEUPS[0];
    const seats = ids.map(byId);
    const me = ids.indexOf('nelly');
    const g = new Game({ seed: 5, format: 'team', players: seats.map((c, i) => ({ name: c.id, ability: c.ability, manual: i === me })) });
    expect(g.phase).toBe('predeal');
    const ab = g.abilities[me]!;
    const opts = ab.preDeal!(g, me);
    expect(opts.length).toBe(8);
    expect(opts.every((o) => o.enabled && o.stepper && o.stepper.min === 0 && o.stepper.max === 3)).toBe(true);
    // 先按电脑的排法填好
    expect(sum(opts.map((o) => o.stepper!.value))).toBe(10);
    expect(nellyPool(g, me)).toBe(10);
    const vals: Record<string, number> = Object.fromEntries(opts.map((o) => [o.id, 0]));
    expect(ab.preDealCheck!(g, me, vals)).toBe('还有 10 点没分');
    Object.assign(vals, { slot0: 3, slot1: 3, slot2: 3, slot3: 2 });
    expect(ab.preDealCheck!(g, me, vals)).toBe('多分了 1 点');
    Object.assign(vals, { slot0: 2, slot1: 0, slot2: 3, slot3: 1, slot6: 1, slot7: 3 });
    expect(ab.preDealCheck!(g, me, vals)).toBeNull();
    const plan = [2, 0, 3, 1, 0, 0, 1, 3];
    ab.setPreDeal!(g, me, [], vals);
    expect(ab.preDeal!(g, me)).toEqual([]);
    const seen = new Set<number>();
    let rounds = 0;
    g.onEvent((e) => {
      if (e.type !== 'roundStart') return;
      rounds++;
      const slot = g.roundWind * 4 + g.roundNumber;
      expect(nellyTier(g, me)).toBe(seen.has(slot) ? 0 : plan[slot] ?? 0);
      seen.add(slot);
      expect(nellyPool(g, me)).toBe(sum(plan.filter((_, i) => !seen.has(i))));
    });
    g.deal();
    let steps = 0;
    while (g.phase !== 'gameEnd' && ++steps < 20000) {
      // 排好以后不再停在发牌前
      expect(g.phase).not.toBe('predeal');
      if (g.phase === 'roundEnd') {
        g.nextRound();
        continue;
      }
      const s = g.waitingSeats()[0];
      g.act(s, chooseAction(g, s, seats[s].ai));
    }
    expect(rounds).toBeGreaterThan(1);
  }, 60000);
});
