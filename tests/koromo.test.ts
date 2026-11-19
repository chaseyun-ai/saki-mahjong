import { describe, expect, it } from 'vitest';
import { CHARACTERS, baseAi, type AiStyle } from '../src/abilities/characters';
import { KOROMO, KOROMO_READERS, koromoAbility, koromoDisruptor, koromoHaiteiTile, koromoMoon, koromoResist, koromoRouteOn, koromoRouteSet, koromoTonight } from '../src/abilities/koromo';
import { isDoraTile } from '../src/abilities/kuro';
import type { Ability } from '../src/abilities/types';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { Rng } from '../src/engine/rng';
import { shanten } from '../src/engine/shanten';
import { kindOf, toCounts } from '../src/engine/tiles';
import { Wall } from '../src/engine/wall';

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
const newMoon = (g: Game, me: number) => ((g.abilityGameState[me] as { moon?: number }).moon = 0);

describe('天江衣', () => {
  it('月相整场不变；挡别人的干扰：满月 60%，新月 15%，霞和玄挡不住', () => {
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

  it('月相管她自己的牌：满潮、潮起潮落、一向听地狱、月下的配牌，新月最小、满月最大，中间的月相在两头之间', () => {
    const g = new Game({ seed: 1, players: ['koromo', 'nodoka', 'yuuki', 'teru'].map((id) => ({ name: id, ability: byId(id).ability })) });
    const gs = g.abilityGameState[0] as { moon?: number };
    for (const v of [KOROMO.flood, KOROMO.tide, KOROMO.hell, KOROMO.dealDora]) {
      const [lo, hi] = v as [number, number];
      expect(hi).toBeGreaterThan(lo);
      gs.moon = 0;
      expect(koromoTonight(g, 0, v)).toBeCloseTo(lo);
      gs.moon = 4;
      expect(koromoTonight(g, 0, v)).toBeCloseTo(hi);
      // 上弦月、下弦月一样，在两头之间
      gs.moon = 2;
      const half = koromoTonight(g, 0, v);
      expect(half).toBeGreaterThan(lo);
      expect(half).toBeLessThan(hi);
      gs.moon = 6;
      expect(koromoTonight(g, 0, v)).toBeCloseTo(half);
    }
    // 写成一个数的不看月相
    gs.moon = 0;
    expect(koromoTonight(g, 0, 0.4)).toBe(0.4);
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

  it('一向听地狱（海底路线上）：别家一向听每次都摸不到进张（两向听照常），听了牌的摸不到和了牌', () => {
    const n = { one: 0, oneBetter: 0, two: 0, twoBetter: 0, tenpai: 0, tenpaiWin: 0 };
    for (let seed = 1; seed <= 16; seed++) {
      play(seed, (g, me) => {
        newMoon(g, me);
        g.onEvent((e) => {
          if (e.type !== 'draw' || e.seat === me || g.rinshanDraw || !koromoRouteOn(g, me)) return;
          const p = g.players[e.seat];
          const before = shanten(toCounts(p.hand.filter((t) => t !== p.drawn)), p.melds.length);
          // 听了牌的别家：摸到的不是和了牌（以前是摸得到、只是不许自摸）
          if (before === 0) {
            n.tenpai++;
            if (shanten(toCounts(p.hand), p.melds.length) === -1) n.tenpaiWin++;
          }
          const better = shanten(toCounts(p.hand), p.melds.length) < before;
          if (before === 1) {
            n.one++;
            if (better) n.oneBetter++;
          } else if (before === 2) {
            n.two++;
            if (better) n.twoBetter++;
          }
        });
      });
    }
    console.log(n);
    expect(n.one).toBeGreaterThan(50);
    // 牌山里只剩进张时拦不住，所以不是严格的 0
    expect(n.oneBetter).toBeLessThan(n.one * 0.05);
    expect(n.twoBetter).toBeGreaterThan(n.two * 0.08);
    expect(n.tenpai).toBeGreaterThan(10);
    expect(n.tenpaiWin).toBe(0);
  }, 120000);

  it('一向听地狱（不在海底路线上）：满月时别家一向听摸不到进张（两向听照常）；新月时拦得住一部分', () => {
    const run = (moon: (g: Game, me: number) => void) => {
      let one = 0;
      let oneBetter = 0;
      let two = 0;
      let twoBetter = 0;
      for (let seed = 1; seed <= 10; seed++) {
        play(seed, (g, me) => {
          moon(g, me);
          g.onEvent((e) => {
            if (e.type !== 'draw' || e.seat === me) return;
            if ((g.abilityState[me] as { route?: string }).route) return;
            const p = g.players[e.seat];
            const before = shanten(toCounts(p.hand.filter((t) => t !== p.drawn)), p.melds.length);
            const better = shanten(toCounts(p.hand), p.melds.length) < before;
            if (before === 1) {
              one++;
              if (better) oneBetter++;
            } else if (before === 2) {
              two++;
              if (better) twoBetter++;
            }
          });
        });
      }
      return { one, oneBetter, two, twoBetter };
    };
    const full = run(fullMoon);
    const dark = run(newMoon);
    console.log({ full, dark });
    expect(full.one).toBeGreaterThan(200);
    // 牌山里只剩进张时拦不住，所以不是严格的 0
    expect(full.oneBetter).toBeLessThan(full.one * 0.02);
    expect(full.twoBetter).toBeGreaterThan(full.two * 0.1);
    // 新月：一向听的进张比两向听少得多（被拦掉一部分），但还摸得到
    expect(dark.oneBetter).toBeGreaterThan(dark.one * 0.03);
    expect(dark.oneBetter / dark.one).toBeLessThan((dark.twoBetter / dark.two) * 0.8);
  }, 120000);

  it('电脑的衣自己不开杠（杠了海底就从她手里错开）：只有海底已经被错开、杠一手能挪回来时才杠', () => {
    let rounds = 0;
    let kans = 0;
    for (let seed = 1; seed <= 24; seed++) {
      play(seed, (g, me) => {
        g.onEvent((e) => {
          if (e.type === 'roundStart') rounds++;
          if (e.type !== 'call' || e.seat !== me || !e.call.includes('杠')) return;
          kans++;
          expect(koromoRouteSet(g, me)).toBe(true);
          expect(koromoRouteOn(g, me)).toBe(false);
        });
      });
    }
    console.log({ rounds, kans });
    expect(rounds).toBeGreaterThan(100);
    expect(kans).toBeLessThan(4);
  }, 120000);

  it('海底不会自己断：牌山里没有她要的牌时，从没翻开的王牌里换一张到海底', () => {
    const w = new Wall(new Rng(7));
    const k = kindOf(w.rinshan[2]);
    const last = w.live.length - 1;
    // 牌山里这种牌都当作找不到
    expect(w.bringDeadToLive(last, (t) => kindOf(t) === k, new Rng(1))).toBe(true);
    expect(kindOf(w.live[last])).toBe(k);
    expect(new Set([...w.live, ...w.rinshan, ...w.doraIndicators, ...w.uraIndicators]).size).toBe(136);
    // 翻开的宝牌指示牌不动；锁住的不换
    const w2 = new Wall(new Rng(8));
    const d = w2.doraIndicators[0];
    const only = kindOf(d);
    const dead = [...w2.rinshan, ...w2.uraIndicators].filter((t) => kindOf(t) === only);
    for (const t of dead) w2.locked.add(t, 'test');
    expect(w2.bringDeadToLive(w2.live.length - 1, (t) => t === d || dead.includes(t), new Rng(1))).toBe(false);
    expect(w2.doraIndicators[0]).toBe(d);
  });

  it('海底只会被鸣牌、开杠错开：没人鸣牌时海底路线不会自己断', () => {
    let lost = 0;
    let selfLost = 0;
    let calls = 0;
    let callsAtOn = 0;
    const spy: Ability = {
      ...koromoAbility,
      beforeAnyDraw(g, seat, drawer, rinshan) {
        const was = koromoRouteOn(g, seat);
        const r = koromoAbility.beforeAnyDraw!(g, seat, drawer, rinshan);
        if (was && !koromoRouteOn(g, seat)) {
          lost++;
          if (calls === callsAtOn) selfLost++;
        }
        if (koromoRouteOn(g, seat)) callsAtOn = calls;
        return r;
      },
    };
    for (let seed = 1; seed <= 16; seed++) {
      play(
        seed,
        (g) =>
          g.onEvent((e) => {
            if (e.type === 'call') calls++;
          }),
        { ...koromo, ability: spy },
      );
    }
    console.log({ lost, selfLost });
    expect(lost).toBeGreaterThan(5);
    expect(selfLost).toBe(0);
  }, 120000);

  it('海底路线上她听牌以后别家鸣不了牌，立直以后谁打的牌都鸣不了', () => {
    let frozen = 0;
    let tenpaiFrozen = 0;
    for (let seed = 1; seed <= 24; seed++) {
      play(seed, (g, me) => {
        fullMoon(g, me);
        g.onEvent((e) => {
          if (e.type !== 'discard' || !koromoRouteOn(g, me)) return;
          const p = g.players[me];
          const riichi = p.riichi || p.riichiPending;
          const tenpai = p.hand.length % 3 === 1 && g.waits(me).length > 0;
          if (!riichi && !(tenpai && e.seat !== me)) return;
          if (riichi) frozen++;
          else tenpaiFrozen++;
          for (const [s, acts] of g.pending) if (s !== me) expect(acts.every((a) => a.type === 'ron' || a.type === 'pass')).toBe(true);
        });
      });
    }
    console.log({ frozen, tenpaiFrozen });
    expect(frozen).toBeGreaterThan(0);
    expect(tenpaiFrozen).toBeGreaterThan(20);
  }, 120000);

  it('咲、久、真子、美穗子看得穿海底：她听牌后（立直前）照样能鸣', () => {
    const g = new Game({ seed: 3, players: ['koromo', 'saki', 'none', 'none'].map((id) => ({ name: id, ability: id === 'none' ? null : byId(id).ability })) });
    const st = g.abilityState[0] as { on?: boolean };
    st.on = true;
    // 一二三万、四五六万、一二三筒、一二三索、东单骑
    g.players[0].hand = [0, 4, 8, 12, 16, 20, 36, 40, 44, 72, 76, 80, 108];
    expect(g.waits(0)).toEqual([27]);
    expect(koromoAbility.freezesCalls!(g, 0, 1)).toBe(false);
    expect(koromoAbility.freezesCalls!(g, 0, 2)).toBe(true);
    expect(koromoAbility.freezesCalls!(g, 0, 0)).toBe(false);
    // 立直以后谁都鸣不了
    g.players[0].riichi = true;
    expect(koromoAbility.freezesCalls!(g, 0, 1)).toBe(true);
    // 海底被错开了就不冻
    st.on = false;
    expect(koromoAbility.freezesCalls!(g, 0, 2)).toBe(false);
  });

  it('月下的配牌：海底归她的局，配牌里的宝牌比别家多', () => {
    let mine = 0;
    let rounds = 0;
    let others = 0;
    for (let seed = 1; seed <= 16; seed++) {
      play(seed, (g, me) => {
        g.onEvent((e) => {
          if (e.type !== 'roundStart' || (g.dealer + g.wall.live.length - 1) % 4 !== me) return;
          rounds++;
          mine += g.players[me].hand.filter((t) => isDoraTile(g, t)).length;
          for (let s = 0; s < 4; s++) if (s !== me) others += g.players[s].hand.filter((t) => isDoraTile(g, t)).length / 3;
        });
      });
    }
    console.log({ rounds, mine: mine / rounds, others: others / rounds });
    expect(rounds).toBeGreaterThan(10);
    expect(mine / rounds).toBeGreaterThan(others / rounds + 1);
  }, 120000);

  it('电脑的衣：海底路线上（牌山没摸完）不到满贯的牌先不和，等海底', () => {
    let held = 0;
    for (let seed = 1; seed <= 16; seed++) {
      play(seed, (g, me) => {
        fullMoon(g, me);
        g.onEvent((e) => {
          if (e.type !== 'roundEnd') return;
          for (const w of e.result.wins) {
            if (w.seat !== me || g.wall.remaining === 0 || !koromoRouteOn(g, me)) continue;
            held++;
            expect(w.result.base).toBeGreaterThanOrEqual(2000);
          }
        });
      });
    }
    console.log({ bigEarlyWins: held });
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

  it('海底挪移：一向听以内鸣牌听牌、最后一张轮到她时，海底换成她的和了牌（能是宝牌就是宝牌）', () => {
    let moved = 0;
    let richHaitei = 0;
    for (let seed = 1; seed <= 24; seed++) {
      play(seed, (g, me) => {
        fullMoon(g, me);
        g.onEvent((e) => {
          if (e.type !== 'ability' || e.seat !== me || e.text !== '海底挪移') return;
          moved++;
          // 吃碰过（碰了以后可能加杠）
          expect(g.players[me].melds.some((m) => m.type === 'chi' || m.type === 'pon' || m.type === 'kakan')).toBe(true);
          const t = koromoHaiteiTile(g, me)!;
          const w = g.wall;
          expect(w.live.at(-1)).toBe(t);
          expect(g.waits(me)).toContain(kindOf(t));
          expect(koromoRouteOn(g, me)).toBe(true);
          // 海底能定成宝牌就定成宝牌（三家没能力，没有玄）
          if (isDoraTile(g, t)) richHaitei++;
          else expect(w.live.some((x, i) => i < w.live.length - 1 && !w.locked.has(x) && isDoraTile(g, x) && g.waits(me).includes(kindOf(x)))).toBe(false);
        });
      });
    }
    console.log({ moved, richHaitei });
    expect(moved).toBeGreaterThan(0);
  }, 120000);

  it('满月时，潮起潮落：不在海底路线上、她还没听牌，大约 25% 的摸牌换成进张；满潮：海底路线上大约 65%', () => {
    let eligible = 0;
    let tide = 0;
    let routeEligible = 0;
    let flood = 0;
    const spy: Ability = {
      ...koromoAbility,
      beforeAnyDraw(g, seat, drawer, rinshan) {
        const pre = !rinshan && drawer === seat && shanten(toCounts(g.players[seat].hand), g.players[seat].melds.length) >= 1;
        const off = !koromoRouteSet(g, seat);
        const r = koromoAbility.beforeAnyDraw!(g, seat, drawer, rinshan);
        if (pre && off && !koromoRouteSet(g, seat)) {
          eligible++;
          if (r?.text === '潮起潮落') tide++;
        }
        if (pre && !off) {
          routeEligible++;
          if (r?.text === '满潮') flood++;
        }
        return r;
      },
    };
    for (let seed = 1; seed <= 24; seed++) play(seed, fullMoon, { ...koromo, ability: spy });
    console.log({ eligible, tide, rate: tide / eligible, routeEligible, flood, floodRate: flood / routeEligible });
    expect(eligible).toBeGreaterThan(300);
    expect(tide / eligible).toBeGreaterThan(0.19);
    expect(tide / eligible).toBeLessThan(0.31);
    expect(routeEligible).toBeGreaterThan(40);
    expect(flood / routeEligible).toBeGreaterThan(0.52);
    expect(flood / routeEligible).toBeLessThan(0.78);
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
