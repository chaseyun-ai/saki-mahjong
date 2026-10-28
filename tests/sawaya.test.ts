import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { sawayaOn, sawayaPlagueTarget, sawayaRedTarget } from '../src/abilities/sawaya';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { shanten } from '../src/engine/shanten';
import { isHonor, kindOf, numOf, toCounts } from '../src/engine/tiles';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;
const ALL = ['red', 'yellow', 'blue', 'white', 'black', 'pakoro', 'akkoro', 'huri', 'hoyau'] as const;

const LINEUPS = [
  ['sawaya', 'saki', 'koromo', 'kuro'],
  ['awai', 'sawaya', 'kasumi', 'toki'],
  ['nelly', 'kasumi', 'sawaya', 'teru'],
  ['koromo', 'mihoko', 'awai', 'sawaya'],
];

interface Picks {
  pre?: (g: Game, me: number) => string[];
  post?: (g: Game, me: number) => string[];
  // 每次有人摸牌前（玩家可以在这时按瘟神威）
  tick?: (g: Game, me: number) => void;
}

function play(seed: number, ids: string[], setup: (g: Game, me: number) => void, picks?: Picks) {
  const seats = ids.map(byId);
  const me = ids.indexOf('sawaya');
  const g = new Game({ seed, players: seats.map((c, i) => ({ name: c.id, ability: c.ability, manual: !!picks && i === me })) });
  setup(g, me);
  const pickFrom = (opts: { id: string; enabled: boolean }[], want: string[]) => want.filter((id) => opts.find((o) => o.id === id)?.enabled);
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 20000) {
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    const ab = g.abilities[me]!;
    if (g.phase === 'predeal') {
      ab.setPreDeal!(g, me, pickFrom(ab.preDeal!(g, me), picks?.pre?.(g, me) ?? []));
      g.deal();
      continue;
    }
    if (g.phase === 'postdeal') {
      ab.setPostDeal!(g, me, pickFrom(ab.postDeal!(g, me), picks?.post?.(g, me) ?? []));
      g.deal();
      continue;
    }
    picks?.tick?.(g, me);
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, seats[s].ai));
  }
  return g;
}

describe('狮子原爽', () => {
  it('玩家操作：五色云发牌前选（红云可以给一家），神威配牌后选（瘟神威要听牌）', () => {
    const g = new Game({ seed: 3, players: LINEUPS[0].map((id, i) => ({ name: id, ability: byId(id).ability, manual: i === 0 })) });
    const ab = g.abilities[0]!;
    expect(g.phase).toBe('predeal');
    const pre = ab.preDeal!(g, 0);
    expect(pre.map((o) => o.id)).toEqual(['red', 'red@1', 'red@2', 'red@3', 'yellow', 'blue', 'white', 'black']);
    expect(pre.filter((o) => o.group === 'red')).toHaveLength(4);
    ab.setPreDeal!(g, 0, ['yellow', 'red@2']);
    g.deal();
    expect(g.phase).toBe('postdeal');
    expect(sawayaOn(g, 0, 'yellow')).toBe(true);
    expect(sawayaRedTarget(g, 0)).toBe(2);
    for (const p of g.players) expect(p.hand.length).toBe(13);
    const post = ab.postDeal!(g, 0);
    expect(post.map((o) => o.id)).toEqual(['pakoro', 'akkoro', 'huri', 'hoyau']);
    expect(post.find((o) => o.id === 'pakoro')!.enabled).toBe(false);
    ab.setPostDeal!(g, 0, ['huri']);
    g.deal();
    expect(g.phase).toBe('turn');
    expect(sawayaOn(g, 0, 'huri')).toBe(true);
    // 黄云、鸟神威 2 局，红云 1 局
    expect(sawayaOn(g, 0, 'yellow', g.round + 1)).toBe(true);
    expect(sawayaOn(g, 0, 'huri', g.round + 1)).toBe(true);
    expect(sawayaOn(g, 0, 'red', g.round + 1)).toBe(false);
    expect(sawayaOn(g, 0, 'yellow', g.round + 2)).toBe(false);
  });

  it('蛇神威：封印 3 局（包括叫的这一局），封印中别人的能力一下都不动，过了就恢复', () => {
    let sealedRounds = 0;
    let afterSeal = 0;
    for (let seed = 1; seed <= 12; seed++) {
      play(
        seed,
        LINEUPS[seed % 4],
        (g, me) => {
          g.onEvent((e) => {
            if (e.type === 'ability' && e.seat !== me && g.isSealed(e.seat)) throw new Error(`封印中 ${e.ability} 还在发动`);
            if (e.type === 'dealt') {
              // 照、玄、天使和、神乐封印不了
              const sealable = [0, 1, 2, 3].filter((s) => s !== me && !g.abilities[s]?.immune && !g.abilities[s]?.absolute && !g.abilities[s]?.unsealable?.(g, s, g.round));
              for (const s of [0, 1, 2, 3]) if (s !== me && !sealable.includes(s)) expect(g.isSealed(s)).toBe(false);
              const sealed = sealable.every((s) => g.isSealed(s));
              if (sealed) sealedRounds++;
              else if (g.round > 3) afterSeal++;
              expect(g.isSealed(me)).toBe(false);
              expect(sealed).toBe(g.round <= 3);
            }
          });
        },
        { post: (g) => (g.round === 1 ? ['hoyau'] : []) },
      );
    }
    expect(sealedRounds).toBeGreaterThan(20);
    expect(afterSeal).toBeGreaterThan(5);
  }, 120000);

  it('每样一场只能发动一次', () => {
    for (let seed = 1; seed <= 8; seed++) {
      play(
        seed,
        LINEUPS[seed % 4],
        (g, me) => {
          const seen = new Set<string>();
          const gs = g.abilityGameState[me] as { since: Record<string, number> };
          g.onEvent((e) => {
            if (e.type !== 'dealt') return;
            for (const id of ALL) {
              if (gs.since[id] !== g.round) continue;
              expect(seen.has(id)).toBe(false);
              seen.add(id);
            }
          });
        },
        // 玩家每局都想全部放出来
        { pre: () => ['red', 'yellow', 'blue', 'white', 'black'], post: () => ['akkoro', 'huri', 'hoyau'] },
      );
    }
  }, 120000);

  it('红云给自己：别人配牌里没有字牌、也摸不到；红云给一家：只有那一家摸得到字牌', () => {
    let selfDraws = 0;
    let pushed = { honors: 0, draws: 0 };
    let others = { honors: 0, draws: 0 };
    for (let seed = 1; seed <= 12; seed++) {
      play(
        seed,
        LINEUPS[seed % 4],
        (g, me) => {
          g.onEvent((e) => {
            const red = sawayaRedTarget(g, me);
            if (red === null) return;
            if (e.type === 'dealt') {
              for (let s = 0; s < 4; s++) if (s !== red && g.binds(me, s)) expect(g.players[s].hand.some((t) => isHonor(kindOf(t)))).toBe(false);
            }
            if (e.type !== 'draw' || g.rinshanDraw || g.wall.remaining < 20) return;
            const honor = isHonor(kindOf(g.players[e.seat].drawn!));
            if (red === me) {
              if (e.seat !== me && g.binds(me, e.seat)) {
                selfDraws++;
                expect(honor).toBe(false);
              }
              return;
            }
            // 照管不到
            if (!g.binds(me, e.seat)) return;
            const bucket = e.seat === red ? pushed : others;
            bucket.draws++;
            if (honor) bucket.honors++;
          });
        },
        // 单数场给自己，双数场给对家（一场只能用一次）
        { pre: (g) => (g.round === 1 ? [seed % 2 ? 'red' : 'red@2'] : []) },
      );
    }
    expect(selfDraws).toBeGreaterThan(50);
    expect(others.honors).toBe(0);
    expect(pushed.honors / pushed.draws).toBeGreaterThan(0.4);
  }, 120000);

  it('黄云、青云：她配牌的数牌换成 1–4 / 6–9，连着 2 局', () => {
    let hands = 0;
    for (let seed = 1; seed <= 10; seed++) {
      play(
        seed,
        LINEUPS[seed % 4],
        (g, me) => {
          g.onEvent((e) => {
            if (e.type !== 'dealt') return;
            const nums = g.players[me].hand.map(kindOf).filter((k) => k < 27);
            if (sawayaOn(g, me, 'yellow')) {
              hands++;
              expect(nums.filter((k) => numOf(k) > 4).length).toBeLessThanOrEqual(1);
            }
            if (sawayaOn(g, me, 'blue')) {
              hands++;
              expect(nums.filter((k) => numOf(k) < 6).length).toBeLessThanOrEqual(1);
            }
          });
        },
        { pre: (g) => (g.round === 1 ? ['yellow'] : g.round === 3 ? ['blue'] : []) },
      );
    }
    // 每场 4 局（两朵云各 2 局），流局重打也算
    expect(hands).toBeGreaterThanOrEqual(30);
  }, 120000);

  it('海神威：里宝牌是她手里最多的那种万子', () => {
    let checks = 0;
    let hits = 0;
    for (let seed = 1; seed <= 10; seed++) {
      play(
        seed,
        LINEUPS[seed % 4],
        (g, me) => {
          g.onEvent((e) => {
            if (e.type !== 'draw' || e.seat === me || !sawayaOn(g, me, 'akkoro')) return;
            const counts = toCounts(g.players[me].hand);
            const most = Math.max(...counts.slice(0, 9));
            if (most === 0) return;
            checks++;
            const ind = kindOf(g.wall.uraIndicators[0]);
            const ura = ind === 8 ? 0 : ind + 1;
            if (ind < 9 && counts[ura] === most) hits++;
          });
        },
        { post: (g) => (g.round === 1 ? ['akkoro'] : []) },
      );
    }
    expect(checks).toBeGreaterThan(50);
    expect(hits / checks).toBeGreaterThan(0.9);
  }, 120000);

  it('瘟神威：听牌时指定一家，那一家摸到的多是她的和了牌', () => {
    let draws = 0;
    let hits = 0;
    let used = 0;
    for (let seed = 1; seed <= 16; seed++) {
      play(
        seed,
        LINEUPS[seed % 4],
        (g, me) => {
          g.onEvent((e) => {
            const t = sawayaPlagueTarget(g, me);
            if (e.type !== 'draw' || t === null || e.seat !== t || g.rinshanDraw) return;
            const waits = g.waits(me);
            const hit = waits.includes(kindOf(g.players[t].drawn!));
            // 牌山里已经没有她的和了牌时挡不了
            if (!hit && !g.wall.live.some((x) => waits.includes(kindOf(x)))) return;
            draws++;
            if (hit) hits++;
          });
        },
        {
          tick: (g, me) => {
            const ab = g.abilities[me]!;
            const b = ab.skill!(g, me);
            const p = g.players[me];
            const ready = shanten(toCounts(p.hand), p.melds.length) <= 0;
            if (b?.enabled) expect(ready).toBe(true);
            const c = b?.choices?.find((x) => x.enabled);
            if (b?.enabled && c) {
              ab.pressSkill!(g, me, c.id);
              used++;
              expect(sawayaPlagueTarget(g, me)).toBe(Number(c.id));
            }
          },
        },
      );
    }
    expect(used).toBeGreaterThan(5);
    expect(draws).toBeGreaterThan(10);
    expect(hits / draws).toBeGreaterThan(0.85);
  }, 120000);

  it('电脑的爽：蛇神威不单独用；一局最多新叫两样；能打完整场', () => {
    let snake = 0;
    let acted = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const g = play(seed, LINEUPS[seed % 4], (g, me) => {
        const gs = g.abilityGameState[me] as { since: Record<string, number> };
        g.onEvent((e) => {
          if (e.type !== 'dealt') return;
          const fresh = ALL.filter((id) => gs.since[id] === g.round);
          if (fresh.includes('hoyau')) {
            snake++;
            expect(fresh.length).toBeGreaterThan(1);
          }
          expect(fresh.length).toBeLessThanOrEqual(2);
          if (fresh.length) acted++;
        });
      });
      expect(g.phase).toBe('gameEnd');
    }
    expect(snake).toBeGreaterThan(2);
    expect(acted).toBeGreaterThan(24);
  }, 120000);
});
