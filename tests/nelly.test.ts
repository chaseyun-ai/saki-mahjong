import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { NELLY, nellyAiBet, nellyBlocked, nellyPool, nellySenses, nellySensesTenpai, nellySisters, nellyTier } from '../src/abilities/nelly';
import { teruWinValue } from '../src/abilities/teru';
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
              // 押几点最多封几家
              expect(nellyBlocked(g, me).length).toBeLessThanOrEqual(nellyTier(g, me));
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

  it('押了运势：配牌照常发，到那一巡左右才和（3 点 6 巡、2 点 12 巡、1 点 15 巡），档越高和得越大', () => {
    const stat = [0, 1, 2, 3].map(() => ({ rounds: 0, wins: 0, value: 0, big: 0, early: 0, turns: 0, sh: 0 }));
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
              }
            });
          },
          { pick, format: 'team' },
        );
      }
    }
    const avg = (a: number, b: number) => a / Math.max(1, b);
    console.log(stat.map((s, i) => `${i}: ${s.rounds} 局 和${s.wins} 平均${Math.round(avg(s.value, s.wins))} 够大${s.big} 平均第${avg(s.turns, s.wins).toFixed(1)}巡 提早${s.early} 配牌向听${avg(s.sh, s.rounds).toFixed(2)}`));
    for (const v of [1, 2, 3]) {
      expect(stat[v].rounds).toBeGreaterThan(20);
      // 配牌照常发：向听数和没押的局差不多
      expect(Math.abs(avg(stat[v].sh, stat[v].rounds) - avg(stat[0].sh, stat[0].rounds))).toBeLessThan(0.5);
      // 装装样子：几乎不会提早和
      expect(stat[v].early / Math.max(1, stat[v].wins)).toBeLessThan(0.1);
    }
    expect(stat[3].wins / stat[3].rounds).toBeGreaterThan(0.6);
    expect(avg(stat[3].turns, stat[3].wins)).toBeLessThan(avg(stat[2].turns, stat[2].wins));
    expect(avg(stat[2].turns, stat[2].wins)).toBeLessThan(avg(stat[1].turns, stat[1].wins));
    expect(avg(stat[3].value, stat[3].wins)).toBeGreaterThan(avg(stat[2].value, stat[2].wins));
    expect(avg(stat[2].value, stat[2].wins)).toBeGreaterThan(avg(stat[1].value, stat[1].wins));
  }, 600000);
});
