import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { MIHOKO, mihokoEnergy, mihokoEyeOpen, mihokoSafeKinds } from '../src/abilities/mihoko';
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
  it('玩家牌局中随时能睁眼：花体力、睁到这一局结束，体力不够睁不开', () => {
    let opened = 0;
    let refused = 0;
    for (let seed = 1; seed <= 6; seed++) {
      play(seed, LINEUPS[seed % 4], {
        manual: true,
        setup: (g, me) => {
          g.onEvent((e) => {
            // 新的一局右眼是闭着的
            if (e.type === 'roundStart') expect(mihokoEyeOpen(g, me)).toBe(false);
          });
        },
        // 每局第五巡左右按一次
        before: (g, me) => {
          if (g.phase !== 'turn' || g.turn !== me || g.players[me].discards.length !== 4) return;
          const ab = g.abilities[me]!;
          const was = mihokoEyeOpen(g, me);
          const energy = mihokoEnergy(g, me);
          const ok = ab.skill!(g, me)!.enabled;
          ab.pressSkill!(g, me);
          if (was) expect(mihokoEnergy(g, me)).toBe(energy);
          else if (energy >= MIHOKO.eyeCost) {
            expect(ok).toBe(true);
            expect(mihokoEyeOpen(g, me)).toBe(true);
            expect(mihokoEnergy(g, me)).toBe(energy - MIHOKO.eyeCost);
            opened++;
          } else {
            expect(ok).toBe(false);
            expect(mihokoEyeOpen(g, me)).toBe(false);
            refused++;
          }
        },
      });
    }
    expect(opened).toBeGreaterThan(5);
    expect(refused).toBeGreaterThan(0);
  }, 120000);

  it('睁眼看出的“他手里没有的花色”真的和不了；电脑有人立直时会睁眼', () => {
    let checks = 0;
    let riichiOpen = 0;
    for (let seed = 1; seed <= 20; seed++) {
      play(seed, LINEUPS[seed % 4], {
        setup: (g, me) => {
          g.onEvent((e) => {
            if (e.type === 'discard' && e.riichi && e.seat !== me && mihokoEnergy(g, me) >= MIHOKO.eyeCost && !mihokoEyeOpen(g, me)) {
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
  }, 120000);
});
