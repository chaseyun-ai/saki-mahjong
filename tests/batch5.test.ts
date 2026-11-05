import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { hisaBadWait } from '../src/abilities/hisa';
import { kyoukoBreaking } from '../src/abilities/kyouko';
import { makoDanger, makoKnows, makoSuit } from '../src/abilities/mako';
import { nodokaAngel } from '../src/abilities/nodoka';
import { takamiSeeds } from '../src/abilities/takami';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { kindOf } from '../src/engine/tiles';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

function play(seed: number, ids: string[], setup: (g: Game) => void, format: 'east' | 'south' | 'team' = 'east') {
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
  expect(g.phase).toBe('gameEnd');
  return g;
}

// 这一局配牌（庄家第一张摸牌前）里，一门花色加字牌最多占几张
const dyed = (hand: number[]) => Math.max(...[0, 1, 2].map((s) => hand.filter((t) => kindOf(t) >= 27 || Math.floor(kindOf(t) / 9) === s).length));

describe('染谷真子', () => {
  it('配牌偏向一门花色加字牌；只读得出没有能力的人', () => {
    let mine = 0;
    let others = 0;
    let n = 0;
    for (let seed = 1; seed <= 10; seed++) {
      play(seed, ['mako', 'nodoka', 'kasumi', 'hiroe'], (g) => {
        expect(makoKnows(g, 1)).toBe(true);
        expect(makoKnows(g, 2)).toBe(false);
        g.onEvent((e) => {
          if (e.type === 'roundStart') {
            expect(makoSuit(g, 0)).not.toBeNull();
            const hand = (s: number) => g.players[s].hand.filter((t) => t !== g.players[s].drawn);
            mine += dyed(hand(0));
            others += dyed(hand(1));
            n++;
          }
          // 读出来的危险牌只来自和（没有能力的那家）
          if (e.type === 'discard' && e.seat === 3) {
            for (const k of makoDanger(g, 0)) expect(g.waits(1)).toContain(k);
          }
        });
      });
    }
    expect(n).toBeGreaterThan(20);
    expect(mine / n).toBeGreaterThan(others / n + 1.5);
  }, 120000);
});

describe('竹井久', () => {
  it('听烂听牌时恶待发动：自己摸到、别人摸到用不上的和了牌', () => {
    let lure = 0;
    let self = 0;
    let badWins = 0;
    for (let seed = 1; seed <= 12; seed++) {
      play(seed, ['hisa', 'nodoka', 'hiroe', 'mihoko'], (g) => {
        g.onEvent((e) => {
          if (e.type === 'ability' && e.ability === 'hisa') {
            expect(hisaBadWait(g, 0)).not.toBeNull();
            if (e.target !== undefined) {
              lure++;
              expect(e.target).not.toBe(0);
            } else self++;
          }
          if (e.type === 'roundEnd') for (const w of e.result.wins) if (w.seat === 0 && w.result.yaku.length) badWins++;
        });
      });
    }
    expect(lure).toBeGreaterThan(5);
    expect(self).toBeGreaterThan(0);
    expect(badWins).toBeGreaterThan(5);
  }, 120000);
});

describe('末原恭子', () => {
  it('鸣牌以后到她下一次摸牌之前，别人的能力被打断（玄除外）', () => {
    let broke = 0;
    for (let seed = 1; seed <= 10; seed++) {
      play(seed, ['kyouko', 'koromo', 'kuro', 'kasumi'], (g) => {
        g.onEvent((e) => {
          if (e.type === 'ability' && e.ability === 'kyouko') broke++;
          if (kyoukoBreaking(g, 0) && g.phase !== 'roundEnd') {
            // 衣的月相每局有一定概率挡住封印
            const resisted = (g.abilityGameState[1] as { sealRoll?: Record<number, boolean> }).sealRoll?.[g.round];
            expect(g.isSealed(1)).toBe(!resisted);
            expect(g.isSealed(3)).toBe(true);
            expect(g.isSealed(2)).toBe(false);
          }
          if (e.type === 'draw' && e.seat === 0 && !g.rinshanDraw) expect(kyoukoBreaking(g, 0)).toBe(false);
          // 被打断的人不发动能力（玄可以，衣的月相挡住了打断也可以）
          if (e.type === 'ability' && kyoukoBreaking(g, 0) && e.seat !== 0) expect(e.ability === 'kuro' || (e.ability === 'koromo' && !g.isSealed(e.seat))).toBe(true);
        });
      });
    }
    expect(broke).toBeGreaterThan(5);
  }, 120000);
});

describe('涉谷尧深', () => {
  it('每局第一张打出的牌种下，南 4 局全部回到配牌里', () => {
    let harvests = 0;
    for (let seed = 1; seed <= 8; seed++) {
      play(
        seed,
        ['takami', 'nodoka', 'hiroe', 'mihoko'],
        (g) => {
          let planted: { n: number; k: number } | null = null;
          g.onEvent((e) => {
            if (e.type === 'roundStart') {
              const seeds = takamiSeeds(g, 0);
              const hand = g.players[0].hand;
              if (g.roundWind === 1 && g.roundNumber === 3 && seeds.length) {
                harvests++;
                const want = new Map<number, number>();
                for (const k of seeds) want.set(k, Math.min(4, (want.get(k) ?? 0) + 1));
                // 种下的超过 13 张时收不完
                const total = [...want.values()].reduce((x, y) => x + y, 0);
                // 天使和有一半的概率挡掉别人调整她的配牌：她手里留着的那几张收不回来
                const kept = (k: number) => (nodokaAngel(g, 1) ? g.players[1].hand.filter((t) => kindOf(t) === k).length : 0);
                if (total <= 13) for (const [k, n] of want) expect(hand.filter((t) => kindOf(t) === k).length + kept(k)).toBeGreaterThanOrEqual(Math.min(n, 2));
              }
            }
            // 种下发生在打出以后（afterDiscard），下一个事件时检查
            if (planted !== null) {
              expect(takamiSeeds(g, 0).length).toBe(planted.n + 1);
              expect(takamiSeeds(g, 0).at(-1)).toBe(planted.k);
              planted = null;
            }
            if (e.type === 'discard' && e.seat === 0 && g.players[0].discards.length === 1 && g.players[0].melds.length === 0 && !g.isSealed(0)) {
              planted = { n: takamiSeeds(g, 0).length, k: kindOf(e.tile) };
            }
          });
        },
        'team',
      );
    }
    expect(harvests).toBeGreaterThan(3);
  }, 120000);
});

describe('半庄战', () => {
  it('打到南场，南 4 局（没连庄）就结束，不进西场', () => {
    for (let seed = 1; seed <= 6; seed++) {
      let south = false;
      const g = play(seed, ['nodoka', 'hiroe', 'mihoko', 'mako'], (g) => {
        g.onEvent((e) => {
          if (e.type === 'roundStart' && g.roundWind === 1) south = true;
          if (e.type === 'roundStart') expect(g.roundWind).toBeLessThanOrEqual(1);
        });
      }, 'south');
      if (g.players.every((p) => p.score >= 0)) expect(south).toBe(true);
    }
  }, 120000);
});
