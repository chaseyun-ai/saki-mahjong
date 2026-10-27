import { describe, expect, it } from 'vitest';
import type { Ability, DealRule } from '../src/abilities/types';
import { Game } from '../src/engine/game';
import { TILE_COUNT, TileId, kindOf, suitOf } from '../src/engine/tiles';

// 配牌的规矩：先全部定好，再依次调整；能兼容就一起满足，和谁先动无关；无解时降级，先动的人的规矩保住
const plain = (name: string, ability: Ability | null = null) => ({ name, ability });

// 一个只管“第 target 家配牌里不许有 deny 的牌”的探针能力
function probe(id: string, priority: number, target: number, deny: (t: TileId) => boolean): Ability {
  return {
    id,
    name: id,
    description: '',
    priority,
    dealRules(_g, seat): DealRule[] {
      return [{ seat, ability: id, text: id, target: (seat + target) % 4, bad: (hand) => hand.filter(deny).length }];
    },
    beforeDeal(g, seat) {
      for (const i of g.dealIndices((seat + target) % 4)) {
        if (!deny(g.wall.live[i])) continue;
        const swap = () => g.wall.bringToLive(i, (t) => !deny(t), g.rng, (j) => j >= 52);
        if (!swap()) g.dealFallback(seat, swap);
      }
    },
  };
}

const isMan = (t: TileId) => kindOf(t) < 27 && suitOf(kindOf(t)) === 0;
const isPin = (t: TileId) => kindOf(t) < 27 && suitOf(kindOf(t)) === 1;
const isHonor = (t: TileId) => kindOf(t) >= 27;
const notHonor = (t: TileId) => kindOf(t) < 27;
const dealt = (g: Game, seat: number) => g.players[seat].hand.filter((t) => t !== g.players[seat].drawn);

function allTiles(g: Game) {
  const t = [...g.wall.allTiles(), ...g.players.flatMap((p) => p.hand)].sort((a, b) => a - b);
  return t.length === TILE_COUNT && t.every((x, i) => x === i);
}

describe('配牌的规矩', () => {
  it('能兼容的两条规矩都满足，谁先动都一样', () => {
    for (const [pa, pb] of [
      [10, 30],
      [30, 10],
    ]) {
      for (let seed = 1; seed <= 20; seed++) {
        // 座位 0 不许座位 2 有万子，座位 1 不许座位 2 有筒子（座位 1 往后数 1 家就是座位 2）
        const g = new Game({ seed, players: [plain('a', probe('noMan', pa, 2, isMan)), plain('b', probe('noPin', pb, 1, isPin)), plain('c'), plain('d')] });
        expect(dealt(g, 2).some(isMan)).toBe(false);
        expect(dealt(g, 2).some(isPin)).toBe(false);
        expect(g.dealUnmet).toEqual([]);
        expect(allTiles(g)).toBe(true);
      }
    }
  });

  it('后动的人调整时不能让先定的规矩变差', () => {
    for (let seed = 1; seed <= 20; seed++) {
      // 先动的不许座位 2 有字牌；后动的不许座位 2 有万子：后者只能换进不是字牌的牌
      const g = new Game({ seed, players: [plain('a', probe('noHonor', 10, 2, isHonor)), plain('b', probe('noMan', 30, 1, isMan)), plain('c'), plain('d')] });
      expect(dealt(g, 2).some(isHonor)).toBe(false);
      expect(dealt(g, 2).some(isMan)).toBe(false);
    }
  });

  it('无解时降级：先动的人的规矩保住，没满足的记在 dealUnmet', () => {
    for (let seed = 1; seed <= 20; seed++) {
      // 一个不许座位 2 有字牌，一个不许座位 2 有数牌：13 张不可能同时满足
      const g = new Game({ seed, players: [plain('a', probe('noHonor', 10, 2, isHonor)), plain('b', probe('noNumber', 30, 1, notHonor)), plain('c'), plain('d')] });
      expect(dealt(g, 2).some(isHonor)).toBe(false);
      expect(g.dealUnmet.map((r) => r.ability)).toEqual(['noNumber']);
      expect(allTiles(g)).toBe(true);
    }
  });

  it('调整完配牌统一锁定，发牌后锁自动解开；调整期间以外没有把关', () => {
    const g = new Game({ seed: 3, players: [plain('a', probe('noMan', 10, 2, isMan)), plain('b'), plain('c'), plain('d')] });
    expect(g.wall.guard).toBeNull();
    for (const p of g.players) for (const t of p.hand) expect(g.wall.locked.has(t)).toBe(false);
  });
});
