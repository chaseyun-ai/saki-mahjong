import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { MIHOKO, MIHOKO_FORM, mihokoEyeLeft, mihokoEyeOpen, mihokoSafeKinds, mihokoTimesLeft } from '../src/abilities/mihoko';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

const LINEUPS = [
  ['mihoko', 'saki', 'nodoka', 'kuro'],
  ['koromo', 'mihoko', 'hiroe', 'awai'],
  ['toki', 'kasumi', 'mihoko', 'teru'],
  ['nodoka', 'saki', 'hiroe', 'mihoko'],
];

// before：每一步行动前调用（玩家操作她时在这里按技能）
function play(seed: number, ids: string[], opts: { manual?: boolean; setup?: (g: Game, me: number) => void; before?: (g: Game, me: number) => void }) {
  const seats = ids.map(byId);
  const me = ids.indexOf('mihoko');
  const g = new Game({ seed, players: seats.map((c, i) => ({ name: c.id, ability: c.ability, manual: !!opts.manual && i === me })) });
  opts.setup?.(g, me);
  let steps = 0;
  while (g.phase !== 'gameEnd' && ++steps < 20000) {
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    opts.before?.(g, me);
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, seats[s].ai));
  }
  return g;
}

describe('福路美穗子', () => {
  it('玩家牌局中随时能睁眼：一场只能睁一次，睁开以后维持三局（连庄不算）', () => {
    let opened = 0;
    let refused = 0;
    let renchanKept = 0; // 连庄的那一把右眼还睁着、剩下的局数没少
    let closed = 0; // 第三局打完以后闭上
    for (let seed = 1; seed <= 24; seed++) {
      // 睁眼的那一局是第几局（东 1 局 0，连庄不加）
      let openAt: number | null = null;
      let lastSlot = -1;
      let lastLeft = 0;
      play(seed, LINEUPS[seed % 4], {
        manual: true,
        setup: (g, me) => {
          g.onEvent((e) => {
            if (e.type !== 'roundStart') return;
            const slot = g.roundWind * 4 + g.roundNumber;
            const left = mihokoEyeLeft(g, me);
            if (openAt === null) expect(left).toBe(0);
            else {
              const want = Math.max(0, MIHOKO.hands - (slot - openAt));
              expect(left).toBe(want);
              expect(mihokoEyeOpen(g, me)).toBe(want > 0);
              // 头像框换成能力发动头像（form），闭上就换回来
              expect(g.abilities[me]!.form!(g, me)).toBe(want > 0 ? MIHOKO_FORM : null);
              if (slot === lastSlot && lastLeft > 0) {
                expect(left).toBe(lastLeft);
                renchanKept++;
              }
              if (want === 0) {
                closed++;
                openAt = null;
              }
            }
            lastSlot = slot;
            lastLeft = left;
          });
        },
        // 每局第五巡左右按一次
        before: (g, me) => {
          if (g.phase !== 'turn' || g.turn !== me || g.players[me].discards.length !== 4) return;
          const ab = g.abilities[me]!;
          const was = mihokoEyeOpen(g, me);
          const times = mihokoTimesLeft(g, me);
          const ok = ab.skill!(g, me)!.enabled;
          ab.pressSkill!(g, me);
          if (was) {
            expect(ok).toBe(false);
          } else if (times > 0) {
            expect(ok).toBe(true);
            expect(mihokoEyeOpen(g, me)).toBe(true);
            expect(mihokoEyeLeft(g, me)).toBe(MIHOKO.hands);
            expect(mihokoTimesLeft(g, me)).toBe(times - 1);
            openAt = g.roundWind * 4 + g.roundNumber;
            opened++;
          } else {
            // 一场只睁一次：闭上以后再按没用
            expect(ok).toBe(false);
            expect(mihokoEyeOpen(g, me)).toBe(false);
            refused++;
          }
        },
      });
    }
    expect(opened).toBe(24);
    expect(refused).toBeGreaterThan(0);
    expect(closed).toBeGreaterThan(15);
    expect(renchanKept).toBeGreaterThan(0);
  }, 180000);

  it('连庄不算局数：东 1 局睁眼，东 1 局连庄两把、东 2、东 3 都睁着，东 4 闭上', () => {
    const g = new Game({ seed: 3, players: LINEUPS[0].map((id) => ({ name: id, ability: byId(id).ability, manual: id === 'mihoko' })) });
    const me = 0;
    const ab = g.abilities[me]!;
    const at = (wind: number, num: number, honba: number) => {
      g.roundWind = wind;
      g.roundNumber = num;
      g.honba = honba;
    };
    at(0, 0, 0);
    // 摸牌、打牌阶段才按得了
    expect(g.phase === 'turn' || g.phase === 'calls').toBe(true);
    ab.pressSkill!(g, me);
    expect(mihokoEyeLeft(g, me)).toBe(3);
    at(0, 0, 1);
    expect(mihokoEyeLeft(g, me)).toBe(3);
    at(0, 0, 2);
    expect(mihokoEyeLeft(g, me)).toBe(3);
    at(0, 1, 3);
    expect(mihokoEyeLeft(g, me)).toBe(2);
    at(0, 2, 0);
    expect(mihokoEyeLeft(g, me)).toBe(1);
    expect(ab.badge!(g, me)).toBe('右眼1');
    at(0, 2, 1);
    expect(mihokoEyeOpen(g, me)).toBe(true);
    at(0, 3, 0);
    expect(mihokoEyeOpen(g, me)).toBe(false);
    expect(ab.form!(g, me)).toBe(null);
    expect(ab.badge!(g, me)).toBe(null);
  });

  it('睁眼看出的“他手里没有的花色”真的和不了；电脑落后时有人立直会睁眼，不然留到最后三局', () => {
    let checks = 0;
    let riichiOpen = 0;
    for (let seed = 1; seed <= 20; seed++) {
      play(seed, LINEUPS[seed % 4], {
        setup: (g, me) => {
          let opens = 0;
          let lastRounds = false;
          g.onEvent((e) => {
            // 电脑一场只睁一次；到了最后三局还没睁的话一开局就睁
            if (e.type === 'ability' && e.seat === me) expect(++opens).toBe(1);
            if (e.type === 'roundStart' && g.isLastRounds(MIHOKO.hands)) lastRounds = true;
            if (e.type === 'draw' && lastRounds) expect(opens).toBe(1);
            if (e.type === 'discard' && e.riichi && e.seat !== me && mihokoTimesLeft(g, me) > 0 && !mihokoEyeOpen(g, me) && g.players.some((p) => p.seat !== me && p.score > g.players[me].score)) {
              // 下一次有人摸牌前就睁眼
              const at = g.events.length;
              g.onEvent(() => {
                if (g.events.length === at + 2 && g.phase === 'turn') {
                  if (mihokoEyeOpen(g, me)) riichiOpen++;
                }
              });
            }
            if (e.type !== 'draw' || !mihokoEyeOpen(g, me)) return;
            for (let s = 0; s < 4; s++) {
              if (s === me || s === e.seat) continue;
              const waits = g.waits(s);
              if (!waits.length) continue;
              const safe = mihokoSafeKinds(g, me, s);
              checks++;
              for (const k of waits) expect(safe.has(k)).toBe(false);
            }
          });
        },
      });
    }
    expect(checks).toBeGreaterThan(50);
    expect(riichiOpen).toBeGreaterThan(0);
  }, 180000);
});
