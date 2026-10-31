import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { NELLY, nellyAiBet, nellyBlocked, nellyPool, nellySenses, nellySensesTenpai, nellySisters, nellySuit, nellyTier } from '../src/abilities/nelly';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { kindOf } from '../src/engine/tiles';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

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

describe('涅莉·薇萨拉兹', () => {
  it('电脑押运势：坐庄押满，抢手的局不押，最后一局押光，平时把运势平摊', () => {
    expect(nellyAiBet(10, 4, true, false)).toBe(3);
    expect(nellyAiBet(10, 4, false, true)).toBe(0);
    expect(nellyAiBet(12, 4, false, true)).toBe(3);
    expect(nellyAiBet(2, 1, false, true)).toBe(2);
    expect(nellyAiBet(10, 8, false, false)).toBe(1);
    expect(nellyAiBet(10, 4, false, false)).toBe(3);
    expect(nellyAiBet(0, 4, true, false)).toBe(0);
    for (let pool = 0; pool <= 12; pool++) for (let left = 1; left <= 8; left++) expect(nellyAiBet(pool, left, false, false)).toBeLessThanOrEqual(Math.min(3, pool));
  });

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
  }, 120000);

  it('七姐妹：押了运势的局自动开着，听牌的人用掉一次封住，一场最多 7 次，封住的人这一局和不了', () => {
    let used = 0;
    for (let seed = 1; seed <= 16; seed++) {
      play(
        seed,
        LINEUPS[seed % 4],
        (g, me) => {
          g.onEvent((e) => {
            if (e.type === 'ability' && e.seat === me && e.text === '七姐妹') {
              used++;
              expect(nellyTier(g, me)).toBeGreaterThan(0);
              const victim = nellyBlocked(g, me).at(-1)!;
              expect(nellySensesTenpai(g, victim)).toBe(true);
              expect(nellySisters(g, me)).toBeGreaterThanOrEqual(0);
            }
            if (e.type === 'roundEnd') for (const w of e.result.wins) expect(nellyBlocked(g, me)).not.toContain(w.seat);
          });
        },
        { format: 'team' },
      );
    }
    expect(used).toBeGreaterThan(5);
  }, 120000);

  it('押了运势：配牌偏向一种花色，档越高和得越大', () => {
    const stat = [0, 1, 2, 3].map(() => ({ rounds: 0, wins: 0, value: 0, big: 0, suit: 0, nums: 0 }));
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
                if (!v) return;
                const suit = nellySuit(g, me)!;
                const nums = g.players[me].hand.filter((t) => kindOf(t) < 27);
                s.nums += nums.length;
                s.suit += nums.filter((t) => Math.floor(kindOf(t) / 9) === suit).length;
              }
              if (e.type === 'roundEnd' && e.result.wins.some((w) => w.seat === me)) {
                const s = stat[v];
                const target = NELLY.target[v] * (me === g.dealer ? 1.5 : 1);
                s.wins++;
                s.value += e.result.deltas[me];
                if (v && e.result.deltas[me] >= target) s.big++;
              }
            });
          },
          { pick, format: 'team' },
        );
      }
    }
    console.log(stat.map((s, i) => `${i}: ${s.rounds} 局 和${s.wins} 平均${Math.round(s.value / Math.max(1, s.wins))} 够大${s.big} 花色${(s.suit / Math.max(1, s.nums)).toFixed(2)}`));
    for (const v of [1, 2, 3]) {
      expect(stat[v].rounds).toBeGreaterThan(20);
      expect(stat[v].suit / stat[v].nums).toBeGreaterThan(0.55);
      expect(stat[v].wins / stat[v].rounds).toBeGreaterThan(0.35);
    }
    expect(stat[3].value / stat[3].wins).toBeGreaterThan(stat[1].value / stat[1].wins);
    expect(stat[1].value / stat[1].wins).toBeGreaterThan(stat[0].value / Math.max(1, stat[0].wins));
  }, 300000);
});
