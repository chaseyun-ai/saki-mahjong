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
    if (g.phase === 'postdeal') {
      const opts = g.abilities[me]!.postDeal!(g, me);
      g.abilities[me]!.setPostDeal!(g, me, pick!(g, me).filter((id) => opts.find((o) => o.id === id)?.enabled));
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
          // 配完牌、她选好以后（dealt）看
          g.onEvent((e) => {
            if (e.type === 'ability' && e.seat !== me && g.isSealed(e.seat)) throw new Error(`封印中 ${e.ability} 还在发动`);
            if (e.type === 'dealt') {
              // 照、玄封印不了
              const sealable = [0, 1, 2, 3].filter((s) => s !== me && !g.abilities[s]?.immune && !g.abilities[s]?.absolute);
              for (const s of [0, 1, 2, 3]) if (s !== me && !sealable.includes(s)) expect(g.isSealed(s)).toBe(false);
              const sealed = sealable.every((s) => g.isSealed(s));
              if (sealed) sealedRounds++;
              else if (g.round > 1) afterSeal++;
              expect(g.isSealed(me)).toBe(false);
              expect(sealed).toBe(g.round <= SAWAYA.hoyauRounds);
            }
          });
        },
        (g) => (g.round === 1 ? ['hoyau'] : []),
      );
    }
    expect(sealedRounds).toBeGreaterThan(10);
    expect(afterSeal).toBeGreaterThan(10);
  }, 120000);

  it('每朵云、每个神威一场只能用一次', () => {
    for (let seed = 1; seed <= 12; seed++) {
      play(
        seed,
        LINEUPS[seed % 4],
        (g, me) => {
          const used = new Set<string>();
          g.onEvent((e) => {
            if (e.type !== 'dealt') return;
            for (const id of ['red', 'white', 'yellow', 'pakoro', 'akkoro', 'hoyau', 'huri'] as const) {
              if (!sawayaOn(g, me, id)) continue;
              expect(used.has(id)).toBe(false);
              used.add(id);
            }
          });
        },
        // 玩家每局都想全部放出来
        () => ['red', 'white', 'yellow', 'pakoro', 'akkoro', 'hoyau', 'huri'],
      );
    }
  }, 120000);

  it('红云：别人手里的字牌换走、也摸不到字牌；黄云：她手里的数牌都换成 1–4', () => {
    let redDraws = 0;
    let yellowHands = 0;
    for (let seed = 1; seed <= 16; seed++) {
      play(
        seed,
        LINEUPS[seed % 4],
        (g, me) => {
          g.onEvent((e) => {
            if (e.type === 'dealt') {
              if (sawayaOn(g, me, 'red')) {
                for (let s = 0; s < 4; s++) if (s !== me && g.binds(me, s)) expect(g.players[s].hand.some((t) => isHonor(kindOf(t)))).toBe(false);
              }
              if (sawayaOn(g, me, 'yellow')) {
                yellowHands++;
                const nums = g.players[me].hand.filter((t) => kindOf(t) < 27);
                expect(nums.filter((t) => numOf(kindOf(t)) > 4).length).toBeLessThanOrEqual(1);
              }
            }
            if (e.type === 'draw' && e.seat !== me && g.binds(me, e.seat) && !g.rinshanDraw && sawayaOn(g, me, 'red') && !g.isSealed(me)) {
              // 牌山里只剩字牌（或者别的都被锁住、被先定的规矩挡着，比如玄的宝牌）时才挡不住：牌局末尾不看
              const other = g.wall.live.some((t) => !isHonor(kindOf(t)) && !g.wall.locked.has(t));
              if (!other || g.wall.remaining < 20) return;
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

  it('电脑的爽：霍亚乌不单独用；动手的局叠着用，一局最多两样', () => {
    let hoyau = 0;
    let stacked = 0;
    let acted = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const g = play(seed, LINEUPS[seed % 4], (g, me) => {
        g.onEvent((e) => {
          if (e.type !== 'dealt') return;
          const on = ['red', 'white', 'yellow', 'pakoro', 'akkoro', 'hoyau', 'huri'].filter((id) => sawayaOn(g, me, id as never));
          if (on.includes('hoyau')) {
            hoyau++;
            expect(on.length).toBeGreaterThan(1);
          }
          expect(on.length).toBeLessThanOrEqual(2);
          if (on.length) acted++;
          if (on.length > 1) stacked++;
        });
      });
      expect(g.phase).toBe('gameEnd');
    }
    expect(hoyau).toBeGreaterThan(3);
    expect(stacked / acted).toBeGreaterThan(0.5);
  }, 120000);

  it('玩家操作时配完牌才停下来选：手牌已经发好，选的云当场换牌', () => {
    const ids = LINEUPS[0];
    const seats = ids.map(byId);
    const g = new Game({ seed: 3, players: seats.map((c, i) => ({ name: c.id, ability: c.ability, manual: i === 0 })) });
    expect(g.phase).toBe('postdeal');
    for (const p of g.players) expect(p.hand.length).toBe(13);
    expect(g.players[g.dealer].drawn).toBeNull();
    const before = g.players[0].hand.slice();
    g.abilities[0]!.setPostDeal!(g, 0, ['yellow']);
    g.deal();
    expect(g.phase).toBe('turn');
    expect(sawayaOn(g, 0, 'yellow')).toBe(true);
    const big = (h: number[]) => h.filter((t) => kindOf(t) < 27 && numOf(kindOf(t)) > 4).length;
    if (big(before)) expect(big(g.players[0].hand.filter((t) => t !== g.players[0].drawn))).toBeLessThan(big(before));
    // 136 张一张不少
    const all = [...g.players.flatMap((p) => p.hand), ...g.wall.allTiles()];
    expect(new Set(all).size).toBe(136);
  });
});
