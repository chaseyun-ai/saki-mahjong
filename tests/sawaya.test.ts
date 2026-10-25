import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { SAWAYA, sawayaOn } from '../src/abilities/sawaya';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { isHonor, kindOf, numOf } from '../src/engine/tiles';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

const LINEUPS = [
  ['sawaya', 'saki', 'koromo', 'kuro'],
  ['awai', 'sawaya', 'kasumi', 'toki'],
  ['nelly', 'kasumi', 'sawaya', 'teru'],
  ['koromo', 'mihoko', 'awai', 'sawaya'],
];

function play(seed: number, ids: string[], setup: (g: Game, me: number) => void, pick?: (g: Game, me: number) => string[]) {
  const seats = ids.map(byId);
  const me = ids.indexOf('sawaya');
  const g = new Game({ seed, players: seats.map((c, i) => ({ name: c.id, ability: c.ability, manual: !!pick && i === me })) });
  setup(g, me);
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 20000) {
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    if (g.phase === 'predeal') {
      const opts = g.abilities[me]!.preDeal!(g, me);
      g.abilities[me]!.setPreDeal!(g, me, pick!(g, me).filter((id) => opts.find((o) => o.id === id)?.enabled));
      g.deal();
      continue;
    }
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, seats[s].ai));
  }
  return g;
}

describe('狮子原爽', () => {
  it('霍亚乌：封印的几局里别人的能力一下都不动，过了就恢复', () => {
    let sealedRounds = 0;
    let afterSeal = 0;
    for (let seed = 1; seed <= 16; seed++) {
      // 玩家操作：第一局就叫霍亚乌
      play(
        seed,
        LINEUPS[seed % 4],
        (g, me) => {
          // 第一局在建对局时就开始了（这时还没监听），从第二局起看
          g.onEvent((e) => {
            if (e.type === 'ability' && e.seat !== me && g.isSealed(e.seat)) throw new Error(`封印中 ${e.ability} 还在发动`);
            if (e.type === 'roundStart') {
              const sealed = [0, 1, 2, 3].filter((s) => s !== me).every((s) => g.isSealed(s));
              if (sealed) sealedRounds++;
              else if (g.round > 1) afterSeal++;
              expect(g.isSealed(me)).toBe(false);
              expect(sealed).toBe(g.round <= SAWAYA.hoyauRounds);
            }
          });
        },
        (g) => (g.round === 0 ? ['hoyau'] : []),
      );
    }
    expect(sealedRounds).toBeGreaterThan(10);
    expect(afterSeal).toBeGreaterThan(10);
  }, 120000);

  it('云用过要等几局才回来，神威一场一次', () => {
    for (let seed = 1; seed <= 12; seed++) {
      play(
        seed,
        LINEUPS[seed % 4],
        (g, me) => {
          const last: Record<string, number> = {};
          const kamuy = new Set<string>();
          g.onEvent((e) => {
            if (e.type !== 'roundStart') return;
            for (const id of ['red', 'white', 'yellow'] as const) {
              if (!sawayaOn(g, me, id)) continue;
              if (last[id] !== undefined) expect(g.round - last[id]).toBeGreaterThan(SAWAYA.cloudCooldown);
              last[id] = g.round;
            }
            for (const id of ['pakoro', 'akkoro', 'hoyau', 'huri'] as const) {
              if (!sawayaOn(g, me, id)) continue;
              expect(kamuy.has(id)).toBe(false);
              kamuy.add(id);
            }
          });
        },
        // 玩家每局都想全部放出来
        () => ['red', 'white', 'yellow', 'pakoro', 'akkoro', 'hoyau', 'huri'],
      );
    }
  }, 120000);

  it('红云：别人配牌里没有字牌、也摸不到字牌；黄云：她配牌里的数牌都是 1–4', () => {
    let redDraws = 0;
    let yellowHands = 0;
    for (let seed = 1; seed <= 16; seed++) {
      play(
        seed,
        LINEUPS[seed % 4],
        (g, me) => {
          g.onEvent((e) => {
            if (e.type === 'roundStart') {
              if (sawayaOn(g, me, 'red')) {
                for (let s = 0; s < 4; s++) if (s !== me && !g.dealUnmet.some((r) => r.target === s)) expect(g.players[s].hand.some((t) => isHonor(kindOf(t)))).toBe(false);
              }
              if (sawayaOn(g, me, 'yellow')) {
                yellowHands++;
                const nums = g.players[me].hand.filter((t) => kindOf(t) < 27);
                expect(nums.filter((t) => numOf(kindOf(t)) > 4).length).toBeLessThanOrEqual(1);
              }
            }
            if (e.type === 'draw' && e.seat !== me && !g.rinshanDraw && sawayaOn(g, me, 'red') && !g.isSealed(me)) {
              // 牌山里只剩字牌（或者别的都被锁住）时才挡不住
              const other = g.wall.live.some((t) => !isHonor(kindOf(t)) && !g.wall.locked.has(t));
              if (!other) return;
              redDraws++;
              expect(isHonor(kindOf(g.players[e.seat].drawn!))).toBe(false);
            }
          });
        },
        // 红云、黄云轮着放
        (g) => (g.round % 4 === 0 ? ['red'] : g.round % 4 === 1 ? ['yellow'] : []),
      );
    }
    expect(redDraws).toBeGreaterThan(100);
    expect(yellowHands).toBeGreaterThan(5);
  }, 120000);
});
