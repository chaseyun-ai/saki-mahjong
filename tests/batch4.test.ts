import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { akoDistance, akoSense } from '../src/abilities/ako';
import { seikoFish } from '../src/abilities/seiko';
import { yuWarm } from '../src/abilities/yu';
import { kuroLost } from '../src/abilities/kuro';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { shanten } from '../src/engine/shanten';
import { isRed, toCounts } from '../src/engine/tiles';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

function play(seed: number, ids: string[], setup: (g: Game) => void, format: 'east' | 'team' = 'east') {
  const seats = ids.map(byId);
  const g = new Game({ seed, format, players: seats.map((c) => ({ name: c.id, ability: c.ability })) });
  setup(g);
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 20000) {
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, seats[s].ai));
  }
  return g;
}

describe('片冈优希', () => {
  it('开局必定坐庄；东场配牌比南场好；塔可饼一场最多一次、只在南场', () => {
    const sh = { east: [0, 0], south: [0, 0] };
    for (let seed = 1; seed <= 12; seed++) {
      const ids = ['nodoka', 'hiroe', 'mihoko', 'yuuki'];
      const me = 3;
      const g = new Game({ seed, format: 'team', players: ids.map((id) => ({ name: id, ability: byId(id).ability })) });
      expect(g.dealer).toBe(me);
      let taco = 0;
      g.onEvent((e) => {
        if (e.type === 'ability' && e.seat === me && e.text === '塔可饼') {
          taco++;
          expect(g.roundWind).toBeGreaterThan(0);
        }
        if (e.type === 'roundStart') {
          const p = g.players[me];
          const hand = p.hand.filter((t) => t !== p.drawn);
          const s = g.roundWind === 0 ? sh.east : sh.south;
          s[0]++;
          s[1] += shanten(toCounts(hand), 0);
        }
      });
      const seats = ids.map(byId);
      let steps = 0;
      while (g.phase !== 'gameEnd' && ++steps < 20000) {
        if (g.phase === 'roundEnd') {
          g.nextRound();
          continue;
        }
        const s = g.waitingSeats()[0];
        g.act(s, chooseAction(g, s, seats[s].ai));
      }
      expect(taco).toBeLessThanOrEqual(1);
    }
    expect(sh.east[0]).toBeGreaterThan(20);
    expect(sh.south[0]).toBeGreaterThan(10);
    expect(sh.east[1] / sh.east[0]).toBeLessThan(sh.south[1] / sh.south[0] - 0.3);
  }, 120000);
});

describe('松实宥', () => {
  it('配牌里暖色牌比别人多；和玄同桌时拿不到赤五', () => {
    let mine = 0;
    let others = 0;
    let red = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const ids = seed % 2 ? ['yu', 'nodoka', 'hiroe', 'mihoko'] : ['yu', 'kuro', 'hiroe', 'mihoko'];
      play(seed, ids, (g) => {
        g.onEvent((e) => {
          if (e.type !== 'roundStart') return;
          const warm = yuWarm(g, 0);
          mine += g.players[0].hand.slice(0, 13).filter(warm).length;
          others += g.players.slice(1).reduce((n, p) => n + p.hand.slice(0, 13).filter(warm).length, 0) / 3;
          // 玄打出过宝牌、能力没了以后不算
          if (ids.includes('kuro') && !kuroLost(g, 1)) red += g.players[0].hand.filter(isRed).length;
        });
      });
    }
    expect(mine).toBeGreaterThan(others * 1.4);
    expect(red).toBe(0);
  }, 120000);
});

describe('新子憧', () => {
  it('鸣过牌才有距离感，看到的是每家离听牌几步', () => {
    let seen = 0;
    for (let seed = 1; seed <= 8; seed++) {
      play(seed, ['ako', 'nodoka', 'hiroe', 'mihoko'], (g) => {
        g.onEvent((e) => {
          if (e.type !== 'discard') return;
          const calls = g.players[0].melds.filter((m) => m.type !== 'ankan').length;
          expect(akoSense(g, 0)).toBe(calls > 0);
          if (!calls) return;
          seen++;
          for (let s = 1; s < 4; s++) {
            const p = g.players[s];
            const hand = (p.hand.length + 3 * p.melds.length) % 3 === 2 && p.drawn !== null ? p.hand.filter((t) => t !== p.drawn) : p.hand;
            expect(akoDistance(g, s)).toBe(Math.max(0, shanten(toCounts(hand), p.melds.length)));
          }
        });
      });
    }
    expect(seen).toBeGreaterThan(20);
  }, 120000);
});

describe('亦野诚子', () => {
  it('鸣满三次、听牌以后两次摸牌之内自摸', () => {
    let fished = 0;
    for (let seed = 1; seed <= 30; seed++) {
      play(seed, ['seiko', 'nodoka', 'hiroe', 'mihoko'], (g) => {
        let since = -1; // 鸣满三次、听牌以后她摸了几次
        g.onEvent((e) => {
          if (e.type === 'roundStart') since = -1;
          if (e.type === 'draw' && e.seat === 0) {
            const p = g.players[0];
            const before = shanten(toCounts(p.hand.filter((t) => t !== p.drawn)), p.melds.length);
            if (seikoFish(g, 0) >= 3 && before === 0) since++;
          }
          if (e.type === 'ability' && e.seat === 0 && e.text === '第四条鱼') fished++;
          if (e.type === 'roundEnd' && since >= 0 && e.result.wins.some((w) => w.seat === 0 && w.from === null)) expect(since).toBeLessThanOrEqual(1);
        });
      });
    }
    expect(fished).toBeGreaterThan(3);
  }, 120000);
});
