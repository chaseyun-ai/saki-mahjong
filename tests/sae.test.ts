import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../src/abilities/characters';
import { SAE, SAE_BLOCK, saeAim, saeCanAim, saeLensesLeft, saeTarget, snipedBy } from '../src/abilities/sae';
import type { DrawRule } from '../src/abilities/types';
import { chooseAction } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { kindOf, type TileId } from '../src/engine/tiles';

const byId = (id: string) => CHARACTERS.find((c) => c.id === id)!;

// 把 want 这张牌换到 arr[i]（从各家手牌、牌山、王牌里找出来对换，牌的总数不变）
function swapInto(g: Game, arr: TileId[], i: number, want: TileId) {
  const w = g.wall;
  for (const c of [...g.players.map((p) => p.hand), w.live, w.rinshan, w.doraIndicators, w.uraIndicators]) {
    const j = c.indexOf(want);
    if (j < 0) continue;
    [c[j], arr[i]] = [arr[i], c[j]];
    return;
  }
  throw new Error(`找不到 ${want}`);
}

// 把 seat 的手牌换成 ids（13 张）
function arrange(g: Game, seat: number, ids: TileId[]) {
  const hand = g.players[seat].hand;
  expect(hand.length).toBe(13);
  ids.forEach((t, i) => hand[i] !== t && swapInto(g, hand, i, t));
}

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

  it('玩家：镜片盯住的人这一局摸不到和了牌（和牌键不拿走），一局只能盯一个，三枚用完不回来', () => {
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
        // 和牌键不拿走：别人打出来的照样能荣和
        expect(g.canWin(target)).toBe(true);
        // 一局只能盯一个人
        expect(saeAim(g, 0, 1 + ((round + 1) % 3))).toBe(false);
      }
      playRound(g, seats, (g) => {
        // 被盯的人摸到的牌永远不是和了牌
        if (ok && g.phase === 'turn' && g.turn === target && g.players[target].drawn !== null) {
          expect(g.legalActions(target).some((a) => a.type === 'tsumo')).toBe(false);
        }
      });
      const end = [...g.events].reverse().find((e) => e.type === 'roundEnd');
      if (end?.type === 'roundEnd') {
        if (ok) for (const w of end.result.wins) if (w.seat === target) expect(w.from).not.toBe(null);
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

  it('海底只剩一张、又是被盯的人的和了牌：从王牌里换掉；他照样能荣和', () => {
    const { g } = setup(1, ['sae', 'izumi', 'izumi', 'izumi']);
    g.manual[0] = true;
    expect(saeAim(g, 0, 1)).toBe(true);
    // 一二三四五六七八九万、一一筒、二三筒：听一筒、四筒（一气通贯，门清有役）
    const id = (k: number, copy = 1) => k * 4 + copy;
    arrange(g, 1, [id(0), id(1), id(2), id(3), id(4), id(5), id(6), id(7), id(8), id(9, 1), id(9, 2), id(10), id(11)]);
    expect(g.waits(1).sort((a, b) => a - b)).toEqual([9, 12]);
    const w = g.wall;
    const fourPin = id(12);
    swapInto(g, w.live, w.live.length - 1, fourPin);
    w.live = w.live.slice(-1);
    const before = g.events.length;
    const rule = byId('sae').ability!.beforeAnyDraw!(g, 0, 1, false) as DrawRule;
    expect(rule.deny(fourPin)).toBe(true);
    expect(rule.deny(id(20))).toBe(false);
    expect([9, 12]).not.toContain(kindOf(w.live[0]));
    expect([...w.rinshan, ...w.uraIndicators]).toContain(fourPin);
    expect(g.events.slice(before).some((e) => e.type === 'ability' && e.ability === 'sae' && e.text === SAE_BLOCK && e.target === 1)).toBe(true);
    // 别人打出来的照样能荣和
    expect(g.canWin(1)).toBe(true);
    expect(g.winResult(1, fourPin, false)).not.toBeNull();
    // 没被盯的人不管
    expect(byId('sae').ability!.beforeAnyDraw!(g, 0, 2, false)).toBeFalsy();
  });

  it('电脑：有人立直时用，一场最多三枚，盯上的人那一局摸不到和了牌', () => {
    let used = 0;
    let blocked = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const { g, seats } = setup(seed, ['sae', 'nodoka', 'sera', 'kuro'], 'south');
      let steps = 0;
      const shots: { round: number; target: number }[] = [];
      g.onEvent((e) => {
        if (e.type === 'ability' && e.ability === 'sae' && e.text === SAE_BLOCK) blocked++;
        if (e.type === 'ability' && e.ability === 'sae' && e.text === '镜片') shots.push({ round: g.round, target: saeTarget(g, 0)! });
        if (e.type === 'roundEnd') {
          const shot = shots.find((s) => s.round === g.round);
          if (shot) {
            expect(g.players[shot.target].riichi).toBe(true);
            for (const w of e.result.wins) if (w.seat === shot.target) expect(w.from).not.toBe(null);
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
    expect(blocked).toBeGreaterThan(0);
  }, 60000);
});
