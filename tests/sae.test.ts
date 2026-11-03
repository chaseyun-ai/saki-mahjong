import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { SAE, saeAim, saeCanAim, saeLensesLeft, saeTarget, snipedBy } from '../src/abilities/sae';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

function setup(seed: number, ids: string[], format: 'east' | 'south' = 'east') {
  const seats = ids.map(byId);
  const g = new Game({ seed, format, players: seats.map((c) => ({ name: c.id, ability: c.ability })) });
  return { g, seats };
}

// 打到这一局结束（每一步之后调 after）
function playRound(g: Game, seats: ReturnType<typeof setup>['seats'], after?: (g: Game) => void) {
  let steps = 0;
  while (g.phase !== 'roundEnd' && g.phase !== 'gameEnd' && ++steps < 5000) {
    const s = g.waitingSeats()[0];
    g.act(s, chooseAction(g, s, seats[s].ai));
    after?.(g);
  }
}

describe('臼泽塞', () => {
  it('3 费，宫守', () => {
    expect(byId('sae').cost).toBe(3);
    expect(byId('sae').school).toBe('宫守女子');
  });

  it('玩家：镜片盯住的人这一局和不了，一局只能盯一个，三枚用完不回来', () => {
    const { g, seats } = setup(3, ['sae', 'nodoka', 'izumi', 'kuro'], 'south');
    g.manual[0] = true;
    let round = 0;
    while (g.phase !== 'gameEnd' && round < 12) {
      expect(saeCanAim(g, 0, 0)).toBe(false);
      const target = 1 + (round % 3);
      const before = saeLensesLeft(g, 0);
      const ok = saeAim(g, 0, target);
      expect(ok).toBe(before > 0);
      expect(saeLensesLeft(g, 0)).toBe(Math.max(0, before - 1));
      if (ok) {
        expect(saeTarget(g, 0)).toBe(target);
        expect(snipedBy(g, target)).toBe(0);
        expect(g.canWin(target)).toBe(false);
        // 一局只能盯一个人
        expect(saeAim(g, 0, 1 + ((round + 1) % 3))).toBe(false);
      }
      playRound(g, seats, (g) => {
        if (ok && (g.phase === 'turn' || g.phase === 'calls')) expect(g.canWin(target)).toBe(false);
      });
      const end = [...g.events].reverse().find((e) => e.type === 'roundEnd');
      if (end?.type === 'roundEnd') {
        if (ok) for (const w of end.result.wins) expect(w.seat).not.toBe(target);
      }
      if ((g.phase as string) === 'gameEnd') break;
      g.nextRound();
      round++;
      // 下一局清掉
      expect(saeTarget(g, 0)).toBe(null);
    }
    expect(saeLensesLeft(g, 0)).toBe(0);
    expect(round).toBeGreaterThanOrEqual(SAE.lenses);
  }, 30000);

  it('盯不住别人的能力管不到的人（宫永照），镜片不会白用', () => {
    const { g } = setup(5, ['sae', 'teru', 'izumi', 'kuro']);
    g.manual[0] = true;
    expect(saeCanAim(g, 0, 1)).toBe(false);
    expect(saeAim(g, 0, 1)).toBe(false);
    expect(saeLensesLeft(g, 0)).toBe(SAE.lenses);
    expect(saeAim(g, 0, 2)).toBe(true);
  });

  it('技能框给出镜片：还剩几枚、能拖到哪几家', () => {
    const { g } = setup(7, ['sae', 'teru', 'izumi', 'kuro']);
    g.manual[0] = true;
    const b = byId('sae').ability!.skill!(g, 0)!;
    expect(byId('sae').ability!.powered!(g, 0)).toBe(false);
    expect(b.lenses).toEqual({ max: 3, left: 3, target: null, targets: [2, 3] });
    byId('sae').ability!.pressSkill!(g, 0, '3');
    const after = byId('sae').ability!.skill!(g, 0)!;
    expect(after.lenses).toEqual({ max: 3, left: 2, target: 3, targets: [] });
    expect(after.active).toBe(true);
    // 盯上人以后头像换成能力发动头像
    expect(byId('sae').ability!.powered!(g, 0)).toBe(true);
  });

  it('电脑：有人立直时用，一场最多三枚，盯上的人那一局不和牌', () => {
    let used = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const { g, seats } = setup(seed, ['sae', 'nodoka', 'sera', 'kuro'], 'south');
      let steps = 0;
      const shots: { round: number; target: number }[] = [];
      g.onEvent((e) => {
        if (e.type === 'ability' && e.ability === 'sae') shots.push({ round: g.round, target: saeTarget(g, 0)! });
        if (e.type === 'roundEnd') {
          const shot = shots.find((s) => s.round === g.round);
          if (shot) {
            expect(g.players[shot.target].riichi).toBe(true);
            for (const w of e.result.wins) expect(w.seat).not.toBe(shot.target);
          }
        }
      });
      while (g.phase !== 'gameEnd' && ++steps < 30000) {
        if (g.phase === 'roundEnd') {
          g.nextRound();
          continue;
        }
        const s = g.waitingSeats()[0];
        g.act(s, chooseAction(g, s, seats[s].ai));
      }
      expect(shots.length).toBeLessThanOrEqual(SAE.lenses);
      expect(new Set(shots.map((s) => s.round)).size).toBe(shots.length);
      used += shots.length;
    }
    expect(used).toBeGreaterThan(5);
  }, 60000);
});
