import { describe, expect, it } from 'vitest';
import { PRIORITY, type Ability } from '../src/abilities/types';
import { Game } from '../src/engine/game';
import { TILE_COUNT, kindOf } from '../src/engine/tiles';
import { isCornerDraw } from '../src/engine/wall';
import { drawSlot } from '../src/ui3d/wallLayout';

const plain = (name: string, ability: Ability | null = null) => ({ name, ability });

describe('能力的新时机', () => {
  it('配牌之前：放在 dealIndices 位置上的牌，正好发到这家手里', () => {
    let marked: number[] = [];
    const deal: Ability = {
      id: 'deal',
      name: '',
      description: '',
      beforeDeal(g, seat) {
        marked = g.dealIndices((seat + 2) % 4).map((i) => g.wall.live[i]);
      },
    };
    for (let seed = 1; seed <= 5; seed++) {
      const g = new Game({ seed, players: [plain('a', deal), plain('b'), plain('c'), plain('d')] });
      const hand = g.players[2].hand.filter((t) => t !== g.players[2].drawn);
      expect([...hand].sort((a, b) => a - b)).toEqual([...marked].sort((a, b) => a - b));
    }
  });

  it('谁先动只看 priority，不看座位', () => {
    for (let rot = 0; rot < 4; rot++) {
      const order: string[] = [];
      const mk = (id: string, priority?: number): Ability => ({
        id,
        name: '',
        description: '',
        priority,
        beforeAnyDraw() {
          order.push(id);
        },
      });
      const list = [mk('self'), mk('kasumi', PRIORITY.kasumi), mk('awai', PRIORITY.awai), mk('koromo', PRIORITY.koromo)];
      const players = [0, 1, 2, 3].map((i) => plain(`p${i}`, list[(i + rot) % 4]));
      new Game({ seed: 3, players });
      expect(order).toEqual(['awai', 'koromo', 'kasumi', 'self']);
    }
  });

  it('控场的规矩：先定的优先；摸牌的人自己的能力换不进被禁止的牌', () => {
    // 两条互相矛盾的规矩：先定的“不许万子”一定成立
    const noMan: Ability = {
      id: 'noMan',
      name: '',
      description: '',
      priority: 10,
      beforeAnyDraw: (_g, seat) => ({ seat, ability: 'noMan', text: '', deny: (t) => kindOf(t) < 9 }),
    };
    const onlyMan: Ability = {
      id: 'onlyMan',
      name: '',
      description: '',
      priority: 20,
      beforeAnyDraw: (_g, seat) => ({ seat, ability: 'onlyMan', text: '', deny: (t) => kindOf(t) >= 9 }),
    };
    // 自己摸牌时想要万子
    const greedy: Ability = {
      id: 'greedy',
      name: '',
      description: '',
      beforeDraw: (g) => void g.wall.bringToLive(0, (t) => kindOf(t) < 9, g.rng),
    };
    for (let seed = 1; seed <= 10; seed++) {
      const g = new Game({ seed, players: [plain('a', greedy), plain('b', noMan), plain('c', onlyMan), plain('d')] });
      expect(kindOf(g.players[0].drawn!)).toBeGreaterThanOrEqual(9);
      expect(g.wall.deny).toBeNull();
    }
  });

  it('里宝牌可以换，牌数不变', () => {
    const ura: Ability = {
      id: 'ura',
      name: '',
      description: '',
      onRoundStart: (g) => void g.wall.bringToUra(0, (t) => kindOf(t) === 31, g.rng),
    };
    const g = new Game({ seed: 9, players: [plain('a', ura), plain('b'), plain('c'), plain('d')] });
    expect(kindOf(g.wall.uraIndicators[0])).toBe(31);
    const all = [...g.wall.allTiles(), ...g.players.flatMap((p) => p.hand)];
    expect(new Set(all).size).toBe(TILE_COUNT);
  });

  it('牌山转角：引擎算的和桌上摆的一致', () => {
    for (let dealer = 0; dealer < 4; dealer++) {
      for (let sum = 2; sum <= 12; sum++) {
        let corners = 0;
        for (let d = 0; d < 122; d++) {
          const here = drawSlot(dealer, sum, d).wall;
          const next = drawSlot(dealer, sum, d + 1).wall;
          expect(isCornerDraw(dealer, sum, d)).toBe(here !== next);
          if (here !== next) corners++;
        }
        // 61 墩能摸的牌，至少拐 3 个弯
        expect(corners).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('cornerIndices 和 drawerOf：live 里的位置对得上', () => {
    const g = new Game({ seed: 4, players: [plain('a'), plain('b'), plain('c'), plain('d')] });
    const sum = g.dice[0] + g.dice[1];
    for (const k of g.cornerIndices()) expect(isCornerDraw(g.dealer, sum, g.wall.frontDrawn + k)).toBe(true);
    // 庄家刚摸完牌、还没打：下一张归下家
    expect(g.drawerOf(0)).toBe((g.dealer + 1) % 4);
    expect(g.drawerOf(5)).toBe((g.dealer + 2) % 4);
  });
});
